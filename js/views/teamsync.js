// Settings UI for team sync: set up a team store, pair another device, and
// show what is waiting to go out.

import { h, btn, iconBtn, openSheet, confirmDialog, toast, timeAgo } from '../ui.js';
import * as sync from '../sync.js';

const STORE_HELP = 'https://supabase.com/dashboard';

const stateText = (s) => ({
  off: 'Off — this iPad keeps its plays to itself',
  idle: s.pending ? `${s.pending} change${s.pending === 1 ? '' : 's'} waiting to go up` : `Synced ${timeAgo(s.lastSyncAt)}`,
  syncing: 'Syncing…',
  offline: s.pending ? `Offline — ${s.pending} change${s.pending === 1 ? '' : 's'} will go up later` : 'Offline — will sync when back online',
  error: s.error || 'Sync problem',
}[s.state] || '');

const toneOf = (s) => (s.state === 'error' ? 'no' : s.state === 'idle' && !s.pending ? 'ok' : 'no');

// ---------- Setup ----------

function setupSheet(onDone) {
  const url = h('input', { class: 'input', placeholder: 'https://abcdefgh.supabase.co', autocomplete: 'off', spellcheck: 'false' });
  const key = h('input', { class: 'input', placeholder: 'eyJhbGciOi… (the anon public key)', autocomplete: 'off', spellcheck: 'false' });
  const sql = h('textarea', { class: 'input code', rows: 8, readonly: true, spellcheck: 'false' }, sync.SETUP_SQL);
  const err = h('div', { class: 'p-help bad', hidden: true });

  openSheet({
    title: 'Set up team sync',
    size: 'lg',
    body: h('div', null,
      h('p', { class: 'p-help' }, 'Sync needs one free store that both iPads talk to. This is a five-minute job you only do once, on this iPad.'),
      h('ol', { class: 'steps' },
        h('li', null, h('b', null, 'Make a free store.'), ' Sign up at ', h('a', { href: STORE_HELP, target: '_blank', rel: 'noopener' }, 'supabase.com'), ' and create a project. Any region, free plan.'),
        h('li', null, h('b', null, 'Run this once.'), ' In that project open SQL Editor, paste the block below and press Run. It makes the table the app syncs through.'),
        h('li', null, h('b', null, 'Copy two values.'), ' In the project’s Settings → API, copy the Project URL and the ', h('b', null, 'anon public'), ' key into the boxes below.')),
      h('div', { class: 'btn-row tight pad' },
        btn('Copy the SQL', async () => {
          try { await navigator.clipboard.writeText(sync.SETUP_SQL); toast('SQL copied'); } catch { sql.select(); }
        }, { iconName: 'copy', kind: 'small ghost' })),
      sql,
      h('label', { class: 'field-label' }, 'Project URL', url),
      h('label', { class: 'field-label' }, 'Anon public key', key),
      h('p', { class: 'p-help' }, 'These stay on this iPad and travel only in the team code you hand another device. They are never part of the app’s public files.'),
      err),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Start syncing',
        kind: 'primary',
        onClick: async () => {
          const u = url.value.trim().replace(/\/+$/, '');
          const k = key.value.trim();
          // https only, so the team's data never crosses the network in clear —
          // bar a store you are running on the same machine.
          const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u);
          if ((!/^https:\/\/.+/.test(u) && !local) || !k) {
            err.hidden = false;
            err.textContent = 'Both the project URL (starting https://) and the anon key are needed.';
            return false;
          }
          const res = await sync.createTeam({ url: u, key: k, team: sync.makeTeamCode() });
          if (res?.error) {
            err.hidden = false;
            err.textContent = String(res.error.message || res.error);
            await sync.unpair();
            return false;
          }
          onDone?.();
          inviteSheet();
          return true;
        },
      },
    ],
  });
}

function joinSheet(onDone) {
  const code = h('textarea', { class: 'input code', rows: 4, placeholder: 'flagcoach1.…', spellcheck: 'false' });
  const err = h('div', { class: 'p-help bad', hidden: true });
  openSheet({
    title: 'Join a team',
    size: 'md',
    body: h('div', null,
      h('p', { class: 'p-help' }, 'Paste the team code from the iPad that already has the playbook (Settings → Team sync → Invite a device).'),
      code,
      h('p', { class: 'p-help' }, 'Joining replaces this iPad’s plays, roster and seasons with the team’s copy, then keeps both in step from here on.'),
      err),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Join team',
        kind: 'primary',
        onClick: async () => {
          let pairing;
          try {
            pairing = sync.decodePairing(code.value);
          } catch (e) {
            err.hidden = false;
            err.textContent = String(e.message || e);
            return false;
          }
          const ok = await confirmDialog({
            title: 'Replace this iPad’s playbook?',
            message: 'The team’s plays, roster and seasons take over on this iPad. Anything only on this iPad is lost — save a backup first if you need it.',
            confirmText: 'Replace & join',
            danger: true,
          });
          if (!ok) return false;
          const res = await sync.joinTeam(pairing);
          if (res?.error) {
            err.hidden = false;
            err.textContent = String(res.error.message || res.error);
            await sync.unpair();
            return false;
          }
          toast('Joined the team');
          onDone?.();
          return true;
        },
      },
    ],
  });
}

function inviteSheet() {
  const cfg = sync.config();
  if (!cfg) return;
  const pairing = sync.encodePairing(cfg);
  const box = h('textarea', { class: 'input code', rows: 4, readonly: true, spellcheck: 'false' }, pairing);
  openSheet({
    title: 'Invite a device',
    size: 'md',
    body: h('div', null,
      h('p', { class: 'p-help' }, 'On the other iPad, open Flag Coach → Settings → Team sync → Join a team, and paste this code.'),
      box,
      h('div', { class: 'btn-row tight pad' },
        btn('Copy code', async () => {
          try { await navigator.clipboard.writeText(pairing); toast('Team code copied'); } catch { box.select(); }
        }, { iconName: 'copy', kind: 'primary' }),
        btn('Share', () => navigator.share?.({ title: 'Flag Coach team code', text: pairing }).catch(() => {}), { iconName: 'share', kind: 'ghost' })),
      h('p', { class: 'p-help' }, 'Treat it like a key: anyone with this code can read and change the team’s plays and roster. AirDrop or text it to the person, and don’t post it anywhere public.')),
    actions: [{ label: 'Done', kind: 'primary' }],
  });
}

// ---------- Section ----------

export function teamSyncSection(row, rerender) {
  const s = sync.status;
  const statusEl = h('span', { class: `status ${toneOf(s)}` }, stateText(s));

  const controls = sync.isOn()
    ? h('div', { class: 'btn-row tight' },
      btn('Sync now', async () => { await sync.sync(); }, { iconName: 'restart', kind: 'small primary' }),
      btn('Invite a device', inviteSheet, { iconName: 'share', kind: 'small ghost' }))
    : h('div', { class: 'btn-row tight' },
      btn('Set up team sync', () => setupSheet(rerender), { iconName: 'share', kind: 'primary' }),
      btn('Join a team', () => joinSheet(rerender), { iconName: 'upload', kind: 'ghost' }));

  return h('section', { class: 'set-section' },
    h('div', { class: 'set-title' }, 'Team sync'),
    row('Status', sync.isOn() ? 'Plays, roster and rules stay in step across paired iPads' : 'Off — plays live only on this iPad', statusEl),
    sync.isOn() ? h('p', { class: 'p-help pad' }, 'Edits sync a few seconds after you make them, and whenever the app comes back online. If two people change the same play, the most recent edit wins.')
      : h('p', { class: 'p-help pad' }, 'Pair another iPad so plays made at home show up at practice. Needs a free store you set up once — backups keep working either way.'),
    h('div', { class: 'set-row' }, controls),
    sync.isOn() ? h('div', { class: 'set-row' },
      btn('Stop syncing on this iPad', async () => {
        if (await confirmDialog({
          title: 'Stop syncing?',
          message: 'This iPad keeps everything it has now but stops sending and receiving changes. You can pair it again later with the team code.',
          confirmText: 'Stop syncing',
          danger: true,
        })) { await sync.unpair(); rerender(); }
      }, { kind: 'ghost danger-text', iconName: 'wifiOff' })) : null);
}

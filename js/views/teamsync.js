// Settings UI for team sync: set up a team store, pair another device, and
// show what is waiting to go out.

import { h, btn, iconBtn, openSheet, confirmDialog, toast, timeAgo } from '../ui.js';
import * as sync from '../sync.js';
import { qrSvg } from '../qr.js';

const STORE_HELP = 'https://supabase.com/dashboard';

// Where this copy of the app is served from, with no route on the end. A join
// link is just that address plus the code, so it works from GitHub Pages, a
// dev server, anywhere the app is hosted.
const appUrl = () => `${location.origin}${location.pathname}`;
export const joinLink = (code) => `${appUrl()}#/join/${code}`;

const isInstalled = () => window.navigator.standalone === true
  || window.matchMedia?.('(display-mode: standalone)').matches === true;

// The invite, as a QR code to point a camera at and a link to send. Scanning
// beats pasting a 400-character code onto a phone, which is where people give
// up. The raw code still sits underneath for anyone who prefers it.
function shareBlock(code, { what }) {
  const link = joinLink(code);
  const qr = h('div', { class: 'qr-box' });
  try {
    qr.innerHTML = qrSvg(link, { label: `Join as ${what}` });
  } catch {
    qr.replaceChildren(h('p', { class: 'p-help' }, 'Too long to show as a QR code — send the link instead.'));
  }
  const linkBox = h('textarea', { class: 'input code', rows: 2, readonly: true, spellcheck: 'false' }, link);
  return h('div', null,
    qr,
    h('p', { class: 'p-help center' }, 'Point a phone camera at this, then tap the banner that pops up.'),
    linkBox,
    h('div', { class: 'btn-row tight pad' },
      btn('Copy link', async () => {
        try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { linkBox.select(); }
      }, { iconName: 'copy', kind: 'primary' }),
      btn('Share', () => navigator.share?.({ title: 'Flag Coach', text: `Join our Flag Coach ${what === 'player' ? 'playbook' : 'team'}`, url: link }).catch(() => {}), { iconName: 'share', kind: 'ghost' })));
}

// Nothing can install the app for you on an iPhone or iPad, and this is the
// step people skip — then cannot find the app later.
function homeScreenSheet() {
  openSheet({
    title: 'Keep it on the Home Screen',
    size: 'md',
    body: h('div', null,
      h('p', { class: 'p-help' }, 'Add Flag Coach to the Home Screen so it opens like a real app and keeps working on the field with no signal.'),
      h('ol', { class: 'steps' },
        h('li', null, 'Tap ', h('b', null, 'Share'), ' in Safari — the square with an arrow out of the top.'),
        h('li', null, 'Scroll down and tap ', h('b', null, 'Add to Home Screen'), '.'),
        h('li', null, 'Tap ', h('b', null, 'Add'), ', then open it once while you still have signal.'))),
    actions: [{ label: 'Got it', kind: 'primary' }],
  });
}

// Shared by the paste-a-code sheet and the tap-a-link route.
async function confirmAndJoin(pairing) {
  const player = pairing.role === 'viewer';
  const ok = await confirmDialog({
    title: player ? 'Join as a player?' : 'Replace this iPad\u2019s playbook?',
    message: player
      ? 'This device will show the team\u2019s plays, read-only — no editing, and no roster. Anything already on this device is replaced.'
      : 'The team\u2019s plays, roster and seasons take over on this iPad. Anything only on this iPad is lost — save a backup first if you need it.',
    confirmText: player ? 'Join as player' : 'Replace & join',
    danger: true,
  });
  if (!ok) return { cancelled: true };
  const res = await sync.joinTeam(pairing);
  if (res?.error) {
    await sync.unpair();
    return { error: res.error };
  }
  toast(player ? 'Following the team' : 'Joined the team');
  if (!isInstalled()) homeScreenSheet();
  return {};
}

/**
 * A tap on a join link lands here: #/join/<code>. Saves the player hunting
 * through Settings and pasting a code they cannot read.
 */
export async function joinFromLink(code, onDone) {
  let pairing;
  try {
    pairing = sync.decodePairing(code);
  } catch {
    toast('That join link is not valid', { tone: 'bad' });
    return;
  }
  const cfg = sync.config();
  if (cfg && cfg.team === pairing.team && cfg.role === pairing.role) {
    toast('Already on this team');
    return;
  }
  const res = await confirmAndJoin(pairing);
  if (res.error) toast(String(res.error.message || res.error), { tone: 'bad' });
  onDone?.();
}

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
  const key = h('input', { class: 'input', placeholder: 'sb_publishable_… or eyJhbGciOi…', autocomplete: 'off', spellcheck: 'false' });
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
        h('li', null, h('b', null, 'Copy two values.'), ' Press ', h('b', null, 'Connect'), ' at the top of the project — it shows the Project URL and the ', h('b', null, 'publishable'), ' key. Copy both into the boxes below. An older project may call the key ', h('b', null, 'anon public'), ' instead; either works.')),
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
      h('p', { class: 'p-help' }, 'Paste the code you were given. A coach code lets you edit the playbook; a player code is read-only for studying plays.'),
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
          const res = await confirmAndJoin(pairing);
          if (res.cancelled) return false;
          if (res.error) {
            err.hidden = false;
            err.textContent = String(res.error.message || res.error);
            return false;
          }
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
    title: 'Invite a coach',
    size: 'md',
    body: h('div', null,
      h('p', { class: 'p-help' }, 'For another coach who needs to build plays. They scan this or tap the link and the app opens ready to join. For a player who only needs to study, use “Invite a player” instead.'),
      shareBlock(pairing, { what: 'coach' }),
      h('div', { class: 'set-title pad' }, 'Or hand over the code'),
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

function playerSheet() {
  const cfg = sync.config();
  if (!cfg) return;
  const sql = h('textarea', { class: 'input code', rows: 6, readonly: true, spellcheck: 'false' }, sync.PLAYER_SQL);
  const box = h('textarea', { class: 'input code', rows: 4, readonly: true, spellcheck: 'false' }, 'building the code…');
  const share = h('div', { class: 'share-slot' }, h('p', { class: 'p-help center' }, 'Building the invite…'));
  sync.playerPairing().then((code) => {
    box.value = code;
    share.replaceChildren(shareBlock(code, { what: 'player' }));
  });

  openSheet({
    title: 'Invite a player',
    size: 'lg',
    body: h('div', null,
      h('p', { class: 'p-help' }, 'A player code is read-only. It shows the playbook and the animation — no editing, and the roster stays on the coaches’ iPads only.'),
      h('div', { class: 'set-title pad' }, 'One-time: switch player view on'),
      h('p', { class: 'p-help' }, 'Run this once in your store’s SQL Editor. Skip it if you set the team up after player view existed — it is already in place, and running it twice is harmless.'),
      h('div', { class: 'btn-row tight pad' },
        btn('Copy the SQL', async () => {
          try { await navigator.clipboard.writeText(sync.PLAYER_SQL); toast('SQL copied'); } catch { sql.select(); }
        }, { iconName: 'copy', kind: 'small ghost' })),
      sql,
      h('div', { class: 'set-title pad' }, 'The player invite'),
      share,
      h('div', { class: 'set-title pad' }, 'Or hand over the code'),
      box,
      h('div', { class: 'btn-row tight pad' },
        btn('Copy player code', async () => {
          try { await navigator.clipboard.writeText(box.value); toast('Player code copied'); } catch { box.select(); }
        }, { iconName: 'copy', kind: 'primary' }),
        btn('Share', () => navigator.share?.({ title: 'Flag Coach player code', text: box.value }).catch(() => {}), { iconName: 'share', kind: 'ghost' })),
      h('p', { class: 'p-help' }, 'Safe to give the whole team: it cannot change anything, and it cannot be turned back into your coach code. Hold the QR up at a parent meeting and everyone can join at once — but treat the link like a key and keep it off anywhere public.')),
    actions: [{ label: 'Done', kind: 'primary' }],
  });
}

// ---------- Section ----------

export function teamSyncSection(row, rerender) {
  const s = sync.status;
  const statusEl = h('span', { class: `status ${toneOf(s)}` }, stateText(s));

  // A player device follows the team; there is nothing for it to send or share.
  if (sync.isViewer()) {
    return h('section', { class: 'set-section' },
      h('div', { class: 'set-title' }, 'Team sync'),
      row('Following the team', 'Plays arrive on their own. This device cannot change them.', statusEl),
      h('p', { class: 'p-help pad' }, 'New plays show up within a few seconds of your coach saving them, and whenever you reopen the app. It all works with no internet — you just see the plays as of the last time you had a signal.'),
      h('div', { class: 'set-row' },
        btn('Check for new plays', async () => { await sync.sync(); }, { iconName: 'restart', kind: 'small primary' })),
      h('div', { class: 'set-row' },
        btn('Stop following this team', async () => {
          if (await confirmDialog({
            title: 'Stop following?',
            message: 'The plays already on this device stay, but you stop getting new ones. You can join again with the player code.',
            confirmText: 'Stop following',
            danger: true,
          })) { await sync.unpair(); rerender(); }
        }, { kind: 'ghost danger-text', iconName: 'wifiOff' })));
  }

  const controls = sync.isOn()
    ? h('div', { class: 'btn-row tight' },
      btn('Sync now', async () => { await sync.sync(); }, { iconName: 'restart', kind: 'small primary' }),
      btn('Invite a coach', inviteSheet, { iconName: 'share', kind: 'small ghost' }),
      btn('Invite a player', playerSheet, { iconName: 'users', kind: 'small ghost' }))
    : h('div', { class: 'btn-row tight' },
      btn('Set up team sync', () => setupSheet(rerender), { iconName: 'share', kind: 'primary' }),
      btn('Join a team', () => joinSheet(rerender), { iconName: 'upload', kind: 'ghost' }));

  return h('section', { class: 'set-section' },
    h('div', { class: 'set-title' }, 'Team sync'),
    row('Status', sync.isOn() ? 'Plays, roster and rules stay in step across paired iPads' : 'Off — plays live only on this iPad', statusEl),
    sync.isOn() ? h('p', { class: 'p-help pad' }, 'Edits sync a few seconds after you make them, and whenever the app comes back online. If two people change the same play, the most recent edit wins. A player code is read-only and never includes the roster.')
      : h('p', { class: 'p-help pad' }, 'Pair another iPad so plays made at home show up at practice, and hand players a read-only code to study from. Needs a free store you set up once — backups keep working either way.'),
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

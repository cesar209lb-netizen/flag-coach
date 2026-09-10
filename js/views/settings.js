// Settings: team, seasons, league rules, backup/restore, offline status.

import { h, icon, iconBtn, btn, openSheet, confirmDialog, promptDialog, toast, stepper, timeAgo } from '../ui.js';
import { state, subscribe, activeSeason, saveSettings, saveSeason, deleteSeason, eraseEverything } from '../store.js';
import { newSeason, seasonNameFor } from '../model.js';
import { saveBackup, restoreBackup } from '../backup.js';
import { onStatus, unpair, isOn, isViewer } from '../sync.js';
import { teamSyncSection } from './teamsync.js';

export const APP_VERSION = '1.0';

export function mount(root) {
  const render = () => root.replaceChildren(build(render));
  render();
  const unsub = subscribe(render);
  const unsubSync = onStatus(render);
  return { destroy: () => { unsub(); unsubSync(); } };
}

const row = (label, sub, control) => h('div', { class: 'set-row' },
  h('div', { class: 'set-label' }, h('b', null, label), sub ? h('span', null, sub) : null), control);

function build(rerender = () => {}) {
  const s = state.settings;
  const active = activeSeason();
  // Player view follows the coach's plays and rules, so there is nothing here
  // to change — only the team it follows and whether it works offline.
  const viewer = isViewer();

  const team = h('input', { class: 'input', value: s.teamName, maxLength: 40, style: { maxWidth: '280px' } });
  team.addEventListener('change', () => saveSettings({ teamName: team.value.trim() || 'My Team' }, { silent: true }));

  const persistEl = h('span', { class: 'status no' }, 'Checking…');
  navigator.storage?.persisted?.().then((p) => {
    persistEl.className = `status ${p ? 'ok' : 'no'}`;
    persistEl.textContent = p ? 'Protected' : 'Not yet';
  }).catch(() => { persistEl.textContent = 'Unknown'; });
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const offlineReady = !!navigator.serviceWorker?.controller;
  const backupAge = s.lastBackupAt ? Date.now() - s.lastBackupAt : Infinity;

  return h('div', { class: 'page settings' },
    h('header', { class: 'page-head' }, h('h1', null, 'Settings')),

    viewer ? null : h('section', { class: 'set-section' },
      h('div', { class: 'set-title' }, 'Team'),
      row('Team name', 'Shown on the home screen and player cards', team)),

    viewer ? null : h('section', { class: 'set-section' },
      h('div', { class: 'set-title' }, 'Seasons'),
      ...state.seasons.slice().reverse().map((season) => row(
        season.name, `${season.roster.length} player${season.roster.length === 1 ? '' : 's'}`,
        h('div', { class: 'btn-row tight' },
          season.id === active.id ? h('span', { class: 'badge' }, 'Current') : btn('Make current', () => saveSettings({ activeSeasonId: season.id }), { kind: 'small ghost' }),
          iconBtn('edit', async () => {
            const name = await promptDialog({ title: 'Rename season', label: 'Season name', value: season.name });
            if (name) { season.name = name; await saveSeason(season); }
          }, { title: 'Rename', cls: 'small' }),
          state.seasons.length > 1 ? iconBtn('trash', async () => {
            if (await confirmDialog({ title: `Delete ${season.name}?`, message: 'The season and its roster list are removed. Players and plays are kept.', confirmText: 'Delete season', danger: true })) {
              await deleteSeason(season.id);
            }
          }, { title: 'Delete season', cls: 'small' }) : null))),
      h('div', { class: 'set-row' }, btn('Start a new season', openNewSeason, { iconName: 'plus', kind: 'ghost' }))),

    viewer ? null : h('section', { class: 'set-section' },
      h('div', { class: 'set-title' }, 'League rules'),
      row('Pass clock', 'How long the QB has to throw', stepper(s.passClock, { min: 3, max: 15, suffix: 's', onChange: (v) => saveSettings({ passClock: v }, { silent: true }) })),
      row('Rusher distance', 'How far off the line the rusher starts', stepper(s.rushDistance, { min: 3, max: 15, suffix: ' yds', onChange: (v) => saveSettings({ rushDistance: v }, { silent: true }) })),
      row('Field width', 'Sideline to sideline. Existing plays keep their spots.', stepper(s.fieldWidth, { min: 20, max: 40, suffix: ' yds', onChange: (v) => saveSettings({ fieldWidth: v }, { silent: true }) }))),

    teamSyncSection(row, rerender),

    viewer ? null : h('section', { class: 'set-section' },
      h('div', { class: 'set-title' }, 'Backup & restore'),
      row('Last backup', s.lastBackupAt ? new Date(s.lastBackupAt).toLocaleString() : 'Your plays and roster only live on this device',
        h('span', { class: `status ${backupAge < 7 * 864e5 ? 'ok' : 'no'}` }, timeAgo(s.lastBackupAt))),
      h('p', { class: 'p-help pad' }, 'Save a backup file to iCloud Drive (or AirDrop it to your Mac) every week or two. If this device is lost or reset, restoring the file brings back everything — plays, roster, photos and seasons.'),
      h('div', { class: 'set-row' },
        h('div', { class: 'btn-row tight' },
          btn('Save backup', saveBackup, { iconName: 'share', kind: 'primary' }),
          btn('Restore from backup', restoreBackup, { iconName: 'upload', kind: 'ghost' })))),

    h('section', { class: 'set-section' },
      h('div', { class: 'set-title' }, 'Use at the field (offline)'),
      row('Installed on Home Screen', standalone ? 'Running as an app' : 'Open in Safari → Share → Add to Home Screen',
        h('span', { class: `status ${standalone ? 'ok' : 'no'}` }, standalone ? 'Yes' : 'Not yet')),
      row('Works without internet', offlineReady ? 'All app files are saved on this device' : 'Needs to be opened once from the hosted website',
        h('span', { class: `status ${offlineReady ? 'ok' : 'no'}` }, offlineReady ? 'Ready' : 'Not yet')),
      row('Storage protected', 'Keeps the browser from clearing app data', persistEl),
      h('ol', { class: 'steps' },
        h('li', null, 'At home on Wi-Fi, open the Flag Coach website in ', h('b', null, 'Safari'), '.'),
        h('li', null, 'Tap ', h('b', null, 'Share'), ' → ', h('b', null, 'Add to Home Screen'), '.'),
        h('li', null, 'Always open Flag Coach from the Home Screen icon.'),
        h('li', null, 'Test it: turn on ', h('b', null, 'Airplane Mode'), ' and open the app.'))),

    h('section', { class: 'set-section' },
      h('div', { class: 'set-title' }, 'About'),
      row('Flag Coach', `Version ${APP_VERSION} · everything stays on this device`, icon('shield')),
      h('div', { class: 'set-row' }, btn('Erase all data', async () => {
        if (!(await confirmDialog({ title: 'Erase everything?', message: 'All plays, players, photos and seasons on this device will be deleted. Save a backup first if you might want them back.', confirmText: 'Continue', danger: true }))) return;
        if (!(await confirmDialog({ title: 'Are you sure?', message: isOn() ? 'This cannot be undone. Team sync also stops on this device, so the team’s copy is left alone.' : 'This cannot be undone.', confirmText: 'Erase everything', danger: true }))) return;
        if (isOn()) await unpair();
        await eraseEverything();
        toast('All data erased');
      }, { kind: 'ghost danger-text', iconName: 'trash' }))));
}

function openNewSeason() {
  const current = activeSeason();
  let suggestion = seasonNameFor();
  if (state.seasons.some((s) => s.name === suggestion)) suggestion = `${suggestion} (2)`;
  const name = h('input', { class: 'input', value: suggestion, maxLength: 40 });
  let bringBack = current.roster.length > 0;
  openSheet({
    title: 'Start a new season', size: 'sm',
    body: h('div', null,
      h('label', { class: 'field-label' }, 'Season name', name),
      current.roster.length ? h('label', { class: 'check-row' },
        h('input', { type: 'checkbox', checked: true, onchange: (e) => { bringBack = e.target.checked; } }),
        h('span', null, `Bring back all ${current.roster.length} players from ${current.name}`)) : null,
      h('p', { class: 'p-help', style: { marginTop: '12px' } }, "Your playbook carries over automatically. Remove anyone who isn't returning from the Roster tab.")),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Start season', kind: 'primary', onClick: async () => {
          const season = newSeason(name.value.trim() || suggestion);
          if (bringBack) season.roster = structuredClone(current.roster);
          await saveSeason(season, { silent: true });
          await saveSettings({ activeSeasonId: season.id });
          toast(`${season.name} started`);
        },
      },
    ],
  });
}

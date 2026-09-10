// Home dashboard.

import { h, icon, iconBtn, btn, stars, promptDialog, initials } from '../ui.js';
import { state, subscribe, activeSeason, rosterFor, saveSettings } from '../store.js';
import { playThumb } from '../field.js';
import { saveBackup } from '../backup.js';
import { openNewPlaySheet } from './playbook.js';
import { openPlayerEditor, openPlayerCard } from './roster.js';
import { openHuddle } from './huddle.js';

export function mount(root) {
  const render = () => root.replaceChildren(build());
  render();
  const unsub = subscribe(render);
  return { destroy: unsub };
}

export function backupNeeded() {
  const s = state.settings;
  const hasOwnData = state.players.length > 0 || state.plays.some((p) => !p.starter || p.updatedAt > p.createdAt + 2000);
  if (!hasOwnData) return false;
  if (!s.lastBackupAt) return true;
  return (s.lastChangeAt || 0) > s.lastBackupAt && Date.now() - s.lastBackupAt > 7 * 864e5;
}

function build() {
  const s = state.settings;
  const season = activeSeason();
  const roster = rosterFor(season);
  const plays = state.plays;
  const W = s.fieldWidth;
  const topRated = plays.filter((p) => (p.rating || 0) > 0).sort((a, b) => b.rating - a.rating || b.updatedAt - a.updatedAt).slice(0, 5);
  const recent = plays.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
  const huddleAll = () => {
    const list = plays.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name));
    if (list.length) openHuddle(list.map((p) => p.id), 0);
  };

  const stat = (n, label) => h('div', { class: 'stat' }, h('b', null, n), h('span', null, label));
  const playRow = (p) => h('a', { class: 'list-row', href: `#/play/${p.id}` },
    h('div', { class: 'mini-thumb', html: playThumb(p, W) }),
    h('div', { class: 'lr-main' }, h('div', { class: 'lr-title' }, p.name), h('div', { class: 'lr-sub' }, p.formation)),
    stars(p.rating || 0, { size: 'sm' }));

  return h('div', { class: 'page home' },
    h('section', { class: 'hero' },
      h('div', { class: 'hero-main' },
        h('div', { class: 'eyebrow' }, season.name),
        h('h1', { class: 'hero-title' }, s.teamName,
          iconBtn('edit', async () => {
            const name = await promptDialog({ title: 'Team name', label: 'Team name', value: s.teamName });
            if (name) saveSettings({ teamName: name });
          }, { title: 'Rename team', cls: 'small' })),
        h('div', { class: 'hero-stats' },
          stat(roster.length, roster.length === 1 ? 'Player' : 'Players'),
          stat(plays.length, plays.length === 1 ? 'Play' : 'Plays'),
          stat(plays.filter((p) => (p.rating || 0) >= 4).length, 'Top rated'))),
      h('div', { class: 'hero-actions' },
        btn('New Play', openNewPlaySheet, { kind: 'primary', iconName: 'plus' }),
        btn('Add Player', () => openPlayerEditor(), { kind: 'ghost', iconName: 'users' }),
        btn('Huddle Mode', huddleAll, { kind: 'ghost', iconName: 'expand' }))),

    backupNeeded() ? h('div', { class: 'banner' },
      icon('shield'),
      h('div', { class: 'banner-text' },
        h('b', null, s.lastBackupAt ? `Last backup was ${Math.floor((Date.now() - s.lastBackupAt) / 864e5)} days ago` : "You haven't backed up yet"),
        h('span', null, 'Your plays and roster only live on this iPad. Save a copy to iCloud Drive.')),
      btn('Back up now', saveBackup, { kind: 'primary small' })) : null,

    h('div', { class: 'home-grid' },
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, 'Top rated plays'), h('a', { class: 'card-link', href: '#/playbook' }, 'Playbook')),
        topRated.length ? topRated.map(playRow) : h('p', { class: 'p-help' }, 'Rate plays with stars in the play editor (Details tab) and your best ones show up here.')),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, 'Recently edited')),
        recent.map(playRow)),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, `${season.name} roster`), h('a', { class: 'card-link', href: '#/roster' }, 'Manage')),
        roster.length
          ? h('div', { class: 'avatar-wrap' }, roster.map(({ player, entry }) =>
            h('button', { class: 'avatar-btn', onclick: () => openPlayerCard(player.id), title: player.first },
              player.photo ? h('img', { class: 'avatar', src: player.photo, alt: '' }) : h('span', { class: 'avatar' }, initials(player)),
              h('span', { class: 'avatar-label' }, entry.number ? `#${entry.number}` : player.first))))
          : h('div', null, h('p', { class: 'p-help' }, 'No players yet.'), btn('Add a player', () => openPlayerEditor(), { kind: 'small ghost', iconName: 'plus' }))),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, 'Quick tips')),
        h('ul', { class: 'tips' },
          h('li', null, icon('route'), h('span', null, 'In a play, tap a player, then tap the field to draw their route — or pick a preset like Slant or Post.')),
          h('li', null, icon('play'), h('span', null, 'Press play to watch it against a defense. Rings show who is open: green open, red covered.')),
          h('li', null, icon('bolt'), h('span', null, 'On the Ball tab, "Find best throw time" tries every timing and picks the one that works.')),
          h('li', null, icon('expand'), h('span', null, 'Huddle Mode shows plays full-screen for the team. Swipe to change plays.')),
          h('li', null, icon('wifiOff'), h('span', null, 'Works with no internet once added to your Home Screen. Back up often.'))))));
}

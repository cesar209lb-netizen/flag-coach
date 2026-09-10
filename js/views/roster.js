// Roster: player cards with photos, trading-card view, editor, returning players.

import { h, icon, iconBtn, btn, openSheet, confirmDialog, toast, initials } from '../ui.js';
import {
  state, subscribe, activeSeason, rosterFor, playerById, entryFor, savePlayer, deletePlayer, saveSeason, saveSettings,
} from '../store.js';
import { POSITIONS, RATINGS, JERSEY_SIZES, newPlayer, newRosterEntry, overall } from '../model.js';
import { pickImage, squarePhoto } from '../photo.js';

export function mount(root) {
  const render = () => root.replaceChildren(build());
  render();
  const unsub = subscribe(render);
  return { destroy: unsub };
}

function build() {
  const season = activeSeason();
  const roster = rosterFor(season);
  const returning = state.players.filter((p) => !season.roster.some((r) => r.playerId === p.id));
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', null, h('h1', null, 'Roster'), h('span', { class: 'count' }, `${season.name} · ${roster.length} player${roster.length === 1 ? '' : 's'}`)),
      h('div', { class: 'head-actions' },
        state.seasons.length > 1 ? h('select', {
          class: 'input select', 'aria-label': 'Season',
          onchange: (e) => saveSettings({ activeSeasonId: e.target.value }),
        }, state.seasons.map((s) => h('option', { value: s.id, selected: s.id === season.id }, s.name))) : null,
        returning.length ? btn('Returning players', openReturning, { kind: 'ghost', iconName: 'users' }) : null,
        btn('Add Player', () => openPlayerEditor(), { kind: 'primary', iconName: 'plus' }))),
    roster.length
      ? h('div', { class: 'roster-grid' }, roster.map(({ player, entry }) => playerCard(player, entry)))
      : h('div', { class: 'empty-state' },
        h('div', { class: 'empty-icon' }, icon('users')),
        h('h3', null, 'No players yet'),
        h('p', null, 'Add your players with a photo so they show up on the field in your plays.'),
        btn('Add your first player', () => openPlayerEditor(), { kind: 'primary', iconName: 'plus' })));
}

function playerCard(player, entry) {
  return h('button', { class: 'player-card', onclick: () => openPlayerCard(player.id) },
    h('div', { class: 'pc-photo' },
      player.photo ? h('img', { src: player.photo, alt: '' }) : h('span', { class: 'pc-initials' }, initials(player)),
      entry.number ? h('span', { class: 'pc-num' }, `#${entry.number}`) : null),
    h('div', { class: 'pc-info' },
      h('div', { class: 'pc-name' }, `${player.first} ${player.last}`.trim()),
      player.nickname ? h('div', { class: 'pc-nick' }, `"${player.nickname}"`) : null,
      h('div', { class: 'pc-pos' }, entry.positions.length
        ? entry.positions.map((p) => h('span', { class: 'tag' }, p))
        : h('span', { class: 'muted small' }, 'No positions yet'))),
    h('div', { class: 'pc-ovr' }, h('span', null, overall(entry.ratings)), h('small', null, 'OVR')),
    player.medical ? h('span', { class: 'pc-med', title: 'Has medical notes' }, icon('info')) : null);
}

function lastEntryFor(playerId) {
  for (let i = state.seasons.length - 1; i >= 0; i--) {
    const s = state.seasons[i];
    const e = s.roster.find((r) => r.playerId === playerId);
    if (e) return { season: s, entry: e };
  }
  return null;
}

// ---------- Trading card ----------

export function openPlayerCard(playerId) {
  const player = playerById(playerId);
  if (!player) return;
  const season = activeSeason();
  const entry = entryFor(playerId, season) || lastEntryFor(playerId)?.entry || newRosterEntry(playerId);
  const seasons = state.seasons.filter((s) => s.roster.some((r) => r.playerId === playerId)).map((s) => s.name);
  const info = [
    ['Nickname', player.nickname], ['Jersey size', entry.jerseySize], ['Seasons', seasons.join(', ')],
    ['Parent', player.parentName],
  ].filter(([, v]) => v);

  const card = h('div', { class: 'tcard', onclick: () => card.classList.toggle('flipped') },
    h('div', { class: 'tcard-inner' },
      h('div', { class: 'tcard-face tcard-front' },
        h('div', { class: 'tc-top' },
          h('div', { class: 'tc-ovr' }, h('b', null, overall(entry.ratings)), h('small', null, 'OVR')),
          h('div', { class: 'tc-num' }, entry.number ? `#${entry.number}` : '')),
        h('div', { class: 'tc-photo' }, player.photo ? h('img', { src: player.photo, alt: '' }) : initials(player)),
        h('div', { class: 'tc-name' }, player.first, h('b', null, player.last || ' ')),
        h('div', { class: 'tc-pos' }, entry.positions.join(' · ') || 'Player'),
        h('div', { class: 'tc-team' }, `${state.settings.teamName} · ${season.name}`)),
      h('div', { class: 'tcard-face tcard-back' },
        h('div', { class: 'tc-back-name' }, `${player.first} ${player.last}`.trim()),
        h('div', { class: 'tc-bars' }, RATINGS.map((r) => h('div', { class: 'tc-bar' },
          h('span', null, r.label),
          h('div', { class: 'bar' }, h('i', { style: { width: `${entry.ratings[r.key] * 20}%` } })),
          h('b', null, entry.ratings[r.key])))),
        info.length ? h('div', { class: 'tc-info' }, info.flatMap(([k, v]) => [h('span', null, k), h('span', null, v)])) : null,
        player.parentPhone ? h('a', { class: 'tc-phone', href: `tel:${player.parentPhone}`, onclick: (e) => e.stopPropagation() }, player.parentPhone) : null,
        player.medical ? h('div', { class: 'tc-medical' }, icon('info'), h('span', null, player.medical)) : null,
        player.notes ? h('div', { class: 'tc-notes' }, player.notes) : null)));

  openSheet({
    title: '', size: 'card',
    body: h('div', { class: 'tcard-wrap' }, card, h('p', { class: 'p-help center' }, 'Tap the card to flip it')),
    actions: [
      { label: 'Close', kind: 'ghost' },
      { label: 'Edit Player', kind: 'primary', onClick: () => { setTimeout(() => openPlayerEditor(playerId), 60); } },
    ],
  });
}

// ---------- Editor ----------

export function openPlayerEditor(playerId = null) {
  const season = activeSeason();
  const isNew = !playerId || !playerById(playerId);
  const player = isNew ? newPlayer() : structuredClone(playerById(playerId));
  const inSeason = !!entryFor(player.id, season);
  const entry = structuredClone(entryFor(player.id, season) || lastEntryFor(player.id)?.entry || newRosterEntry(player.id));
  entry.playerId = player.id;

  const text = (obj, key, props = {}) => {
    const el = h('input', { class: 'input', value: obj[key] || '', autocomplete: 'off', ...props });
    el.addEventListener('input', () => { obj[key] = el.value; });
    return el;
  };
  const area = (obj, key, placeholder) => {
    const el = h('textarea', { class: 'input', rows: 2, placeholder });
    el.value = obj[key] || '';
    el.addEventListener('input', () => { obj[key] = el.value; });
    return el;
  };

  const photoBox = h('div', { class: 'photo-box' });
  const renderPhoto = () => photoBox.replaceChildren(
    h('button', { class: 'photo-pick', onclick: choosePhoto, 'aria-label': 'Choose photo' },
      player.photo ? h('img', { src: player.photo, alt: '' }) : h('div', { class: 'photo-empty' }, icon('camera'), h('span', null, 'Add photo'))),
    player.photo
      ? h('div', { class: 'btn-row center' },
        btn('Change', choosePhoto, { kind: 'small ghost' }),
        btn('Remove', () => { player.photo = null; renderPhoto(); }, { kind: 'small ghost danger-text' }))
      : h('p', { class: 'p-help center' }, 'Take a photo or pick one from your library'));
  async function choosePhoto() {
    const file = await pickImage();
    if (!file) return;
    try {
      player.photo = await squarePhoto(file);
      renderPhoto();
    } catch {
      toast("Couldn't read that photo", { tone: 'bad' });
    }
  }
  renderPhoto();

  const first = text(player, 'first', { placeholder: 'First name' });
  const number = text(entry, 'number', { placeholder: '#', inputMode: 'numeric', maxLength: 3 });
  const jersey = h('select', { class: 'input select', onchange: (e) => { entry.jerseySize = e.target.value; } },
    h('option', { value: '' }, 'Size'), JERSEY_SIZES.map((s) => h('option', { value: s, selected: entry.jerseySize === s }, s)));

  const posWrap = h('div', { class: 'chip-grid' });
  const renderPos = () => posWrap.replaceChildren(...POSITIONS.map((p) => h('button', {
    class: `chip-btn ${entry.positions.includes(p) ? 'on' : ''}`,
    onclick: () => { entry.positions = entry.positions.includes(p) ? entry.positions.filter((x) => x !== p) : [...entry.positions, p]; renderPos(); },
  }, p)));
  renderPos();

  const ovrEl = h('span', { class: 'ovr-val' }, overall(entry.ratings));
  const ratingRow = (r) => {
    const row = h('div', { class: 'rating-row' });
    const render = () => row.replaceChildren(
      h('span', { class: 'rating-label' }, r.label),
      h('div', { class: 'rating-pips' }, [1, 2, 3, 4, 5].map((v) => h('button', {
        class: `pip ${v <= entry.ratings[r.key] ? 'on' : ''}`, 'aria-label': `${r.label} ${v}`,
        onclick: () => { entry.ratings[r.key] = v; render(); ovrEl.textContent = overall(entry.ratings); },
      }, v))));
    render();
    return row;
  };

  const sheet = openSheet({
    title: isNew ? 'Add Player' : `Edit ${player.first}`, size: 'lg',
    body: h('div', null,
      h('div', { class: 'pe-grid' },
        photoBox,
        h('div', null,
          h('div', { class: 'form-row' },
            h('label', { class: 'field-label' }, 'First name', first),
            h('label', { class: 'field-label' }, 'Last name', text(player, 'last', { placeholder: 'Last name' }))),
          h('div', { class: 'form-row three' },
            h('label', { class: 'field-label' }, 'Nickname', text(player, 'nickname', { placeholder: 'Optional' })),
            h('label', { class: 'field-label' }, 'Jersey #', number),
            h('label', { class: 'field-label' }, 'Jersey size', jersey)),
          h('div', { class: 'field-label' }, 'Positions'), posWrap)),
      h('div', { class: 'pe-section-title' }, 'Ratings ', h('span', { class: 'ovr-chip' }, 'OVR ', ovrEl)),
      h('div', { class: 'ratings-grid' }, RATINGS.map(ratingRow)),
      h('div', { class: 'pe-section-title' }, 'Family & health'),
      h('div', { class: 'form-row' },
        h('label', { class: 'field-label' }, 'Parent / guardian', text(player, 'parentName', { placeholder: 'Name' })),
        h('label', { class: 'field-label' }, 'Parent phone', text(player, 'parentPhone', { placeholder: 'Phone', type: 'tel' }))),
      h('label', { class: 'field-label' }, 'Medical notes (allergies, inhaler, etc.)', area(player, 'medical', 'Only visible on this device')),
      h('label', { class: 'field-label' }, 'Coach notes', area(player, 'notes', 'Strengths, things to work on…')),
      !isNew ? h('div', { class: 'danger-zone' },
        inSeason ? btn(`Remove from ${season.name}`, async () => {
          if (!(await confirmDialog({ title: `Remove ${player.first}?`, message: `They'll be taken off the ${season.name} roster but kept in your records for other seasons.`, confirmText: 'Remove' }))) return;
          season.roster = season.roster.filter((r) => r.playerId !== player.id);
          await saveSeason(season);
          sheet.close();
          toast(`${player.first} removed from ${season.name}`);
        }, { kind: 'ghost' }) : null,
        btn('Delete player forever', async () => {
          if (!(await confirmDialog({ title: `Delete ${player.first}?`, message: 'This removes them from every season and deletes their photo. This cannot be undone.', confirmText: 'Delete forever', danger: true }))) return;
          await deletePlayer(player.id);
          sheet.close();
          toast('Player deleted');
        }, { kind: 'ghost danger-text' })) : null),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: isNew ? 'Add Player' : 'Save', kind: 'primary', onClick: async () => {
          player.first = (player.first || '').trim();
          player.last = (player.last || '').trim();
          if (!player.first) { toast('Add a first name', { tone: 'bad' }); first.focus(); return false; }
          entry.number = String(entry.number || '').replace(/[^\d]/g, '');
          await savePlayer(player, { silent: true });
          const i = season.roster.findIndex((r) => r.playerId === player.id);
          if (i >= 0) season.roster[i] = entry; else season.roster.push(entry);
          await saveSeason(season);
          toast(isNew ? `${player.first} added to the roster` : 'Player saved');
        },
      },
    ],
  });
  if (isNew) setTimeout(() => first.focus(), 300);
}

// ---------- Returning players ----------

function openReturning() {
  const season = activeSeason();
  const candidates = state.players.filter((p) => !season.roster.some((r) => r.playerId === p.id))
    .sort((a, b) => a.first.localeCompare(b.first));
  const chosen = new Set();
  openSheet({
    title: `Add to ${season.name}`,
    body: h('div', null,
      h('p', { class: 'p-help' }, 'Players from past seasons. Their number, positions and ratings come with them.'),
      h('div', { class: 'check-list' }, candidates.map((p) => {
        const last = lastEntryFor(p.id);
        return h('label', { class: 'check-row' },
          h('input', { type: 'checkbox', onchange: (e) => (e.target.checked ? chosen.add(p.id) : chosen.delete(p.id)) }),
          p.photo ? h('img', { class: 'mini-av', src: p.photo, alt: '' }) : h('span', { class: 'mini-av' }, initials(p)),
          h('span', { class: 'grow' }, `${p.first} ${p.last}`.trim()),
          last ? h('span', { class: 'muted small' }, last.season.name) : null);
      }))),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Add to roster', kind: 'primary', onClick: async () => {
          for (const id of chosen) {
            const last = lastEntryFor(id);
            season.roster.push(last ? structuredClone(last.entry) : newRosterEntry(id));
          }
          await saveSeason(season);
          if (chosen.size) toast(`${chosen.size} player${chosen.size === 1 ? '' : 's'} added`);
        },
      },
    ],
  });
}

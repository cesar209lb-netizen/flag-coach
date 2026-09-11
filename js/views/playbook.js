// Playbook grid: search, filter by tag, sort, create, duplicate, delete.

import { h, icon, iconBtn, btn, stars, openSheet, actionSheet, confirmDialog, toast, segmented } from '../ui.js';
import { state, subscribe, savePlay, deletePlay } from '../store.js';
import { FORMATIONS, newPlay, copyPlay, flipPlay, playStats } from '../model.js';
import { playThumb } from '../field.js';
import { openHuddle } from './huddle.js';
import { isViewer } from '../sync.js';

let query = '';
let tagFilter = 'All';
let sort = 'recent';

export function mount(root) {
  const gridEl = h('div', { class: 'play-grid' });
  const chipsEl = h('div', { class: 'filter-chips' });
  const countEl = h('span', { class: 'count' });
  const search = h('input', { class: 'input search', type: 'search', placeholder: 'Search plays, formations, tags', value: query });
  search.addEventListener('input', () => { query = search.value; renderGrid(); });
  const sortWrap = h('div');

  root.append(h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', null, h('h1', null, 'Playbook'), countEl),
      h('div', { class: 'head-actions' },
        btn(isViewer() ? 'Watch all' : 'Huddle', () => { const l = filtered(); if (l.length) openHuddle(l.map((p) => p.id), 0); },
          { iconName: 'expand', kind: isViewer() ? 'primary' : 'ghost' }),
        isViewer() ? null : btn('Call sheet', () => { location.hash = '#/callsheet'; }, { iconName: 'download', kind: 'ghost' }),
        isViewer() ? null : btn('New Play', openNewPlaySheet, { iconName: 'plus', kind: 'primary' }))),
    h('div', { class: 'toolbar' }, h('div', { class: 'search-wrap' }, icon('search'), search), sortWrap),
    chipsEl, gridEl));

  function renderSort() {
    sortWrap.replaceChildren(segmented([
      { value: 'recent', label: 'Recent' }, { value: 'name', label: 'A–Z' }, { value: 'rating', label: 'Rating' },
    ], sort, (v) => { sort = v; renderSort(); renderGrid(); }, { cls: 'small' }));
  }

  function renderChips() {
    const used = new Set(state.plays.flatMap((p) => p.tags));
    const tags = ['All', 'Top Rated', ...state.settings.tags.filter((t) => used.has(t))];
    if (!tags.includes(tagFilter)) tagFilter = 'All';
    chipsEl.replaceChildren(...tags.map((t) =>
      h('button', { class: `chip-btn ${tagFilter === t ? 'on' : ''}`, onclick: () => { tagFilter = t; renderChips(); renderGrid(); } },
        t === 'Top Rated' ? '★ Top Rated' : t)));
  }

  function filtered() {
    const q = query.trim().toLowerCase();
    let list = state.plays.slice();
    if (q) list = list.filter((p) => `${p.name} ${p.formation} ${p.tags.join(' ')} ${p.notes || ''}`.toLowerCase().includes(q));
    if (tagFilter === 'Top Rated') list = list.filter((p) => (p.rating || 0) >= 4);
    else if (tagFilter !== 'All') list = list.filter((p) => p.tags.includes(tagFilter));
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'rating') list.sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name));
    else list.sort((a, b) => b.updatedAt - a.updatedAt);
    return list;
  }

  function renderGrid() {
    const list = filtered();
    const W = state.settings.fieldWidth;
    countEl.textContent = `${state.plays.length} play${state.plays.length === 1 ? '' : 's'}`;
    if (!list.length) {
      gridEl.replaceChildren(h('div', { class: 'empty-state' },
        h('div', { class: 'empty-icon' }, icon('playbook')),
        h('h3', null, state.plays.length ? 'No plays match' : isViewer() ? 'No plays yet' : 'Your playbook is empty'),
        state.plays.length ? h('p', null, 'Try a different search or tag.')
          : isViewer() ? h('p', null, 'Your coach has not added any plays yet. They will show up here on their own.')
            : btn('Create your first play', openNewPlaySheet, { kind: 'primary', iconName: 'plus' })));
      return;
    }
    const ids = list.map((p) => p.id);
    const viewer = isViewer();
    gridEl.replaceChildren(...list.map((p, i) => {
      const info = [
        h('div', { class: 'thumb-wrap', html: playThumb(p, W) }),
        h('div', { class: 'play-card-info' },
          h('div', { class: 'play-name' }, p.name),
          h('div', { class: 'play-meta' }, p.formation || ''),
          (() => {
            // What the play actually did in games, next to what it is rated.
            const st = playStats(state.games, p.id);
            return st ? h('div', { class: 'play-real' }, `${st.calls} called · ${st.avg} avg${st.tds ? ` · ${st.tds} TD` : ''}`) : null;
          })(),
          h('div', { class: 'play-card-row' },
            stars(p.rating || 0, { size: 'sm' }),
            p.tags.length ? h('div', { class: 'tag-list' }, p.tags.slice(0, 2).map((t) => h('span', { class: 'tag' }, t))) : null)),
      ];
      // A player taps a card to watch it; a coach taps it to edit it.
      const main = viewer
        ? h('button', { class: 'play-card-main', onclick: () => openHuddle(ids, i), title: `Watch ${p.name}` }, ...info)
        : h('a', { class: 'play-card-main', href: `#/play/${p.id}` }, ...info);
      return h('article', { class: 'play-card' }, main,
        h('div', { class: 'play-card-actions' },
          iconBtn('expand', () => openHuddle(ids, i), { title: viewer ? 'Watch' : 'Huddle mode', cls: 'small' }),
          viewer ? null : iconBtn('more', () => cardMenu(p), { title: 'More', cls: 'small' })));
    }));
  }

  function render() { renderSort(); renderChips(); renderGrid(); }
  render();
  const unsub = subscribe(render);
  return { destroy: unsub };
}

function cardMenu(p) {
  const W = state.settings.fieldWidth;
  actionSheet({
    title: p.name,
    items: [
      { label: 'Open', icon: 'edit', onClick: () => { location.hash = `#/play/${p.id}`; } },
      { label: 'Duplicate', icon: 'copy', onClick: async () => { await savePlay(copyPlay(p)); toast('Play duplicated'); } },
      {
        label: 'Make a flipped copy', icon: 'flip', onClick: async () => {
          const c = copyPlay(p, '');
          flipPlay(c, W);
          if (c.name === p.name) c.name += ' (flipped)';
          await savePlay(c);
          toast('Flipped copy created');
        },
      },
      {
        label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
          if (await confirmDialog({ title: 'Delete play?', message: `"${p.name}" will be removed.`, confirmText: 'Delete', danger: true })) {
            await deletePlay(p.id);
            toast('Play deleted');
          }
        },
      },
    ],
  });
}

export function openNewPlaySheet() {
  const W = state.settings.fieldWidth;
  let formationId = 'spread';
  const name = h('input', { class: 'input', placeholder: 'e.g. Red Zone Slants', maxLength: 40 });
  const grid = h('div', { class: 'formation-grid' });
  const renderFormations = () => grid.replaceChildren(...FORMATIONS.map((f) => {
    const sample = newPlay({ formationId: f.id, W });
    return h('button', { class: `formation-card ${f.id === formationId ? 'on' : ''}`, onclick: () => { formationId = f.id; renderFormations(); } },
      h('div', { class: 'thumb-wrap', html: playThumb(sample, W) }),
      h('div', { class: 'formation-name' }, f.name),
      h('div', { class: 'formation-desc' }, f.desc));
  }));
  renderFormations();
  openSheet({
    title: 'New Play', size: 'lg',
    body: h('div', null,
      h('label', { class: 'field-label' }, 'Play name', name),
      h('div', { class: 'field-label' }, 'Starting formation'),
      grid),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Create Play', kind: 'primary', onClick: async () => {
          const play = newPlay({ name: name.value.trim() || 'New Play', formationId, W });
          await savePlay(play, { silent: true });
          location.hash = `#/play/${play.id}`;
        },
      },
    ],
  });
}

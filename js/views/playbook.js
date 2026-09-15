// Playbook: pick a formation first, then the plays that run out of it.
// Inside a formation: search, filter by pass/run and tag, sort, create,
// duplicate, delete.

import { h, icon, iconBtn, btn, stars, openSheet, actionSheet, confirmDialog, toast, segmented } from '../ui.js';
import { state, subscribe, savePlay, deletePlay } from '../store.js';
import {
  FORMATIONS, newPlay, copyPlay, flipPlay, playStats,
  formationKey, formationInfo, formationSample, isPassPlay, passRunCount,
} from '../model.js';
import { playThumb } from '../field.js';
import { openHuddle } from './huddle.js';
import { isViewer } from '../sync.js';
import { defenseGrid } from './defense.js';

let query = '';
let tagFilter = 'All';
let kindFilter = 'all';
let sort = 'recent';

// Offence and defence are both the playbook; a toggle switches which one you
// are looking at rather than spending another tab on it.
let book = 'offense';

// Which formation's plays are open. null is the formation picker — the screen
// you land on — and ALL is the everything-at-once list. No formation is named
// like the sentinel, so it can never collide with a real group.
const ALL = '\\all';
let formation = null;

export function mount(root) {
  const listEl = h('div');
  const chipsEl = h('div', { class: 'filter-chips' });
  const countEl = h('span', { class: 'count' });
  const crumbEl = h('div', { class: 'crumb-row' });
  const titleEl = h('h1', null, 'Playbook');
  const search = h('input', { class: 'input search', type: 'search', placeholder: 'Search plays, formations, tags', value: query });
  search.addEventListener('input', () => { query = search.value; renderBody(); });
  const filterWrap = h('div', { class: 'filter-row' });
  const searchWrap = h('div', { class: 'search-wrap' }, icon('search'), search);
  const toolbar = h('div', { class: 'toolbar' }, searchWrap, filterWrap);

  const pickEl = h('div', { class: 'formation-pick' });
  const playsEl = h('div', null, chipsEl, listEl);
  // The toolbar never moves, so typing in the search box never loses focus
  // when the screen under it is swapped out.
  const offenseBody = h('div');
  const offenseEl = h('div', null, toolbar, offenseBody);

  const actionsEl = h('div', { class: 'head-actions' });
  const bookWrap = isViewer() ? null : h('div', { class: 'book-toggle' });
  const defense = isViewer() ? null : defenseGrid();
  const bodyEl = h('div', null, offenseEl);

  root.append(h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', null, crumbEl, titleEl, countEl),
      actionsEl),
    bookWrap, bodyEl));

  function openFormation(name) {
    formation = name;
    tagFilter = 'All';
    kindFilter = 'all';
    query = '';
    search.value = '';
    render();
  }
  function backToFormations() {
    formation = null;
    query = '';
    search.value = '';
    render();
  }

  function renderBook() {
    if (!bookWrap) return;
    bookWrap.replaceChildren(segmented(
      [{ value: 'offense', label: 'Offense' }, { value: 'defense', label: 'Defense' }], book,
      (v) => { book = v; render(); }, { cls: 'small' }));
    const want = book === 'defense' ? defense.el : offenseEl;
    if (bodyEl.firstElementChild !== want) bodyEl.replaceChildren(want);
  }

  function renderActions() {
    if (book === 'defense') {
      actionsEl.replaceChildren(btn('New defense', () => defense.newCall(), { iconName: 'plus', kind: 'primary' }));
      return;
    }
    actionsEl.replaceChildren(...[
      btn(isViewer() ? 'Watch all' : 'Huddle', () => { const l = filtered(); if (l.length) openHuddle(l.map((p) => p.id), 0); },
        { iconName: 'expand', kind: isViewer() ? 'primary' : 'ghost' }),
      isViewer() ? null : btn('Call sheet', () => { location.hash = '#/callsheet'; }, { iconName: 'download', kind: 'ghost' }),
      isViewer() ? null : btn('New Play', () => openNewPlaySheet(currentFormationId()), { iconName: 'plus', kind: 'primary' }),
    ].filter(Boolean));
  }

  const inFormation = () => formation !== null && formation !== ALL;
  const currentFormationId = () => (inFormation() ? formationInfo(formation).id : null);

  // ---------- Formation picker ----------

  // The formations this playbook actually runs, with their plays and how those
  // split between pass and run. A formation with nothing in it is not a card —
  // the picker is what the team has, and the New Play sheet is where the rest
  // of the formations live. Ordered by how many plays each holds, so the
  // formation the team lives in lands top left; ties keep the order the model
  // lists formations in, with a mirrored variant ("Trips Left") right after the
  // formation it mirrors and custom last.
  function groups() {
    const byName = new Map();
    for (const p of state.plays) {
      const k = formationKey(p);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(p);
    }
    const out = [];
    const take = (name) => {
      const plays = byName.get(name);
      if (!plays) return;
      byName.delete(name);
      out.push({ name, plays, ...passRunCount(plays), ...formationInfo(name) });
    };
    for (const f of FORMATIONS) {
      take(f.name);
      const mirrored = [...byName.keys()].find((n) => formationInfo(n).id === f.id);
      if (mirrored) take(mirrored);
    }
    for (const name of [...byName.keys()].sort()) take(name);
    return out.map((g, i) => ({ ...g, order: i })).sort((a, b) => b.total - a.total || a.order - b.order);
  }

  function formationCard(g, W) {
    // A formation the app knows is drawn from the model so the card shows the
    // alignment itself; a custom one borrows the picture from one of its plays.
    const sample = g.id ? formationSample(g.name, W) : g.plays[0];
    return h('button', { class: 'formation-card pick', onclick: () => openFormation(g.name) },
      h('div', { class: 'thumb-wrap', html: sample ? playThumb(sample, W) : '' }),
      h('div', { class: 'formation-body' },
        h('div', { class: 'formation-name' }, g.name),
        h('div', { class: 'formation-desc' }, g.desc),
        h('div', { class: 'formation-counts' },
          h('span', { class: 'fc-pill pass' }, `${g.pass} pass`),
          h('span', { class: 'fc-pill run' }, `${g.run} run`))));
  }

  function renderPicker() {
    const W = state.settings.fieldWidth;
    const list = groups();
    pickEl.replaceChildren(list.length
      ? h('div', { class: 'formation-grid pick' }, ...list.map((g) => formationCard(g, W)))
      : h('div', { class: 'empty-state' },
        h('div', { class: 'empty-icon' }, icon('playbook')),
        h('h3', null, isViewer() ? 'No plays yet' : 'Your playbook is empty'),
        isViewer() ? h('p', null, 'Your coach has not added any plays yet. They will show up here on their own.')
          : h('p', null, 'Every formation you draw a play out of shows up here.'),
        isViewer() ? null : btn('Create your first play', () => openNewPlaySheet(), { kind: 'primary', iconName: 'plus' })));
  }

  // ---------- Plays in a formation ----------

  function scoped() {
    return inFormation() ? state.plays.filter((p) => formationKey(p) === formation) : state.plays.slice();
  }

  function filtered() {
    const q = query.trim().toLowerCase();
    let list = scoped();
    if (q) list = list.filter((p) => `${p.name} ${p.formation} ${p.tags.join(' ')} ${p.notes || ''}`.toLowerCase().includes(q));
    if (kindFilter !== 'all') list = list.filter((p) => (isPassPlay(p) ? 'pass' : 'run') === kindFilter);
    if (tagFilter === 'Top Rated') list = list.filter((p) => (p.rating || 0) >= 4);
    else if (tagFilter !== 'All') list = list.filter((p) => p.tags.includes(tagFilter));
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'rating') list.sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name));
    else list.sort((a, b) => b.updatedAt - a.updatedAt);
    return list;
  }

  function renderFilters() {
    if (picking()) {
      const n = state.plays.length;
      filterWrap.replaceChildren(...(n
        ? [btn(`All ${n} play${n === 1 ? '' : 's'}`, () => openFormation(ALL), { iconName: 'playbook', kind: 'ghost' })]
        : []));
      return;
    }
    const c = passRunCount(scoped());
    filterWrap.replaceChildren(
      segmented([
        { value: 'all', label: `All ${c.total}` }, { value: 'pass', label: `Pass ${c.pass}` }, { value: 'run', label: `Run ${c.run}` },
      ], kindFilter, (v) => { kindFilter = v; renderFilters(); renderGrid(); }, { cls: 'small' }),
      segmented([
        { value: 'recent', label: 'Recent' }, { value: 'name', label: 'A–Z' }, { value: 'rating', label: 'Rating' },
      ], sort, (v) => { sort = v; renderFilters(); renderGrid(); }, { cls: 'small' }));
  }

  function renderChips() {
    const used = new Set(scoped().flatMap((p) => p.tags));
    const tags = ['All', 'Top Rated', ...state.settings.tags.filter((t) => used.has(t))];
    if (!tags.includes(tagFilter)) tagFilter = 'All';
    chipsEl.replaceChildren(...tags.map((t) =>
      h('button', { class: `chip-btn ${tagFilter === t ? 'on' : ''}`, onclick: () => { tagFilter = t; renderChips(); renderGrid(); } },
        t === 'Top Rated' ? '★ Top Rated' : t)));
  }

  function renderGrid() {
    const list = filtered();
    const W = state.settings.fieldWidth;
    const one = inFormation();
    if (!list.length) {
      listEl.replaceChildren(h('div', { class: 'empty-state' },
        h('div', { class: 'empty-icon' }, icon('playbook')),
        h('h3', null, scoped().length ? 'No plays match'
          : one ? `No plays out of ${formation} yet`
            : isViewer() ? 'No plays yet' : 'Your playbook is empty'),
        scoped().length ? h('p', null, 'Try a different search, tag or filter.')
          : isViewer() ? h('p', null, 'Your coach has not added any plays yet. They will show up here on their own.')
            : btn(one ? `New ${formation} play` : 'Create your first play',
              () => openNewPlaySheet(currentFormationId()), { kind: 'primary', iconName: 'plus' })));
      return;
    }
    // Passes and runs are two different conversations in a huddle, so inside a
    // formation they get their own labelled block rather than being mixed
    // together. Filtering to one kind already says which it is, so that view
    // stays a single grid.
    const split = kindFilter === 'all';
    const passes = split ? list.filter(isPassPlay) : [];
    const runs = split ? list.filter((p) => !isPassPlay(p)) : [];
    // Huddle mode walks whatever order is on screen, so the ids follow the
    // blocks rather than the unsplit list.
    const ordered = split ? [...passes, ...runs] : list;
    const ids = ordered.map((p) => p.id);
    const viewer = isViewer();
    const card = (p, i) => {
      const pass = isPassPlay(p);
      const info = [
        h('div', { class: 'thumb-wrap', html: playThumb(p, W) }),
        h('div', { class: 'play-card-info' },
          h('div', { class: 'play-name' }, p.name),
          h('div', { class: 'play-meta' },
            h('span', { class: `kind-tag ${pass ? 'pass' : 'run'}` }, pass ? 'Pass' : 'Run'),
            one ? null : h('span', null, p.formation || '')),
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
    };

    if (!split) {
      listEl.replaceChildren(h('div', { class: 'play-grid' }, ...list.map(card)));
      return;
    }
    let n = 0;
    const block = (label, plays) => (plays.length
      ? h('div', { class: 'play-section' },
        h('div', { class: 'section-label' }, `${label} · ${plays.length}`),
        h('div', { class: 'play-grid' }, ...plays.map((p) => card(p, n++))))
      : null);
    listEl.replaceChildren(...[block('Pass plays', passes), block('Run plays', runs)].filter(Boolean));
  }

  // The head reads differently on the picker (how big is the playbook) and
  // inside a formation (what is in this one).
  function renderHead() {
    if (book === 'defense') {
      crumbEl.replaceChildren();
      titleEl.textContent = 'Playbook';
      countEl.textContent = `${state.defplays.length} defensive call${state.defplays.length === 1 ? '' : 's'}`;
      return;
    }
    if (picking()) {
      const n = groups().length;
      crumbEl.replaceChildren();
      titleEl.textContent = 'Playbook';
      countEl.textContent = state.plays.length
        ? `${state.plays.length} play${state.plays.length === 1 ? '' : 's'} in ${n} formation${n === 1 ? '' : 's'} — pick one to see its plays`
        : 'No plays yet';
      return;
    }
    crumbEl.replaceChildren(h('button', { class: 'crumb', onclick: backToFormations }, icon('back'), 'All formations'));
    const c = passRunCount(scoped());
    titleEl.textContent = inFormation() ? formation : 'All plays';
    countEl.textContent = `${c.total} play${c.total === 1 ? '' : 's'} · ${c.pass} pass · ${c.run} run`;
  }

  // The picker is the landing screen, but a search jumps straight past it to
  // the matching plays so nobody has to guess which formation a play is in.
  const picking = () => formation === null && !query.trim();

  function renderBody() {
    search.placeholder = inFormation() ? `Search ${formation} plays` : 'Search all plays, formations, tags';
    const screen = picking() ? pickEl : playsEl;
    if (offenseBody.firstElementChild !== screen) offenseBody.replaceChildren(screen);
    renderHead();
    renderFilters();
    if (picking()) { renderPicker(); return; }
    renderChips();
    renderGrid();
  }

  function render() {
    renderBook();
    renderActions();
    if (book === 'offense') renderBody(); else renderHead();
  }
  // A formation that emptied out while you were away — a play flipped onto its
  // mirror, deleted, or pulled by a sync — would otherwise leave you looking at
  // an empty grid wondering where the plays went. Start at the picker instead.
  if (inFormation() && !state.plays.some((pl) => formationKey(pl) === formation)) formation = null;
  render();
  const unsub = subscribe(render);
  return { destroy: () => { unsub(); defense?.destroy(); } };
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

// `preferred` is the formation id to start on — the one the coach is already
// looking at. It is also wired straight to click handlers elsewhere, so
// anything that is not a known id (an Event, null) falls back to Spread.
export function openNewPlaySheet(preferred) {
  const W = state.settings.fieldWidth;
  let formationId = FORMATIONS.find((f) => f.id === preferred)?.id || 'spread';
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

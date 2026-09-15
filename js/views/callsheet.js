// Printable call sheet: pick the plays you are carrying, number them, print.
//
// Two shapes, because coaches use two things. The sheet is the laminated page
// on the sideline — diagrams, names, notes. The wristband is the strip in the
// plastic window on a quarterback's arm: numbers and names, no pictures, small
// enough to fit. Both print from Safari's Share → Print, and both screenshot.

import { h, iconBtn, btn, segmented, toast } from '../ui.js';
import { state, subscribe } from '../store.js';
import { playThumb } from '../field.js';
import { defThumb } from './defense.js';
import { defJobLabel } from '../model.js';
import { playbookHash } from './playbook.js';

let mode = 'sheet';
let cols = 3;
let showNotes = true;
let tagFilter = 'All';
let withDefense = true;
// Which plays are on the sheet. Null means "everything that matches the tag",
// so a coach who never touches the checkboxes still gets a usable sheet.
let chosen = null;

// Controls change how the sheet is laid out, not what is in the store, so the
// view re-renders itself rather than going through a save.
let rerenderFn = null;
const rerender = () => rerenderFn?.();

export function mount(root) {
  const render = () => root.replaceChildren(build());
  rerenderFn = render;
  render();
  const unsub = subscribe(render);
  return { destroy: () => { rerenderFn = null; unsub(); } };
}

const matchesTag = (p) => (tagFilter === 'All' ? true
  : tagFilter === 'Top Rated' ? (p.rating || 0) >= 4
    : p.tags.includes(tagFilter));

function selected() {
  const inTag = state.plays.filter(matchesTag);
  return chosen ? inTag.filter((p) => chosen.has(p.id)) : inTag;
}

function build() {
  const W = state.settings.fieldWidth;
  const list = selected();
  const season = state.seasons.find((s) => s.id === state.settings.activeSeasonId);

  const top = h('div', { class: 'cs-top' },
    iconBtn('back', () => { location.hash = playbookHash(); }, { title: 'Back to playbook' }),
    h('div', { class: 'cs-title' }, h('h1', null, 'Call sheet'),
      h('span', { class: 'muted small' }, `${list.length} play${list.length === 1 ? '' : 's'}`)),
    h('div', { class: 'spacer' }),
    btn('Print', () => {
      if (!list.length) { toast('Pick at least one play first', { tone: 'bad' }); return; }
      window.print();
    }, { iconName: 'download', kind: 'primary' }));

  const controls = h('div', { class: 'cs-controls' },
    h('div', { class: 'cs-ctl' }, h('span', { class: 'field-label' }, 'Shape'),
      segmented([{ value: 'sheet', label: 'Sheet' }, { value: 'band', label: 'Wristband' }], mode,
        (v) => { mode = v; rerender(); }, { cls: 'small' })),
    mode === 'sheet' ? h('div', { class: 'cs-ctl' }, h('span', { class: 'field-label' }, 'Across'),
      segmented([{ value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }], cols,
        (v) => { cols = v; rerender(); }, { cls: 'small' })) : null,
    mode === 'sheet' ? h('div', { class: 'cs-ctl' }, h('span', { class: 'field-label' }, 'Notes'),
      segmented([{ value: true, label: 'Show' }, { value: false, label: 'Hide' }], showNotes,
        (v) => { showNotes = v; rerender(); }, { cls: 'small' })) : null,
    state.defplays.length ? h('div', { class: 'cs-ctl' }, h('span', { class: 'field-label' }, 'Defense'),
      segmented([{ value: true, label: 'Include' }, { value: false, label: 'Leave off' }], withDefense,
        (v) => { withDefense = v; rerender(); }, { cls: 'small' })) : null);

  // Tag chips narrow the pool; the checkboxes below trim it by hand.
  const used = new Set(state.plays.flatMap((p) => p.tags));
  const tags = ['All', 'Top Rated', ...state.settings.tags.filter((t) => used.has(t))];
  const chips = h('div', { class: 'filter-chips' }, ...tags.map((t) => h('button', {
    class: `chip ${tagFilter === t ? 'on' : ''}`,
    onclick: () => { tagFilter = t; chosen = null; rerender(); },
  }, t)));

  const pool = state.plays.filter(matchesTag);
  const picker = h('details', { class: 'cs-picker' },
    h('summary', null, `Choose plays (${list.length} of ${pool.length})`),
    h('div', { class: 'btn-row tight pad' },
      btn('All', () => { chosen = null; rerender(); }, { kind: 'small ghost' }),
      btn('None', () => { chosen = new Set(); rerender(); }, { kind: 'small ghost' })),
    h('div', { class: 'check-list' }, ...pool.map((p) => {
      const on = !chosen || chosen.has(p.id);
      return h('label', { class: 'check-row' },
        h('input', {
          type: 'checkbox',
          checked: on,
          onchange: (e) => {
            if (!chosen) chosen = new Set(pool.map((q) => q.id));
            if (e.target.checked) chosen.add(p.id); else chosen.delete(p.id);
            rerender();
          },
        }),
        h('span', { class: 'grow' }, p.name),
        h('span', { class: 'muted small' }, p.formation || ''));
    })));

  const header = h('div', { class: 'cs-head' },
    h('div', null, h('b', null, state.settings.teamName || 'My Team'),
      season ? h('span', { class: 'muted small' }, ` · ${season.name}`) : null),
    h('div', { class: 'muted small' }, new Date().toLocaleDateString()));

  const page = h('div', { class: `cs-page ${mode}`, style: mode === 'sheet' ? { '--cs-cols': String(cols) } : null },
    header,
    list.length
      ? (mode === 'sheet'
        ? h('div', { class: 'cs-grid' }, ...list.map((p, i) => h('div', { class: 'cs-item' },
          h('div', { class: 'cs-item-head' },
            h('span', { class: 'cs-num' }, String(i + 1)),
            h('span', { class: 'cs-name' }, p.name)),
          h('div', { class: 'cs-thumb', html: playThumb(p, W, state.settings.rushDistance, { paper: true }) }),
          h('div', { class: 'cs-meta' }, [p.formation, ...p.tags].filter(Boolean).join(' · ')),
          showNotes && p.notes ? h('div', { class: 'cs-note' }, p.notes) : null)))
        : h('ol', { class: 'cs-band' }, ...list.map((p) => h('li', null,
          h('span', { class: 'cs-name' }, p.name),
          h('span', { class: 'cs-meta' }, p.formation || '')))))
      : h('p', { class: 'p-help' }, 'No plays chosen yet.'),
    withDefense && state.defplays.length
      ? h('div', { class: 'cs-def' },
        h('div', { class: 'cs-sub' }, 'Defense'),
        mode === 'sheet'
          ? h('div', { class: 'cs-grid' }, ...state.defplays.map((d, i) => h('div', { class: 'cs-item' },
            h('div', { class: 'cs-item-head' },
              h('span', { class: 'cs-num def' }, `D${i + 1}`),
              h('span', { class: 'cs-name' }, d.name)),
            h('div', { class: 'cs-thumb', html: defThumb(d, W, { paper: true }) }),
            h('div', { class: 'cs-meta' }, d.defenders.map((x) => `${x.label}: ${defJobLabel(x)}`).join(' · ')))))
          : h('ol', { class: 'cs-band' }, ...state.defplays.map((d) => h('li', null,
            h('span', { class: 'cs-name' }, d.name),
            h('span', { class: 'cs-meta' }, d.defenders.map((x) => x.label).join(' · '))))))
      : null);

  return h('div', { class: 'page callsheet' }, top, controls, chips, picker, page);
}

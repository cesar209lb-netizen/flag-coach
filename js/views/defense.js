// Defensive playbook: the defence this team actually runs.
//
// The coverages in the play designer are opponents the simulator invents to
// test an offensive play against. This is the other half of coaching — the call
// you make on defence and teach to five kids, with a job written on every
// defender. Drag them where they line up, tell each one what they are doing,
// and show the picture to the team.

import { h, icon, iconBtn, btn, segmented, openSheet, confirmDialog, promptDialog, toast } from '../ui.js';
import { state, subscribe, saveDefPlay, deleteDefPlay, defPlayById } from '../store.js';
import { newDefPlay, ghostOffense, defJobLabel, DEF_JOBS, FORMATIONS, SLOTS, uid } from '../model.js';
import { EDIT_VIEW, THUMB_VIEW, viewBox, fieldMarkup, tokenMarkup, defenseMarkup } from '../field.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const f2 = (n) => Math.round(n * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const COVER_SLOTS = SLOTS.filter((s) => s !== 'QB' && s !== 'C');

// ---------- Drawing ----------

// One picture used everywhere: the ghosted offence it lines up against, the
// zones, then the defenders.
function callMarkup(play, W, { view = EDIT_VIEW, pad = 0.8, selected = null, paper = false } = {}) {
  const ghosts = ghostOffense(play.showAgainst, W);
  let s = fieldMarkup(W, { view, rushDistance: state.settings.rushDistance, pad, paper });
  s += `<g opacity="${paper ? '.5' : '.38'}">`;
  for (const p of ghosts) s += `<g transform="translate(${f2(p.x)} ${f2(-p.y)})">${tokenMarkup(p, {}, { r: 1.15 })}</g>`;
  s += '</g>';
  s += defenseMarkup(play.defenders, { leverage: false });
  if (selected) {
    const d = play.defenders.find((x) => x.id === selected);
    if (d) s += `<circle cx="${f2(d.x)}" cy="${f2(-d.y)}" r="1.9" fill="none" stroke="#fff" stroke-width=".18" stroke-dasharray=".7 .4"/>`;
  }
  // A line from a man defender to the receiver he has, so the assignment reads
  // off the picture without opening anything.
  for (const d of play.defenders) {
    if (d.kind !== 'man' || !d.target) continue;
    const t = ghosts.find((g) => g.slot === d.target);
    if (!t) continue;
    s += `<line x1="${f2(d.x)}" y1="${f2(-d.y)}" x2="${f2(t.x)}" y2="${f2(-t.y)}"
      stroke="#f87171" stroke-opacity=".45" stroke-width=".12" stroke-dasharray=".5 .45"/>`;
  }
  return s;
}

export function defThumb(play, W, { paper = false } = {}) {
  return `<svg class="field-svg thumb${paper ? ' paper' : ''}" viewBox="${viewBox(W, THUMB_VIEW, 0.3)}" preserveAspectRatio="xMidYMid slice">
    ${callMarkup(play, W, { view: THUMB_VIEW, pad: 0.3, paper })}
  </svg>`;
}

// ---------- Editor ----------

export function openDefEditor(id) {
  const play = structuredClone(defPlayById(id));
  if (!play) return;
  const W = state.settings.fieldWidth;
  let sel = null;

  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'field-svg def-field');
  svg.setAttribute('viewBox', viewBox(W, EDIT_VIEW));
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const panel = h('div', { class: 'def-panel' });
  const draw = () => { svg.innerHTML = callMarkup(play, W, { selected: sel }); };

  const save = async () => { await saveDefPlay(play); };

  function renderPanel() {
    const d = sel && play.defenders.find((x) => x.id === sel);
    if (!d) {
      panel.replaceChildren(
        h('div', { class: 'p-section' },
          h('div', { class: 'p-title' }, 'Line up against'),
          h('p', { class: 'p-help' }, 'The offence drawn behind your call, so a defender can see what they are facing. Not saved as part of the play.'),
          h('div', { class: 'chip-grid' }, ...FORMATIONS.map((f) => h('button', {
            class: `chip-btn ${play.showAgainst === f.id ? 'on' : ''}`,
            onclick: () => { play.showAgainst = f.id; draw(); renderPanel(); save(); },
          }, f.name)))),
        h('div', { class: 'p-section' },
          h('div', { class: 'p-title' }, 'Assignments'),
          h('div', { class: 'def-list' }, ...play.defenders.map((x) => h('button', {
            class: 'def-row',
            onclick: () => { sel = x.id; draw(); renderPanel(); },
          },
          h('span', { class: `def-dot ${x.kind}` }, x.label),
          h('span', { class: 'grow' }, defJobLabel(x)),
          icon('next'))))),
        h('p', { class: 'p-help pad' }, 'Tap a defender on the field or in the list to give them a job. Drag them to move where they line up.'));
      return;
    }

    panel.replaceChildren(...[
      h('div', { class: 'p-head' },
        h('span', { class: `def-dot ${d.kind}` }, d.label),
        h('label', { class: 'p-head-label' }, 'Label',
          h('input', {
            class: 'input', value: d.label, maxLength: 3,
            onchange: (e) => { d.label = e.target.value.trim().toUpperCase().slice(0, 3) || d.label; draw(); renderPanel(); save(); },
          })),
        h('div', { class: 'spacer' }),
        btn('Done', () => { sel = null; draw(); renderPanel(); }, { iconName: 'check', kind: 'small primary' })),
      h('div', { class: 'p-section' },
        h('div', { class: 'p-title' }, 'Job'),
        segmented(DEF_JOBS.map((j) => ({ value: j.id, label: j.label })), d.kind, (v) => {
          d.kind = v;
          if (v === 'man' && !d.target) d.target = COVER_SLOTS[0];
          if (v !== 'man') d.target = null;
          draw(); renderPanel(); save();
        }),
        h('p', { class: 'p-help' }, DEF_JOBS.find((j) => j.id === d.kind)?.desc || '')),
      d.kind === 'man' ? h('div', { class: 'p-section' },
        h('div', { class: 'p-title' }, 'Has'),
        segmented(COVER_SLOTS.map((s) => ({ value: s, label: s })), d.target, (v) => {
          d.target = v; draw(); renderPanel(); save();
        })) : null,
      d.kind === 'zone' ? h('div', { class: 'p-section' },
        h('div', { class: 'p-title' }, 'Depth'),
        segmented([{ value: false, label: 'Short' }, { value: true, label: 'Deep' }], !!d.deep, (v) => {
          d.deep = v; draw(); renderPanel(); save();
        }),
        h('p', { class: 'p-help' }, 'A deep zone guards a bigger area further back — the one that must not be beaten over the top.')) : null,
    ].filter(Boolean));
  }

  // Drag a defender to where they line up. Behind the ball only: a defender
  // cannot start on the offence's side of the line.
  let drag = null;
  const pt = (e) => {
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return { x: q.x, y: -q.y };
  };
  svg.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const p = pt(e);
    let best = null, bd = 2.2;
    for (const d of play.defenders) {
      const dd = Math.hypot(d.x - p.x, d.y - p.y);
      if (dd < bd) { bd = dd; best = d; }
    }
    if (!best) { sel = null; draw(); renderPanel(); return; }
    sel = best.id;
    drag = { d: best, ox: best.x - p.x, oy: best.y - p.y, id: e.pointerId };
    svg.setPointerCapture(e.pointerId);
    draw();
    renderPanel();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const p = pt(e);
    drag.d.x = f2(clamp(p.x + drag.ox, 0.6, W - 0.6));
    drag.d.y = f2(clamp(p.y + drag.oy, 0.4, 24));
    draw();
  });
  const endDrag = () => { if (drag) { drag = null; save(); } };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  draw();
  renderPanel();

  openSheet({
    title: play.name,
    size: 'lg',
    headerExtra: btn('Rename', async () => {
      const v = await promptDialog({ title: 'Defense name', label: 'Name', value: play.name, confirmText: 'Save' });
      if (v === null) return;
      play.name = v;
      await save();
    }, { kind: 'small ghost' }),
    body: h('div', { class: 'def-edit' }, h('div', { class: 'def-fieldwrap' }, svg), panel),
    actions: [{ label: 'Done', kind: 'primary' }],
    onClose: save,
  });
}

// ---------- Full screen, for showing the team ----------

export function showDefense(id) {
  const play = defPlayById(id);
  if (!play) return;
  const W = state.settings.fieldWidth;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'field-svg huddle-field');
  svg.setAttribute('viewBox', viewBox(W, EDIT_VIEW));
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.innerHTML = callMarkup(play, W);

  const overlay = h('div', { class: 'huddle' },
    h('header', { class: 'hd-top' },
      h('div', { class: 'hd-heading' },
        h('div', { class: 'hd-title' }, play.name),
        h('div', { class: 'hd-sub' }, play.defenders.map((d) => `${d.label}: ${defJobLabel(d)}`).join(' · '))),
      h('div', { class: 'spacer' }),
      iconBtn('x', () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); }, { title: 'Close', cls: 'big' })),
    h('div', { class: 'hd-field' }, svg),
    play.notes ? h('footer', { class: 'hd-bottom' }, h('div', { class: 'hd-notes' }, play.notes)) : null);

  document.getElementById('overlays').append(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
}

// ---------- Grid ----------

export function defenseGrid() {
  const W = state.settings.fieldWidth;
  const grid = h('div', { class: 'play-grid' });
  const render = () => {
    if (!state.defplays.length) {
      grid.replaceChildren(h('div', { class: 'empty-state' },
        h('div', { class: 'empty-icon' }, icon('shieldHalf')),
        h('h3', null, 'No defensive calls yet'),
        h('p', null, 'Draw the defence you run — who rushes, who has who, who has the deep middle — and show the picture to your team.'),
        btn('New defense', newCall, { kind: 'primary', iconName: 'plus' })));
      return;
    }
    grid.replaceChildren(...state.defplays.map((p) => h('article', { class: 'play-card' },
      h('button', { class: 'play-card-main', onclick: () => openDefEditor(p.id) },
        h('div', { class: 'thumb-wrap', html: defThumb(p, W) }),
        h('div', { class: 'play-card-info' },
          h('div', { class: 'play-name' }, p.name),
          h('div', { class: 'play-meta' }, p.defenders.map((d) => d.label).join(' · ')))),
      h('div', { class: 'play-card-actions' },
        iconBtn('expand', () => showDefense(p.id), { title: 'Show the team', cls: 'small' }),
        iconBtn('more', () => cardMenu(p), { title: 'More', cls: 'small' })))));
  };
  render();
  const unsub = subscribe(render);
  return { el: grid, destroy: unsub, newCall };
}

async function newCall() {
  const W = state.settings.fieldWidth;
  const p = newDefPlay({ name: `Defense ${state.defplays.length + 1}`, W });
  await saveDefPlay(p);
  openDefEditor(p.id);
}

function cardMenu(p) {
  openSheet({
    title: p.name,
    size: 'sm',
    body: h('div', { class: 'btn-row stack' },
      btn('Show the team', () => showDefense(p.id), { iconName: 'expand', kind: 'ghost' }),
      btn('Notes', async () => {
        const v = await promptDialog({ title: 'Notes', label: 'What to tell them', value: p.notes || '', confirmText: 'Save' });
        if (v === null) return;
        await saveDefPlay({ ...p, notes: v });
        toast('Notes saved');
      }, { iconName: 'edit', kind: 'ghost' }),
      btn('Duplicate', async () => {
        const copy = structuredClone(p);
        copy.id = uid();
        copy.name = `${p.name} copy`;
        copy.defenders = copy.defenders.map((d) => ({ ...d, id: uid() }));
        await saveDefPlay(copy);
        toast('Duplicated');
      }, { iconName: 'copy', kind: 'ghost' }),
      btn('Delete', async () => {
        if (!(await confirmDialog({ title: `Delete ${p.name}?`, message: 'This cannot be undone.', confirmText: 'Delete', danger: true }))) return;
        await deleteDefPlay(p.id);
        toast('Deleted');
      }, { iconName: 'trash', kind: 'ghost danger-text' })),
    actions: [{ label: 'Close', kind: 'ghost' }],
  });
}

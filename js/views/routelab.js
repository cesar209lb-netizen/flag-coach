// Route lab: one QB, one receiver, and a route. Drag the two of them where you
// like, pick a route and run it. Nothing here is saved to the playbook — it is
// a place to learn what a route looks like.

import { h, icon, btn, segmented, toast } from '../ui.js';
import { state } from '../store.js';
import { ROUTES, applyRoute } from '../model.js';
import { viewBox, fieldMarkup } from '../field.js';
import { PlayStage, simContext } from '../stage.js';
import { simulate, frameAt } from '../sim.js';

const SVGNS = 'http://www.w3.org/2000/svg';
// A drill only needs the near 24 yards, so the players come up big.
const LAB_VIEW = { yMin: -9, yMax: 24 };
const r2 = (n) => Math.round(n * 100) / 100;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
// Nobody lines up on the paint, and it leaves a little room for a breaking
// route to actually break.
const EDGE = 2;

// Where the two of them stand, and which route, remembered between visits.
const pref = {
  read() {
    try {
      return JSON.parse(localStorage.getItem('fc-lab') || 'null');
    } catch { return null; }
  },
  write(v) {
    try { localStorage.setItem('fc-lab', JSON.stringify(v)); } catch { /* private mode */ }
  },
};

export function mount(root) {
  const W = state.settings.fieldWidth;
  const saved = pref.read() || {};
  let routeId = ROUTES.some((r) => r.id === saved.routeId) ? saved.routeId : 'slant';
  let mirrored = !!saved.mirrored;
  let speed = saved.speed || 1;
  const spot = {
    qb: { x: clamp(saved.qbX ?? W / 2, 0.5, W - 0.5), y: clamp(saved.qbY ?? -5, -8, -1.5) },
    rec: { x: clamp(saved.recX ?? W / 2 + 6, EDGE, W - EDGE), y: clamp(saved.recY ?? -1, -4, -0.5) },
  };

  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'field-svg lab-svg');
  svg.setAttribute('viewBox', viewBox(W, LAB_VIEW));
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.innerHTML = `<g>${fieldMarkup(W, { view: LAB_VIEW, showRush: false })}</g><g></g>`;
  const stage = new PlayStage(svg.children[1], { showNames: false, r: 1.3, rings: false, onUpdate: onStage });

  let lastTime = 1.5;
  const caption = h('div', { class: 'lab-caption' });
  const routeName = h('div', { class: 'lab-route' });
  const runBtn = h('button', { class: 'play-btn big', onclick: () => stage.toggle(), 'aria-label': 'Run the route' }, icon('play'));
  const chipsEl = h('div', { class: 'chip-grid routes' });
  const speedWrap = h('div');

  // ---------- The two-player drill this builds ----------

  function drillPlay() {
    const rec = {
      slot: 'X', label: 'X', x: spot.rec.x, y: spot.rec.y,
      route: [], routeId: null, motion: [], read: null, assigned: null,
    };
    const route = ROUTES.find((r) => r.id === routeId);
    if (route) {
      applyRoute(rec, route, W);
      if (mirrored) rec.route = rec.route.map(([dx, dy]) => [r2(-dx), dy]);
      // Keep a mirrored route on the field.
      rec.route = rec.route.map(([dx, dy]) => [r2(clamp(rec.x + dx, 0.5, W - 0.5) - rec.x), dy]);
    }
    return {
      id: 'lab', name: 'Route lab', formation: '', tags: [], rating: 0, notes: '',
      players: [
        { slot: 'QB', label: 'QB', x: spot.qb.x, y: spot.qb.y, route: [], routeId: null, motion: [], read: null, assigned: null },
        rec,
      ],
      ball: [{ id: 'labpass', type: 'pass', to: 'X', time: 1.5, auto: false }],
      defense: { look: 'base', coverage: 'none', rush: false },
      createdAt: 0, updatedAt: 0,
    };
  }

  // Release the ball so it arrives where the route finishes: a go ball is
  // thrown deep, a hitch is thrown at the hitch. Scoring the outcome the way
  // the play editor does would just throw everything as early as possible.
  function timeThrow(play, ctx) {
    const rec = play.players[1];
    if (!rec.route.length) return 1.2;
    const last = rec.route[rec.route.length - 1];
    const end = { x: rec.x + last[0], y: rec.y + last[1] };
    let best = null;
    for (let rt = 0.5; rt <= ctx.passClock - 0.2 + 1e-6; rt += 0.1) {
      const p2 = structuredClone(play);
      p2.ball[0].time = Math.round(rt * 10) / 10;
      const sim = simulate(p2, ctx);
      if (sim.catchT == null) continue;
      const i = sim.actors.indexOf('X');
      const f = frameAt(sim, sim.catchT);
      const d = Math.hypot(f.off[i * 2] - end.x, f.off[i * 2 + 1] - end.y);
      if (!best || d < best.d - 0.05) best = { time: p2.ball[0].time, d };
    }
    return best ? best.time : 1.2;
  }

  function build({ keepTime = false } = {}) {
    const play = drillPlay();
    const ctx = simContext(play);
    if (!keepTime) play.ball[0].time = timeThrow(play, ctx);
    else play.ball[0].time = lastTime;
    lastTime = play.ball[0].time;
    stage.load(play, ctx);
    stage.speed = speed;
    describe(play, stage.sim);
    pref.write({ routeId, mirrored, speed, qbX: spot.qb.x, qbY: spot.qb.y, recX: spot.rec.x, recY: spot.rec.y });
    return play;
  }

  // ---------- Readouts ----------

  // How much of the preset's sideways break actually fit on the field here.
  function roomFor(route, pts) {
    if (!route || !pts.length) return 1;
    const want = Math.max(...route.pts.map(([o]) => Math.abs(o)));
    if (want < 1) return 1;
    return Math.max(...pts.map(([dx]) => Math.abs(dx))) / want;
  }

  function describe(play, sim) {
    const route = ROUTES.find((r) => r.id === routeId);
    const pts = play.players[1].route;
    const depth = pts.length ? Math.max(...pts.map(([, dy]) => dy)) : 0;
    const breakAt = pts.length > 1 ? pts[0][1] : null;
    const room = roomFor(route, pts);
    routeName.replaceChildren(
      h('b', null, route ? route.name : 'No route'),
      h('span', null, [
        breakAt != null ? `breaks at ${Math.round(breakAt)} yds` : null,
        depth ? `${Math.round(depth)} yds deep` : null,
      ].filter(Boolean).join(' · ')));

    const caught = sim.catchT != null;
    const at = caught ? frameAt(sim, sim.catchT) : null;
    caption.classList.toggle('warn', room < 0.6);
    caption.textContent = room < 0.6
      ? `No room for ${route.name} this close to the sideline — drag the receiver toward the middle, or tap Flip.`
      : caught
        ? `Ball out at ${sim.throwT.toFixed(1)}s, caught ${Math.max(0, Math.round(at.by))} yds downfield`
        : 'Drag the QB or the receiver, pick a route, then press play';
  }

  function onStage(st) {
    runBtn.replaceChildren(icon(st.playing ? 'pause' : 'play'));
  }

  // ---------- Dragging the two of them ----------

  let drag = null;
  const fieldPt = (e) => {
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return { x: q.x, y: -q.y };
  };

  svg.addEventListener('pointerdown', (e) => {
    if (drag) return;
    const pt = fieldPt(e);
    // Whichever of the two is nearer the finger, if it is near enough at all.
    const dq = Math.hypot(pt.x - spot.qb.x, pt.y - spot.qb.y);
    const dr = Math.hypot(pt.x - spot.rec.x, pt.y - spot.rec.y);
    const who = Math.min(dq, dr) > 3.5 ? null : dq < dr ? 'qb' : 'rec';
    if (!who) return;
    e.preventDefault();
    stage.pause();
    drag = { who, ox: spot[who].x - pt.x, oy: spot[who].y - pt.y, id: e.pointerId };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const pt = fieldPt(e);
    const s = spot[drag.who];
    s.x = clamp(r2(pt.x + drag.ox), drag.who === 'qb' ? 0.5 : EDGE, W - (drag.who === 'qb' ? 0.5 : EDGE));
    // The QB stays behind the line; the receiver stays on or near it.
    s.y = drag.who === 'qb' ? clamp(r2(pt.y + drag.oy), -8, -1.5) : clamp(r2(pt.y + drag.oy), -4, -0.5);
    build();
  }

  function onUp() {
    drag = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  }

  // ---------- Controls ----------

  function renderChips() {
    chipsEl.replaceChildren(...ROUTES.map((r) =>
      h('button', {
        class: `chip-btn ${routeId === r.id ? 'on' : ''}`,
        onclick: () => { routeId = r.id; build(); renderChips(); stage.play(); },
      }, r.name)));
  }

  function renderSpeed() {
    speedWrap.replaceChildren(segmented(
      [{ value: 0.5, label: '½×' }, { value: 1, label: '1×' }, { value: 1.5, label: '1½×' }], speed,
      (v) => { speed = v; stage.speed = v; renderSpeed(); build({ keepTime: true }); }, { cls: 'small' }));
  }

  root.append(h('div', { class: 'page lab' },
    h('header', { class: 'page-head' },
      h('div', null, h('h1', null, 'Route lab'),
        h('span', { class: 'count' }, 'Just a QB and one receiver — learn what each route looks like')),
      h('div', { class: 'head-actions' },
        btn('Flip', () => { mirrored = !mirrored; build(); stage.play(); }, { iconName: 'flip', kind: 'ghost' }),
        btn('Reset spots', () => {
          spot.qb = { x: W / 2, y: -5 };
          spot.rec = { x: W / 2 + 6, y: -1 };
          mirrored = false;
          build();
          toast('Back to the start');
        }, { iconName: 'restart', kind: 'ghost' }))),
    // The route list sits beside the field on a tablet rather than under it —
    // on an iPad the whole point of the lab is below the fold otherwise.
    h('div', { class: 'lab-body' },
      h('div', { class: 'lab-main' },
          // The box takes the field's own proportions, so it never pads the
        // drill out with bands of empty turf above and below.
        h('div', {
          class: 'lab-field',
          style: { '--lab-ar': String(r2((W + 1.6) / (LAB_VIEW.yMax - LAB_VIEW.yMin))) },
        }, svg),
        h('div', { class: 'lab-bar' },
          runBtn,
          h('div', { class: 'lab-readout' }, routeName, caption),
          h('div', { class: 'spacer' }),
          speedWrap)),
      h('section', { class: 'card lab-side' },
        h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, 'Pick a route')),
        chipsEl,
        h('p', { class: 'p-help' }, 'Out, corner and flat break toward the nearest sideline, so drag the receiver to the other side of the field (or tap Flip) to run them the other way.')))));

  renderChips();
  renderSpeed();
  build();
  return { destroy: () => { stage.destroy(); onUp(); } };
}

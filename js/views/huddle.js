// Full-screen huddle mode: big field, looping animation, swipe between plays.

import { h, icon, iconBtn, segmented } from '../ui.js';
import { state, playById } from '../store.js';
import { HUDDLE_VIEW, fieldMarkup } from '../field.js';
import { PlayStage, simContext, simBounds } from '../stage.js';
import { bestThrowTime } from '../sim.js';
import { defenseOf, defenseLabel } from '../model.js';

const SVGNS = 'http://www.w3.org/2000/svg';
// Sideline padding, breathing room above/below the action, and the tightest
// zoom we allow — all in field yards.
const PAD_X = 0.8;
const PAD_Y = 1.2;
const MIN_SPAN = 19;
// On very tall screens filling the frame outright would zoom the play out, so
// only grow the view this far before letting the grass letterbox instead.
const MAX_SPAN = 34;
// The floating title and controls sit on translucent scrims, so the play only
// has to stay clear of most of them — reserving every pixel would cost zoom.
const CHROME_RESERVE = 0.7;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
let showDefense = true;
let huddleSpeed = 1;
// Which player the viewer is studying. Remembered, since a kid is always the
// same position.
const prefFocus = {
  get() { try { return localStorage.getItem('fc-focus') || ''; } catch { return ''; } },
  set(v) { try { v ? localStorage.setItem('fc-focus', v) : localStorage.removeItem('fc-focus'); } catch { /* private mode */ } },
};

export function openHuddle(playIds, startIndex = 0) {
  const ids = playIds.filter((id) => playById(id));
  if (!ids.length) return;
  let index = Math.max(0, Math.min(ids.length - 1, startIndex));
  const W = state.settings.fieldWidth;

  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'field-svg huddle-field');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.innerHTML = `<g>${fieldMarkup(W, { view: HUDDLE_VIEW, rushDistance: state.settings.rushDistance, pad: PAD_X })}</g><g></g>`;
  let focus = prefFocus.get();
  const stage = new PlayStage(svg.children[1], { loop: true, r: 1.3, onUpdate: onStage, focus: focus || null });
  stage.speed = huddleSpeed;

  const title = h('div', { class: 'hd-title' });
  const sub = h('div', { class: 'hd-sub' });
  const counter = h('div', { class: 'hd-counter' });
  const notes = h('div', { class: 'hd-notes' });
  const result = h('div', { class: 'hd-result', hidden: true });
  const playBtn = h('button', { class: 'play-btn big', onclick: () => stage.toggle(), 'aria-label': 'Play or pause' }, icon('pause'));
  const prevBtn = iconBtn('back', () => go(-1), { title: 'Previous play', cls: 'big' });
  const nextBtn = iconBtn('next', () => go(1), { title: 'Next play', cls: 'big' });
  const speedWrap = h('div');
  const defWrap = h('div');
  const focusWrap = h('div', { class: 'hd-focus' });

  const fieldBox = h('div', { class: 'hd-field' }, svg, result);
  const topBar = h('header', { class: 'hd-top' },
    h('div', { class: 'hd-heading' }, title, sub),
    h('div', { class: 'spacer' }),
    counter,
    iconBtn('x', close, { title: 'Close huddle mode', cls: 'big' }));
  const bottomBar = h('footer', { class: 'hd-bottom' },
    prevBtn, playBtn, nextBtn,
    h('div', { class: 'spacer' }),
    notes,
    h('div', { class: 'spacer' }),
    focusWrap, defWrap, speedWrap);

  const overlay = h('div', { class: 'huddle' }, topBar, fieldBox, bottomBar);

  function renderControls() {
    speedWrap.replaceChildren(segmented([{ value: 0.5, label: '½×' }, { value: 1, label: '1×' }, { value: 1.5, label: '1½×' }], stage.speed,
      (v) => { stage.speed = huddleSpeed = v; renderControls(); }, { cls: 'small' }));
    defWrap.replaceChildren(segmented([{ value: true, label: 'Defense' }, { value: false, label: 'Routes only' }], showDefense,
      (v) => { showDefense = v; renderControls(); load(); }, { cls: 'small' }));
    // "Who am I" — spotlights one player's route through the whole playbook.
    const play = playById(ids[index]);
    const opts = [{ value: '', label: 'All' }, ...(play?.players || [])
      .filter((p) => p.slot !== 'QB')
      .map((p) => ({ value: p.slot, label: p.label || p.slot }))];
    focusWrap.replaceChildren(
      h('span', { class: 'hd-focus-label' }, 'Watch'),
      segmented(opts, focus, (v) => {
        focus = v;
        prefFocus.set(v);
        stage.focus = v || null;
        load();
      }, { cls: 'small' }));
  }

  // Picking a spot throws that player the ball, with the release timed for
  // their route — so a player sees what the play looks like coming to them.
  // Display only: the coach's saved play is never touched.
  const timedCache = new Map();
  function throwTo(base, slot, ctx) {
    const pass = base.ball.find((b) => b.type === 'pass');
    if (!slot || !pass || pass.to === slot) return base;
    const key = `${base.id}:${slot}:${showDefense}`;
    let time = timedCache.get(key);
    if (time == null) {
      const aimed = structuredClone(base);
      aimed.ball.find((b) => b.id === pass.id).to = slot;
      time = bestThrowTime(aimed, ctx, pass.id, { step: 0.3 })?.time ?? pass.time;
      timedCache.set(key, time);
    }
    const out = structuredClone(base);
    const ev = out.ball.find((b) => b.id === pass.id);
    ev.to = slot;
    ev.time = time;
    return out;
  }

  // Zoom the view to the play so it fills the screen: the field always spans the
  // full width, and the action is centred in the strip between the floating
  // title and controls so nothing important hides under them.
  let bounds = { yMin: -8, yMax: 15 };
  function fitView() {
    const vbW = W + PAD_X * 2;
    const maxSpan = HUDDLE_VIEW.yMax - HUDDLE_VIEW.yMin;
    const lo = bounds.yMin - PAD_Y;
    const hi = bounds.yMax + PAD_Y;
    const contentSpan = Math.min(Math.max(MIN_SPAN, hi - lo), maxSpan);
    const mid = (lo + hi) / 2;
    const box = fieldBox.getBoundingClientRect();
    if (!box.width || !box.height) {
      svg.setAttribute('viewBox', `${-PAD_X} ${-(mid + contentSpan / 2)} ${vbW} ${contentSpan}`);
      return;
    }
    // Never let the chrome eat more than half the screen.
    let top = topBar.offsetHeight * CHROME_RESERVE;
    let bot = bottomBar.offsetHeight * CHROME_RESERVE;
    const over = (box.height * 0.5) / Math.max(1, top + bot);
    if (over < 1) { top *= over; bot *= over; }
    const fit = Math.min(box.width / vbW, (box.height - top - bot) / contentSpan);
    const span = Math.min(box.height / fit, maxSpan, MAX_SPAN);
    // Mirror how the SVG itself scales and centres the view, then aim the middle
    // of the action at the middle of the clear strip.
    const scale = Math.min(box.width / vbW, box.height / span);
    const slack = (box.height - span * scale) / 2;
    const aim = top + (box.height - top - bot) / 2;
    const viewTop = clamp(mid + (aim - slack) / scale, HUDDLE_VIEW.yMin + span, HUDDLE_VIEW.yMax);
    svg.setAttribute('viewBox', `${-PAD_X} ${-viewTop} ${vbW} ${span}`);
  }

  const ro = window.ResizeObserver ? new ResizeObserver(fitView) : null;
  ro?.observe(fieldBox);
  window.addEventListener('resize', fitView);

  let resultKey = '';
  function onStage(st) {
    playBtn.replaceChildren(icon(st.playing ? 'pause' : 'play'));
    const r = st.sim.result;
    const show = r && r.kind !== 'none' && st.t >= r.t && showDefense;
    const key = show ? r.title : '';
    if (key !== resultKey) {
      resultKey = key;
      result.hidden = !show;
      if (show) { result.className = `hd-result tone-${r.tone}`; result.textContent = r.title; }
    }
  }

  function load() {
    const play = playById(ids[index]);
    const base = showDefense ? play : { ...play, defense: { coverage: 'none', rush: false } };
    const ctx = simContext(play);
    const shown = throwTo(base, focus, ctx);
    const aimed = !!focus && shown.players.some((p) => p.slot === focus)
      && !!shown.ball.find((b) => b.type === 'pass');
    title.textContent = play.name;
    const def = defenseOf(play);
    const focusLabel = play.players.find((p) => p.slot === focus)?.label || focus;
    sub.textContent = [
      play.formation,
      showDefense && def.coverage !== 'none' ? `vs ${defenseLabel(def)}` : null,
      aimed ? `ball to ${focusLabel}` : null,
    ].filter(Boolean).join(' · ');
    counter.textContent = ids.length > 1 ? `${index + 1} / ${ids.length}` : '';
    notes.textContent = play.notes || '';
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === ids.length - 1;
    resultKey = '';
    result.hidden = true;
    stage.load(shown, ctx);
    bounds = simBounds(stage.sim);
    fitView();
    renderControls();
    stage.play();
  }

  function go(d) {
    const n = index + d;
    if (n < 0 || n >= ids.length) return;
    index = n;
    load();
  }

  // Swipe left/right to change plays, tap to pause.
  let down = null;
  svg.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
  svg.addEventListener('pointerup', (e) => {
    if (!down || down.id !== e.pointerId) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    down = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    else if (Math.hypot(dx, dy) < 10) stage.toggle();
  });

  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === ' ') { e.preventDefault(); stage.toggle(); }
  };
  document.addEventListener('keydown', onKey);

  let wakeLock = null;
  navigator.wakeLock?.request('screen').then((l) => { wakeLock = l; }).catch(() => {});

  function close() {
    stage.destroy();
    ro?.disconnect();
    window.removeEventListener('resize', fitView);
    document.removeEventListener('keydown', onKey);
    wakeLock?.release?.().catch(() => {});
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 200);
  }

  document.getElementById('overlays').append(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  renderControls();
  load();
}

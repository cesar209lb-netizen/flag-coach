// Full-screen huddle mode: big field, looping animation, swipe between plays.

import { h, icon, iconBtn, segmented } from '../ui.js';
import { state, playById } from '../store.js';
import { EDIT_VIEW, viewBox, fieldMarkup } from '../field.js';
import { PlayStage, simContext } from '../stage.js';
import { defenseOf, defenseLabel } from '../model.js';

const SVGNS = 'http://www.w3.org/2000/svg';
let showDefense = true;
let huddleSpeed = 1;

export function openHuddle(playIds, startIndex = 0) {
  const ids = playIds.filter((id) => playById(id));
  if (!ids.length) return;
  let index = Math.max(0, Math.min(ids.length - 1, startIndex));
  const W = state.settings.fieldWidth;

  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'field-svg huddle-field');
  svg.setAttribute('viewBox', viewBox(W, EDIT_VIEW));
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.innerHTML = `<g>${fieldMarkup(W, { rushDistance: state.settings.rushDistance })}</g><g></g>`;
  const stage = new PlayStage(svg.children[1], { loop: true, r: 1.3, onUpdate: onStage });
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

  const overlay = h('div', { class: 'huddle' },
    h('header', { class: 'hd-top' },
      h('div', { class: 'hd-heading' }, title, sub),
      h('div', { class: 'spacer' }),
      counter,
      iconBtn('x', close, { title: 'Close huddle mode', cls: 'big' })),
    h('div', { class: 'hd-field' }, svg, result),
    h('footer', { class: 'hd-bottom' },
      prevBtn, playBtn, nextBtn,
      h('div', { class: 'spacer' }),
      notes,
      h('div', { class: 'spacer' }),
      defWrap, speedWrap));

  function renderControls() {
    speedWrap.replaceChildren(segmented([{ value: 0.5, label: '½×' }, { value: 1, label: '1×' }, { value: 1.5, label: '1½×' }], stage.speed,
      (v) => { stage.speed = huddleSpeed = v; renderControls(); }, { cls: 'small' }));
    defWrap.replaceChildren(segmented([{ value: true, label: 'Defense' }, { value: false, label: 'Routes only' }], showDefense,
      (v) => { showDefense = v; renderControls(); load(); }, { cls: 'small' }));
  }

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
    const shown = showDefense ? play : { ...play, defense: { coverage: 'none', rush: false } };
    title.textContent = play.name;
    const def = defenseOf(play);
    sub.textContent = [play.formation, showDefense && def.coverage !== 'none' ? `vs ${defenseLabel(def)}` : null].filter(Boolean).join(' · ');
    counter.textContent = ids.length > 1 ? `${index + 1} / ${ids.length}` : '';
    notes.textContent = play.notes || '';
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === ids.length - 1;
    resultKey = '';
    result.hidden = true;
    stage.load(shown, simContext(play));
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

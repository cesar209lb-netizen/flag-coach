// Play designer: drag players, tap/draw routes, motion, ball events, defense, animation.

import { h, icon, iconBtn, btn, segmented, stepper, stars, toast, confirmDialog, actionSheet, promptDialog } from '../ui.js';
import { state, playById, savePlay, deletePlay, rosterFor, tokenInfo, saveSettings } from '../store.js';
import {
  SLOT_COLORS, SLOT_TEXT, ROUTES, QB_ROUTES, FORMATIONS, COVERAGES, LOOKS, applyRoute, applyFormation, flipPlay,
  copyPlay, snapPos, absRoute, absMotion, routeLabel, autoPassTarget, passTarget, uid,
  lookById, coverageById, defenseOf, sameDefense, mirrorLook,
} from '../model.js';
import { EDIT_VIEW, viewBox, fieldMarkup, routesMarkup, tokenMarkup, pathD, zonesMarkup, defenseMarkup } from '../field.js';
import { simulate, bestThrowTime, alignFor, frameAt } from '../sim.js';
import { PlayStage, simContext } from '../stage.js';
import { openHuddle } from './huddle.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const snap = (v) => Math.round(v * 2) / 2;
const r2 = (n) => Math.round(n * 100) / 100;
let lastTab = 'player';
let lastSpeed = 1;

const prefDefense = {
  get() { try { return localStorage.getItem('fc-def') !== '0'; } catch { return true; } },
  set(v) { try { localStorage.setItem('fc-def', v ? '1' : '0'); } catch { /* private mode */ } },
};

export function mount(root, playId) {
  const stored = playById(playId);
  if (!stored) {
    root.append(h('div', { class: 'page empty-state' }, h('h2', null, 'Play not found'),
      btn('Back to Playbook', () => { location.hash = '#/playbook'; }, { kind: 'primary' })));
    return {};
  }

  const W = state.settings.fieldWidth;
  const passClock = state.settings.passClock;
  let play = structuredClone(stored);
  let sel = null;
  let drawTarget = 'route';
  let mode = 'edit';
  let tab = lastTab;
  let sim = null, simDirty = true, stageSim = null;
  let deleted = false;
  // `preview` is a scratch defense for flipping through looks — it drives the
  // overlay, the result card and the animation, but never touches the saved
  // play until "Use" commits it.
  let preview = null;
  let showDefense = prefDefense.get();
  const alignCtx = { W, rushDistance: state.settings.rushDistance };
  const effDefense = () => preview || defenseOf(play);
  const undo = [], redo = [];
  let lastKey = null, lastKeyAt = 0, saveTimer = 0;

  const P = (slot) => play.players.find((p) => p.slot === slot);

  // ---------- Top bar ----------
  const nameInput = h('input', {
    class: 'ed-name', value: play.name, maxLength: 40, 'aria-label': 'Play name',
    onchange: () => { pushHistory(); play.name = nameInput.value.trim() || 'Untitled Play'; nameInput.value = play.name; scheduleSave(); updateTop(); },
  });
  const saveEl = h('span', { class: 'save-state' }, 'Saved');
  const undoBtn = iconBtn('undo', doUndo, { title: 'Undo' });
  const redoBtn = iconBtn('redo', doRedo, { title: 'Redo' });
  const top = h('header', { class: 'ed-top' },
    iconBtn('back', () => { location.hash = '#/playbook'; }, { title: 'Back to playbook' }),
    nameInput, saveEl, h('div', { class: 'spacer' }),
    undoBtn, redoBtn,
    iconBtn('flip', () => commit(() => {
      flipPlay(play, W);
      if (preview) preview = { ...preview, look: mirrorLook(preview.look) };
    }), { title: 'Flip left/right' }),
    btn('Huddle', () => { flush(); openHuddle([play.id], 0); }, { iconName: 'expand', kind: 'ghost', cls: 'hide-narrow' }),
    iconBtn('more', moreMenu, { title: 'More' }));

  // ---------- Field ----------
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'field-svg editor-field');
  svg.setAttribute('viewBox', viewBox(W, EDIT_VIEW));
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.innerHTML = `<g>${fieldMarkup(W, { rushDistance: state.settings.rushDistance })}</g>
    <g class="g-design"><g></g><g></g><g></g><g></g><g></g><g></g><g></g></g><g class="g-anim" style="display:none"></g>`;
  const gDesign = svg.querySelector('.g-design');
  // Zones sit under the routes; defender markers sit over them but under your
  // own players, so the routes you're drawing stay the most readable thing.
  const [gZones, gRoutes, gGhosts, gDefs, gTokens, gHandles, gPreview] = gDesign.children;
  const gAnim = svg.querySelector('.g-anim');
  const stage = new PlayStage(gAnim, { onUpdate: onStage });
  stage.speed = lastSpeed;

  const hint = h('div', { class: 'field-hint' });
  const resultPill = h('div', { class: 'result-pill', hidden: true });
  const defBar = h('div', { class: 'def-bar' });
  const fieldWrap = h('div', { class: 'field-wrap' }, svg, hint, defBar, resultPill);

  // ---------- Animation bar ----------
  const playBtn = h('button', { class: 'play-btn', onclick: togglePlay, 'aria-label': 'Play animation' }, icon('play'));
  // Slider position is a 0–1000 fraction of the play so it works before the first simulation loads.
  const scrub = h('input', { type: 'range', class: 'scrub', min: 0, max: 1000, step: 1, value: 0, 'aria-label': 'Timeline' });
  scrub.addEventListener('input', () => {
    const f = +scrub.value / 1000; // read first: pause() re-syncs the slider to the current time
    enterAnim();
    stage.pause();
    stage.seek(stage.sim.t0 + f * (stage.sim.endT - stage.sim.t0));
  });
  const timeEl = h('div', { class: 'time-readout' }, '0.0s');
  const clockFill = h('div', { class: 'clock-fill' });
  const rushMark = h('div', { class: 'clock-mark rush', title: 'Rusher arrives' });
  const throwMark = h('div', { class: 'clock-mark throw', title: 'Ball thrown' });
  const speedWrap = h('div', { class: 'speed-wrap' });
  const renderSpeed = () => speedWrap.replaceChildren(segmented(
    [{ value: 0.5, label: '½×' }, { value: 1, label: '1×' }, { value: 2, label: '2×' }], stage.speed,
    (v) => { stage.speed = lastSpeed = v; renderSpeed(); }, { cls: 'small' }));
  renderSpeed();
  const animBar = h('div', { class: 'anim-bar' },
    iconBtn('restart', () => { enterAnim(); stage.seek(stage.sim.t0); stage.play(); }, { title: 'Restart' }),
    playBtn,
    h('div', { class: 'scrub-wrap' }, scrub,
      h('div', { class: 'clock-row' },
        h('span', { class: 'clock-label' }, `${passClock}s clock`),
        h('div', { class: 'clock-bar' }, clockFill, rushMark, throwMark))),
    timeEl, speedWrap);

  // ---------- Panel ----------
  const tabsEl = h('div', { class: 'panel-tabs' });
  const panelBody = h('div', { class: 'panel-body' });
  const panel = h('aside', { class: 'ed-panel' }, tabsEl, panelBody);

  root.append(h('div', { class: 'editor' }, top,
    h('div', { class: 'ed-body' }, h('section', { class: 'ed-stage' }, fieldWrap, animBar), panel)));

  // ---------- History & saving ----------
  function pushHistory(key = null) {
    const now = performance.now();
    if (key && key === lastKey && now - lastKeyAt < 1200) { lastKeyAt = now; return; }
    lastKey = key; lastKeyAt = now;
    undo.push(JSON.stringify(play));
    if (undo.length > 100) undo.shift();
    redo.length = 0;
  }
  function commit(fn, { key = null, panel: rebuildPanel = true, tokens = true } = {}) {
    pushHistory(key);
    fn();
    afterChange({ panel: rebuildPanel, tokens });
  }
  function afterChange({ panel: rebuildPanel = true, tokens = true } = {}) {
    simDirty = true;
    if (mode === 'anim') exitAnim();
    drawDesign({ tokens });
    renderDefBar(); // flip and undo can change the play's defense
    if (rebuildPanel) renderPanel();
    updateTop();
    scheduleSave();
  }
  function doUndo() {
    if (!undo.length) return;
    redo.push(JSON.stringify(play));
    play = JSON.parse(undo.pop());
    lastKey = null;
    nameInput.value = play.name;
    afterChange();
  }
  function doRedo() {
    if (!redo.length) return;
    undo.push(JSON.stringify(play));
    play = JSON.parse(redo.pop());
    lastKey = null;
    nameInput.value = play.name;
    afterChange();
  }
  function updateTop() {
    undoBtn.disabled = !undo.length;
    redoBtn.disabled = !redo.length;
  }
  function scheduleSave() {
    saveEl.textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
  }
  function flush() {
    clearTimeout(saveTimer);
    if (deleted) return;
    savePlay(play, { silent: true }).then(() => { saveEl.textContent = 'Saved'; });
  }

  // ---------- Design rendering ----------
  function buildTokens() {
    gTokens.innerHTML = play.players.map((p) =>
      `<g class="tok" data-slot="${p.slot}">${tokenMarkup(p, tokenInfo(p.assigned), { showName: true })}</g>`).join('');
  }
  function placeTokens() {
    for (const g of gTokens.children) {
      const p = P(g.dataset.slot);
      g.setAttribute('transform', `translate(${p.x} ${-p.y})`);
      g.querySelector('.sel-ring').setAttribute('opacity', sel === p.slot ? '1' : '0');
      g.classList.toggle('selected', sel === p.slot);
    }
  }
  function drawOverlays() {
    gRoutes.innerHTML = routesMarkup(play, { selected: sel });
    let ghosts = '';
    for (const p of play.players) {
      if (!p.motion.length) continue;
      const s = snapPos(p);
      ghosts += `<circle cx="${s.x}" cy="${-s.y}" r="1.1" fill="none" stroke="${SLOT_COLORS[p.slot]}" stroke-width=".18" stroke-dasharray=".45 .3" opacity=".85"/>`;
    }
    gGhosts.innerHTML = ghosts;
    let handles = '';
    const p = sel && P(sel);
    if (p) {
      const pts = drawTarget === 'motion' ? absMotion(p).slice(1) : absRoute(p).slice(1);
      const col = SLOT_COLORS[p.slot];
      pts.forEach((q, i) => {
        const last = i === pts.length - 1;
        handles += `<g class="handle" data-idx="${i}" transform="translate(${q.x} ${-q.y})"><circle r="1.5" fill="transparent"/><circle r="${last ? 0.62 : 0.5}" fill="#fff" stroke="${col}" stroke-width=".24"/></g>`;
      });
    }
    gHandles.innerHTML = handles;
  }
  function drawDesign({ tokens = false } = {}) {
    if (tokens || gTokens.children.length !== play.players.length) buildTokens();
    placeTokens();
    drawOverlays();
    drawDefense();
    updateHint();
  }

  // ---------- Pre-snap defense ----------
  // Where the defenders will be when the ball arrives — the picture that tells
  // you whether the route actually beat the coverage. Skipped mid-drag, since
  // it needs a full simulation.
  function ghostDefs() {
    const s = ensureSim();
    const t = s.catchT ?? s.throwT;
    if (t == null || !s.defs.length) return null;
    const f = frameAt(s, t);
    return s.defs.map((d, j) => ({ ...d, x: f.def[j * 2], y: f.def[j * 2 + 1] }));
  }

  function drawDefense({ ghosts = true } = {}) {
    if (!showDefense) { gZones.innerHTML = ''; gDefs.innerHTML = ''; return; }
    const defs = alignFor(play, alignCtx, effDefense());
    gZones.innerHTML = zonesMarkup(defs);
    gDefs.innerHTML = defenseMarkup(defs, { zones: false, ghosts: ghosts ? ghostDefs() : null });
  }

  function setPreview(def) {
    preview = sameDefense(def, defenseOf(play)) ? null : def;
    simDirty = true;
    if (mode === 'anim') exitAnim();
    drawDefense();
    renderDefBar();
    renderPanel(); // the result card reflects the preview, and it lives on several tabs
  }

  function cycleDefense(field, dir) {
    const cur = effDefense();
    const list = field === 'coverage' ? COVERAGES : LOOKS;
    const i = list.findIndex((o) => o.id === (field === 'coverage' ? cur.coverage : cur.look));
    const next = list[((i < 0 ? 0 : i) + dir + list.length) % list.length].id;
    setPreview({ ...cur, [field]: next });
  }

  function useDefense() {
    if (!preview) return;
    const def = preview;
    preview = null;
    commit(() => { play.defense = def; }, { tokens: false });
    renderDefBar();
    toast('Saved to this play');
  }

  function toggleDefense() {
    showDefense = !showDefense;
    prefDefense.set(showDefense);
    drawDefense();
    renderDefBar();
  }

  function renderDefBar() {
    // Undo can move the play's defense onto whatever is being previewed.
    if (preview && sameDefense(preview, defenseOf(play))) preview = null;
    defBar.hidden = mode === 'anim';
    const eye = h('button', {
      class: `def-eye ${showDefense ? 'on' : ''}`, onclick: toggleDefense,
      title: showDefense ? 'Hide the defense' : 'Show the defense', 'aria-pressed': showDefense,
    }, icon('shield'));
    if (!showDefense) {
      defBar.className = 'def-bar off';
      defBar.replaceChildren(eye);
      return;
    }
    const def = effDefense();
    const cycler = (field, label) => h('div', { class: 'def-cyc' },
      h('button', { class: 'def-arrow', onclick: () => cycleDefense(field, -1), 'aria-label': `Previous ${field}` }, '‹'),
      h('span', { class: 'def-cyc-label' }, label),
      h('button', { class: 'def-arrow', onclick: () => cycleDefense(field, 1), 'aria-label': `Next ${field}` }, '›'));
    defBar.className = `def-bar${preview ? ' previewing' : ''}`;
    // replaceChildren stringifies null, unlike h() — filter before passing.
    defBar.replaceChildren(...[
      eye,
      cycler('coverage', coverageById(def.coverage).name),
      def.coverage === 'none' ? null : cycler('look', lookById(def.look).name),
      preview ? btn('Use', useDefense, { iconName: 'check', kind: 'small primary', cls: 'def-use' }) : null,
    ].filter(Boolean));
  }

  function updateHint(text = null) {
    let msg = text;
    if (!msg) {
      if (mode === 'anim') msg = stage.playing ? 'Tap the field to pause' : 'Tap the field to keep editing';
      else if (sel && drawTarget === 'motion') msg = `Tap behind the line to draw ${P(sel).label}'s pre-snap motion`;
      else if (sel) msg = `Tap the field to add route points for ${P(sel).label} · drag to draw · drag dots to adjust`;
      else msg = 'Tap a player to give them a route · drag players to move them';
    }
    if (hint.textContent !== msg) hint.textContent = msg;
  }
  function flashHint() {
    hint.classList.remove('flash');
    void hint.offsetWidth;
    hint.classList.add('flash');
  }

  // ---------- Pointer input ----------
  let drag = null;
  const fieldPt = (e) => {
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return { x: q.x, y: -q.y };
  };

  svg.addEventListener('pointerdown', (e) => {
    if (drag) return;
    e.preventDefault();
    const pt = fieldPt(e);
    if (mode === 'anim') drag = { type: 'animtap' };
    else {
      const handle = e.target.closest('.handle');
      const tok = e.target.closest('.tok');
      if (handle && sel) drag = { type: 'handle', idx: +handle.dataset.idx };
      else if (tok) {
        const p = P(tok.dataset.slot);
        drag = { type: 'player', slot: p.slot, ox: p.x - pt.x, oy: p.y - pt.y };
      } else drag = { type: 'field', pts: [pt] };
    }
    Object.assign(drag, { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 8) return;
    const first = !drag.moved;
    drag.moved = true;
    const pt = fieldPt(e);
    if (drag.type === 'player') {
      if (first) pushHistory();
      const p = P(drag.slot);
      p.x = clamp(snap(pt.x + drag.ox), 0.5, W - 0.5);
      p.y = clamp(snap(pt.y + drag.oy), -12, -0.5);
      placeTokens();
      drawOverlays();
      drawDefense({ ghosts: false });
    } else if (drag.type === 'handle') {
      if (first) pushHistory();
      const p = P(sel);
      if (drawTarget === 'motion') {
        p.motion[drag.idx] = [r2(clamp(snap(pt.x), 0.5, W - 0.5) - p.x), r2(clamp(snap(pt.y), -12, -0.5) - p.y)];
      } else {
        const s = snapPos(p);
        p.route[drag.idx] = [r2(clamp(snap(pt.x), 0, W) - s.x), r2(clamp(snap(pt.y), -12, 30) - s.y)];
        p.routeId = 'custom';
      }
      drawOverlays();
    } else if (drag.type === 'field' && sel) {
      const last = drag.pts[drag.pts.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) > 0.35) drag.pts.push(pt);
      gPreview.innerHTML = `<path d="${pathD(drag.pts)}" fill="none" stroke="#fff" stroke-width=".28" stroke-dasharray=".45 .3" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    const d = drag;
    drag = null;
    if (e.type === 'pointercancel') { gPreview.innerHTML = ''; if (d.moved) afterChange(); return; }
    if (d.type === 'animtap') {
      if (stage.playing) stage.pause(); else exitAnim();
    } else if (d.type === 'player') {
      if (d.moved) afterChange({ tokens: false });
      else selectSlot(sel === d.slot ? null : d.slot);
    } else if (d.type === 'handle') {
      if (d.moved) afterChange({ tokens: false });
    } else if (d.type === 'field') {
      gPreview.innerHTML = '';
      if (!sel) { flashHint(); return; }
      const pts = d.moved ? simplify(d.pts, 0.5) : d.pts.slice(0, 1);
      commit(() => addPoints(P(sel), pts), { tokens: false });
    }
  }

  function addPoints(p, pts) {
    if (drawTarget === 'motion') {
      for (const q of pts) p.motion.push([r2(clamp(snap(q.x), 0.5, W - 0.5) - p.x), r2(clamp(snap(q.y), -12, -0.5) - p.y)]);
    } else {
      const s = snapPos(p);
      for (const q of pts) {
        const pt = [r2(clamp(snap(q.x), 0, W) - s.x), r2(clamp(snap(q.y), -12, 30) - s.y)];
        const prev = p.route[p.route.length - 1] || [0, 0];
        if (Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) > 0.2) p.route.push(pt);
      }
      p.routeId = 'custom';
    }
  }

  function selectSlot(slot) {
    sel = slot;
    if (!slot || slot === 'QB' || slot === 'C') drawTarget = 'route';
    if (slot) tab = lastTab = 'player';
    drawDesign();
    renderPanel();
  }

  // ---------- Animation ----------
  function ensureSim() {
    if (simDirty || !sim) {
      // Simulate against the previewed defense without persisting it.
      const saved = play.defense;
      if (preview) play.defense = preview;
      try { sim = simulate(play, simContext(play)); } finally { play.defense = saved; }
      simDirty = false;
    }
    return sim;
  }
  function enterAnim() {
    ensureSim();
    if (mode !== 'anim') {
      mode = 'anim';
      gDesign.style.display = 'none';
      gAnim.style.display = '';
      fieldWrap.classList.add('animating');
      defBar.hidden = true;
    }
    if (stageSim !== sim) {
      stage.load(play, simContext(play), sim);
      stageSim = sim;
      const pct = (t) => `${clamp(t / passClock, 0, 1) * 100}%`;
      rushMark.hidden = sim.rushArrive == null;
      if (sim.rushArrive != null) rushMark.style.left = pct(sim.rushArrive);
      throwMark.hidden = sim.throwT == null;
      if (sim.throwT != null) throwMark.style.left = pct(sim.throwT);
    }
    updateHint();
  }
  function exitAnim() {
    if (mode !== 'anim') return;
    stage.pause();
    mode = 'edit';
    gAnim.style.display = 'none';
    gDesign.style.display = '';
    fieldWrap.classList.remove('animating');
    defBar.hidden = false;
    resultPill.hidden = true;
    pillKey = '';
    updateHint();
  }
  function togglePlay() {
    enterAnim();
    stage.toggle();
  }
  function watch() {
    enterAnim();
    stage.seek(stage.sim.t0);
    stage.play();
  }

  let pillKey = '', playingShown = null;
  function onStage(st) {
    const t = st.t;
    scrub.value = Math.round(((t - st.sim.t0) / (st.sim.endT - st.sim.t0 || 1)) * 1000);
    timeEl.textContent = t < 0 ? 'Pre-snap' : `${t.toFixed(1)}s`;
    clockFill.style.width = `${clamp(t / passClock, 0, 1) * 100}%`;
    clockFill.classList.toggle('late', t >= passClock * 0.75);
    const r = st.sim.result;
    const show = mode === 'anim' && r && r.kind !== 'none' && t >= r.t;
    const key = show ? r.title : '';
    if (key !== pillKey) {
      pillKey = key;
      resultPill.hidden = !show;
      if (show) {
        resultPill.className = `result-pill tone-${r.tone}`;
        resultPill.replaceChildren(h('strong', null, r.title), r.detail ? h('span', null, r.detail) : null);
      }
    }
    if (playingShown !== st.playing) {
      playingShown = st.playing;
      playBtn.replaceChildren(icon(st.playing ? 'pause' : 'play'));
      updateHint();
    }
  }

  // ---------- Panel ----------
  const TABS = [['player', 'Players'], ['ball', 'Ball'], ['defense', 'Defense'], ['details', 'Details']];

  function renderPanel() {
    tabsEl.replaceChildren(...TABS.map(([id, label]) =>
      h('button', { class: `panel-tab ${tab === id ? 'on' : ''}`, onclick: () => { tab = lastTab = id; renderPanel(); } }, label)));
    const scroll = panelBody.scrollTop;
    const content = tab === 'player' ? (sel ? playerPanel() : overviewPanel())
      : tab === 'ball' ? ballPanel() : tab === 'defense' ? defensePanel() : detailsPanel();
    panelBody.replaceChildren(content);
    panelBody.scrollTop = scroll;
  }

  const section = (title, ...kids) => h('div', { class: 'p-section' }, title ? h('div', { class: 'p-title' }, title) : null, ...kids);
  const slotDot = (slot, label) => h('span', { class: 'slot-dot', style: { background: SLOT_COLORS[slot], color: SLOT_TEXT[slot] } }, label || slot);

  function resultCard() {
    const s = ensureSim();
    const r = s.result;
    return h('div', { class: `result-card tone-${r.tone}` },
      h('div', { class: 'rc-top' }, h('div', { class: 'rc-label' }, 'Simulated result'),
        btn('Watch', watch, { iconName: 'play', kind: 'small primary' })),
      h('div', { class: 'rc-title' }, r.title),
      r.detail ? h('div', { class: 'rc-detail' }, r.detail) : null,
      h('div', { class: 'rc-stats' },
        s.throwT != null ? h('span', null, `Throw ${s.throwT.toFixed(1)}s`) : null,
        s.catchT != null ? h('span', null, `Arrives ${s.catchT.toFixed(1)}s`) : null,
        s.rushArrive != null ? h('span', null, `Rusher ${s.rushArrive.toFixed(1)}s`) : null));
  }

  function overviewPanel() {
    const current = FORMATIONS.find((f) => f.name === play.formation)?.id;
    return h('div', null,
      section('Players',
        h('div', { class: 'player-rows' }, play.players.map((p) => {
          const info = tokenInfo(p.assigned);
          return h('button', { class: 'player-row', onclick: () => selectSlot(p.slot) },
            slotDot(p.slot, p.label),
            h('div', { class: 'pr-main' }, h('div', { class: 'pr-name' }, info.first ? `${info.first}${info.number ? ` #${info.number}` : ''}` : 'Unassigned'),
              h('div', { class: 'pr-sub' }, routeLabel(p) + (p.motion.length ? ' · motion' : '') + (p.delay ? ` · waits ${p.delay}s` : ''))),
            p.read ? h('span', { class: 'read-chip' }, `Read ${p.read}`) : null,
            icon('next', 'chev'));
        }))),
      section('Formation',
        h('p', { class: 'p-help' }, 'Moves players into position. Routes stay attached.'),
        h('div', { class: 'chip-grid' }, FORMATIONS.map((f) =>
          h('button', { class: `chip-btn ${current === f.id ? 'on' : ''}`, onclick: () => commit(() => applyFormation(play, f.id, W)) }, f.name)))),
      section(null, resultCard()));
  }

  function playerPanel() {
    const p = P(sel);
    const isQB = p.slot === 'QB';
    const canMotion = !isQB && p.slot !== 'C';
    const roster = rosterFor();
    const labelInput = h('input', {
      class: 'input slot-input', value: p.label, maxLength: 3, 'aria-label': 'Position label',
      onchange: () => commit(() => { P(sel).label = labelInput.value.trim().toUpperCase().slice(0, 3) || P(sel).slot; }),
    });

    const assign = section('Who plays here',
      roster.length
        ? h('div', { class: 'avatar-scroll' }, roster.map(({ player, entry }) => {
          const on = p.assigned === player.id;
          return h('button', {
            class: `avatar-chip ${on ? 'on' : ''}`,
            onclick: () => commit(() => {
              for (const q of play.players) if (q.assigned === player.id) q.assigned = null;
              P(sel).assigned = on ? null : player.id;
            }),
          },
          player.photo ? h('img', { src: player.photo, alt: '' }) : h('span', { class: 'av-initials' }, (player.first[0] || '?').toUpperCase()),
          h('span', { class: 'av-name' }, player.first),
          entry.number ? h('span', { class: 'av-num' }, `#${entry.number}`) : null);
        }))
        : h('p', { class: 'p-help' }, 'Add players on the Roster tab to put their photos on the field.'));

    let routeSection;
    if (drawTarget === 'motion') {
      const side = p.x < W / 2 ? 1 : -1;
      const motions = [
        { name: 'Jet Across', pts: [[r2(clamp(W / 2 + side * 3, 0.5, W - 0.5) - p.x), -2]] },
        { name: 'Short In', pts: [[side * 4, 0]] },
        { name: 'Out Wide', pts: [[r2(clamp(p.x - side * 4, 0.5, W - 0.5) - p.x), 0]] },
      ];
      routeSection = section('Pre-snap motion',
        h('p', { class: 'p-help' }, 'Where this player moves before the snap. Their route starts from the end of the motion.'),
        h('div', { class: 'chip-grid' }, motions.map((m) => h('button', { class: 'chip-btn', onclick: () => commit(() => { P(sel).motion = m.pts; }, { tokens: false }) }, m.name))),
        h('div', { class: 'btn-row' },
          btn('Remove last point', () => commit(() => P(sel).motion.pop(), { tokens: false }), { kind: 'small ghost', disabled: !p.motion.length }),
          btn('Clear motion', () => commit(() => { P(sel).motion = []; }, { tokens: false }), { kind: 'small ghost danger-text', disabled: !p.motion.length })));
    } else {
      const presets = isQB ? QB_ROUTES : ROUTES;
      routeSection = section(isQB ? 'QB movement' : 'Routes',
        h('div', { class: 'chip-grid routes' }, presets.map((r) =>
          h('button', { class: `chip-btn ${p.routeId === r.id ? 'on' : ''}`, onclick: () => commit(() => applyRoute(P(sel), r, W), { tokens: false }) }, r.name))),
        h('div', { class: 'btn-row' },
          btn('Remove last point', () => commit(() => { P(sel).route.pop(); P(sel).routeId = 'custom'; }, { tokens: false }), { kind: 'small ghost', disabled: !p.route.length }),
          btn('Mirror', () => commit(() => { const q = P(sel); q.route = q.route.map(([dx, dy]) => [-dx, dy]); q.routeId = q.routeId === 'rollR' ? 'rollL' : q.routeId === 'rollL' ? 'rollR' : q.routeId; }, { tokens: false }), { kind: 'small ghost', disabled: !p.route.length }),
          btn('Clear', () => commit(() => { P(sel).route = []; P(sel).routeId = null; }, { tokens: false }), { kind: 'small ghost danger-text', disabled: !p.route.length })));
    }

    // A delayed release: hold the spot at the snap, then run the route as drawn.
    // The defender covering them waits too, which is the point of the thing.
    const delaySection = !isQB && p.slot !== 'C' && drawTarget !== 'motion' ? section('Delayed release',
      h('p', { class: 'p-help' }, `How long ${p.label} stands still after the snap before running. Everyone else goes on the snap.`),
      h('div', { class: 'delay-row' },
        stepper(p.delay || 0, {
          min: 0,
          max: 3,
          step: 0.5,
          suffix: 's',
          onChange: (v) => commit(() => { P(sel).delay = v; }, { key: `delay:${sel}`, tokens: false }),
        }),
        h('span', { class: 'muted small' }, p.delay ? 'Counts, then runs' : 'Goes on the snap'))) : null;

    const target = passTarget(play);
    const readSection = !isQB ? section('QB read order',
      segmented([{ value: null, label: 'None' }, { value: 1, label: '1st' }, { value: 2, label: '2nd' }, { value: 3, label: '3rd' }, { value: 4, label: '4th' }],
        p.read, (v) => commit(() => {
          for (const q of play.players) if (v && q.read === v) q.read = null;
          P(sel).read = v;
        }, { tokens: false })),
      h('div', { class: 'btn-row' },
        target === p.slot
          ? h('span', { class: 'target-chip' }, icon('target'), 'Pass target')
          : btn('Make pass target', () => commit(() => {
            let pass = play.ball.find((b) => b.type === 'pass');
            if (!pass) { pass = { id: uid(), type: 'pass', to: null, time: 2, auto: false }; play.ball.push(pass); }
            pass.to = sel;
          }, { tokens: false }), { iconName: 'target', kind: 'small ghost' }))) : null;

    return h('div', null,
      h('div', { class: 'p-head' },
        slotDot(p.slot, p.label),
        h('label', { class: 'p-head-label' }, 'Label', labelInput),
        h('div', { class: 'spacer' }),
        btn('Done', () => selectSlot(null), { iconName: 'check', kind: 'small primary' })),
      canMotion ? h('div', { class: 'p-section tight' }, segmented(
        [{ value: 'route', label: 'Route' }, { value: 'motion', label: 'Pre-snap motion' }], drawTarget,
        (v) => { drawTarget = v; drawDesign(); renderPanel(); })) : null,
      routeSection, delaySection, readSection, assign);
  }

  function ballPanel() {
    const s = ensureSim();
    const slots = play.players.map((p) => p.slot);
    let carrier = 'QB';
    const cards = play.ball.map((ev, i) => {
      const from = carrier;
      const autoTo = ev.type === 'pass' && !ev.to ? autoPassTarget(play) : null;
      const to = ev.to || autoTo;
      const invalid = !to || to === from;
      if (!invalid) carrier = to;
      const resolved = s.events.find((e) => e.id === ev.id);
      const timeLabel = h('span', { class: 'time-val' }, `${(resolved?.time ?? ev.time).toFixed(1)}s`);
      const slider = h('input', {
        type: 'range', class: 'range', min: 0.4, max: passClock, step: 0.1, value: ev.time ?? 1, disabled: ev.type === 'handoff' && ev.auto,
        'aria-label': 'Time',
      });
      slider.addEventListener('input', () => {
        commit(() => { play.ball[i].time = +slider.value; }, { key: `time-${ev.id}`, panel: false, tokens: false });
        timeLabel.textContent = `${(+slider.value).toFixed(1)}s`;
      });
      slider.addEventListener('change', () => renderPanel());
      return h('div', { class: `ball-card ${invalid ? 'invalid' : ''}` },
        h('div', { class: 'bc-head' },
          h('span', { class: 'bc-step' }, i + 1),
          segmented([{ value: 'pass', label: 'Pass' }, { value: 'handoff', label: 'Handoff' }, { value: 'pitch', label: 'Pitch' }], ev.type,
            (v) => commit(() => { const b = play.ball[i]; b.type = v; b.auto = v === 'handoff'; }, { tokens: false }), { cls: 'small' }),
          h('div', { class: 'spacer' }),
          iconBtn('trash', () => commit(() => play.ball.splice(i, 1), { tokens: false }), { title: 'Remove step', cls: 'small' })),
        h('div', { class: 'bc-row' },
          h('span', { class: 'bc-label' }, 'From'), slotDot(from, P(from)?.label),
          h('span', { class: 'bc-label' }, 'to'),
          h('div', { class: 'slot-pick' }, slots.filter((sl) => sl !== from).map((sl) =>
            h('button', {
              class: `slot-btn ${to === sl ? 'on' : ''} ${autoTo === sl ? 'auto' : ''}`,
              style: { '--slot': SLOT_COLORS[sl], '--slot-text': SLOT_TEXT[sl] },
              onclick: () => commit(() => { play.ball[i].to = sl; }, { tokens: false }),
            }, P(sl).label)))),
        invalid ? h('div', { class: 'bc-warn' }, 'Pick who gets the ball.') : null,
        h('div', { class: 'bc-row' },
          h('span', { class: 'bc-label' }, ev.type === 'pass' ? 'Throw at' : ev.type === 'pitch' ? 'Pitch at' : 'Hand off at'),
          slider, timeLabel),
        h('div', { class: 'btn-row' },
          ev.type === 'handoff' ? h('label', { class: 'check' },
            h('input', { type: 'checkbox', checked: !!ev.auto, onchange: (e) => commit(() => { play.ball[i].auto = e.target.checked; }, { tokens: false }) }),
            'Auto (when they cross paths)') : null,
          ev.type === 'pass' ? btn('Find best throw time', () => {
            const best = bestThrowTime(play, simContext(play), ev.id);
            if (!best) return;
            commit(() => { play.ball[i].time = best.time; }, { tokens: false });
            toast(`Best at ${best.time.toFixed(1)}s — ${best.result.title}`);
          }, { iconName: 'bolt', kind: 'small ghost' }) : null));
    });

    const add = (type) => commit(() => play.ball.push({ id: uid(), type, to: null, time: type === 'pass' ? 2 : 1, auto: type === 'handoff' }), { tokens: false });
    return h('div', null,
      section(null, resultCard()),
      section('What happens to the ball',
        h('p', { class: 'p-help' }, 'The center snaps to the QB. Each step starts from whoever has the ball.'),
        cards.length ? cards : h('div', { class: 'empty-mini' }, 'No steps — the QB just holds the ball.'),
        h('div', { class: 'btn-row' },
          btn('Pass', () => add('pass'), { iconName: 'plus', kind: 'small ghost' }),
          btn('Handoff', () => add('handoff'), { iconName: 'plus', kind: 'small ghost' }),
          btn('Pitch', () => add('pitch'), { iconName: 'plus', kind: 'small ghost' }))));
  }

  function commitDefense(patch) {
    const next = { ...effDefense(), ...patch };
    preview = null;
    commit(() => { play.defense = next; }, { tokens: false });
    renderDefBar();
  }

  function defensePanel() {
    const saved = defenseOf(play);
    const d = effDefense();
    const ctx = simContext(play);
    const stress = h('div', { class: 'stress' });
    const run = (rows) => stress.replaceChildren(...rows.map(({ label, def }) => {
      const p2 = structuredClone(play);
      p2.defense = def;
      const r = simulate(p2, ctx).result;
      return h('div', { class: `stress-row tone-${r.tone}` },
        h('span', { class: 'stress-def' }, label),
        h('span', { class: 'stress-res' }, r.title));
    }));

    return h('div', null,
      preview ? section(null, h('div', { class: 'def-banner' },
        h('div', { class: 'db-main' },
          h('div', { class: 'db-title' }, 'Previewing a defense'),
          h('div', { class: 'db-sub' }, `This play is saved as ${coverageById(saved.coverage).name}${saved.coverage === 'none' ? '' : ` · ${lookById(saved.look).name}`}`)),
        btn('Use', useDefense, { kind: 'small primary' }),
        btn('Discard', () => setPreview(saved), { kind: 'small ghost' }))) : null,
      section('Coverage',
        h('p', { class: 'p-help' }, 'What the defenders do after the snap.'),
        h('div', { class: 'cov-list' }, COVERAGES.map((c) =>
          h('button', { class: `cov-card ${d.coverage === c.id ? 'on' : ''}`, onclick: () => commitDefense({ coverage: c.id }) },
            h('div', { class: 'cov-name' }, c.name), h('div', { class: 'cov-desc' }, c.desc))))),
      d.coverage === 'none' ? null : section('Look',
        h('p', { class: 'p-help' }, 'Where they line up before the snap. Flip through these on the field to see how your routes look against each one.'),
        h('div', { class: 'look-list' }, LOOKS.map((l) =>
          h('button', { class: `look-card ${d.look === l.id ? 'on' : ''}`, onclick: () => commitDefense({ look: l.id }) },
            h('div', { class: 'cov-name' }, l.name), h('div', { class: 'cov-desc' }, l.desc))))),
      section('Rusher',
        segmented([{ value: true, label: 'Rush the QB' }, { value: false, label: 'No rush' }], d.rush !== false,
          (v) => commitDefense({ rush: v })),
        h('p', { class: 'p-help' }, `The rusher starts ${state.settings.rushDistance} yards off the line. Change it in Settings.`)),
      section('Reading the field',
        h('div', { class: 'legend' },
          h('span', null, h('i', { class: 'legend-dot good' }), 'Open (3+ yds)'),
          h('span', null, h('i', { class: 'legend-dot warn' }), 'Closing'),
          h('span', null, h('i', { class: 'legend-dot bad' }), 'Covered')),
        h('p', { class: 'p-help defense-legend' },
          'A triangle is a defender — the letter is who they have in man. The red bubble is a zone they are responsible for, and the curve on their shoulder is the side they are shading, so break the other way.')),
      section(null, resultCard()),
      section('Test this play',
        h('div', { class: 'btn-row' },
          btn('vs every coverage', () => run(COVERAGES.filter((c) => c.id !== 'none').flatMap((c) => [true, false].map((rush) => ({
            label: `${c.name}${rush ? ' + rush' : ''} · ${lookById(d.look).name}`,
            def: { ...d, coverage: c.id, rush },
          })))), { iconName: 'bolt', kind: 'small ghost' }),
          d.coverage === 'none' ? null : btn('vs every look', () => run(LOOKS.map((l) => ({
            label: `${coverageById(d.coverage).name} · ${l.name}`,
            def: { ...d, look: l.id },
          }))), { iconName: 'bolt', kind: 'small ghost' })),
        stress));
  }

  function detailsPanel() {
    const notes = h('textarea', { class: 'input', rows: 5, placeholder: 'Coaching points, when to call it, what to watch for…' });
    notes.value = play.notes || '';
    notes.addEventListener('input', () => { play.notes = notes.value; scheduleSave(); });
    const tags = state.settings.tags;
    return h('div', null,
      section('Rating', stars(play.rating || 0, { size: 'lg', onChange: (v) => commit(() => { play.rating = v; }, { tokens: false }) })),
      section('Tags',
        h('div', { class: 'chip-grid' },
          tags.map((t) => h('button', {
            class: `chip-btn ${play.tags.includes(t) ? 'on' : ''}`,
            onclick: () => commit(() => { play.tags = play.tags.includes(t) ? play.tags.filter((x) => x !== t) : [...play.tags, t]; }, { tokens: false }),
          }, t)),
          h('button', {
            class: 'chip-btn add',
            onclick: async () => {
              const name = await promptDialog({ title: 'New tag', label: 'Tag name', placeholder: 'e.g. 4th Down', confirmText: 'Add' });
              if (!name) return;
              if (!tags.includes(name)) await saveSettings({ tags: [...tags, name] }, { silent: true });
              commit(() => { if (!play.tags.includes(name)) play.tags.push(name); }, { tokens: false });
            },
          }, '+ New tag'))),
      section('Notes', notes),
      section('Info', h('div', { class: 'kv' },
        h('span', null, 'Formation'), h('span', null, play.formation || '—'),
        h('span', null, 'Created'), h('span', null, new Date(play.createdAt).toLocaleDateString()),
        h('span', null, 'Last edited'), h('span', null, new Date(play.updatedAt).toLocaleString()))),
      section(null, h('div', { class: 'btn-row' },
        btn('Duplicate', duplicate, { iconName: 'copy', kind: 'ghost' }),
        btn('Delete play', remove, { iconName: 'trash', kind: 'ghost danger-text' }))));
  }

  // ---------- Menu actions ----------
  async function duplicate(mirror = false) {
    flush();
    const c = copyPlay(play, mirror ? '' : ' (copy)');
    if (mirror) flipPlay(c, W);
    if (mirror && c.name === play.name) c.name += ' (flipped)';
    await savePlay(c);
    location.hash = `#/play/${c.id}`;
    toast(mirror ? 'Flipped copy created' : 'Play duplicated');
  }
  async function remove() {
    const ok = await confirmDialog({ title: 'Delete play?', message: `"${play.name}" will be removed from your playbook.`, confirmText: 'Delete', danger: true });
    if (!ok) return;
    deleted = true;
    clearTimeout(saveTimer);
    await deletePlay(play.id);
    location.hash = '#/playbook';
    toast('Play deleted');
  }
  function moreMenu() {
    actionSheet({
      title: play.name,
      items: [
        { label: 'Huddle mode', icon: 'expand', onClick: () => { flush(); openHuddle([play.id], 0); } },
        { label: 'Duplicate', icon: 'copy', onClick: () => duplicate(false) },
        { label: 'Make a flipped copy', icon: 'flip', onClick: () => duplicate(true) },
        { label: 'Delete play', icon: 'trash', danger: true, onClick: remove },
      ],
    });
  }

  // ---------- Init ----------
  drawDesign({ tokens: true });
  renderDefBar();
  renderPanel();
  updateTop();

  return {
    destroy() {
      stage.destroy();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (!deleted && saveEl.textContent !== 'Saved') flush();
    },
  };
}

function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  let idx = -1, md = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], a, b);
    if (d > md) { md = d; idx = i; }
  }
  if (md > eps) return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
  return [a, b];
}

function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  const t = L2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

// Draws a simulated play into an SVG group and plays it back.

import { simulate, frameAt } from './sim.js';
import { routesMarkup, tokenMarkup, defenderMarkup, ballMarkup } from './field.js';
import { state, tokenInfo } from './store.js';

const f2 = (n) => Math.round(n * 100) / 100;
const TONE_COLORS = { great: '#22c55e', good: '#22c55e', ok: '#facc15', warn: '#facc15', bad: '#ef4444', neutral: '#94a3b8' };

export function simContext(play) {
  const s = state.settings;
  return {
    W: s.fieldWidth, passClock: s.passClock, rushDistance: s.rushDistance,
    ratingsFor: (id) => tokenInfo(id).ratings,
    tokenInfo,
    nameOf: (slot) => {
      const p = play.players.find((x) => x.slot === slot);
      if (!p) return slot;
      const first = tokenInfo(p.assigned).first;
      return first ? `${first} (${p.label})` : p.label;
    },
  };
}

// Vertical extent of everything that moves during a play, in field yards.
// Huddle mode zooms the view to this so the play fills the screen.
export function simBounds(sim) {
  let yMin = Infinity, yMax = -Infinity;
  const add = (y) => { if (y < yMin) yMin = y; if (y > yMax) yMax = y; };
  for (const f of sim.frames) {
    for (let i = 1; i < f.off.length; i += 2) add(f.off[i]);
    for (let j = 1; j < f.def.length; j += 2) add(f.def[j]);
    add(f.by + f.bh * 0.55);
  }
  const res = sim.result;
  if (res && res.kind !== 'none') add(res.y);
  if (!Number.isFinite(yMin)) return { yMin: -8, yMax: 15 };
  return { yMin, yMax };
}

export class PlayStage {
  constructor(group, { showNames = true, loop = false, rings = true, r = 1.15, onUpdate = null, focus = null } = {}) {
    Object.assign(this, { group, showNames, loop, rings, r, onUpdate, focus });
    this.speed = 1;
    this.playing = false;
    this.t = 0;
    this.sim = null;
    this.hold = 0;
    this.raf = 0;
    group.innerHTML = '<g></g><g></g><g></g><g></g><g></g><g></g>';
    [this.gRoutes, this.gGain, this.gDef, this.gOff, this.gBall, this.gFx] = group.children;
    this.tick = this.tick.bind(this);
  }

  load(play, ctx, sim = null) {
    this.playData = play;
    this.ctx = ctx;
    this.sim = sim || simulate(play, ctx);
    this.gRoutes.innerHTML = routesMarkup(play, { faint: !this.focus, focus: this.focus, target: this.sim.target });
    // The transparent disc is a finger-sized target: the drawn token is about a
    // yard across, which is a small thing to hit on a moving field.
    this.gOff.innerHTML = play.players.map((p) =>
      `<g data-slot="${p.slot}"><circle class="hit" r="${this.r + 1.6}" fill="transparent"/>`
      + `<circle class="ring" r="${this.r + 0.75}" fill="none" stroke-width=".3" opacity="0"/>`
      + `${tokenMarkup(p, ctx.tokenInfo(p.assigned), { r: this.r, showName: this.showNames })}</g>`).join('');
    this.offEls = [...this.gOff.children];
    this.ringEls = this.offEls.map((e) => e.querySelector('.ring'));
    this.applyFocus();
    this.gDef.innerHTML = this.sim.defs.map((d) => `<g>${defenderMarkup(d)}</g>`).join('');
    this.defEls = [...this.gDef.children];
    this.gBall.innerHTML = ballMarkup();
    this.ballShadow = this.gBall.querySelector('.b-shadow');
    this.ballBody = this.gBall.querySelector('.b-body');
    this.fxShown = false;
    this.gFx.innerHTML = '';
    this.gGain.innerHTML = '';
    this.t = this.sim.t0;
    this.hold = 0;
    this.render();
  }

  seek(t) {
    if (!this.sim) return;
    this.hold = 0;
    this.t = Math.max(this.sim.t0, Math.min(this.sim.endT, t));
    this.render();
  }

  play() {
    if (!this.sim) return;
    if (this.t >= this.sim.endT - 0.01) this.t = this.sim.t0;
    this.playing = true;
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
    this.emit();
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.emit();
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  tick(now) {
    if (!this.playing) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.hold) {
      if (now >= this.hold) { this.hold = 0; this.t = this.sim.t0; }
    } else {
      this.t += dt * this.speed;
      if (this.t >= this.sim.endT) {
        this.t = this.sim.endT;
        if (this.loop) this.hold = now + 1800;
        else { this.render(); this.pause(); return; }
      }
    }
    this.render();
    this.raf = requestAnimationFrame(this.tick);
  }

  render() {
    const sim = this.sim;
    if (!sim) return;
    const f = frameAt(sim, this.t);
    const res = sim.result;
    const done = res && res.kind !== 'none' && this.t >= res.t;
    const thrown = sim.throwT != null && this.t >= sim.throwT;

    for (let i = 0; i < this.offEls.length; i++) {
      this.offEls[i].setAttribute('transform', `translate(${f2(f.off[i * 2])} ${f2(-f.off[i * 2 + 1])})`);
      let show = false;
      if (this.rings && sim.hasCoverage && this.t >= 0.25 && !done && sim.actors[i] !== 'QB' && f.carrier !== i) {
        show = !thrown || sim.target === sim.actors[i];
      }
      const ring = this.ringEls[i];
      if (show) {
        const o = f.open[i];
        ring.setAttribute('stroke', o >= 3 ? '#22c55e' : o >= 1.6 ? '#facc15' : '#ef4444');
        ring.setAttribute('opacity', '.95');
      } else ring.setAttribute('opacity', '0');
    }
    for (let j = 0; j < this.defEls.length; j++) {
      this.defEls[j].setAttribute('transform', `translate(${f2(f.def[j * 2])} ${f2(-f.def[j * 2 + 1])})`);
    }
    this.ballShadow.setAttribute('transform', `translate(${f2(f.bx)} ${f2(-f.by)}) scale(${f2(1 - Math.min(f.bh, 3) * 0.12)})`);
    this.ballBody.setAttribute('transform', `translate(${f2(f.bx)} ${f2(-(f.by + f.bh * 0.55))}) scale(${f2(1 + f.bh * 0.07)}) rotate(-30)`);

    if (done && !this.fxShown) {
      this.fxShown = true;
      const col = TONE_COLORS[res.tone] || '#fff';
      const W = this.ctx.W;
      const showGain = ['flag', 'breakaway', 'oob', 'sack', 'qbrun'].includes(res.kind);
      if (showGain) {
        const label = `${res.yards > 0 ? '+' : ''}${res.yards}`;
        this.gGain.innerHTML = `<line x1="0" x2="${W}" y1="${f2(-res.y)}" y2="${f2(-res.y)}" stroke="#fde047" stroke-width=".22" stroke-dasharray=".8 .5"/>
          <g transform="translate(${W - 2.6} ${f2(-res.y)})"><rect x="-1.9" y="-.8" width="3.8" height="1.6" rx=".8" fill="#fde047"/><text y=".38" font-size="1.05" class="gain-t" text-anchor="middle">${label}</text></g>`;
      }
      this.gFx.innerHTML = `<g transform="translate(${f2(res.x)} ${f2(-res.y)})"><circle class="fx-pulse" r="1.6" fill="none" stroke="${col}" stroke-width=".3"/></g>`;
    } else if (!done && this.fxShown) {
      this.fxShown = false;
      this.gFx.innerHTML = '';
      this.gGain.innerHTML = '';
    }
    this.emit();
  }

  // Fade the players who are not the one being studied. The QB stays bright
  // because the ball comes from him.
  applyFocus() {
    if (!this.offEls) return;
    this.offEls.forEach((el, i) => {
      const slot = this.sim?.actors[i];
      const on = !this.focus || slot === this.focus || slot === 'QB';
      el.setAttribute('opacity', on ? '1' : '0.25');
    });
  }

  setFocus(slot) {
    this.focus = slot || null;
    if (!this.playData) return;
    this.gRoutes.innerHTML = routesMarkup(this.playData, { faint: !this.focus, focus: this.focus, target: this.sim.target });
    this.applyFocus();
  }

  emit() { if (this.sim) this.onUpdate?.(this); }

  destroy() { this.onUpdate = null; this.pause(); }
}

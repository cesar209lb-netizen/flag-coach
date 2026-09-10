// Play simulation. Produces a deterministic, frame-sampled timeline that the
// animation scrubs through: routes, pre-snap motion, snap, handoffs/pitches,
// passes (with the throw leading the receiver), a simple defense model, the rusher,
// flag pulls, sacks and the pass clock.

import { autoPassTarget, defenseOf, lookById } from './model.js';

export const DT = 1 / 60;
const SNAP_TIME = 0.28;
const PASS_SPEED = 16;   // yds/s
const PITCH_SPEED = 10;
const DEF_SPEED = 5.6;
const RUSH_SPEED = 5.4;
const TAG_R = 0.8;       // defender this close pulls the flag
const INT_R = 0.4;       // defender this close to the catch point picks it off
const PBU_R = 0.9;       // …or knocks it down
const MAN_LAG = 20;      // frames a man defender trails a receiver running straight
const MAN_LAG_PRESS = 14; // pressed up he starts closer, so he gives up less
const ZONE_REACH = 7.5;  // how far a zone defender will come off his area
const BALL_REACT = 0.45; // how long before a defender reads a throw
const CONTEST_R = 1.5;   // arriving this close still counts as contesting
const BREAKAWAY_Y = 22;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export const speedFor = (p, ctx) => 5.2 + ((ctx.ratingsFor?.(p.assigned)?.speed ?? 3) - 1) * 0.4;

// ---------- Offensive paths ----------

function keyframes(pts, speed, cuts, startDelay) {
  const kf = [{ x: pts[0].x, y: pts[0].y, t: 0 }];
  let t = startDelay;
  if (startDelay > 0) kf.push({ x: pts[0].x, y: pts[0].y, t });
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = dist(a, b);
    if (d < 1e-6) continue;
    t += d / speed;
    kf.push({ x: b.x, y: b.y, t });
    if (cuts && i < pts.length - 1) {
      const ang = turnAngle(a, b, pts[i + 1]);
      const pause = 0.38 * Math.max(0, ang - 0.44) / (Math.PI - 0.44); // sharper cut = slower
      if (pause > 0.01) { t += pause; kf.push({ x: b.x, y: b.y, t }); }
    }
  }
  return { kf, total: t };
}

function turnAngle(a, b, c) {
  const v1x = b.x - a.x, v1y = b.y - a.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
  if (!l1 || !l2) return 0;
  return Math.acos(clamp((v1x * v2x + v1y * v2y) / (l1 * l2), -1, 1));
}

function sample(path, t) {
  const kf = path.kf;
  if (t <= kf[0].t) return { x: kf[0].x, y: kf[0].y };
  for (let i = 1; i < kf.length; i++) {
    if (t <= kf[i].t) {
      const a = kf[i - 1], b = kf[i];
      const u = (t - a.t) / (b.t - a.t || 1);
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
  }
  const l = kf[kf.length - 1];
  return { x: l.x, y: l.y };
}

function buildActors(play, ctx) {
  return play.players.map((p) => {
    const speed = speedFor(p, ctx);
    const start = { x: p.x, y: p.y };
    const mPts = [start, ...p.motion.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))];
    const snap = mPts[mPts.length - 1];
    const rPts = [snap, ...p.route.map(([dx, dy]) => ({ x: snap.x + dx, y: snap.y + dy }))];
    return {
      slot: p.slot, p, speed, start,
      motion: keyframes(mPts, speed * 0.6, false, 0),
      route: keyframes(rPts, speed, true, (p.slot === 'QB' ? 0.25 : 0.1) + Math.max(0, p.delay || 0)),
    };
  });
}

function analyticPos(a, t) {
  if (t < 0) {
    const tm = t + a.motion.total;
    return tm <= 0 ? { x: a.start.x, y: a.start.y } : sample(a.motion, tm);
  }
  return sample(a.route, t);
}

// ---------- Ball events ----------

export function resolveEvents(play, actors) {
  const by = Object.fromEntries(actors.map((a) => [a.slot, a]));
  let carrier = 'QB';
  let prevT = SNAP_TIME + 0.05;
  const out = [];
  for (const ev of play.ball) {
    const to = ev.type === 'pass' && !ev.to ? autoPassTarget(play) : ev.to;
    if (!to || !by[to] || to === carrier) { out.push({ id: ev.id, skipped: true, from: carrier, to }); continue; }
    let time = ev.time ?? 1;
    if (ev.type === 'handoff' && ev.auto) time = closestApproach(by[carrier], by[to], prevT);
    time = Math.max(time, prevT);
    out.push({ id: ev.id, type: ev.type, from: carrier, to, time });
    carrier = to;
    prevT = time + 0.2;
  }
  return out;
}

function closestApproach(a, b, from) {
  let best = from, bd = Infinity;
  for (let t = from; t <= from + 3; t += 0.02) {
    const d = dist(analyticPos(a, t), analyticPos(b, t));
    if (d < bd - 1e-6) { bd = d; best = t; }
  }
  return Math.round(best * 100) / 100;
}

// ---------- Defense ----------

// Bunched or stacked receivers put their man defenders on the same spot, where
// they hide each other and read as a missing defender. Fan them apart along the
// line, keeping the group centred and each defender's own cushion.
const FAN_GAP = 1.7;
function fanOut(men, W) {
  if (men.length < 2) return;
  const order = [...men].sort((a, b) => a.x - b.x);
  const ideal = order.map((d) => d.x);
  for (let i = 1; i < order.length; i++) {
    if (order[i].x - order[i - 1].x < FAN_GAP) order[i].x = order[i - 1].x + FAN_GAP;
  }
  // Slide the fanned group back so it stays centred on where it started.
  const drift = order.reduce((t, d, i) => t + (d.x - ideal[i]), 0) / order.length;
  order.forEach((d, i) => {
    d.x = clamp(d.x - drift, 1, W - 1);
    // The pre-snap goal keeps this offset, so shadowing motion stays legible.
    d.fan = d.x - ideal[i];
  });
}

// Where the defense lines up, given the offense's pre-snap spots. Pure: no
// simulation, cheap enough to call on every drag frame in the play designer.
// `spots` is [{slot, x, y}] for the whole offense.
export function alignDefense(spots, def, ctx) {
  const W = ctx.W;
  const look = lookById(def.look);
  const cov = def.coverage || 'none';
  const rush = def.rush !== false;
  const qb = spots.find((s) => s.slot === 'QB');
  const defs = [];
  const zone = (ax, ay, deep = false) => {
    const anchorY = ay + look.depth;
    const y = Math.max(1.5, deep ? anchorY - 3 : anchorY);
    return {
      kind: 'zone', ax, ay: anchorY, deep, x: ax, y, vx: 0, vy: 0,
      speed: DEF_SPEED * 0.97, pre: { x: ax, y },
    };
  };
  if (rush) {
    const spot = look.rushSpot === 'right' ? clamp(W * 0.5 + 7, 1.5, W - 1.5)
      : look.rushSpot === 'left' ? clamp(W * 0.5 - 7, 1.5, W - 1.5)
        : qb ? qb.x : W / 2;
    defs.push({ kind: 'rush', spot, x: spot, y: ctx.rushDistance, vx: 0, vy: 0, speed: RUSH_SPEED });
  }
  if (cov === 'man') {
    const cushion = Math.max(0.8, look.cushion);
    const men = spots.filter((s) => s.slot !== 'QB').map((s) => {
      const inside = Math.sign(W / 2 - s.x) || 1;
      const shade = look.shade === 'outside' ? -inside : inside;
      return {
        kind: 'man', target: s.slot, shade, cushion, fan: 0,
        x: clamp(s.x + shade * 0.8, 1, W - 1), y: cushion, vx: 0, vy: 0, speed: DEF_SPEED,
      };
    });
    fanOut(men, W);
    defs.push(...men);
    if (!rush) defs.push(zone(W / 2, 9));
  } else if (cov === 'zone22') {
    defs.push(zone(W * 0.27, 5), zone(W * 0.73, 5), zone(W * 0.3, 13, true), zone(W * 0.7, 13, true));
    if (!rush) defs.push(zone(W / 2, 8));
  } else if (cov === 'zone31') {
    defs.push(zone(W * 0.18, 5), zone(W * 0.5, 6), zone(W * 0.82, 5));
    if (rush) defs.push(zone(W / 2, 14, true));
    else defs.push(zone(W * 0.3, 14, true), zone(W * 0.7, 14, true));
  }
  return defs;
}

// Pre-snap alignment straight from a play, for the designer overlay.
// `override` previews a defense without touching the saved play.
export function alignFor(play, ctx, override = null) {
  const spots = play.players.map((p) => ({ slot: p.slot, x: p.x, y: p.y }));
  return alignDefense(spots, override || defenseOf(play), ctx);
}

function buildDefense(play, actors, ctx) {
  const spots = actors.map((a) => ({ slot: a.slot, x: a.start.x, y: a.start.y }));
  return alignDefense(spots, defenseOf(play), ctx);
}

function accelerate(o, tvx, tvy, acc) {
  let ax = tvx - o.vx, ay = tvy - o.vy;
  const al = Math.hypot(ax, ay), lim = acc * DT;
  if (al > lim) { ax *= lim / al; ay *= lim / al; }
  o.vx += ax; o.vy += ay;
}

function steer(o, g, maxS, acc) {
  const dx = g.x - o.x, dy = g.y - o.y, L = Math.hypot(dx, dy);
  const want = Math.min(maxS, L * 3);
  accelerate(o, L > 1e-4 ? (dx / L) * want : 0, L > 1e-4 ? (dy / L) * want : 0, acc);
  o.x += o.vx * DT;
  o.y += o.vy * DT;
}

const lead = (s, k) => ({ x: s.x + s.vx * k, y: s.y + s.vy * k });

// ---------- Simulation ----------

export function simulate(play, ctx) {
  const W = ctx.W;
  const actors = buildActors(play, ctx);
  const idx = Object.fromEntries(actors.map((a, i) => [a.slot, i]));
  const events = resolveEvents(play, actors).filter((e) => !e.skipped);
  const motionMax = Math.max(0, ...actors.map((a) => a.motion.total));
  const t0 = -(motionMax + 0.6);
  const defs = buildDefense(play, actors, ctx);
  const hasCoverage = defs.some((d) => d.kind !== 'rush');
  const off = actors.map((a) => ({ ...analyticPos(a, t0), vx: 0, vy: 0, free: false }));
  const frames = [];
  const hasC = idx.C != null;

  const ball = { mode: 'held', carrier: hasC ? 'C' : 'QB', x: 0, y: 0, h: 0 };
  let snapped = false, evI = 0, result = null, endT = Infinity;
  let possessionT = 0, possessionKind = 'qb', lastKind = 'snap';
  let throwT = null, catchT = null, rushArrive = null, sep = null, now = t0;
  const hardStop = Math.max(ctx.passClock, 4) + 5;

  const predict = (slot, t) => {
    const i = idx[slot], s = off[i];
    return s.free ? { x: s.x + s.vx * (t - now), y: s.y + s.vy * (t - now) } : analyticPos(actors[i], t);
  };

  function finish(kind, at, slot) {
    if (result) return;
    result = { kind, t: now, x: at.x, y: at.y, slot, via: lastKind };
    endT = now + 0.9;
  }

  function launch(kind, fromSlot, toSlot) {
    const t = now;
    const fs = off[idx[fromSlot]];
    const from = { x: fs.x, y: fs.y };
    let t1, to = null;
    if (kind === 'snap') { t1 = t + SNAP_TIME; to = analyticPos(actors[idx[toSlot]], t1); }
    else if (kind === 'handoff' && dist(from, off[idx[toSlot]]) < 2.5) { t1 = t + 0.15; }
    else {
      const v = kind === 'pass' ? PASS_SPEED : PITCH_SPEED;
      t1 = t + dist(from, off[idx[toSlot]]) / v;
      for (let k = 0; k < 6; k++) { to = predict(toSlot, t1); t1 = t + dist(from, to) / v; }
      to = predict(toSlot, t1);
    }
    const len = to ? dist(from, to) : 0;
    Object.assign(ball, {
      mode: 'air', kind, from, to, t0: t, t1, target: toSlot, carrier: null,
      peak: kind === 'pass' ? clamp(len * 0.09, 0.5, 3.2) : kind === 'snap' ? 0.25 : 0.4,
    });
    if (kind === 'pass') throwT = t;
  }

  function give(slot, kind) {
    ball.mode = 'held';
    ball.carrier = slot;
    possessionT = now;
    lastKind = kind;
    possessionKind = slot === 'QB' ? 'qb' : kind === 'catch' ? 'catch' : 'run';
    if (kind === 'catch') off[idx[slot]].free = true;
  }

  function arrive() {
    if (ball.kind !== 'pass') { give(ball.target, ball.kind); return; }
    const cp = ball.to;
    let nd = 99;
    for (const d of defs) if (d.kind !== 'rush') nd = Math.min(nd, dist(d, cp));
    catchT = now;
    sep = nd;
    lastKind = 'pass';
    const deadBall = (kind) => { ball.mode = 'dead'; finish(kind, cp, ball.target); };
    if (cp.x < 0 || cp.x > W) return deadBall('oobpass');
    if (nd < INT_R) return deadBall('int');
    if (nd < PBU_R) return deadBall('pbu');
    give(ball.target, 'catch');
  }

  // Zone defenders divide the receivers between them instead of each drifting at
  // whoever happens to be nearest — which used to put two defenders on one man
  // and leave another standing alone. Nearest pair first, one claim per receiver;
  // a defender left without one holds his area, which is the job.
  function assignZones() {
    const zones = defs.filter((d) => d.kind === 'zone');
    const recs = [];
    for (let i = 0; i < actors.length; i++) {
      if (actors[i].slot !== 'QB' && off[i].y >= -1) recs.push(i);
    }
    const claim = new Map(), taken = new Set();

    const pairs = [];
    for (const d of zones) {
      for (const i of recs) {
        const s = off[i];
        const gap = Math.hypot(s.x - d.ax, s.y - d.ay);
        if (gap > ZONE_REACH) continue;
        // A deep defender answers for the deepest threat; a short one takes what
        // is in front of him rather than chasing something over the top.
        const bias = d.deep ? Math.max(0, 12 - s.y) * 0.35 : Math.max(0, s.y - 8) * 0.35;
        pairs.push({ d, i, cost: gap + bias });
      }
    }
    pairs.sort((a, b) => a.cost - b.cost);
    for (const pr of pairs) {
      if (claim.has(pr.d) || taken.has(pr.i)) continue;
      claim.set(pr.d, { i: pr.i, commit: false });
      taken.add(pr.i);
    }

    // Anyone still running free gets picked up by the nearest spare defender,
    // even from outside his area. A stretched zone beats a receiver nobody has —
    // holding an empty patch of grass while a man runs open is the one thing a
    // zone is not allowed to do.
    for (const i of recs) {
      if (taken.has(i)) continue;
      let pick = null, bd = Infinity;
      for (const d of zones) {
        if (claim.has(d)) continue;
        const dd = dist(off[i], d);
        if (dd < bd) { bd = dd; pick = d; }
      }
      if (!pick) continue;
      claim.set(pick, { i, commit: true });
      taken.add(i);
    }
    return claim;
  }

  function stepDefense(step) {
    const t = now;
    const zoneClaim = assignZones();
    const carrierS = ball.mode === 'held' ? off[idx[ball.carrier]] : null;
    const pursuit = carrierS && !result && ((possessionKind !== 'qb' && t - possessionT > 0.35) || (possessionKind === 'qb' && carrierS.y > 0.5));
    const qbS = off[idx.QB];
    for (const d of defs) {
      let goal, maxS = d.speed, acc = 13;
      if (t < 0) {
        maxS = 3.5;
        if (d.kind === 'man') { const tp = off[idx[d.target]]; goal = { x: tp.x + d.shade * 0.8 + d.fan, y: d.cushion }; }
        else if (d.kind === 'zone') goal = d.pre;
        else goal = { x: d.spot, y: ctx.rushDistance };
      } else if (result && ball.mode !== 'held') {
        goal = { x: d.x, y: d.y };
      } else if (d.kind === 'rush') {
        if (t < 0.2) goal = { x: d.x, y: d.y };
        else if (carrierS) goal = lead(carrierS, 0.25);
        else if (ball.mode === 'air' && ball.kind === 'pass') goal = ball.to;
        else goal = lead(qbS, 0.2);
      } else if (pursuit) {
        // Aim further ahead of the runner the farther away the defender is (take an angle).
        goal = lead(carrierS, clamp(dist(d, carrierS) / (d.speed + 1), 0.2, 1));
        maxS = d.speed + 0.2;
      } else if (ball.mode === 'air' && ball.kind === 'pass' && t - ball.t0 > BALL_REACT
        // Break on the throw only if he can actually get there: distance against
        // what is left of the flight. A fixed radius sent defenders chasing balls
        // they could never reach and left them standing by ones they could.
        && dist(d, ball.to) <= (d.speed + 0.2) * Math.max(0, ball.t1 - t) + CONTEST_R) {
        goal = ball.to;
        maxS = d.speed + 0.2;
      } else if (d.kind === 'man') {
        const ti = idx[d.target];
        // Pressed up he starts closer and gives up less ground than off coverage.
        const lagFrames = d.cushion <= 2 ? MAN_LAG_PRESS : MAN_LAG;
        const lag = frames[Math.max(0, step - lagFrames)]?.off;
        const rp = lag ? { x: lag[ti * 2], y: lag[ti * 2 + 1] } : off[ti];
        // Press starts tight and stays tight; off coverage closes from its cushion.
        goal = { x: rp.x + d.shade * 0.5, y: rp.y + Math.max(1.2, Math.min(3, d.cushion) - 1.3 * t) };
        acc = 11;
      } else {
        const anchor = { x: d.ax, y: d.ay };
        const claimed = zoneClaim.get(d);
        const best = claimed ? off[claimed.i] : null;
        if (!best) goal = anchor;
        // Sole responsibility: go and get him rather than drifting from the anchor.
        else if (claimed.commit) goal = { x: best.x, y: best.y + (d.deep ? 1.6 : 0.5) };
        else if (d.deep) goal = { x: anchor.x + (best.x - anchor.x) * 0.55, y: Math.max(anchor.y - 2, best.y + 2.2) };
        else goal = { x: anchor.x + clamp((best.x - anchor.x) * 0.75, -5, 5), y: anchor.y + clamp((best.y - anchor.y) * 0.75, -3, 4) };
      }
      steer(d, goal, maxS, acc);
    }
  }

  for (let step = 0; step < 2400; step++) {
    const t = (now = t0 + step * DT);

    // Offense
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i], s = off[i];
      const hasBall = ball.mode === 'held' && ball.carrier === a.slot;
      if (!s.free && hasBall && possessionKind === 'run' && t > a.route.total + 0.05 && !events.slice(evI).some((e) => e.from === a.slot)) {
        s.free = true;
      }
      if (s.free) {
        if (result || !hasBall) {
          s.vx *= 0.9; s.vy *= 0.9;
        } else {
          let dx = 0, dy = 1, nd = 99, near = null;
          for (const d of defs) { const dd = dist(d, s); if (dd < nd) { nd = dd; near = d; } }
          if (near && nd < 5) dx += ((s.x - near.x) / (nd || 1)) * 1.1 * (1 - nd / 5);
          if (s.x < 2) dx += 0.8;
          if (s.x > W - 2) dx -= 0.8;
          const L = Math.hypot(dx, dy);
          accelerate(s, (dx / L) * a.speed, (dy / L) * a.speed, 9);
        }
        s.x += s.vx * DT;
        s.y += s.vy * DT;
      } else {
        const q = analyticPos(a, t);
        s.vx = (q.x - s.x) / DT; s.vy = (q.y - s.y) / DT;
        s.x = q.x; s.y = q.y;
      }
    }

    // Ball
    if (!snapped && t >= 0) {
      snapped = true;
      if (hasC) launch('snap', 'C', 'QB'); else give('QB', 'snap');
    }
    if (snapped && !result && ball.mode === 'held' && evI < events.length) {
      const ev = events[evI];
      if (ball.carrier !== ev.from) evI = events.length;
      else if (t >= ev.time) { evI++; launch(ev.type, ev.from, ev.to); }
    }
    if (ball.mode === 'held') {
      const s = off[idx[ball.carrier]];
      if (!snapped) { ball.x = s.x; ball.y = s.y + 0.75; ball.h = 0.1; }
      else { ball.x = s.x + 0.6; ball.y = s.y + 0.2; ball.h = 0.35; }
    } else if (ball.mode === 'air') {
      const u = clamp((t - ball.t0) / (ball.t1 - ball.t0), 0, 1);
      const dest = ball.to || off[idx[ball.target]];
      ball.x = ball.from.x + (dest.x - ball.from.x) * u;
      ball.y = ball.from.y + (dest.y - ball.from.y) * u;
      ball.h = 0.35 + 4 * ball.peak * u * (1 - u);
      if (t >= ball.t1) arrive();
    } else {
      ball.h = Math.max(0, ball.h - 2.5 * DT);
    }

    stepDefense(step);

    // Whistles
    if (snapped && !result && ball.mode === 'held') {
      const c = ball.carrier, s = off[idx[c]];
      const rusher = defs.find((d) => d.kind === 'rush');
      if (rusher && rushArrive == null && dist(rusher, off[idx.QB]) < 1.6) rushArrive = t;
      let nd = 99;
      for (const d of defs) nd = Math.min(nd, dist(d, s));
      if (possessionKind === 'qb') {
        if (s.y <= 0.5) {
          if (nd < TAG_R && t > SNAP_TIME + 0.1) finish('sack', s, c);
          else if (t >= ctx.passClock) finish('clock', s, c);
        } else if (nd < TAG_R) finish('qbrun', s, c);
      } else if (t - possessionT > 0.12) {
        if (nd < TAG_R) finish('flag', s, c);
        else if (s.x < 0 || s.x > W) finish('oob', s, c);
        else if (s.y >= BREAKAWAY_Y) finish('breakaway', s, c);
      }
    }
    if (snapped && !result && t >= hardStop) finish('none', ball, ball.carrier);

    // Record
    const fo = new Float32Array(actors.length * 2), open = new Float32Array(actors.length), fd = new Float32Array(defs.length * 2);
    for (let i = 0; i < actors.length; i++) {
      fo[i * 2] = off[i].x; fo[i * 2 + 1] = off[i].y;
      let m = 99;
      for (const d of defs) if (d.kind !== 'rush') m = Math.min(m, dist(d, off[i]));
      open[i] = m;
    }
    defs.forEach((d, j) => { fd[j * 2] = d.x; fd[j * 2 + 1] = d.y; });
    frames.push({
      t, off: fo, def: fd, open, bx: ball.x, by: ball.y, bh: ball.h,
      carrier: ball.mode === 'held' ? idx[ball.carrier] : -1,
    });
    if (t >= endT) break;
  }

  const sim = {
    t0, endT: frames[frames.length - 1].t, frames, hasCoverage,
    defs: defs.map((d) => ({ kind: d.kind, target: d.target || null, shade: d.shade || 0 })),
    actors: actors.map((a) => a.slot),
    events, throwT, catchT, sep,
    rushArrive: rushArrive ?? rushETA(play, actors, ctx),
    target: events.find((e) => e.type === 'pass')?.to || null,
  };
  sim.result = describe(result, sim, play, ctx);
  return sim;
}

// When would an unblocked rusher reach a QB who keeps the ball? Used for the timing marker.
function rushETA(play, actors, ctx) {
  if (play.defense?.rush === false) return null;
  const qb = actors.find((a) => a.slot === 'QB');
  if (!qb) return null;
  const spot = lookById(defenseOf(play).look).rushSpot;
  const rx = spot === 'right' ? clamp(ctx.W * 0.5 + 7, 1.5, ctx.W - 1.5)
    : spot === 'left' ? clamp(ctx.W * 0.5 - 7, 1.5, ctx.W - 1.5) : qb.start.x;
  const r = { x: rx, y: ctx.rushDistance, vx: 0, vy: 0 };
  for (let t = 0; t < 8; t += DT) {
    const q = analyticPos(qb, t);
    if (t >= 0.2) steer(r, q, RUSH_SPEED, 13);
    if (dist(r, q) < TAG_R) return Math.round(t * 10) / 10;
  }
  return null;
}

export function frameAt(sim, t) {
  const i = Math.round((t - sim.t0) / DT);
  return sim.frames[clamp(i, 0, sim.frames.length - 1)];
}

function describe(r, sim, play, ctx) {
  if (!r) return { kind: 'none', tone: 'neutral', title: 'No result', detail: '', t: sim.endT, yards: 0, caught: false };
  const nameOf = (slot) => ctx.nameOf?.(slot) || slot;
  const yards = Math.round(r.y);
  const yds = `${yards > 0 ? '+' : ''}${yards} yd${Math.abs(yards) === 1 ? '' : 's'}`;
  const s = sim.sep;
  const sepTxt = s == null ? '' : s >= 3 ? `Wide open — ${s.toFixed(1)} yds of space` : s >= 1.8 ? `Open — ${s.toFixed(1)} yds of space` : `Tight window — ${s.toFixed(1)} yds of space`;
  const caught = r.via === 'catch';
  const gainTone = yards >= 8 ? 'great' : yards >= 3 ? 'good' : yards > 0 ? 'ok' : 'warn';
  const base = { kind: r.kind, t: r.t, x: r.x, y: r.y, yards, caught, slot: r.slot };
  const runVerb = r.via === 'pitch' ? 'Pitch' : 'Handoff';
  switch (r.kind) {
    case 'flag':
      return caught
        ? { ...base, tone: gainTone, title: `Complete to ${nameOf(r.slot)} · ${yds}`, detail: `${sepTxt} · caught at ${sim.catchT.toFixed(1)}s` }
        : { ...base, tone: gainTone, title: `${runVerb} to ${nameOf(r.slot)} · ${yds}`, detail: 'Flag pulled' };
    case 'breakaway':
      return { ...base, tone: 'great', title: caught ? `Complete to ${nameOf(r.slot)} · breakaway!` : `${runVerb} to ${nameOf(r.slot)} · breakaway!`, detail: caught ? sepTxt : 'Nobody could catch them' };
    case 'oob':
      return { ...base, tone: gainTone, title: `${caught ? 'Complete to' : `${runVerb} to`} ${nameOf(r.slot)} · out of bounds at ${yds}`, detail: caught ? sepTxt : '' };
    case 'sack':
      return { ...base, tone: 'bad', title: `Sacked · ${yds}`, detail: sim.rushArrive ? `Rusher got there at ${sim.rushArrive.toFixed(1)}s — get the ball out sooner` : 'Get the ball out sooner' };
    case 'clock':
      return { ...base, tone: 'bad', title: `Pass clock expired (${ctx.passClock}s)`, detail: 'The QB held the ball too long' };
    case 'qbrun':
      return { ...base, tone: 'warn', title: `QB run · ${yds}`, detail: "Most leagues don't let the QB run past the line unless the ball was handed off" };
    case 'pbu':
      return { ...base, tone: 'bad', title: `Pass to ${nameOf(r.slot)} broken up`, detail: `Defender was ${s.toFixed(1)} yd from the catch point` };
    case 'int':
      return { ...base, tone: 'bad', title: `Pass to ${nameOf(r.slot)} likely intercepted`, detail: 'A defender was sitting right on the throw' };
    case 'oobpass':
      return { ...base, tone: 'bad', title: `Pass to ${nameOf(r.slot)} sails out of bounds`, detail: 'The receiver is past the sideline when the ball gets there' };
    default:
      return { ...base, tone: 'neutral', title: 'Play keeps going', detail: '' };
  }
}

// How good an outcome is, for ranking one throw against another: a catch with
// separation and yards beats a catch in traffic, and a turnover is worst.
function scoreOutcome(sim, releaseT) {
  const r = sim.result;
  return r.caught
    ? 20 + Math.min(sim.sep ?? 0, 6) * 3 + clamp(r.yards, -3, 25) * 0.5 - releaseT * 0.6
    : r.kind === 'int' ? -20 : r.kind === 'sack' ? -15 : -8;
}

// Try every release time for a pass and keep the one that works best. `to`
// overrides the play's own target, which is how receivers get compared.
export function bestThrowTime(play, ctx, evId, { to = undefined, step = 0.1 } = {}) {
  const i = play.ball.findIndex((b) => b.id === evId);
  if (i < 0) return null;
  const minT = i > 0 ? (play.ball[i - 1].time || 0.5) + 0.3 : 0.5;
  const base = structuredClone(play);
  if (to !== undefined) base.ball[i].to = to;
  let best = null;
  for (let rt = minT; rt <= ctx.passClock - 0.2 + 1e-6; rt += step) {
    const p2 = structuredClone(base);
    p2.ball[i].time = Math.round(rt * 10) / 10;
    const s = simulate(p2, ctx);
    const score = scoreOutcome(s, p2.ball[i].time);
    if (!best || score > best.score) best = { time: p2.ball[i].time, score, result: s.result, sep: s.sep ?? null };
  }
  return best;
}


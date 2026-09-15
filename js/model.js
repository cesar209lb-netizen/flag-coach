// Data shapes, formations, route presets and starter plays.
// Field coordinates are in yards: x = 0 (left sideline) → W (right sideline),
// y = yards from the line of scrimmage (negative = backfield, positive = downfield).

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const r2 = (n) => Math.round(n * 100) / 100;

export const SLOTS = ['QB', 'C', 'X', 'Y', 'Z'];
export const SLOT_COLORS = { QB: '#f1f5f9', C: '#a855f7', X: '#ef4444', Y: '#facc15', Z: '#3b82f6' };
export const SLOT_TEXT = { QB: '#0f172a', C: '#ffffff', X: '#ffffff', Y: '#1c1917', Z: '#ffffff' };
export const ROUTE_COLORS = { ...SLOT_COLORS, QB: '#e2e8f0' };

export const POSITIONS = ['QB', 'C', 'WR', 'RB', 'Rusher', 'CB', 'Safety', 'LB'];
export const RATINGS = [
  { key: 'speed', label: 'Speed' },
  { key: 'hands', label: 'Hands' },
  { key: 'routes', label: 'Route Running' },
  { key: 'flags', label: 'Flag Pulling' },
  { key: 'throwing', label: 'Throwing' },
  { key: 'iq', label: 'Football IQ' },
];
export const DEFAULT_TAGS = ['Quick Pass', 'Intermediate Pass', 'Deep Shot', 'Run', 'Red Zone', 'Short Yardage', 'Trick Play', 'Extra Point'];

export const COVERAGES = [
  { id: 'none', name: 'None', desc: 'Just your routes' },
  { id: 'man', name: 'Man', desc: 'Each defender follows a receiver' },
  { id: 'zone22', name: 'Zone 2-2', desc: '2 short, 2 deep areas' },
  { id: 'zone31', name: 'Zone 3-1', desc: '3 short, 1 deep safety' },
];

// A "look" is alignment only — where the defense stands before the snap. It
// composes with any coverage: cushion and shade move the man defenders, depth
// shifts the zone anchors, and rushSpot slides the rusher along the rush line.
export const LOOKS = [
  { id: 'base', name: 'Base', desc: 'Standard depth, rusher over the ball', cushion: 5.5, shade: 'auto', depth: 0, rushSpot: 'mid' },
  { id: 'press', name: 'Press', desc: 'Up on the line, in their face', cushion: 1.4, shade: 'outside', depth: -1, rushSpot: 'mid' },
  { id: 'off', name: 'Off', desc: 'Big cushion — nothing deep', cushion: 8, shade: 'inside', depth: 1.5, rushSpot: 'mid' },
  { id: 'inside', name: 'Inside Shade', desc: 'Takes away the middle', cushion: 4, shade: 'inside', depth: 0, rushSpot: 'mid' },
  { id: 'outside', name: 'Outside Shade', desc: 'Funnels everything inside', cushion: 4, shade: 'outside', depth: 0, rushSpot: 'mid' },
  { id: 'wideR', name: 'Wide Rush R', desc: 'Rusher off the right edge', cushion: 5.5, shade: 'auto', depth: 0, rushSpot: 'right' },
  { id: 'wideL', name: 'Wide Rush L', desc: 'Rusher off the left edge', cushion: 5.5, shade: 'auto', depth: 0, rushSpot: 'left' },
  { id: 'bail', name: 'Bail', desc: 'Everyone drops — protect the deep ball', cushion: 7.5, shade: 'inside', depth: 3, rushSpot: 'mid' },
  { id: 'crash', name: 'Crash', desc: 'All shallow, nobody deep', cushion: 2.5, shade: 'auto', depth: -2.5, rushSpot: 'mid' },
];

export const lookById = (id) => LOOKS.find((l) => l.id === id) || LOOKS[0];
export const coverageById = (id) => COVERAGES.find((c) => c.id === id) || COVERAGES[0];

// Plays saved before looks existed have no `look`; they read as Base.
export const defenseOf = (play) => ({ look: 'base', coverage: 'man', rush: true, ...(play?.defense || {}) });

export function defenseLabel(def) {
  const cov = coverageById(def.coverage);
  if (def.coverage === 'none') return def.rush === false ? 'No defense' : 'Rush only';
  return `${cov.name} · ${lookById(def.look).name}`;
}

// The only alignment that has a left/right side, so the only one a flip changes.
export const mirrorLook = (id) => (id === 'wideR' ? 'wideL' : id === 'wideL' ? 'wideR' : id);

export const sameDefense = (a, b) =>
  a.coverage === b.coverage && a.look === b.look && (a.rush !== false) === (b.rush !== false);

export function defaultSettings() {
  return {
    id: 'settings', teamName: 'My Team',
    fieldWidth: 30, passClock: 7, rushDistance: 8, halfMinutes: 20,
    activeSeasonId: null, lastBackupAt: null, lastChangeAt: null,
    tags: [...DEFAULT_TAGS], seeded: false, createdAt: Date.now(),
  };
}

export function seasonNameFor(date = new Date()) {
  const m = date.getMonth();
  return `${m >= 7 ? 'Fall' : m >= 4 ? 'Summer' : m >= 1 ? 'Spring' : 'Winter'} ${date.getFullYear()}`;
}

export const newSeason = (name) => ({ id: uid(), name, createdAt: Date.now(), roster: [] });

// A game logged from the sideline. `log` is every play called, in order, with
// what it actually did — which is the only way the app ever learns whether a
// play works against real people rather than the simulation.
// Flag football has no chains. A series is four downs to cross midfield, and
// crossing buys four more to score — so the only first down there is is the one
// you get by crossing. `phase` is which half of that you are in.
export const PHASES = { mid: 'to midfield', score: 'to score' };
export const phaseOf = (game) => (game?.phase === 'score' ? 'score' : 'mid');
// Five on the field, always. It is the whole game.
export const ON_FIELD = 5;

// A running clock that survives the app being closed: `ms` is what was left
// when it last stopped, and `since` is when it started running. The time left
// is always derived, never counted down in a variable that a backgrounded tab
// would stop updating.
export const newClock = (minutes = 20) => ({ half: 1, minutes, ms: Math.round(minutes * 60000), since: null });
export const clockLeft = (c) => (!c ? 0 : Math.max(0, c.since ? c.ms - (Date.now() - c.since) : c.ms));
export const clockRunning = (c) => !!c?.since && clockLeft(c) > 0;
export function clockText(ms) {
  const t = Math.ceil(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export const newGame = (seasonId, opponent = '', minutes = 20) => ({
  id: uid(), seasonId, opponent, date: Date.now(),
  us: 0, them: 0, down: 1, phase: 'mid', log: [],
  clock: newClock(minutes),
  // Who is playing where. Every snap records its own copy of both, so
  // substituting mid-drive does not rewrite who played the earlier plays.
  spots: {}, onField: [],
  createdAt: Date.now(), updatedAt: Date.now(),
});

// The five on the field, in the order the positions are listed, from whichever
// shape the game happens to carry: spots for a game that assigned positions,
// the flat list for one recorded before positions existed.
export function fieldSpots(game) {
  const spots = game?.spots || {};
  const used = SLOTS.map((slot) => ({ slot, playerId: spots[slot] || null }));
  if (used.some((s) => s.playerId)) return used;
  const flat = game?.onField || [];
  return SLOTS.map((slot, i) => ({ slot, playerId: flat[i] || null }));
}
export const spotIds = (spots) => SLOTS.map((s) => spots[s]).filter(Boolean);

// Where the next snap stands after this one. `crossed` is the coach saying the
// play carried the ball over midfield, which is the first down.
export function nextDown(game, result, crossed) {
  const phase = phaseOf(game);
  // A score or a giveaway ends the possession; you get the ball back needing
  // midfield again, same as the start of any series.
  if (result === 'td' || result === 'turnover') return { down: 1, phase: 'mid' };
  if (crossed && phase === 'mid') return { down: 1, phase: 'score' };
  // Four and out, whichever half of the series you were in.
  if (game.down >= 4) return { down: 1, phase: 'mid' };
  return { down: game.down + 1, phase };
}

// What a logged play did. Yards are the yards gained on that snap.
export const PLAY_RESULTS = [
  { id: 'td', label: 'Touchdown', tone: 'great' },
  { id: 'gain', label: 'Gain', tone: 'good' },
  { id: 'none', label: 'No gain', tone: 'warn' },
  { id: 'loss', label: 'Loss / sack', tone: 'bad' },
  { id: 'turnover', label: 'Turnover', tone: 'bad' },
];

// Rolled up per play id: how often it was called and what it actually did.
export function playStats(games, playId) {
  let calls = 0, yards = 0, tds = 0, worked = 0, turnovers = 0;
  for (const g of games) {
    for (const e of g.log || []) {
      if (e.playId !== playId) continue;
      calls++;
      yards += e.yards || 0;
      if (e.result === 'td') { tds++; worked++; } else if (e.result === 'gain') worked++;
      if (e.result === 'turnover') turnovers++;
    }
  }
  return calls
    ? { calls, yards, tds, turnovers, avg: Math.round((yards / calls) * 10) / 10, workRate: Math.round((worked / calls) * 100) }
    : null;
}

// Playing time, counted in snaps — the unit a flag game actually has. Rows come
// back fewest first, which is the order a coach subs from.
export function snapRows(game, roster) {
  const log = game?.log || [];
  const counts = new Map();
  for (const e of log) for (const id of e.onField || []) counts.set(id, (counts.get(id) || 0) + 1);
  const total = log.filter((e) => (e.onField || []).length).length;
  return {
    total,
    rows: roster.map(({ player, entry }) => {
      const snaps = counts.get(player.id) || 0;
      return { player, entry, snaps, pct: total ? Math.round((snaps / total) * 100) : 0 };
    }).sort((a, b) => a.snaps - b.snaps || a.player.first.localeCompare(b.player.first)),
  };
}

// Deliberately minimal: a first name, a photo, and the jersey number on the
// season entry. No surname, contact or medical field — this syncs to a store on
// the internet, and none of that belongs there for a child.
export const newPlayer = () => ({
  id: uid(), first: '', photo: null,
  createdAt: Date.now(), updatedAt: Date.now(),
});

export const newRosterEntry = (playerId) => ({
  playerId, number: '', positions: [],
  ratings: { speed: 3, hands: 3, routes: 3, flags: 3, throwing: 3, iq: 3 },
});

export function overall(ratings) {
  const vals = Object.values(ratings || {});
  if (!vals.length) return 0;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.round(40 + ((avg - 1) / 4) * 59);
}

// ---------- Geometry helpers on a play player ----------

export function snapPos(p) {
  if (p.motion?.length) { const [dx, dy] = p.motion[p.motion.length - 1]; return { x: p.x + dx, y: p.y + dy }; }
  return { x: p.x, y: p.y };
}
export const absMotion = (p) => [{ x: p.x, y: p.y }, ...p.motion.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))];
export function absRoute(p) {
  const s = snapPos(p);
  return [s, ...p.route.map(([dx, dy]) => ({ x: s.x + dx, y: s.y + dy }))];
}

// ---------- Formations ----------
// Offsets are from the center of a 30-yard-wide field; x scales with field width.

const BASE = { QB: [0, -5], C: [0, -0.6] };
export const FORMATIONS = [
  { id: 'spread', name: 'Spread', desc: '2 left · 1 right', pos: { X: [-12, -1], Y: [-7, -1], Z: [12, -1] } },
  { id: 'trips', name: 'Trips Right', desc: '3 receivers right', pos: { X: [4.5, -1], Y: [8, -1.5], Z: [12, -1] } },
  { id: 'twins', name: 'Twins Right', desc: '1 left · 2 right', pos: { X: [-12, -1], Y: [7, -1], Z: [12, -1] } },
  { id: 'bunch', name: 'Bunch Right', desc: 'Tight triangle', pos: { X: [7, -1], Y: [8.8, -2.6], Z: [5.2, -2.6] } },
  // All four line players shoulder to shoulder in the middle, 2.2 yards apart,
  // with the QB directly behind the snapper. Overrides the BASE QB and C spots.
  { id: 'bunchMid', name: 'Bunch Middle', desc: '4 across, QB behind center',
    pos: { QB: [-1.1, -5], C: [-1.1, -1], X: [-3.3, -1], Y: [1.1, -1], Z: [3.3, -1] } },
  { id: 'stack', name: 'Stack Left', desc: 'Stacked receivers', pos: { X: [-10, -1], Y: [-10, -3.5], Z: [12, -1] } },
  { id: 'pistol', name: 'Pistol', desc: 'RB behind QB', pos: { X: [-12, -1], Y: [0, -8, 'RB'], Z: [12, -1] } },
  { id: 'split', name: 'Split Back', desc: 'RB beside QB', pos: { X: [-12, -1], Y: [-3, -5, 'RB'], Z: [12, -1] } },
];

export function formationPos(f, slot, W) {
  const [dx, dy, label] = f.pos[slot] || BASE[slot];
  return { x: r2(W / 2 + (dx * W) / 30), y: dy, label: label || slot };
}

export function newPlay({ name = 'New Play', formationId = 'spread', W = 30 } = {}) {
  const f = FORMATIONS.find((x) => x.id === formationId) || FORMATIONS[0];
  return {
    id: uid(), name, formation: f.name, tags: [], rating: 0, notes: '',
    players: SLOTS.map((slot) => {
      const { x, y, label } = formationPos(f, slot, W);
      return { slot, label, x, y, route: [], routeId: null, motion: [], read: null, assigned: null, delay: 0 };
    }),
    ball: [{ id: uid(), type: 'pass', to: null, time: 2.0, auto: false }],
    defense: { look: 'base', coverage: 'man', rush: true },
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

export function applyFormation(play, formationId, W) {
  const f = FORMATIONS.find((x) => x.id === formationId);
  if (!f) return;
  for (const p of play.players) {
    const { x, y, label } = formationPos(f, p.slot, W);
    p.x = x; p.y = y;
    if (p.slot !== 'QB' && p.slot !== 'C') p.label = label;
  }
  play.formation = f.name;
}

// ---------- Defensive calls ----------
// The coverages in COVERAGES are opponents the simulator generates to test a
// play against. These are the other thing: the defence this team actually runs,
// drawn by the coach and taught to the players, with a job written on every
// defender.

export const DEF_JOBS = [
  { id: 'rush', label: 'Rush', desc: 'Goes after the quarterback' },
  { id: 'man', label: 'Man', desc: 'Follows one receiver everywhere' },
  { id: 'zone', label: 'Zone', desc: 'Guards an area, takes whoever comes in' },
];

// Five defenders: a rusher, two on the outside, one in the middle and one deep.
// Spread across the field's width so the call reads the same on any field size.
const DEF_SPOTS = [
  { label: 'R', kind: 'rush', dx: 0, y: 8 },
  { label: 'C1', kind: 'man', target: 'X', dx: -11, y: 5.5 },
  { label: 'C2', kind: 'man', target: 'Z', dx: 11, y: 5.5 },
  { label: 'LB', kind: 'man', target: 'Y', dx: -3, y: 5 },
  { label: 'S', kind: 'zone', dx: 3, y: 12, deep: true },
];

export const newDefPlay = ({ name = 'New Defense', W = 30 } = {}) => ({
  id: uid(), name, notes: '', tags: [], rating: 0, showAgainst: 'spread',
  defenders: DEF_SPOTS.map((d) => ({
    id: uid(), label: d.label, kind: d.kind, target: d.target || null,
    deep: !!d.deep, shade: 0,
    x: r2(W / 2 + (d.dx * W) / 30), y: d.y,
  })),
  createdAt: Date.now(), updatedAt: Date.now(),
});

// The offence to draw behind a defensive call, so a defender can see what they
// are lining up against. Ghosts only — never saved into the call.
export function ghostOffense(formationId, W) {
  const f = FORMATIONS.find((x) => x.id === formationId) || FORMATIONS[0];
  return SLOTS.map((slot) => {
    const { x, y, label } = formationPos(f, slot, W);
    return { slot, label, x, y, route: [], routeId: null, motion: [], read: null, assigned: null, delay: 0 };
  });
}

export const defJobLabel = (d) => (d.kind === 'rush' ? 'Rush'
  : d.kind === 'man' ? `Man on ${d.target || '—'}`
    : d.deep ? 'Deep zone' : 'Short zone');

// ---------- Routes ----------
// Route points are [out, depth]: "out" is toward the receiver's nearest sideline.

export const ROUTES = [
  { id: 'go', name: 'Go', pts: [[0, 20]] },
  { id: 'slant', name: 'Slant', pts: [[0, 2], [-7, 8]] },
  { id: 'quickout', name: 'Quick Out', pts: [[0, 4], [6, 4]] },
  { id: 'out', name: 'Out', pts: [[0, 7], [8, 7]] },
  { id: 'in', name: 'In', pts: [[0, 7], [-9, 7]] },
  { id: 'post', name: 'Post', pts: [[0, 8], [-7, 17]] },
  { id: 'corner', name: 'Corner', pts: [[0, 8], [6, 15]] },
  { id: 'curl', name: 'Curl', pts: [[0, 8], [-1, 6.5]] },
  { id: 'hitch', name: 'Hitch', pts: [[0, 5], [0, 4]] },
  { id: 'comeback', name: 'Comeback', pts: [[0, 10], [2.5, 8]] },
  { id: 'drag', name: 'Drag', pts: [[0, 2], [-15, 3]] },
  { id: 'flat', name: 'Flat', pts: [[3, 1], [8, 2]] },
  { id: 'wheel', name: 'Wheel', pts: [[4, 1], [6, 4], [6, 18]] },
  { id: 'sluggo', name: 'Slant & Go', pts: [[0, 3], [-2, 5], [-2, 19]] },
  { id: 'outup', name: 'Out & Up', pts: [[0, 5], [3, 5], [3.5, 19]] },
  { id: 'cross', name: 'Deep Cross', pts: [[0, 6], [-14, 11]] },
  { id: 'arrow', name: 'Arrow', pts: [[5, 4]] },
  { id: 'swing', name: 'Swing', pts: [[3, -1], [6, -0.5], [8, 2]] },
];

export const QB_ROUTES = [
  { id: 'qbstay', name: 'Stay', pts: [], abs: true },
  { id: 'drop', name: 'Drop Back', pts: [[0, -2]], abs: true },
  { id: 'rollR', name: 'Roll Right', pts: [[4, -1.5], [8, -1]], abs: true },
  { id: 'rollL', name: 'Roll Left', pts: [[-4, -1.5], [-8, -1]], abs: true },
  { id: 'stepup', name: 'Step Up', pts: [[0, 1.5]], abs: true },
];

export const routeById = (id) => ROUTES.find((r) => r.id === id) || QB_ROUTES.find((r) => r.id === id);

export function routeLabel(p) {
  if (!p.route.length) return p.slot === 'QB' ? 'Stay' : 'No route';
  return routeById(p.routeId)?.name || 'Custom';
}

export function applyRoute(p, route, W) {
  const dir = route.abs ? 1 : p.x < W / 2 - 0.25 ? -1 : 1;
  const s = snapPos(p);
  p.route = route.pts.map(([o, d]) => {
    const x = Math.max(0.5, Math.min(W - 0.5, s.x + o * dir));
    return [r2(x - s.x), d];
  });
  p.routeId = route.id;
}

// Swaps the side named in a play, formation or description, keeping the case
// it was written in: "Trips Right" ⇄ "Trips Left", "3 receivers right" ⇄ "…left".
const swapLR = (s) => String(s).replace(/\b(right|left)\b/gi, (m) => {
  const to = m.toLowerCase() === 'right' ? 'left' : 'right';
  return m[0] === m[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to;
});

export function flipPlay(play, W) {
  for (const p of play.players) {
    p.x = r2(W - p.x);
    p.route = p.route.map(([dx, dy]) => [-dx, dy]);
    p.motion = p.motion.map(([dx, dy]) => [-dx, dy]);
    if (p.routeId === 'rollR') p.routeId = 'rollL'; else if (p.routeId === 'rollL') p.routeId = 'rollR';
  }
  if (play.defense?.look) play.defense = { ...play.defense, look: mirrorLook(play.defense.look) };
  play.formation = swapLR(play.formation || '');
  play.name = swapLR(play.name);
}

// ---------- Grouping plays by formation ----------
// The playbook is organised by formation first, so a coach picks the look they
// want and only then the play. The formation name on the play is the group key
// — including the mirrored names a flip produces, like "Trips Left".

export const formationKey = (play) => (play.formation || '').trim() || 'Custom';

// What we know about a formation name: the model formation it came from, and
// whether it is that formation mirrored.
export function formationInfo(name) {
  const f = FORMATIONS.find((x) => x.name === name);
  if (f) return { id: f.id, name: f.name, desc: f.desc, flipped: false };
  const base = FORMATIONS.find((x) => x.name === swapLR(name));
  if (base) return { id: base.id, name, desc: swapLR(base.desc), flipped: true };
  return { id: null, name, desc: 'Custom alignment', flipped: false };
}

// An empty play in a formation, for drawing the alignment on a picker card.
export function formationSample(name, W) {
  const info = formationInfo(name);
  if (!info.id) return null;
  const play = newPlay({ formationId: info.id, W });
  if (info.flipped) flipPlay(play, W);
  return play;
}

// Every name a play can file under: the model's formations and the mirrored
// names a flip produces, in the order the picker should offer them.
export function formationNames() {
  const out = [];
  for (const f of FORMATIONS) {
    out.push(f.name);
    const m = swapLR(f.name);
    if (m !== f.name) out.push(m);
  }
  return out;
}

// The formation a play's players are actually standing in, if they are close
// enough to one of the model's — mirrored ones included. Drag people into a
// new look and the app can offer to file the play where it now belongs,
// instead of leaving it under whatever it started as. Null when the alignment
// is the coach's own and matches nothing.
export function matchFormation(play, W, tol = 1.6) {
  let best = null;
  for (const f of FORMATIONS) {
    for (const mirror of [false, true]) {
      let sum = 0;
      for (const slot of SLOTS) {
        const at = formationPos(f, slot, W);
        const x = mirror ? W - at.x : at.x;
        const p = play.players.find((q) => q.slot === slot);
        if (!p) { sum = Infinity; break; }
        sum += Math.hypot(p.x - x, p.y - at.y);
      }
      const avg = sum / SLOTS.length;
      if (avg <= tol && (!best || avg < best.avg)) best = { name: mirror ? swapLR(f.name) : f.name, avg };
    }
  }
  return best ? best.name : null;
}

// Plays grouped by the formation they file under, biggest group first, ties in
// the model's order with a mirrored variant right after what it mirrors and
// anything custom last. The playbook picker and game day's play caller both
// read from this, so a formation means the same thing in both.
export function formationGroups(plays) {
  const byName = new Map();
  for (const p of plays) {
    const k = formationKey(p);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(p);
  }
  const out = [];
  const take = (name) => {
    const list = byName.get(name);
    if (!list) return;
    byName.delete(name);
    out.push({ name, plays: list, ...passRunCount(list), ...formationInfo(name) });
  };
  for (const f of FORMATIONS) {
    take(f.name);
    const mirrored = [...byName.keys()].find((n) => formationInfo(n).id === f.id);
    if (mirrored) take(mirrored);
  }
  for (const name of [...byName.keys()].sort()) take(name);
  return out.map((g, i) => ({ ...g, order: i })).sort((a, b) => b.total - a.total || a.order - b.order);
}

// A play is a pass if the quarterback ever throws it. Everything else — a
// handoff, a pitch, a sweep — is a run, even when it starts out looking like a
// pass. A flea flicker ends in a throw, so it counts as a pass.
export const isPassPlay = (play) => (play.ball || []).some((b) => b.type === 'pass');

// How many of a list of plays are passes and how many are runs.
export function passRunCount(plays) {
  let pass = 0;
  for (const p of plays) if (isPassPlay(p)) pass++;
  return { pass, run: plays.length - pass, total: plays.length };
}

export function copyPlay(play, nameSuffix = ' (copy)') {
  const c = structuredClone(play);
  c.id = uid();
  c.name = play.name + nameSuffix;
  c.ball.forEach((b) => { b.id = uid(); });
  c.createdAt = c.updatedAt = Date.now();
  delete c.starter;
  return c;
}

// The receiver the QB is looking for on the (first) pass.
export function passTarget(play) {
  const pass = play.ball.find((b) => b.type === 'pass');
  if (!pass) return null;
  if (pass.to) return pass.to;
  return autoPassTarget(play);
}
// Whoever the ball finishes with if the play goes as drawn: the last handoff or
// pitch, or the receiver the throw is aimed at. The game-day default for "who
// got it", so a play that works only needs one tap.
export function ballEndsWith(play) {
  const ball = play.ball || [];
  for (let i = ball.length - 1; i >= 0; i--) {
    if (ball[i].to) return ball[i].to;
    if (ball[i].type === 'pass') return autoPassTarget(play);
  }
  return 'QB';
}

export function autoPassTarget(play) {
  const byRead = play.players.filter((p) => p.read && p.slot !== 'QB').sort((a, b) => a.read - b.read)[0];
  if (byRead) return byRead.slot;
  return play.players.find((p) => p.slot !== 'QB' && p.route.length)?.slot || null;
}

// ---------- Starter playbook ----------

export function starterPlays(W) {
  const make = (name, formationId, spec) => {
    const play = newPlay({ name, formationId, W });
    for (const [slot, s] of Object.entries(spec.players)) {
      const p = play.players.find((x) => x.slot === slot);
      if (s.motion) p.motion = s.motion;
      if (s.route) applyRoute(p, routeById(s.route), W);
      if (s.pts) { p.route = s.pts; p.routeId = 'custom'; }
      if (s.read) p.read = s.read;
    }
    play.ball = spec.ball.map((b) => ({ id: uid(), auto: false, ...b }));
    play.defense = spec.defense;
    play.tags = spec.tags;
    play.notes = spec.notes;
    play.rating = spec.rating || 0;
    play.starter = true;
    return play;
  };

  return [
    make('Quick Slants', 'spread', {
      players: { X: { route: 'go', read: 3 }, Y: { route: 'slant', read: 1 }, Z: { route: 'slant', read: 2 }, C: { route: 'hitch', read: 4 } },
      ball: [{ type: 'pass', to: 'Y', time: 1.2 }],
      defense: { look: 'press', coverage: 'man', rush: true }, tags: ['Quick Pass'], rating: 4,
      notes: 'Ball out fast! Hit Y right after the cut. X runs the defender deep to open the middle.',
    }),
    make('Flood Right', 'trips', {
      players: { X: { route: 'flat', read: 2 }, Y: { route: 'out', read: 1 }, Z: { route: 'go', read: 3 }, C: { route: 'hitch' } },
      ball: [{ type: 'pass', to: 'Y', time: 1.7 }],
      defense: { look: 'base', coverage: 'zone22', rush: true }, tags: ['Quick Pass'], rating: 3,
      notes: 'High-low on the right side. Z clears deep, Y sits in the space, X is the safe check-down.',
    }),
    make('Mesh', 'spread', {
      players: {
        X: { pts: [[0, 2], [15, 2.5]], read: 1 },
        Z: { pts: [[0, 4], [-15, 4.5]], read: 2 },
        Y: { route: 'corner', read: 3 },
        C: { route: 'hitch' },
      },
      ball: [{ type: 'pass', to: 'X', time: 1.6 }],
      defense: { look: 'inside', coverage: 'man', rush: true }, tags: ['Quick Pass', 'Short Yardage'], rating: 4,
      notes: 'X and Z cross underneath — X goes under, Z goes over. Great against man.',
    }),
    make('Snag', 'bunch', {
      players: {
        Z: { pts: [[1, 5], [1.5, 4.5]], read: 1 },
        Y: { route: 'flat', read: 2 },
        X: { route: 'corner', read: 3 },
        C: { route: 'drag' },
      },
      ball: [{ type: 'pass', to: 'Z', time: 1.3 }],
      defense: { look: 'crash', coverage: 'zone31', rush: true }, tags: ['Quick Pass', 'Red Zone'], rating: 3,
      notes: 'Triangle read. Z sits down in the hole, Y to the flat, X corner if the safety bites.',
    }),
    make('Jet Sweep', 'spread', {
      players: {
        Z: { motion: [[-6, -2]], pts: [[-6, -1], [-13, -0.5], [-15, 5], [-15, 14]] },
        X: { route: 'go' }, Y: { route: 'go' }, C: { route: 'hitch' },
      },
      ball: [{ type: 'handoff', to: 'Z', time: 1, auto: true }],
      defense: { look: 'crash', coverage: 'man', rush: true }, tags: ['Run'], rating: 3,
      notes: 'Z in motion — snap when Z is behind the center. Hand off on the run. X and Y take their defenders deep.',
    }),
    make('Flea Flicker', 'pistol', {
      players: {
        Y: { pts: [[1.2, 2.5], [3, 5], [4, 5.5]] },
        QB: { pts: [[0, -2.5]] },
        Z: { route: 'go', read: 1 },
        X: { route: 'post', read: 2 },
        C: { route: 'hitch' },
      },
      ball: [
        { type: 'handoff', to: 'Y', time: 0.6, auto: true },
        { type: 'pitch', to: 'QB', time: 1.1 },
        { type: 'pass', to: 'Z', time: 2.2 },
      ],
      defense: { look: 'off', coverage: 'man', rush: true }, tags: ['Trick Play', 'Deep Shot'], rating: 5,
      notes: 'Sell the run! RB takes the handoff, pitches back to QB, and Z should be behind everybody.',
    }),
  ];
}

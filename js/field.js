// SVG markup for the field, routes, players, defenders and the ball.
// SVG y is flipped: svgY = -fieldY so downfield points up the screen.

import { ROUTE_COLORS, SLOT_COLORS, SLOT_TEXT, absMotion, absRoute, passTarget } from './model.js';
import { esc } from './ui.js';

export const EDIT_VIEW = { yMin: -10, yMax: 23 };
export const THUMB_VIEW = { yMin: -9, yMax: 17 };
// Huddle mode crops into this generously tall field so the view can zoom to the
// play and still fill any screen shape without running out of painted grass.
export const HUDDLE_VIEW = { yMin: -24, yMax: 46 };

const f2 = (n) => Math.round(n * 100) / 100;

export function viewBox(W, v = EDIT_VIEW, pad = 0.8) {
  return `${-pad} ${-v.yMax} ${W + pad * 2} ${v.yMax - v.yMin}`;
}

export function fieldMarkup(W, { view = EDIT_VIEW, rushDistance = 8, showRush = true, numbers = true, pad = 0.8 } = {}) {
  const top = -view.yMax;
  const height = view.yMax - view.yMin;
  let s = `<rect x="${-pad - 1}" y="${top - 1}" width="${W + pad * 2 + 2}" height="${height + 2}" fill="#1a5424"/>`;
  for (let y = Math.floor(view.yMin / 5) * 5; y < view.yMax; y += 5) {
    s += `<rect x="0" y="${-(y + 5)}" width="${W}" height="5" fill="${Math.abs(y / 5) % 2 ? '#2d8739' : '#287c33'}"/>`;
  }
  for (let y = Math.ceil(view.yMin); y <= view.yMax; y++) {
    if (y === 0) continue;
    if (y % 5 === 0) {
      s += `<line x1="0" x2="${W}" y1="${-y}" y2="${-y}" stroke="#fff" stroke-opacity=".42" stroke-width=".12"/>`;
    } else {
      s += `<path d="M0 ${-y}h.7M${W - 0.7} ${-y}h.7M${W / 2 - 0.35} ${-y}h.7" stroke="#fff" stroke-opacity=".3" stroke-width=".1"/>`;
    }
  }
  if (numbers) {
    for (let y = 5; y <= view.yMax - 1; y += 5) {
      s += `<text x="1.5" y="${-y + 0.45}" class="yd" font-size="1.25">${y}</text><text x="${W - 1.5}" y="${-y + 0.45}" class="yd" font-size="1.25" text-anchor="end">${y}</text>`;
    }
  }
  if (showRush && rushDistance < view.yMax) {
    s += `<line x1="0" x2="${W}" y1="${-rushDistance}" y2="${-rushDistance}" stroke="#fca5a5" stroke-opacity=".7" stroke-width=".14" stroke-dasharray=".7 .5"/>`;
    s += `<text x="${W / 2}" y="${-rushDistance - 0.45}" class="yd rush" font-size=".85" text-anchor="middle">RUSH LINE · ${rushDistance} YDS</text>`;
  }
  s += `<rect x="0" y="${top - 1}" width="${W}" height="${height + 2}" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width=".22"/>`;
  s += `<line x1="0" x2="${W}" y1="0" y2="0" stroke="#60a5fa" stroke-width=".3"/>`;
  return s;
}

export function pathD(pts) {
  return pts.map((q, i) => `${i ? 'L' : 'M'}${f2(q.x)} ${f2(-q.y)}`).join('');
}

// Returns a path that stops short of the end plus an arrowhead polygon.
export function arrowPath(pts, size = 0.95) {
  const n = pts.length;
  if (n < 2) return { d: '', head: '' };
  const end = pts[n - 1];
  let k = n - 2;
  while (k > 0 && Math.hypot(end.x - pts[k].x, end.y - pts[k].y) < 0.05) k--;
  const prev = pts[k];
  const L = Math.hypot(end.x - prev.x, end.y - prev.y) || 1;
  const ux = (end.x - prev.x) / L, uy = (end.y - prev.y) / L;
  const cut = Math.min(size * 0.7, L * 0.6);
  const body = [...pts.slice(0, n - 1), { x: end.x - ux * cut, y: end.y - uy * cut }];
  const bx = end.x - ux * size, by = end.y - uy * size;
  const px = -uy * size * 0.55, py = ux * size * 0.55;
  const head = `${f2(end.x)},${f2(-end.y)} ${f2(bx + px)},${f2(-(by + py))} ${f2(bx - px)},${f2(-(by - py))}`;
  return { d: pathD(body), head };
}

function routeEnd(pts) {
  const n = pts.length;
  const end = pts[n - 1];
  if (n < 2) return { x: end.x, y: end.y + 2 };
  const prev = pts[n - 2];
  const L = Math.hypot(end.x - prev.x, end.y - prev.y) || 1;
  return { x: end.x + ((end.x - prev.x) / L) * 1.6, y: end.y + ((end.y - prev.y) / L) * 1.6 };
}

export function routesMarkup(play, { selected = null, faint = false, badges = true, target = undefined, scale = 1 } = {}) {
  const tgt = target === undefined ? passTarget(play) : target;
  let under = '', over = '', marks = '';
  for (const p of play.players) {
    const col = ROUTE_COLORS[p.slot];
    const dim = faint ? 0.4 : selected && selected !== p.slot ? 0.5 : 1;
    if (p.motion.length) {
      const d = pathD(absMotion(p));
      under += `<path d="${d}" fill="none" stroke="#06140a" stroke-opacity=".35" stroke-width="${0.46 * scale}" stroke-linecap="round" stroke-linejoin="round"/>`;
      over += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${0.24 * scale}" stroke-dasharray=".55 .42" stroke-linecap="round" opacity="${dim}"/>`;
    }
    if (p.route.length) {
      const pts = absRoute(p);
      const w = (tgt === p.slot ? 0.42 : 0.32) * scale;
      const { d, head } = arrowPath(pts, 0.95 * scale);
      under += `<path d="${d}" fill="none" stroke="#06140a" stroke-opacity=".4" stroke-width="${w + 0.3}" stroke-linecap="round" stroke-linejoin="round"/>`;
      over += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" opacity="${dim}"/>`;
      over += `<polygon points="${head}" fill="${col}" stroke="#06140a" stroke-opacity=".35" stroke-width=".08" opacity="${dim}"/>`;
    }
    if (badges && p.read && p.slot !== 'QB') {
      const pts = p.route.length ? absRoute(p) : [{ x: p.x, y: p.y }];
      const b = routeEnd(pts);
      marks += `<g transform="translate(${f2(b.x)} ${f2(-b.y)})" opacity="${faint ? 0.75 : dim}"><circle r=".78" fill="#0b1016" stroke="${col}" stroke-width=".18"/><text y=".32" font-size=".92" class="badge-t" text-anchor="middle">${p.read}</text></g>`;
    }
  }
  return under + over + marks;
}

let clipSeq = 0;

export function tokenMarkup(p, info = {}, { r = 1.15, showName = false, selected = false } = {}) {
  const col = SLOT_COLORS[p.slot];
  const txt = SLOT_TEXT[p.slot];
  const label = esc(p.label || p.slot);
  let s = `<circle class="hit" r="${r + 0.9}" fill="transparent"/>`;
  s += `<circle class="sel-ring" r="${r + 0.5}" fill="none" stroke="#fff" stroke-width=".2" stroke-dasharray=".7 .4" opacity="${selected ? 1 : 0}"/>`;
  s += `<circle r="${r + 0.1}" cy=".18" fill="#000" opacity=".35"/>`;
  if (info.photo) {
    const id = `clip${++clipSeq}`;
    s += `<clipPath id="${id}"><circle r="${r}"/></clipPath><circle r="${r}" fill="${col}"/>`;
    s += `<image href="${info.photo}" x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice"/>`;
    s += `<circle r="${r - 0.12}" fill="none" stroke="${col}" stroke-width=".26"/>`;
    const br = r * 0.46;
    s += `<g transform="translate(${f2(r * 0.78)} ${f2(-r * 0.78)})"><circle r="${br}" fill="${col}" stroke="#0b1016" stroke-width=".08"/><text y="${f2(br * 0.36)}" font-size="${f2(br * (label.length > 1 ? 0.95 : 1.2))}" fill="${txt}" class="tok-t" text-anchor="middle">${label}</text></g>`;
  } else {
    s += `<circle r="${r}" fill="${col}" stroke="#0b1016" stroke-width=".12"/>`;
    const fs = r * (label.length > 1 ? 0.82 : 1.05);
    s += `<text y="${f2(fs * 0.36)}" font-size="${f2(fs)}" fill="${txt}" class="tok-t" text-anchor="middle">${label}</text>`;
  }
  if (showName && info.first) {
    s += `<text y="${f2(r + 1.15)}" font-size=".8" class="tok-name" text-anchor="middle">${esc(info.first)}${info.number ? ` #${esc(info.number)}` : ''}</text>`;
  }
  return s;
}

export function defenderMarkup(d) {
  if (d.kind === 'rush') {
    return `<path d="M-1.05 -.8H1.05L0 1.05z" fill="#b91c1c" stroke="#fecaca" stroke-width=".16" stroke-linejoin="round"/><text y=".05" font-size=".75" class="def-t" text-anchor="middle">R</text>`;
  }
  let s = `<path d="M-1 -.75H1L0 1z" fill="#111827" stroke="#f87171" stroke-width=".16" stroke-linejoin="round"/>`;
  if (d.kind === 'man' && d.target) {
    s += `<text y="-.02" font-size=".62" class="def-t" text-anchor="middle">${esc(d.target)}</text>`;
  }
  return s;
}

// A half-ring on the side the man defender is shading — tells the receiver
// which way the break is open.
function leverageMarkup(d) {
  if (d.kind !== 'man' || !d.shade) return '';
  const right = d.shade > 0;
  return `<path d="M0 -1.5A1.5 1.5 0 0 ${right ? 1 : 0} 0 1.5" fill="none" stroke="#fca5a5" stroke-opacity=".8" stroke-width=".22" stroke-linecap="round"/>`;
}

const ZONE_R = (d) => (d.deep ? 5.8 : 4.6);

export function zonesMarkup(defs) {
  let s = '';
  for (const d of defs) {
    if (d.kind !== 'zone') continue;
    const r = ZONE_R(d);
    s += `<ellipse cx="${f2(d.x)}" cy="${f2(-d.y)}" rx="${f2(r)}" ry="${f2(r * 0.68)}"
      fill="#f87171" fill-opacity=".07" stroke="#f87171" stroke-opacity=".3" stroke-width=".13" stroke-dasharray=".7 .5"/>`;
  }
  return s;
}

// The static pre-snap defense drawn into the designer. `ghosts` is a second,
// faded set of positions (e.g. where they'll be when the ball is thrown).
export function defenseMarkup(defs, { zones = true, leverage = true, ghosts = null } = {}) {
  let s = zones ? zonesMarkup(defs) : '';
  if (ghosts) {
    for (const g of ghosts) {
      s += `<g transform="translate(${f2(g.x)} ${f2(-g.y)})" opacity=".28">${defenderMarkup(g)}</g>`;
    }
  }
  for (const d of defs) {
    s += `<g transform="translate(${f2(d.x)} ${f2(-d.y)})">${leverage ? leverageMarkup(d) : ''}${defenderMarkup(d)}</g>`;
  }
  return s;
}

export function ballMarkup() {
  return `<ellipse class="b-shadow" rx=".5" ry=".22" fill="#000" opacity=".35"/>
    <g class="b-body"><ellipse rx=".58" ry=".36" fill="#8b4a1f" stroke="#2b1405" stroke-width=".07"/>
    <path d="M-.22 0H.22M-.12-.08v.16M0-.08v.16M.12-.08v.16" stroke="#fff" stroke-width=".05"/></g>`;
}

export function playThumb(play, W, rushDistance = 8) {
  return `<svg class="field-svg thumb" viewBox="${viewBox(W, THUMB_VIEW, 0.3)}" preserveAspectRatio="xMidYMid slice">
    ${fieldMarkup(W, { view: THUMB_VIEW, rushDistance, showRush: false, numbers: false, pad: 0.3 })}
    ${routesMarkup(play, { badges: false, scale: 1.25 })}
    ${play.players.map((p) => `<g transform="translate(${f2(p.x)} ${f2(-p.y)})">${tokenMarkup(p, {}, { r: 1.2 })}</g>`).join('')}
  </svg>`;
}

// Game day: the sideline screen. Score, down and distance, who is on the field,
// and a log of every play called with what it actually did.
//
// Built for a coach holding a tablet in one hand with eight seconds before the
// next snap. Calling a play is formation first and then the play, drawn, the
// same way the playbook is organised — so the thing you are looking for is
// where you already know it is. Recording what happened is one tap on a big
// button, with who got the ball filled in from the play itself.
//
// Everything it records feeds back into the playbook: a play's real average
// sits next to the simulated one, which is the only way to find out whether the
// thing that works on paper works against people.

import { h, icon, iconBtn, btn, segmented, openSheet, confirmDialog, promptDialog, toast, initials } from '../ui.js';
import { state, subscribe, activeSeason, saveGame, saveSettings, deleteGame, gameById, playById, rosterFor } from '../store.js';
import {
  newGame, PLAY_RESULTS, PHASES, ON_FIELD, SLOTS, SLOT_COLORS, SLOT_TEXT, phaseOf, nextDown,
  newClock, clockLeft, clockRunning, clockText, fieldSpots, spotIds,
  playStats, uid, formationGroups, formationSample, isPassPlay, ballEndsWith, snapRows,
} from '../model.js';
import { playThumb } from '../field.js';
import { openHuddle } from './huddle.js';

// Which game is on screen, and the play waiting for its result.
let currentId = null;
let pending = null;
let gainYards = 5;
let tab = 'log';
// The formation the play caller is showing. Kept between calls: a coach often
// runs two or three out of the same look before moving on.
let callFormation = null;

let rerenderFn = null;
const rerender = () => rerenderFn?.();

export function mount(root) {
  const render = () => root.replaceChildren(build());
  rerenderFn = render;
  render();
  const unsub = subscribe(render);
  // The clock redraws itself in place. Re-rendering the whole screen once a
  // second would throw away scroll position and any half-finished tap.
  const timer = setInterval(() => tickClock(root), 250);
  return { destroy: () => { rerenderFn = null; clearInterval(timer); unsub(); } };
}

// ---------- Clock ----------

const clockOf = (game) => game.clock || newClock(state.settings.halfMinutes || 20);

function tickClock(root) {
  const game = current();
  if (!game) return;
  const c = clockOf(game);
  const el = root.querySelector('.gd-clock-time');
  if (el) {
    const left = clockLeft(c);
    el.textContent = clockText(left);
    el.classList.toggle('low', left <= 60000 && left > 0);
    el.classList.toggle('done', left === 0);
  }
  // Ran out while nobody was looking: stop it once, and say so.
  if (c.since && clockLeft(c) === 0) {
    saveGame({ ...game, clock: { ...c, ms: 0, since: null } });
    toast(`End of half ${c.half}`, { tone: 'warn', duration: 6000 });
  }
}

async function toggleClock(game) {
  const c = clockOf(game);
  if (clockRunning(c)) {
    await saveGame({ ...game, clock: { ...c, ms: clockLeft(c), since: null } });
  } else {
    if (clockLeft(c) === 0) return;
    await saveGame({ ...game, clock: { ...c, since: Date.now() } });
  }
  rerender();
}

function clockSheet(game) {
  const c = clockOf(game);
  const body = h('div');
  let minutes = c.minutes || state.settings.halfMinutes || 20;
  const draw = () => body.replaceChildren(
    h('div', { class: 'field-label' }, 'Half length',
      segmented([10, 15, 20, 25].map((n) => ({ value: n, label: `${n} min` })), minutes, (v) => { minutes = v; draw(); })),
    h('p', { class: 'p-help' }, 'Starting the next half puts the clock back to full and counts the half up. Restarting this one just puts the time back.'),
    h('div', { class: 'btn-row' },
      btn(`Start half ${c.half + 1}`, async () => {
        await saveGame({ ...game, clock: { half: c.half + 1, minutes, ms: minutes * 60000, since: null } });
        rerender();
        toast(`Half ${c.half + 1} — clock reset`);
      }, { kind: 'primary', iconName: 'next' }),
      btn('Restart this half', async () => {
        await saveGame({ ...game, clock: { ...c, minutes, ms: minutes * 60000, since: null } });
        rerender();
      }, { kind: 'ghost', iconName: 'restart' })));
  draw();
  openSheet({
    title: `Half ${c.half}`,
    size: 'sm',
    body,
    actions: [{ label: 'Done', kind: 'primary', onClick: () => saveSettings({ halfMinutes: minutes }, { silent: true }) }],
  });
}

// The clock lives in the middle of the board with the down, the way a real
// scoreboard reads — and a row of its own was the row the result buttons needed.
function clockBar(game) {
  const c = clockOf(game);
  const left = clockLeft(c);
  const running = clockRunning(c);
  return h('div', { class: 'gd-clock' },
    h('button', {
      class: `gd-clock-btn ${running ? 'on' : ''}`, onclick: () => toggleClock(game),
      'aria-label': running ? 'Stop the clock' : 'Start the clock', disabled: left === 0,
    }, icon(running ? 'pause' : 'play')),
    h('button', {
      class: `gd-clock-time ${left <= 60000 && left > 0 ? 'low' : ''} ${left === 0 ? 'done' : ''}`,
      onclick: () => clockSheet(game), title: `Half ${c.half}`,
    }, clockText(left)),
    h('span', { class: `gd-half ${left === 0 ? 'over' : ''}` }, left === 0 ? `H${c.half} over` : `H${c.half}`));
}

const gamesForSeason = () => {
  const s = activeSeason();
  return state.games.filter((g) => !s || g.seasonId === s.id).slice().reverse();
};

function current() {
  const list = gamesForSeason();
  return (currentId && gameById(currentId)) || list[0] || null;
}

const ORD = ['1st', '2nd', '3rd', '4th'];
const ordinal = (d) => ORD[Math.min(d, 4) - 1] || `${d}th`;

// Starts straight away rather than asking for an opponent first: a prompt
// cannot tell "cancelled" from "left blank", and nobody wants a dialog between
// them and the first snap. The name is set afterwards by tapping the header.
async function startGame() {
  const season = activeSeason();
  const g = newGame(season?.id || null, '', state.settings.halfMinutes || 20);
  // Carry the last game's lineup over — it is usually the same five kids, and
  // an empty field on the first snap is a worse default than a stale one.
  const prev = gamesForSeason()[0];
  const roster = rosterFor();
  if (prev?.onField?.length) g.onField = prev.onField.filter((id) => roster.some((r) => r.player.id === id));
  await saveGame(g);
  currentId = g.id;
  pending = null;
  rerender();
}

async function renameGame(game) {
  const v = await promptDialog({ title: 'Opponent', label: 'Who are you playing?', value: game.opponent || '', confirmText: 'Save' });
  if (v === null) return;
  await saveGame({ ...game, opponent: v });
  rerender();
}

// ---------- Recording ----------

async function record(game, result, yards, crossed = false) {
  const play = pending?.id ? playById(pending.id) : null;
  const entry = {
    id: uid(), playId: pending?.id || null, playName: pending?.name || 'Play',
    // Who got it, as a slot, plus the roster id if somebody is assigned there —
    // the slot survives a roster change, the id is what playing time counts.
    to: pending?.to || null,
    toName: pending?.to ? carrierLabel(play, pending.to, game) : null,
    // The kid at that position when the snap happened, so the log survives a
    // substitution later in the drive.
    toPlayerId: (pending?.to && game.spots?.[pending.to]) || null,
    onField: [...(game.onField || [])],
    spots: { ...(game.spots || {}) },
    down: game.down, phase: phaseOf(game), crossed: crossed || undefined,
    result, yards, at: Date.now(),
  };
  const g = { ...game, log: [...(game.log || []), entry], ...nextDown(game, result, crossed) };
  if (result === 'td') g.us += 6;
  pending = null;
  await saveGame(g);
  rerender();
}

async function undoLast(game) {
  const log = game.log || [];
  if (!log.length) return;
  const last = log[log.length - 1];
  // Put the down back exactly as it was when that play was called.
  const g = { ...game, log: log.slice(0, -1), down: last.down, phase: last.phase || phaseOf(game) };
  if (last.toGo != null) g.toGo = last.toGo;
  if (last.result === 'td') g.us = Math.max(0, g.us - 6);
  await saveGame(g);
  toast('Last play removed');
  rerender();
}

// ---------- Who is on the field ----------

function avatarOf(player, cls = '') {
  return player.photo
    ? h('img', { class: `gd-av ${cls}`.trim(), src: player.photo, alt: '' })
    : h('span', { class: `gd-av ${cls}`.trim() }, initials(player));
}

function lineupBar(game) {
  const roster = rosterFor();
  if (!roster.length) {
    return h('button', { class: 'gd-lineup empty', onclick: () => { location.hash = '#/roster'; } },
      icon('users'), h('span', null, 'Add players on the Roster tab to track who is on the field'));
  }
  const { rows } = snapRows(game, roster);
  const spots = fieldSpots(game);
  const filled = spots.filter((s) => s.playerId).length;
  const onIds = spots.map((s) => s.playerId).filter(Boolean);
  const bench = rows.filter((r) => !onIds.includes(r.player.id));
  const next = bench.slice(0, 2).map((r) => r.player.first).join(', ');
  // One slot per position, always, with the gaps drawn — a position nobody is
  // playing should be as obvious as one somebody is.
  const short = filled < ON_FIELD;
  return h('button', { class: `gd-lineup ${short ? 'short' : ''}`, onclick: () => lineupSheet(game) },
    h('span', { class: 'gd-lineup-label' }, short ? `${filled} of ${ON_FIELD} — tap to fill` : 'On the field'),
    h('span', { class: 'gd-avs' }, ...spots.map(({ slot, playerId }) => {
      const r = roster.find((x) => x.player.id === playerId);
      return h('span', { class: 'gd-av-wrap', title: r ? `${r.player.first} at ${slot}` : slot },
        r ? avatarOf(r.player) : h('span', { class: 'gd-av gap' }),
        h('span', { class: 'gd-av-slot', style: { background: SLOT_COLORS[slot], color: SLOT_TEXT[slot] } }, slot));
    })),
    h('div', { class: 'spacer' }),
    next ? h('span', { class: 'gd-next muted small' }, `Up next: ${next}`) : null,
    icon('next', 'chev'));
}

// Picking the five, by position. Five position cards across the top and the
// squad underneath: tap a player to drop them into the spot you picked (or the
// first empty one), drag them onto a spot, or tap a spot to send that player
// back. The positions are the play's own — the X on this card is the X on every
// diagram in the playbook.
function lineupSheet(game) {
  const roster = rosterFor();
  const body = h('div');
  let spots = Object.fromEntries(fieldSpots(game).map(({ slot, playerId }) => [slot, playerId]));
  let aim = null;   // the position waiting for somebody, if one was tapped
  let doneBtn = null;

  const playerOf = (id) => roster.find((r) => r.player.id === id) || null;
  const firstEmpty = () => SLOTS.find((sl) => !spots[sl]) || null;

  const place = (slot, playerId) => {
    // A player only stands in one place; taking a spot gives up the old one.
    for (const sl of SLOTS) if (spots[sl] === playerId) spots[sl] = null;
    spots[slot] = playerId;
    aim = null;
    draw();
  };
  const clear = (slot) => { spots[slot] = null; aim = slot; draw(); };

  const spotCard = (slot) => {
    const r = playerOf(spots[slot]);
    return h('button', {
      class: `gd-spot ${r ? 'on' : ''} ${aim === slot ? 'aim' : ''}`,
      dataset: { spot: slot },
      onclick: () => { if (r) clear(slot); else { aim = aim === slot ? null : slot; draw(); } },
    },
    h('span', { class: 'gd-spot-tag', style: { background: SLOT_COLORS[slot], color: SLOT_TEXT[slot] } }, slot),
    h('div', { class: 'gd-spot-photo' },
      r ? (r.player.photo
        ? h('img', { src: r.player.photo, alt: '', draggable: 'false' })
        : h('span', { class: 'gd-card-initials' }, initials(r.player)))
        : h('span', { class: 'gd-spot-empty' }, icon('plus'))),
    h('div', { class: 'gd-card-name' }, r ? r.player.first : 'Empty'));
  };

  const benchCard = ({ player, entry, snaps, pct }) => {
    const card = h('button', {
      class: 'gd-card bench',
      dataset: { player: player.id },
      onclick: () => {
        const slot = aim || firstEmpty();
        if (!slot) { toast('Every position is filled — tap one to free it up'); return; }
        place(slot, player.id);
      },
    },
    h('div', { class: 'gd-card-photo' },
      player.photo ? h('img', { src: player.photo, alt: '', draggable: 'false' }) : h('span', { class: 'gd-card-initials' }, initials(player)),
      entry.number ? h('span', { class: 'gd-card-num' }, `#${entry.number}`) : null),
    h('div', { class: 'gd-card-name' }, player.first),
    h('div', { class: 'gd-card-time' },
      h('span', null, `${snaps} snap${snaps === 1 ? '' : 's'}`),
      h('div', { class: 'gd-bar' }, h('i', { style: { width: `${pct}%` } }))));
    dragFrom(card, player.id);
    return card;
  };

  // Dragging a face onto a position. Pointer events rather than HTML5 drag,
  // which a tablet does not give you, and the card captures the pointer so the
  // moves keep coming once the finger leaves it. A drag that never really moved
  // falls through to the card's own tap handler.
  let drag = null;
  const clearOver = () => { for (const el of body.querySelectorAll('.gd-spot.over')) el.classList.remove('over'); };
  const endDrag = () => {
    drag?.ghost?.remove();
    drag?.card.classList.remove('lifted');
    clearOver();
    drag = null;
  };

  function dragFrom(card, playerId) {
    card.addEventListener('pointerdown', (e) => {
      if (drag) return;
      drag = { playerId, id: e.pointerId, x: e.clientX, y: e.clientY, ghost: null, card };
      // Without this the moves stop arriving the moment the finger leaves the
      // card, which is exactly when a drag becomes interesting.
      try { card.setPointerCapture(e.pointerId); } catch { /* no capture here */ }
    });
    card.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.ghost && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
      if (!drag.ghost) {
        drag.ghost = drag.card.cloneNode(true);
        drag.ghost.className = 'gd-card bench gd-ghost';
        document.body.append(drag.ghost);
        drag.card.classList.add('lifted');
      }
      drag.ghost.style.left = `${e.clientX}px`;
      drag.ghost.style.top = `${e.clientY}px`;
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.gd-spot');
      for (const el of body.querySelectorAll('.gd-spot')) el.classList.toggle('over', el === over);
    });
    const finish = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dropped = !!drag.ghost;
      const over = dropped && document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.gd-spot');
      const held = drag.playerId;
      endDrag();
      // Never moved: leave it to the click that is about to follow.
      if (dropped && over?.dataset.spot) place(over.dataset.spot, held);
    };
    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', finish);
  }

  const draw = () => {
    const { rows, total } = snapRows(game, roster);
    const onIds = spotIds(spots);
    const off = rows.filter((r) => !onIds.includes(r.player.id));
    if (doneBtn) doneBtn.disabled = onIds.length !== ON_FIELD;
    body.replaceChildren(
      h('div', { class: `gd-fieldcount ${onIds.length === ON_FIELD ? 'ok' : ''}` },
        h('b', null, `${onIds.length} of ${ON_FIELD} positions filled`),
        h('span', { class: 'muted small' }, aim ? `Tap a player to put them at ${aim}`
          : total ? `${total} snaps logged so far` : 'Tap a player, or drag them onto a spot')),
      h('div', { class: 'gd-spots' }, ...SLOTS.map(spotCard)),
      h('div', { class: 'section-label' }, off.length ? 'Squad — least playing time first' : 'Everybody is in'),
      off.length ? h('div', { class: 'gd-cards' }, ...off.map(benchCard)) : null);
  };
  draw();

  const sheet = openSheet({
    title: 'On the field',
    size: 'lg',
    onClose: endDrag,
    body,
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Done', kind: 'primary',
        onClick: async () => {
          const ids = spotIds(spots);
          if (ids.length !== ON_FIELD) return false;
          await saveGame({ ...game, spots, onField: ids });
          rerender();
        },
      },
    ],
  });
  doneBtn = sheet.panel.querySelector('.sheet-foot .btn.primary');
  if (doneBtn) doneBtn.disabled = spotIds(spots).length !== ON_FIELD;
}

// ---------- Calling a play ----------

// What to call whoever is at a spot: the kid playing that position in this game
// first, then anyone the play itself assigns there, then the position's label.
function carrierLabel(play, slot, game) {
  const playing = game?.spots?.[slot] && state.players.find((x) => x.id === game.spots[slot]);
  if (playing) return playing.first;
  const p = play?.players.find((q) => q.slot === slot);
  if (!p) return slot;
  const assigned = p.assigned && state.players.find((x) => x.id === p.assigned);
  return assigned ? assigned.first : (p.label || slot);
}

function callSheet(game) {
  const W = state.settings.fieldWidth;
  const groups = formationGroups(state.plays);
  const search = h('input', { class: 'input search', type: 'search', placeholder: 'Search every play' });
  const body = h('div', { class: 'gd-call' });
  const crumb = h('div', { class: 'crumb-row' });

  const call = (play) => {
    pending = { id: play.id, name: play.name, to: ballEndsWith(play) };
    sheet.close();
    rerender();
  };

  const playCard = (p) => {
    const st = playStats(state.games, p.id);
    const pass = isPassPlay(p);
    return h('button', { class: 'gd-playcard', onclick: () => call(p) },
      h('div', { class: 'thumb-wrap', html: playThumb(p, W) }),
      h('div', { class: 'gd-playcard-body' },
        h('div', { class: 'gd-playcard-name' }, p.name),
        h('div', { class: 'play-meta' },
          h('span', { class: `kind-tag ${pass ? 'pass' : 'run'}` }, pass ? 'Pass' : 'Run'),
          st ? h('span', null, `${st.avg} avg · ${st.calls} called`) : h('span', null, 'Not called yet'))));
  };

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    crumb.replaceChildren();
    if (q) {
      const hits = state.plays.filter((p) => `${p.name} ${p.formation} ${p.tags.join(' ')}`.toLowerCase().includes(q));
      body.replaceChildren(hits.length
        ? h('div', { class: 'gd-playgrid' }, ...hits.map(playCard))
        : h('p', { class: 'p-help' }, 'No plays match.'));
      return;
    }
    if (callFormation) {
      const g = groups.find((x) => x.name === callFormation);
      if (!g) { callFormation = null; draw(); return; }
      crumb.replaceChildren(h('button', { class: 'crumb', onclick: () => { callFormation = null; draw(); } },
        icon('back'), 'All formations'));
      body.replaceChildren(h('div', { class: 'gd-playgrid' }, ...g.plays.map(playCard)));
      return;
    }
    // Recently called in this game, so a second helping is one tap away.
    const recent = [...new Map((game.log || []).slice(-6).reverse()
      .map((e) => [e.playId, e.playId && playById(e.playId)]).filter(([, p]) => p)).values()].slice(0, 4);
    body.replaceChildren(...[
      recent.length ? h('div', null,
        h('div', { class: 'section-label' }, 'Called already'),
        h('div', { class: 'gd-playgrid' }, ...recent.map(playCard))) : null,
      groups.length ? h('div', null,
        recent.length ? h('div', { class: 'section-label' }, 'Formations') : null,
        h('div', { class: 'formation-grid pick' }, ...groups.map((g) => {
          const sample = g.id ? formationSample(g.name, W) : g.plays[0];
          return h('button', { class: 'formation-card pick', onclick: () => { callFormation = g.name; draw(); } },
            h('div', { class: 'thumb-wrap', html: sample ? playThumb(sample, W) : '' }),
            h('div', { class: 'formation-body' },
              h('div', { class: 'formation-name' }, g.name),
              h('div', { class: 'formation-counts' },
                h('span', { class: 'fc-pill pass' }, `${g.pass} pass`),
                h('span', { class: 'fc-pill run' }, `${g.run} run`))));
        }))) : h('div', { class: 'empty-state' },
        h('div', { class: 'empty-icon' }, icon('playbook')),
        h('h3', null, 'No plays yet'),
        h('p', null, 'Draw a play in the Playbook and it shows up here to call.')),
    ].filter(Boolean));
  };
  search.addEventListener('input', draw);
  draw();

  const sheet = openSheet({
    title: `Call a play · ${ordinal(game.down)} ${PHASES[phaseOf(game)]}`,
    size: 'lg',
    body: h('div', null,
      h('div', { class: 'search-wrap pad' }, icon('search'), search),
      crumb, body),
  });
}

// ---------- The called play, and what it did ----------

function pendingCard(game) {
  const play = pending.id ? playById(pending.id) : null;
  const W = state.settings.fieldWidth;
  const slots = (play?.players || []).map((p) => p.slot);

  const yardRow = h('div', { class: 'gd-yards' },
    iconBtn('back', () => { gainYards = Math.max(0, gainYards - 1); rerender(); }, { title: 'Fewer yards', cls: 'big' }),
    h('span', { class: 'gd-yard-val' }, `${gainYards} yd`),
    iconBtn('next', () => { gainYards += 1; rerender(); }, { title: 'More yards', cls: 'big' }));

  return h('div', { class: 'gd-result' },
    h('div', { class: 'gd-called' },
      play ? h('div', { class: 'gd-called-thumb', html: playThumb(play, W) }) : null,
      h('div', { class: 'gd-called-main' },
        h('div', { class: 'gd-called-name' }, pending.name),
        h('div', { class: 'muted small' }, [play?.formation, `${ordinal(game.down)} ${PHASES[phaseOf(game)]}`].filter(Boolean).join(' · '))),
      // Kept together so they wrap as one block rather than one at a time.
      h('div', { class: 'gd-called-acts' },
        play ? btn('Show team', () => openHuddle([play.id], 0), { iconName: 'expand', kind: 'ghost' }) : null,
        btn('Cancel', () => { pending = null; rerender(); }, { kind: 'ghost' }))),

    slots.length ? h('div', { class: 'gd-to' },
      h('span', { class: 'gd-to-label' }, 'Ball to'),
      h('div', { class: 'gd-to-chips' }, ...slots.map((slot) => h('button', {
        class: `chip-btn ${pending.to === slot ? 'on' : ''}`,
        onclick: () => { pending = { ...pending, to: slot }; rerender(); },
      }, carrierLabel(play, slot, game))))) : null,

    yardRow,
    // The first down of a flag series is crossing midfield, so it is a button of
    // its own rather than something the app infers from a yard count nobody on
    // a sideline actually has. It sits with the touchdown: the two good ones.
    h('div', { class: 'gd-buttons' }, ...PLAY_RESULTS.flatMap((r) => {
      const one = btn(
        r.id === 'gain' ? `Gain ${gainYards}` : r.id === 'loss' ? `Loss ${gainYards}` : r.label,
        () => record(game, r.id, r.id === 'gain' || r.id === 'loss' ? gainYards : 0),
        { kind: `big tone-${r.tone}` });
      if (r.id !== 'td' || phaseOf(game) !== 'mid') return [one];
      return [one, btn(`Crossed midfield +${gainYards}`, () => record(game, 'gain', gainYards, true),
        { kind: 'big tone-great gd-cross' })];
    })));
}

// ---------- Screen ----------

function scoreboard(game) {
  const bump = (side, n) => async () => {
    const g = { ...game };
    g[side] = Math.max(0, g[side] + n);
    await saveGame(g);
    rerender();
  };
  const col = (side, label) => h('div', { class: 'gd-score-col' },
    h('div', { class: 'gd-score-label' }, label),
    h('div', { class: 'gd-score' }, String(game[side])),
    h('div', { class: 'btn-row tight center' },
      btn('+6', bump(side, 6), { kind: 'small ghost' }),
      btn('+1', bump(side, 1), { kind: 'small ghost' }),
      btn('+2', bump(side, 2), { kind: 'small ghost' }),
      btn('−1', bump(side, -1), { kind: 'small ghost' })));

  return h('section', { class: 'gd-board' },
    col('us', state.settings.teamName || 'Us'),
    h('div', { class: 'gd-dd' },
      clockBar(game),
      h('button', { class: 'gd-dd-main', onclick: () => downSheet(game) },
        h('span', { class: 'gd-down' }, `${ordinal(game.down)} down`),
        h('span', { class: `gd-togo ${phaseOf(game)}` }, PHASES[phaseOf(game)]))),
    col('them', game.opponent || 'Them'));
}

// Fixing the down when a tap went wrong, or when the referee disagrees.
function downSheet(game) {
  const body = h('div');
  let down = game.down;
  let phase = phaseOf(game);
  const draw = () => body.replaceChildren(
    h('p', { class: 'p-help' }, 'Four downs to cross midfield, then four more to score. Crossing is the only first down there is.'),
    h('div', { class: 'field-label' }, 'Down',
      segmented([1, 2, 3, 4].map((n) => ({ value: n, label: ordinal(n) })), down, (v) => { down = v; draw(); })),
    h('div', { class: 'field-label' }, 'Going',
      segmented([{ value: 'mid', label: PHASES.mid }, { value: 'score', label: PHASES.score }], phase,
        (v) => { phase = v; draw(); })),
    h('div', { class: 'btn-row' },
      btn('New series', () => { down = 1; phase = 'mid'; draw(); }, { kind: 'ghost', iconName: 'restart' })));
  draw();
  openSheet({
    title: 'Down',
    size: 'sm',
    body,
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Set', kind: 'primary', onClick: async () => { await saveGame({ ...game, down, phase }); rerender(); } },
    ],
  });
}

function logList(game) {
  const log = (game.log || []).slice().reverse();
  if (!log.length) return h('p', { class: 'p-help pad' }, 'Nothing logged yet. Call a play and tap what happened.');
  return h('div', { class: 'gd-log' }, ...log.map((e) => {
    const r = PLAY_RESULTS.find((x) => x.id === e.result);
    const gained = e.result === 'td' ? 'TD' : e.result === 'turnover' ? 'TO'
      : e.result === 'loss' ? `−${Math.abs(e.yards)}` : e.result === 'none' ? '0' : `+${e.yards}`;
    // Games logged before flag downs carried a yards-to-go number; they keep it.
    const dd = e.phase ? `${ordinal(e.down)} ${e.phase === 'score' ? 'to score' : 'to mid'}`
      : `${ordinal(e.down)} & ${e.toGo}`;
    return h('div', { class: 'gd-log-row' },
      h('span', { class: 'gd-log-dd' }, dd),
      h('span', { class: 'grow' }, e.playName,
        e.toName ? h('span', { class: 'muted small' }, ` · to ${e.toName}`) : null),
      e.crossed ? h('span', { class: 'gd-log-first' }, '1st') : null,
      h('span', { class: `gd-log-res tone-${r?.tone || 'neutral'}` }, gained));
  }));
}

function timeList(game) {
  const roster = rosterFor();
  if (!roster.length) return h('p', { class: 'p-help pad' }, 'Add players on the Roster tab and their snaps show up here.');
  const { rows, total } = snapRows(game, roster);
  if (!total) {
    return h('p', { class: 'p-help pad' }, 'Pick who is on the field, then log a play. Snaps are counted from there, fewest first.');
  }
  const on = game.onField || [];
  return h('div', { class: 'gd-time' }, ...rows.map(({ player, entry, snaps, pct }) =>
    h('div', { class: `gd-time-row ${on.includes(player.id) ? 'on' : ''}` },
      avatarOf(player),
      h('span', { class: 'grow' },
        h('div', { class: 'gd-time-name' }, player.first, entry.number ? h('span', { class: 'muted' }, ` #${entry.number}`) : null),
        h('div', { class: 'gd-bar' }, h('i', { style: { width: `${pct}%` } }))),
      h('span', { class: 'gd-time-num' }, String(snaps), h('small', null, `${pct}%`)))));
}

function summary(game) {
  const log = game.log || [];
  if (!log.length) return null;
  const yards = log.reduce((t, e) => t + (e.result === 'loss' ? -Math.abs(e.yards) : e.yards || 0), 0);
  const tds = log.filter((e) => e.result === 'td').length;
  const worked = log.filter((e) => e.result === 'td' || e.result === 'gain').length;
  return h('div', { class: 'gd-summary' },
    h('div', null, h('b', null, String(log.length)), h('small', null, 'plays')),
    h('div', null, h('b', null, String(yards)), h('small', null, 'yards')),
    h('div', null, h('b', null, String(tds)), h('small', null, 'TDs')),
    h('div', null, h('b', null, `${Math.round((worked / log.length) * 100)}%`), h('small', null, 'gained')));
}

function build() {
  const games = gamesForSeason();
  const game = current();

  const head = h('header', { class: 'page-head' },
    h('div', null, h('h1', null, 'Game day'),
      game
        ? h('button', { class: 'gd-opponent', onclick: () => renameGame(game) },
          game.opponent || 'Tap to name the opponent',
          h('span', { class: 'muted small' }, ` · ${new Date(game.date).toLocaleDateString()}`))
        : h('span', { class: 'count' }, 'No games yet')),
    h('div', { class: 'head-actions' },
      games.length > 1 ? btn('Games', () => gameListSheet(), { iconName: 'calendar', kind: 'ghost' }) : null,
      btn('New game', startGame, { iconName: 'plus', kind: game ? 'ghost' : 'primary' })));

  if (!game) {
    return h('div', { class: 'page gameday' }, head,
      h('div', { class: 'empty-state' },
        h('div', { class: 'empty-icon' }, icon('whistle')),
        h('h3', null, 'No game started'),
        h('p', null, 'Start a game to keep score, call plays off your formations, and log what each one actually does. Those results show up next to your plays afterwards.'),
        btn('Start a game', startGame, { kind: 'primary', iconName: 'plus' })));
  }

  const callRow = pending ? pendingCard(game) : h('div', { class: 'gd-callrow' },
    btn('Call a play', () => callSheet(game), { iconName: 'playbook', kind: 'primary big grow' }),
    (game.log || []).length ? btn('Undo last', () => undoLast(game), { iconName: 'undo', kind: 'ghost' }) : null);

  return h('div', { class: 'page gameday' }, head,
    scoreboard(game),
    lineupBar(game),
    callRow,
    summary(game),
    h('div', { class: 'gd-tabs' }, segmented(
      [{ value: 'log', label: 'Play log' }, { value: 'time', label: 'Playing time' }], tab,
      (v) => { tab = v; rerender(); }, { cls: 'small' })),
    tab === 'log' ? logList(game) : timeList(game));
}

function gameListSheet() {
  const games = gamesForSeason();
  openSheet({
    title: 'Games',
    size: 'md',
    body: h('div', { class: 'check-list' }, ...games.map((g) => h('div', { class: 'check-row' },
      h('button', {
        class: 'grow gd-game-row',
        onclick: () => { currentId = g.id; pending = null; rerender(); },
      },
      h('b', null, g.opponent || 'Game'),
      h('span', { class: 'muted small' }, ` ${new Date(g.date).toLocaleDateString()} · ${g.us}–${g.them} · ${(g.log || []).length} plays`)),
      iconBtn('trash', async () => {
        if (!(await confirmDialog({ title: `Delete ${g.opponent || 'this game'}?`, message: 'The score and every play logged in it are removed. This cannot be undone.', confirmText: 'Delete', danger: true }))) return;
        await deleteGame(g.id);
        if (currentId === g.id) currentId = null;
        rerender();
      }, { title: 'Delete game', cls: 'small' })))),
    actions: [{ label: 'Done', kind: 'primary' }],
  });
}

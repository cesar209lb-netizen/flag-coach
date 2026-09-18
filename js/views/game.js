// Game day: the sideline screen. The clock, the score, who is on the field, and
// how long each of them has played.
//
// It used to carry the whole play-by-play — pick a formation, pick the play,
// say who got the ball, say what it did. On a sideline with eight seconds to
// the next snap that is four taps nobody has time for, so it is gone. What is
// left is the thing a coach actually has to get right: every kid gets their
// minutes. Time runs off the game clock for whoever is on the field, and a play
// is one tap on **Play ran**.

import { h, icon, iconBtn, btn, segmented, openSheet, confirmDialog, promptDialog, toast, initials } from '../ui.js';
import { state, subscribe, activeSeason, saveGame, saveSettings, deleteGame, gameById, rosterFor } from '../store.js';
import {
  newGame, ON_FIELD, SLOTS, SLOT_COLORS, SLOT_TEXT,
  newClock, clockLeft, clockRunning, clockText, fieldSpots, spotIds,
  uid, snapRows, bankTime, playedMs,
} from '../model.js';

// Which game is on screen.
let currentId = null;

let rerenderFn = null;
const rerender = () => rerenderFn?.();

export function mount(root) {
  const render = () => root.replaceChildren(build());
  rerenderFn = render;
  render();
  const unsub = subscribe(render);
  // The clock and the playing-time rows redraw themselves in place. Re-rendering
  // the whole screen once a second would throw away scroll position and any
  // half-finished tap.
  const timer = setInterval(() => tickClock(root), 250);
  return { destroy: () => { rerenderFn = null; clearInterval(timer); unsub(); } };
}

// ---------- Clock ----------

const halfLength = () => state.settings.halfMinutes || 25;
const clockOf = (game) => game.clock || newClock(halfLength());

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
  tickTime(root, game);
  // Ran out while nobody was looking: bank the time, stop it once, and say so.
  if (c.since && clockLeft(c) === 0) {
    saveGame({ ...bankTime(game), clock: { ...c, ms: 0, since: null } });
    toast(`End of half ${c.half}`, { tone: 'warn', duration: 6000 });
  }
}

// The minutes tick up while the clock runs, so they are patched in place too.
function tickTime(root, game) {
  const rows = [...root.querySelectorAll('.gd-time-row[data-player]')];
  if (!rows.length) return;
  const vals = rows.map((el) => playedMs(game, el.dataset.player));
  const most = Math.max(0, ...vals);
  rows.forEach((el, i) => {
    const num = el.querySelector('.gd-time-clock');
    if (num) num.textContent = clockText(vals[i]);
    const bar = el.querySelector('.gd-bar i');
    if (bar) bar.style.width = `${most ? Math.round((vals[i] / most) * 100) : 0}%`;
  });
}

// Starting and stopping the clock is also starting and stopping everybody's
// playing time, so what is owed goes in the bank on the way past.
async function toggleClock(game) {
  const c = clockOf(game);
  if (clockRunning(c)) {
    await saveGame({ ...bankTime(game), clock: { ...c, ms: clockLeft(c), since: null } });
  } else {
    if (clockLeft(c) === 0) return;
    const now = Date.now();
    await saveGame({ ...game, clock: { ...c, since: now }, timeSince: now });
  }
  rerender();
}

function clockSheet(game) {
  const c = clockOf(game);
  const body = h('div');
  let minutes = c.minutes || halfLength();
  const draw = () => body.replaceChildren(
    h('div', { class: 'field-label' }, 'Half length',
      segmented([15, 20, 25, 30].map((n) => ({ value: n, label: `${n} min` })), minutes, (v) => { minutes = v; draw(); })),
    h('p', { class: 'p-help' }, 'Starting the next half puts the clock back to full and counts the half up. Restarting this one just puts the time back. Playing time already banked is kept either way.'),
    h('div', { class: 'btn-row' },
      btn(`Start half ${c.half + 1}`, async () => {
        await saveGame({ ...bankTime(game), clock: { half: c.half + 1, minutes, ms: minutes * 60000, since: null } });
        rerender();
        toast(`Half ${c.half + 1} — clock reset`);
      }, { kind: 'primary', iconName: 'next' }),
      btn('Restart this half', async () => {
        await saveGame({ ...bankTime(game), clock: { ...c, minutes, ms: minutes * 60000, since: null } });
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

// The clock is the middle of the board now, where the down used to sit: it is
// what the whole screen is counting.
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

// Starts straight away rather than asking for an opponent first: a prompt
// cannot tell "cancelled" from "left blank", and nobody wants a dialog between
// them and the first snap. The name is set afterwards by tapping the header.
async function startGame() {
  const season = activeSeason();
  const g = newGame(season?.id || null, '', halfLength());
  // Carry the last game's lineup over — it is usually the same five kids, and
  // an empty field on the first snap is a worse default than a stale one.
  const prev = gamesForSeason()[0];
  const roster = rosterFor();
  if (prev?.onField?.length) {
    g.onField = prev.onField.filter((id) => roster.some((r) => r.player.id === id));
    g.spots = Object.fromEntries(Object.entries(prev.spots || {}).filter(([, id]) => g.onField.includes(id)));
  }
  await saveGame(g);
  currentId = g.id;
  rerender();
}

async function renameGame(game) {
  const v = await promptDialog({ title: 'Opponent', label: 'Who are you playing?', value: game.opponent || '', confirmText: 'Save' });
  if (v === null) return;
  await saveGame({ ...game, opponent: v });
  rerender();
}

// ---------- Recording a snap ----------

// One tap. All it writes down is who was out there, which is all the playing
// time count needs.
async function playRan(game) {
  if (!(game.onField || []).length) {
    toast('Pick who is on the field first');
    lineupSheet(game);
    return;
  }
  const entry = {
    id: uid(), at: Date.now(),
    onField: [...(game.onField || [])],
    spots: { ...(game.spots || {}) },
  };
  await saveGame({ ...game, log: [...(game.log || []), entry] });
  rerender();
}

async function undoLast(game) {
  const log = game.log || [];
  if (!log.length) return;
  await saveGame({ ...game, log: log.slice(0, -1) });
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

  // Who was on the field for the most recent snap. Coming off, they land in
  // their own yellow group, so nobody goes straight back in by accident.
  const lastSnap = (game.log || [])[(game.log || []).length - 1];
  const justPlayed = new Set(lastSnap?.onField || []);

  const benchCard = ({ player, entry, snaps, ms, timePct }) => {
    const fresh = justPlayed.has(player.id);
    const card = h('button', {
      class: `gd-card bench ${fresh ? 'just' : ''}`,
      dataset: { player: player.id },
      onclick: () => {
        const slot = aim || firstEmpty();
        if (!slot) { toast('Every position is filled — tap one to free it up'); return; }
        place(slot, player.id);
      },
    },
    h('div', { class: 'gd-card-photo' },
      player.photo ? h('img', { src: player.photo, alt: '', draggable: 'false' }) : h('span', { class: 'gd-card-initials' }, initials(player)),
      entry.number ? h('span', { class: 'gd-card-num' }, `#${entry.number}`) : null,
      fresh ? h('span', { class: 'gd-card-just' }, 'Just played') : null),
    h('div', { class: 'gd-card-name' }, player.first),
    h('div', { class: 'gd-card-time' },
      h('span', null, `${clockText(ms)} · ${snaps} play${snaps === 1 ? '' : 's'}`),
      h('div', { class: 'gd-bar' }, h('i', { style: { width: `${timePct}%` } }))));
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
    const fresh = off.filter((r) => justPlayed.has(r.player.id));
    const rested = off.filter((r) => !justPlayed.has(r.player.id));
    if (doneBtn) doneBtn.disabled = onIds.length !== ON_FIELD;
    // replaceChildren turns a null into the text "null", unlike h(), so the
    // list is filtered before it goes in.
    body.replaceChildren(...[
      h('div', { class: `gd-fieldcount ${onIds.length === ON_FIELD ? 'ok' : ''}` },
        h('b', null, `${onIds.length} of ${ON_FIELD} positions filled`),
        h('span', { class: 'muted small' }, aim ? `Tap a player to put them at ${aim}`
          : total ? `${total} play${total === 1 ? '' : 's'} run so far` : 'Tap a player, or drag them onto a spot')),
      h('div', { class: 'gd-spots' }, ...SLOTS.map(spotCard)),
      // Rested first, because they are who you are reaching for; whoever just
      // came off sits underneath in yellow.
      ...(rested.length ? [
        h('div', { class: 'section-label' }, 'Ready — least playing time first'),
        h('div', { class: 'gd-cards' }, ...rested.map(benchCard)),
      ] : []),
      ...(fresh.length ? [
        h('div', { class: 'section-label just' }, 'Just played · last snap'),
        h('div', { class: 'gd-cards' }, ...fresh.map(benchCard)),
      ] : []),
      off.length ? null : h('p', { class: 'p-help' }, 'Everybody is in.'),
    ].filter(Boolean));
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
          // Bank what the five leaving the field are owed before the new five
          // start the meter, otherwise a substitution would pay the wrong kids.
          const banked = bankTime(game);
          const running = clockRunning(banked.clock);
          await saveGame({ ...banked, spots, onField: ids, timeSince: running ? Date.now() : null });
          rerender();
        },
      },
    ],
  });
  doneBtn = sheet.panel.querySelector('.sheet-foot .btn.primary');
  if (doneBtn) doneBtn.disabled = spotIds(spots).length !== ON_FIELD;
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
    h('div', { class: 'gd-dd' }, clockBar(game)),
    col('them', game.opponent || 'Them'));
}

// Playing time: minutes first, because that is what a parent counts, with the
// snap count next to it for the coach who thinks in plays. Fewest first is the
// order you sub from, and whoever is out there right now is outlined.
function timeList(game) {
  const roster = rosterFor();
  if (!roster.length) return h('p', { class: 'p-help pad' }, 'Add players on the Roster tab and their playing time shows up here.');
  const { rows, total } = snapRows(game, roster);
  const on = game.onField || [];
  return h('div', null,
    h('div', { class: 'section-label' }, `Playing time · ${total} play${total === 1 ? '' : 's'} run`),
    h('div', { class: 'gd-time' }, ...rows.map(({ player, entry, snaps, ms, timePct }) =>
      h('div', { class: `gd-time-row ${on.includes(player.id) ? 'on' : ''}`, dataset: { player: player.id } },
        avatarOf(player),
        h('span', { class: 'grow' },
          h('div', { class: 'gd-time-name' }, player.first, entry.number ? h('span', { class: 'muted' }, ` #${entry.number}`) : null),
          h('div', { class: 'gd-bar' }, h('i', { style: { width: `${timePct}%` } }))),
        h('span', { class: 'gd-time-num' },
          h('b', { class: 'gd-time-clock' }, clockText(ms)),
          h('small', null, `${snaps} play${snaps === 1 ? '' : 's'}`))))),
    total ? null : h('p', { class: 'p-help' }, 'Start the clock and the minutes run for whoever is on the field. Tap Play ran to count a snap.'));
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
        h('p', null, 'Start a game to keep score and track playing time — minutes off the clock for whoever is on the field, and one tap a snap.'),
        btn('Start a game', startGame, { kind: 'primary', iconName: 'plus' })));
  }

  return h('div', { class: 'page gameday' }, head,
    scoreboard(game),
    lineupBar(game),
    h('div', { class: 'gd-callrow' },
      btn('Play ran', () => playRan(game), { iconName: 'whistle', kind: 'primary big grow' }),
      (game.log || []).length ? btn('Undo', () => undoLast(game), { iconName: 'undo', kind: 'ghost' }) : null),
    timeList(game));
}

function gameListSheet() {
  // The list redraws itself: rerender() rebuilds the page behind the sheet, so
  // a deleted game used to sit here looking undeleted until the sheet closed.
  const list = h('div', { class: 'check-list' });
  let sheet = null;

  const row = (g) => h('div', { class: 'check-row' },
    h('button', {
      class: 'grow gd-game-row',
      onclick: () => { currentId = g.id; sheet?.close(); rerender(); },
    },
    h('b', null, g.opponent || 'Game'),
    h('span', { class: 'muted small' }, ` ${new Date(g.date).toLocaleDateString()} · ${g.us}–${g.them} · ${(g.log || []).length} plays`)),
    iconBtn('trash', async () => {
      if (!(await confirmDialog({ title: `Delete ${g.opponent || 'this game'}?`, message: 'The score, the playing time and every play logged in it are removed. This cannot be undone.', confirmText: 'Delete', danger: true }))) return;
      await deleteGame(g.id);
      if (currentId === g.id) currentId = null;
      rerender();
      draw();
    }, { title: 'Delete game', cls: 'small' }));

  function draw() {
    const games = gamesForSeason();
    // Nothing left to pick from, so there is nothing for the sheet to be.
    if (!games.length) { sheet?.close(); return; }
    list.replaceChildren(...games.map(row));
  }

  sheet = openSheet({
    title: 'Games',
    size: 'md',
    body: list,
    actions: [{ label: 'Done', kind: 'primary' }],
  });
  draw();
}

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
import { state, subscribe, activeSeason, saveGame, deleteGame, gameById, playById, rosterFor } from '../store.js';
import {
  newGame, PLAY_RESULTS, PHASES, ON_FIELD, phaseOf, nextDown, playStats, uid,
  formationGroups, formationSample, isPassPlay, ballEndsWith, snapRows,
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
  return { destroy: () => { rerenderFn = null; unsub(); } };
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
  const g = newGame(season?.id || null, '');
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
    toName: pending?.to ? carrierLabel(play, pending.to) : null,
    onField: [...(game.onField || [])],
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

const onFieldRoster = (game) => rosterFor().filter((r) => (game.onField || []).includes(r.player.id));

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
  const on = onFieldRoster(game);
  const { rows } = snapRows(game, roster);
  const bench = rows.filter((r) => !(game.onField || []).includes(r.player.id));
  const next = bench.slice(0, 2).map((r) => r.player.first).join(', ');
  // Five slots, always, with the gaps drawn — a missing kid should be as
  // obvious as a present one.
  const slots = [];
  for (let i = 0; i < ON_FIELD; i++) {
    const r = on[i];
    slots.push(r
      ? h('span', { class: 'gd-av-wrap', title: r.player.first },
        avatarOf(r.player),
        r.entry.number ? h('span', { class: 'gd-av-num' }, r.entry.number) : null)
      : h('span', { class: 'gd-av-wrap' }, h('span', { class: 'gd-av gap' })));
  }
  const short = on.length < ON_FIELD;
  return h('button', { class: `gd-lineup ${short ? 'short' : ''}`, onclick: () => lineupSheet(game) },
    h('span', { class: 'gd-lineup-label' }, short ? `${on.length} of ${ON_FIELD} — tap to fill` : 'On the field'),
    h('span', { class: 'gd-avs' }, ...slots),
    h('div', { class: 'spacer' }),
    next ? h('span', { class: 'gd-next muted small' }, `Up next: ${next}`) : null,
    icon('next', 'chev'));
}

// Picking the five. Two zones with the pictures big enough to tap without
// looking: who is out there, and who is waiting with how much they have played.
// Tapping moves a kid between them, which is the whole interaction.
function lineupSheet(game) {
  const roster = rosterFor();
  const body = h('div');
  let picked = [...(game.onField || [])];
  let doneBtn = null;

  const card = (row, on) => {
    const { player, entry, snaps, pct } = row;
    const full = !on && picked.length >= ON_FIELD;
    return h('button', {
      class: `gd-card ${on ? 'on' : ''} ${full ? 'full' : ''}`,
      onclick: () => {
        if (full) { toast(`Five on the field — take someone off first`); return; }
        picked = on ? picked.filter((id) => id !== player.id) : [...picked, player.id];
        draw();
      },
    },
    h('div', { class: 'gd-card-photo' },
      player.photo ? h('img', { src: player.photo, alt: '' }) : h('span', { class: 'gd-card-initials' }, initials(player)),
      entry.number ? h('span', { class: 'gd-card-num' }, `#${entry.number}`) : null,
      on ? h('span', { class: 'gd-card-tick' }, icon('check')) : null),
    h('div', { class: 'gd-card-name' }, player.first),
    h('div', { class: 'gd-card-time' },
      h('span', null, `${snaps} snap${snaps === 1 ? '' : 's'}`),
      h('div', { class: 'gd-bar' }, h('i', { style: { width: `${pct}%` } }))));
  };

  const draw = () => {
    // Fewest snaps first on the bench, so the kid who is owed a turn is first.
    const { rows, total } = snapRows(game, roster);
    const on = rows.filter((r) => picked.includes(r.player.id));
    const off = rows.filter((r) => !picked.includes(r.player.id));
    if (doneBtn) doneBtn.disabled = picked.length !== ON_FIELD;
    body.replaceChildren(
      h('div', { class: `gd-fieldcount ${picked.length === ON_FIELD ? 'ok' : ''}` },
        h('b', null, `${picked.length} of ${ON_FIELD} on the field`),
        h('span', { class: 'muted small' }, total ? `${total} snaps logged so far` : 'nothing logged yet')),
      h('div', { class: 'section-label' }, 'On the field'),
      on.length
        ? h('div', { class: 'gd-cards' }, ...on.map((r) => card(r, true)))
        : h('p', { class: 'p-help' }, 'Nobody yet — tap five from the bench.'),
      h('div', { class: 'section-label' }, picked.length >= ON_FIELD ? 'Bench — take someone off to swap' : 'Bench — least playing time first'),
      off.length
        ? h('div', { class: 'gd-cards' }, ...off.map((r) => card(r, false)))
        : h('p', { class: 'p-help' }, 'Everybody is in.'));
  };
  draw();

  const sheet = openSheet({
    title: 'On the field',
    size: 'lg',
    body,
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Done', kind: 'primary',
        onClick: async () => {
          if (picked.length !== ON_FIELD) return false;
          await saveGame({ ...game, onField: picked });
          rerender();
        },
      },
    ],
  });
  doneBtn = sheet.panel.querySelector('.sheet-foot .btn.primary');
  if (doneBtn) doneBtn.disabled = picked.length !== ON_FIELD;
}

// ---------- Calling a play ----------

// What to call the player a slot belongs to: their name if somebody is assigned
// to it in this play, otherwise the slot's own label.
function carrierLabel(play, slot) {
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
      }, carrierLabel(play, slot))))) : null,

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
      h('button', { class: 'gd-dd-main', onclick: () => downSheet(game) },
        h('span', { class: 'gd-down' }, `${ordinal(game.down)} down`),
        h('span', { class: `gd-togo ${phaseOf(game)}` }, PHASES[phaseOf(game)])),
      h('div', { class: 'btn-row tight center' },
        btn('New series', async () => { await saveGame({ ...game, down: 1, phase: 'mid' }); rerender(); }, { kind: 'small ghost' }))),
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
        (v) => { phase = v; draw(); })));
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

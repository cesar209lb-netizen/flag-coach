// Game day: the sideline screen. Score, down and distance, and a log of every
// play called with what it actually did.
//
// Built for a coach holding a tablet in one hand with eight seconds before the
// next snap, so calling a play and recording it is two taps and the buttons are
// large. Everything it records feeds back into the playbook: a play's real
// average sits next to the simulated one, which is the only way to find out
// whether the thing that works on paper works against people.

import { h, icon, iconBtn, btn, openSheet, confirmDialog, promptDialog, toast } from '../ui.js';
import { state, subscribe, activeSeason, saveGame, deleteGame, gameById } from '../store.js';
import { newGame, PLAY_RESULTS, playStats, uid } from '../model.js';

// Which game is on screen, and the play waiting for its result.
let currentId = null;
let pending = null;
let gainYards = 5;

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

// Starts straight away rather than asking for an opponent first: a prompt
// cannot tell "cancelled" from "left blank", and nobody wants a dialog between
// them and the first snap. The name is set afterwards by tapping the header.
async function startGame() {
  const season = activeSeason();
  const g = newGame(season?.id || null, '');
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

async function record(game, result, yards) {
  const entry = {
    id: uid(), playId: pending?.id || null, playName: pending?.name || 'Play',
    down: game.down, toGo: game.toGo, result, yards, at: Date.now(),
  };
  const g = { ...game, log: [...(game.log || []), entry] };

  if (result === 'td') {
    g.us += 6;
    g.down = 1; g.toGo = 10;
  } else if (result === 'turnover') {
    g.down = 1; g.toGo = 10;
  } else {
    const net = result === 'loss' ? -Math.abs(yards) : yards;
    const toGo = g.toGo - net;
    if (toGo <= 0) { g.down = 1; g.toGo = 10; } // moved the chains
    else if (g.down >= 4) { g.down = 1; g.toGo = 10; } // turnover on downs
    else { g.down += 1; g.toGo = toGo; }
  }
  pending = null;
  await saveGame(g);
  rerender();
}

async function undoLast(game) {
  const log = game.log || [];
  if (!log.length) return;
  const last = log[log.length - 1];
  const g = { ...game, log: log.slice(0, -1), down: last.down, toGo: last.toGo };
  if (last.result === 'td') g.us = Math.max(0, g.us - 6);
  await saveGame(g);
  toast('Last play removed');
  rerender();
}

function callSheet(game) {
  const plays = state.plays;
  const search = h('input', { class: 'input search', type: 'search', placeholder: 'Search plays' });
  const list = h('div', { class: 'gd-picklist' });
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = q ? plays.filter((p) => `${p.name} ${p.formation} ${p.tags.join(' ')}`.toLowerCase().includes(q)) : plays;
    list.replaceChildren(...shown.map((p) => {
      const st = playStats(state.games, p.id);
      return h('button', {
        class: 'gd-pick',
        onclick: () => { pending = { id: p.id, name: p.name }; sheet.close(); rerender(); },
      },
      h('span', { class: 'gd-pick-num' }, String(plays.indexOf(p) + 1)),
      h('span', { class: 'grow' },
        h('div', { class: 'gd-pick-name' }, p.name),
        h('div', { class: 'muted small' }, [p.formation, st ? `${st.calls} called · ${st.avg} avg` : null].filter(Boolean).join(' · '))),
      icon('next'));
    }));
    if (!shown.length) list.replaceChildren(h('p', { class: 'p-help' }, 'No plays match.'));
  };
  search.addEventListener('input', draw);
  draw();
  const sheet = openSheet({
    title: `Call a play · ${game.down}${['st', 'nd', 'rd', 'th'][Math.min(game.down, 4) - 1]} & ${game.toGo}`,
    size: 'lg',
    body: h('div', null, h('div', { class: 'search-wrap pad' }, icon('search'), search), list),
    actions: [{ label: 'Cancel', kind: 'ghost' }],
  });
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

  const ord = ['1st', '2nd', '3rd', '4th'][Math.min(game.down, 4) - 1];
  return h('section', { class: 'gd-board' },
    col('us', state.settings.teamName || 'Us'),
    h('div', { class: 'gd-dd' },
      h('button', {
        class: 'gd-dd-main',
        onclick: async () => {
          const v = await promptDialog({ title: 'Down & distance', label: 'Yards to go', value: String(game.toGo), confirmText: 'Set' });
          if (v === null) return;
          const n = parseInt(v, 10);
          if (Number.isFinite(n)) { await saveGame({ ...game, toGo: Math.max(1, n) }); rerender(); }
        },
      }, h('span', { class: 'gd-down' }, ord), h('span', { class: 'gd-togo' }, `& ${game.toGo}`)),
      h('div', { class: 'btn-row tight center' },
        btn('New series', async () => { await saveGame({ ...game, down: 1, toGo: 10 }); rerender(); }, { kind: 'small ghost' }))),
    col('them', game.opponent || 'Them'));
}

function resultRow(game) {
  if (!pending) {
    return h('div', { class: 'gd-callrow' },
      btn('Call a play', () => callSheet(game), { iconName: 'playbook', kind: 'primary big' }),
      (game.log || []).length ? btn('Undo last', () => undoLast(game), { iconName: 'undo', kind: 'ghost' }) : null);
  }
  const stepper = h('div', { class: 'gd-yards' },
    iconBtn('back', () => { gainYards = Math.max(0, gainYards - 1); rerender(); }, { title: 'Fewer yards' }),
    h('span', { class: 'gd-yard-val' }, `${gainYards} yd`),
    iconBtn('next', () => { gainYards += 1; rerender(); }, { title: 'More yards' }));

  return h('div', { class: 'gd-result' },
    h('div', { class: 'gd-pending' },
      h('span', { class: 'muted small' }, 'Called'),
      h('b', null, pending.name),
      h('div', { class: 'spacer' }),
      btn('Cancel', () => { pending = null; rerender(); }, { kind: 'small ghost' })),
    stepper,
    h('div', { class: 'gd-buttons' }, ...PLAY_RESULTS.map((r) => btn(
      r.id === 'gain' ? `Gain ${gainYards}` : r.id === 'loss' ? `Loss ${gainYards}` : r.label,
      () => record(game, r.id, r.id === 'gain' || r.id === 'loss' ? gainYards : 0),
      { kind: `big tone-${r.tone}` }))));
}

function logList(game) {
  const log = (game.log || []).slice().reverse();
  if (!log.length) return h('p', { class: 'p-help pad' }, 'Nothing logged yet. Call a play and tap what happened.');
  return h('div', { class: 'gd-log' }, ...log.map((e) => {
    const r = PLAY_RESULTS.find((x) => x.id === e.result);
    const gained = e.result === 'td' ? 'TD' : e.result === 'turnover' ? 'TO'
      : e.result === 'loss' ? `−${Math.abs(e.yards)}` : e.result === 'none' ? '0' : `+${e.yards}`;
    return h('div', { class: 'gd-log-row' },
      h('span', { class: 'gd-log-dd' }, `${['1st', '2nd', '3rd', '4th'][Math.min(e.down, 4) - 1]} & ${e.toGo}`),
      h('span', { class: 'grow' }, e.playName),
      h('span', { class: `gd-log-res tone-${r?.tone || 'neutral'}` }, gained));
  }));
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
        h('p', null, 'Start a game to keep score and log what each play actually does. Those results show up next to your plays afterwards.'),
        btn('Start a game', startGame, { kind: 'primary', iconName: 'plus' })));
  }

  return h('div', { class: 'page gameday' }, head,
    scoreboard(game),
    resultRow(game),
    summary(game),
    h('div', { class: 'set-title pad' }, 'Play log'),
    logList(game));
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

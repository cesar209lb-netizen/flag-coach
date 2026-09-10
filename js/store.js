// In-memory app state, persisted write-through to IndexedDB.

import * as db from './db.js';
import { defaultSettings, newSeason, seasonNameFor, starterPlays } from './model.js';

export const state = { settings: null, players: [], seasons: [], plays: [] };

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit() { subs.forEach((fn) => fn()); }
// Redraw after a change made outside the normal save paths (a sync pull).
export const refreshUI = emit;

// ---------- Sync bookkeeping ----------
// Every local write queues the record for the next push, and every delete
// leaves a tombstone so the other device learns about it too. Both are inert
// until a team is paired in Settings.
const KIND_STORE = { settings: 'meta', player: 'players', season: 'seasons', play: 'plays' };
const syncSubs = new Set();
export function onSyncQueue(fn) { syncSubs.add(fn); return () => syncSubs.delete(fn); }

// Set while applying records that came from the server, so they are not
// queued straight back to it.
let applying = false;

function queue(kind, id) {
  if (applying) return;
  db.put('pending', { id: `${kind}:${id}`, kind, ref: id, at: Date.now() }).catch(() => {});
  syncSubs.forEach((fn) => fn());
}

function tombstone(kind, id, deletedAt = Date.now()) {
  if (applying) return Promise.resolve();
  return db.put('tombstones', { id: `${kind}:${id}`, kind, ref: id, deletedAt })
    .then(() => queue(kind, id))
    .catch(() => {});
}

// Applies one record from the server. Last write wins on updatedAt, and a
// local record that is newer than the incoming one is left alone.
export async function applyRemote({ kind, id, updatedAt, deleted, data }) {
  const storeName = KIND_STORE[kind];
  if (!storeName) return false;
  const localOf = () => (kind === 'settings' ? state.settings
    : kind === 'play' ? playById(id) : kind === 'player' ? playerById(id) : seasonById(id));
  const local = localOf();
  if (local && (local.updatedAt || 0) > updatedAt) return false;
  applying = true;
  try {
    if (deleted) {
      if (kind === 'settings' || !local) return false;
      if (kind === 'play') await deletePlay(id);
      else if (kind === 'player') await deletePlayer(id);
      else await deleteSeason(id);
      await db.put('tombstones', { id: `${kind}:${id}`, kind, ref: id, deletedAt: updatedAt });
      return true;
    }
    if (kind === 'settings') {
      await saveSettings({ ...data, updatedAt }, { silent: true });
    } else if (kind === 'play') {
      await savePlay({ ...data, id, updatedAt }, { silent: true });
    } else if (kind === 'player') {
      await savePlayer({ ...data, id, updatedAt }, { silent: true });
    } else {
      await saveSeason({ ...data, id, updatedAt }, { silent: true });
    }
    await db.del('tombstones', `${kind}:${id}`);
    return true;
  } finally {
    applying = false;
  }
}

// The local records still waiting to go up, as sync-shaped rows.
export async function pendingRecords() {
  const [pending, tombs] = await Promise.all([db.getAll('pending'), db.getAll('tombstones')]);
  const dead = new Map(tombs.map((t) => [t.id, t]));
  const rows = [];
  for (const p of pending) {
    const tomb = dead.get(p.id);
    if (tomb) {
      rows.push({ key: p.id, kind: p.kind, id: p.ref, updatedAt: tomb.deletedAt, deleted: true, data: null });
      continue;
    }
    const rec = p.kind === 'settings' ? syncedSettings()
      : p.kind === 'play' ? playById(p.ref) : p.kind === 'player' ? playerById(p.ref) : seasonById(p.ref);
    if (!rec) continue;
    rows.push({ key: p.id, kind: p.kind, id: p.ref, updatedAt: rec.updatedAt || Date.now(), deleted: false, data: rec });
  }
  return rows;
}

export const clearPending = (keys) => db.delAll('pending', keys);

// Queue every record on this device — a fresh pairing, or after a restore.
export async function queueAll() {
  const rows = await allRecords();
  await db.putAll('pending', rows.map((r) => ({ id: r.key, kind: r.kind, ref: r.id, at: Date.now() })));
  syncSubs.forEach((fn) => fn());
}

// Settings are per-team rules, not per-device state: only these travel.
const SYNCED_SETTINGS = ['teamName', 'fieldWidth', 'passClock', 'rushDistance', 'tags'];
export function syncedSettings() {
  const s = state.settings;
  const out = { id: 'settings', updatedAt: s.updatedAt || 0 };
  for (const k of SYNCED_SETTINGS) out[k] = s[k];
  return out;
}

// Everything on this device, as sync rows — the first push of a new pairing.
export async function allRecords() {
  return [
    { key: 'settings:settings', kind: 'settings', id: 'settings', updatedAt: state.settings.updatedAt || Date.now(), deleted: false, data: syncedSettings() },
    ...state.plays.map((p) => ({ key: `play:${p.id}`, kind: 'play', id: p.id, updatedAt: p.updatedAt || Date.now(), deleted: false, data: p })),
    ...state.players.map((p) => ({ key: `player:${p.id}`, kind: 'player', id: p.id, updatedAt: p.updatedAt || Date.now(), deleted: false, data: p })),
    ...state.seasons.map((x) => ({ key: `season:${x.id}`, kind: 'season', id: x.id, updatedAt: x.updatedAt || Date.now(), deleted: false, data: x })),
  ];
}

const upsert = (arr, obj) => {
  const i = arr.findIndex((x) => x.id === obj.id);
  if (i >= 0) arr[i] = obj; else arr.push(obj);
};

export async function loadState() {
  await db.open();
  const [meta, players, seasons, plays] = await Promise.all(['meta', 'players', 'seasons', 'plays'].map(db.getAll));
  state.settings = { ...defaultSettings(), ...(meta.find((m) => m.id === 'settings') || {}) };
  state.players = players;
  state.seasons = seasons.sort((a, b) => a.createdAt - b.createdAt);
  state.plays = plays;

  if (!state.seasons.length) {
    const s = newSeason(seasonNameFor());
    state.seasons.push(s);
    await db.put('seasons', s);
  }
  if (!state.seasons.some((s) => s.id === state.settings.activeSeasonId)) {
    state.settings.activeSeasonId = state.seasons[state.seasons.length - 1].id;
  }
  if (!state.settings.seeded) {
    for (const p of starterPlays(state.settings.fieldWidth)) {
      state.plays.push(p);
      await db.put('plays', p);
    }
    state.settings.seeded = true;
  }
  await db.put('meta', state.settings);
}

function touched() {
  state.settings.lastChangeAt = Date.now();
  db.put('meta', state.settings);
}

// ---------- Settings ----------
export async function saveSettings(patch, { silent = false } = {}) {
  const shared = SYNCED_SETTINGS.some((k) => k in patch);
  Object.assign(state.settings, patch);
  if (shared && !('updatedAt' in patch)) state.settings.updatedAt = Date.now();
  await db.put('meta', state.settings);
  if (shared) queue('settings', 'settings');
  if (!silent) emit();
}

// ---------- Plays ----------
export const playById = (id) => state.plays.find((p) => p.id === id);

export async function savePlay(play, { silent = false } = {}) {
  if (!applying) play.updatedAt = Date.now();
  const copy = structuredClone(play);
  upsert(state.plays, copy);
  await db.put('plays', copy);
  queue('play', copy.id);
  touched();
  if (!silent) emit();
}

export async function deletePlay(id) {
  state.plays = state.plays.filter((p) => p.id !== id);
  await db.del('plays', id);
  await tombstone('play', id);
  touched();
  emit();
}

// ---------- Players & seasons ----------
export const playerById = (id) => state.players.find((p) => p.id === id);
export const seasonById = (id) => state.seasons.find((s) => s.id === id);
export const activeSeason = () => seasonById(state.settings.activeSeasonId) || state.seasons[state.seasons.length - 1];

export function rosterFor(season = activeSeason()) {
  if (!season) return [];
  return season.roster
    .map((entry) => ({ entry, player: playerById(entry.playerId) }))
    .filter((r) => r.player)
    .sort((a, b) => (parseInt(a.entry.number, 10) || 999) - (parseInt(b.entry.number, 10) || 999)
      || a.player.first.localeCompare(b.player.first));
}

export const entryFor = (playerId, season = activeSeason()) => season?.roster.find((r) => r.playerId === playerId) || null;

// Info used to draw a player on the field (photo, number, first name, ratings).
export function tokenInfo(playerId) {
  if (!playerId) return {};
  const p = playerById(playerId);
  if (!p) return {};
  const e = entryFor(playerId);
  return { photo: p.photo, number: e?.number || '', first: p.nickname || p.first, ratings: e?.ratings };
}

export async function savePlayer(player, { silent = false } = {}) {
  if (!applying) player.updatedAt = Date.now();
  upsert(state.players, player);
  await db.put('players', player);
  queue('player', player.id);
  touched();
  if (!silent) emit();
}

export async function deletePlayer(id) {
  state.players = state.players.filter((p) => p.id !== id);
  await db.del('players', id);
  await tombstone('player', id);
  for (const s of state.seasons) {
    if (s.roster.some((r) => r.playerId === id)) {
      s.roster = s.roster.filter((r) => r.playerId !== id);
      if (!applying) s.updatedAt = Date.now();
      await db.put('seasons', s);
      queue('season', s.id);
    }
  }
  touched();
  emit();
}

export async function saveSeason(season, { silent = false } = {}) {
  if (!applying) season.updatedAt = Date.now();
  upsert(state.seasons, season);
  await db.put('seasons', season);
  queue('season', season.id);
  touched();
  if (!silent) emit();
}

export async function deleteSeason(id) {
  state.seasons = state.seasons.filter((s) => s.id !== id);
  await db.del('seasons', id);
  await tombstone('season', id);
  if (state.settings.activeSeasonId === id) state.settings.activeSeasonId = state.seasons[state.seasons.length - 1]?.id;
  touched();
  emit();
}

// ---------- Backup ----------
export function snapshot() {
  return {
    app: 'flag-coach', version: 1, exportedAt: new Date().toISOString(),
    meta: [state.settings], players: state.players, seasons: state.seasons, plays: state.plays,
  };
}

export async function restoreSnapshot(data) {
  const settings = { ...defaultSettings(), ...(data.meta?.find((m) => m.id === 'settings') || {}), seeded: true };
  await db.replaceAll({ meta: [settings], players: data.players || [], seasons: data.seasons || [], plays: data.plays || [] });
  await loadState();
  // On a paired iPad the restored records go up on the next sync, where the
  // team's own newer edits still win on recency.
  await queueAll();
  emit();
}

export async function eraseEverything() {
  await db.replaceAll({});
  await loadState();
  emit();
}

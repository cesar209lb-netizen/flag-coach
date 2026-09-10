// In-memory app state, persisted write-through to IndexedDB.

import * as db from './db.js';
import { defaultSettings, newSeason, seasonNameFor, starterPlays } from './model.js';

export const state = { settings: null, players: [], seasons: [], plays: [] };

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit() { subs.forEach((fn) => fn()); }

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
  Object.assign(state.settings, patch);
  await db.put('meta', state.settings);
  if (!silent) emit();
}

// ---------- Plays ----------
export const playById = (id) => state.plays.find((p) => p.id === id);

export async function savePlay(play, { silent = false } = {}) {
  play.updatedAt = Date.now();
  const copy = structuredClone(play);
  upsert(state.plays, copy);
  await db.put('plays', copy);
  touched();
  if (!silent) emit();
}

export async function deletePlay(id) {
  state.plays = state.plays.filter((p) => p.id !== id);
  await db.del('plays', id);
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
  player.updatedAt = Date.now();
  upsert(state.players, player);
  await db.put('players', player);
  touched();
  if (!silent) emit();
}

export async function deletePlayer(id) {
  state.players = state.players.filter((p) => p.id !== id);
  await db.del('players', id);
  for (const s of state.seasons) {
    if (s.roster.some((r) => r.playerId === id)) {
      s.roster = s.roster.filter((r) => r.playerId !== id);
      await db.put('seasons', s);
    }
  }
  touched();
  emit();
}

export async function saveSeason(season, { silent = false } = {}) {
  upsert(state.seasons, season);
  await db.put('seasons', season);
  touched();
  if (!silent) emit();
}

export async function deleteSeason(id) {
  state.seasons = state.seasons.filter((s) => s.id !== id);
  await db.del('seasons', id);
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
  emit();
}

export async function eraseEverything() {
  await db.replaceAll({});
  await loadState();
  emit();
}

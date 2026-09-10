// Optional team sync: mirrors this device's plays, roster and rules through a
// shared store so another iPad sees them. Everything still works offline —
// local writes queue up and go out on the next successful sync.
//
// Conflicts resolve last-write-wins per record on `updatedAt`, and deletes
// travel as tombstones so they are not undone by the other device's copy.

import * as db from './db.js';
import { state, applyRemote, pendingRecords, clearPending, queueAll, loadState, onSyncQueue, refreshUI } from './store.js';

const TABLE = 'records';
const PAGE = 200;
// Photos ride along inside player records, so cap a push by payload size too.
const MAX_BATCH_BYTES = 1_200_000;
const AUTO_MS = 30_000;
const DEBOUNCE_MS = 2500;
// Re-ask for a small window before the cursor: cheap, and no row can slip
// through if two devices write in the same instant.
const CURSOR_OVERLAP_MS = 2000;

let cfg = null;
let timer = 0;
let auto = 0;
let running = null;

export const status = { state: 'off', lastSyncAt: null, error: '', pending: 0, team: '' };
const subs = new Set();
export function onStatus(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit(patch = {}) {
  Object.assign(status, patch);
  subs.forEach((fn) => fn(status));
}

// ---------- Config ----------

export async function loadConfig() {
  cfg = (await db.get('sync', 'config')) || null;
  emit({
    state: cfg?.enabled ? 'idle' : 'off',
    lastSyncAt: cfg?.lastSyncAt || null,
    team: cfg?.team || '',
  });
  await refreshPendingCount();
  return cfg;
}

export const config = () => cfg;
export const isOn = () => !!cfg?.enabled;

async function saveConfig(patch) {
  cfg = { id: 'config', ...(cfg || {}), ...patch };
  await db.put('sync', cfg);
  emit({ lastSyncAt: cfg.lastSyncAt || null, team: cfg.team || '' });
  return cfg;
}

export async function unpair() {
  await db.del('sync', 'config');
  cfg = null;
  clearTimeout(timer);
  clearInterval(auto);
  auto = 0;
  emit({ state: 'off', team: '', error: '', lastSyncAt: null });
}

// ---------- Pairing codes ----------
// One string to hand another device: the store to talk to, its public key and
// the team code. Never committed to the repo — it is typed in on each device.

const b64u = {
  enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))),
};

export const makeTeamCode = () => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
};

export function encodePairing({ url, key, team }) {
  return `flagcoach1.${b64u.enc(JSON.stringify({ u: url, k: key, t: team }))}`;
}

export function decodePairing(text) {
  const raw = (text || '').trim();
  const body = raw.startsWith('flagcoach1.') ? raw.slice('flagcoach1.'.length) : null;
  if (!body) throw new Error('That is not a Flag Coach team code.');
  let o;
  try {
    o = JSON.parse(b64u.dec(body));
  } catch {
    throw new Error('That team code looks incomplete — copy the whole thing.');
  }
  if (!o.u || !o.k || !o.t) throw new Error('That team code is missing part of its setup.');
  return { url: String(o.u).replace(/\/+$/, ''), key: String(o.k), team: String(o.t) };
}

// ---------- Transport ----------

function headers(extra = {}) {
  return {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    // Lets the store's row policy check the caller is asking for its own team.
    'x-team-code': cfg.team,
    ...extra,
  };
}

async function request(path, init = {}) {
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const hint = res.status === 401 || res.status === 403
      ? 'The team code was refused. Check the code and that the table policy is in place.'
      : res.status === 404 ? 'The sync table was not found. Run the setup SQL on the store first.'
        : `Sync store error ${res.status}.`;
    throw new Error(`${hint}${body ? ` (${body.slice(0, 140)})` : ''}`);
  }
  return res;
}

const toRow = (r) => ({
  team: cfg.team,
  kind: r.kind,
  id: r.id,
  updated_at: r.updatedAt,
  deleted: !!r.deleted,
  data: r.deleted ? null : r.data,
});

// ---------- Push / pull ----------

async function push() {
  const rows = await pendingRecords();
  if (!rows.length) return 0;
  let sent = 0;
  let batch = [];
  let keys = [];
  let bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    await request(TABLE, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(batch),
    });
    await clearPending(keys);
    sent += batch.length;
    batch = [];
    keys = [];
    bytes = 0;
  };
  for (const r of rows) {
    const row = toRow(r);
    const size = JSON.stringify(row).length;
    if (batch.length && bytes + size > MAX_BATCH_BYTES) await flush();
    batch.push(row);
    keys.push(r.key);
    bytes += size;
  }
  await flush();
  return sent;
}

async function pull() {
  const since = cfg.cursor || '1970-01-01T00:00:00Z';
  let cursor = cfg.cursor || null;
  let applied = 0;
  let from = since;
  for (let page = 0; page < 200; page++) {
    const qs = new URLSearchParams({
      select: 'kind,id,updated_at,deleted,data,synced_at',
      team: `eq.${cfg.team}`,
      synced_at: `gt.${from}`,
      order: 'synced_at.asc',
      limit: String(PAGE),
    });
    const res = await request(`${TABLE}?${qs}`, { headers: headers() });
    const rows = await res.json();
    for (const row of rows) {
      const changed = await applyRemote({
        kind: row.kind,
        id: row.id,
        updatedAt: Number(row.updated_at) || 0,
        deleted: !!row.deleted,
        data: row.data,
      });
      if (changed) applied++;
      if (!cursor || row.synced_at > cursor) cursor = row.synced_at;
    }
    if (rows.length < PAGE) break;
    from = rows[rows.length - 1].synced_at;
  }
  if (cursor) {
    // Step the saved cursor back slightly for the next run's overlap window.
    const back = new Date(new Date(cursor).getTime() - CURSOR_OVERLAP_MS).toISOString();
    await saveConfig({ cursor: back });
  }
  return applied;
}

async function refreshPendingCount() {
  try {
    const rows = await db.getAll('pending');
    emit({ pending: rows.length });
  } catch { /* storage busy */ }
}

// ---------- Public API ----------

export function sync({ quiet = false } = {}) {
  if (!isOn()) return Promise.resolve({ skipped: true });
  if (running) return running;
  if (!navigator.onLine) {
    emit({ state: 'offline' });
    return Promise.resolve({ skipped: true, offline: true });
  }
  emit({ state: 'syncing', error: quiet ? status.error : '' });
  running = (async () => {
    try {
      const sent = await push();
      const applied = await pull();
      if (applied) refreshUI();
      await saveConfig({ lastSyncAt: Date.now() });
      emit({ state: 'idle', error: '' });
      await refreshPendingCount();
      return { sent, applied };
    } catch (e) {
      const offline = !navigator.onLine || e.name === 'TypeError';
      emit({ state: offline ? 'offline' : 'error', error: offline ? '' : String(e.message || e) });
      await refreshPendingCount();
      return { error: e };
    } finally {
      running = null;
    }
  })();
  return running;
}

// Pair this device as the team's first device: push everything it already has.
export async function createTeam({ url, key, team }) {
  await saveConfig({ url: url.replace(/\/+$/, ''), key, team, enabled: true, cursor: null });
  await queueAll();
  await refreshPendingCount();
  start();
  return sync();
}

// Pair this device onto an existing team, taking the team's copy. The local
// playbook is replaced so both devices start from one shared state.
export async function joinTeam({ url, key, team }) {
  await saveConfig({ url: url.replace(/\/+$/, ''), key, team, enabled: true, cursor: null });
  await clearStore('pending');
  await clearStore('tombstones');
  await db.replaceAll({ meta: [{ ...state.settings, updatedAt: 0, seeded: true }] });
  await loadState();
  // loadState leaves one placeholder season behind on an empty device.
  const placeholder = state.seasons.map((x) => x.id);
  const res = await sync();
  const fromTeam = state.seasons.filter((x) => !placeholder.includes(x.id));
  if (fromTeam.length) {
    await db.delAll('seasons', placeholder);
    await db.put('meta', { ...state.settings, activeSeasonId: fromTeam[fromTeam.length - 1].id });
    await loadState();
  }
  refreshUI();
  start();
  return res;
}

const clearStore = async (name) => db.delAll(name, (await db.getAll(name)).map((r) => r.id));

let wired = false;

export function start() {
  if (!isOn()) return;
  clearInterval(auto);
  auto = setInterval(() => sync({ quiet: true }), AUTO_MS);
  if (wired) return;
  wired = true;
  // A local edit syncs shortly after the user stops typing or dragging.
  onSyncQueue(() => {
    refreshPendingCount();
    clearTimeout(timer);
    timer = setTimeout(() => sync({ quiet: true }), DEBOUNCE_MS);
  });
  addEventListener('online', () => sync({ quiet: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync({ quiet: true }); });
}

// The SQL a new team store needs, shown in Settings so it can be copied once.
export const SETUP_SQL = `create table if not exists records (
  team text not null,
  kind text not null,
  id text not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  data jsonb,
  synced_at timestamptz not null default now(),
  primary key (team, kind, id)
);

create index if not exists records_team_synced on records (team, synced_at);

create or replace function records_touch() returns trigger as $$
begin new.synced_at = now(); return new; end $$ language plpgsql;

drop trigger if exists records_touch on records;
create trigger records_touch before insert or update on records
  for each row execute function records_touch();

alter table records enable row level security;

grant usage on schema public to anon;
grant select, insert, update on table records to anon;

drop policy if exists records_team on records;
create policy records_team on records for all
  using (team = nullif(current_setting('request.headers', true), '')::json->>'x-team-code')
  with check (team = nullif(current_setting('request.headers', true), '')::json->>'x-team-code');`;

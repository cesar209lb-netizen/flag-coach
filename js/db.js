// Thin promise wrapper around IndexedDB. Everything lives on the device;
// js/sync.js optionally mirrors it to a shared team store.

const NAME = 'flagcoach';
const VERSION = 4;
// The stores that hold team content: what backups carry and what sync mirrors.
export const STORES = ['meta', 'players', 'seasons', 'plays', 'games', 'defplays'];
// Sync bookkeeping. Kept out of STORES so a restore or erase leaves the
// device's pairing alone.
export const SYNC_STORES = ['pending', 'tombstones', 'sync'];

let dbPromise = null;

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Only ever adds stores, so upgrading an existing iPad keeps its data.
      for (const s of [...STORES, ...SYNC_STORES]) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database blocked — close other Flag Coach tabs.'));
  });
  return dbPromise;
}

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
});

export async function getAll(store) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function get(store, id) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function put(store, value) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return done(tx);
}

export async function putAll(store, values) {
  if (!values.length) return;
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  for (const v of values) tx.objectStore(store).put(v);
  return done(tx);
}

export async function del(store, id) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
  return done(tx);
}

export async function delAll(store, ids) {
  if (!ids.length) return;
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  for (const id of ids) tx.objectStore(store).delete(id);
  return done(tx);
}

export async function replaceAll(data) {
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) {
    const os = tx.objectStore(s);
    os.clear();
    for (const item of data[s] || []) os.put(item);
  }
  return done(tx);
}

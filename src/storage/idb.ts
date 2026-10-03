/** Tiny IndexedDB wrapper (no library). Database "rg", one object store; keys like "repos:<org>". */
const DB = 'rg';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => (db.close(), resolve(req.result));
    tx.onerror = tx.onabort = () => (db.close(), reject(tx.error));
  });
}

export const idbGet = <T>(key: string) => run<T | undefined>('readonly', (s) => s.get(key));
export const idbSet = (key: string, value: unknown) => run('readwrite', (s) => s.put(value, key)).then(() => undefined);
export const idbDelete = (key: string) => run('readwrite', (s) => s.delete(key)).then(() => undefined);

/** Deletes every key accepted by `match` (keys are strings like "repos:<org>"). */
export async function idbDeleteWhere(match: (key: string) => boolean): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const cur = store.openKeyCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return;
      if (match(String(c.key))) store.delete(c.key);
      c.continue();
    };
    tx.oncomplete = () => (db.close(), resolve());
    tx.onerror = tx.onabort = () => (db.close(), reject(tx.error));
  });
}

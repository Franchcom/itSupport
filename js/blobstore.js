// Lokaler Speicher fuer verschluesselte Datenbloecke (Bilder, Versionen) in
// IndexedDB. "pending" merkt sich, was noch hochgeladen werden muss, damit
// auch offline Bilder angehaengt und Aenderungen gespeichert werden koennen.

const DB_NAME = 'itsupport';
let dbPromise;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('blobs');
        req.result.createObjectStore('pending');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const blobs = {
  get: (id) => tx('blobs', 'readonly', (s) => s.get(id)).catch(() => undefined),
  put: (id, box) => tx('blobs', 'readwrite', (s) => s.put(box, id)).catch(() => {}),
  keys: () => tx('blobs', 'readonly', (s) => s.getAllKeys()).catch(() => []),
  pending: () => tx('pending', 'readonly', (s) => s.getAllKeys()).catch(() => []),
  markPending: (id) => tx('pending', 'readwrite', (s) => s.put(true, id)).catch(() => {}),
  donePending: (id) => tx('pending', 'readwrite', (s) => s.delete(id)).catch(() => {}),
  async clear() {
    try {
      await tx('blobs', 'readwrite', (s) => s.clear());
      await tx('pending', 'readwrite', (s) => s.clear());
    } catch {
      /* nichts zu tun */
    }
  },
};

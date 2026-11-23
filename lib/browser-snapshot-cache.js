import { preserveSnapshotSessions } from "./session-cache-guard.js";
const DATABASE_NAME = "scope-monitor-cache";
const DATABASE_VERSION = 1;
const STORE_NAME = "resources";
const SNAPSHOT_KEY = "snapshot-sync-v1";

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("cache open failed"));
  });
}

export async function loadBrowserSnapshotCache() {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () =>
        reject(request.error || new Error("cache read failed"));
    });
  } finally {
    database.close();
  }
}

export async function saveBrowserSnapshotCache(value) {
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const existing = store.get(SNAPSHOT_KEY);
      existing.onsuccess = () => {
        const snapshot = preserveSnapshotSessions(existing.result?.snapshot, value.snapshot);
        store.put({ ...value, snapshot }, SNAPSHOT_KEY);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error || new Error("cache write failed"));
      transaction.onabort = () =>
        reject(transaction.error || new Error("cache write aborted"));
    });
  } finally {
    database.close();
  }
}


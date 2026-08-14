// db.js — IndexedDB persistence layer for Longbox
// Stores: comics (metadata + progress), pages (blob per page, keyed by comicId+index)

const DB_NAME = "longbox";
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("comics")) {
        db.createObjectStore("comics", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("pages")) {
        const store = db.createObjectStore("pages", { keyPath: "key" });
        store.createIndex("comicId", "comicId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeNames, mode) {
  return openDB().then((db) => db.transaction(storeNames, mode));
}

const LongboxDB = {
  async addComic(comic) {
    const t = await tx(["comics"], "readwrite");
    t.objectStore("comics").put(comic);
    return txDone(t);
  },

  async getComic(id) {
    const t = await tx(["comics"], "readonly");
    const req = t.objectStore("comics").get(id);
    return reqResult(req);
  },

  async getAllComics() {
    const t = await tx(["comics"], "readonly");
    const req = t.objectStore("comics").getAll();
    const result = await reqResult(req);
    return (result || []).sort((a, b) => b.addedAt - a.addedAt);
  },

  async updateComic(id, patch) {
    const comic = await this.getComic(id);
    if (!comic) return;
    Object.assign(comic, patch);
    return this.addComic(comic);
  },

  async deleteComic(id) {
    const t = await tx(["comics", "pages"], "readwrite");
    t.objectStore("comics").delete(id);
    const pageStore = t.objectStore("pages");
    const idx = pageStore.index("comicId");
    const range = IDBKeyRange.only(id);
    const cursorReq = idx.openCursor(range);
    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    return txDone(t);
  },

  async putPage(comicId, index, blob) {
    const t = await tx(["pages"], "readwrite");
    t.objectStore("pages").put({ key: `${comicId}:${index}`, comicId, index, blob });
    return txDone(t);
  },

  async getPage(comicId, index) {
    const t = await tx(["pages"], "readonly");
    const req = t.objectStore("pages").get(`${comicId}:${index}`);
    const result = await reqResult(req);
    return result ? result.blob : null;
  },
};

function reqResult(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(t) {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

window.LongboxDB = LongboxDB;

// Local-first storage (IndexedDB). Athletes, judged sessions, and video blobs
// stay on this device unless the user exports a share file.

const DB = 'pocket-judge';
const STORES = ['athletes', 'sessions', 'videos', 'settings'];
let dbp;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    t.onerror = () => reject(t.error);
  });
}

const get = (store, key) => tx(store, 'readonly', (s) => s.get(key));
const put = (store, key, val) => tx(store, 'readwrite', (s) => s.put(val, key));
const del = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));
const all = (store) => tx(store, 'readonly', (s) => s.getAll());

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export const getSetting = (k, dflt = null) => get('settings', k).then((v) => v ?? dflt);
export const setSetting = (k, v) => put('settings', k, v);

export const listAthletes = () => all('athletes').then((a) => a.sort((x, y) => x.name.localeCompare(y.name)));
export const getAthlete = (id) => get('athletes', id);
export const saveAthlete = (a) => put('athletes', a.id, { ...a, updatedAt: Date.now() });
export async function deleteAthlete(id) {
  for (const s of await listSessions(id)) await deleteSession(s.id);
  await del('athletes', id);
}

export const listSessions = (athleteId) =>
  all('sessions').then((list) => list.filter((s) => !athleteId || s.athleteId === athleteId).sort((a, b) => b.date - a.date));
export const getSession = (id) => get('sessions', id);
export const saveSession = (s) => put('sessions', s.id, { ...s, updatedAt: Date.now() });
export async function deleteSession(id) {
  await del('videos', id);
  await del('sessions', id);
}

export const getVideo = (id) => get('videos', id);
export const saveVideo = (id, blob) => put('videos', id, blob);

// ---- Share files ---------------------------------------------------------------

const blobToDataURL = (blob) => new Promise((resolve) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.readAsDataURL(blob);
});

export async function exportAthlete(athleteId, { includeVideos = false } = {}) {
  const athlete = await getAthlete(athleteId);
  const sessions = await listSessions(athleteId);
  const videos = {};
  if (includeVideos) {
    for (const s of sessions) {
      const v = await getVideo(s.id);
      if (v) videos[s.id] = await blobToDataURL(v);
    }
  }
  return { type: 'pocket-judge-share', version: 1, exportedAt: Date.now(), athletes: [athlete], sessions, videos };
}

export async function importShare(data) {
  if (data?.type !== 'pocket-judge-share') throw new Error('That file is not a Pocket Judge share file.');
  let a = 0;
  let s = 0;
  for (const athlete of data.athletes || []) {
    const cur = await getAthlete(athlete.id);
    if (!cur || (athlete.updatedAt || 0) >= (cur.updatedAt || 0)) { await put('athletes', athlete.id, athlete); a++; }
  }
  for (const session of data.sessions || []) {
    const cur = await getSession(session.id);
    if (!cur || (session.updatedAt || 0) >= (cur.updatedAt || 0)) {
      // Keep coach notes written on either device.
      const merged = cur ? { ...session, coachNotes: session.coachNotes || cur.coachNotes } : session;
      await put('sessions', session.id, merged);
      s++;
    }
    const url = data.videos?.[session.id];
    if (url && !(await getVideo(session.id))) await saveVideo(session.id, await (await fetch(url)).blob());
  }
  return { athletes: a, sessions: s };
}

export async function resetAll() {
  for (const s of STORES) await tx(s, 'readwrite', (st) => st.clear());
}

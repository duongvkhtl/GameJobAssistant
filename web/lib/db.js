// Lưu trữ cục bộ trên thiết bị (IndexedDB, dạng key-value). Dữ liệu CV không rời khỏi máy.
// Nếu IndexedDB không dùng được (chế độ riêng tư...), tự chuyển sang bộ nhớ tạm để ứng dụng vẫn chạy.
const DB_NAME = 'gja';
const STORE = 'kv';

export function createMemoryStore() {
  const m = new Map();
  return {
    kind: 'memory',
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; },
    async set(k, v) { m.set(k, structuredClone(v)); },
    async del(k) { m.delete(k); },
    async keys() { return [...m.keys()]; },
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function createStore() {
  let db;
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no idb');
    db = await openDb();
  } catch {
    return createMemoryStore();
  }
  const tx = (mode, fn) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  return {
    kind: 'indexeddb',
    get: (k) => tx('readonly', (s) => s.get(k)),
    set: (k, v) => tx('readwrite', (s) => s.put(v, k)),
    del: (k) => tx('readwrite', (s) => s.delete(k)),
    keys: () => tx('readonly', (s) => s.getAllKeys()),
  };
}

export const JOB_STATUSES = [
  ['none', 'Chưa đánh dấu'],
  ['to_apply', 'Cần ứng tuyển'],
  ['applied', 'Đã ứng tuyển'],
  ['interview', 'Phỏng vấn'],
  ['closed', 'Đã kết thúc'],
];

/** Lớp trạng thái người dùng: yêu thích, đã chơi, trạng thái ứng tuyển, ghi chú, hạn nộp CV. */
export function createUserState(store) {
  let state = { games: {}, jobs: {} };
  const save = () => store.set('state', state);
  return {
    async load() {
      const s = await store.get('state');
      if (s && s.games && s.jobs) state = s;
      return state;
    },
    raw: () => state,
    game: (id) => state.games[id] || {},
    job: (id) => state.jobs[id] || {},
    async patchGame(id, patch, snapshot) {
      const cur = state.games[id] || {};
      state.games[id] = { ...cur, ...patch, snapshot: snapshot || cur.snapshot, updatedAt: new Date().toISOString() };
      await save();
      return state.games[id];
    },
    async patchJob(id, patch, snapshot) {
      const cur = state.jobs[id] || {};
      state.jobs[id] = { ...cur, ...patch, snapshot: snapshot || cur.snapshot, updatedAt: new Date().toISOString() };
      await save();
      return state.jobs[id];
    },
    savedGames: () => Object.entries(state.games).filter(([, v]) => v.fav || v.played),
    savedJobs: () => Object.entries(state.jobs).filter(([, v]) => v.fav || (v.status && v.status !== 'none') || v.note || v.deadline),
  };
}

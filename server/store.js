// JSON ファイル永続化 (data/db.json)。過去の人気スレ履歴・スレ本文キャッシュ・動画台本を保持。
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.DATA_DIR || path.resolve('data');
const FILE = path.join(DIR, 'db.json');

const empty = () => ({ threads: {}, videos: {}, boards: {}, posts: {} });

export const db = load();

function load() {
  try {
    return { ...empty(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return empty();
  }
}

let timer = null;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 500);
}
export function flush() {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}

export const tid = (boardId, key) => `${boardId}:${key}`;

// subject.txt の観測結果を履歴に反映
export function upsertThread(board, t, mom, now = Date.now()) {
  const id = tid(board.id, t.key);
  const cur = db.threads[id];
  db.threads[id] = {
    id,
    board: board.id,
    key: t.key,
    title: t.title,
    resCount: Math.max(t.resCount, cur?.resCount || 0),
    momentum: mom,
    maxMomentum: Math.max(mom, cur?.maxMomentum || 0),
    firstSeen: cur?.firstSeen || now,
    lastSeen: now,
    kami: cur?.kami,
  };
  return db.threads[id];
}

// 古い・伸びなかったスレを間引いて肥大化を防ぐ
export function prune(maxThreads = 20000) {
  const all = Object.values(db.threads);
  if (all.length <= maxThreads) return;
  all
    .sort((a, b) => (b.kami?.score || 0) * 1e6 + b.maxMomentum - ((a.kami?.score || 0) * 1e6 + a.maxMomentum))
    .slice(maxThreads)
    .forEach((t) => {
      if (db.videos[t.id]) return;
      delete db.threads[t.id];
      delete db.posts[t.id];
    });
}

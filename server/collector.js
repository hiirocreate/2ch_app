// 定期巡回: 各板の subject.txt から勢いを記録し、伸びたスレは本文を取得して神スレ度を判定
import { BOARDS, fetchSubject, fetchThread } from './sources.js';
import { db, save, upsertThread, prune, tid } from './store.js';
import { momentum, kamiScore } from '../public/lib/score.js';

export const KAMI_THRESHOLD = Number(process.env.KAMI_THRESHOLD || 55);
const cache = new Map(); // 閲覧用の短期キャッシュ id -> {at, data}

export async function getThread(board, key, { force = false } = {}) {
  const id = tid(board.id, key);
  const c = cache.get(id);
  if (!force && c && Date.now() - c.at < 60_000) return c.data;
  if (!force && db.posts[id] && db.threads[id]?.resCount >= 1000) return db.posts[id]; // 完走スレは不変
  try {
    const data = await fetchThread(board, key);
    cache.set(id, { at: Date.now(), data });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    if (db.posts[id]) db.posts[id] = data;
    return data;
  } catch (e) {
    if (db.posts[id]) return db.posts[id]; // dat落ち後も保存分で閲覧可
    throw e;
  }
}

export async function judgeKami(board, t) {
  const data = await getThread(board, t.key, { force: true });
  const k = kamiScore(data.posts);
  t.kami = { score: k.score, at: Date.now() };
  if (k.score >= KAMI_THRESHOLD) db.posts[t.id] = data; // 神スレは本文を保存 (dat落ち対策)
  if (!t.title && data.title) t.title = data.title;
  save();
  return t.kami;
}

export async function crawlOnce(log = console) {
  for (const board of BOARDS) {
    try {
      const list = await fetchSubject(board);
      const now = Date.now();
      const seen = list.map((t) => upsertThread(board, t, momentum(t.key, t.resCount, now / 1000), now));
      // 完走間近 or 高勢いで未判定のスレを最大3件判定 (負荷配慮)
      const cands = seen
        .filter((t) => !t.kami && (t.resCount >= 900 || t.momentum >= 20000))
        .sort((a, b) => b.maxMomentum - a.maxMomentum)
        .slice(0, 3);
      for (const t of cands) {
        await judgeKami(board, t).catch((e) => log.warn(`[judge] ${t.id}: ${e.message}`));
        await new Promise((r) => setTimeout(r, 1500));
      }
      log.info(`[crawl] ${board.name}: ${list.length} threads`);
    } catch (e) {
      log.warn(`[crawl] ${board.name}: ${e.message}`);
    }
  }
  prune();
  save();
}

let running = null;
export function refreshNow() {
  if (!running) running = crawlOnce().finally(() => (running = null));
  return running;
}

export function startCollector(intervalMin = Number(process.env.CRAWL_INTERVAL_MIN || 5)) {
  const run = () => refreshNow().catch((e) => console.error(e));
  run();
  return setInterval(run, intervalMin * 60_000);
}

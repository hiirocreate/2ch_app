// Android アプリ用の端末内バックエンド。サーバー(server/)と同じ処理を WebView 内で行う。
// 通信は Java 側の AndroidBridge 経由 (CORS 回避・Shift_JIS 変換)、保存は localStorage。
import { decodeBytes, base64ToBytes } from './lib/encoding.js';
import { fetchThreadData } from './lib/thread.js';
import { DEFAULT_BOARDS, threadUrl, resolveThreadUrl, fetchSubjectList } from './lib/boards.js';
import { parseSubject, parseDat, parseReadCgi } from './lib/parse.js';
import { momentum, kamiScore } from './lib/score.js';
import { parseOgp } from './lib/links.js';
import { emptyDb, tid, upsertThread, prune, listThreads } from './lib/db.js';
import { buildClaudeRequest, parseClaudeResponse, ruleBasedFromPosts, FALLBACK_BETA } from './lib/script.js';

const KAMI_THRESHOLD = 55;
const CRAWL_MS = 5 * 60_000;
const bridge = window.AndroidBridge;

// ---- 通信 ----
const pending = new Map();
let seq = 0;
window.__bridgeCb = (id, status, b64) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  const text = decodeBytes(base64ToBytes(b64));
  status >= 200 && status < 300 ? p.resolve(text) : p.reject(Object.assign(new Error(status ? `HTTP ${status}` : text), { status, body: text }));
};
function request(url, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    bridge.request(id, method, url, JSON.stringify(headers), body);
  });
}
let fetchText = (url) => request(url);
if (localStorage.getItem('demo') === '1') fetchText = (await import('./lib/demo.js')).demoFetcher;

// ---- 保存 ----
const DB_VERSION = '2'; // v1 は文字化けしたデータを保存している可能性があるため破棄
function load() {
  if (localStorage.getItem('dbv') !== DB_VERSION) {
    localStorage.removeItem('db');
    localStorage.setItem('dbv', DB_VERSION);
  }
  try {
    return { ...emptyDb(), ...JSON.parse(localStorage.getItem('db') || '{}') };
  } catch {
    return emptyDb();
  }
}
const db = load();
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    for (let n = 30; n >= 0; n -= 10) {
      try {
        localStorage.setItem('db', JSON.stringify(db));
        return;
      } catch {
        prune(db, 1500, n); // 容量超過時は保存本文を減らして再試行
      }
    }
  }, 300);
}

const boardById = (id) => DEFAULT_BOARDS.find((b) => b.id === id) || db.boards[id];

// ---- 取得 ----
const cache = new Map();
localStorage.removeItem('noDat'); // 旧版の「dat 不可」記憶は誤判定の原因になるので破棄
const fetchThread = (board, key) => fetchThreadData(board, key, fetchText);

async function getThread(board, key, force = false) {
  const id = tid(board.id, key);
  const c = cache.get(id);
  if (!force && c && Date.now() - c.at < 60_000) return c.data;
  if (!force && db.posts[id] && db.threads[id]?.resCount >= 1000) return db.posts[id];
  try {
    const data = await fetchThread(board, key);
    cache.set(id, { at: Date.now(), data });
    if (cache.size > 30) cache.delete(cache.keys().next().value);
    if (db.posts[id]) db.posts[id] = data;
    return data;
  } catch (e) {
    if (db.posts[id]) return db.posts[id];
    throw e;
  }
}

async function judgeKami(board, t) {
  const data = await getThread(board, t.key, true);
  t.kami = { score: kamiScore(data.posts).score, at: Date.now() };
  if (t.kami.score >= KAMI_THRESHOLD) db.posts[t.id] = data;
  save();
}

// 板ホストの移転に追従 (前回解決したホストを保存)
const hosts = JSON.parse(localStorage.getItem('hosts') || '{}');
for (const b of DEFAULT_BOARDS) if (hosts[b.id]) b.base = hosts[b.id];
async function fetchSubject(board) {
  const before = board.base;
  const list = await fetchSubjectList(board, fetchText);
  if (board.base !== before) {
    hosts[board.id] = board.base;
    localStorage.setItem('hosts', JSON.stringify(hosts));
  }
  return list;
}

let crawling = null;
// 全板の subject.txt を並列取得し、板ごとに即座に一覧へ反映。神スレ判定(本文取得)は後回しでバックグラウンド実行。
async function crawl(onUpdate) {
  const now = Date.now();
  await Promise.all(
    DEFAULT_BOARDS.map(async (board) => {
      try {
        const list = await fetchSubject(board);
        list.forEach((t) => upsertThread(db, board, t, momentum(t.key, t.resCount, now / 1000), now));
        onUpdate?.();
      } catch (e) {
        console.warn(`[crawl] ${board.name}: ${e.message}`);
      }
    })
  );
  save();
  judgeInBackground(now, onUpdate); // 更新完了を待たせない
}

let judging = false;
async function judgeInBackground(now, onUpdate) {
  if (judging) return;
  judging = true;
  const cands = Object.values(db.threads)
    .filter((t) => !t.kami && t.lastSeen >= now && (t.resCount >= 900 || t.momentum >= 20000))
    .sort((a, b) => b.maxMomentum - a.maxMomentum)
    .slice(0, 6);
  for (const t of cands) {
    await judgeKami(boardById(t.board), t).catch(() => {});
    onUpdate?.();
  }
  prune(db, 3000, 30);
  save();
  judging = false;
}
let onCrawlUpdate;
export function refresh() {
  if (!crawling) crawling = crawl(onCrawlUpdate).finally(() => (crawling = null));
  return crawling;
}
export const isCrawling = () => !!crawling;
export function startCrawl(onUpdate) {
  onCrawlUpdate = onUpdate;
  const run = () => !document.hidden && refresh();
  run();
  setInterval(run, CRAWL_MS);
  document.addEventListener('visibilitychange', run);
}

// ---- 動画台本 ----
async function generateScript(title, posts) {
  const apiKey = localStorage.getItem('apiKey');
  if (apiKey) {
    try {
      const res = await request('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': FALLBACK_BETA, 'content-type': 'application/json' },
        body: JSON.stringify(buildClaudeRequest(title, posts, localStorage.getItem('model') || undefined)),
      });
      return parseClaudeResponse(JSON.parse(res));
    } catch (e) {
      console.warn(`Claude 生成失敗: ${e.message} ${e.body || ''}`);
    }
  }
  return ruleBasedFromPosts(title, posts);
}

const ogpCache = new Map();
const PREVIEW_UA = 'Mozilla/5.0 (compatible; 2chMatomeViewer-LinkPreview/0.1)';

// ---- app.js から呼ばれる API (server/index.js の HTTP API と同じ形) ----
export const localApi = {
  async boards() {
    return DEFAULT_BOARDS.map(({ id, name, site, adult }) => ({ id, name, site, adult: !!adult }));
  },
  async threads(params) {
    return listThreads(db, params, { threshold: KAMI_THRESHOLD, boardName: (id) => boardById(id)?.name || id });
  },
  refresh,
  async ogp(url) {
    if (!ogpCache.has(url)) {
      const p = request(url, { headers: { 'User-Agent': PREVIEW_UA, 'Accept-Language': 'ja' } }).then((html) => parseOgp(html, url));
      p.catch(() => ogpCache.delete(url));
      ogpCache.set(url, p);
      if (ogpCache.size > 300) ogpCache.delete(ogpCache.keys().next().value);
    }
    return ogpCache.get(url);
  },
  async thread(boardId, key, force = false) {
    const board = boardById(boardId);
    const data = await getThread(board, key, force);
    return { ...data, meta: db.threads[tid(board.id, key)] || null, board: { id: board.id, name: board.name }, source: threadUrl(board, key) };
  },
  async importUrl(url) {
    const r = resolveThreadUrl(url, DEFAULT_BOARDS);
    if (!r) throw new Error('read.cgi 形式のスレURLを指定してください');
    if (r.board.adhoc) db.boards[r.board.id] = r.board;
    const data = await getThread(r.board, r.key, true);
    const t = upsertThread(db, r.board, { key: r.key, title: data.title, resCount: data.posts.length }, momentum(r.key, data.posts.length));
    await judgeKami(r.board, t);
    db.posts[t.id] = data;
    save();
    return t;
  },
  async video(boardId, key, regenerate) {
    const board = boardById(boardId);
    const id = tid(board.id, key);
    if (db.videos[id] && !regenerate) return db.videos[id];
    const data = await getThread(board, key);
    const script = await generateScript(db.threads[id]?.title || data.title, data.posts);
    db.videos[id] = { ...script, id, source: threadUrl(board, key) };
    db.posts[id] = data;
    save();
    return db.videos[id];
  },
};

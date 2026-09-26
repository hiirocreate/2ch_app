import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { BOARDS, getBoard, setFetcher, resolveThreadUrl, threadUrl } from './sources.js';
import { db, save, flush, tid, upsertThread } from './store.js';
import { startCollector, getThread, judgeKami, KAMI_THRESHOLD } from './collector.js';
import { momentum } from './score.js';
import { generateScript } from './video.js';

if (process.env.DEMO) setFetcher((await import('./demo.js')).demoFetcher);

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.resolve('public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const boardById = (id) => getBoard(id) || db.boards[id];
const boardInfo = (b) => ({ id: b.id, name: b.name, site: b.site });

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let s = '';
  for await (const c of req) {
    s += c;
    if (s.length > 1e5) throw new Error('too large');
  }
  return s ? JSON.parse(s) : {};
}

function listThreads({ board, mode = 'live', q = '', limit = 100 }) {
  const now = Date.now();
  let list = Object.values(db.threads);
  if (board) list = list.filter((t) => t.board === board);
  if (q) list = list.filter((t) => t.title.includes(q));
  if (mode === 'live') {
    list = list.filter((t) => now - t.lastSeen < 30 * 60_000).sort((a, b) => b.momentum - a.momentum);
  } else if (mode === 'history') {
    list = list.sort((a, b) => b.maxMomentum - a.maxMomentum);
  } else if (mode === 'kami') {
    list = list.filter((t) => (t.kami?.score || 0) >= KAMI_THRESHOLD || db.videos[t.id]).sort((a, b) => (b.kami?.score || 0) - (a.kami?.score || 0));
  }
  return list.slice(0, Number(limit)).map((t) => ({ ...t, boardName: boardById(t.board)?.name || t.board, hasVideo: !!db.videos[t.id] }));
}

const generating = new Map();

async function api(req, res, url) {
  const p = url.pathname.split('/').filter(Boolean); // ['api', ...]
  if (req.method === 'GET' && p[1] === 'boards') return send(res, 200, BOARDS.map(boardInfo));

  if (req.method === 'GET' && p[1] === 'threads') {
    return send(res, 200, listThreads(Object.fromEntries(url.searchParams)));
  }

  if (req.method === 'POST' && p[1] === 'import') {
    const { url: turl } = await readJson(req);
    const r = resolveThreadUrl(String(turl || ''));
    if (!r) return send(res, 400, { error: 'read.cgi 形式のスレURLを指定してください' });
    if (r.board.adhoc) db.boards[r.board.id] = r.board;
    const data = await getThread(r.board, r.key, { force: true });
    const t = upsertThread(r.board, { key: r.key, title: data.title, resCount: data.posts.length }, momentum(r.key, data.posts.length));
    await judgeKami(r.board, t);
    db.posts[t.id] = data; // 手動追加は常に保存
    save();
    return send(res, 200, t);
  }

  const [, kind, boardId, key] = p;
  const board = boardId && boardById(boardId);
  if (!board || !/^\d{9,11}$/.test(key || '')) return send(res, 404, { error: 'not found' });
  const id = tid(board.id, key);

  if (req.method === 'GET' && kind === 'thread') {
    const data = await getThread(board, key);
    return send(res, 200, { ...data, meta: db.threads[id] || null, board: boardInfo(board), source: threadUrl(board, key) });
  }

  if (kind === 'video') {
    if (req.method === 'GET') return db.videos[id] ? send(res, 200, db.videos[id]) : send(res, 404, { error: 'not generated' });
    if (req.method === 'POST') {
      const body = await readJson(req).catch(() => ({}));
      if (db.videos[id] && !body.regenerate) return send(res, 200, db.videos[id]);
      if (!generating.has(id)) {
        generating.set(
          id,
          (async () => {
            const data = await getThread(board, key);
            const title = db.threads[id]?.title || data.title;
            const script = await generateScript(title, data.posts);
            db.videos[id] = { ...script, id, source: threadUrl(board, key) };
            db.posts[id] = data;
            save();
            return db.videos[id];
          })().finally(() => generating.delete(id))
        );
      }
      return send(res, 200, await generating.get(id));
    }
  }
  send(res, 404, { error: 'not found' });
}

function serveStatic(res, url) {
  const file = path.join(PUBLIC, path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ''));
  const target = file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    serveStatic(res, url);
  } catch (e) {
    console.error(e);
    send(res, 502, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`http://localhost:${PORT}${process.env.DEMO ? ' (DEMO)' : ''}`));
startCollector();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (flush(), process.exit(0)));

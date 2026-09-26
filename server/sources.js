// 板の定義と取得処理。ホストは移転が多いので環境変数 BOARDS_JSON で差し替え可能。
import { parseSubject, parseDat, parseReadCgi } from './parse.js';

export const DEFAULT_BOARDS = [
  { id: '5ch-livejupiter', site: '5ch', name: 'なんJ', base: 'https://greta.5ch.io/livejupiter/', encoding: 'shift_jis' },
  { id: '5ch-news4vip', site: '5ch', name: 'ニュー速VIP', base: 'https://viper.5ch.io/news4vip/', encoding: 'shift_jis' },
  { id: '5ch-news', site: '5ch', name: 'ニュー速+', base: 'https://asahi.5ch.io/newsplus/', encoding: 'shift_jis' },
  { id: 'open-livejupiter', site: 'open2ch', name: 'おんJ', base: 'https://hayabusa.open2ch.net/livejupiter/', encoding: 'utf-8' },
  { id: 'open-news4vip', site: 'open2ch', name: 'おーぷんVIP', base: 'https://hayabusa.open2ch.net/news4vip/', encoding: 'utf-8' },
];

export const BOARDS = process.env.BOARDS_JSON ? JSON.parse(process.env.BOARDS_JSON) : DEFAULT_BOARDS;

export function getBoard(id) {
  return BOARDS.find((b) => b.id === id);
}

const UA = process.env.USER_AGENT || 'Mozilla/5.0 (compatible; 2chMatomeViewer/0.1)';

// テスト/デモ用に差し替え可能なフェッチャ
let fetcher = async (url, encoding) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return new TextDecoder(encoding, { fatal: false }).decode(buf);
};
export function setFetcher(fn) {
  fetcher = fn;
}

export async function fetchSubject(board) {
  const text = await fetcher(new URL('subject.txt', board.base).href, board.encoding);
  return parseSubject(text);
}

export function threadUrl(board, key) {
  const u = new URL(board.base);
  const boardName = u.pathname.replace(/\//g, '');
  return `${u.origin}/test/read.cgi/${boardName}/${key}/`;
}

// dat を試し、ダメなら read.cgi の HTML を解析
export async function fetchThread(board, key) {
  try {
    const text = await fetcher(new URL(`dat/${key}.dat`, board.base).href, board.encoding);
    const t = parseDat(text);
    if (t.posts.length) return t;
  } catch {
    /* fallthrough */
  }
  const html = await fetcher(threadUrl(board, key), board.encoding);
  const t = parseReadCgi(html);
  if (!t.posts.length) throw new Error('スレッドを解析できませんでした');
  return t;
}

// 任意のスレURL(read.cgi 形式)から板とキーを特定
export function resolveThreadUrl(url) {
  const m = url.match(/^https?:\/\/([^/]+)\/test\/read\.cgi\/([^/]+)\/(\d{9,11})/);
  if (!m) return null;
  const [, host, boardName, key] = m;
  const siteOf = (h) => (h.includes('open2ch') ? 'open2ch' : '5ch');
  let board = BOARDS.find((b) => new URL(b.base).pathname.replace(/\//g, '') === boardName && siteOf(new URL(b.base).host) === siteOf(host));
  if (!board) {
    const site = siteOf(host);
    board = {
      id: `${site === 'open2ch' ? 'open' : '5ch'}-${boardName}`,
      site,
      name: boardName,
      base: `https://${host}/${boardName}/`,
      encoding: site === 'open2ch' ? 'utf-8' : 'shift_jis',
      adhoc: true,
    };
  }
  return { board, key };
}

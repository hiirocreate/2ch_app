// 掲示板からの取得処理 (Node)。ホストは移転が多いので環境変数 BOARDS_JSON で差し替え可能。
import { parseSubject, parseDat, parseReadCgi } from '../public/lib/parse.js';
import { DEFAULT_BOARDS, threadUrl, resolveThreadUrl as resolve } from '../public/lib/boards.js';

export { DEFAULT_BOARDS, threadUrl };
export const BOARDS = process.env.BOARDS_JSON ? JSON.parse(process.env.BOARDS_JSON) : DEFAULT_BOARDS;

export function getBoard(id) {
  return BOARDS.find((b) => b.id === id);
}

export const resolveThreadUrl = (url) => resolve(url, BOARDS);

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

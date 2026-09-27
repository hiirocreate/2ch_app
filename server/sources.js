// 掲示板からの取得処理 (Node)。ホストは移転が多いので環境変数 BOARDS_JSON で差し替え可能。
import { fetchThreadData } from '../public/lib/thread.js';
import { decodeBytes } from '../public/lib/encoding.js';
import { DEFAULT_BOARDS, threadUrl, resolveThreadUrl as resolve, fetchSubjectList } from '../public/lib/boards.js';

export { DEFAULT_BOARDS, threadUrl };
export const BOARDS = process.env.BOARDS_JSON ? JSON.parse(process.env.BOARDS_JSON) : DEFAULT_BOARDS;

export function getBoard(id) {
  return BOARDS.find((b) => b.id === id);
}

export const resolveThreadUrl = (url) => resolve(url, BOARDS);

const UA = process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// テスト/デモ用に差し替え可能なフェッチャ
let fetcher = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return decodeBytes(new Uint8Array(await res.arrayBuffer()));
};
export function setFetcher(fn) {
  fetcher = fn;
}

export async function fetchSubject(board) {
  return fetchSubjectList(board, (url) => fetcher(url));
}

export const fetchThread = (board, key) => fetchThreadData(board, key, (url) => fetcher(url));

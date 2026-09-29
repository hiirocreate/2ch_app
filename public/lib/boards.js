import { parseSubject } from './parse.js';

// 板定義とURLユーティリティ (サーバー/アプリ共通)
export const DEFAULT_BOARDS = [
  { id: '5ch-livegalileo', site: '5ch', name: 'なんG', base: 'https://nova.5ch.io/livegalileo/', encoding: 'shift_jis' },
  { id: '5ch-livejupiter', site: '5ch', name: 'なんJ', base: 'https://eagle.5ch.io/livejupiter/', encoding: 'shift_jis' },
  { id: '5ch-news4vip', site: '5ch', name: 'ニュー速VIP', base: 'https://mi.5ch.io/news4vip/', encoding: 'shift_jis' },
  { id: '5ch-news', site: '5ch', name: 'ニュー速+', base: 'https://asahi.5ch.io/newsplus/', encoding: 'shift_jis' },
  { id: 'open-livejupiter', site: 'open2ch', name: 'おんJ', base: 'https://hayabusa.open2ch.net/livejupiter/', encoding: 'utf-8' },
  { id: 'open-news4vip', site: 'open2ch', name: 'おーぷんVIP', base: 'https://hayabusa.open2ch.net/news4vip/', encoding: 'utf-8' },
  { id: 'pink-megami', site: 'bbspink', name: '女神', base: 'https://phoebe.bbspink.com/megami/', encoding: 'shift_jis', adult: true },
];

// 5ch/BBSPINK はサーバー移転が頻繁なので、取得失敗時は板一覧(bbsmenu)から現在のホストを引き直す
export const BBSMENU = { '5ch': 'https://menu.5ch.io/bbsmenu.json', bbspink: 'https://menu.bbspink.com/bbsmenu.json' };

// bbsmenu.json から { 板名: 板URL } を作る
export function parseBbsmenu(json) {
  const out = {};
  for (const cat of JSON.parse(json).menu_list || []) {
    for (const b of cat.category_content || []) {
      if (b.directory_name && b.url) out[b.directory_name] = b.url.replace(/^http:/, 'https:');
    }
  }
  return out;
}

const boardName = (base) => new URL(base).pathname.replace(/\//g, '');

export function threadUrl(board, key) {
  return `${new URL(board.base).origin}/test/read.cgi/${boardName(board.base)}/${key}/`;
}

// 任意のスレURL(read.cgi 形式)から板とキーを特定
export function resolveThreadUrl(url, boards = DEFAULT_BOARDS) {
  const m = url.match(/^https?:\/\/([^/]+)\/test\/read\.cgi\/([^/]+)\/(\d{9,11})/);
  if (!m) return null;
  const [, host, name, key] = m;
  const siteOf = (h) => (h.includes('open2ch') ? 'open2ch' : h.includes('bbspink') ? 'bbspink' : '5ch');
  const site = siteOf(host);
  let board = boards.find((b) => boardName(b.base) === name && siteOf(new URL(b.base).host) === site);
  if (!board) {
    board = {
      id: `${{ open2ch: 'open', bbspink: 'pink' }[site] || '5ch'}-${name}`,
      site,
      name,
      base: `https://${host}/${name}/`,
      encoding: site === 'open2ch' ? 'utf-8' : 'shift_jis',
      adhoc: true,
    };
  }
  return { board, key };
}

// 板の現在ホストを bbsmenu から引き直し、変わっていれば board.base を更新して true を返す
const menuCache = {};
export async function relocateBoard(board, fetchText) {
  const menuUrl = BBSMENU[board.site];
  if (!menuUrl) return false;
  menuCache[board.site] ||= fetchText(menuUrl).then(parseBbsmenu);
  let menu;
  try {
    menu = await menuCache[board.site];
  } catch {
    delete menuCache[board.site];
    return false;
  }
  const url = menu[boardName(board.base)];
  if (!url || url === board.base) return false;
  board.base = url;
  return true;
}

// subject.txt 取得。失敗・空なら bbsmenu で移転先を確認して1回だけ再試行する
export async function fetchSubjectList(board, fetchText) {
  const get = async () => parseSubject(await fetchText(new URL('subject.txt', board.base).href));
  let err;
  try {
    const list = await get();
    if (list.length) return list;
  } catch (e) {
    err = e;
  }
  if (await relocateBoard(board, fetchText)) return get();
  if (err) throw err;
  return [];
}

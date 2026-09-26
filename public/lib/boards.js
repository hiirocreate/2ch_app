// 板定義とURLユーティリティ (サーバー/アプリ共通)
export const DEFAULT_BOARDS = [
  { id: '5ch-livejupiter', site: '5ch', name: 'なんJ', base: 'https://greta.5ch.io/livejupiter/', encoding: 'shift_jis' },
  { id: '5ch-news4vip', site: '5ch', name: 'ニュー速VIP', base: 'https://viper.5ch.io/news4vip/', encoding: 'shift_jis' },
  { id: '5ch-news', site: '5ch', name: 'ニュー速+', base: 'https://asahi.5ch.io/newsplus/', encoding: 'shift_jis' },
  { id: 'open-livejupiter', site: 'open2ch', name: 'おんJ', base: 'https://hayabusa.open2ch.net/livejupiter/', encoding: 'utf-8' },
  { id: 'open-news4vip', site: 'open2ch', name: 'おーぷんVIP', base: 'https://hayabusa.open2ch.net/news4vip/', encoding: 'utf-8' },
];

const boardName = (base) => new URL(base).pathname.replace(/\//g, '');

export function threadUrl(board, key) {
  return `${new URL(board.base).origin}/test/read.cgi/${boardName(board.base)}/${key}/`;
}

// 任意のスレURL(read.cgi 形式)から板とキーを特定
export function resolveThreadUrl(url, boards = DEFAULT_BOARDS) {
  const m = url.match(/^https?:\/\/([^/]+)\/test\/read\.cgi\/([^/]+)\/(\d{9,11})/);
  if (!m) return null;
  const [, host, name, key] = m;
  const siteOf = (h) => (h.includes('open2ch') ? 'open2ch' : '5ch');
  const site = siteOf(host);
  let board = boards.find((b) => boardName(b.base) === name && siteOf(new URL(b.base).host) === site);
  if (!board) {
    board = {
      id: `${site === 'open2ch' ? 'open' : '5ch'}-${name}`,
      site,
      name,
      base: `https://${host}/${name}/`,
      encoding: site === 'open2ch' ? 'utf-8' : 'shift_jis',
      adhoc: true,
    };
  }
  return { board, key };
}

// スレ本文の取得 (サーバー/アプリ共通)。サイトごとに取得方法の優先順を変え、失敗したら別の方法を試す。
//   おーぷん2ch: dat が公開されているので dat → read.cgi
//   5ch / BBSPINK: dat は非公開なので read.cgi → dat
import { parseDat, parseReadCgi, htmlToText } from './parse.js';
import { threadUrl } from './boards.js';

export async function fetchThreadData(board, key, fetchText) {
  const viaDat = async () => parseDat(await fetchText(new URL(`dat/${key}.dat`, board.base).href));
  const viaHtml = async () => {
    const html = await fetchText(threadUrl(board, key));
    const t = parseReadCgi(html);
    if (!t.posts.length) {
      const title = htmlToText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 60);
      throw new Error(`レスが見つかりません (ページ: ${title || html.slice(0, 60).replace(/\s+/g, ' ')})`);
    }
    return t;
  };
  const order = board.site === 'open2ch' ? [viaDat, viaHtml] : [viaHtml, viaDat];
  const errors = [];
  for (const fn of order) {
    try {
      const t = await fn();
      if (t.posts.length) return t;
      errors.push(`${fn === viaDat ? 'dat' : 'html'}: 空`);
    } catch (e) {
      errors.push(`${fn === viaDat ? 'dat' : 'html'}: ${e.message}`);
    }
  }
  throw new Error(`スレッドを取得できませんでした (${errors.join(' / ')})`);
}

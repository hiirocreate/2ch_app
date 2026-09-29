// スレ本文の取得 (サーバー/アプリ共通)。サイトごとに取得方法の優先順を変え、失敗したら別の方法を試す。
//   おーぷん2ch: dat が公開されているので dat → read.cgi
//   5ch / BBSPINK: dat は非公開なので read.cgi → dat
import { parseDat, parseReadCgi, htmlToText } from './parse.js';
import { threadUrl } from './boards.js';

//   browseText があれば (Android アプリ)、上記が全滅した時にブラウザ (WebView) 経由でも試す
export async function fetchThreadData(board, key, fetchText, browseText) {
  const datUrl = new URL(`dat/${key}.dat`, board.base).href;
  const viaDat = async (get = fetchText) => parseDat(await get(datUrl));
  const viaHtml = async (get = fetchText) => {
    const html = await get(threadUrl(board, key));
    const t = parseReadCgi(html);
    if (!t.posts.length) {
      const title = htmlToText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 60);
      throw new Error(`レスが見つかりません (ページ: ${title || html.slice(0, 60).replace(/\s+/g, ' ')})`);
    }
    return t;
  };
  const dat = ['dat', () => viaDat()];
  const html = ['html', () => viaHtml()];
  const order = board.site === 'open2ch' ? [dat, html] : [html, dat];
  if (browseText) order.push(['browser', () => viaHtml(browseText)], ['browser-dat', () => viaDat(browseText)]);
  const errors = [];
  for (const [name, fn] of order) {
    try {
      const t = await fn();
      if (t.posts.length) return t;
      errors.push(`${name}: 空`);
    } catch (e) {
      errors.push(`${name}: ${e.message.slice(0, 120)}`);
    }
  }
  throw new Error(`スレッドを取得できませんでした (${errors.join(' / ')})`);
}

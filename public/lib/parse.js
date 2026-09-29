// 掲示板テキスト(subject.txt / dat / read.cgi HTML)のパーサ。副作用なしの純粋関数のみ。

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}

// subject.txt: "1727312345.dat<>スレタイ (123)"  (おーぷん2chは "1727312345.cgi,スレタイ(123)" 形式もあり)
export function parseSubject(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^(\d{9,11})\.(?:dat<>|cgi,)(.*?)\s*\((\d+)\)\s*$/);
    if (!m) continue;
    if (Number(m[1]) > Date.now() / 1000 + 86400 * 30) continue; // 運営のお知らせ等 (未来キー)
    out.push({ key: m[1], title: decodeEntities(m[2]).trim(), resCount: Number(m[3]) });
  }
  return out;
}

// dat: "名前<>メール<>日付 ID:xxx<>本文<>スレタイ"
export function parseDat(text) {
  const posts = [];
  let title = '';
  const lines = text.split('\n').filter((l) => l.includes('<>'));
  lines.forEach((line, i) => {
    const [name = '', mail = '', dateId = '', body = '', t = ''] = line.split('<>');
    if (i === 0 && t) title = decodeEntities(t).trim();
    const idm = dateId.match(/ID:([^\s<]+)/);
    posts.push({
      no: i + 1,
      name: htmlToText(name),
      mail: decodeEntities(mail),
      date: htmlToText(dateId.replace(/\s*ID:[^\s<]+/, '')),
      id: idm ? idm[1] : '',
      body: cleanBody(htmlToText(body)),
    });
  });
  return { title, posts };
}

// 5ch の read.cgi HTML (dat 非公開板向けのフォールバック)。新旧レイアウトをベストエフォートで対応。
export function parseReadCgi(html) {
  const tm = html.match(/<title>([\s\S]*?)<\/title>/i);
  const title = tm ? htmlToText(tm[1]) : '';
  const posts = [];
  // 5ch は <div id="N" class="clear post">、BBSPINK は <article id="N" class="clear post">
  // 属性の順序に依存しないよう、タグを拾ってから id と class を個別に確認
  const starts = [...html.matchAll(/<(?:div|article)\b[^>]*>/gi)]
    .filter((m) => /\bclass="[^"]*\bpost\b[^"]*"/i.test(m[0]))
    .map((m) => Object.assign(m, { 1: m[0].match(/\bid="(\d+)"/)?.[1] }))
    .filter((m) => m[1]);
  if (!starts.length) return parseDlThread(html, title);
  starts.forEach((m, i) => {
    const end = starts[i + 1]?.index ?? Math.min(html.length, m.index + 30000);
    const block = html.slice(m.index + m[0].length, end);
    const pick = (cls) => {
      const r = block.match(new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/(?:span|div|dd|section)>`, 'i'));
      return r ? r[1] : '';
    };
    const uid = m[0].match(/data-userid="ID:([^"]+)"/) || block.match(/ID:([^\s<"]+)/);
    posts.push({
      no: Number(m[1]),
      name: htmlToText((block.match(/class="postusername"[^>]*>\s*<b>([\s\S]*?)<\/b>/i) || [])[1] ?? pick('name')),
      mail: '',
      date: htmlToText(pick('date')),
      id: uid ? uid[1] : '',
      body: cleanBody(htmlToText(pick('(?:post-content|message|escaped)'))),
    });
  });
  return { title, posts };
}

// おーぷん2ch / 旧2ch 形式: <dt res="N">番号：名前：日付 ID:xx</dt><dd>本文</dd>
function parseDlThread(html, title) {
  const posts = [];
  for (const m of html.matchAll(/<dt\b([^>]*)>([\s\S]*?)<\/?dd\b[^>]*>([\s\S]*?)(?=<\/dd>|<dt\b|<\/dl>)/gi)) {
    const [, attrs, head, body] = m;
    const no = Number(attrs.match(/\bres="(\d+)"/)?.[1] || htmlToText(head).match(/^(\d+)/)?.[1]);
    if (!no) continue;
    const headText = htmlToText(head).replace(/\s+/g, ' ');
    posts.push({
      no,
      name: htmlToText(head.match(/class="name"[^>]*>([\s\S]*?)<\/font>/i)?.[1] || head.match(/<b>([\s\S]*?)<\/b>/i)?.[1] || ''),
      mail: '',
      date: headText.match(/(\d{2,4}\/\d{2}\/\d{2}\S*\s+[\d:.]+)/)?.[1] || '',
      id: headText.match(/ID:\s*([^\s<]+?)(?:主)?(?:\s|$)/)?.[1] || '',
      body: cleanBody(htmlToText(body)),
    });
  }
  return { title, posts };
}

// スレ立て時のシステム行 (!extend / VIPQ2_EXTDAT) を除去
function cleanBody(body) {
  return body
    .replace(/^!extend:.*$/gm, '')
    .replace(/\s*VIPQ2_EXTDAT:[\s\S]*?EXT was configured/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 本文中のアンカー(>>12, >>3-5)を抽出
export function extractAnchors(body) {
  const nums = new Set();
  for (const m of body.matchAll(/(?:>>|＞＞)(\d{1,4})(?:-(\d{1,4}))?/g)) {
    const a = Number(m[1]);
    const b = m[2] ? Math.min(Number(m[2]), a + 20) : a;
    for (let i = a; i <= b; i++) nums.add(i);
  }
  return [...nums];
}

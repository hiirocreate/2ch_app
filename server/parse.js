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
      body: htmlToText(body),
    });
  });
  return { title, posts };
}

// 5ch の read.cgi HTML (dat 非公開板向けのフォールバック)。新旧レイアウトをベストエフォートで対応。
export function parseReadCgi(html) {
  const tm = html.match(/<title>([\s\S]*?)<\/title>/i);
  const title = tm ? htmlToText(tm[1]) : '';
  const posts = [];
  const re = /<div[^>]*\bid="(\d+)"[^>]*class="[^"]*\bpost\b[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*\bid="\d+"[^>]*class="[^"]*\bpost\b|<\/section>|<div class="(?:navmenu|pagestats|bottom)|$)/gi;
  let m;
  while ((m = re.exec(html))) {
    const block = m[2];
    const pick = (cls) => {
      const r = block.match(new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/(?:span|div|dd)>`, 'i'));
      return r ? r[1] : '';
    };
    const uid = block.match(/ID:([^\s<"]+)/) || m[0].match(/data-userid="ID:([^"]+)"/);
    posts.push({
      no: Number(m[1]),
      name: htmlToText(pick('name')),
      mail: '',
      date: htmlToText(pick('date')),
      id: uid ? uid[1] : '',
      body: htmlToText(pick('(?:post-content|message|escaped)')),
    });
  }
  return { title, posts };
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

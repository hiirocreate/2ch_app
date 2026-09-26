// DEMO=1 用のオフラインデータ。掲示板にアクセスできない環境でも UI と動画化を試せる。
const now = Math.floor(Date.now() / 1000);

const TITLES = [
  ['【悲報】ワイ、会社のPCで壮大な誤爆をしてしまう', 1000, 60 * 60 * 5],
  ['ワイ、30年ぶりに実家の押入れを開けた結果ｗｗｗｗ', 1000, 60 * 60 * 20],
  ['【実況】今日の試合を語るスレ', 820, 60 * 50],
  ['猫が膝から降りない時の正しい対処法', 312, 60 * 60 * 3],
  ['【朗報】ワイ氏、ついに宝くじで5000円当てる', 150, 60 * 40],
  ['なんで夏ってこんなに暑いんや？', 95, 60 * 60 * 2],
  ['おんJ民の好きな駅弁ｗｗｗ', 480, 60 * 60 * 6],
  ['【急募】カレーに入れると美味い隠し味', 260, 60 * 90],
];

const OP_LINES = [
  '聞いてくれ、とんでもないことになった',
  '事の発端は昨日の夜や',
  '押入れの奥から古い段ボールが出てきたんや',
  '開けたら親父の若い頃の日記が入ってた',
  '最初のページに「未来の息子へ」って書いてあって震えた',
  '読み進めたら、ワイが生まれた日のことが書いてあったんや',
  '「こいつが大きくなったら一緒に釣りに行きたい」やって',
  'ワイ、親父と釣りなんか行ったことないんや',
  'せやから今週末、親父誘ってみたで',
  '返事は「おう」だけやったけど、声が嬉しそうやった',
  '釣れたのは小さいアジ一匹やったけど、最高の一日やった',
  'みんな聞いてくれてありがとうな',
];
const ANON = [
  'はよ', '続けて', 'ええ話やん…', '草', 'ワロタ', 'ファッ！？', '泣いた', 'これは神スレ', 'イッチ頑張れ',
  '>>1 それでどうなったんや', '親父ええ人やな', 'ワイも実家帰るわ', '保存した', '伝説のスレになりそう',
  'ここまで全部ワイの妄想', 'なんやこのスレ（感動）', 'まとめられそう', '期待', 'はえ〜すっごい', 'ｗｗｗｗｗ',
];

function datLine(name, id, body, title = '', sec = now) {
  const d = new Date(sec * 1000).toISOString().replace('T', ' ').slice(0, 19);
  return `${name}<><>${d} ID:${id}<>${body.replace(/\n/g, ' <br> ')}<>${title}`;
}

function makeDat(title, count, key) {
  let rnd = Number(key) % 9973;
  const r = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const lines = [datLine('風吹けば名無し', 'OpX1ch0', OP_LINES[0], title, Number(key))];
  let op = 1;
  for (let i = 2; i <= count; i++) {
    if (i % 25 === 0 && op < OP_LINES.length) {
      lines.push(datLine('風吹けば名無し', 'OpX1ch0', OP_LINES[op++]));
      continue;
    }
    let body = ANON[Math.floor(r() * ANON.length)];
    if (r() < 0.15) body = `>>${Math.max(1, i - 1 - Math.floor(r() * 10))}\n${body}`;
    lines.push(datLine('風吹けば名無し', `id${Math.floor(r() * 400)}`, body));
  }
  return lines.join('\n');
}

const subjects = {};
const dats = {};
TITLES.forEach(([title, count, age], i) => {
  const key = String(now - age - i);
  const board = i % 2 ? 'livejupiter' : 'news4vip';
  (subjects[board] ||= []).push(`${key}.dat<>${title} (${count})`);
  dats[`${board}/${key}`] = makeDat(title, count, key);
});

export async function demoFetcher(url) {
  const u = new URL(url);
  const board = u.pathname.split('/').filter(Boolean)[0];
  if (u.pathname.endsWith('subject.txt')) return (subjects[board] || []).join('\n');
  const m = u.pathname.match(/dat\/(\d+)\.dat$/);
  if (m && dats[`${board}/${m[1]}`]) return dats[`${board}/${m[1]}`];
  throw new Error(`demo: not found ${url}`);
}

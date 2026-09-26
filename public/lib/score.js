// 勢い・神スレ度の算出
import { extractAnchors } from './parse.js';

// 勢い = 1日あたりのレス数 (スレキー = 立った時刻の UNIX 秒)
export function momentum(key, resCount, nowSec = Date.now() / 1000) {
  const elapsed = Math.max(nowSec - Number(key), 60);
  return Math.round((resCount / elapsed) * 86400);
}

const LAUGH = /草|ワロタ|わろた|ｗｗ|ww|笑った|腹痛い|ファッ/;
const PRAISE = /神スレ|良スレ|名スレ|泣いた|感動|保存した|まとめ(?:られ|ろ)|伝説/;
const ONE = /イッチ|>>1(?!\d)|＞＞1(?!\d)/;

// 神スレ度 (0-100)。レス内容から「盛り上がり」「イッチへの注目」「称賛」を評価。
export function kamiScore(posts) {
  if (!posts.length) return { score: 0, detail: {} };
  const op = posts[0].id;
  const ids = new Set(posts.map((p) => p.id).filter(Boolean));
  const replies = new Map();
  let laugh = 0;
  let praise = 0;
  let toOne = 0;
  let opPosts = 0;
  for (const p of posts.slice(1)) {
    for (const a of extractAnchors(p.body)) replies.set(a, (replies.get(a) || 0) + 1);
    if (LAUGH.test(p.body)) laugh++;
    if (PRAISE.test(p.body)) praise++;
    if (ONE.test(p.body)) toOne++;
    if (op && p.id === op) opPosts++;
  }
  const n = posts.length;
  const volume = Math.min(n / 1000, 1); // 完走に近いほど高い
  const variety = Math.min(ids.size / 300, 1); // 参加人数
  const laughR = Math.min((laugh / n) * 4, 1);
  const praiseR = Math.min((praise / n) * 25, 1);
  const opR = Math.min(((toOne + opPosts) / n) * 3, 1); // イッチ中心に回っている
  const hot = Math.min([...replies.values()].filter((v) => v >= 5).length / 15, 1); // 被アンカー多数レス
  const score = Math.round(100 * (0.2 * volume + 0.15 * variety + 0.15 * laughR + 0.2 * praiseR + 0.15 * opR + 0.15 * hot));
  return { score, detail: { volume, variety, laughR, praiseR, opR, hot } };
}

// 動画用のハイライト抽出: イッチのレス + 被アンカー数の多いレス + 反応の強いレス
export function pickHighlights(posts, limit = 40) {
  const replies = new Map();
  for (const p of posts) for (const a of extractAnchors(p.body)) replies.set(a, (replies.get(a) || 0) + 1);
  const op = posts[0]?.id;
  const scored = posts.map((p) => {
    let s = (replies.get(p.no) || 0) * 3;
    if (p.no === 1) s += 1000;
    if (op && p.id === op) s += 8;
    if (LAUGH.test(p.body)) s += 1;
    if (p.body.length > 400) s -= 3; // 長すぎるコピペ等
    if (/https?:\/\//.test(p.body)) s -= 2;
    return { p, s };
  });
  return scored
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.p)
    .sort((a, b) => a.no - b.no);
}

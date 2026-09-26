import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubject, parseDat, parseReadCgi, extractAnchors } from '../server/parse.js';
import { momentum, kamiScore, pickHighlights } from '../server/score.js';
import { resolveThreadUrl } from '../server/sources.js';
import { ruleBasedScript } from '../server/video.js';
import { demoFetcher } from '../server/demo.js';

test('parseSubject', () => {
  const s = parseSubject('1727312345.dat<>【悲報】ワイ &amp; 猫 (123)\n1727312000.cgi,おんJテスト(45)\nbroken');
  assert.deepEqual(s, [
    { key: '1727312345', title: '【悲報】ワイ & 猫', resCount: 123 },
    { key: '1727312000', title: 'おんJテスト', resCount: 45 },
  ]);
});

test('parseDat', () => {
  const t = parseDat('名無し<>sage<>2024/09/26(木) 12:00:00.00 ID:abc123<> 本文 <br> 2行目 &gt;&gt;1 <>スレタイ\n名無し<><>2024/09/26 ID:def<> <a href="x">&gt;&gt;1</a> 草 <>');
  assert.equal(t.title, 'スレタイ');
  assert.equal(t.posts[0].id, 'abc123');
  assert.equal(t.posts[0].body, '本文\n2行目 >>1');
  assert.equal(t.posts[1].body, '>>1 草');
});

test('parseReadCgi', () => {
  const html = '<title>テストスレ</title><div id="1" data-userid="ID:aaa" class="clear post"><span class="name"><b>名無し</b></span><span class="date">2024/01/01</span><div class="post-content"> こんにちは<br>世界 </div></div><div id="2" data-userid="ID:bbb" class="clear post"><span class="name">名無し</span><div class="post-content">&gt;&gt;1 ｗ</div></div></section>';
  const t = parseReadCgi(html);
  assert.equal(t.title, 'テストスレ');
  assert.equal(t.posts.length, 2);
  assert.equal(t.posts[0].body, 'こんにちは\n世界');
  assert.equal(t.posts[1].id, 'bbb');
});

test('anchors', () => assert.deepEqual(extractAnchors('>>1 ＞＞3-5 >>1'), [1, 3, 4, 5]));

test('momentum', () => assert.equal(momentum(1000, 100, 1000 + 86400), 100));

test('resolveThreadUrl', () => {
  const r = resolveThreadUrl('https://hayabusa.open2ch.net/test/read.cgi/livejupiter/1727312345/l50');
  assert.equal(r.board.id, 'open-livejupiter');
  assert.equal(r.key, '1727312345');
  const a = resolveThreadUrl('https://mi.5ch.io/test/read.cgi/poverty/1700000000/');
  assert.equal(a.board.id, '5ch-poverty');
  assert.equal(a.board.adhoc, true);
  assert.equal(resolveThreadUrl('https://example.com/'), null);
});

test('demo kami thread scores higher and produces a script', async () => {
  const subj = parseSubject(await demoFetcher('https://x/news4vip/subject.txt'));
  const kami = subj.find((s) => s.title.includes('押入れ')) || subj.find((s) => s.resCount === 1000);
  const small = subj.find((s) => s.resCount < 300);
  const dat = (s, b) => demoFetcher(`https://x/${b}/dat/${s.key}.dat`).then(parseDat);
  const board = (await demoFetcher('https://x/livejupiter/subject.txt')).includes(kami.key) ? 'livejupiter' : 'news4vip';
  const big = await dat(kami, board);
  const low = await dat(small, 'news4vip').catch(() => dat(small, 'livejupiter'));
  assert.ok(kamiScore(big.posts).score > kamiScore(low.posts).score);
  const hl = pickHighlights(big.posts);
  assert.equal(hl[0].no, 1);
  const sc = ruleBasedScript(kami.title, hl, big.posts[0].id);
  assert.ok(sc.scenes.length > 5);
  assert.equal(sc.scenes[1].speaker, 'op');
  assert.ok(sc.scenes.every((s) => s.text && s.image));
});

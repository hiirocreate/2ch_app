import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubject, parseDat, parseReadCgi, extractAnchors } from '../public/lib/parse.js';
import { momentum, kamiScore, pickHighlights } from '../public/lib/score.js';
import { resolveThreadUrl } from '../server/sources.js';
import { ruleBasedScript } from '../public/lib/script.js';
import { demoFetcher } from '../public/lib/demo.js';

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

test('decodeBytes: Shift_JIS(CP932) と UTF-8 を自動判定', async () => {
  const { decodeBytes, base64ToBytes } = await import('../public/lib/encoding.js');
  const sjis = new Uint8Array([129, 121, 148, 223, 149, 241, 129, 122, 131, 143, 131, 67, 129, 65, 145, 144, 32, 135, 64, 238, 224]);
  assert.equal(decodeBytes(sjis), '【悲報】ワイ、草 ①髙');
  assert.equal(decodeBytes(new TextEncoder().encode('﻿おんJ (12)')), 'おんJ (12)');
  assert.equal(decodeBytes(base64ToBytes(Buffer.from('テスト').toString('base64'))), 'テスト');
});

test('parseReadCgi: 実際の 5ch HTML (2026/09 時点)', async () => {
  const fs = await import('node:fs');
  const t = parseReadCgi(fs.readFileSync(new URL('./fixtures/5ch-readcgi.html', import.meta.url), 'utf8'));
  assert.equal(t.posts.length, 5);
  assert.equal(t.posts[1].name, '風吹けば名無し');
  assert.equal(t.posts[1].body, 'ねむい');
  assert.ok(t.posts[0].id);
  assert.ok(!t.posts[0].body.includes('!extend'));
});

test('links: URL抽出と種類判定', async () => {
  const { splitLinks, classifyUrl, parseOgp } = await import('../public/lib/links.js');
  const urls = splitLinks('見て youtu.be/Jr4bYLjNYpM と ttps://i.imgur.com/abcDE12.png、https://imgur.com/XyZ1234。').filter((p) => p.url);
  assert.deepEqual(urls.map((u) => classifyUrl(u.url).type), ['youtube', 'image', 'image']);
  assert.equal(classifyUrl(urls[2].url).src, 'https://i.imgur.com/XyZ1234.jpg');
  assert.equal(classifyUrl('https://example.com/').type, 'page');
  assert.equal(classifyUrl('https://i.imgur.com/abc.gifv').type, 'video');
  const o = parseOgp('<meta property="og:title" content="タイトル"><meta property="og:image" content="/a.png">', 'https://ex.com/p');
  assert.deepEqual([o.title, o.image, o.site], ['タイトル', 'https://ex.com/a.png', 'ex.com']);
});

test('parseBbsmenu / resolveThreadUrl (BBSPINK)', async () => {
  const { parseBbsmenu } = await import('../public/lib/boards.js');
  const m = parseBbsmenu(JSON.stringify({ menu_list: [{ category_content: [{ directory_name: 'livejupiter', url: 'https://eagle.5ch.io/livejupiter/' }] }] }));
  assert.equal(m.livejupiter, 'https://eagle.5ch.io/livejupiter/');
  assert.equal(resolveThreadUrl('https://phoebe.bbspink.com/test/read.cgi/megami/1789209258/').board.id, 'pink-megami');
});

test('parseReadCgi: BBSPINK (<article> レイアウト)', async () => {
  const fs = await import('node:fs');
  const t = parseReadCgi(fs.readFileSync(new URL('./fixtures/bbspink-readcgi.html', import.meta.url), 'utf8'));
  assert.equal(t.title, 'テストスレ');
  assert.equal(t.posts.length, 2);
  assert.equal(t.posts[0].body, 'スレ立てテスト\n2行目');
  assert.deepEqual([t.posts[1].id, t.posts[1].body], ['bbbb0002', '>>1\n乙']);
});

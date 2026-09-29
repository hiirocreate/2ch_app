import { Player } from './player.js';
import { splitLinks, classifyUrl } from './lib/links.js';
import { resolveThreadUrl } from './lib/boards.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const api = async (url, opt) => {
  const r = await fetch(url, opt);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
};

const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const httpApi = {
  boards: () => api('/api/boards'),
  threads: (params) => api(`/api/threads?${new URLSearchParams(params)}`),
  thread: (board, key, force) => api(`/api/thread/${board}/${key}${force ? '?force=1' : ''}`),
  refresh: () => api('/api/refresh', json({})),
  ogp: (url) => api(`/api/ogp?url=${encodeURIComponent(url)}`),
  importUrl: (url) => api('/api/import', json({ url })),
  video: (board, key, regenerate) => api(`/api/video/${board}/${key}`, json({ regenerate })),
};
const native = !!window.AndroidBridge; // Android アプリ内では端末内で巡回・生成する
let backend = httpApi;

const state = { mode: 'live', board: '', q: '', current: null };
const player = new Player($('#cv'));

async function init() {
  if (native) {
    const m = await import('./local-api.js');
    backend = m.localApi;
    m.startCrawl(throttle(loadList, 400));
    setupSettings();
  }
  const boards = await backend.boards();
  state.adultBoards = new Set(boards.filter((b) => b.adult).map((b) => b.id));
  $('#boards').innerHTML = [{ id: '', name: 'すべて' }, ...boards].map((b) => `<button data-b="${b.id}" class="${b.id === '' ? 'on' : ''}">${esc(b.name)}${b.adult ? '🔞' : ''}</button>`).join('');
  $('#boards').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    // 成人向け板 (BBSPINK) は初回に年齢確認。「すべて」には含めない
    if (state.adultBoards.has(b.dataset.b) && localStorage.getItem('adultOk') !== '1') {
      if (!confirm('成人向けの板です。18歳以上ですか？')) return;
      localStorage.setItem('adultOk', '1');
    }
    state.board = b.dataset.b;
    [...$('#boards').children].forEach((x) => x.classList.toggle('on', x === b));
    loadList();
  };
  $('#tabs').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.mode = b.dataset.mode;
    [...$('#tabs').children].forEach((x) => x.classList.toggle('on', x === b));
    loadList();
  };
  let tm;
  $('#q').oninput = (e) => {
    clearTimeout(tm);
    tm = setTimeout(() => ((state.q = e.target.value), loadList()), 300);
  };
  $('#import').onsubmit = async (e) => {
    e.preventDefault();
    const url = e.target.url.value.trim();
    if (!url) return;
    try {
      const t = await backend.importUrl(url);
      e.target.reset();
      openThread(t.board, t.key);
    } catch (err) {
      alert(`追加できませんでした: ${err.message}`);
    }
  };
  $('#reload').onclick = reloadList;
  $('#treload').onclick = () => {
    const [, , board, key] = location.hash.split('/');
    showThread(board, key, true);
  };
  $('#back').onclick = () => history.back();
  $('#mkvideo').onclick = () => openPlayer(state.current.board.id, state.current.key);
  $('#pclose').onclick = () => history.back();
  window.onpopstate = route;
  loadList();
  setInterval(() => state.mode === 'live' && !document.hidden && loadList(), 60_000);
  route();
  if (!native && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function throttle(fn, ms) {
  let t = null;
  return () => t || (t = setTimeout(() => ((t = null), fn()), ms));
}

async function reloadList() {
  const btn = $('#reload');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('spin');
  try {
    await backend.refresh();
  } catch (e) {
    alert(`更新に失敗しました: ${e.message}`);
  }
  btn.disabled = false;
  btn.classList.remove('spin');
  loadList();
}

const titles = new Map(); // 一覧で見たスレタイ (スレを開いた瞬間に表示するため)

async function loadList() {
  const list = (await backend.threads({ mode: state.mode, board: state.board, q: state.q }).catch(() => [])).filter(
    (t) => state.board || !state.adultBoards?.has(t.board)
  );
  list.forEach((t) => titles.set(`${t.board}/${t.key}`, t.title));
  const fmt = (n) => (n >= 10000 ? `${(n / 10000).toFixed(1)}万` : n);
  $('#list').innerHTML = list.length
    ? list
        .map(
          (t) => `<div class="item" data-b="${t.board}" data-k="${t.key}">
      <div class="t">${esc(t.title)}</div>
      <div class="m"><span>${esc(t.boardName)}</span><span>${t.resCount}レス</span>
      <span class="${t.momentum > 10000 ? 'hot' : ''}">勢い ${fmt(state.mode === 'history' ? t.maxMomentum : t.momentum)}</span>
      <span>${new Date(Number(t.key) * 1000).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })}</span>
      ${t.kami ? `<span class="badge">神スレ度 ${t.kami.score}</span>` : ''}${t.hasVideo ? '<span class="badge">🎬</span>' : ''}</div></div>`
        )
        .join('')
    : `<div class="empty">${state.mode === 'kami' ? '神スレはまだ見つかっていません（巡回で自動判定 / URL追加でも判定されます）' : 'スレを取得中…しばらくお待ちください'}</div>`;
  $('#list').onclick = (e) => {
    const it = e.target.closest('.item');
    if (!it) return;
    state.mode === 'kami' ? openPlayer(it.dataset.b, it.dataset.k) : openThread(it.dataset.b, it.dataset.k);
  };
}

function openThread(board, key) {
  history.pushState({}, '', `#/t/${board}/${key}`);
  route();
}
function openPlayer(board, key) {
  history.pushState({}, '', `#/v/${board}/${key}`);
  route();
}

async function route() {
  const [, kind, board, key] = location.hash.split('/');
  $('#thread').hidden = kind !== 't';
  $('#player').hidden = kind !== 'v';
  if (kind !== 'v') player.stop();
  if (kind === 't') await showThread(board, key);
  if (kind === 'v') await showPlayer(board, key);
}

async function showThread(board, key, force = false) {
  if (!force && state.current?.key === key && state.current.board.id === board) return;
  $('#ttitle').textContent = titles.get(`${board}/${key}`) || state.current?.meta?.title || '';
  $('#posts').innerHTML = '<div class="empty">読み込み中…</div>';
  $('#treload').disabled = true;
  try {
    const t = await backend.thread(board, key, force);
    state.current = { ...t, key };
    $('#ttitle').textContent = t.meta?.title || t.title;
    const op = t.posts[0]?.id;
    const counts = {};
    t.posts.forEach((p) => p.id && (counts[p.id] = (counts[p.id] || 0) + 1));
    $('#posts').innerHTML =
      t.posts
        .map(
          (p) => `<div class="post ${op && p.id === op ? 'op' : ''}" id="r${p.no}">
      <div class="h">${p.no} <b>${esc(p.name)}</b> ${esc(p.date)} ${p.id ? `ID:${esc(p.id)}(${counts[p.id]})` : ''}${op && p.id === op ? ' [イッチ]' : ''}</div>
      ${renderBody(p.body)}</div>`
        )
        .join('') + `<p><a href="${esc(t.source)}" target="_blank" rel="noopener" style="color:var(--sub)">元スレを開く</a></p>`;
    observePreviews();
    $('#posts').onclick = (e) => {
      document.querySelector('.pop')?.remove();
      if (openMedia(e)) return;
      const a = e.target.closest('.anc');
      if (!a) return;
      const src = document.getElementById(`r${a.dataset.n}`);
      if (!src) return;
      const pop = document.createElement('div');
      pop.className = 'pop';
      pop.innerHTML = src.innerHTML;
      document.body.append(pop);
    };
  } catch (e) {
    $('#posts').innerHTML = `<div class="empty">取得失敗: ${esc(e.message)}<br>↻ で再読み込み</div>`;
  } finally {
    $('#treload').disabled = false;
  }
}

// ---- 本文のリンク: 画像/動画はサムネ、YouTube はサムネ、その他のページは OGP カード ----
const anchorize = (t) => esc(t).replace(/&gt;&gt;(\d{1,4})/g, '<span class="anc" data-n="$1">&gt;&gt;$1</span>');

function renderBody(body) {
  const media = [];
  const cards = [];
  const text = splitLinks(body)
    .map((part) => {
      if (part.text != null) return anchorize(part.text);
      const c = classifyUrl(part.url);
      const thread = resolveThreadUrl(part.url);
      if (thread && !thread.board.adhoc) {
        return `<a class="ext" href="#/t/${thread.board.id}/${thread.key}">${esc(part.raw)}</a>`;
      }
      if (c.type === 'image') media.push(`<img class="thumb" loading="lazy" referrerpolicy="no-referrer" src="${esc(c.src)}" data-full="${esc(c.src)}" data-link="${esc(part.url)}" onerror="this.classList.add('broken')">`);
      else if (c.type === 'video') media.push(`<video class="thumb" preload="metadata" muted playsinline src="${esc(c.src)}" data-full="${esc(c.src)}" data-video="1"></video>`);
      else if (c.type === 'youtube') media.push(`<a class="yt" href="${esc(part.url)}" target="_blank" rel="noopener"><img class="thumb" loading="lazy" src="${esc(c.src)}"><span>▶</span></a>`);
      else if (c.type === 'page' && cards.length < 3) cards.push(`<a class="ogp" data-url="${esc(part.url)}" href="${esc(part.url)}" target="_blank" rel="noopener"><span class="os">${esc(new URL(part.url).hostname)}</span></a>`);
      return `<a class="ext" href="${esc(part.url)}" target="_blank" rel="noopener">${esc(part.raw)}</a>`;
    })
    .join('');
  return `<div class="b">${text}</div>${media.length ? `<div class="media">${media.join('')}</div>` : ''}${cards.join('')}`;
}

// 画面に入ったカードだけ OGP を取得 (同時3件まで)
let previewObserver;
const ogpQueue = [];
let ogpActive = 0;
function observePreviews() {
  previewObserver?.disconnect();
  previewObserver = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        previewObserver.unobserve(en.target);
        ogpQueue.push(en.target);
      }
      pumpOgp();
    },
    { rootMargin: '300px' }
  );
  document.querySelectorAll('#posts .ogp').forEach((el) => previewObserver.observe(el));
}
function pumpOgp() {
  while (ogpActive < 3 && ogpQueue.length) {
    const el = ogpQueue.shift();
    ogpActive++;
    backend
      .ogp(el.dataset.url)
      .then((o) => {
        if (!o.title && !o.image) return;
        el.innerHTML = `${o.image ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(o.image)}" onerror="this.remove()">` : ''}<span class="ot">${esc(o.title || o.url)}</span>${o.description ? `<span class="od">${esc(o.description)}</span>` : ''}<span class="os">${esc(o.site)}</span>`;
        el.classList.add('loaded');
      })
      .catch(() => {})
      .finally(() => {
        ogpActive--;
        pumpOgp();
      });
  }
}

// 画像・動画をタップで全画面表示 (もう一度タップで閉じる / 長押しなしで元URLは下部リンク)
function openMedia(e) {
  const m = e.target.closest('.thumb[data-full]');
  if (!m) return false;
  e.preventDefault();
  const v = document.createElement('div');
  v.id = 'viewer';
  v.innerHTML = m.dataset.video
    ? `<video src="${esc(m.dataset.full)}" controls autoplay loop playsinline></video>`
    : `<img referrerpolicy="no-referrer" src="${esc(m.dataset.full)}"><a href="${esc(m.dataset.link || m.dataset.full)}" target="_blank" rel="noopener">元のリンクを開く</a>`;
  v.onclick = (ev) => ev.target.tagName !== 'VIDEO' && ev.target.tagName !== 'A' && v.remove();
  document.body.append(v);
  return true;
}

async function showPlayer(board, key, regenerate = false) {
  $('#ploading').hidden = false;
  $('#ploading').textContent = '台本を生成中…（AI生成は数十秒かかることがあります）';
  $('#psummary').textContent = '';
  try {
    const v = await backend.video(board, key, regenerate);
    $('#ptitle').textContent = v.title;
    $('#psummary').textContent = `${v.summary}（台本: ${v.generator}）`;
    $('#ploading').hidden = true;
    player.load(v);
  } catch (e) {
    $('#ploading').textContent = `生成失敗: ${e.message}`;
  }
  $('#pregen').onclick = () => (player.stop(), showPlayer(board, key, true));
}

$('#pplay').onclick = () => player.toggle();
$('#pprev').onclick = () => player.go(player.index - 1);
$('#pnext').onclick = () => player.go(player.index + 1);
$('#pseek').oninput = (e) => player.go(Number(e.target.value));
$('#pbgm').onchange = (e) => player.setBgm(e.target.checked);
$('#ptts').onchange = (e) => (player.tts = e.target.checked);
player.onchange = (i, n, playing) => {
  $('#pseek').max = n - 1;
  $('#pseek').value = i;
  $('#pplay').textContent = playing ? '⏸' : '▶';
};

function setupSettings() {
  const btn = document.createElement('button');
  btn.textContent = '⚙';
  btn.id = 'settings';
  btn.onclick = async () => {
    const choice = prompt('設定メニュー（番号を入力）\n1: Claude APIキー\n2: デモデータ切替\n3: 通信診断（不具合報告用）', '3');
    if (choice === '1') {
      const key = prompt('Claude APIキー（動画台本のAI生成用。空欄ならルールベース台本）', localStorage.getItem('apiKey') || '');
      if (key !== null) key.trim() ? localStorage.setItem('apiKey', key.trim()) : localStorage.removeItem('apiKey');
    } else if (choice === '2') {
      const demo = confirm('デモデータで表示しますか？（OK=デモ / キャンセル=実際の掲示板）');
      if ((localStorage.getItem('demo') === '1') !== demo) {
        demo ? localStorage.setItem('demo', '1') : localStorage.removeItem('demo');
        localStorage.removeItem('db');
        location.reload();
      }
    } else if (choice === '3') {
      const v = document.createElement('div');
      v.id = 'diag';
      v.innerHTML = '<textarea readonly>診断中…（1分ほどかかります）</textarea><button>閉じる</button>';
      v.querySelector('button').onclick = () => v.remove();
      document.body.append(v);
      const text = await backend.diagnose().catch((e) => `診断失敗: ${e.message}`);
      v.querySelector('textarea').value = `${text}\n\n(${navigator.userAgent})`;
    }
  };
  $('h1').append(btn);
}

init();

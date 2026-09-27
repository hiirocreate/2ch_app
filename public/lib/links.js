// 本文中のURL抽出・種類判定 (画像/動画/YouTube/一般ページ) と OGP 解析
import { decodeEntities } from './parse.js';

// 掲示板では "ttp://" や スキーム無し "youtu.be/..." の書き方も多い
const URL_RE = /(?:h?ttps?:\/\/|(?<![\w./-])(?=(?:www\.|youtu\.be\/|(?:i\.)?imgur\.com\/|x\.com\/|twitter\.com\/)))[\w\-.~:/?#[\]@!$&'()*+,;=%]+/g;

const TRAIL = /[)\]、。」』.,!?]+$/;

export function normalizeUrl(raw) {
  let u = raw.replace(TRAIL, '');
  if (/^ttps?:/.test(u)) u = `h${u}`;
  else if (!/^https?:/.test(u)) u = `https://${u}`;
  return u;
}

// 本文を [{text} | {url, raw}] に分割
export function splitLinks(body) {
  const out = [];
  let last = 0;
  for (const m of body.matchAll(URL_RE)) {
    const raw = m[0].replace(TRAIL, '');
    const url = normalizeUrl(raw);
    if (m.index > last) out.push({ text: body.slice(last, m.index) });
    out.push({ url, raw });
    last = m.index + raw.length;
  }
  if (last < body.length) out.push({ text: body.slice(last) });
  return out;
}

export function classifyUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { type: 'none' };
  }
  const host = u.hostname.replace(/^(www|m|mobile)\./, '');
  const path = u.pathname;
  if (/\.(mp4|webm|gifv)$/i.test(path)) return { type: 'video', src: url.replace(/\.gifv$/i, '.mp4') };
  if (/\.(jpe?g|png|gif|webp|avif)$/i.test(path) || (host === 'pbs.twimg.com' && path.startsWith('/media/'))) return { type: 'image', src: url };
  if (host === 'imgur.com' || host === 'i.imgur.com') {
    const id = path.match(/^\/([A-Za-z0-9]{5,8})$/)?.[1];
    if (id) return { type: 'image', src: `https://i.imgur.com/${id}.jpg` };
  }
  let yt = null;
  if (host === 'youtu.be') yt = path.slice(1, 12);
  else if (host.endsWith('youtube.com')) yt = u.searchParams.get('v') || path.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/)?.[1];
  if (yt && /^[\w-]{11}$/.test(yt)) return { type: 'youtube', id: yt, src: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` };
  return { type: 'page' };
}

// <meta property="og:*"> / twitter:* / <title> を抽出
export function parseOgp(html, pageUrl) {
  const head = html.slice(0, 200_000);
  const meta = {};
  for (const m of head.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = m[0];
    const key = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const val = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (key && val != null && !(key in meta)) meta[key] = decodeEntities(val).trim();
  }
  const title = meta['og:title'] || meta['twitter:title'] || decodeEntities(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
  let image = meta['og:image'] || meta['twitter:image'] || meta['twitter:image:src'] || '';
  try {
    if (image) image = new URL(image, pageUrl).href;
  } catch {
    image = '';
  }
  return {
    url: pageUrl,
    title: title.slice(0, 200),
    description: (meta['og:description'] || meta['description'] || meta['twitter:description'] || '').slice(0, 300),
    image,
    site: meta['og:site_name'] || new URL(pageUrl).hostname,
  };
}

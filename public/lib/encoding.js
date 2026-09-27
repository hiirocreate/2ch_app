// 掲示板の文字コード自動判定。板やサーバーによって Shift_JIS / UTF-8 が混在し、ヘッダも当てにならないため
// 「UTF-8 として正しく読めるなら UTF-8、読めなければ Shift_JIS(CP932)」で判定する。
export function decodeBytes(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

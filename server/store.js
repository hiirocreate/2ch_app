// JSON ファイル永続化 (data/db.json)。過去の人気スレ履歴・スレ本文キャッシュ・動画台本を保持。
import fs from 'node:fs';
import path from 'node:path';
import { emptyDb as empty, tid, upsertThread as upsert, prune as pruneDb } from '../public/lib/db.js';

const DIR = process.env.DATA_DIR || path.resolve('data');
const FILE = path.join(DIR, 'db.json');


export const db = load();

function load() {
  try {
    return { ...empty(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return empty();
  }
}

let timer = null;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 500);
}
export function flush() {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}

export { tid };
export const upsertThread = (board, t, mom, now) => upsert(db, board, t, mom, now);
export const prune = (maxThreads = 20000) => pruneDb(db, maxThreads);

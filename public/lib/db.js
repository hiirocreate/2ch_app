// スレ履歴DBの操作 (サーバー/アプリ共通)。db = { threads, videos, boards, posts }
export const emptyDb = () => ({ threads: {}, videos: {}, boards: {}, posts: {} });
export const tid = (boardId, key) => `${boardId}:${key}`;

// subject.txt の観測結果を履歴に反映
export function upsertThread(db, board, t, mom, now = Date.now()) {
  const id = tid(board.id, t.key);
  const cur = db.threads[id];
  db.threads[id] = {
    id,
    board: board.id,
    key: t.key,
    title: t.title,
    resCount: Math.max(t.resCount, cur?.resCount || 0),
    momentum: mom,
    maxMomentum: Math.max(mom, cur?.maxMomentum || 0),
    firstSeen: cur?.firstSeen || now,
    lastSeen: now,
    kami: cur?.kami,
  };
  return db.threads[id];
}

// 古い・伸びなかったスレを間引いて肥大化を防ぐ
export function prune(db, maxThreads, maxPosts = Infinity) {
  const rank = (t) => (t.kami?.score || 0) * 1e6 + t.maxMomentum;
  Object.values(db.threads)
    .sort((a, b) => rank(b) - rank(a))
    .slice(maxThreads)
    .forEach((t) => {
      if (db.videos[t.id]) return;
      delete db.threads[t.id];
      delete db.posts[t.id];
    });
  const saved = Object.keys(db.posts);
  if (saved.length > maxPosts) {
    saved
      .filter((id) => !db.videos[id])
      .sort((a, b) => (db.threads[a]?.kami?.score || 0) - (db.threads[b]?.kami?.score || 0))
      .slice(0, saved.length - maxPosts)
      .forEach((id) => delete db.posts[id]);
  }
}

export function listThreads(db, { board, mode = 'live', q = '', limit = 100 }, { threshold, boardName }) {
  const now = Date.now();
  let list = Object.values(db.threads);
  if (board) list = list.filter((t) => t.board === board);
  if (q) list = list.filter((t) => t.title.includes(q));
  if (mode === 'live') {
    list = list.filter((t) => now - t.lastSeen < 30 * 60_000).sort((a, b) => b.momentum - a.momentum);
  } else if (mode === 'history') {
    list = list.sort((a, b) => b.maxMomentum - a.maxMomentum);
  } else if (mode === 'kami') {
    list = list.filter((t) => (t.kami?.score || 0) >= threshold || db.videos[t.id]).sort((a, b) => (b.kami?.score || 0) - (a.kami?.score || 0));
  }
  return list.slice(0, Number(limit)).map((t) => ({ ...t, boardName: boardName(t.board), hasVideo: !!db.videos[t.id] }));
}

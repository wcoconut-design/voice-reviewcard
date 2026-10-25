// 동기화 상자(폰 ↔ 아이맥) 공통 순서: 받아오기 → 합치기 → 바뀐 것 올리기.
// 아이맥(server/sync.mjs)과 폰 앱(mobile/local-api.js)이 함께 써요. 같은 작품은 최근에 고친 쪽을 남겨요.
// 이미지 경로는 'images/작품/파일' 모양으로 주고받아요.

export const filePaths = (w) => [...(w.images || []), ...(w.reviewCard || [])]
  .map((p) => String(p).replace(/^\//, ''))
  .filter((p) => /^images\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(p));

// ctx: {
//   url, key, device, fetch,
//   getState(): {rev, pushedAt, uploaded: []}, setState(st),
//   applyIncoming(items) → 바뀐 작품 수   (items: [{id, deleted, at, work}])
//   changedSince(pushedAt) → [work], takeTombstones() → [{id, at}], doneTombstones(list)
//   hasFile(path), readFile(path) → {body, type} | null, writeFile(path, blob)
// }
export async function syncOnce(ctx) {
  const base = ctx.url.replace(/\/+$/, '');
  const call = async (path, init = {}) => {
    const r = await ctx.fetch(base + path, { ...init, headers: { 'X-VB-Key': ctx.key, ...(init.headers || {}) } });
    if (r.status === 401) throw new Error('동기화 열쇠가 맞지 않아요.');
    if (r.status === 501) throw new Error((await r.json().catch(() => ({}))).error || '중계 서버에 동기화 보관함이 연결되지 않았어요.');
    if (!r.ok) throw new Error('동기화 서버 오류 (' + r.status + ')');
    return r;
  };
  const st = { rev: 0, pushedAt: '', uploaded: [], ...(await ctx.getState()) };
  const uploaded = new Set(st.uploaded || []);
  let pulled = 0, changed = 0, pushed = 0, files = 0;
  const serverAt = new Map(); // 이번에 받은 작품의 서버 쪽 수정 시각 (같거나 오래된 건 다시 올리지 않아요)

  // 1) 받아오기
  let more = true;
  while (more) {
    const r = await (await call('/sync/pull?since=' + st.rev)).json();
    for (const it of r.works) serverAt.set(it.id, it.at || it.work?.updatedAt || '');
    if (r.works.length) {
      changed += await ctx.applyIncoming(r.works);
      pulled += r.works.length;
      for (const it of r.works) if (it.work) for (const p of filePaths(it.work)) { uploaded.add(p); if (!(await ctx.hasFile(p))) { const fr = await ctx.fetch(base + '/files?path=' + encodeURIComponent(p), { headers: { 'X-VB-Key': ctx.key } }); if (fr.ok) { await ctx.writeFile(p, await fr.blob()); files++; } } }
    }
    st.rev = r.rev;
    more = r.more;
  }

  // 2) 올리기: 마지막으로 올린 뒤 고친 작품 + 지운 작품
  const candidates = ctx.changedSince(st.pushedAt || '');
  const list = candidates.filter((w) => !serverAt.has(w.id) || (w.updatedAt || '') > serverAt.get(w.id));
  const tomb = ctx.takeTombstones();
  for (const w of list) for (const p of filePaths(w)) {
    if (uploaded.has(p)) continue;
    const f = await ctx.readFile(p);
    if (!f) continue;
    await call('/files?path=' + encodeURIComponent(p), { method: 'PUT', headers: { 'Content-Type': f.type || 'application/octet-stream' }, body: f.body });
    uploaded.add(p); files++;
  }
  // 후보 전체(이미 서버에 같은 게 있는 작품 포함)의 가장 늦은 시각까지 올린 것으로 봐요.
  let maxAt = candidates.reduce((m, w) => ((w.updatedAt || '') > m ? w.updatedAt : m), st.pushedAt || '');
  for (let i = 0; i < Math.max(list.length, tomb.length ? 1 : 0); i += 300) {
    const chunk = list.slice(i, i + 300);
    const body = { device: ctx.device, works: chunk, deleted: i === 0 ? tomb : [] };
    await call('/sync/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    pushed += chunk.length;
    for (const w of chunk) if ((w.updatedAt || '') > maxAt) maxAt = w.updatedAt;
  }
  if (tomb.length) ctx.doneTombstones(tomb);
  st.pushedAt = maxAt;
  st.uploaded = [...uploaded];
  st.lastSync = new Date().toISOString();
  await ctx.setState(st);
  return { pulled, changed, pushed, files, at: st.lastSync };
}

// 받은 작품을 내 기록에 합칠 때의 규칙 (양쪽 공통)
export function decide(local, item) {
  if (item.deleted) return local && (local.updatedAt || '') <= (item.at || '') ? 'delete' : 'keep';
  if (!local) return 'add';
  return (item.work.updatedAt || '') > (local.updatedAt || '') ? 'update' : 'keep';
}

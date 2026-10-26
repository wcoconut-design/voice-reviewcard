// VOICE BOX 폰 앱: 서버 없이 이 기기 안에서 데이터를 저장하고 처리합니다.
// 화면 코드(app.js)가 'api/...'로 요청하면 여기서 가로채서 IndexedDB(기기 안 저장소)로 답해요.
// 기록은 이 기기 안에만 있어요. 다른 기기로 옮길 때는 '복원용 백업(JSON)'을 쓰세요.
import { normalizeWork, guessWorkType } from './model.js';
import { toCsv, toXlsx, reviewsHtml } from './export-core.js';
import { syncOnce, decide } from './sync-core.js';

const BASE = new URL('./', import.meta.url);
const API = new URL('api/', BASE).pathname;
const IMAGES = new URL('images/', BASE).pathname;
const IMAGE_CACHE = 'vb-images';
const realFetch = window.fetch.bind(window);

/* ---------- 기기 안 저장소 ---------- */
const dbReady = new Promise((resolve, reject) => {
  const req = indexedDB.open('voicebox', 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    db.createObjectStore('kv');
    db.createObjectStore('history', { autoIncrement: true }).createIndex('id', 'id');
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const tx = async (store, mode, fn) => {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
};
const kvGet = (k) => tx('kv', 'readonly', (s) => s.get(k));
const kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));

let works = [];
let settings = { folders: [] };
const ready = (async () => {
  works = ((await kvGet('works')) || []).map(normalizeWork);
  settings = (await kvGet('settings')) || { folders: [] };
  // 한 번만: 이미 있는 작품의 동인/상업을 작품 코드·판매 링크로 채워요.
  if (!settings.workTypeFilled) {
    for (const w of works) if (!w.workType) w.workType = guessWorkType(w);
    settings.workTypeFilled = true;
    await kvSet('works', works); await kvSet('settings', settings);
  }
  // 브라우저가 저장소를 함부로 지우지 않게 요청 (홈 화면 앱이면 대부분 허용돼요)
  try { await navigator.storage?.persist?.(); } catch {}
})();
let saveTimer;
// 기기 저장소에 쓰기: 쓰는 중인 작업을 기억해 두고, 다른 화면으로 넘어가기 전에 끝날 때까지 기다려요.
let writing = Promise.resolve();
const writeNow = () => { writing = writing.then(() => kvSet('works', works)).catch(() => {}); return writing; };
const saveWorks = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = null; writeNow(); }, 250); };
const flushWorks = () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; writeNow(); } return writing; };
addEventListener('pagehide', () => { flushWorks(); });
const saveSettings = () => kvSet('settings', settings);
const addHistory = (id, reason, data) => tx('history', 'readwrite', (s) => s.add({ at: new Date().toISOString(), id, reason, data }));
const historyOf = async (id) => {
  const db = await dbReady;
  return new Promise((resolve) => {
    const out = [];
    const r = db.transaction('history').objectStore('history').index('id').openCursor(IDBKeyRange.only(id));
    r.onsuccess = () => { const c = r.result; if (c) { out.push(c.value); c.continue(); } else resolve(out.reverse()); };
    r.onerror = () => resolve(out);
  });
};
const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2));
export const hasData = async () => { await ready; return works.length > 0; };

/* ---------- 작품 ---------- */
const listItem = (w) => { const { promo, translation, ...rest } = w; return { ...rest, hasPromo: !!promo, hasTranslation: !!translation, pending: [] }; };
const fullItem = (w) => ({ ...w, sourceImages: w.images, pending: [] });
function folderList() {
  const set = new Set(settings.folders || []);
  for (const w of works) if (w.folder) set.add(w.folder);
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
}
function update(id, patch, reason = '수정') {
  const old = works.find((w) => w.id === id);
  if (!old) return null;
  const next = normalizeWork({ ...old, ...patch, id, notionPageId: old.notionPageId, updatedAt: new Date().toISOString() });
  const changed = Object.keys(next).filter((k) => k !== 'updatedAt' && !same(next[k], old[k]));
  if (!changed.length) return old;
  addHistory(id, reason, Object.fromEntries(changed.map((k) => [k, old[k]])));
  Object.assign(old, next);
  saveWorks();
  return old;
}
// 백업 합치기: 같은 작품은 최근에 고친 쪽을 남겨요.
function mergeWorks(incoming) {
  let added = 0, updated = 0, kept = 0;
  const byId = new Map(works.map((w) => [w.id, w]));
  for (const raw of incoming) {
    const w = normalizeWork(raw);
    const cur = byId.get(w.id);
    if (!cur) { works.unshift(w); added++; continue; }
    if ((w.updatedAt || '') > (cur.updatedAt || '')) { addHistory(w.id, '백업 합치기 전', { ...cur }); Object.assign(cur, w); updated++; } else kept++;
  }
  saveWorks();
  return { added, updated, kept };
}

/* ---------- 이미지 (직접 첨부한 것만 기기 안에 저장) ---------- */
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
async function saveUpload(workId, blob) {
  const type = blob.type || 'image/png';
  if (!EXT[type]) throw new Error('jpg, png, webp, gif 이미지만 첨부할 수 있어요.');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-1', await blob.arrayBuffer()))].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
  const rel = `images/${String(workId || 'new').replace(/[^A-Za-z0-9_-]/g, '') || 'new'}/${hash}.${EXT[type]}`;
  const cache = await caches.open(IMAGE_CACHE);
  await cache.put(new URL(rel, BASE).href, new Response(blob, { headers: { 'Content-Type': type } }));
  return rel;
}

/* ---------- 동기화 상자 (아이맥과 주고받기) ---------- */
// 정보 채우기 서버(같은 Cloudflare Worker)에 동기화 보관함을 붙여서 써요. 설정에서 켜고 꺼요.
const syncOn = () => { try { return !!JSON.parse(localStorage.getItem('voicebox.sync') || '{}').on; } catch { return false; } };
const sync = { running: false, error: '', last: null };
let syncTimer;
function syncSoon(ms = 5000) { if (!syncOn()) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => runSync().catch(() => {}), ms); }
function noteDeleted(id) { settings.tombstones = [...(settings.tombstones || []), { id, at: new Date().toISOString() }]; saveSettings(); }
async function syncStatus() { const st = (await kvGet('syncState')) || {}; return { ...sync, on: syncOn(), configured: !!relayConfig()?.url, lastSync: st.lastSync || null }; }
async function runSync(manual = false) {
  await ready;
  const cfg = relayConfig();
  if (!cfg?.url || !cfg?.key) throw new ApiError(msg('먼저 정보 채우기 서버를 연결해 주세요.', 'Connect the info server first.', '先に情報取得サーバーを接続してください。'));
  if (!manual && !syncOn()) return syncStatus();
  if (sync.promise) return sync.promise;
  sync.running = true;
  sync.promise = (async () => {
  try {
    const cache = await caches.open(IMAGE_CACHE);
    const r = await syncOnce({
      url: cfg.url, key: cfg.key, device: 'phone', fetch: realFetch,
      getState: async () => (await kvGet('syncState')) || {},
      setState: (st) => kvSet('syncState', st),
      applyIncoming: (items) => {
        let changed = 0;
        for (const it of items) {
          const i = works.findIndex((w) => w.id === it.id);
          const cur = i >= 0 ? works[i] : null;
          const what = decide(cur, it);
          if (what === 'keep') continue;
          if (what === 'delete') { addHistory(it.id, '아이맥에서 삭제', { ...cur }); works.splice(i, 1); changed++; continue; }
          const w = normalizeWork({ ...it.work, images: (it.work.images || []).map((p) => p.replace(/^\/images\//, 'images/')), reviewCard: (it.work.reviewCard || []).map((p) => p.replace(/^\/images\//, 'images/')) });
          if (what === 'add') { works.unshift(w); changed++; continue; }
          addHistory(w.id, '아이맥에서 동기화', { ...cur });
          Object.assign(cur, w, { notionPageId: cur.notionPageId || w.notionPageId });
          changed++;
        }
        if (changed) saveWorks();
        return changed;
      },
      changedSince: (at) => works.filter((w) => (w.updatedAt || '') > at),
      takeTombstones: () => [...(settings.tombstones || [])],
      doneTombstones: (list) => { const done = new Set(list.map((t) => t.id)); settings.tombstones = (settings.tombstones || []).filter((t) => !done.has(t.id)); saveSettings(); },
      hasFile: async (p) => !!(await cache.match(new URL(p, BASE).href)),
      readFile: async (p) => { const r = await cache.match(new URL(p, BASE).href); return r ? { body: await r.blob(), type: r.headers.get('Content-Type') } : null; },
      writeFile: (p, blob) => cache.put(new URL(p, BASE).href, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/png' } })),
    });
    sync.error = ''; sync.last = r;
    if (r.changed) { await new Promise((ok) => setTimeout(ok, 300)); window.dispatchEvent(new CustomEvent('vb:reload')); }
    return { ...r, ...(await syncStatus()) };
  } catch (e) {
    sync.error = e.message;
    throw e instanceof ApiError ? e : new ApiError(e.message, 502);
  } finally { sync.running = false; sync.promise = null; }
  })();
  return sync.promise;
}
ready.then(() => syncSoon(1500));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncSoon(800); });
window.addEventListener('online', () => syncSoon(800));

/* ---------- 요청 처리 ---------- */
class ApiError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const MOBILE_ONLY = '이 앱에서는 노션 연동을 지원하지 않아요. 기록은 복원용 백업(JSON)으로 옮겨 주세요.';

// 정보 채우기: 설정에 넣은 중계 서버(Cloudflare Worker)로 판매 페이지를 읽어 와요.
const lang = () => { try { return JSON.parse(localStorage.getItem('voicebox.view') || '{}').menuLang || 'ko'; } catch { return 'ko'; } };
const msg = (ko, en, ja) => ({ en, ja }[lang()] || ko);
export function relayConfig() { try { return JSON.parse(localStorage.getItem('voicebox.relay') || 'null'); } catch { return null; } }
async function relayInfo(body) {
  const cfg = relayConfig();
  const paste = msg('판매 페이지 글을 원문 칸에 붙여넣고 "원문에서 작품명·성우·발매일 찾기"를 눌러도 돼요.', 'You can also paste the store page text into the original tab and use "Find title, actors and date".', '販売ページの文章を原文欄に貼り付けて「原文から作品名・声優・発売日を探す」も使えます。');
  if (!cfg?.url || !cfg?.key) throw new ApiError(msg('설정 → 고급에서 정보 채우기 서버를 먼저 연결해 주세요. ', 'Connect the info server in Settings → Advanced first. ', '先に設定 → 詳細設定で情報取得サーバーを接続してください。') + paste);
  let r;
  try {
    r = await realFetch(cfg.url.replace(/\/+$/, '') + '/info', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VB-Key': cfg.key }, body: JSON.stringify({ url: body.url || '' }), signal: AbortSignal.timeout(25000) });
  } catch {
    throw new ApiError(msg('정보 채우기 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요. ', 'Could not reach the info server. Check your connection. ', '情報取得サーバーに接続できませんでした。インターネット接続を確認してください。') + paste, 502);
  }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new ApiError(msg('정보 채우기 서버의 열쇠가 맞지 않아요. 설정에서 확인해 주세요.', 'The info server key does not match. Check Settings.', '情報取得サーバーのキーが一致しません。設定を確認してください。'), 401);
  if (!r.ok) throw new ApiError((j.error || msg('정보를 가져오지 못했어요.', 'Could not fetch the info.', '情報を取得できませんでした。')) + ' ' + paste, 502);
  return j;
}

async function handle(method, path, url, body) {
  await ready;
  let m;
  if (method === 'GET' && path === 'works') return { works: works.map(listItem), folders: folderList(), notion: { connected: false, unsupported: true } };
  if (method === 'POST' && path === 'works') {
    const input = JSON.parse(body || '{}');
    if (!input.title && !input.titleKo) throw new ApiError('작품명을 입력해 주세요.');
    const now = new Date().toISOString();
    const w = normalizeWork({ ...input, id: uuid(), createdAt: now, updatedAt: now });
    if (!w.workType && !('workType' in input)) w.workType = guessWorkType(w);
    works.unshift(w);
    addHistory(w.id, '작품 추가', w);
    saveWorks();
    return fullItem(w);
  }
  if ((m = path.match(/^works\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1]);
    const w = works.find((x) => x.id === id);
    if (!w) throw new ApiError('작품을 찾지 못했어요.', 404);
    if (method === 'GET') return fullItem(w);
    if (method === 'PATCH') { const p = JSON.parse(body || '{}'); delete p.id; delete p.sourceImages; return fullItem(update(id, p)); }
    if (method === 'DELETE') { addHistory(id, '작품 삭제', { ...w }); works = works.filter((x) => x.id !== id); saveWorks(); noteDeleted(id); return { ok: true }; }
  }
  if ((m = path.match(/^works\/([^/]+)\/history$/))) return (await historyOf(decodeURIComponent(m[1]))).slice(0, 100);
  if ((m = path.match(/^works\/([^/]+)\/restore$/))) {
    const id = decodeURIComponent(m[1]);
    const { at } = JSON.parse(body || '{}');
    const h = (await historyOf(id)).find((x) => x.at === at);
    if (!h) throw new ApiError('이력을 찾지 못했어요.', 404);
    const keys = Object.keys(h.data).filter((k) => k in normalizeWork({}) && !['id', 'notionPageId', 'createdAt', 'updatedAt'].includes(k));
    return fullItem(update(id, Object.fromEntries(keys.map((k) => [k, h.data[k]])), '이력에서 되돌림'));
  }
  if (method === 'POST' && path === 'upload') return { src: await saveUpload(url.searchParams.get('work'), body) };
  if (method === 'GET' && path === 'sync/status') return syncStatus();
  if (method === 'POST' && path === 'sync/config') { const b = JSON.parse(body || '{}'); localStorage.setItem('voicebox.sync', JSON.stringify({ on: !!b.on })); return syncStatus(); }
  if (method === 'POST' && path === 'sync/run') return await runSync(true);
  if (method === 'POST' && path === 'info') return relayInfo(typeof body === 'string' ? JSON.parse(body || '{}') : body || {});
  if (method === 'POST' && path === 'folders') {
    const n = String(JSON.parse(body || '{}').name || '').trim();
    if (!n) throw new ApiError('폴더 이름을 입력해 주세요.');
    settings.folders = [...new Set([...(settings.folders || []), n])];
    await saveSettings();
    return { folders: folderList() };
  }
  if ((m = path.match(/^folders\/(.+)$/))) {
    const name = decodeURIComponent(m[1]);
    if (method === 'DELETE') { for (const w of works) if (w.folder === name) update(w.id, { folder: '' }, '폴더 삭제'); settings.folders = (settings.folders || []).filter((f) => f !== name); }
    if (method === 'PATCH') {
      const next = String(JSON.parse(body || '{}').name || '').trim();
      if (!next) throw new ApiError('폴더 이름을 입력해 주세요.');
      for (const w of works) if (w.folder === name) update(w.id, { folder: next }, '폴더 이름 변경');
      settings.folders = (settings.folders || []).map((f) => (f === name ? next : f));
    }
    await saveSettings();
    return { folders: folderList() };
  }
  if (path === 'notion/status') return { connected: false, unsupported: true };
  if (path.startsWith('notion/') || path.startsWith('notion-image/')) throw new ApiError(MOBILE_ONLY, 409);
  if (path === 'images/status') return { running: false, done: 0, total: 0, saved: 0, failed: 0, failures: [], cached: 0, unsupported: true };
  if (path === 'images/download') throw new ApiError('폰 버전은 표지를 판매 사이트에서 바로 불러와요.');
  if (path === 'image-proxy') {
    // 정보 채우기 서버가 연결돼 있으면 그 서버를 거쳐 표지를 받아요 (리뷰카드 표지 자동 넣기).
    const cfg = relayConfig();
    if (!cfg?.url) throw new ApiError(msg('설정 → 고급에서 정보 채우기 서버를 연결하면 표지가 자동으로 들어가요.', 'Connect the info server in Settings → Advanced to add covers automatically.', '設定 → 詳細設定で情報取得サーバーを接続すると表紙が自動で入ります。'), 404);
    const r = await realFetch(cfg.url.replace(/\/+$/, '') + '/image?key=' + encodeURIComponent(cfg.key) + '&src=' + encodeURIComponent(url.searchParams.get('src') || ''));
    if (!r.ok) throw new ApiError(msg('표지를 가져오지 못했어요.', 'Could not fetch the cover.', '表紙を取得できませんでした。'), 502);
    return { __raw: r };
  }
  if (method === 'POST' && path === 'restore') {
    const b = JSON.parse(body || '{}');
    if (b.format !== 'voicebox-local' || !Array.isArray(b.works)) throw new ApiError('VOICE BOX 백업 파일이 아니에요.');
    // 예전 백업(동인/상업 칸 없음)은 작품 코드·판매 링크로 채워요.
    for (const w of b.works) if (w && !('workType' in w)) w.workType = guessWorkType(w);
    if (b.merge) { const r = mergeWorks(b.works); return { ok: true, ...r }; }
    works = b.works.map(normalizeWork);
    if (b.settings?.folders) settings.folders = b.settings.folders;
    await kvSet('works', works);
    await saveSettings();
    return { ok: true, count: works.length };
  }
  throw new ApiError('요청을 찾지 못했어요.', 404);
}

window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith(API)) return realFetch(input, init);
  const path = url.pathname.slice(API.length);
  const method = (init.method || 'GET').toUpperCase();
  try {
    const out = await handle(method, path, url, init.body);
    if (method !== 'GET') await flushWorks();
    if (method !== 'GET' && /^(works|upload|restore|folders)/.test(path)) syncSoon();
    return out && out.__raw ? out.__raw : json(out);
  } catch (e) {
    return json({ error: e.message || '처리하지 못했어요.' }, e.status || 500);
  }
};

/* ---------- 내려받기 링크 (백업, 엑셀, CSV, 감상 모음) ---------- */
const day = () => new Date().toISOString().slice(0, 10);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function download(data, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
// 홈 화면 앱에서는 파일을 열면 앱 화면이 그 파일로 바뀌고 돌아올 길이 없어요.
// 그래서 공유 창(→ '파일에 저장')으로 넘기고, 공유가 안 되는 기기만 내려받기로 해요.
async function saveFile(data, name, type) {
  const file = typeof File === 'function' ? new File([data], name, { type }) : null;
  if (file && standalone() && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  download(data, name, type);
}
// 감상 모음: 앱 안에서 열고, 위쪽 '‹ 돌아가기'(또는 뒤로 가기)로 닫아요.
// 설정 창 위에 떠야 해서 창(dialog)으로 열어요. 뒤로 가기 처리는 화면 코드가 함께 해요.
function showDoc(html, name) {
  document.querySelector('.vb-doc')?.remove();
  const dlg = document.createElement('dialog');
  dlg.className = 'vb-doc';
  dlg.innerHTML = `<div class="vb-doc-bar"><button type="button" class="vb-doc-back" data-close>‹ ${msg('돌아가기', 'Back', '戻る')}</button><span class="vb-doc-t">${msg('감상 모음', 'Review collection', '感想まとめ')}</span><button type="button" class="vb-doc-share">${msg('공유·저장', 'Share / Save', '共有・保存')}</button></div><iframe class="vb-doc-frame" title="${msg('감상 모음', 'Review collection', '感想まとめ')}"></iframe>`;
  document.body.appendChild(dlg);
  dlg.querySelector('iframe').srcdoc = html;
  dlg.querySelector('.vb-doc-back').onclick = () => dlg.close();
  dlg.querySelector('.vb-doc-share').onclick = () => saveFile(html, name, 'text/html');
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}
document.addEventListener('click', async (e) => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  const url = new URL(a.getAttribute('href'), location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith(API)) return;
  e.preventDefault();
  const path = url.pathname.slice(API.length);
  await ready;
  if (path === 'backup') saveFile(JSON.stringify({ format: 'voicebox-local', version: 1, at: new Date().toISOString(), works, settings }, null, 1), `voicebox-backup-${day()}.json`, 'application/json');
  else if (path === 'export/works.csv') saveFile(toCsv(works), `voicebox-works-${day()}.csv`, 'text/csv');
  else if (path === 'export/works.xlsx') saveFile(toXlsx(works), `voicebox-works-${day()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  else if (path === 'export/reviews.html') {
    const html = reviewsHtml(works, (src) => new URL(src, BASE).href, { order: 'played' }).replace(/<a href="\?order=[^"]*">[^<]*<\/a>/g, '');
    showDoc(html, `voicebox-reviews-${day()}.html`);
  } else if (path.startsWith('works/') || /\.png$/.test(path)) {
    // 리뷰카드 내려받기 등은 그대로 둡니다.
  }
}, true);

export { IMAGES, IMAGE_CACHE };

// VOICE BOX 폰 앱: 서버 없이 이 기기 안에서 데이터를 저장하고 처리합니다.
// 화면 코드(app.js)가 'api/...'로 요청하면 여기서 가로채서 IndexedDB(기기 안 저장소)로 답해요.
// 기록은 이 기기 안에만 있어요. 다른 기기로 옮길 때는 '복원용 백업(JSON)'을 쓰세요.
import { normalizeWork } from './model.js';
import { toCsv, toXlsx, reviewsHtml } from './export-core.js';

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
  // 브라우저가 저장소를 함부로 지우지 않게 요청 (홈 화면 앱이면 대부분 허용돼요)
  try { await navigator.storage?.persist?.(); } catch {}
})();
let saveTimer;
const saveWorks = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => kvSet('works', works), 250); };
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
  if (!cfg?.url || !cfg?.key) throw new ApiError(msg('설정 → 정보 채우기 서버를 먼저 연결해 주세요. ', 'Connect the info server in Settings first. ', '先に設定で情報取得サーバーを接続してください。') + paste);
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
    if (method === 'DELETE') { addHistory(id, '작품 삭제', { ...w }); works = works.filter((x) => x.id !== id); saveWorks(); return { ok: true }; }
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
    if (!cfg?.url) throw new ApiError(msg('설정에서 정보 채우기 서버를 연결하면 표지가 자동으로 들어가요.', 'Connect the info server in Settings to add covers automatically.', '設定で情報取得サーバーを接続すると表紙が自動で入ります。'), 404);
    const r = await realFetch(cfg.url.replace(/\/+$/, '') + '/image?key=' + encodeURIComponent(cfg.key) + '&src=' + encodeURIComponent(url.searchParams.get('src') || ''));
    if (!r.ok) throw new ApiError(msg('표지를 가져오지 못했어요.', 'Could not fetch the cover.', '表紙を取得できませんでした。'), 502);
    return { __raw: r };
  }
  if (method === 'POST' && path === 'restore') {
    const b = JSON.parse(body || '{}');
    if (b.format !== 'voicebox-local' || !Array.isArray(b.works)) throw new ApiError('VOICE BOX 백업 파일이 아니에요.');
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
    return out && out.__raw ? out.__raw : json(out);
  } catch (e) {
    return json({ error: e.message || '처리하지 못했어요.' }, e.status || 500);
  }
};

/* ---------- 내려받기 링크 (백업, 엑셀, CSV, 감상 모음) ---------- */
const day = () => new Date().toISOString().slice(0, 10);
function download(data, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
document.addEventListener('click', async (e) => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  const url = new URL(a.getAttribute('href'), location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith(API)) return;
  e.preventDefault();
  const path = url.pathname.slice(API.length);
  // 감상 모음은 새 창을 먼저 열어둬야 막히지 않아요.
  const win = path === 'export/reviews.html' ? window.open('', '_blank') : null;
  await ready;
  if (path === 'backup') download(JSON.stringify({ format: 'voicebox-local', version: 1, at: new Date().toISOString(), works, settings }, null, 1), `voicebox-backup-${day()}.json`, 'application/json');
  else if (path === 'export/works.csv') download(toCsv(works), `voicebox-works-${day()}.csv`, 'text/csv');
  else if (path === 'export/works.xlsx') download(toXlsx(works), `voicebox-works-${day()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  else if (path === 'export/reviews.html') {
    const html = reviewsHtml(works, (src) => new URL(src, BASE).href, { order: 'played' }).replace(/<a href="\?order=[^"]*">[^<]*<\/a>/g, '');
    if (win) { win.document.open(); win.document.write(html); win.document.close(); }
    else download(html, `voicebox-reviews-${day()}.html`, 'text/html');
  } else if (path.startsWith('works/') || /\.png$/.test(path)) {
    // 리뷰카드 내려받기 등은 그대로 둡니다.
  }
}, true);

export { IMAGES, IMAGE_CACHE };

// VOICE BOX 로컬판 화면
// 구성: 상태 → 서버 요청 → 왼쪽 메뉴 → 목록 → 상세 → 편집 → 노션 반영 → 설정 → 기타
'use strict';

/* ================= 상태 ================= */
const S = {
  works: [],          // 목록용 작품 (긴 본문 제외)
  folders: [],
  notion: {},
  nav: 'all',         // all | played | unplayed | fav | reviewed | unreviewed | hidden | pending | folder:이름
  q: '', actor: '', circle: '', tag: '', rating: '', sort: 'updated',
  shown: 60,          // 화면에 그린 개수 (스크롤하면 늘어남)
  selected: null,     // 선택한 작품 id
  detail: null,       // 선택한 작품 전체 데이터
  introMode: 'translation',
  view: 'list',       // list | grid (표지 보기)
  showHidden: false,  // 숨긴 작품도 목록에 보기
  nameMode: 'both',   // 성우 이름: both | ja | ko
  menuLang: 'ko',     // 메뉴 이름: ko | en | ja
  theme: 'system',    // 화면 모드: system | light | dark
  palette: 'indigo',  // 색 테마: indigo | green | mono
  coverBlur: false,   // 표지 가리기(흐리게): 옆에서 보는 사람 방지
  searching: false,   // 폰 검색 화면
  detailWidth: 460,   // 상세 패널 폭 (칸막이로 조절)
  listMode: 'table',  // 목록 칸 폭에 따라: table(칸 나눔) | two(2줄) | compact
  solo: new URLSearchParams(location.search).get('work'), // 새 창으로 연 작품
};
// 보기 설정은 이 브라우저에 기억해 둡니다.
try {
  const p = JSON.parse(localStorage.getItem('voicebox.view') || '{}');
  if (p.view) S.view = p.view;
  S.showHidden = !!p.showHidden;
  if (['both', 'ja', 'ko'].includes(p.nameMode)) S.nameMode = p.nameMode;
  if (['en', 'ja'].includes(p.menuLang)) S.menuLang = p.menuLang;
  if (['light', 'dark'].includes(p.theme)) S.theme = p.theme;
  if (['green', 'mono'].includes(p.palette)) S.palette = p.palette;
  S.coverBlur = !!p.coverBlur;
  if (p.detailWidth > 300) S.detailWidth = p.detailWidth;
} catch {}
// 화면 글자 번역 (app/i18n.js). 메뉴 언어를 바꾸면 페이지를 다시 그려요.
const LANG_IDX = { en: 0, ja: 1 };
function L(ko, vars) {
  const row = (window.VB_I18N || {})[ko];
  let t = (row && LANG_IDX[S.menuLang] != null && row[LANG_IDX[S.menuLang]] != null) ? row[LANG_IDX[S.menuLang]] : ko;
  if (vars) t = t.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return t;
}
const LOCALE = () => ({ en: 'en-US', ja: 'ja-JP' }[S.menuLang] || 'ko-KR');
// index.html에 적힌 글자와 title·aria-label·placeholder를 번역해요.
function translateStatic(root = document.body) {
  if (S.menuLang === 'ko') return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const KO = /[가-힣]/;
  for (let n; (n = w.nextNode());) {
    const t = n.nodeValue.trim();
    if (!t || !KO.test(t) || n.parentElement.closest('[data-menu],[data-ui],script,style')) continue;
    n.nodeValue = n.nodeValue.replace(t, L(t));
  }
  for (const el of root.querySelectorAll('[title],[aria-label],[placeholder]')) {
    for (const a of ['title', 'aria-label', 'placeholder']) { const v = el.getAttribute(a); if (v && KO.test(v)) el.setAttribute(a, L(v)); }
  }
}
translateStatic();
const rememberView = () => { try { localStorage.setItem('voicebox.view', JSON.stringify({ view: S.view, showHidden: S.showHidden, nameMode: S.nameMode, menuLang: S.menuLang, theme: S.theme, palette: S.palette, coverBlur: S.coverBlur, detailWidth: S.detailWidth })); } catch {} };
const visible = (w) => S.showHidden || !w.hidden;
// 금액 표시: ¥1,650 / ₩12,000 / $9.99
const CUR_SIGN = { JPY: '¥', KRW: '₩', USD: '$' };
const money = (n, cur) => (n == null || n === '' ? '' : CUR_SIGN[cur || 'JPY'] + Number(n).toLocaleString('en-US', { maximumFractionDigits: cur === 'USD' ? 2 : 0 }));
const STORE_DEFAULTS = ['DLsite', '포케도라', '스텔라워스', '애니메이트'];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const isPhone = () => matchMedia('(max-width: 760px)').matches;
const isNarrow = () => matchMedia('(max-width: 900px)').matches; // 이 폭 이하에서는 상세가 목록 위를 덮어요
const displayTitle = (w) => w.titleKo || w.title || L('제목 미정');
const splitNames = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

/* ---------- 성우 이름: "六条銀 로쿠조 긴" → 일본어 / 한국어 ---------- */
function parseName(s) {
  const i = s.search(/[가-힣]/);
  if (i < 0) return { ja: s.trim(), ko: '' };
  if (i === 0) return { ja: '', ko: s.trim() };
  return { ja: s.slice(0, i).trim(), ko: s.slice(i).trim() };
}
// 글자로 (목록의 한 줄, 칩)
function nameText(s) {
  const { ja, ko } = parseName(s);
  if (S.nameMode === 'ja') return ja || ko;
  if (S.nameMode === 'ko') return ko || ja;
  return [ja, ko].filter(Boolean).join(' ');
}
// 일본어는 진하게, 한국어는 흐리게
function nameHtml(s) {
  const { ja, ko } = parseName(s);
  if (S.nameMode === 'ja') return `<span class="nm-ja">${esc(ja || ko)}</span>`;
  if (S.nameMode === 'ko') return `<span class="nm-ja">${esc(ko || ja)}</span>`;
  return (ja ? `<span class="nm-ja">${esc(ja)}</span>` : '') + (ko ? `<span class="nm-ko">${esc(ko)}</span>` : '');
}

/* ================= 서버 요청 ================= */
async function api(path, opts = {}) {
  const init = { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers: {} };
  if (opts.body !== undefined) {
    if (opts.raw) { init.body = opts.body; init.headers['Content-Type'] = opts.type; }
    else { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
  }
  const r = await fetch(path, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || L('요청을 처리하지 못했어요.'));
  return data;
}

let toastTimer;
function toast(msg, error = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), error ? 5000 : 2400);
}
const fail = (e) => toast(e.message || String(e), true);

// 새 창과 원래 창이 서로 바뀐 내용을 알려줍니다.
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('voicebox') : null;

async function load() {
  const d = await api('api/works');
  S.works = d.works;
  S.folders = d.folders;
  S.notion = d.notion;
  fillFilterOptions();
  renderNav();
  renderList();
  renderSync();
}
function replaceWork(full, { broadcast = true } = {}) {
  const { promo, translation, sourceImages, ...rest } = full;
  const item = { ...rest, hasPromo: !!promo, hasTranslation: !!translation };
  const i = S.works.findIndex((w) => w.id === full.id);
  if (i >= 0) S.works[i] = item; else S.works.unshift(item);
  if (S.selected === full.id) S.detail = full;
  if (broadcast && channel) channel.postMessage({ type: 'work', id: full.id });
}
if (channel) channel.onmessage = async (e) => {
  if (e.data?.type === 'filter' && !S.solo) {
    resetFilters();
    S[e.data.key] = e.data.v;
    fillFilterOptions();
    renderList();
    return;
  }
  if (e.data?.type !== 'work') return;
  try {
    const full = await api('api/works/' + encodeURIComponent(e.data.id));
    replaceWork(full, { broadcast: false });
    renderNav();
    refreshItem(full.id);
    // 감상을 쓰는 중이 아니면 상세도 새로 그립니다.
    if (S.selected === full.id && document.activeElement?.id !== 'reviewBox') renderDetail();
  } catch {}
};

/* ================= 왼쪽 메뉴 ================= */
// 숨긴 작품은 '숨긴 작품 보기'를 켰을 때만 각 목록에 섞여 나옵니다 (visible 참고).
const NAV = [
  ['all', '전체 작품', () => true],
  ['played', '들은 작품', (w) => w.status === '청취 완료' || w.status === '청취 중'],
  ['unplayed', '안 들은 작품', (w) => w.status !== '청취 완료' && w.status !== '청취 중'],
  ['fav', '즐겨찾기', (w) => w.favorite],
  ['reviewed', '감상 쓴 작품', (w) => !!w.review],
  ['unreviewed', '감상 안 쓴 작품', (w) => !w.review],
  ['hidden', '숨긴 작품', (w) => w.hidden],
];
// 메뉴 이름 영어 버전 (설정 → 보기 → 메뉴 이름)
const MENU_EN = {
  all: 'All Works', played: 'Listened', unplayed: 'Not Yet', fav: 'Favorites', reviewed: 'Reviewed',
  unreviewed: 'No Review', hidden: 'Hidden', stats: 'Voice Chart', pending: 'Pending Sync',
  'g-library': 'LIBRARY', 'g-notion': 'NOTION', 'g-folders': 'FOLDERS', 'new-folder': '+ New',
  settings: 'Settings', 'tab-list': 'List', 'tab-search': 'Search', 'tab-menu': 'Library', 'tab-settings': 'Settings',
  'pending-title': 'Pending Sync', 'stats-title': 'Voice Chart', 'add': '+ Add',
  'tab-home': 'Home', 'tab-stats': 'Chart',
};
const MENU_JA = {
  all: 'すべての作品', played: '聴いた作品', unplayed: '未聴の作品', fav: 'お気に入り', reviewed: '感想あり',
  unreviewed: '感想なし', hidden: '非表示', stats: 'ボイスチャート', pending: '反映待ち',
  'g-library': 'ライブラリ', 'g-notion': 'Notion', 'g-folders': 'フォルダ', 'new-folder': '+ 新規',
  settings: '設定', 'tab-list': 'リスト', 'tab-search': '検索', 'tab-menu': 'ライブラリ', 'tab-settings': '設定',
  'pending-title': 'Notion反映待ち', 'stats-title': 'ボイスチャート', 'add': '+ 作品を追加',
  'tab-home': 'ホーム', 'tab-stats': 'チャート',
};
const MENU_KO = {
  stats: '통계', pending: '반영 대기', 'g-library': '정리함', 'g-notion': '노션', 'g-folders': '내 폴더', 'new-folder': '+ 새 폴더',
  settings: '설정 · 노션 · 백업', 'tab-list': '목록', 'tab-search': '검색', 'tab-menu': '정리함', 'tab-settings': '설정',
  'pending-title': '노션 반영 대기', 'stats-title': '통계', 'add': '+ 작품 추가',
  'tab-home': '홈', 'tab-stats': '차트',
};
// 폰 앱(노션 연동 없음)은 설정 메뉴 이름에서 '노션'을 뺍니다.
if (window.VB_MOBILE) { MENU_KO.settings = '설정 · 백업'; MENU_EN.settings = 'Settings'; MENU_JA.settings = '設定'; }
const menuText = (key) => (S.menuLang === 'en' ? MENU_EN[key] : S.menuLang === 'ja' ? MENU_JA[key] : MENU_KO[key] ?? (NAV.find((n) => n[0] === key) || [])[1]) || key;
// 메뉴 언어를 따르는 화면 글자 (검색 화면, 칩, 설정의 보기 항목 등)
const UI = {
  ko: {
    cancel: '취소', recent: '최근 검색', clearRecent: '지우기', topActors: '자주 듣는 성우', topCircles: '자주 듣는 서클', topTags: '장르',
    searchPh: '작품명, 성우, 서클, 태그, 코드, 감상', searchPhPhone: '작품명이나 성우 검색',
    chipAll: '전체', chipPlayed: '들음', chipUnplayed: '안 들음', chipFav: '즐겨찾기', chipReviewed: '감상', chipHidden: '숨김', chipFolder: '폴더', chipPending: '반영 대기',
    folders: '폴더', noFolders: '아직 폴더가 없어요.', manageFolders: '+ 새 폴더',
    viewTitle: '보기', nameModeNote: '성우 이름 표시', nameBoth: '일본어 + 한국어', nameJa: '일본어만', nameKo: '한국어만',
    langNote: '메뉴 언어', paletteNote: '색 테마', palIndigo: '인디고', palGreen: '내추럴 그린', palMono: '모노',
    modeNote: '화면 모드', modeSystem: '시스템 설정 따르기', modeLight: '라이트', modeDark: '다크',
  },
  en: {
    cancel: 'Cancel', recent: 'Recent', clearRecent: 'Clear', topActors: 'Top voice actors', topCircles: 'Top circles', topTags: 'Genres',
    searchPh: 'Title, actor, circle, tag, code, review', searchPhPhone: 'Search titles or actors',
    chipAll: 'All', chipPlayed: 'Listened', chipUnplayed: 'Not yet', chipFav: 'Favorites', chipReviewed: 'Reviewed', chipHidden: 'Hidden', chipFolder: 'Folders', chipPending: 'Pending',
    folders: 'Folders', noFolders: 'No folders yet.', manageFolders: '+ New folder',
    viewTitle: 'Display', nameModeNote: 'Voice actor names', nameBoth: 'Japanese + Korean', nameJa: 'Japanese only', nameKo: 'Korean only',
    langNote: 'Menu language', paletteNote: 'Color theme', palIndigo: 'Indigo', palGreen: 'Natural green', palMono: 'Mono',
    modeNote: 'Appearance', modeSystem: 'Match system', modeLight: 'Light', modeDark: 'Dark',
  },
  ja: {
    cancel: 'キャンセル', recent: '最近の検索', clearRecent: '消去', topActors: 'よく聴く声優', topCircles: 'よく聴くサークル', topTags: 'ジャンル',
    searchPh: '作品名・声優・サークル・タグ・コード・感想', searchPhPhone: '作品名や声優で検索',
    chipAll: 'すべて', chipPlayed: '聴いた', chipUnplayed: '未聴', chipFav: 'お気に入り', chipReviewed: '感想あり', chipHidden: '非表示', chipFolder: 'フォルダ', chipPending: '反映待ち',
    folders: 'フォルダ', noFolders: 'フォルダはまだありません。', manageFolders: '+ 新規フォルダ',
    viewTitle: '表示', nameModeNote: '声優名の表示', nameBoth: '日本語 + 韓国語', nameJa: '日本語のみ', nameKo: '韓国語のみ',
    langNote: 'メニューの言語', paletteNote: 'カラーテーマ', palIndigo: 'インディゴ', palGreen: 'ナチュラルグリーン', palMono: 'モノ',
    modeNote: '画面モード', modeSystem: 'システム設定に合わせる', modeLight: 'ライト', modeDark: 'ダーク',
  },
};
const tr = (k) => (UI[S.menuLang] || UI.ko)[k] ?? UI.ko[k] ?? k;
function applyMenuLang() {
  document.querySelectorAll('[data-menu]').forEach((el) => { el.textContent = menuText(el.dataset.menu); });
  document.querySelectorAll('[data-ui]').forEach((el) => { el.textContent = tr(el.dataset.ui); });
  $('search').placeholder = isPhone() ? tr('searchPhPhone') : tr('searchPh');
  document.documentElement.classList.toggle('menu-en', S.menuLang === 'en');
  document.documentElement.lang = S.menuLang === 'ja' ? 'ja' : S.menuLang === 'en' ? 'en' : 'ko';
}
// 화면 모드: 시스템을 따르거나 라이트/다크로 고정
function applyTheme() {
  if (S.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = S.theme;
  if (S.palette === 'indigo') delete document.documentElement.dataset.palette;
  else document.documentElement.dataset.palette = S.palette;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
}
applyTheme();
const inView = (nav, w) => (nav === 'hidden' || nav === 'pending' || visible(w)) && navTest(nav)(w);
const pendingTest = (w) => w.pending && w.pending.length > 0;
function navTest(nav) {
  if (nav === 'pending') return pendingTest;
  if (nav.startsWith('folder:')) { const f = nav.slice(7); return (w) => w.folder === f; }
  return (NAV.find((n) => n[0] === nav) || NAV[0])[2];
}
function navLabel(nav) {
  if (nav === 'pending') return menuText('pending-title');
  if (nav.startsWith('folder:')) return nav.slice(7);
  return menuText((NAV.find((n) => n[0] === nav) || NAV[0])[0]);
}
function renderNav() {
  const item = (key, label, n, extra = '') =>
    `<button type="button" class="nav-item${S.nav === key ? ' on' : ''}" data-nav="${esc(key)}"><span>${esc(label)}</span>${extra || `<span class="n">${n.toLocaleString()}</span>`}</button>`;
  $('navMain').innerHTML = NAV.filter(([k]) => k !== 'hidden' || S.works.some((w) => w.hidden))
    .map(([k]) => item(k, menuText(k), S.works.filter((w) => inView(k, w)).length)).join('') +
    item('stats', menuText('stats'), 0, '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9v9z"></path><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"></path></svg>');
  const pending = S.works.filter(pendingTest).length;
  $('navNotion').innerHTML = item('pending', menuText('pending'), pending, pending ? `<span class="badge">${pending}</span>` : '<span class="n">0</span>');
  $('navFolders').innerHTML = S.folders.length
    ? S.folders.map((f) => item('folder:' + f, f, S.works.filter((w) => inView('folder:' + f, w)).length)).join('')
    : `<div class="nav-empty">${L("폴더로 작품을 묶어 보세요.")}</div>`;
  renderChips(pending);
  updateTabbar();
}
// 폰: 왼쪽 메뉴 대신 목록 위 가로 칩
function renderChips(pending) {
  const chip = (nav, label, extra = '') => `<button type="button" class="nchip${S.nav === nav ? ' on' : ''}" data-nav="${esc(nav)}">${label}${extra}</button>`;
  const inFolder = S.nav.startsWith('folder:');
  $('navChips').innerHTML = [
    chip('all', tr('chipAll')), chip('played', tr('chipPlayed')), chip('unplayed', tr('chipUnplayed')),
    chip('fav', '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg> ' + tr('chipFav')),
    chip('reviewed', tr('chipReviewed')),
    `<button type="button" class="nchip${inFolder ? ' on' : ''}" data-folder-sheet>${esc(inFolder ? S.nav.slice(7) : tr('chipFolder'))} <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>`,
    S.works.some((w) => w.hidden) ? chip('hidden', tr('chipHidden')) : '',
    pending && !window.VB_MOBILE ? chip('pending', tr('chipPending'), ` <span class="badge">${pending}</span>`) : '',
  ].join('');
  const on = $('navChips').querySelector('.on');
  // 고른 칩이 보이게 칩 줄 안에서만 옆으로 움직여요 (화면 전체가 옆으로 밀리지 않게).
  if (on && isPhone()) { const row = $('navChips'); const l = on.offsetLeft - 16, r = on.offsetLeft + on.offsetWidth + 16; if (l < row.scrollLeft) row.scrollLeft = l; else if (r > row.scrollLeft + row.clientWidth) row.scrollLeft = r - row.clientWidth; }
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-folder-sheet]')) return;
  const dlg = $('filterSheet');
  dlg.innerHTML = `<div class="m-body-wrap"><div class="m-head"><h2>${esc(tr('folders'))}</h2><button type="button" class="close" data-close aria-label="${L("닫기")}">×</button></div>
    <div class="m-body folder-sheet">${S.folders.length ? S.folders.map((f) => `<button type="button" class="nav-item${S.nav === 'folder:' + f ? ' on' : ''}" data-nav="folder:${esc(f)}" data-close><span>${esc(f)}</span><span class="n">${S.works.filter((w) => inView('folder:' + f, w)).length}</span></button>`).join('') : `<div class="note">${esc(tr('noFolders'))}</div>`}</div>
    <div class="m-foot"><button type="button" class="link-btn" id="sheetNewFolder">${esc(tr('manageFolders'))}</button></div></div>`;
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  $('sheetNewFolder').onclick = () => { dlg.close(); $('newFolder').click(); };
  dlg.showModal();
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-nav]');
  if (!b) return;
  S.nav = b.dataset.nav;
  S.shown = 60;
  renderNav();
  renderList();
  $('main').scrollTop = 0;
  closeSidebar();
});
$('homeLink').onclick = (e) => { e.preventDefault(); S.nav = 'all'; resetFilters(); };
$('newFolder').onclick = async () => {
  const name = await promptText(L('새 폴더'), L('폴더 이름'));
  if (!name) return;
  try { S.folders = (await api('api/folders', { body: { name } })).folders; renderNav(); toast(L('폴더를 만들었어요.')); } catch (e) { fail(e); }
};

function renderSync() {
  const n = S.notion || {};
  let text = L('노션 연결 안 됨');
  if (n.connected) {
    if (n.running) text = `${L("노션에서 가져오는 중 ·")} ${n.processed}${L("개 확인")}`;
    else if (n.error) text = L('노션 동기화 오류 · 설정에서 확인');
    else if (n.lastSync) text = L('노션 동기화 · ') + new Date(n.lastSync).toLocaleString(LOCALE(), { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    else text = L('노션 연결됨');
  }
  $('syncLine').textContent = text;
}

/* ================= 목록 ================= */
function fillFilterOptions() {
  const count = (getter) => {
    const m = new Map();
    for (const w of S.works) for (const v of getter(w)) m.set(v, (m.get(v) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  };
  const fill = (el, label, entries, current, show = (v) => v) => {
    el.innerHTML = `<option value="">${label} ${L("· 전체")}</option>` +
      entries.map(([v, n]) => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(show(v))} (${n})</option>`).join('');
  };
  fill($('fActor'), L('성우'), count((w) => splitNames(w.actor)), S.actor, nameText);
  fill($('fCircle'), L('서클'), count((w) => splitNames(w.circle)), S.circle);
  fill($('fTag'), L('장르'), count((w) => w.tags), S.tag);
}

function filtered() {
  const q = S.q.trim().toLowerCase();
  let list = S.works.filter((w) => inView(S.nav, w));
  if (q) {
    const terms = q.split(/\s+/);
    list = list.filter((w) => {
      const hay = [w.title, w.titleKo, w.actor, w.circle, w.tags.join(' '), w.code, w.review, w.folder, w.date, w.store].join(' ').toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  if (S.actor) list = list.filter((w) => splitNames(w.actor).includes(S.actor));
  if (S.circle) list = list.filter((w) => splitNames(w.circle).includes(S.circle));
  if (S.tag) list = list.filter((w) => w.tags.includes(S.tag));
  if (S.rating !== '') list = list.filter((w) => (S.rating === '0' ? !w.rating : w.rating >= Number(S.rating)));
  const by = {
    updated: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''),
    created: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
    date: (a, b) => (b.date || '').localeCompare(a.date || ''),
    dateOld: (a, b) => (a.date || '9999').localeCompare(b.date || '9999'),
    rating: (a, b) => b.rating - a.rating || (b.lastPlayed || '').localeCompare(a.lastPlayed || ''),
    played: (a, b) => (b.lastPlayed || '').localeCompare(a.lastPlayed || ''),
    title: (a, b) => displayTitle(a).localeCompare(displayTitle(b), 'ko'),
  }[S.sort];
  return list.sort(by);
}

function placeholderColor(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 84%)`;
}
function thumbHtml(w, cls = 'thumb') {
  const src = w.images?.[0];
  const ph = `<div class="${cls} ph" style="background:${placeholderColor(w.id)}">${esc(w.code || '')}</div>`;
  if (!src) return ph;
  return `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-ph="${esc(w.code || '')}" data-color="${placeholderColor(w.id)}">`;
}
// 이미지가 깨지면 색 블록으로 바꿉니다.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.dataset.color) return;
  const div = document.createElement('div');
  div.className = img.className + ' ph';
  div.style.background = img.dataset.color;
  div.textContent = img.dataset.ph || '';
  img.replaceWith(div);
}, true);

const rowAttrs = (w, cls) => `class="row ${cls}${S.selected === w.id ? ' on' : ''}${w.hidden ? ' is-hidden' : ''}" role="listitem" tabindex="0" data-id="${esc(w.id)}"`;
const marks = (w) => (w.hidden ? `<span class="tag-hidden">${L("숨김")}</span>` : '') + (pendingTest(w) ? `<span class="dot-pending" title="${L("노션 반영 대기")}"></span>` : '');
const starsHtml = (w) => (w.rating ? `<span class="stars-sm" aria-label="${L('별점')} ${w.rating}">${'★'.repeat(w.rating)}</span>` : `<span class="no-rating">${L("별점 없음")}</span>`);
function actorsBlock(w, max = 2) {
  const list = splitNames(w.actor);
  if (!list.length) return '<span class="muted-dash">—</span>';
  return list.slice(0, max).map((a) => `<div class="nm">${nameHtml(a)}</div>`).join('') + (list.length > max ? `<div class="nm-more">${L("외")} ${list.length - max}${L("명")}</div>` : '');
}

// 넓을 때: 칸 나눔 + 별점·상태 바로 고르기
const TABLE_HEAD = `<div class="thead" aria-hidden="true"><span></span><span>${L("작품")}</span><span>${L("성우")}</span><span>${L("서클")}</span><span>${L("발매일")}</span><span>${L("나의 기록")}</span><span></span></div>`;
function tableRowHtml(w) {
  const sub = w.titleKo && w.title ? w.title : '';
  return `<div ${rowAttrs(w, 'trow')}>
    ${thumbHtml(w)}
    <div class="cell-title"><div class="row-title">${esc(displayTitle(w))}</div>${sub ? `<div class="row-orig">${esc(sub)}</div>` : ''}<div class="row-marks">${marks(w)}${w.tags.slice(0, 3).map((t) => `<span class="mini-tag">${esc(t)}</span>`).join('')}</div></div>
    <div class="cell-actor">${actorsBlock(w)}</div>
    <div class="cell-circle">${esc(splitNames(w.circle).join(', ')) || '<span class="muted-dash">—</span>'}</div>
    <div class="cell-date">${esc(w.date) || '<span class="muted-dash">—</span>'}</div>
    <div class="quick">
      <select data-quick="rating" aria-label="${L("별점")}">${[L('별점 미기재'), '★', '★★', '★★★', '★★★★', '★★★★★'].map((l, n) => `<option value="${n}"${n === w.rating ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select data-quick="status" aria-label="${L("청취 상태")}">${[['', L('상태 미기재')], ['미청취', L('안 들음')], ['청취 중', L('듣는 중')], ['청취 완료', L('들음')]].map(([v, l]) => `<option value="${v}"${v === w.status ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <button type="button" class="heart-btn${w.favorite ? ' on' : ''}" data-quick="fav" aria-label="${L("즐겨찾기")}">${w.favorite ? '♥' : '♡'}</button>
  </div>`;
}
// 중간 폭: 제목 2줄 + 성우·서클
function twoRowHtml(w) {
  const actors = splitNames(w.actor);
  return `<div ${rowAttrs(w, 'two')}>
    ${thumbHtml(w)}
    <div class="row-main">
      <div class="row-title">${esc(displayTitle(w))}</div>
      <div class="meta">${actors.slice(0, 2).map((a) => `<span class="meta-actor">${nameHtml(a)}</span>`).join('')}${actors.length > 2 ? `<span class="nm-more">${L("외")} ${actors.length - 2}</span>` : ''}${w.circle ? `<span class="meta-circle">${esc(w.circle)}</span>` : ''}</div>
    </div>
    <div class="row-side2">${starsHtml(w)}<div class="side-sub">${marks(w)}${w.favorite ? '<span class="mini-heart">♥</span>' : ''}<span>${esc(w.date ? w.date.slice(2) : '')}</span></div></div>
  </div>`;
}
// 좁을 때: 간단한 한 줄
function compactRowHtml(w) {
  const sub = [splitNames(w.actor).map(nameText).join(', '), w.circle].filter(Boolean).join(' · ');
  return `<div ${rowAttrs(w, 'compact')}>
    ${thumbHtml(w)}
    <div class="row-main"><div class="row-title">${esc(displayTitle(w))}</div><div class="row-sub">${esc(sub)}</div></div>
    <div class="row-side">${marks(w)}${w.favorite ? '<span class="mini-heart">♥</span>' : ''}${starsHtml(w)}</div></div>`;
}
// 표지 보기 카드
function cardHtml(w) {
  const sub = [splitNames(w.actor).map(nameText).join(', '), w.circle].filter(Boolean).join(' · ');
  return `<div ${rowAttrs(w, 'card')}>
    <div class="card-cover">${thumbHtml(w)}${w.hidden ? `<span class="tag-hidden on-cover">${L("숨김")}</span>` : ''}${w.favorite ? '<span class="card-heart">♥</span>' : ''}</div>
    <div class="row-title">${esc(displayTitle(w))}</div>
    <div class="row-sub">${esc(sub)}</div>
    <div class="card-foot">${starsHtml(w)}${pendingTest(w) ? `<span class="dot-pending" title="${L("노션 반영 대기")}"></span>` : ''}</div>
  </div>`;
}
const itemHtml = (w) => (S.view === 'grid' ? cardHtml(w) : S.listMode === 'table' ? tableRowHtml(w) : S.listMode === 'two' ? twoRowHtml(w) : compactRowHtml(w));
function refreshItem(id) {
  const el = document.querySelector(`.row[data-id="${CSS.escape(id)}"]`);
  const w = S.works.find((x) => x.id === id);
  if (!el) return;
  if (!w || !inView(S.nav, w)) { el.remove(); $('viewCount').textContent = Math.max(0, Number($('viewCount').textContent.replace(/,/g, '')) - 1).toLocaleString(); return; }
  el.outerHTML = itemHtml(w);
}

let currentList = [];
function renderList() {
  const statsMode = S.nav === 'stats';
  $('stats').hidden = !statsMode;
  $('list').hidden = statsMode;
  $('listMore').hidden = statsMode;
  document.querySelector('.filters').hidden = statsMode;
  $('search').closest('.search-row').hidden = statsMode;
  $('navChips').hidden = statsMode;
  document.body.classList.toggle('has-q', !!S.q.trim());
  if (statsMode) { $('viewTitle').textContent = menuText('stats-title'); $('viewCount').textContent = ''; renderStats(); return; }
  currentList = filtered();
  $('viewTitle').textContent = navLabel(S.nav);
  $('viewCount').textContent = currentList.length.toLocaleString();
  const activeCount = [S.actor, S.circle, S.tag, S.rating].filter((v) => v !== '').length;
  const active = !!S.q || activeCount > 0;
  $('resetFilters').hidden = !active;
  $('filterBtn').textContent = activeCount ? `${L("필터")} ${activeCount}` : L('필터');
  $('filterBtn').classList.toggle('on', activeCount > 0);
  for (const [id, v] of [['fActor', S.actor], ['fCircle', S.circle], ['fTag', S.tag], ['fRating', S.rating]]) $(id).classList.toggle('on', v !== '');
  const list = $('list');
  list.className = 'list' + (S.view === 'grid' ? ' grid' : ' mode-' + S.listMode);
  if (!currentList.length) {
    list.innerHTML = '';
    $('listMore').innerHTML = active
      ? `<div class="empty"><strong>${L("찾는 작품이 없어요")}</strong>${L("검색어나 필터를 바꿔 보세요.")}</div>`
      : `<div class="empty"><strong>${L("아직 작품이 없어요")}</strong>${L("오른쪽 위 '작품 추가'로 시작해 보세요.")}</div>`;
    return;
  }
  list.innerHTML = (S.view !== 'grid' && S.listMode === 'table' ? TABLE_HEAD : '') + currentList.slice(0, S.shown).map(itemHtml).join('');
  $('listMore').textContent = currentList.length > S.shown ? L('아래로 내리면 더 보여요') : '';
}
// 스크롤 끝에 닿으면 더 그립니다.
new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting && currentList.length > S.shown) {
    const from = S.shown;
    S.shown += 80;
    $('list').insertAdjacentHTML('beforeend', currentList.slice(from, S.shown).map(itemHtml).join(''));
    $('listMore').textContent = currentList.length > S.shown ? L('아래로 내리면 더 보여요') : '';
  }
}, { root: $('main'), rootMargin: '600px' }).observe($('listMore'));

// 목록 칸의 폭이 바뀌면 줄 모양과 필터 모양을 바꿉니다. (창 크기, 칸막이 모두)
let resizeRender;
new ResizeObserver(() => {
  const w = $('main').clientWidth;
  const mode = w >= 880 ? 'table' : w >= 520 ? 'two' : 'compact';
  $('main').classList.toggle('compact-filters', w < 720);
  if (mode !== S.listMode) {
    S.listMode = mode;
    clearTimeout(resizeRender);
    resizeRender = setTimeout(renderList, 60);
  }
}).observe($('main'));

$('list').addEventListener('click', (e) => {
  if (e.target.closest('select')) return;
  const q = e.target.closest('[data-quick="fav"]');
  const r = e.target.closest('.row');
  if (!r) return;
  if (q) { const w = S.works.find((x) => x.id === r.dataset.id); if (w) save(w.id, { favorite: !w.favorite }); return; }
  select(r.dataset.id);
});
// 넓은 목록에서 별점·상태를 바로 고르기
$('list').addEventListener('change', (e) => {
  const sel = e.target.closest('select[data-quick]');
  const r = e.target.closest('.row');
  if (!sel || !r) return;
  const w = S.works.find((x) => x.id === r.dataset.id);
  if (!w) return;
  if (sel.dataset.quick === 'rating') save(w.id, { rating: Number(sel.value) });
  if (sel.dataset.quick === 'status') {
    const patch = { status: sel.value };
    if (sel.value === '청취 완료' && !w.lastPlayed) patch.lastPlayed = today();
    save(w.id, patch);
  }
});
$('list').addEventListener('keydown', (e) => {
  if (e.target.closest('select, button')) return;
  const r = e.target.closest('.row');
  if (!r) return;
  if (e.key === 'Enter') select(r.dataset.id);
  if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
    const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    let next = fwd ? r.nextElementSibling : r.previousElementSibling;
    if (S.view === 'grid' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const cols = getComputedStyle($('list')).gridTemplateColumns.split(' ').length;
      next = r;
      for (let i = 0; i < cols && next; i++) next = fwd ? next.nextElementSibling : next.previousElementSibling;
    }
    if (next?.dataset.id) { next.focus(); select(next.dataset.id); }
  }
});

let searchTimer;
$('search').addEventListener('input', (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { S.q = e.target.value; S.shown = 60; renderList(); }, 150); });
for (const [id, key] of [['fActor', 'actor'], ['fCircle', 'circle'], ['fTag', 'tag'], ['fRating', 'rating'], ['fSort', 'sort']]) {
  $(id).addEventListener('change', (e) => { S[key] = e.target.value; S.shown = 60; renderList(); });
}
function resetFilters() {
  Object.assign(S, { q: '', actor: '', circle: '', tag: '', rating: '', shown: 60 });
  $('search').value = '';
  fillFilterOptions();
  $('fRating').value = '';
  renderNav();
  renderList();
}
$('resetFilters').onclick = resetFilters;

// 좁은 창: 필터를 버튼 하나로 접고, 누르면 필터 창에서 고릅니다.
const FILTER_IDS = ['fActor', 'fCircle', 'fTag', 'fRating'];
$('filterBtn').onclick = () => {
  const dlg = $('filterSheet');
  dlg.innerHTML = `<div class="m-body-wrap"><div class="m-head"><h2>${L("필터")}</h2><button type="button" class="close" data-close aria-label="${L("닫기")}">×</button></div>
    <div class="m-body filter-body"></div>
    <div class="m-foot"><button type="button" class="link-btn" id="sheetReset">${L("초기화")}</button><span class="spacer"></span><button type="button" class="primary-btn" data-close>${L("적용")}</button></div></div>`;
  const body = dlg.querySelector('.filter-body');
  for (const id of FILTER_IDS) body.appendChild($(id));
  dlg.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dlg.close()));
  $('sheetReset').onclick = () => { resetFilters(); };
  dlg.onclose = () => { const anchor = $('filterBtn'); for (const id of FILTER_IDS) anchor.before($(id)); };
  dlg.showModal();
};

// 보기 형식(목록/표지)과 숨긴 작품 보기
function renderViewTools() {
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === S.view));
  $('toggleHidden').classList.toggle('on', S.showHidden);
  $('toggleHidden').setAttribute('aria-pressed', String(S.showHidden));
  $('toggleHidden').title = S.showHidden ? L('숨긴 작품을 목록에서 빼기') : L('숨긴 작품도 목록에 보기');
  document.documentElement.classList.toggle('cover-blur', S.coverBlur);
  $('toggleBlur').classList.toggle('on', S.coverBlur);
  $('toggleBlur').setAttribute('aria-pressed', String(S.coverBlur));
  $('toggleBlur').title = S.coverBlur ? L('표지 보이기') : L('표지 가리기');
}
// 표지 가리기: 목록·상세·리뷰카드의 표지를 흐리게. 누르면 크게 보기에서만 선명하게 보여요.
function setCoverBlur(on) {
  S.coverBlur = on;
  rememberView(); renderViewTools();
  const b = document.querySelector('[data-cover-blur]');
  if (b) document.querySelectorAll('[data-cover-blur]').forEach((x) => x.classList.toggle('on', (x.dataset.coverBlur === 'on') === on));
}
$('toggleBlur').onclick = () => { setCoverBlur(!S.coverBlur); toast(S.coverBlur ? L('표지를 흐리게 가렸어요.') : L('표지를 다시 보여요.')); };
document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => { S.view = b.dataset.view; rememberView(); renderViewTools(); renderList(); }));
$('toggleHidden').onclick = () => {
  S.showHidden = !S.showHidden;
  rememberView(); renderViewTools(); renderNav(); renderList();
  toast(S.showHidden ? L('숨긴 작품도 목록에 보여요.') : L('숨긴 작품은 목록에서 빠져요.'));
};
renderViewTools();
applyMenuLang();

/* ================= 상세 ================= */
// 고른 작품이 있을 때만 상세 패널을 엽니다.
async function select(id, { push = true } = {}) {
  S.selected = id;
  document.querySelectorAll('.row.on').forEach((r) => r.classList.remove('on'));
  document.querySelector(`.row[data-id="${CSS.escape(id)}"]`)?.classList.add('on');
  const quick = S.works.find((w) => w.id === id);
  if (quick && (!S.detail || S.detail.id !== id)) S.detail = { ...quick, promo: null, translation: null, sourceImages: quick.images };
  openDetailPanel(push);
  renderDetail();
  try {
    const full = await api('api/works/' + encodeURIComponent(id));
    if (S.selected !== id) return;
    S.detail = full;
    renderDetail();
  } catch (e) { fail(e); }
}
function layoutPanel() {
  const open = !$('detail').hidden;
  $('splitter').hidden = !open || isNarrow() || !!S.solo;
  $('scrim').hidden = !open || !isNarrow() || isPhone() || !!S.solo;
}
function openDetailPanel(push) {
  const d = $('detail');
  const wasHidden = d.hidden;
  d.hidden = false;
  if (isNarrow() && wasHidden && push && !S.solo) history.pushState({ detail: true }, '');
  if (wasHidden) d.scrollTop = 0;
  layoutPanel();
}
function closeDetail() {
  if (S.solo) { window.close(); return; }
  $('detail').hidden = true;
  S.selected = null;
  S.detail = null;
  document.querySelectorAll('.row.on').forEach((r) => r.classList.remove('on'));
  layoutPanel();
}
window.addEventListener('popstate', () => { if (!$('detail').hidden && isNarrow()) closeDetail(); });
// 닫기 / '‹ 목록': 상세를 열 때 기록을 남겼으면 뒤로 가기, 아니면 바로 닫기
function backToList() {
  if (history.state?.detail) history.back();
  else closeDetail();
}
$('scrim').onclick = () => { if (!$('detail').hidden && isNarrow()) backToList(); closeSidebar(); };

// 창 크기를 바꾸는 동안에는 미끄러지는 애니메이션을 끕니다.
let resizingTimer;
window.addEventListener('resize', () => {
  document.body.classList.add('resizing');
  clearTimeout(resizingTimer);
  resizingTimer = setTimeout(() => document.body.classList.remove('resizing'), 200);
  if (!isPhone()) $('sidebar').classList.remove('open');
  applyDetailWidth();
  layoutPanel();
});

// 칸막이: 끌어서 상세 폭 조절, 두 번 누르면 기본 폭
function applyDetailWidth() {
  const sidebar = $('sidebar').offsetWidth || 0;
  const max = Math.max(340, window.innerWidth - sidebar - 420);
  const w = Math.min(Math.max(S.detailWidth, 340), max);
  document.documentElement.style.setProperty('--detail-w', w + 'px');
}
(() => {
  const sp = $('splitter');
  let dragging = false;
  sp.addEventListener('pointerdown', (e) => { dragging = true; sp.setPointerCapture(e.pointerId); document.body.classList.add('dragging'); });
  sp.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    S.detailWidth = Math.round(window.innerWidth - e.clientX);
    applyDetailWidth();
  });
  const end = () => { if (!dragging) return; dragging = false; document.body.classList.remove('dragging'); rememberView(); };
  sp.addEventListener('pointerup', end);
  sp.addEventListener('pointercancel', end);
  sp.addEventListener('dblclick', () => { S.detailWidth = 460; applyDetailWidth(); rememberView(); });
  sp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { S.detailWidth += e.key === 'ArrowLeft' ? 30 : -30; applyDetailWidth(); rememberView(); }
  });
})();
applyDetailWidth();

function renderDetail() {
  const d = $('detail');
  const w = S.detail;
  if (!w) { d.innerHTML = ''; return; }
  const actors = splitNames(w.actor);
  const loading = w.promo === null;
  const status = w.status;
  const pending = (w.pending || []).filter((k) => k !== 'unknown');
  const pendingLabel = { title: L('원제'), titleKo: L('한국어 제목'), actor: L('성우'), circle: L('서클'), tags: L('장르'), date: L('발매일'), code: L('코드'), url: L('판매 링크'), review: L('감상'), status: L('청취 상태'), rating: L('별점'), lastPlayed: L('청취일'), favorite: L('즐겨찾기'), folder: L('폴더'), organize: L('정리 상태'), promo: L('홍보 원문'), translation: L('번역'), purchaseDate: L('구매일'), store: L('구매처'), listPrice: L('정가'), paidPrice: L('구매가'), currency: L('통화') };
  let notionHtml = '';
  if (!S.notion.connected) notionHtml = '';
  else if (!w.notionPageId) notionHtml = `<div class="notion-bar"><span>${L("노션에 아직 없는 작품이에요")}</span><button type="button" data-act="push">${L("노션에 추가")}</button></div>`;
  else if ((w.pending || []).includes('unknown')) notionHtml = `<div class="notion-bar"><span>${L("노션과 비교가 필요해요")}</span><button type="button" data-act="push">${L("비교하기")}</button></div>`;
  else if (pending.length) notionHtml = `<div class="notion-bar"><span>${L("노션과 다른 항목")} ${pending.length}${L("개 ·")} ${esc(pending.slice(0, 3).map((k) => pendingLabel[k]).join(', '))}${pending.length > 3 ? L(' 외') : ''}</span><button type="button" data-act="push">${L("골라서 반영")}</button></div>`;
  else notionHtml = `<div class="notion-ok">${L("노션과 같아요")}</div>`;

  const hasT = !!w.translation, hasP = !!w.promo;
  let mode = S.introMode;
  if (mode === 'translation' && !hasT && hasP) mode = 'promo';
  if (mode === 'promo' && !hasP && hasT) mode = 'translation';
  if (mode === 'side' && !(hasT && hasP)) mode = hasT ? 'translation' : 'promo';
  let introBody;
  if (loading) introBody = `<p class="muted">${L("불러오는 중…")}</p>`;
  else if (!hasT && !hasP) introBody = `<p class="muted">${L("소개글이 없어요. 정보 수정에서 판매 페이지 소개를 넣을 수 있어요.")}</p>`;
  else if (mode === 'side') introBody = `<div>${renderIntro(w.promo)}</div><div>${renderIntro(w.translation)}</div>`;
  else introBody = renderIntro(mode === 'promo' ? w.promo : w.translation);

  d.innerHTML = `<div class="d-wrap">
    <div class="d-top">
      <button type="button" class="ghost-btn d-back" data-act="close" aria-label="${S.solo ? L('창 닫기') : L('닫기')}"><span class="lbl-back">${S.solo ? L('✕ 창 닫기') : L('‹ 목록')}</span><span class="lbl-close">✕ ${S.solo ? L('창 닫기') : L('닫기')}</span></button>
      ${S.solo ? '' : `<button type="button" class="ghost-btn d-pop" data-act="popout" title="${L("이 작품을 새 창으로 열기")}">${L("↗ 새 창")}</button>`}
      <div class="right">
        <button type="button" class="icon-btn${w.favorite ? ' on' : ''}" data-act="fav" aria-label="${L("즐겨찾기")}" title="${L("즐겨찾기")}">${w.favorite ? '♥' : '♡'}</button>
        <button type="button" class="ghost-btn${w.hidden ? ' on-warn' : ''}" data-act="hide" title="${w.hidden ? L('다시 목록에 보이게') : L('기록은 남기고 목록에서만 숨겨요')}">${w.hidden ? L('숨김 해제') : L('숨기기')}</button>
        <button type="button" class="ghost-btn" data-act="edit">${L("정보 수정")}</button>
      </div>
    </div>
    <div class="d-hero">
      ${w.images?.[0] ? `<img class="d-cover" src="${esc(w.images[0])}" alt="${L("표지")}" referrerpolicy="no-referrer" data-act="zoom" data-i="0" data-ph="${esc(w.code)}" data-color="${placeholderColor(w.id)}">` : `<div class="d-cover ph" style="background:${placeholderColor(w.id)}">${esc(w.code)}</div>`}
      <div class="d-titles">
        <div class="d-meta-top">${esc([w.circle, w.date].filter(Boolean).join(' · '))}</div>
        <h2 class="d-title">${esc(displayTitle(w))}</h2>
        ${w.titleKo && w.title ? `<div class="d-orig">${esc(w.title)}</div>` : ''}
      </div>
    </div>
    <div class="chips">
      ${actors.map((a) => `<button type="button" class="chip chip-name" data-filter="actor" data-v="${esc(a)}" title="${L("이 성우 작품 보기")}">${nameHtml(a)}</button>`).join('')}
      ${splitNames(w.circle).map((c) => `<button type="button" class="chip" data-filter="circle" data-v="${esc(c)}" title="${L("이 서클 작품 보기")}">${esc(c)}</button>`).join('')}
      ${w.date ? `<span class="chip">${esc(w.date)}</span>` : ''}
      ${w.code ? `<span class="chip">${esc(w.code)}</span>` : ''}
      ${w.tags.map((t) => `<button type="button" class="chip tag" data-filter="tag" data-v="${esc(t)}">${esc(t)}</button>`).join('')}
      ${w.folder ? `<span class="chip">${L("폴더 ·")} ${esc(w.folder)}</span>` : ''}
    </div>
    <div class="records">
      <div class="rec">
        <div class="rec-label">${L("별점")}</div>
        <div class="stars" role="radiogroup" aria-label="${L("별점")}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="${n <= w.rating ? 'on' : ''}" data-star="${n}" aria-label="${n}${L("점")}">★</button>`).join('')}</div>
      </div>
      <div class="rec">
        <div class="rec-label">${L("청취")}</div>
        <div class="seg" role="radiogroup" aria-label="${L("청취 상태")}">
          <button type="button" data-status="미청취" class="${status === '미청취' ? 'on' : ''}">${L("안 들음")}</button>
          <button type="button" data-status="청취 중" class="${status === '청취 중' ? 'on' : ''}">${L("듣는 중")}</button>
          <button type="button" data-status="청취 완료" class="${status === '청취 완료' ? 'on' : ''}">${L("들음")}</button>
        </div>
        <label class="played-date">${L("청취일")} <input type="date" value="${esc(w.lastPlayed)}" data-act="played" aria-label="${L("마지막 청취일")}"></label>
      </div>
    </div>
    ${purchaseHtml(w)}
    <section class="review-card">
      <div class="sec-head"><h2>${L("내 감상")}</h2><span class="hint" id="reviewState">${L("눌러서 바로 쓰기")}</span></div>
      <textarea class="review-box" id="reviewBox" placeholder="${L("목소리, 이야기, 마음에 남은 장면…")}">${esc(w.review)}</textarea>
      <div class="card-row">
        ${(w.reviewCard || []).length
          ? `<button type="button" class="card-thumb" data-act="cardzoom" title="${L("대표 리뷰카드 크게 보기")}"><img src="${esc(w.reviewCard[0])}" alt="${L("대표 리뷰카드")}"></button>
             <div class="card-acts"><span class="hint">${L("대표 리뷰카드")}${w.reviewCard.length > 1 ? ` · ${w.reviewCard.length}${L("장")}` : ''}</span>
             <div><button type="button" class="link-btn" data-act="card">${L("다시 만들기 ↗")}</button> · <a class="link-btn" href="${esc(w.reviewCard[0])}" download="reviewcard-${esc(w.code || w.id)}.png">${L("내려받기")}</a> · <button type="button" class="link-btn danger-link" data-act="carddel">${L("빼기")}</button></div></div>`
          : `<button type="button" class="ghost-btn card-make" data-act="card">${L("리뷰카드 만들기 ↗")}</button><span class="hint">${L("감상과 작품 정보가 카드에 자동으로 들어가요")}</span>`}
      </div>
    </section>
    <section>
      <div class="sec-head"><h2>${L("작품 소개")}</h2>
        ${hasT || hasP ? `<div class="tabs">${hasT ? `<button type="button" data-intro="translation" class="${mode === 'translation' ? 'on' : ''}">${L("번역")}</button>` : ''}${hasP ? `<button type="button" data-intro="promo" class="${mode === 'promo' ? 'on' : ''}">${L("원문")}</button>` : ''}${hasT && hasP ? `<button type="button" data-intro="side" class="${mode === 'side' ? 'on' : ''}">${L("나란히")}</button>` : ''}</div>` : ''}
      </div>
      <div class="intro${mode === 'side' ? ' side' : ''}" id="intro">${introBody}</div>
      <button type="button" class="link-btn more-btn" id="introMore" hidden>${L("더 보기")}</button>
    </section>
    ${w.images.length > 1 ? `<section><div class="sec-head"><h2>${L("이미지")} ${w.images.length}</h2></div><div class="gallery">${w.images.map((src, i) => `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-act="zoom" data-i="${i}">`).join('')}</div></section>` : ''}
    ${notionHtml}
    <div class="d-links">
      ${w.url ? `<a href="${esc(w.url)}" target="_blank" rel="noopener">${L("판매 페이지 ↗")}</a>` : ''}
      ${w.notionPageId ? `<a href="https://www.notion.so/${esc(w.notionPageId.replace(/-/g, ''))}" target="_blank" rel="noopener">${L("노션 원본 ↗")}</a>` : ''}
      <button type="button" data-act="history">${L("수정 이력")}</button>
      ${S.notion.connected && w.notionPageId && !pending.length ? `<button type="button" data-act="push">${L("노션과 비교")}</button>` : ''}
    </div>
  </div>`;
  const intro = $('intro');
  if (!loading && intro.scrollHeight > 300) { intro.classList.add('clamped'); $('introMore').hidden = false; }
  bindReview();
}

function purchaseHtml(w) {
  const paid = w.paidPrice ?? w.listPrice;
  if (!w.purchaseDate && !w.store && paid == null) return `<div class="buy-line empty"><button type="button" class="link-btn" data-act="edit">${L("+ 구매 정보 넣기")}</button></div>`;
  const off = w.listPrice && w.paidPrice != null && w.paidPrice < w.listPrice ? Math.round((1 - w.paidPrice / w.listPrice) * 100) : 0;
  return `<div class="buy-line"><span class="rec-label">${L("구매")}</span>
    ${w.purchaseDate ? `<span>${esc(w.purchaseDate)}</span>` : ''}
    ${w.store ? `<span class="chip">${esc(w.store)}</span>` : ''}
    ${paid != null ? `<strong>${esc(money(paid, w.currency))}</strong>` : ''}
    ${off ? `<span class="buy-off">${L("정가")} ${esc(money(w.listPrice, w.currency))} · ${off}${L("% 할인")}</span>` : ''}</div>`;
}

// 상세 화면 버튼들
$('detail').addEventListener('click', async (e) => {
  const t = e.target.closest('button, img, [data-act]');
  if (!t || !S.detail) return;
  const w = S.detail;
  if (t.dataset.star) {
    const n = Number(t.dataset.star);
    return save(w.id, { rating: n === w.rating ? 0 : n });
  }
  if (t.dataset.status !== undefined) {
    const next = t.dataset.status === w.status ? '' : t.dataset.status;
    const patch = { status: next };
    if (next === '청취 완료' && !w.lastPlayed) patch.lastPlayed = today();
    return save(w.id, patch);
  }
  if (t.dataset.intro) { S.introMode = t.dataset.intro; return renderDetail(); }
  if (t.dataset.filter && S.solo) {
    channel?.postMessage({ type: 'filter', key: t.dataset.filter, v: t.dataset.v });
    toast(L('원래 창의 목록을 이 조건으로 걸렀어요.'));
    return;
  }
  if (t.dataset.filter) {
    resetFilters();
    S[t.dataset.filter] = t.dataset.v;
    fillFilterOptions();
    renderList();
    if (isNarrow()) backToList();
    return;
  }
  if (t.id === 'introMore') { $('intro').classList.remove('clamped'); t.hidden = true; return; }
  switch (t.dataset.act) {
    case 'close': return backToList();
    case 'card': {
      // 감상을 쓰는 중이었다면 먼저 저장하고 엽니다.
      const box = $('reviewBox');
      if (box && box.value !== (w.review || '')) await save(w.id, { review: box.value });
      const cardUrl = (window.VB_CARD_URL || 'reviewcard') + '?work=' + encodeURIComponent(w.id);
      // 폰 앱은 같은 화면에서 넘어가고, 카드 화면의 '‹ 돌아가기'로 이 작품으로 돌아와요.
      if (window.VB_MOBILE) { location.href = cardUrl; return; }
      const win = window.open(cardUrl, 'voicebox-card-' + w.id);
      if (!win) toast(L('새 탭이 막혔어요. 주소창 오른쪽의 팝업 허용을 눌러 주세요.'), true);
      return;
    }
    case 'cardzoom': return openLightbox(w.reviewCard, 0);
    case 'carddel': {
      if (!confirm(L('대표 리뷰카드를 이 작품에서 뺄까요? (이미지 파일은 images 폴더에 남아요)'))) return;
      return save(w.id, { reviewCard: [] });
    }
    case 'popout': {
      const win = window.open('./?work=' + encodeURIComponent(w.id), 'voicebox-' + w.id, 'width=760,height=920');
      if (!win) return toast(L('새 창이 막혔어요. 브라우저 주소창 오른쪽의 팝업 허용을 눌러 주세요.'), true);
      if (!isNarrow()) closeDetail(); else backToList();
      return;
    }
    case 'fav': return save(w.id, { favorite: !w.favorite });
    case 'hide': {
      const hide = !w.hidden;
      await save(w.id, { hidden: hide });
      if (hide && !S.showHidden && S.nav !== 'hidden') {
        toast(L("목록에서 숨겼어요. 위의 '숨긴 작품' 버튼이나 왼쪽 '숨긴 작품'에서 다시 볼 수 있어요."));
      } else toast(hide ? L('숨겼어요.') : L('다시 목록에 보여요.'));
      return;
    }
    case 'edit': return openEditor(w);
    case 'push': return openPush(w.id);
    case 'history': return openHistory(w.id);
    case 'zoom': return openLightbox(w.images, Number(t.dataset.i || 0));
  }
});
$('detail').addEventListener('change', (e) => {
  if (e.target.dataset.act === 'played' && S.detail) save(S.detail.id, { lastPlayed: e.target.value });
});

// 감상: 입력을 멈추면 자동 저장
let reviewTimer;
function bindReview() {
  const box = $('reviewBox');
  if (!box) return;
  const autosize = () => { box.style.height = 'auto'; box.style.height = Math.max(96, box.scrollHeight + 2) + 'px'; };
  autosize();
  const id = S.detail.id;
  const commit = async () => {
    clearTimeout(reviewTimer);
    if (!S.detail || S.detail.id !== id || box.value === (S.detail.review || '')) return;
    $('reviewState').textContent = L('저장 중…');
    try {
      const full = await api('api/works/' + encodeURIComponent(id), { method: 'PATCH', body: { review: box.value } });
      replaceWork(full);
      if (S.selected === id) S.detail.review = full.review;
      const st = $('reviewState'); if (st) st.textContent = L('저장됨');
      renderNav();
      refreshItem(id);
    } catch (e) { fail(e); }
  };
  box.addEventListener('input', () => { autosize(); $('reviewState').textContent = L('입력 중…'); clearTimeout(reviewTimer); reviewTimer = setTimeout(commit, 900); });
  box.addEventListener('blur', commit);
}

async function save(id, patch, { quiet = true } = {}) {
  try {
    const full = await api('api/works/' + encodeURIComponent(id), { method: 'PATCH', body: patch });
    replaceWork(full);
    renderNav();
    refreshItem(id);
    if (S.selected === id) {
      const keepReview = $('reviewBox')?.value;
      renderDetail();
      if (keepReview !== undefined && keepReview !== full.review && $('reviewBox')) $('reviewBox').value = keepReview;
    }
    if (!quiet) toast(L('저장했어요.'));
    return full;
  } catch (e) { fail(e); }
}

/* ================= 편집 ================= */
let ED = null; // 편집 중인 작품
function openEditor(work) {
  const isNew = !work;
  ED = isNew
    ? { title: '', titleKo: '', actor: '', circle: '', code: '', date: '', tags: [], url: '', images: [], promo: '', translation: '', folder: S.nav.startsWith('folder:') ? S.nav.slice(7) : '', hidden: false, organize: '' }
    : { ...work, images: [...(work.sourceImages || work.images)], tags: [...work.tags] };
  ED.isNew = isNew;
  ED.introTab = ED.translation || !ED.promo ? 'translation' : 'promo';
  const dlg = $('editor');
  dlg.innerHTML = `<form method="dialog" id="edForm" novalidate>
    <div class="m-head">
      <h2>${isNew ? L('작품 추가') : L('정보 수정')}</h2>
      <label class="ed-link"><span>${L("판매 링크")}</span><input id="edUrl" value="${esc(ED.url)}" placeholder="https://www.dlsite.com/…/RJ01234567.html"></label>
      <button type="button" class="soft-btn" id="edFetch">${L("정보 채우기")}</button>
      <button type="button" class="close" data-close aria-label="${L("닫기")}">×</button>
    </div>
    <div class="ed-cols">
      <div class="ed-col">
        <div id="edDup" class="dup" hidden></div>
        <div class="sec-label">${L("기본 정보")}</div>
        <label class="field">${L("한국어 제목 · 목록에 먼저 보여요")}<input id="edTitleKo" value="${esc(ED.titleKo)}" placeholder="${L("비워두면 원제로 보여요")}"></label>
        <label class="field">${L("원제")}<input id="edTitle" value="${esc(ED.title)}"></label>
        <div class="grid2">
          <label class="field">${L("성우 · 여러 명은 쉼표로")}<input id="edActor" value="${esc(ED.actor)}" list="actorList"></label>
          <label class="field">${L("서클")}<input id="edCircle" value="${esc(ED.circle)}" list="circleList"></label>
          <label class="field">${L("발매일")}<input id="edDate" type="date" value="${esc(ED.date)}"></label>
          <label class="field">${L("작품 코드")}<input id="edCode" value="${esc(ED.code)}" placeholder="RJ01234567"></label>
        </div>
        <div class="field">${L("장르")}<div class="tagbox" id="edTags"></div></div>
        <div class="grid2">
          <label class="field">${L("폴더")}<select id="edFolder"><option value="">${L("폴더 없음")}</option>${S.folders.map((f) => `<option${f === ED.folder ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></label>
          <label class="field">${L("정리 상태")}<input id="edOrganize" value="${esc(ED.organize)}" list="organizeList"></label>
        </div>
        <div class="sec-label" style="margin-top:6px">${L("구매 정보")}</div>
        <div class="grid2">
          <label class="field">${L("구매일")}<input id="edBuyDate" type="date" value="${esc(ED.purchaseDate || '')}"></label>
          <label class="field">${L("구매처")}<input id="edStore" value="${esc(ED.store || '')}" list="storeList" placeholder="${L("DLsite, 포케도라…")}"></label>
        </div>
        <div class="grid3">
          <label class="field">${L("정가")}<input id="edListPrice" inputmode="decimal" value="${ED.listPrice ?? ''}" placeholder="1650"></label>
          <label class="field">${L("구매가")}<input id="edPaidPrice" inputmode="decimal" value="${ED.paidPrice ?? ''}" placeholder="${L("할인가 · 비우면 정가")}"></label>
          <label class="field">${L("통화")}<select id="edCurrency">${[['JPY', L('¥ 엔')], ['KRW', L('₩ 원')], ['USD', L('$ 달러')]].map(([v, l]) => `<option value="${v}"${(ED.currency || 'JPY') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <div class="sec-label" style="margin-top:6px">${L("이미지 · 첫 번째가 표지")}</div>
        <div class="img-edit" id="edImages"></div>
        <div class="set-row"><input class="input" id="edImgUrl" placeholder="${L("이미지 주소 붙여넣기")}" style="flex:1;min-width:0"><button type="button" class="ghost-btn" id="edImgAdd">${L("추가")}</button></div>
        <input type="file" id="edFile" accept="image/*" multiple hidden>
      </div>
      <div class="ed-col ed-intro">
        <div class="sec-head"><div class="sec-label">${L("작품 소개")}</div>
          <div class="tabs"><button type="button" data-edtab="translation">${L("한국어 번역")}</button><button type="button" data-edtab="promo">${L("일본어 원문")}</button></div>
        </div>
        <label class="field" style="flex:1"><span id="edIntroLabel"></span><textarea id="edIntro"></textarea></label>
        <div class="ed-tools">
          <button type="button" class="link-btn" id="edExtract">${L("원문에서 작품명·성우·발매일 찾기")}</button>
          <button type="button" class="link-btn" id="edCopyReq">${L("ChatGPT 번역 요청 복사")}</button>
        </div>
        <div class="note">${L("**굵게**, ### 제목, * 목록, --- 구분선은 상세 화면에서 정리돼 보여요.")}</div>
      </div>
    </div>
    <div class="m-foot">
      <label class="check"><input type="checkbox" id="edHidden"${ED.hidden ? ' checked' : ''}>${L('목록에서 숨기기')}</label>
      ${S.notion.connected ? `<label class="check"><input type="checkbox" id="edPush">${L("저장하면서 노션에도 반영")}</label>` : ''}
      ${isNew ? '' : `<button type="button" class="danger-btn" id="edDelete">${L("삭제")}</button>`}
      <span class="spacer note">${L("별점과 감상은 상세 화면에서 바로 써요")}</span>
      <button type="submit" class="primary-btn" id="edSave">${L("저장")}</button>
    </div>
  </form>
  <datalist id="actorList">${[...new Set(S.works.flatMap((w) => splitNames(w.actor)))].slice(0, 2000).map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
  <datalist id="circleList">${[...new Set(S.works.flatMap((w) => splitNames(w.circle)))].map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
  <datalist id="storeList">${[...new Set([...STORE_DEFAULTS, ...S.works.map((w) => w.store).filter(Boolean)])].map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
  <datalist id="organizeList"><option value="정보 확인 중"><option value="정리함"><option value="정리 완료"></datalist>`;
  renderEdTags();
  renderEdImages();
  renderEdIntro();
  dlg.showModal();
  (isNew ? $('edUrl') : $('edTitleKo')).focus();
  bindEditor();
}
function readEdForm() {
  ED.url = $('edUrl').value.trim();
  ED.titleKo = $('edTitleKo').value.trim();
  ED.title = $('edTitle').value.trim();
  ED.actor = $('edActor').value.trim();
  ED.circle = $('edCircle').value.trim();
  ED.date = $('edDate').value;
  ED.code = $('edCode').value.trim();
  ED.folder = $('edFolder').value;
  ED.organize = $('edOrganize').value.trim();
  ED.hidden = $('edHidden').checked;
  ED.purchaseDate = $('edBuyDate').value;
  ED.store = $('edStore').value.trim();
  ED.listPrice = $('edListPrice').value.trim();
  ED.paidPrice = $('edPaidPrice').value.trim();
  ED.currency = $('edCurrency').value === 'JPY' ? '' : $('edCurrency').value; // 엔화는 비워 둬요(기본값)
  ED[ED.introTab] = $('edIntro').value;
}
function renderEdTags() {
  const box = $('edTags');
  box.innerHTML = ED.tags.map((t, i) => `<span class="t">${esc(t)}<button type="button" data-rmtag="${i}" aria-label="${esc(t)} ${L("빼기")}">×</button></span>`).join('') +
    `<input id="edTagInput" placeholder="${L("입력 후 Enter")}" list="tagList">` +
    `<datalist id="tagList">${[...new Set(S.works.flatMap((w) => w.tags))].map((t) => `<option value="${esc(t)}">`).join('')}</datalist>`;
}
function renderEdImages() {
  $('edImages').innerHTML = ED.images.map((src, i) => `<div class="it">
      <img src="${esc(/^(https?:|\/|images\/|api\/|blob:)/.test(src) ? src : '')}" alt="" referrerpolicy="no-referrer" data-color="var(--chip)">
      ${i === 0 ? `<span class="cover-badge">${L("표지")}</span>` : ''}
      <div class="acts">${i > 0 ? `<button type="button" data-cover="${i}" title="${L("표지로")}">↑</button>` : ''}<button type="button" data-rmimg="${i}" title="${L("빼기")}">×</button></div>
    </div>`).join('') + `<div class="drop" id="edDrop" tabindex="0">${L("파일 선택")}<br>${L("또는 끌어다 놓기")}</div>`;
}
function renderEdIntro() {
  document.querySelectorAll('[data-edtab]').forEach((b) => b.classList.toggle('on', b.dataset.edtab === ED.introTab));
  $('edIntro').value = ED[ED.introTab] || '';
  $('edIntroLabel').textContent = ED.introTab === 'promo' ? L('판매 페이지의 소개글을 그대로 붙여넣어요') : L('번역문 · 직접 고칠 수 있어요');
}
function checkDuplicate() {
  const code = $('edCode').value.trim().toUpperCase();
  const url = $('edUrl').value.trim();
  const dup = S.works.find((w) => w.id !== ED.id && ((code && w.code === code) || (url && w.url === url)));
  $('edDup').hidden = !dup;
  if (dup) $('edDup').innerHTML = `${L("이미 등록된 작품일 수 있어요:")} <strong>${esc(displayTitle(dup))}</strong>`;
}
function bindEditor() {
  const dlg = $('editor');
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  $('edCode').addEventListener('input', checkDuplicate);
  $('edUrl').addEventListener('change', () => {
    const m = $('edUrl').value.match(/(?:RJ|BJ|VJ)\d{6,}/i);
    if (m && !$('edCode').value) $('edCode').value = m[0].toUpperCase();
    checkDuplicate();
  });
  dlg.addEventListener('click', (e) => {
    const t = e.target.closest('button, .drop');
    if (!t) return;
    if (t.dataset.rmtag) { readEdForm(); ED.tags.splice(Number(t.dataset.rmtag), 1); renderEdTags(); }
    if (t.dataset.rmimg) { ED.images.splice(Number(t.dataset.rmimg), 1); renderEdImages(); }
    if (t.dataset.cover) { const [x] = ED.images.splice(Number(t.dataset.cover), 1); ED.images.unshift(x); renderEdImages(); }
    if (t.dataset.edtab) { ED[ED.introTab] = $('edIntro').value; ED.introTab = t.dataset.edtab; renderEdIntro(); }
    if (t.id === 'edDrop') $('edFile').click();
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.target.id === 'edTagInput' && (e.key === 'Enter' || e.key === ',')) {
      e.preventDefault();
      const v = e.target.value.trim().replace(/,$/, '');
      if (v && !ED.tags.includes(v)) ED.tags.push(v);
      renderEdTags();
      $('edTagInput').focus();
    }
    if (e.target.id === 'edTagInput' && e.key === 'Backspace' && !e.target.value && ED.tags.length) { ED.tags.pop(); renderEdTags(); $('edTagInput').focus(); }
  });
  dlg.addEventListener('focusout', (e) => {
    if (e.target.id === 'edTagInput' && e.target.value.trim()) { const v = e.target.value.trim(); if (!ED.tags.includes(v)) ED.tags.push(v); renderEdTags(); }
  });
  $('edImgAdd').onclick = () => { const v = $('edImgUrl').value.trim(); if (/^https?:\/\//.test(v)) { ED.images.push(v); $('edImgUrl').value = ''; renderEdImages(); } else toast(L('http로 시작하는 이미지 주소를 넣어 주세요.'), true); };
  $('edFile').onchange = (e) => uploadFiles([...e.target.files]);
  dlg.addEventListener('dragover', (e) => { if (e.target.closest('#edDrop')) { e.preventDefault(); $('edDrop').classList.add('over'); } });
  dlg.addEventListener('dragleave', (e) => { if (e.target.closest('#edDrop')) $('edDrop').classList.remove('over'); });
  dlg.addEventListener('drop', (e) => { if (e.target.closest('#edDrop')) { e.preventDefault(); uploadFiles([...e.dataTransfer.files]); } });
  dlg.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); uploadFiles(files); }
  });

  $('edFetch').onclick = async () => {
    const url = $('edUrl').value.trim();
    if (!url) return toast(L('판매 페이지 링크를 먼저 넣어 주세요.'), true);
    const btn = $('edFetch');
    btn.disabled = true; btn.textContent = L('가져오는 중…');
    try {
      const info = await api('api/info', { body: { url } });
      readEdForm();
      const filled = [];
      const fill = (key, el, value) => { if (value && !ED[key]) { ED[key] = value; if (el) $(el).value = value; filled.push(key); } };
      fill('title', 'edTitle', info.title);
      fill('actor', 'edActor', info.actor);
      fill('circle', 'edCircle', info.circle);
      fill('date', 'edDate', info.date);
      fill('code', 'edCode', info.code);
      fill('store', 'edStore', info.store);
      if (info.listPrice && !ED.listPrice) { ED.listPrice = info.listPrice; $('edListPrice').value = info.listPrice; filled.push('listPrice'); if (info.currency) $('edCurrency').value = info.currency; }
      if (info.promo && !ED.promo) { ED.promo = info.promo; filled.push('promo'); if (ED.introTab === 'promo') $('edIntro').value = info.promo; }
      for (const src of info.images || []) if (!ED.images.includes(src)) { ED.images.push(src); filled.push('image'); }
      renderEdImages();
      checkDuplicate();
      toast(filled.length ? `${filled.length}${L("개 항목을 채웠어요. 확인해 주세요.")}` : L('새로 채울 항목이 없어요. (이미 입력된 칸은 그대로 둬요)'));
    } catch (e) { fail(e); } finally { btn.disabled = false; btn.textContent = L('정보 채우기'); }
  };
  $('edExtract').onclick = () => {
    readEdForm();
    const info = extractInfo(ED.promo || $('edIntro').value);
    let n = 0;
    if (info.title && !ED.title) { $('edTitle').value = info.title; n++; }
    if (info.actor && !ED.actor) { $('edActor').value = info.actor; n++; }
    if (info.date && !ED.date) { $('edDate').value = info.date; n++; }
    toast(n ? `${n}${L("개 항목을 찾았어요.")}` : L('원문에서 새로 찾은 항목이 없어요.'));
  };
  $('edCopyReq').onclick = async () => {
    readEdForm();
    if (!ED.promo) return toast(L('일본어 원문을 먼저 넣어 주세요.'), true);
    const req = '아래 일본어 시추에이션 보이스 작품 소개를 자연스러운 한국어로 번역해 줘. 줄바꿈과 목록 구조는 유지하고, 인명은 한국어 발음 뒤에 괄호로 원문을 붙여 줘. 번역문만 답해 줘.\n\n' + ED.promo;
    try { await navigator.clipboard.writeText(req); toast(L('번역 요청을 복사했어요. ChatGPT에 붙여넣은 뒤 결과를 번역 탭에 넣어 주세요.')); }
    catch { toast(L('복사하지 못했어요.'), true); }
  };
  $('edDelete') && ($('edDelete').onclick = async () => {
    if (!confirm(L("'{t}'을(를) 로컬에서 삭제할까요? 노션 페이지는 그대로 남아요.", { t: displayTitle(ED) }))) return;
    try {
      await api('api/works/' + encodeURIComponent(ED.id), { method: 'DELETE' });
      S.works = S.works.filter((w) => w.id !== ED.id);
      dlg.close();
      closeDetail();
      renderNav(); renderList();
      toast(L('삭제했어요. 수정 이력에는 남아 있어요.'));
    } catch (e) { fail(e); }
  });
  $('edForm').onsubmit = async (e) => {
    e.preventDefault();
    readEdForm();
    if (!ED.title && !ED.titleKo) { $('edTitle').focus(); return toast(L('작품명을 입력해 주세요.'), true); }
    const body = { url: ED.url, titleKo: ED.titleKo, title: ED.title, actor: ED.actor, circle: ED.circle, date: ED.date, code: ED.code, tags: ED.tags, images: ED.images, promo: ED.promo, translation: ED.translation, folder: ED.folder, hidden: ED.hidden, organize: ED.organize, purchaseDate: ED.purchaseDate, store: ED.store, listPrice: ED.listPrice, paidPrice: ED.paidPrice, currency: ED.currency };
    const pushAfter = $('edPush')?.checked;
    $('edSave').disabled = true;
    try {
      const full = ED.isNew ? await api('api/works', { body }) : await api('api/works/' + encodeURIComponent(ED.id), { method: 'PATCH', body });
      replaceWork(full);
      dlg.close();
      fillFilterOptions();
      renderNav();
      renderList();
      await select(full.id, { push: !S.selected });
      toast(ED.isNew ? L('작품을 추가했어요.') : L('저장했어요.'));
      if (pushAfter) openPush(full.id);
    } catch (err) { fail(err); } finally { const b = $('edSave'); if (b) b.disabled = false; }
  };
}
async function uploadFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    try {
      const r = await api('api/upload?work=' + encodeURIComponent(ED.id || 'new'), { body: f, raw: true, type: f.type });
      ED.images.push(r.src);
      renderEdImages();
    } catch (e) { fail(e); }
  }
}
// 붙여넣은 판매 페이지 글에서 작품명·성우·발매일 찾기
function extractInfo(text) {
  const lines = String(text || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const find = (labels) => {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(new RegExp('^(?:' + labels + ')\\s*[:：]\\s*(.+)$', 'i'));
      if (m) return m[1];
      if (new RegExp('^(?:' + labels + ')\\s*[:：]?$', 'i').test(lines[i]) && lines[i + 1]) return lines[i + 1];
    }
    return '';
  };
  const title = find('作品名|タイトル|작품명');
  const actor = find('声優|出演|CV|ＣＶ|성우').replace(/\s*[/／、]\s*/g, ', ');
  const raw = find('販売日|発売日|配信日|발매일');
  const m = raw.match(/(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})/);
  return { title, actor, date: m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '' };
}
$('addWork').onclick = () => openEditor(null);

/* ================= 노션 반영 ================= */
let PUSH = null;
const fmt = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? L('예') : L('아니오')) : typeof v === 'number' ? (v ? '★'.repeat(v) : L('없음')) : v) || L('(비어 있음)');
async function openPush(id) {
  const dlg = $('pushDialog');
  if (!S.notion.connected) { toast(L('먼저 설정에서 노션을 연결해 주세요.'), true); return openSettings(); }
  dlg.innerHTML = `<div class="m-body-wrap"><div class="m-head"><h2>${L("노션에 반영")}</h2><button type="button" class="close" data-close aria-label="${L("닫기")}">×</button></div><div class="m-body"><p class="note">${L("노션의 현재 내용과 비교하고 있어요…")}</p></div></div>`;
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  if (!dlg.open) dlg.showModal();
  try {
    const pv = await api('api/notion/preview', { body: { id } });
    PUSH = { id, ...pv, pick: new Set(pv.changes.filter((c) => c.suggested && !c.conflict).map((c) => c.key)), pull: new Set() };
    renderPush();
  } catch (e) {
    dlg.querySelector('.m-body').innerHTML = `<div class="banner warn">${esc(e.message)}</div>`;
  }
}
// 긴 글은 처음 달라지는 곳부터 보여줍니다.
function diffPair(a, b) {
  a = String(fmt(a)); b = String(fmt(b));
  if (a.length < 140 && b.length < 140) return [esc(a), esc(b)];
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 30);
  const cut = (s) => (from ? '…' : '') + esc(s.slice(from, i)) + '<mark>' + esc(s.slice(i, i + 160)) + '</mark>' + (s.length > i + 160 ? '…' : '');
  return [cut(a), cut(b)];
}
function renderPush() {
  const dlg = $('pushDialog');
  const p = PUSH;
  const rows = p.changes.map((c) => { const [lv, nv] = diffPair(c.local, c.notion); return `<div class="push-row">
      <input type="checkbox" data-pick="${c.key}"${p.pick.has(c.key) ? ' checked' : ''} aria-label="${esc(c.label)} ${L("반영")}">
      <div>
        <div class="push-label">${esc(c.label)}
          ${c.conflict ? `<span class="pill warn">${L("노션에서도 바뀜")}</span>` : c.notionChanged ? `<span class="pill">${L("노션에서 바뀜")}</span>` : c.suggested ? `<span class="pill ok">${L("로컬에서 고침")}</span>` : ''}
        </div>
        <div class="push-vals"><div><small>${L("로컬 (이 컴퓨터)")}</small>${lv}</div><div><small>${L("노션 (지금)")}</small>${p.newPage ? L('(새 페이지)') : nv}</div></div>
        ${p.newPage ? '' : `<button type="button" class="pull-btn${p.pull.has(c.key) ? ' on' : ''}" data-pull="${c.key}">${p.pull.has(c.key) ? L('✓ 노션 값을 로컬로 가져와요') : L('대신 노션 값을 로컬로 가져오기')}</button>`}
      </div>
    </div>`; }).join('');
  const count = p.pick.size + p.pull.size;
  dlg.innerHTML = `<div class="m-body-wrap">
    <div class="m-head"><h2>${L("노션에 반영")}</h2><button type="button" class="close" data-close aria-label="${L("닫기")}">×</button></div>
    <div class="m-body">
      ${p.newPage ? `<div class="banner">${L("노션 CD LIST에 새 페이지를 만들어요. 넣을 항목을 골라 주세요.")}</div>` : ''}
      ${!p.changes.length ? `<div class="banner ok">${L("노션과 내용이 같아요. 반영할 것이 없어요.")}</div>` : ''}
      ${p.changes.some((c) => c.conflict) ? `<div class="banner warn">${L("노션에서도 바뀐 항목이 있어요. 어느 쪽을 남길지 확인해 주세요. (기본으로 선택하지 않았어요)")}</div>` : ''}
      <div>${rows}</div>
    </div>
    <div class="m-foot">
      ${p.notionUrl ? `<a class="note" href="${esc(p.notionUrl)}" target="_blank" rel="noopener">${L("노션에서 열기 ↗")}</a>` : ''}
      <span class="spacer"></span>
      <button type="button" class="ghost-btn" data-close>${L("취소")}</button>
      <button type="button" class="primary-btn" id="pushApply"${count ? '' : ' disabled'}>${p.pull.size && !p.pick.size ? L('로컬에 가져오기') : `${L("선택한")} ${count}${L("개 반영")}`}</button>
    </div></div>`;
  dlg.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dlg.close()));
  dlg.querySelectorAll('[data-pick]').forEach((el) => (el.onchange = () => { const k = el.dataset.pick; el.checked ? (p.pick.add(k), p.pull.delete(k)) : p.pick.delete(k); renderPush(); }));
  dlg.querySelectorAll('[data-pull]').forEach((el) => (el.onclick = () => { const k = el.dataset.pull; if (p.pull.has(k)) p.pull.delete(k); else { p.pull.add(k); p.pick.delete(k); } renderPush(); }));
  const btn = $('pushApply');
  if (btn) btn.onclick = async () => {
    btn.disabled = true; btn.textContent = L('반영 중…');
    try {
      const r = await api('api/notion/apply', { body: { token: p.token, keys: [...p.pick], pullKeys: [...p.pull] } });
      dlg.close();
      const full = await api('api/works/' + encodeURIComponent(p.id));
      replaceWork(full);
      renderNav();
      renderList();
      if (S.selected === p.id) renderDetail();
      toast([r.pushed?.length ? `${L("노션에")} ${r.pushed.length}${L("개 반영")}` : '', r.pulled?.length ? `${L("노션 값")} ${r.pulled.length}${L("개 가져옴")}` : '', r.skipped?.length ? `${L("노션에 없는 항목")} ${r.skipped.length}${L("개는 건너뜀")}` : ''].filter(Boolean).join(' · ') || L('완료했어요.'));
    } catch (e) {
      btn.disabled = false; btn.textContent = L('다시 시도');
      fail(e);
      if (/다시 비교/.test(e.message)) openPush(p.id);
    }
  };
}

/* ================= 설정 ================= */
let settingsTimer;
// 폰 앱: 판매 링크로 정보 채우기에 쓰는 중계 서버 주소와 열쇠 (이 기기에만 저장)
const getRelay = () => { try { return JSON.parse(localStorage.getItem('voicebox.relay') || 'null') || {}; } catch { return {}; } };
function relayBlockHtml() {
  const r = getRelay();
  return `<div class="set-block"><h3>${L('정보 채우기 서버')}</h3>
    <div class="note">${L('판매 링크로 작품 정보를 채울 때 쓰는 중계 서버(Cloudflare Worker)예요. 주소와 열쇠는 이 기기에만 저장돼요.')}</div>
    <input class="input" id="relayUrl" placeholder="https://vb-info.○○.workers.dev" value="${esc(r.url || '')}" autocomplete="off" autocapitalize="off" spellcheck="false">
    <input class="input" id="relayKey" type="password" placeholder="${L('비밀 열쇠 (VB_KEY)')}" value="${esc(r.key || '')}" autocomplete="off" style="margin-top:6px">
    <div class="set-row"><button type="button" class="ghost-btn" id="relaySave">${L('저장하고 연결 확인')}</button>${r.url ? `<button type="button" class="link-btn" id="relayClear">${L('연결 해제')}</button>` : ''}</div>
    <div class="note" id="relayState">${r.url ? L('연결돼 있어요.') : L('아직 연결하지 않았어요.')}</div></div>`;
}
// 폰 ↔ 아이맥 동기화 상자
function boxSyncText(st) {
  if (st.running) return L('동기화하는 중…');
  if (st.error) return L('동기화 오류: ') + st.error;
  if (st.lastSync) return L('마지막 동기화: ') + new Date(st.lastSync).toLocaleString(LOCALE());
  return L('아직 동기화한 적 없어요.');
}
function syncBlockHtml(st) {
  if (window.VB_MOBILE) {
    if (!st.configured) return '';
    return `<div class="set-block"><h3>${L('아이맥과 동기화')}</h3>
      <div class="note">${L('정보 채우기 서버의 동기화 보관함으로, 이 폰과 아이맥 VOICE BOX의 기록을 주고받아요. 같은 작품은 최근에 고친 쪽을 남겨요.')}</div>
      <label class="check"><input type="checkbox" id="syncOn"${st.on ? ' checked' : ''}>${L('자동으로 동기화')}</label>
      <div class="set-row"><button type="button" class="ghost-btn" id="syncNowBtn">${L('지금 동기화')}</button></div>
      <div class="note" id="syncState">${esc(boxSyncText(st))}</div></div>`;
  }
  return `<div class="set-block"><h3>${L('폰과 동기화')}</h3>
    <div class="note">${L('폰 앱과 같은 중계 서버(Cloudflare Worker) 주소와 열쇠를 넣으면, 3분마다 폰의 기록을 받아오고 이 컴퓨터에서 고친 것을 보내요.')}</div>
    <input class="input" id="syncUrl" placeholder="https://vb-info.○○.workers.dev" value="${esc(st.url || '')}" autocomplete="off" spellcheck="false">
    <input class="input" id="syncKey" type="password" placeholder="${L('비밀 열쇠 (VB_KEY)')}" autocomplete="off" style="margin-top:6px">
    <div class="set-row"><button type="button" class="ghost-btn" id="syncSave">${L('저장하고 동기화')}</button>${st.configured ? `<button type="button" class="ghost-btn" id="syncNowBtn">${L('지금 동기화')}</button><button type="button" class="link-btn" id="syncOff">${L('연결 해제')}</button>` : ''}</div>
    <div class="note" id="syncState">${st.configured ? esc(boxSyncText(st)) : L('아직 연결하지 않았어요.')}</div></div>`;
}
async function runSyncNow() {
  const el = $('syncState');
  if (el) el.textContent = L('동기화하는 중…');
  try {
    const r = await api('api/sync/run', { body: {} });
    if (el) el.textContent = '✓ ' + L('받은 작품 {a}개 · 바뀐 작품 {b}개 · 보낸 작품 {c}개', { a: r.pulled ?? 0, b: r.changed ?? 0, c: r.pushed ?? 0 });
    if (r.changed) await load();
  } catch (e) { if (el) el.textContent = L('동기화 오류: ') + e.message; }
}
async function testRelay() {
  const url = $('relayUrl').value.trim().replace(/\/+$/, '');
  const key = $('relayKey').value.trim();
  const st = $('relayState');
  if (!/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)[:/])/.test(url + '/') || !key) { st.textContent = L('https로 시작하는 주소와 열쇠를 모두 넣어 주세요.'); return; }
  st.textContent = L('확인 중…');
  try {
    const r = await fetch(url + '/info', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VB-Key': key }, body: '{}' });
    if (r.status === 401) { st.textContent = L('열쇠가 맞지 않아요. Cloudflare의 VB_KEY와 같은지 확인해 주세요.'); return; }
    const j = await r.json().catch(() => null);
    if (!j || (r.status !== 502 && r.status !== 200)) { st.textContent = L('응답이 이상해요. 주소를 확인해 주세요.') + (j?.error ? ' (' + j.error + ')' : ''); return; }
    try { localStorage.setItem('voicebox.relay', JSON.stringify({ url, key })); } catch {}
    st.textContent = '✓ ' + L('연결했어요. 이제 작품 추가에서 판매 링크를 넣고 정보 채우기를 누르면 돼요.');
  } catch { st.textContent = L('서버에 연결하지 못했어요. 주소를 확인해 주세요.'); }
}
// 폰 앱: 앱으로 실행 중인지, 인터넷 없이 열 준비가 됐는지
function offlineStatusHtml() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ready = !!navigator.serviceWorker?.controller;
  if (standalone && ready) return `<div class="vb-offline">✓ ${L('앱으로 실행 중 · 인터넷 없이도 열려요')}</div>`;
  if (!standalone) return `<div class="vb-offline no">${L('브라우저에서 열려 있어요. 홈 화면에 설치한 아이콘으로 열어야 인터넷 없이 열리고, 기록도 앱 안에 따로 저장돼요.')}</div>`;
  return `<div class="vb-offline no">${L('아직 오프라인 준비 중이에요. 인터넷이 연결된 상태에서 한 번 더 열어 주세요.')}</div>`;
}
async function openSettings() {
  const dlg = $('settings');
  const n = await api('api/notion/status').catch(() => S.notion);
  S.notion = n;
  const img = await api('api/images/status').catch(() => ({}));
  const total = S.works.reduce((a, w) => a + w.images.length, 0);
  const syncSt = await api('api/sync/status').catch(() => ({}));
  dlg.innerHTML = `<div class="m-body-wrap">
    <div class="m-head"><h2>${L("설정")}</h2><button type="button" class="close" data-close aria-label="${L("닫기")}">×</button></div>
    <div class="m-body">
      ${n.unsupported ? `<div class="set-block"><h3>${L("이 기기의 기록")}</h3>
        <div class="note">${L("모든 기록은 이 기기 안에 저장돼요. 아래 '아이맥과 동기화'를 켜면 내 Cloudflare 보관함을 거쳐 다른 기기와 주고받아요. 기기를 바꿀 때는 '복원용 백업 받기'로 파일을 받아 두고, 새 기기에서 '백업에서 복원'을 고르세요.")}</div>${offlineStatusHtml()}</div>${relayBlockHtml()}` : `<div class="set-block">
        <h3>${L("노션 연결")}</h3>
        ${n.connected ? `<div class="banner ok">${L("CD LIST에 연결돼 있어요.")}</div>
          <div class="note" id="syncState">${syncText(n)}</div>
          <div class="progress" id="syncBar" ${n.running ? '' : 'hidden'}><div style="width:${n.running ? 50 : 0}%"></div></div>
          <div class="set-row"><button type="button" class="ghost-btn" id="syncNow">${L("지금 노션에서 가져오기")}</button><button type="button" class="danger-btn" id="disconnect">${L("연결 해제")}</button></div>
          <div class="note">${L("가져오기는 로컬에서 고치지 않은 항목만 노션 값으로 바꿔요. 로컬에서 고친 항목은 '반영 대기'에 남고, 작품마다 골라서 노션에 반영해요.")}</div>`
        : `<div class="note">${L("노션 '내부 연결(integration)'의 키를 넣어 주세요. 키는 이 컴퓨터의 data/config.json에만 저장돼요.")}<br>
            ${L("키 만들기:")} <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noopener">notion.so/profile/integrations ↗</a> ${L("→ CD LIST와 성우·서클·태그 DB에 연결 허용(읽기·업데이트·삽입)")}</div>
          <div class="set-row"><input class="input" id="tokenInput" type="password" placeholder="${L("ntn_… 또는 secret_…")}" style="flex:1;min-width:0" autocomplete="off"><button type="button" class="primary-btn" id="connect">${L("연결")}</button></div>`}
      </div>`}
      ${syncBlockHtml(syncSt)}
      <div class="set-block"${img.unsupported ? ' hidden' : ''}>
        <h3>${L("이미지 내려받기")}</h3>
        <div class="note">${L("판매 사이트·노션에 있는 표지와 이미지를 이 컴퓨터의 images 폴더에 저장해요. 판매 페이지가 내려가도 계속 볼 수 있어요.")}</div>
        <div class="note" id="imgState">${imgText(img, total)}</div>
        <div class="progress" id="imgBar" ${img.running ? '' : 'hidden'}><div style="width:${img.total ? Math.round(img.done / img.total * 100) : 0}%"></div></div>
        <div class="set-row"><button type="button" class="ghost-btn" id="imgCovers">${L("표지만 받기")}</button><button type="button" class="ghost-btn" id="imgAll">${L("모든 이미지 받기")}</button></div>
      </div>
      <div class="set-block">
        <h3>${esc(tr('viewTitle'))}</h3>
        <div class="note">${esc(tr('langNote'))}${S.menuLang === 'en' ? '' : ' · Language'}</div>
        <div class="tabs" role="radiogroup" aria-label="Menu language">
          ${[['ko', '한국어'], ['en', 'English'], ['ja', '日本語']].map(([v, l]) => `<button type="button" data-menu-lang="${v}" class="${S.menuLang === v ? 'on' : ''}">${l}</button>`).join('')}
        </div>
        <div class="note" style="margin-top:6px">${esc(tr('paletteNote'))}</div>
        <div class="tabs palette-pick" role="radiogroup" aria-label="${esc(tr('paletteNote'))}">
          ${[['indigo', 'palIndigo', '#3443C4'], ['green', 'palGreen', '#2E5A4A'], ['mono', 'palMono', '#232323']].map(([v, k, c]) => `<button type="button" data-palette="${v}" class="${S.palette === v ? 'on' : ''}"><i class="pal-dot" style="background:${c}"></i>${esc(tr(k))}</button>`).join('')}
        </div>
        <div class="note" style="margin-top:6px">${L('표지 가리기')} · ${L('옆에서 보는 사람이 있을 때 표지를 흐리게 해요. 목록 위 버튼으로도 바로 켜고 꺼요.')}</div>
        <div class="tabs" role="radiogroup" aria-label="${L('표지 가리기')}">
          ${[['off', '끄기'], ['on', '켜기']].map(([v, l]) => `<button type="button" data-cover-blur="${v}" class="${(v === 'on') === S.coverBlur ? 'on' : ''}">${L(l)}</button>`).join('')}
        </div>
        <div class="note" style="margin-top:6px">${esc(tr('modeNote'))}</div>
        <div class="tabs" role="radiogroup" aria-label="${esc(tr('modeNote'))}">
          ${[['system', 'modeSystem'], ['light', 'modeLight'], ['dark', 'modeDark']].map(([v, k]) => `<button type="button" data-theme-mode="${v}" class="${S.theme === v ? 'on' : ''}">${esc(tr(k))}</button>`).join('')}
        </div>
        <div class="note" style="margin-top:6px">${esc(tr('nameModeNote'))}</div>
        <div class="tabs name-mode" role="radiogroup" aria-label="${esc(tr('nameModeNote'))}">
          ${[['both', 'nameBoth'], ['ja', 'nameJa'], ['ko', 'nameKo']].map(([v, k]) => `<button type="button" data-name-mode="${v}" class="${S.nameMode === v ? 'on' : ''}">${esc(tr(k))}</button>`).join('')}
        </div>
      </div>
      <div class="set-block">
        <h3>${L("보기 좋은 백업")}</h3>
        <div class="note">${L("보관하거나 다른 프로그램에서 보는 용도예요. 이 파일로는 앱을 되돌릴 수 없어요.")}</div>
        <div class="set-row">
          <a class="ghost-btn" href="api/export/works.xlsx" download>${L("엑셀 (.xlsx)")}</a>
          <a class="ghost-btn" href="api/export/works.csv" download>CSV</a>
          <a class="ghost-btn" href="api/export/reviews.html" target="_blank" rel="noopener">${L("감상 모음 문서 ↗")}</a>
        </div>
        <div class="note">${L("엑셀: 작품 목록 · 감상 · 통계 · 요약 시트 / 감상 모음 문서: 새 탭에서 열린 뒤 '인쇄 / PDF로 저장'")}</div>
      </div>
      <div class="set-block">
        <h3>${L("복원용 백업 (JSON)")}</h3>
        <div class="note">${window.VB_MOBILE ? L('앱을 그대로 되돌리거나 다른 기기로 옮길 때 쓰는 파일이에요. 폰 기록은 이 기기 안에만 있으니 가끔 받아 두세요.') : L('앱을 그대로 되돌릴 때 쓰는 파일이에요. 노션 연결키는 들어가지 않아요. 모든 데이터는 VOICE-BOX 폴더 안 data 폴더에도 있어서, 폴더째 복사해 두면 그것도 백업이 돼요.')}</div>
        <div class="set-row"><a class="ghost-btn" href="api/backup" download>${L("복원용 백업 받기")}</a><label class="ghost-btn">${L("백업에서 복원")}<input type="file" id="restoreFile" accept=".json,application/json" hidden></label></div>
      </div>
    </div></div>`;
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  if (!dlg.open) dlg.showModal();
  $('connect') && ($('connect').onclick = async () => {
    try { await api('api/notion/connect', { body: { token: $('tokenInput').value } }); toast(L('노션에 연결했어요. 바뀐 내용을 가져올게요.')); await api('api/notion/sync', { body: {} }); openSettings(); pollSync(); } catch (e) { fail(e); }
  });
  $('disconnect') && ($('disconnect').onclick = async () => {
    if (!confirm(L('노션 연결을 해제할까요? 로컬 데이터는 그대로 남아요.'))) return;
    await api('api/notion/disconnect', { body: {} }); S.notion.connected = false; openSettings(); renderSync(); renderDetail();
  });
  $('syncNow') && ($('syncNow').onclick = async () => { try { S.notion = await api('api/notion/sync', { body: {} }); pollSync(); } catch (e) { fail(e); } });
  dlg.querySelectorAll('[data-name-mode]').forEach((b) => (b.onclick = () => {
    S.nameMode = b.dataset.nameMode;
    rememberView();
    dlg.querySelectorAll('[data-name-mode]').forEach((x) => x.classList.toggle('on', x === b));
    fillFilterOptions(); renderList(); renderDetail();
  }));
  dlg.querySelectorAll('[data-theme-mode]').forEach((b) => (b.onclick = () => {
    S.theme = b.dataset.themeMode;
    rememberView();
    dlg.querySelectorAll('[data-theme-mode]').forEach((x) => x.classList.toggle('on', x === b));
    applyTheme();
  }));
  dlg.querySelectorAll('[data-menu-lang]').forEach((b) => (b.onclick = () => {
    S.menuLang = b.dataset.menuLang;
    rememberView();
    dlg.querySelectorAll('[data-menu-lang]').forEach((x) => x.classList.toggle('on', x === b));
    location.reload();
  }));
  dlg.querySelectorAll('[data-cover-blur]').forEach((b) => (b.onclick = () => setCoverBlur(b.dataset.coverBlur === 'on')));
  dlg.querySelectorAll('[data-palette]').forEach((b) => (b.onclick = () => {
    S.palette = b.dataset.palette;
    rememberView();
    dlg.querySelectorAll('[data-palette]').forEach((x) => x.classList.toggle('on', x === b));
    applyTheme();
  }));
  $('imgCovers').onclick = () => startImages(true);
  $('imgAll').onclick = () => startImages(false);
  $('relaySave') && ($('relaySave').onclick = testRelay);
  $('syncNowBtn') && ($('syncNowBtn').onclick = runSyncNow);
  $('syncOn') && ($('syncOn').onchange = async (e) => { await api('api/sync/config', { body: { on: e.target.checked } }).catch(fail); if (e.target.checked) runSyncNow(); });
  $('syncSave') && ($('syncSave').onclick = async () => {
    const url = $('syncUrl').value.trim(), key = $('syncKey').value.trim();
    if (!/^https:\/\//.test(url) || !key) { $('syncState').textContent = L('https로 시작하는 주소와 열쇠를 모두 넣어 주세요.'); return; }
    await api('api/sync/config', { body: { url, key } }).catch(fail);
    await runSyncNow(); openSettings();
  });
  $('syncOff') && ($('syncOff').onclick = async () => { await api('api/sync/config', { body: { url: '', key: '' } }).catch(fail); openSettings(); });
  $('relayClear') && ($('relayClear').onclick = () => { try { localStorage.removeItem('voicebox.relay'); } catch {} openSettings(); });
  $('restoreFile').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const count = data.works?.length ?? 0;
      let merge = confirm(L("백업의 작품 {n}개를 지금 기록과 합칠까요?\n\n[확인] 합치기 — 같은 작품은 최근에 고친 쪽을 남기고, 없는 작품은 추가해요. (다른 기기에서 고친 내용을 가져올 때)\n[취소] 다른 방법 고르기", { n: count }));
      if (!merge && !confirm(L("지금 기록을 백업 내용({n}개)으로 전부 바꿀까요?\n지금 기록은 따로 보관돼요.", { n: count }))) return;
      const r = await api('api/restore', { body: { ...data, merge } });
      toast(merge ? `${L("합쳤어요 · 새 작품")} ${r.added}${L("개, 바뀐 작품")} ${r.updated}${L("개")}` : L('복원했어요.'));
      dlg.close();
      load();
    } catch (err) { fail(err); }
  };
  if (n.running) pollSync();
  if (img.running) pollImages(total);
}
const syncText = (n) => n.running ? `${L("가져오는 중 ·")} ${n.processed}${L("개 확인 (새 작품")} ${n.added}${L(", 바뀐 작품")} ${n.updated})`
  : n.error ? L('오류: ') + n.error
    : n.lastSync ? `${L("마지막 가져오기:")} ${new Date(n.lastSync).toLocaleString(LOCALE())}${n.finishedAt && n.processed ? ` ${L("· 새 작품")} ${n.added}${L(", 바뀐 작품")} ${n.updated}` : ''}` : L('아직 가져온 적 없어요.');
const imgText = (s, total) => s.running ? `${L("받는 중 ·")} ${s.done}/${s.total} ${L("(실패")} ${s.failed})`
  : `${L("저장된 이미지")} ${s.cached ?? 0}${L("개 / 전체")} ${total}${L("개")}${s.total ? ` ${L("· 지난번:")} ${s.saved}${L("개 저장,")} ${s.failed}${L("개 실패")}` : ''}${s.failures?.length ? `<br>${L("실패 예:")} ${esc(s.failures[0].error)}` : ''}`;
async function pollSync() {
  clearTimeout(settingsTimer);
  try {
    const n = await api('api/notion/status');
    S.notion = n;
    renderSync();
    if ($('syncState')) { $('syncState').textContent = syncText(n); $('syncBar').hidden = !n.running; }
    if (n.running) settingsTimer = setTimeout(pollSync, 1500);
    else { if (n.error) toast(L('노션 가져오기 오류: ') + n.error, true); else if (n.added || n.updated) toast(`${L("노션에서 새 작품")} ${n.added}${L("개, 바뀐 작품")} ${n.updated}${L("개를 가져왔어요.")}`); load(); }
  } catch {}
}
async function startImages(coversOnly) {
  try { await api('api/images/download', { body: { coversOnly } }); pollImages(S.works.reduce((a, w) => a + w.images.length, 0)); } catch (e) { fail(e); }
}
let imgTimer;
async function pollImages(total) {
  clearTimeout(imgTimer);
  const s = await api('api/images/status').catch(() => null);
  if (!s) return;
  if ($('imgState')) { $('imgState').innerHTML = imgText(s, total); $('imgBar').hidden = !s.running; $('imgBar').firstElementChild.style.width = (s.total ? Math.round(s.done / s.total * 100) : 0) + '%'; }
  if (s.running) imgTimer = setTimeout(() => pollImages(total), 1200);
  else { toast(`${L("이미지")} ${s.saved}${L("개를 저장했어요.")}${s.failed ? ` ${s.failed}${L("개는 받지 못했어요.")}` : ''}`); load(); }
}
$('openSettings').onclick = () => openSettings();

/* ================= 수정 이력 ================= */
const FIELD_KO = { title: L('원제'), titleKo: L('한국어 제목'), actor: L('성우'), circle: L('서클'), tags: L('장르'), date: L('발매일'), code: L('코드'), url: L('판매 링크'), images: L('이미지'), status: L('청취 상태'), rating: L('별점'), lastPlayed: L('청취일'), favorite: L('즐겨찾기'), hidden: L('숨김'), folder: L('폴더'), organize: L('정리 상태'), review: L('감상'), promo: L('홍보 원문'), translation: L('번역'), purchaseDate: L('구매일'), store: L('구매처'), listPrice: L('정가'), paidPrice: L('구매가'), currency: L('통화') };
async function openHistory(id) {
  const dlg = $('historyDialog');
  const list = await api(`api/works/${encodeURIComponent(id)}/history`).catch((e) => (fail(e), []));
  const item = (h) => {
    const keys = Object.keys(h.data || {}).filter((k) => FIELD_KO[k]);
    const preview = keys.slice(0, 6).map((k) => `${FIELD_KO[k]}: ${esc(String(fmt(h.data[k])).slice(0, 40))}`).join(' · ');
    return `<div class="hist"><div class="hist-head"><span>${esc(h.reason)} · ${new Date(h.at).toLocaleString(LOCALE())}</span>${keys.length ? `<button type="button" class="link-btn" data-restore="${esc(h.at)}">${L("이 전 상태로 되돌리기")}</button>` : ''}</div><div class="hist-fields">${preview || L('변경 내용 없음')}</div></div>`;
  };
  dlg.innerHTML = `<div class="m-body-wrap"><div class="m-head"><h2>${L("수정 이력")}</h2><button type="button" class="close" data-close aria-label="${L("닫기")}">×</button></div>
    <div class="m-body"><div class="note">${L("각 기록에는 바뀌기 전 값이 남아 있어요. 되돌리면 그 값으로 다시 저장돼요.")}</div>${list.length ? list.map(item).join('') : `<div class="note">${L("아직 기록이 없어요.")}</div>`}</div></div>`;
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  dlg.querySelectorAll('[data-restore]').forEach((b) => (b.onclick = async () => {
    if (!confirm(L('이 기록의 값으로 되돌릴까요?'))) return;
    try { const full = await api(`api/works/${encodeURIComponent(id)}/restore`, { body: { at: b.dataset.restore } }); replaceWork(full); dlg.close(); renderNav(); renderList(); renderDetail(); toast(L('되돌렸어요.')); } catch (e) { fail(e); }
  }));
  dlg.showModal();
}

/* ================= 기타 ================= */
function openLightbox(list, i) {
  const dlg = $('lightbox');
  const show = () => {
    dlg.innerHTML = `<img src="${esc(list[i])}" alt="" referrerpolicy="no-referrer">${list.length > 1 ? `<div class="lb-nav"><button type="button" data-d="-1">${L("‹ 이전")}</button><button type="button" data-d="0">${L("닫기")}</button><button type="button" data-d="1">${L("다음 ›")}</button></div>` : ''}`;
  };
  show();
  dlg.onclick = (e) => {
    const d = e.target.dataset.d;
    if (d === undefined || d === '0') return dlg.close();
    i = (i + Number(d) + list.length) % list.length;
    show();
  };
  dlg.showModal();
}
function promptText(title, label, value = '') {
  return new Promise((resolve) => {
    const dlg = $('promptDialog');
    dlg.innerHTML = `<form method="dialog"><div class="m-head"><h2>${esc(title)}</h2></div><div class="m-body"><label class="field">${esc(label)}<input id="promptInput" value="${esc(value)}"></label></div>
      <div class="m-foot"><span class="spacer"></span><button type="button" class="ghost-btn" value="cancel" id="promptCancel">${L("취소")}</button><button class="primary-btn" value="ok">${L("확인")}</button></div></form>`;
    dlg.showModal();
    $('promptInput').focus();
    $('promptCancel').onclick = () => dlg.close('cancel');
    dlg.onclose = () => resolve(dlg.returnValue === 'ok' ? $('promptInput').value.trim() : '');
  });
}
// 폴더 이름 변경/삭제: 폴더를 길게 누르거나 우클릭
$('navFolders').addEventListener('contextmenu', async (e) => {
  const b = e.target.closest('[data-nav]');
  if (!b) return;
  e.preventDefault();
  const name = b.dataset.nav.slice(7);
  const next = await promptText(L('폴더 이름 바꾸기'), L('새 이름 (비우고 확인하면 폴더 삭제)'), name);
  try {
    if (next === name) return;
    if (!next) { if (!confirm(L("'{name}' 폴더를 삭제할까요? 작품은 지워지지 않아요.", { name }))) return; S.folders = (await api('api/folders/' + encodeURIComponent(name), { method: 'DELETE' })).folders; S.nav = 'all'; }
    else { S.folders = (await api('api/folders/' + encodeURIComponent(name), { method: 'PATCH', body: { name: next } })).folders; S.nav = 'folder:' + next; }
    await load();
  } catch (err) { fail(err); }
});

// 폰 하단 탭
function closeSidebar() { $('sidebar').classList.remove('open'); if ($('detail').hidden) $('scrim').hidden = true; }
function updateTabbar() {
  const cur = S.searching ? 'search' : S.nav === 'stats' ? 'stats' : 'list';
  document.querySelectorAll('#tabbar [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === cur));
}
$('tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const tab = b.dataset.tab;
  if (tab === 'search') { enterSearch(); return; }
  if (tab === 'add') { openEditor(null); return; }
  if (tab === 'settings') { openSettings(); return; }
  if (S.searching) exitSearch(false);
  if (tab === 'stats') { S.nav = 'stats'; S.shown = 60; renderNav(); renderList(); $('main').scrollTop = 0; }
  if (tab === 'list') {
    const home = S.nav === 'all' && !S.q && !S.actor && !S.circle && !S.tag && !S.rating;
    if (!home) { S.nav = 'all'; resetFilters(); }
    $('main').scrollTo({ top: 0, behavior: 'smooth' });
  }
});

// 폰 검색 화면: 최근 검색어, 자주 듣는 성우·서클, 장르를 보여주고 치는 대로 결과를 보여줘요.
const RECENT_KEY = 'voicebox.recent';
const getRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
function saveRecent(q) {
  q = (q || '').trim();
  if (!q) return;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...getRecent().filter((x) => x !== q)].slice(0, 8))); } catch {}
}
let navBeforeSearch = 'all';
function enterSearch() {
  if (!S.searching) {
    S.searching = true;
    navBeforeSearch = S.nav;
    if (S.nav !== 'all') { S.nav = 'all'; renderNav(); renderList(); }
    document.body.classList.add('searching');
  }
  renderSuggest();
  updateTabbar();
  $('search').focus();
}
function exitSearch(clear = true) {
  if (!S.searching) return;
  saveRecent(S.q);
  S.searching = false;
  document.body.classList.remove('searching');
  $('searchSuggest').hidden = true;
  if (clear) { S.q = ''; $('search').value = ''; S.nav = navBeforeSearch === 'stats' ? 'all' : navBeforeSearch; }
  S.shown = 60;
  renderNav(); renderList();
  $('search').blur();
}
function renderSuggest() {
  const top = (getter, n) => {
    const m = new Map();
    for (const w of S.works) for (const v of getter(w)) if (v) m.set(v, (m.get(v) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([v]) => v);
  };
  const recent = getRecent();
  const chips = (arr, show = (v) => v) => arr.map((v) => `<button type="button" class="nchip" data-suggest="${esc(v)}">${esc(show(v))}</button>`).join('');
  $('searchSuggest').innerHTML = (recent.length ? `<div class="sg-head"><span>${esc(tr('recent'))}</span><button type="button" class="link-btn" data-clear-recent>${esc(tr('clearRecent'))}</button></div>
      <div class="sg-recent">${recent.map((q) => `<button type="button" data-suggest="${esc(q)}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg><span>${esc(q)}</span></button>`).join('')}</div>` : '') +
    `<div class="sg-head"><span>${esc(tr('topActors'))}</span></div><div class="sg-chips">${chips(top((w) => splitNames(w.actor), 12), nameText)}</div>
     <div class="sg-head"><span>${esc(tr('topCircles'))}</span></div><div class="sg-chips">${chips(top((w) => splitNames(w.circle), 8))}</div>
     <div class="sg-head"><span>${esc(tr('topTags'))}</span></div><div class="sg-chips">${chips(top((w) => w.tags, 14))}</div>`;
  $('searchSuggest').hidden = !S.searching;
}
$('searchSuggest').addEventListener('click', (e) => {
  if (e.target.closest('[data-clear-recent]')) { try { localStorage.removeItem(RECENT_KEY); } catch {} renderSuggest(); return; }
  const b = e.target.closest('[data-suggest]');
  if (!b) return;
  S.q = b.dataset.suggest; $('search').value = S.q; S.shown = 60;
  saveRecent(S.q);
  renderList();
  $('search').blur();
});
$('searchCancel').onclick = () => exitSearch(true);
$('search').addEventListener('focus', () => { if (isPhone() && !S.searching && S.nav !== 'stats') enterSearch(); });
$('search').addEventListener('change', () => saveRecent($('search').value));
$('search').addEventListener('keydown', (e) => { if (e.key === 'Enter') { saveRecent($('search').value); $('search').blur(); } });
matchMedia('(max-width: 760px)').addEventListener('change', (m) => { if (!m.matches) exitSearch(false); applyMenuLang(); });

// 단축키: / 검색, n 새 작품, Esc 상세 닫기
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, dialog')) return;
  if (e.key === '/') { e.preventDefault(); $('search').focus(); }
  if (e.key === 'n') { e.preventDefault(); openEditor(null); }
  if (e.key === 'Escape' && isNarrow() && !$('detail').hidden) backToList();
});

// 다른 창에서 돌아오면 노션 상태를 새로 확인
document.addEventListener('visibilitychange', () => { if (!document.hidden) api('api/notion/status').then((n) => { S.notion = n; renderSync(); if (n.running) pollSync(); }).catch(() => {}); });

/* ================= 통계 ================= */
// 성우별 / 서클별 / 장르별 / 발매 연도 / 별점 / 청취 상태로 골라 봐요. 조각이나 이름을 누르면 그 작품 목록으로 가요.
const STAT_KINDS = [
  ['actor', L('성우별'), (w) => splitNames(w.actor)],
  ['circle', L('서클별'), (w) => splitNames(w.circle)],
  ['tag', L('장르별'), (w) => w.tags],
  ['year', L('발매 연도'), (w) => (w.date ? [w.date.slice(0, 4)] : [])],
  ['rating', L('별점'), (w) => [w.rating ? '★'.repeat(w.rating) : L('별점 없음')]],
  ['status', L('청취 상태'), (w) => [{ '미청취': L('안 들음'), '청취 중': L('듣는 중'), '청취 완료': L('들음') }[w.status] || L('상태 미기재')]],
  ['store', L('구매처별'), (w) => (w.store ? [w.store] : [])],
  ['spend', L('지출'), null],
];
const STAT_SCOPES = [
  ['all', L('전체 작품'), () => true],
  ['played', L('들은 작품'), (w) => w.status === '청취 완료' || w.status === '청취 중'],
  ['rated', L('별점 준 작품'), (w) => w.rating > 0],
  ['reviewed', L('감상 쓴 작품'), (w) => !!w.review],
];
const STAT_COLORS = ['#B48AD8', '#E2C26E', '#DE7A6B', '#86BE94', '#6FB3CF', '#D88CAA', '#7F9BE0', '#D49A5E', '#9AC7A8', '#C59BD8', '#E5A3B5', '#84C3C0'];
S.statKind = 'actor';
S.statScope = 'all';
S.statMore = false;
let statObserver = null;
try { const p = JSON.parse(localStorage.getItem('voicebox.stats') || '{}'); if (p.kind) S.statKind = p.kind; if (p.scope) S.statScope = p.scope; } catch {}

function statData() {
  const [, , getter] = STAT_KINDS.find((k) => k[0] === S.statKind);
  const scope = STAT_SCOPES.find((k) => k[0] === S.statScope)[2];
  const works = S.works.filter((w) => visible(w) && scope(w));
  const m = new Map();
  let none = 0;
  for (const w of works) {
    const keys = getter(w);
    if (!keys.length) none++;
    for (const k of keys) m.set(k, (m.get(k) || 0) + 1);
  }
  let rows = [...m].map(([key, n]) => ({ key, n }));
  if (S.statKind === 'year') rows.sort((a, b) => b.key.localeCompare(a.key));
  else if (S.statKind === 'rating') rows.sort((a, b) => b.key.length - a.key.length);
  else rows.sort((a, b) => b.n - a.n || a.key.localeCompare(b.key, 'ko'));
  return { works, rows, none };
}

function donutSvg(rows, total) {
  const R = 120, r = 92, C = 150;
  const TOP = 24;
  const shown = rows.slice(0, TOP);
  const rest = rows.slice(TOP).reduce((a, x) => a + x.n, 0);
  const parts = shown.map((x, i) => ({ ...x, color: STAT_COLORS[i % STAT_COLORS.length] }));
  if (rest) parts.push({ key: L('그 외'), n: rest, color: 'var(--line)', other: true });
  const sum = parts.reduce((a, x) => a + x.n, 0) || 1;
  let a0 = -Math.PI / 2;
  const gap = parts.length > 1 ? 0.012 : 0;
  const pt = (rad, ang) => [C + rad * Math.cos(ang), C + rad * Math.sin(ang)];
  const segs = parts.map((x, i) => {
    const sweep = (x.n / sum) * Math.PI * 2;
    const s = a0 + gap / 2, e = a0 + Math.max(sweep - gap / 2, gap / 2 + 0.001);
    a0 += sweep;
    const large = e - s > Math.PI ? 1 : 0;
    const [x1, y1] = pt(R, s), [x2, y2] = pt(R, e), [x3, y3] = pt(r, e), [x4, y4] = pt(r, s);
    const d = parts.length === 1
      ? `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R} L ${C - 0.01} ${C - r} A ${r} ${r} 0 1 0 ${C} ${C - r} Z`
      : `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${r} ${r} 0 ${large} 0 ${x4} ${y4} Z`;
    const label = S.statKind === 'actor' ? nameText(x.key) : x.key;
    return `<path d="${d}" fill="${x.color}" ${x.other ? '' : `data-stat-key="${esc(x.key)}"`} class="seg"><title>${esc(label)} · ${x.n}${L("개 (")}${(x.n / total * 100).toFixed(1)}%)</title></path>`;
  }).join('');
  return { svg: `<svg viewBox="0 0 300 300" class="donut" role="img" aria-label="${esc(STAT_KINDS.find((k) => k[0] === S.statKind)[1])} ${L("비율")}">${segs}
    <text x="150" y="146" text-anchor="middle" class="donut-num">${total.toLocaleString()}</text>
    <text x="150" y="172" text-anchor="middle" class="donut-label">${L("작품")}</text></svg>`, parts };
}

function renderStats() {
  if (S.statKind === 'spend') return renderSpend();
  const { works, rows, none } = statData();
  const total = works.length;
  const kindLabel = STAT_KINDS.find((k) => k[0] === S.statKind)[1];
  const played = works.filter((w) => w.status === '청취 완료' || w.status === '청취 중').length;
  const rated = works.filter((w) => w.rating);
  const avg = rated.length ? (rated.reduce((a, w) => a + w.rating, 0) / rated.length).toFixed(1) : '–';
  const { svg, parts } = donutSvg(rows, total);
  const colorOf = new Map(parts.map((p) => [p.key, p.color]));
  const max = rows[0]?.n || 1;
  const limit = 40;
  // 순위 줄은 스크롤하면 이어서 더 그려요 (화면이 위로 튀지 않게).
  const rowHtml = (x, i) => `<button type="button" class="leg-row" data-stat-key="${esc(x.key)}" title="${L("이 조건의 작품 보기")}">
          <span class="leg-rank">${i + 1}</span>
          <span class="leg-dot" style="background:${colorOf.get(x.key) || 'var(--line)'}"></span>
          <span class="leg-name">${nameCell(x.key)}</span>
          <span class="leg-bar"><span style="width:${Math.max(2, Math.round(x.n / max * 100))}%;background:${colorOf.get(x.key) || 'var(--muted)'}"></span></span>
          <span class="leg-n">${x.n}</span>
          <span class="leg-p">${(x.n / (total || 1) * 100).toFixed(1)}%</span>
        </button>`;
  setTimeout(() => {
    let shown = 0;
    const box = $('legRows'), more = $('statMore');
    if (!box) return;
    const add = () => {
      box.insertAdjacentHTML('beforeend', rows.slice(shown, shown + limit).map((x, i) => rowHtml(x, shown + i)).join(''));
      shown = Math.min(rows.length, shown + limit);
      more.textContent = shown < rows.length ? L('아래로 내리면 더 보여요') + ` (${shown}/${rows.length})` : '';
      if (shown >= rows.length) statObserver?.disconnect();
    };
    statObserver?.disconnect();
    add();
    if (shown < rows.length) { statObserver = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) add(); }, { root: $('main'), rootMargin: '400px' }); statObserver.observe(more); }
  });
  const nameCell = (key) => (S.statKind === 'actor' ? nameHtml(key) : `<span class="nm-ja">${esc(key)}</span>`);
  $('stats').innerHTML = `${statModeHtml()}
    <div class="stat-cards">
      <div class="stat-card"><div class="sc-label">${L("작품")}</div><div class="sc-num">${total.toLocaleString()}</div></div>
      <div class="stat-card"><div class="sc-label">${L("들은 작품")}</div><div class="sc-num">${played.toLocaleString()}</div></div>
      <div class="stat-card"><div class="sc-label">${L("별점 준 작품")}</div><div class="sc-num">${rated.length.toLocaleString()}</div></div>
      <div class="stat-card"><div class="sc-label">${L("평균 별점")}</div><div class="sc-num">${avg}</div></div>
    </div>
    <div class="stat-tools">
      <div class="stat-kind-grid" role="tablist">${STAT_KINDS.filter(([k]) => k !== 'spend').map(([k, l]) => `<button type="button" data-stat-kind="${k}" class="${S.statKind === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <select id="statScope" aria-label="${L("통계 범위")}">${STAT_SCOPES.map(([k, l]) => `<option value="${k}"${S.statScope === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="stat-body">
      <div class="donut-wrap">${svg}</div>
      <div class="stat-legend">
        <div class="note">${kindLabel} ${rows.length.toLocaleString()}${L("개")}${none ? ` ${L("· 정보 없는 작품")} ${none}${L("개")}` : ''}${['actor', 'tag'].includes(S.statKind) ? L(' · 여러 명(개)이 들어간 작품은 각각에 모두 셌어요') : ''}</div>
        <div id="legRows"></div>
        <div class="leg-more" id="statMore"></div>
      </div>
    </div>`;
}
// 지출: 구매일·금액이 있는 작품을 월별로 더해요. 구매가가 없으면 정가로 셉니다.
S.spendPeriod = 'recent';
S.spendMonth = '';
S.spendCur = '';
function renderSpend() {
  const bought = S.works.filter((w) => w.purchaseDate && (w.paidPrice ?? w.listPrice) != null);
  const curCount = new Map();
  for (const w of bought) curCount.set(w.currency || 'JPY', (curCount.get(w.currency || 'JPY') || 0) + 1);
  const curs = [...curCount].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  if (!curs.includes(S.spendCur)) S.spendCur = curs[0] || 'JPY';
  const cur = S.spendCur;
  const years = [...new Set(bought.map((w) => w.purchaseDate.slice(0, 4)))].sort().reverse();
  if (S.spendPeriod !== 'recent' && !years.includes(S.spendPeriod)) S.spendPeriod = 'recent';
  const pad = (n) => String(n).padStart(2, '0');
  let months;
  if (S.spendPeriod === 'recent') {
    const d = new Date(); months = [];
    for (let i = 11; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); months.push(`${x.getFullYear()}-${pad(x.getMonth() + 1)}`); }
  } else months = Array.from({ length: 12 }, (_, i) => `${S.spendPeriod}-${pad(i + 1)}`);
  const inCur = bought.filter((w) => (w.currency || 'JPY') === cur);
  const inPeriod = inCur.filter((w) => months.includes(w.purchaseDate.slice(0, 7)));
  const paidOf = (w) => w.paidPrice ?? w.listPrice;
  const byMonth = new Map(months.map((m) => [m, { sum: 0, n: 0 }]));
  for (const w of inPeriod) { const r = byMonth.get(w.purchaseDate.slice(0, 7)); r.sum += paidOf(w); r.n++; }
  const total = inPeriod.reduce((a, w) => a + paidOf(w), 0);
  const saved = inPeriod.reduce((a, w) => a + (w.listPrice != null && w.paidPrice != null ? Math.max(0, w.listPrice - w.paidPrice) : 0), 0);
  const activeMonths = [...byMonth.values()].filter((r) => r.n).length;
  const max = Math.max(1, ...[...byMonth.values()].map((r) => r.sum));
  const stores = new Map();
  for (const w of inPeriod) { const k = w.store || L('구매처 미기재'); const r = stores.get(k) || { sum: 0, n: 0 }; r.sum += paidOf(w); r.n++; stores.set(k, r); }
  const storeRows = [...stores].sort((a, b) => b[1].sum - a[1].sum);
  if (S.spendMonth && !months.includes(S.spendMonth)) S.spendMonth = '';
  const monthWorks = S.spendMonth ? inCur.filter((w) => w.purchaseDate.startsWith(S.spendMonth)).sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate)) : [];
  const mLabel = (m) => Number(m.slice(5)) + `<small>${L("월")}</small>`;
  $('stats').innerHTML = `${statModeHtml()}
    <div class="stat-cards">
      <div class="stat-card"><div class="sc-label">${S.spendPeriod === 'recent' ? L('최근 12개월 지출') : S.spendPeriod + L('년 지출')}</div><div class="sc-num">${money(total, cur) || money(0, cur)}</div></div>
      <div class="stat-card"><div class="sc-label">${L("월 평균 · 산 달 기준")}</div><div class="sc-num">${money(activeMonths ? total / activeMonths : 0, cur)}</div></div>
      <div class="stat-card"><div class="sc-label">${L("구매한 작품")}</div><div class="sc-num">${inPeriod.length.toLocaleString()}</div></div>
      <div class="stat-card"><div class="sc-label">${L("할인으로 아낀 금액")}</div><div class="sc-num">${money(saved, cur)}</div></div>
    </div>
    <div class="stat-tools">
      <select id="spendPeriod" aria-label="${L("기간")}"><option value="recent">${L("최근 12개월")}</option>${years.map((y) => `<option value="${y}"${S.spendPeriod === y ? ' selected' : ''}>${y}${L("년")}</option>`).join('')}</select>
      ${curs.length > 1 ? `<div class="tabs" role="radiogroup" aria-label="${L("통화")}">${curs.map((c) => `<button type="button" data-spend-cur="${c}" class="${c === cur ? 'on' : ''}">${CUR_SIGN[c]} ${c}</button>`).join('')}</div>` : ''}
    </div>
    <div class="stat-body spend-body">
      ${bought.length ? '' : `<div class="note">${L("아직 구매 정보가 없어요. 작품의 정보 수정 → 구매 정보에서 구매일과 금액을 넣으면 여기에 월별로 모여요.")}</div>`}
      <div class="bars" role="list">${months.map((m) => { const r = byMonth.get(m); return `<button type="button" class="bar${S.spendMonth === m ? ' on' : ''}" data-spend-month="${m}" role="listitem" title="${m} · ${money(r.sum, cur)} · ${r.n}${L("개")}">
        <span class="bar-v">${r.sum ? money(r.sum, cur) : ''}</span>
        <span class="bar-track"><span class="bar-fill" style="height:${r.sum ? Math.max(3, Math.round(r.sum / max * 100)) : 0}%"></span></span>
        <span class="bar-m">${mLabel(m)}</span></button>`; }).join('')}</div>
      ${S.spendMonth ? `<div class="spend-month"><div class="sec-head"><h3>${S.spendMonth.replace('-', ' / ')} · ${money(byMonth.get(S.spendMonth).sum, cur)}</h3><button type="button" class="link-btn" data-spend-month="">${L("닫기")}</button></div>
        ${monthWorks.map((w) => `<button type="button" class="spend-row" data-open-work="${esc(w.id)}"><span class="sr-date">${esc(w.purchaseDate.slice(5))}</span><span class="sr-title">${esc(displayTitle(w))}</span><span class="sr-store">${esc(w.store)}</span><span class="sr-price">${money(paidOf(w), cur)}</span></button>`).join('')}</div>` : ''}
      ${storeRows.length ? `<div class="spend-stores"><div class="note">${L("구매처별 · 막대를 누르면 그 달 작품을 보여줘요 · 구매가가 비어 있으면 정가로 셌어요")}</div>
        ${storeRows.map(([k, r], i) => `<div class="leg-row"><span class="leg-rank">${i + 1}</span><span class="leg-dot" style="background:${STAT_COLORS[i % STAT_COLORS.length]}"></span><span class="leg-name">${esc(k)}</span><span class="leg-bar"><span style="width:${Math.max(2, Math.round(r.sum / (total || 1) * 100))}%;background:${STAT_COLORS[i % STAT_COLORS.length]}"></span></span><span class="leg-n">${r.n}${L("개")}</span><span class="leg-p">${money(r.sum, cur)}</span></div>`).join('')}</div>` : ''}
    </div>`;
}
$('stats').addEventListener('click', (e) => {
  const m = e.target.closest('[data-spend-month]');
  if (m) { S.spendMonth = S.spendMonth === m.dataset.spendMonth ? '' : m.dataset.spendMonth; return renderSpend(); }
  const c = e.target.closest('[data-spend-cur]');
  if (c) { S.spendCur = c.dataset.spendCur; S.spendMonth = ''; return renderSpend(); }
  const o = e.target.closest('[data-open-work]');
  if (o) select(o.dataset.openWork);
});
$('stats').addEventListener('change', (e) => { if (e.target.id === 'spendPeriod') { S.spendPeriod = e.target.value; S.spendMonth = ''; renderSpend(); } });
// 통계 위쪽 큰 탭: 작품 통계 | 지출
let lastWorkKind = 'actor';
function statModeHtml() {
  const spend = S.statKind === 'spend';
  if (!spend) lastWorkKind = S.statKind;
  return `<div class="stat-mode" role="tablist"><button type="button" data-stat-mode="works" class="${spend ? '' : 'on'}">${L('작품 통계')}</button><button type="button" data-stat-mode="spend" class="${spend ? 'on' : ''}">${L('지출')}</button></div>`;
}
$('stats').addEventListener('click', (e) => {
  const m = e.target.closest('[data-stat-mode]');
  if (!m) return;
  e.stopImmediatePropagation();
  S.statKind = m.dataset.statMode === 'spend' ? 'spend' : (lastWorkKind || 'actor');
  rememberStats(); renderStats();
}, true);
const rememberStats = () => { try { localStorage.setItem('voicebox.stats', JSON.stringify({ kind: S.statKind, scope: S.statScope })); } catch {} };
$('stats').addEventListener('click', (e) => {
  const kind = e.target.closest('[data-stat-kind]');
  if (kind) { S.statKind = kind.dataset.statKind; S.statMore = false; rememberStats(); return renderStats(); }
  const keyEl = e.target.closest('[data-stat-key]');
  if (!keyEl) return;
  // 그 조건으로 목록 보기
  const key = keyEl.dataset.statKey;
  resetFilters();
  S.nav = { played: 'played', reviewed: 'reviewed' }[S.statScope] || 'all';
  if (S.statKind === 'actor' || S.statKind === 'circle' || S.statKind === 'tag') S[S.statKind] = key;
  if (S.statKind === 'year') { S.q = key + '-'; $('search').value = S.q; }
  if (S.statKind === 'rating') S.rating = key === L('별점 없음') ? '0' : String(key.length);
  if (S.statKind === 'status') S.nav = { [L('들음')]: 'played', [L('듣는 중')]: 'played', [L('안 들음')]: 'unplayed', [L('상태 미기재')]: 'unplayed' }[key];
  fillFilterOptions();
  renderNav();
  renderList();
  $('main').scrollTop = 0;
  if (S.statKind === 'rating' && S.rating !== '0' && S.rating !== '5') toast(`★${S.rating} ${L("이상인 작품이에요.")}`);
});
$('stats').addEventListener('change', (e) => { if (e.target.id === 'statScope') { S.statScope = e.target.value; rememberStats(); renderStats(); } });

// 동기화로 다른 기기의 기록을 받으면 목록을 다시 그려요.
async function reloadAfterSync() {
  const typing = document.activeElement?.id === 'reviewBox' || $('editor').open;
  await load();
  if (S.selected && !typing) select(S.selected, { push: false }).catch(() => {});
}
window.addEventListener('vb:reload', reloadAfterSync);
if (!window.VB_MOBILE) {
  let seen = null;
  setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    const st = await api('api/sync/status').catch(() => null);
    if (!st?.changedAt) return;
    if (seen && st.changedAt !== seen) reloadAfterSync();
    seen = st.changedAt;
  }, 30000);
}
// 새 창으로 연 경우: 그 작품의 상세만 크게 보여줍니다.
if (S.solo) document.body.classList.add('solo');
load().then(() => {
  // 리뷰카드 화면에서 돌아왔을 때(#open=작품) 그 작품을 다시 열어요.
  const back = location.hash.match(/^#open=(.+)$/);
  if (back) { history.replaceState(null, '', location.pathname + location.search); select(decodeURIComponent(back[1]), { push: false }); }
  if (S.solo) {
    select(S.solo, { push: false }).then(() => { if (S.detail) document.title = displayTitle(S.detail) + ' · VOICE BOX'; });
  }
  if (S.notion.running) pollSync();
}).catch((e) => {
  $('listMore').innerHTML = `<div class="empty"><strong>${L("데이터를 불러오지 못했어요")}</strong>${esc(e.message)}</div>`;
});

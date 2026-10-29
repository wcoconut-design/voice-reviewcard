// VOICE BOX 로컬판 화면
// 구성: 상태 → 서버 요청 → 왼쪽 메뉴 → 목록 → 상세 → 편집 → 노션 반영 → 설정 → 기타
'use strict';

/* ================= 상태 ================= */
const S = {
  works: [],          // 목록용 작품 (긴 본문 제외)
  others: [],         // 기타 구매·포인트 충전 (지출 통계 전용)
  folders: [],
  notion: {},
  nav: 'all',         // all | played | unplayed | fav | reviewed | unreviewed | hidden | pending | folder:이름
  q: '', actor: '', circle: '', tag: '', rating: '', wt: '', sort: 'bought',
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
S.home = isPhone(); // 폰은 홈 화면부터 열려요.
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
  if (!r.ok) { const err = new Error(data.error || L('요청을 처리하지 못했어요.')); err.status = r.status; err.data = data; throw err; }
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
  // 기타 구매(만화 등)·포인트 충전은 작품 목록과 따로 둬요. 지출 통계에서만 써요.
  S.works = d.works.filter((w) => !w.entryType);
  S.others = d.works.filter((w) => w.entryType);
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
  if (item.entryType) { const j = S.others.findIndex((w) => w.id === full.id); if (j >= 0) S.others[j] = item; else S.others.unshift(item); return; }
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
  ['listening', '듣는 중', (w) => w.status === '청취 중'],
  ['reviewed', '감상 쓴 작품', (w) => !!w.review],
  ['unreviewed', '감상 안 쓴 작품', (w) => !w.review],
  ['hidden', '숨긴 작품', (w) => w.hidden],
];
// 메뉴 이름 영어 버전 (설정 → 보기 → 메뉴 이름)
const MENU_EN = {
  all: 'All Works', played: 'Listened', unplayed: 'Not Yet', fav: 'Favorites', reviewed: 'Reviewed',
  unreviewed: 'No Review', hidden: 'Hidden', stats: 'Voice Chart', pending: 'Pending Sync', listening: 'Listening', toreview: 'To Review',
  'g-library': 'LIBRARY', 'g-notion': 'NOTION', 'g-folders': 'FOLDERS', 'new-folder': '+ New',
  settings: 'Settings', 'tab-list': 'List', 'tab-search': 'Search', 'tab-menu': 'Library', 'tab-settings': 'Settings',
  'pending-title': 'Pending Sync', 'stats-title': 'Stats', 'add': '+ Add',
  'tab-home': 'Home', 'tab-stats': 'Stats',
};
const MENU_JA = {
  all: 'すべての作品', played: '聴いた作品', unplayed: '未聴の作品', fav: 'お気に入り', reviewed: '感想あり',
  unreviewed: '感想なし', hidden: '非表示', stats: 'ボイスチャート', pending: '反映待ち', listening: '聴いている作品', toreview: '感想を書く作品',
  'g-library': 'ライブラリ', 'g-notion': 'Notion', 'g-folders': 'フォルダ', 'new-folder': '+ 新規',
  settings: '設定', 'tab-list': 'リスト', 'tab-search': '検索', 'tab-menu': 'ライブラリ', 'tab-settings': '設定',
  'pending-title': 'Notion反映待ち', 'stats-title': '統計', 'add': '+ 作品を追加',
  'tab-home': 'ホーム', 'tab-stats': '統計',
};
const MENU_KO = {
  toreview: '감상 쓸 작품',
  stats: '통계', pending: '반영 대기', 'g-library': '정리함', 'g-notion': '노션', 'g-folders': '내 폴더', 'new-folder': '+ 새 폴더',
  settings: '설정 · 노션 · 백업', 'tab-list': '목록', 'tab-search': '검색', 'tab-menu': '정리함', 'tab-settings': '설정',
  'pending-title': '노션 반영 대기', 'stats-title': '통계', 'add': '+ 작품 추가',
  'tab-home': '홈', 'tab-stats': '통계',
};
// 폰 앱(노션 연동 없음)은 설정 메뉴 이름에서 '노션'을 뺍니다.
if (window.VB_MOBILE) { MENU_KO.settings = '설정 · 백업'; MENU_EN.settings = 'Settings'; MENU_JA.settings = '設定'; }
const menuText = (key) => (S.menuLang === 'en' ? MENU_EN[key] : S.menuLang === 'ja' ? MENU_JA[key] : MENU_KO[key] ?? (NAV.find((n) => n[0] === key) || [])[1]) || key;
// 메뉴 언어를 따르는 화면 글자 (검색 화면, 칩, 설정의 보기 항목 등)
const UI = {
  ko: {
    cancel: '취소', recent: '최근 검색', clearRecent: '지우기', topActors: '자주 듣는 성우', topCircles: '자주 듣는 서클', topTags: '장르',
    searchPh: '작품명, 성우, 서클, 태그, 코드, 감상', searchPhPhone: '작품명이나 성우 검색',
    chipAll: '전체', chipPlayed: '들음', chipUnplayed: '안 들음', chipFav: '즐겨찾기', chipListening: '듣는 중', chipReviewed: '감상', chipHidden: '숨김', chipFolder: '폴더', chipPending: '반영 대기',
    folders: '폴더', noFolders: '아직 폴더가 없어요.', manageFolders: '+ 새 폴더',
    viewTitle: '보기', nameModeNote: '성우 이름 표시', nameBoth: '일본어 + 한국어', nameJa: '일본어만', nameKo: '한국어만',
    langNote: '메뉴 언어', paletteNote: '색 테마', palIndigo: '인디고', palGreen: '내추럴 그린', palMono: '모노',
    modeNote: '화면 모드', modeSystem: '시스템 설정 따르기', modeLight: '라이트', modeDark: '다크',
  },
  en: {
    cancel: 'Cancel', recent: 'Recent', clearRecent: 'Clear', topActors: 'Top voice actors', topCircles: 'Top circles', topTags: 'Genres',
    searchPh: 'Title, actor, circle, tag, code, review', searchPhPhone: 'Search titles or actors',
    chipAll: 'All', chipPlayed: 'Listened', chipUnplayed: 'Not yet', chipFav: 'Favorites', chipListening: 'Listening', chipReviewed: 'Reviewed', chipHidden: 'Hidden', chipFolder: 'Folders', chipPending: 'Pending',
    folders: 'Folders', noFolders: 'No folders yet.', manageFolders: '+ New folder',
    viewTitle: 'Display', nameModeNote: 'Voice actor names', nameBoth: 'Japanese + Korean', nameJa: 'Japanese only', nameKo: 'Korean only',
    langNote: 'Menu language', paletteNote: 'Color theme', palIndigo: 'Indigo', palGreen: 'Natural green', palMono: 'Mono',
    modeNote: 'Appearance', modeSystem: 'Match system', modeLight: 'Light', modeDark: 'Dark',
  },
  ja: {
    cancel: 'キャンセル', recent: '最近の検索', clearRecent: '消去', topActors: 'よく聴く声優', topCircles: 'よく聴くサークル', topTags: 'ジャンル',
    searchPh: '作品名・声優・サークル・タグ・コード・感想', searchPhPhone: '作品名や声優で検索',
    chipAll: 'すべて', chipPlayed: '聴いた', chipUnplayed: '未聴', chipFav: 'お気に入り', chipListening: '聴取中', chipReviewed: '感想あり', chipHidden: '非表示', chipFolder: 'フォルダ', chipPending: '反映待ち',
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
  if (nav === 'toreview') return (w) => w.status === '청취 완료' && !w.review;
  if (nav.startsWith('folder:')) { const f = nav.slice(7); return (w) => w.folder === f; }
  return (NAV.find((n) => n[0] === nav) || NAV[0])[2];
}
function navLabel(nav) {
  if (nav === 'pending') return menuText('pending-title');
  if (nav === 'toreview') return menuText('toreview');
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
    chip('all', tr('chipAll')),
    chip('fav', '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg> ' + tr('chipFav')),
    S.nav === 'listening' || S.works.some((w) => w.status === '청취 중' && visible(w)) ? chip('listening', tr('chipListening')) : '',
    chip('played', tr('chipPlayed')), chip('unplayed', tr('chipUnplayed')),
    chip('reviewed', tr('chipReviewed')),
    S.nav === 'toreview' ? chip('toreview', menuText('toreview')) : '',
    `<button type="button" class="nchip${inFolder ? ' on' : ''}" data-folder-sheet>${esc(inFolder ? S.nav.slice(7) : tr('chipFolder'))} <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>`,
    S.nav === 'hidden' ? chip('hidden', tr('chipHidden')) : '',
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
  S.home = false;
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
  if (S.wt) list = list.filter((w) => w.workType === S.wt);
  if (S.rating !== '') list = list.filter((w) => (S.rating === '0' ? !w.rating : w.rating >= Number(S.rating)));
  const by = {
    updated: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''),
    created: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
    date: (a, b) => (b.date || '').localeCompare(a.date || ''),
    dateOld: (a, b) => (a.date || '9999').localeCompare(b.date || '9999'),
    rating: (a, b) => b.rating - a.rating || (b.lastPlayed || '').localeCompare(a.lastPlayed || ''),
    played: (a, b) => (b.lastPlayed || '').localeCompare(a.lastPlayed || ''),
    bought: (a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || '') || (b.createdAt || '').localeCompare(a.createdAt || ''),
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

const rowAttrs = (w, cls) => `class="row ${cls}${S.selected === w.id ? ' on' : ''}${w.hidden ? ' is-hidden' : ''}${S.selectMode && S.picked.has(w.id) ? ' picked' : ''}" role="listitem" tabindex="0" data-id="${esc(w.id)}"`;
const marks = (w) => (w.hidden ? `<span class="tag-hidden">${L("숨김")}</span>` : '') + (pendingTest(w) ? `<span class="dot-pending" title="${L("노션 반영 대기")}"></span>` : '');
const starsHtml = (w) => (w.rating ? `<span class="stars-sm" aria-label="${L('별점')} ${w.rating}">${'★'.repeat(w.rating)}</span>` : '');
const starNum = (w) => (w.rating ? `<span class="stars-num" aria-label="${L('별점')} ${w.rating}">★ ${w.rating}</span>` : '');
const listeningPill = (w) => (w.status === '청취 중' ? `<span class="pill-now">${L('듣는 중')}</span>` : '');
function actorsBlock(w, max = 2) {
  const list = splitNames(w.actor);
  if (!list.length) return '<span class="muted-dash">—</span>';
  return list.slice(0, max).map((a) => `<div class="nm">${nameHtml(a)}</div>`).join('') + (list.length > max ? `<div class="nm-more">${L("외")} ${list.length - max}${L("명")}</div>` : '');
}

// 넓을 때: 칸 나눔 + 별점·상태 바로 고르기
// 목록의 날짜 칸: 정렬 기준에 맞는 날짜를 보여줘요. (구매일순 → 구매일, 최근 들은순 → 청취일, 등록순 → 등록일, 그 밖 → 발매일)
const DATE_COL = {
  bought: [L('구매일'), (w) => w.purchaseDate],
  played: [L('청취일'), (w) => w.lastPlayed],
  created: [L('등록일'), (w) => (w.createdAt || '').slice(0, 10)],
};
const dateCol = () => DATE_COL[S.sort] || [L('발매일'), (w) => w.date];
const listDate = (w) => dateCol()[1](w) || '';
const tableHead = () => `<div class="thead" aria-hidden="true"><span></span><span>${L("작품")}</span><span>${L("성우")}</span><span>${L("서클")}</span><span>${dateCol()[0]}</span><span>${L("나의 기록")}</span><span></span></div>`;
function tableRowHtml(w) {
  const sub = w.titleKo && w.title ? w.title : '';
  return `<div ${rowAttrs(w, 'trow')}>
    ${thumbHtml(w)}
    <div class="cell-title"><div class="row-title">${esc(displayTitle(w))}</div>${sub ? `<div class="row-orig">${esc(sub)}</div>` : ''}<div class="row-marks">${marks(w)}${w.tags.slice(0, 3).map((t) => `<span class="mini-tag">${esc(t)}</span>`).join('')}</div></div>
    <div class="cell-actor">${actorsBlock(w, 1)}</div>
    <div class="cell-circle">${esc(splitNames(w.circle).join(', ')) || '<span class="muted-dash">—</span>'}</div>
    <div class="cell-date">${esc(listDate(w)) || '<span class="muted-dash">—</span>'}</div>
    <div class="quick">
      <div class="qstars${w.rating ? ' rated' : ''}" role="radiogroup" aria-label="${L("별점")}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-qstar="${n}" class="${n <= w.rating ? 'on' : ''}" aria-label="${n}${L("점")}">★</button>`).join('')}</div>
      <select data-quick="status" class="qstatus st-${({ '미청취': 'no', '청취 중': 'now', '청취 완료': 'done' })[w.status] || 'none'}" aria-label="${L("청취 상태")}">${[['', L('상태 —')], ['미청취', L('안 들음')], ['청취 중', L('듣는 중')], ['청취 완료', L('들음')]].map(([v, l]) => `<option value="${v}"${v === w.status ? ' selected' : ''}>${l}</option>`).join('')}</select>
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
    <div class="row-side2">${starsHtml(w)}<div class="side-sub">${marks(w)}${listeningPill(w)}${w.favorite ? '<span class="mini-heart">♥</span>' : ''}<span>${esc(listDate(w).slice(2))}</span></div></div>
  </div>`;
}
// 좁을 때: 간단한 한 줄
function compactRowHtml(w) {
  const sub = [splitNames(w.actor).map(nameText).join(', '), w.circle].filter(Boolean).join(' · ');
  return `<div ${rowAttrs(w, 'compact')}>
    ${thumbHtml(w)}
    <div class="row-main"><div class="row-title">${esc(displayTitle(w))}</div><div class="row-sub">${esc(sub)}</div></div>
    <div class="row-side">${marks(w)}${listeningPill(w)}${w.favorite ? '<span class="mini-heart">♥</span>' : ''}${starNum(w)}</div></div>`;
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

// 위로 가기: 목록·상세를 많이 내리면 오른쪽 아래에 ↑ 버튼이 떠요. (아이폰 상단 톡톡은 이 앱 구조에선 동작하지 않아서)
const toTopBtn = document.createElement('button');
toTopBtn.type = 'button'; toTopBtn.className = 'to-top'; toTopBtn.hidden = true;
toTopBtn.setAttribute('aria-label', L('맨 위로'));
toTopBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>';
document.body.appendChild(toTopBtn);
const scrollTarget = () => (!$('detail').hidden && isNarrow() ? $('detail') : $('main'));
let toTopIdle;
function updateToTop() {
  const el = scrollTarget();
  const show = isNarrow() && el.scrollTop > Math.min(700, el.clientHeight * 0.75) && !document.querySelector('dialog[open]');
  toTopBtn.hidden = !show;
  toTopBtn.classList.remove('idle');
  clearTimeout(toTopIdle);
  if (show) toTopIdle = setTimeout(() => toTopBtn.classList.add('idle'), 1800);
}
$('main').addEventListener('scroll', updateToTop, { passive: true });
$('detail').addEventListener('scroll', updateToTop, { passive: true });
toTopBtn.onclick = () => { scrollTarget().scrollTo({ top: 0, behavior: 'smooth' }); };
// 상세 위쪽 줄의 빈 곳을 누르면 맨 위로
$('detail').addEventListener('click', (e) => { if (e.target.classList?.contains('d-top') || e.target.classList?.contains('right')) $('detail').scrollTo({ top: 0, behavior: 'smooth' }); });

// 폰 홈: 인사 · 최근 산 작품 · 오늘의 한 작품 · 감상 쓸 작품 · 이번 달 요약
const isHome = () => !!S.home && isPhone() && !S.searching;
function goHome() {
  S.home = true;
  if (S.nav === 'stats') S.nav = 'all';
  renderNav(); renderList();
  $('main').scrollTop = 0;
}
let pickShift = 0;
const dayHash = (str) => { let h = 7; for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
function boughtAgo(d) {
  if (!d) return '';
  const days = Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000);
  if (!(days >= 0)) return '';
  if (days < 1) return L('오늘 산 작품');
  if (days < 31) return L('산 지 {n}일', { n: days });
  if (days < 365) return L('산 지 {n}달', { n: Math.floor(days / 30.4) });
  return L('산 지 {n}년', { n: Math.floor(days / 365) });
}
function renderHome() {
  const el = $('home');
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const shown = S.works.filter((w) => !w.hidden);
  const listened = S.works.filter((w) => !w.noStats && (w.lastPlayed || '').startsWith(ym)).length;
  const dateText = now.toLocaleDateString(LOCALE(), { month: 'long', day: 'numeric', weekday: 'short' });
  const head = `<div class="hm-hello"><h1>${L('오늘은 뭐 들을까')}</h1><p>${esc(dateText)} · ${listened ? L('이번 달 {n}개 들었어요', { n: listened }) : L('이번 달은 아직 들은 작품이 없어요')}</p></div>`;
  if (!shown.length) {
    el.innerHTML = head + `<div class="hm-card hm-empty"><strong>${L('아직 작품이 없어요')}</strong><span>${L('아래 ＋ 버튼으로 첫 작품을 넣어 보세요.')}</span></div>`;
    return;
  }
  // 최근 산 작품 (구매일 → 등록일 순)
  const recent = [...shown].sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || '') || (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 12);
  const shelf = `<section class="hm-sec"><div class="hm-h"><h2>${L('최근 산 작품')}</h2><button type="button" class="link-btn" data-home="recent">${L('전체')} ›</button></div>
    <div class="now-scroll hm-shelf">${recent.map((w) => `<button type="button" class="now-item" data-id="${esc(w.id)}">${thumbHtml(w)}<span class="now-title">${esc(splitTitle(displayTitle(w))[0])}</span><span class="now-sub">${esc(splitNames(w.actor).map(nameText)[0] || w.circle || '')}</span></button>`).join('')}</div></section>`;
  // 오늘의 한 작품: 사 놓고 아직 안 들은 작품 중 하루에 하나 (↻로 바꾸기)
  const pool = shown.filter((w) => w.status !== '청취 완료' && w.status !== '청취 중').sort((a, b) => String(a.id).localeCompare(String(b.id)));
  let pick = '';
  if (pool.length) {
    const w = pool[(dayHash(now.toDateString()) + pickShift) % pool.length];
    const sub = [splitNames(w.actor).map(nameText)[0] || w.circle, boughtAgo(w.purchaseDate), L('아직 안 들음')].filter(Boolean).join(' · ');
    pick = `<section class="hm-card"><div class="hm-h"><h2>${L('오늘의 한 작품')}</h2>${pool.length > 1 ? `<button type="button" class="link-btn" data-home="reroll">↻ ${L('다른 작품')}</button>` : ''}</div>
      <button type="button" class="hm-pick" data-id="${esc(w.id)}">${thumbHtml(w)}<span><span class="hm-pick-t">${esc(displayTitle(w))}</span><span class="hm-pick-s">${esc(sub)}</span></span></button></section>`;
  } else {
    pick = `<section class="hm-card"><div class="hm-h"><h2>${L('오늘의 한 작품')}</h2></div><p class="hm-note">${L('안 들은 작품이 없어요. 다 들었어요!')}</p></section>`;
  }
  // 들었는데 감상이 비어 있는 작품
  const toReview = shown.filter((w) => w.status === '청취 완료' && !w.review).length;
  const review = toReview ? `<button type="button" class="hm-card hm-row" data-home="toreview"><span><span class="hm-row-t">${L('감상 안 쓴 작품')} <b>${toReview.toLocaleString()}</b></span><span class="hm-row-s">${L('들은 뒤 감상이 비어 있어요')}</span></span><span class="hm-go">${L('쓰기')} ›</span></button>` : '';
  // 이번 달 요약 (지출은 음성 작품만, 가장 많이 쓴 통화로)
  const monthBuys = S.works.filter((w) => (w.purchaseDate || '').startsWith(ym));
  const curN = new Map();
  for (const w of monthBuys) if ((w.paidPrice ?? w.listPrice) != null) curN.set(w.currency || 'JPY', (curN.get(w.currency || 'JPY') || 0) + 1);
  const cur = [...curN].sort((a, b) => b[1] - a[1])[0]?.[0] || 'JPY';
  const spend = monthBuys.filter((w) => (w.currency || 'JPY') === cur).reduce((a, w) => a + (w.paidPrice ?? w.listPrice ?? 0), 0);
  const kpi = (key, label, value) => `<button type="button" class="hm-kpi" data-home="${key}"><span>${label}</span><b>${value}</b></button>`;
  const month = `<section class="hm-sec"><div class="hm-h"><h2>${L('이번 달')}</h2></div><div class="hm-kpis">
    ${kpi('spend', L('지출'), (CUR_SIGN[cur] || '') + spend.toLocaleString())}${kpi('recent', L('새로 산'), monthBuys.length.toLocaleString())}${kpi('listened', L('들음'), listened.toLocaleString())}</div></section>`;
  el.innerHTML = head + shelf + pick + review + month;
}
$('home').addEventListener('click', (e) => {
  const act = e.target.closest('[data-home]')?.dataset.home;
  const leave = (nav, sort) => {
    S.home = false; S.nav = nav; S.shown = 60;
    if (sort) { S.sort = sort; $('fSort').value = sort; }
    renderNav(); renderList(); $('main').scrollTop = 0;
  };
  if (act === 'reroll') { pickShift += 1 + Math.floor(Math.random() * 5); renderHome(); return; }
  if (act === 'recent') { leave('all', 'bought'); return; }
  if (act === 'listened') { leave('played', 'played'); return; }
  if (act === 'toreview') { leave('toreview'); return; }
  if (act === 'spend') { S.statKind = 'spend'; leave('stats'); return; }
  const b = e.target.closest('[data-id]');
  if (b) select(b.dataset.id);
});

// ===== 여러 개 선택: 목록에서 체크해서 한꺼번에 지우거나 숨기기 =====
S.selectMode = false; S.picked = new Set();
const selBar = document.createElement('div');
selBar.className = 'sel-bar'; selBar.hidden = true;
document.body.appendChild(selBar);
function renderSelBar() {
  selBar.hidden = !S.selectMode;
  document.body.classList.toggle('select-mode', S.selectMode);
  if (!S.selectMode) return;
  const n = S.picked.size;
  const all = currentList.length && currentList.every((w) => S.picked.has(w.id));
  selBar.innerHTML = `<span class="sel-n">${L('{n}개 선택', { n: n.toLocaleString() })}</span>
    <button type="button" class="ghost-btn" data-sel="all">${all ? L('선택 해제') : L('모두 선택')}</button>
    <span class="spacer"></span>
    <button type="button" class="ghost-btn" data-sel="hide"${n ? '' : ' disabled'}>${L('숨기기')}</button>
    <button type="button" class="ghost-btn danger-btn" data-sel="del"${n ? '' : ' disabled'}>${L('지우기')}</button>
    <button type="button" class="primary-btn" data-sel="done">${L('완료')}</button>`;
}
function startSelect() { S.selectMode = true; S.picked = new Set(); if (isHome()) { S.home = false; renderNav(); } renderList(); renderSelBar(); toast(L('작품을 눌러서 고르세요.')); }
function endSelect() { S.selectMode = false; S.picked.clear(); renderList(); renderSelBar(); }
function togglePick(id, el) {
  if (S.picked.has(id)) S.picked.delete(id); else S.picked.add(id);
  el?.classList.toggle('picked', S.picked.has(id));
  renderSelBar();
}
selBar.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-sel]'); if (!b) return;
  const act = b.dataset.sel;
  if (act === 'done') return endSelect();
  if (act === 'all') {
    const all = currentList.every((w) => S.picked.has(w.id));
    if (all) S.picked.clear(); else for (const w of currentList) S.picked.add(w.id);
    renderList(); renderSelBar(); return;
  }
  const ids = [...S.picked];
  if (!ids.length) return;
  if (act === 'del' && !confirm(L('작품 {n}개를 지울까요? 설정 → 백업 → 되돌리기에서 되살릴 수 있어요.', { n: ids.length.toLocaleString() }))) return;
  b.disabled = true; b.textContent = L('처리 중…');
  try {
    for (const id of ids) {
      if (act === 'del') await api('api/works/' + encodeURIComponent(id), { method: 'DELETE' });
      else await api('api/works/' + encodeURIComponent(id), { method: 'PATCH', body: { hidden: true } });
    }
    toast(act === 'del' ? L('작품 {n}개를 지웠어요.', { n: ids.length.toLocaleString() }) : L('작품 {n}개를 숨겼어요.', { n: ids.length.toLocaleString() }));
  } catch (err) { fail(err); }
  S.picked.clear(); S.selectMode = false;
  await load(); renderSelBar();
});

// ===== 중복 작품 합치기: 같은 작품 코드가 여러 개면 하나만 남기고, 구매 정보는 남길 작품으로 옮겨요 =====
const BUY_FIELDS = ['purchaseDate', 'store', 'salePrice', 'paidPrice', 'currency', 'couponType', 'couponValue', 'couponMemo', 'discountNote', 'paidManual', 'orderId', 'orderType', 'orderValue', 'orderTotal', 'orderCount', 'orderNo', 'pointsUsed', 'packCode', 'packTitle'];
function findDupes() {
  const by = new Map();
  for (const w of S.works) { const c = (w.code || '').trim().toUpperCase(); if (!c) continue; if (!by.has(c)) by.set(c, []); by.get(c).push(w); }
  const score = (w) => (w.notionPageId ? 100 : 0) + (w.review || w.hasReview ? 20 : 0) + (w.rating ? 10 : 0) + (w.status ? 5 : 0) + (w.favorite ? 5 : 0) + (w.tags?.length ? 3 : 0) + (w.actor ? 2 : 0) + (w.images?.length ? 2 : 0);
  const out = [];
  for (const [code, list] of by) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => score(b) - score(a) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    const keep = sorted[0], drop = sorted.slice(1);
    const patch = {};
    const src = !keep.purchaseDate && !keep.orderNo ? drop.find((w) => w.purchaseDate || w.orderNo) : null;
    if (src) for (const k of BUY_FIELDS) if (src[k] != null && src[k] !== '' && !(Array.isArray(src[k]) && !src[k].length)) patch[k] = src[k];
    const lp = drop.find((w) => w.listPrice != null)?.listPrice;
    if (keep.listPrice == null && lp != null) patch.listPrice = lp;
    const img = drop.find((w) => w.images?.length)?.images;
    if (!keep.images?.length && img) patch.images = img;
    // 제목이 같은지(괄호 부분·기호를 빼고 한쪽이 다른 쪽을 포함) · 영수증으로 새로 생긴 중복인지
    const norm = (t) => String(t || '').replace(/[【\[(（〔「『].*?[】\])）〕」』]/g, '').replace(/[\s\u3000・･·♡♥!！?？~～〜、。,.\-ー―_*※☆★]/g, '').toLowerCase();
    const kt = norm(keep.title) || norm(keep.titleKo);
    const sameTitle = drop.every((d) => { const dt = norm(d.title); return !kt || !dt || kt.includes(dt) || dt.includes(kt); });
    const fromReceipt = drop.every((d) => d.orderNo && !d.notionPageId);
    out.push({ code, keep, drop, patch, moved: !!src, sameTitle, on: sameTitle || fromReceipt });
  }
  return out;
}
function openDupes() {
  const groups = findDupes();
  const dlg = document.createElement('dialog');
  dlg.className = 'modal dup-dlg';
  document.body.appendChild(dlg);
  const counts = () => { const on = groups.filter((g) => g.on); return { dropN: on.reduce((a, g) => a + g.drop.length, 0), movedN: on.filter((g) => g.moved).length }; };
  let { dropN, movedN } = counts();
  dlg.innerHTML = `<div class="m-body-wrap"><div class="m-head"><h2 tabindex="-1" autofocus>${L('중복 작품 합치기')}</h2><button type="button" class="close" data-close aria-label="${L('닫기')}">×</button></div>
    <div class="m-body">${groups.length ? `<div class="rc-sum">${L('같은 코드 {g}묶음 · 지울 중복 {d}개 · 구매 정보 옮김 {m}개', { g: groups.length.toLocaleString(), d: dropN.toLocaleString(), m: movedN.toLocaleString() })}</div>
      <p class="note">${L('감상·별점·노션 연결이 있는 쪽을 남겨요. 제목이 다른 묶음은 코드가 잘못 들어갔을 수 있어서 체크하지 않았어요. 지운 중복은 설정 → 백업 → 되돌리기에서 되살릴 수 있어요.')}</p>
      <div class="set-group">${groups.map((g, gi) => `<label class="set-item dup-row"><input type="checkbox" data-dup="${gi}"${g.on ? ' checked' : ''}><div class="si-label">${esc(displayTitle(g.keep).slice(0, 40))}<small>${esc(g.code)} · ${L('중복')} ${g.drop.length}${L('개')}${g.moved ? ` · <b class="dup-moved">${L('구매 정보 옮김')}</b>` : ''}${g.sameTitle ? '' : ` · <b class="dup-warn">${L('제목이 달라요')}: ${esc(String(g.drop[0].title || '').slice(0, 30))}</b>`}</small></div></label>`).join('')}</div>`
      : `<p class="note">${L('같은 작품 코드로 두 번 들어간 작품이 없어요.')}</p>`}</div>
    <div class="m-foot"><span class="dup-state muted"></span><span class="spacer"></span>${groups.length ? `<button type="button" class="primary-btn" id="dupGo">${L('{n}개 합치기', { n: dropN.toLocaleString() })}</button>` : ''}</div></div>`;
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  const go = dlg.querySelector('#dupGo');
  dlg.addEventListener('change', (e) => {
    const c = e.target.closest('[data-dup]'); if (!c) return;
    groups[c.dataset.dup].on = c.checked;
    ({ dropN, movedN } = counts());
    go.textContent = L('{n}개 합치기', { n: dropN.toLocaleString() }); go.disabled = !dropN;
    dlg.querySelector('.rc-sum').textContent = L('같은 코드 {g}묶음 · 지울 중복 {d}개 · 구매 정보 옮김 {m}개', { g: groups.length.toLocaleString(), d: dropN.toLocaleString(), m: movedN.toLocaleString() });
  });
  if (go) go.onclick = async () => {
    go.disabled = true;
    const st = dlg.querySelector('.dup-state');
    let i = 0;
    try {
      const todo = groups.filter((g) => g.on);
      for (const g of todo) {
        st.textContent = `${++i}/${todo.length}`;
        if (Object.keys(g.patch).length) await api('api/works/' + encodeURIComponent(g.keep.id), { method: 'PATCH', body: g.patch });
        for (const d of g.drop) await api('api/works/' + encodeURIComponent(d.id), { method: 'DELETE' });
      }
      dlg.close();
      toast(L('중복 {d}개를 합쳤어요. 구매 정보 옮김 {m}개', { d: dropN.toLocaleString(), m: movedN.toLocaleString() }));
    } catch (e) { fail(e); go.disabled = false; }
    await load();
  };
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

let currentList = [];
function renderList() {
  const homeMode = isHome();
  $('home').hidden = !homeMode;
  document.body.classList.toggle('home-mode', homeMode);
  if (homeMode) { $('stats').hidden = true; $('list').hidden = true; $('listMore').hidden = true; renderHome(); return; }
  const statsMode = S.nav === 'stats';
  $('stats').hidden = !statsMode;
  $('list').hidden = statsMode;
  $('listMore').hidden = statsMode;
  document.querySelector('.filters').hidden = statsMode;
  $('search').closest('.search-row').hidden = statsMode;
  $('navChips').hidden = statsMode;
  $('main').classList.toggle('stats-mode', statsMode);
  document.body.classList.toggle('has-q', !!S.q.trim());
  if (statsMode) { $('viewTitle').textContent = menuText('stats-title'); $('viewCount').textContent = ''; renderStats(); return; }
  currentList = filtered();
  $('viewTitle').textContent = navLabel(S.nav);
  $('viewCount').textContent = currentList.length.toLocaleString();
  const activeCount = [S.actor, S.circle, S.tag, S.rating, S.wt].filter((v) => v !== '').length;
  const active = !!S.q || activeCount > 0;
  $('resetFilters').hidden = !active;
  $('filterBtn').textContent = activeCount ? `${L("필터")} ${activeCount}` : L('필터');
  $('filterBtn').classList.toggle('on', activeCount > 0);
  const optN = activeCount;
  $('viewOptBadge').hidden = !optN; $('viewOptBadge').textContent = optN || '';
  $('viewOptBtn').classList.toggle('on', optN > 0);
  for (const [id, v] of [['fActor', S.actor], ['fCircle', S.circle], ['fTag', S.tag], ['fRating', S.rating], ['fWorkType', S.wt]]) $(id).classList.toggle('on', v !== '');
  const list = $('list');
  list.className = 'list' + (S.view === 'grid' ? ' grid' : ' mode-' + S.listMode);
  if (!currentList.length) {
    list.innerHTML = '';
    $('listMore').innerHTML = active
      ? `<div class="empty"><strong>${L("찾는 작품이 없어요")}</strong>${L("검색어나 필터를 바꿔 보세요.")}</div>`
      : `<div class="empty"><strong>${L("아직 작품이 없어요")}</strong>${L("오른쪽 위 '작품 추가'로 시작해 보세요.")}</div>`;
    return;
  }
  list.innerHTML = (S.view !== 'grid' && S.listMode === 'table' ? tableHead() : '') + currentList.slice(0, S.shown).map(itemHtml).join('');
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
  if (S.selectMode) { const r = e.target.closest('.row'); if (r) { e.preventDefault(); togglePick(r.dataset.id, r); } return; }
  if (e.target.closest('select')) return;
  const q = e.target.closest('[data-quick="fav"]');
  const r = e.target.closest('.row');
  if (!r) return;
  if (q) { const w = S.works.find((x) => x.id === r.dataset.id); if (w) save(w.id, { favorite: !w.favorite }); return; }
  const qs = e.target.closest('[data-qstar]');
  if (qs) { const w = S.works.find((x) => x.id === r.dataset.id); const n = Number(qs.dataset.qstar); if (w) save(w.id, { rating: n === w.rating ? 0 : n }); return; }
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
for (const [id, key] of [['fActor', 'actor'], ['fCircle', 'circle'], ['fTag', 'tag'], ['fRating', 'rating'], ['fWorkType', 'wt'], ['fSort', 'sort']]) {
  $(id).addEventListener('change', (e) => { S[key] = e.target.value; S.shown = 60; renderList(); });
}
function resetFilters() {
  Object.assign(S, { q: '', actor: '', circle: '', tag: '', rating: '', wt: '', shown: 60 });
  $('fWorkType').value = '';
  $('search').value = '';
  fillFilterOptions();
  $('fRating').value = '';
  renderNav();
  renderList();
}
$('resetFilters').onclick = resetFilters;

// 좁은 창: 필터·정렬·보기 형식·숨김·표지 가리기를 오른쪽 위 버튼 하나로 모아요.
const FILTER_IDS = ['fActor', 'fCircle', 'fTag', 'fRating'];
function openViewSheet() {
  const dlg = $('filterSheet');
  const sw = (key, on, label) => `<button type="button" class="opt-row" data-opt="${key}" role="switch" aria-checked="${on}"><span>${label}</span><span class="switch${on ? ' on' : ''}"></span></button>`;
  dlg.innerHTML = `<div class="m-body-wrap"><div class="m-head"><h2>${L("필터")}</h2><button type="button" class="close" data-close aria-label="${L("닫기")}">×</button></div>
    <div class="m-body view-sheet">
      <div class="opt-sec"><div class="opt-label">${L("정렬")}</div><div class="opt-sort"></div></div>
      <div class="opt-sec"><div class="opt-label">${L("구분")}</div><div class="seg opt-wt">${[['', L('전체')], ['동인', L('동인')], ['상업', L('상업')]].map(([v, l]) => `<button type="button" data-wt="${v}" class="${S.wt === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="opt-sec"><div class="opt-label">${L("필터")}</div><div class="filter-body"></div></div>
      <div class="opt-sec opt-switches">${sw('blur', S.coverBlur, L('표지 가리기'))}</div>
      <div class="opt-sec"><button type="button" class="ghost-btn opt-select" id="sheetSelect">${L('여러 개 선택해서 지우기·숨기기')}</button></div>
    </div>
    <div class="m-foot"><button type="button" class="link-btn" id="sheetReset">${L("초기화")}</button><span class="spacer"></span><button type="button" class="primary-btn" data-close>${L("적용")}</button></div></div>`;
  const moved = [...FILTER_IDS, 'fSort'].map((id) => { const el = $(id); return [el, el.parentNode, el.nextSibling]; });
  const body = dlg.querySelector('.filter-body');
  for (const id of FILTER_IDS) body.appendChild($(id));
  dlg.querySelector('.opt-sort').appendChild($('fSort'));
  dlg.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dlg.close()));
  dlg.querySelector('.opt-switches').onclick = (e) => {
    const b = e.target.closest('[data-opt]'); if (!b) return;
    if (b.dataset.opt === 'hidden') { S.showHidden = !S.showHidden; rememberView(); renderViewTools(); renderNav(); renderList(); }
    else setCoverBlur(!S.coverBlur);
    const on = b.dataset.opt === 'hidden' ? S.showHidden : S.coverBlur;
    b.setAttribute('aria-checked', String(on)); b.querySelector('.switch').classList.toggle('on', on);
  };
  dlg.querySelector('.opt-wt').onclick = (e) => { const b = e.target.closest('[data-wt]'); if (!b) return; S.wt = b.dataset.wt; $('fWorkType').value = S.wt; S.shown = 60; renderList(); dlg.querySelectorAll('.opt-wt button').forEach((x) => x.classList.toggle('on', x === b)); };
  $('sheetSelect').onclick = () => { dlg.close(); startSelect(); };
  $('sheetReset').onclick = () => { resetFilters(); dlg.querySelectorAll('.opt-wt button').forEach((x) => x.classList.toggle('on', x.dataset.wt === '')); };
  dlg.onclose = () => { for (const [el, parent, next] of moved.reverse()) parent.insertBefore(el, next && next.parentNode === parent ? next : null); };
  dlg.showModal();
}
$('filterBtn').onclick = openViewSheet;
$('viewOptBtn').onclick = openViewSheet;

// 보기 형식(목록/표지)과 숨긴 작품 보기
function renderViewTools() {
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === S.view));
  $('toggleHidden').classList.toggle('on', S.showHidden);
  $('hdHidden').classList.toggle('on', S.showHidden);
  $('hdHidden').setAttribute('aria-pressed', String(S.showHidden));
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
$('hdHidden').onclick = () => $('toggleHidden').click();
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
  if (S.selected !== id) S.tagsOpen = false;
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
  updateToTop();
}
function closeDetail() {
  if (S.solo) { window.close(); return; }
  $('detail').hidden = true;
  S.selected = null;
  S.detail = null;
  document.querySelectorAll('.row.on').forEach((r) => r.classList.remove('on'));
  layoutPanel();
  updateToTop();
}
// 창(설정·편집·필터·크게 보기 등): 폰의 뒤로 가기 동작으로도 닫히게 기록을 하나 남겨요.
// 열 때 X 버튼에 파란 테두리가 생기지 않게 처음 초점은 창 자체에 둬요.
let skipPop = false;
let modalSeq = 0;
const openDialogs = () => [...document.querySelectorAll('dialog[open]')];
const showModalOrig = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal = function () {
  showModalOrig.call(this);
  if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '-1');
  const f = document.activeElement;
  if (!f || f === document.body || f.matches('.close, [data-close], .m-head button, .lb-nav button')) this.focus({ preventScroll: true });
  if (isNarrow()) {
    const token = ++modalSeq;
    history.pushState({ vbModal: token }, '');
    this.addEventListener('close', () => { if (history.state?.vbModal === token) { skipPop = true; history.back(); } }, { once: true });
  }
};
window.addEventListener('popstate', (e) => {
  if (skipPop) { skipPop = false; e.stopImmediatePropagation(); return; }
  const top = openDialogs().pop();
  if (!top) {
    // 검색 화면: 상세가 열려 있지 않으면 뒤로 가기로 검색을 닫아요.
    if (S.searching && $('detail').hidden) { e.stopImmediatePropagation(); exitSearch(); }
    return;
  }
  e.stopImmediatePropagation();
  const btn = top.querySelector('.m-head [data-close], .m-head .close, [data-close]');
  if (btn) btn.click(); else top.close();
  if (top.open) history.pushState({ vbModal: ++modalSeq }, '');
});
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

// 제목 뒤에 붙은 해시태그(#…)는 따로 작게 보여요.
function splitTitle(t) {
  const m = String(t).match(/^(.*?\S)\s*((?:#[^\s#]+\s*){1,})$/s);
  return m && m[1].length > 4 ? [m[1], m[2].trim()] : [t, ''];
}
const TAG_SHOW = 5;
function openActions(items) {
  const dlg = $('actSheet');
  dlg.innerHTML = `<div class="as-list">${items.map((it, i) => it.href ? `<a class="as-item" href="${esc(it.href)}" target="_blank" rel="noopener">${esc(it.label)}</a>` : `<button type="button" class="as-item${it.danger ? ' danger' : ''}" data-i="${i}">${esc(it.label)}</button>`).join('')}</div><button type="button" class="as-item as-cancel" data-close>${L("취소")}</button>`;
  dlg.onclick = (e) => {
    if (e.target === dlg || e.target.closest('[data-close]') || e.target.closest('a.as-item')) { dlg.close(); return; }
    const b = e.target.closest('[data-i]'); if (!b) return;
    dlg.close(); items[Number(b.dataset.i)].run();
  };
  dlg.showModal();
}
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
  else if (!hasT && !hasP) introBody = `<p class="muted">${L("소개글이 없어요.")}</p>`;
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
        <button type="button" class="icon-btn d-more" data-act="more" aria-label="${L("더 보기")}" title="${L("더 보기")}"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>
      </div>
    </div>
    <div class="d-hero">
      ${w.images?.[0] ? `<img class="d-cover" src="${esc(w.images[0])}" alt="${L("표지")}" referrerpolicy="no-referrer" data-act="zoom" data-i="0" data-ph="${esc(w.code)}" data-color="${placeholderColor(w.id)}">` : `<div class="d-cover ph" style="background:${placeholderColor(w.id)}">${esc(w.code)}</div>`}
      <div class="d-titles">
        <div class="d-meta-top">${esc([w.circle, w.date].filter(Boolean).join(' · '))}</div>
        ${(() => { const [main, tail] = splitTitle(displayTitle(w)); return `<h2 class="d-title">${esc(main)}</h2>${tail ? `<div class="d-hash">${esc(tail)}</div>` : ''}`; })()}
        ${w.titleKo && w.title ? `<div class="d-orig">${esc(w.title)}</div>` : ''}
      </div>
    </div>
    <div class="chips">
      ${actors.map((a) => `<button type="button" class="chip chip-name" data-filter="actor" data-v="${esc(a)}" title="${L("이 성우 작품 보기")}">${nameHtml(a)}</button>`).join('')}
      ${splitNames(w.circle).map((c) => `<button type="button" class="chip" data-filter="circle" data-v="${esc(c)}" title="${L("이 서클 작품 보기")}">${esc(c)}</button>`).join('')}
      ${w.code ? `<span class="chip">${esc(w.code)}</span>` : ''}
      ${w.noStats ? `<span class="chip chip-nostats">${L('통계 제외')}</span>` : ''}
      ${w.workType ? `<button type="button" class="chip chip-wt" data-filter="wt" data-v="${esc(w.workType)}" title="${L("이 구분의 작품 보기")}">${L(w.workType)}</button>` : ''}
      ${w.tags.map((t, i) => `<button type="button" class="chip tag${i >= TAG_SHOW && !S.tagsOpen ? ' more-hide' : ''}" data-filter="tag" data-v="${esc(t)}">${esc(t)}</button>`).join('')}
      ${w.tags.length > TAG_SHOW && !S.tagsOpen ? `<button type="button" class="chip chip-more" data-act="tagsopen">+${w.tags.length - TAG_SHOW}</button>` : ''}
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
        <label class="played-date${status !== '청취 완료' && !w.lastPlayed ? ' quiet' : ''}">${L("청취일")} <input type="date" value="${esc(w.lastPlayed)}" data-act="played" aria-label="${L("마지막 청취일")}"></label>
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

// ===== 묶음 구매: 같이 산 작품을 묶고, 결제한 금액을 한 번만 적어요 =====
function splitTotal(total, n, cur) {
  // 똑같이 나누고 남는 끝전은 앞 작품부터 1씩 더해서, 합계가 결제 금액과 딱 맞게 해요.
  const unit = intCur(cur) ? 1 : 100;
  const t = Math.round(total * unit), base = Math.floor(t / n), rest = t - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < rest ? 1 : 0)) / unit);
}
function openOrder(id) {
  const first = S.works.find((w) => w.id === id);
  if (!first) return;
  if (first.orderNo) return openReceiptOrder(first);
  const orderId = first.orderId || '';
  const before = orderId ? S.works.filter((w) => w.orderId === orderId) : [first];
  let members = before.map((w) => ({ id: w.id, title: displayTitle(w), list: w.listPrice, sale: w.salePrice }));
  const st = {
    date: first.purchaseDate || today(), store: first.store || '', cur: first.currency || 'JPY',
    type: first.orderType || (orderId ? '' : 'bundle'), value: first.orderValue ?? '', memo: orderId ? first.couponMemo || '' : '',
    total: first.orderTotal ?? '', manual: orderId ? !!first.paidManual : false, q: '',
  };
  const dlg = document.createElement('dialog');
  dlg.className = 'modal order-dlg';
  document.body.appendChild(dlg);
  const auto = () => {
    const sum = members.reduce((a, m) => a + (numOf(m.sale) ?? numOf(m.list) ?? 0), 0);
    return st.type === 'bundle' ? numOf(st.value) : applyCoupon(sum, st.type, st.value, st.cur);
  };
  const totalNow = () => (st.manual ? numOf(st.total) : auto());
  const render = () => {
    const listSum = members.reduce((a, m) => a + (numOf(m.list) ?? 0), 0);
    const total = totalNow();
    const shares = total != null && members.length ? splitTotal(total, members.length, st.cur) : [];
    const k = nameKey(st.q);
    const found = st.q.trim() ? S.works.filter((w) => !members.some((m) => m.id === w.id) && nameKey([w.title, w.titleKo, w.code].join(' ')).includes(k)).slice(0, 6) : [];
    dlg.innerHTML = `<div class="m-body-wrap"><div class="m-head"><h2 tabindex="-1" autofocus>${L('묶음 구매')}</h2><button type="button" class="close" data-close aria-label="${L('닫기')}">×</button></div>
      <div class="m-body">
        <div class="grid2"><label class="field">${L('구매일')}<input type="date" id="odDate" value="${esc(st.date)}"></label><label class="field">${L('구매처')}<input id="odStore" value="${esc(st.store)}" list="storeList2"></label></div>
        <datalist id="storeList2">${[...new Set([...STORE_DEFAULTS, ...S.works.map((w) => w.store).filter(Boolean)])].map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
        <div class="field">${L('같이 산 작품')} ${members.length}${L('개')}</div>
        <div class="od-list">${members.map((m, i) => `<div class="od-row"><span class="od-title">${esc(m.title)}</span>
            <input class="input od-list-price" data-i="${i}" inputmode="decimal" value="${m.list ?? ''}" placeholder="${L('정가')}" aria-label="${L('정가')}">
            <span class="od-share">${shares[i] != null ? esc(money(shares[i], st.cur)) : '–'}</span>
            <button type="button" class="od-rm" data-rm="${i}" aria-label="${L('빼기')}">×</button></div>`).join('')}</div>
        <div class="od-add"><input class="input" id="odSearch" placeholder="${L('작품 더하기 · 제목이나 코드로 찾기')}" value="${esc(st.q)}" autocomplete="off">
          ${found.map((w) => `<button type="button" class="od-found" data-add="${esc(w.id)}">+ ${esc(displayTitle(w))}${w.orderId ? ` <small>(${L('다른 묶음')})</small>` : ''}</button>`).join('')}</div>
        <div class="field">${L('할인 방식')}<div class="seg od-seg">${[['', L('없음')], ['pct', L('% 쿠폰')], ['yen', L('금액 쿠폰')], ['bundle', L('묶음가')]].map(([v, l]) => `<button type="button" data-ot="${v}" class="${st.type === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        ${st.type ? `<div class="grid2"><label class="field">${st.type === 'pct' ? L('할인율 (%)') : st.type === 'yen' ? L('쿠폰 금액') : L('묶음 가격')}<input id="odValue" inputmode="decimal" value="${esc(st.value)}" placeholder="${st.type === 'pct' ? '30' : st.type === 'yen' ? '200' : '999'}"></label><label class="field">${L('메모')}<input id="odMemo" value="${esc(st.memo)}" placeholder="${L('3개 999엔 이벤트')}"></label></div>` : ''}
        <div class="field">${L('최종 구매금 (결제 금액)')}<div class="final-row"><input id="odTotal" inputmode="decimal" value="${total ?? ''}"><span class="final-mode">${st.manual ? `${L('직접 입력')} · <button type="button" class="link-btn" id="odAuto">${L('자동 계산으로')}</button>` : L('자동 계산')}</span></div></div>
        <div class="calc-line">${L('정가 합계')} ${money(listSum, st.cur)} → <strong>${money(total ?? 0, st.cur)}</strong>${listSum > (total ?? 0) ? ` <span class="buy-off">(${money(listSum - (total ?? 0), st.cur)} ${L('아낌')})</span>` : ''}<br><span class="muted">${L('작품마다 똑같이 나눠요. 끝전은 앞 작품부터 더해요.')}</span></div>
      </div>
      <div class="m-foot">${orderId ? `<button type="button" class="link-btn danger-link" id="odBreak">${L('묶음 풀기')}</button>` : ''}<span class="spacer"></span><button type="button" class="primary-btn" id="odSave">${L('저장')}</button></div></div>`;
  };
  const readInputs = () => {
    st.date = $('odDate')?.value || st.date; st.store = $('odStore')?.value.trim() ?? st.store;
    if ($('odValue')) st.value = $('odValue').value.trim();
    if ($('odMemo')) st.memo = $('odMemo').value.trim();
    dlg.querySelectorAll('.od-list-price').forEach((x) => { members[Number(x.dataset.i)].list = x.value.trim(); });
  };
  const rerender = (focusId) => { const pos = dlg.querySelector('.m-body')?.scrollTop || 0; const sel = document.activeElement?.id === focusId ? document.activeElement.selectionStart : null; render(); dlg.querySelector('.m-body').scrollTop = pos; if (focusId && $(focusId)) { $(focusId).focus(); if (sel != null) try { $(focusId).setSelectionRange(sel, sel); } catch {} } };
  dlg.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.matches('[data-close]')) return dlg.close();
    readInputs();
    if (t.dataset.rm != null) { members.splice(Number(t.dataset.rm), 1); return rerender(); }
    if (t.dataset.add) { const w = S.works.find((x) => x.id === t.dataset.add); if (w) members.push({ id: w.id, title: displayTitle(w), list: w.listPrice, sale: w.salePrice }); st.q = ''; return rerender('odSearch'); }
    if (t.dataset.ot != null) { st.type = t.dataset.ot; return rerender(); }
    if (t.id === 'odAuto') { st.manual = false; return rerender(); }
    if (t.id === 'odBreak') return breakOrder();
    if (t.id === 'odSave') return saveOrder();
  });
  dlg.addEventListener('input', (e) => {
    const id = e.target.id;
    if (id === 'odSearch') { st.q = e.target.value; return rerender('odSearch'); }
    if (id === 'odTotal') { st.manual = true; st.total = e.target.value; const sh = dlg.querySelectorAll('.od-share'); const tot = numOf(st.total); const parts = tot != null ? splitTotal(tot, members.length, st.cur) : []; sh.forEach((x, i) => { x.textContent = parts[i] != null ? money(parts[i], st.cur) : '–'; }); dlg.querySelector('.final-mode').innerHTML = `${L('직접 입력')} · <button type="button" class="link-btn" id="odAuto">${L('자동 계산으로')}</button>`; return; }
    if (id === 'odValue' || e.target.classList.contains('od-list-price')) { readInputs(); if (!st.manual) { const t = auto(); $('odTotal').value = t ?? ''; const parts = t != null ? splitTotal(t, members.length, st.cur) : []; dlg.querySelectorAll('.od-share').forEach((x, i) => { x.textContent = parts[i] != null ? money(parts[i], st.cur) : '–'; }); } }
  });
  async function saveOrder() {
    readInputs();
    const total = totalNow();
    if (members.length < 2) return toast(L('같이 산 작품을 하나 더 더해 주세요.'), true);
    if (total == null) return toast(L('최종 구매금을 넣어 주세요.'), true);
    const oid = orderId || 'o-' + (crypto.randomUUID?.() || Date.now().toString(36));
    const shares = splitTotal(total, members.length, st.cur);
    const common = { orderId: oid, orderType: st.type, orderValue: st.type ? numOf(st.value) : null, orderTotal: total, orderCount: members.length, couponMemo: st.memo, purchaseDate: st.date, store: st.store, currency: st.cur === 'JPY' ? '' : st.cur, couponType: '', couponValue: null, paidManual: st.manual };
    common.discountNote = discountNote({ ...common, currency: st.cur });
    $('odSave').disabled = true;
    try {
      for (let i = 0; i < members.length; i++) await api('api/works/' + encodeURIComponent(members[i].id), { method: 'PATCH', body: { ...common, listPrice: members[i].list, paidPrice: shares[i] } });
      for (const w of before) if (!members.some((m) => m.id === w.id)) await api('api/works/' + encodeURIComponent(w.id), { method: 'PATCH', body: { orderId: '', orderType: '', orderValue: null, orderTotal: null, orderCount: 0, discountNote: '' } });
      await load();
      dlg.close();
      toast(L('묶음 {n}개를 저장했어요.', { n: members.length }));
      if (S.selected) select(S.selected, { push: false });
    } catch (e) { fail(e); $('odSave').disabled = false; }
  }
  async function breakOrder() {
    if (!confirm(L('묶음을 풀까요? 작품마다 나눠진 구매가는 그대로 남아요.'))) return;
    try {
      for (const w of before) await api('api/works/' + encodeURIComponent(w.id), { method: 'PATCH', body: { orderId: '', orderType: '', orderValue: null, orderTotal: null, orderCount: 0, discountNote: '', paidManual: true } });
      await load(); dlg.close(); if (S.selected) select(S.selected, { push: false });
    } catch (e) { fail(e); }
  }
  dlg.addEventListener('close', () => dlg.remove());
  render();
  dlg.showModal();
}

function purchaseHtml(w) {
  const paid = w.paidPrice ?? w.listPrice;
  if (!w.purchaseDate && !w.store && paid == null) return `<div class="buy-line empty"><button type="button" class="link-btn" data-act="edit">${L("+ 구매 정보 넣기")}</button></div>`;
  const off = w.listPrice && w.paidPrice != null && w.paidPrice < w.listPrice ? Math.round((1 - w.paidPrice / w.listPrice) * 100) : 0;
  const cur = w.currency;
  const strike = w.listPrice != null && paid != null && paid < w.listPrice ? `<s class="buy-strike">${esc(money(w.listPrice, cur))}</s>` : '';
  const tag = (w.orderId
    ? `<button type="button" class="chip chip-order" data-act="order">${L('묶음')} ${w.orderCount || ''}${L('개')} ${esc(money(w.orderTotal, cur))}</button>` : '')
    + (w.orderId && !w.orderNo ? '' : [w.salePrice != null && w.salePrice !== w.listPrice ? `<span class="chip chip-sale">${L('할인가')} ${esc(money(w.salePrice, cur))}</span>` : '', w.couponType && w.couponValue ? `<span class="chip chip-cp">${w.couponType === 'pct' ? `${w.couponValue}% ${L('쿠폰')}` : `${esc(money(w.couponValue, cur))} ${L('쿠폰')}`}</span>` : ''].join(''));
  return `<div class="buy-line"><span class="rec-label">${L("구매")}</span>
    ${w.purchaseDate ? `<span>${esc(w.purchaseDate)}</span>` : ''}
    ${w.store ? `<span class="chip">${esc(w.store)}</span>` : ''}
    ${strike}${strike ? '<span class="buy-arrow">→</span>' : ''}${paid != null ? `<strong>${esc(money(paid, cur))}</strong>` : ''}
    ${tag}
    ${off ? `<span class="buy-off">${off}${L("% 할인")}</span>` : ''}
    ${w.couponMemo ? `<span class="buy-memo">${esc(w.couponMemo)}</span>` : ''}</div>`;
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
    if (t.dataset.filter === 'wt') $('fWorkType').value = t.dataset.v;
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
      if (!confirm(L('대표 리뷰카드를 뺄까요?'))) return;
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
        toast(L("목록에서 숨겼어요."));
      } else toast(hide ? L('숨겼어요.') : L('다시 목록에 보여요.'));
      return;
    }
    case 'edit': return openEditor(w);
    case 'tagsopen': S.tagsOpen = true; return renderDetail();
    case 'order': return openOrder(w.id);
    case 'more': return openActions([
      { label: L('정보 수정'), run: () => openEditor(w) },
      { label: w.hidden ? L('숨김 해제') : L('목록에서 숨기기'), run: () => $('detail').querySelector('[data-act="hide"]').click() },
      { label: w.noStats ? L('통계에 다시 넣기') : L('통계에서 빼기'), run: async () => { await save(w.id, { noStats: !w.noStats }); toast(w.noStats ? L('통계에 다시 넣었어요.') : L('통계에서 뺐어요. 지출 통계에는 그대로 있어요.')); } },
      ...(w.url ? [{ label: L('판매 페이지 ↗'), href: w.url }] : []),
      { label: L('수정 이력'), run: () => openHistory(w.id) },
    ]);
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
    if (isHome()) renderHome();
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
  ED.actors = splitNames(ED.actor);
  // 예전에 직접 적은 구매가(쿠폰·할인가 칸이 없던 때)는 그대로 지켜요.
  if (!ED.paidManual && ED.paidPrice != null && ED.paidPrice !== '' && !ED.couponType && ED.salePrice == null && ED.paidPrice !== ED.listPrice) ED.paidManual = true;
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
        <div class="field">${L("성우")}<div class="tagbox actorbox" id="edActors"></div><input type="hidden" id="edActor" value="${esc(ED.actor)}"></div>
        <div class="grid2">
          <label class="field">${L("서클")}<input id="edCircle" value="${esc(ED.circle)}" list="circleList"></label>
          <label class="field">${L("발매일")}<input id="edDate" type="date" value="${esc(ED.date)}"></label>
          <label class="field">${L("작품 코드")}<input id="edCode" value="${esc(ED.code)}" placeholder="RJ01234567"></label>
        </div>
        <div class="field">${L("장르")}<div class="tagbox" id="edTags"></div></div>
        <div class="grid2">
          <label class="field">${L("폴더")}<select id="edFolder"><option value="">${L("폴더 없음")}</option>${S.folders.map((f) => `<option${f === ED.folder ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></label>
          <label class="field">${L("정리 상태")}<input id="edOrganize" value="${esc(ED.organize)}" list="organizeList"></label>
        </div>
        <label class="check ed-nostats"><input type="checkbox" id="edNoStats"${ED.noStats ? ' checked' : ''}>${L('통계에서 빼기')} <small class="muted">${L('작품 통계에만 해당 · 지출은 그대로')}</small></label>
        <div class="sec-label" style="margin-top:6px">${L("구매 정보")}</div>
        <div class="grid2">
          <label class="field">${L("구매처")}<input id="edStore" value="${esc(ED.store || '')}" list="storeList" placeholder="${L("DLsite, 포케도라…")}"></label>
          <div class="field">${L("구분")}<div class="seg wt-seg" id="edWorkType" role="radiogroup" aria-label="${L("구분")}">${['동인', '상업'].map((v) => `<button type="button" data-wt="${v}" class="${ED.workType === v ? 'on' : ''}">${L(v)}</button>`).join('')}</div></div>
        </div>
        <div class="grid2">
          <label class="field">${L("구매일")}<input id="edBuyDate" type="date" value="${esc(ED.purchaseDate || '')}"></label>
          <label class="field">${L("통화")}<select id="edCurrency">${[['JPY', L('¥ 엔')], ['KRW', L('₩ 원')], ['USD', L('$ 달러')]].map(([v, l]) => `<option value="${v}"${(ED.currency || 'JPY') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <div class="grid2">
          <label class="field">${L("정가")}<input id="edListPrice" inputmode="decimal" value="${ED.listPrice ?? ''}" placeholder="1650"></label>
          <label class="field">${L("할인가")}<input id="edSalePrice" inputmode="decimal" value="${ED.salePrice ?? ''}" placeholder="${L("세일 중이면")}"></label>
        </div>
        <div class="price-solo"${ED.orderId && !ED.orderNo ? ' hidden' : ''}>
          <div class="field">${L("쿠폰 · 이벤트")}<div class="seg cp-seg" id="edCoupon" role="radiogroup">${[['', L('없음')], ['pct', L('% 쿠폰')], ['yen', L('금액 쿠폰')]].map(([v, l]) => `<button type="button" data-cp="${v}" class="${(ED.couponType || '') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          <div class="grid2" id="edCouponRow"${ED.couponType ? '' : ' hidden'}>
            <label class="field"><span id="edCouponLabel">${ED.couponType === 'yen' ? L('쿠폰 금액') : L('할인율 (%)')}</span><input id="edCouponValue" inputmode="decimal" value="${ED.couponValue ?? ''}" placeholder="${ED.couponType === 'yen' ? '200' : '30'}"></label>
            <label class="field">${L("메모")}<input id="edCouponMemo" value="${esc(ED.couponMemo || '')}" placeholder="${L("가을 쿠폰")}"></label>
          </div>
          <div class="field">${L("최종 구매금")}<div class="final-row"><input id="edPaidPrice" inputmode="decimal" value="${ED.paidPrice ?? ''}" placeholder="${L("비우면 정가")}"><span class="final-mode" id="edPaidMode"></span></div></div>
          <div class="calc-line" id="edCalc"></div>
        </div>
        <div class="order-box" id="edOrderBox">${ED.orderId
          ? `<div class="order-sum"><span>${L('묶음 구매')} ${ED.orderCount || ''}${L('개')} · <strong>${esc(money(ED.orderTotal, ED.currency))}</strong> · ${L('이 작품')} ${esc(money(ED.paidPrice, ED.currency))}</span><button type="button" class="ghost-btn" id="edOrder">${L('묶음 고치기')}</button></div>`
          : `<button type="button" class="link-btn" id="edOrder">${L('+ 같이 산 작품 묶기 (묶음·세트 할인)')}</button>`}</div>
        <div class="sec-label" style="margin-top:6px">${L("이미지")}</div>
        <div class="note" id="edImgHint">${L('끌어서 순서를 바꿔요 · 첫 번째가 대표 이미지')}</div>
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
        <div class="note">${L("**굵게** · ### 제목 · * 목록 사용 가능")}</div>
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
  renderEdActors();
  renderEdImages();
  bindImageDrag();
  renderEdIntro();
  dlg.showModal();
  (isNew ? $('edUrl') : $('edTitleKo')).focus();
  bindEditor();
}
function readEdForm() {
  ED.url = normSaleUrl($('edUrl').value);
  ED.titleKo = $('edTitleKo').value.trim();
  ED.title = $('edTitle').value.trim();
  flushActorInput();
  ED.actor = ED.actors.join(', ');
  ED.circle = $('edCircle').value.trim();
  ED.date = $('edDate').value;
  ED.code = $('edCode').value.trim();
  ED.folder = $('edFolder').value;
  ED.organize = $('edOrganize').value.trim();
  ED.hidden = $('edHidden').checked;
  ED.noStats = $('edNoStats').checked;
  ED.purchaseDate = $('edBuyDate').value;
  ED.store = $('edStore').value.trim();
  ED.listPrice = $('edListPrice').value.trim();
  ED.salePrice = $('edSalePrice').value.trim();
  if (!ED.orderId || ED.orderNo) {
    ED.couponValue = ED.couponType ? $('edCouponValue').value.trim() : '';
    ED.couponMemo = ED.couponType ? $('edCouponMemo').value.trim() : '';
    ED.paidPrice = $('edPaidPrice').value.trim();
  }
  ED.currency = $('edCurrency').value === 'JPY' ? '' : $('edCurrency').value; // 엔화는 비워 둬요(기본값)
  if (!ED.orderId) ED.discountNote = discountNote(ED);
  else if (ED.orderNo && ED.discountNote) ED.discountNote = ED.discountNote.replace(/^할인가 [^·]+/, `할인가 ${money(numOf(ED.salePrice), ED.currency || 'JPY')}`);
  ED[ED.introTab] = $('edIntro').value;
}
// 동인/상업: 작품 코드와 판매 링크로 짐작 (서버의 guessWorkType과 같은 규칙)
function guessWorkType(w = {}) {
  const code = String(w.code || '').trim().toUpperCase();
  if (/^RJ\d/.test(code)) return '동인';
  if (/^(VJ|BJ)\d/.test(code)) return '상업';
  const m = String(w.url || '').match(/dlsite\.com\/([a-z-]+)\//i);
  if (!m) return '';
  const floor = m[1].toLowerCase();
  if (/^(maniax|girls|bl|home|ai)$/.test(floor)) return '동인';
  if (/(^pro$|-pro$|^soft$|^books$|^comic$|-drama$|^appx$)/.test(floor)) return '상업';
  return '';
}
function setEdWorkType(v) {
  ED.workType = v;
  document.querySelectorAll('#edWorkType [data-wt]').forEach((b) => b.classList.toggle('on', b.dataset.wt === v));
}
// 성우·서클: 이미 기록된 이름 중 한국어 읽기가 붙은 것을 찾아 자동으로 이어 붙여요. (三橋渡 → 三橋渡 미츠하시 와타루)
const nameKey = (s) => String(s || '').replace(/[\s\u3000・･·]/g, '').toLowerCase();
function knownNames(field) {
  const m = new Map();
  for (const w of S.works) for (const n of splitNames(w[field])) { const { ja, ko } = parseName(n); if (ja && ko && !m.has(nameKey(ja))) m.set(nameKey(ja), n); }
  return m;
}
function withKnownNames(list, field) {
  const m = knownNames(field);
  return list.map((n) => (parseName(n).ko ? n : m.get(nameKey(n)) || n));
}
function renderEdActors() {
  const box = $('edActors');
  box.innerHTML = ED.actors.map((a, i) => `<span class="t">${nameHtml(a)}<button type="button" data-rmactor="${i}" aria-label="${esc(a)} ${L("빼기")}">×</button></span>`).join('') +
    `<input id="edActorInput" placeholder="${ED.actors.length ? L('성우 더 넣기') : L('이름 입력 후 Enter')}" list="actorList" autocomplete="off">`;
}
function addActors(text) {
  const names = withKnownNames(splitNames(String(text).replace(/[、，/／]/g, ',')), 'actor');
  for (const n of names) if (!ED.actors.some((a) => nameKey(parseName(a).ja || a) === nameKey(parseName(n).ja || n))) ED.actors.push(n);
}
function flushActorInput() {
  const i = $('edActorInput');
  if (i && i.value.trim()) { addActors(i.value); i.value = ''; renderEdActors(); }
}
// ===== 할인가 · 쿠폰 · 최종 구매금 =====
const numOf = (v) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : null; };
const intCur = (cur) => (cur || 'JPY') !== 'USD';
// 쿠폰 적용: % 쿠폰은 할인 금액을 내림(엔·원은 1단위, 달러는 0.01)해서 빼요.
function applyCoupon(base, type, value, cur) {
  if (base == null) return null;
  const v = numOf(value);
  if (!type || !v) return base;
  if (type === 'pct') { const unit = intCur(cur) ? 1 : 100; return Math.max(0, base - Math.floor(base * v / 100 * unit) / unit); }
  if (type === 'yen') return Math.max(0, base - v);
  if (type === 'bundle') return v;
  return base;
}
function discountNote(w) {
  const cur = w.currency || 'JPY';
  const cp = (t, v) => (t === 'pct' && numOf(v) ? `${numOf(v)}% 쿠폰` : t === 'yen' && numOf(v) ? `${money(numOf(v), cur)} 쿠폰` : '');
  if (w.orderId) return [`묶음 ${w.orderCount || ''}개 ${money(numOf(w.orderTotal), cur)}`, w.orderType === 'bundle' ? '' : cp(w.orderType, w.orderValue), w.couponMemo].filter(Boolean).join(' · ');
  return [numOf(w.salePrice) != null ? `할인가 ${money(numOf(w.salePrice), cur)}` : '', cp(w.couponType, w.couponValue), w.couponMemo].filter(Boolean).join(' · ');
}
function recalcPrice() {
  if (!$('edPaidPrice') || (ED.orderId && !ED.orderNo)) return;
  const cur = $('edCurrency').value;
  const list = numOf($('edListPrice').value), sale = numOf($('edSalePrice').value);
  const base = sale ?? list;
  const auto = applyCoupon(base, ED.couponType, ED.couponType ? $('edCouponValue').value : '', cur);
  if (!ED.paidManual) $('edPaidPrice').value = auto == null || (!ED.couponType && sale == null) ? (sale ?? '') : auto;
  const paid = numOf($('edPaidPrice').value) ?? list;
  $('edPaidMode').innerHTML = ED.paidManual
    ? `${L('직접 입력')} · <button type="button" class="link-btn" id="edPaidAuto">${L('자동 계산으로')}</button>`
    : L('자동 계산');
  const steps = [];
  if (list != null) steps.push(`${L('정가')} ${money(list, cur)}`);
  if (sale != null) steps.push(`${L('할인가')} ${money(sale, cur)}`);
  const cpv = numOf($('edCouponValue')?.value);
  const cpText = ED.couponType && cpv ? (ED.couponType === 'pct' ? ` − ${cpv}% ${L('쿠폰')}` : ` − ${money(cpv, cur)} ${L('쿠폰')}`) : '';
  const saved = list != null && paid != null ? list - paid : 0;
  $('edCalc').innerHTML = paid != null && (steps.length > 1 || cpText) || ED.paidManual ? `${steps.join(' → ')}${cpText} = <strong>${money(paid, cur)}</strong>${saved > 0 ? ` <span class="buy-off">(${money(saved, cur)} ${L('아낌')})</span>` : ''}` : '';
}
function renderEdTags() {
  const box = $('edTags');
  box.innerHTML = ED.tags.map((t, i) => `<span class="t">${esc(t)}<button type="button" data-rmtag="${i}" aria-label="${esc(t)} ${L("빼기")}">×</button></span>`).join('') +
    `<input id="edTagInput" placeholder="${L("입력 후 Enter")}" list="tagList">` +
    `<datalist id="tagList">${[...new Set(S.works.flatMap((w) => w.tags))].map((t) => `<option value="${esc(t)}">`).join('')}</datalist>`;
}
function renderEdImages() {
  $('edImages').innerHTML = ED.images.map((src, i) => `<div class="it${i === 0 ? ' is-cover' : ''}" data-i="${i}">
      <img src="${esc(/^(https?:|\/|images\/|api\/|blob:)/.test(src) ? src : '')}" alt="" referrerpolicy="no-referrer" data-color="var(--chip)" draggable="false">
      ${i === 0 ? `<span class="cover-badge">★ ${L("대표")}</span>` : `<button type="button" class="cover-set" data-cover="${i}">☆ ${L("대표로")}</button>`}
      <button type="button" class="rm" data-rmimg="${i}" aria-label="${L("빼기")}">×</button>
    </div>`).join('') + `<div class="drop" id="edDrop" tabindex="0">${L("파일 선택")}<br>${L("또는 끌어다 놓기")}</div>`;
  $('edImgHint').hidden = ED.images.length < 2;
}
// 이미지 순서 바꾸기: 끌어서 옮겨요 (첫 번째가 대표 이미지). 손가락·마우스 모두 돼요.
function bindImageDrag() {
  const box = $('edImages');
  let drag = null;
  box.addEventListener('pointerdown', (e) => {
    const it = e.target.closest('.it');
    if (!it || e.target.closest('button')) return;
    drag = { it, from: Number(it.dataset.i), x: e.clientX, y: e.clientY, on: false, id: e.pointerId };
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.hypot(dx, dy) < 6) return;
      drag.on = true;
      drag.it.setPointerCapture(e.pointerId);
      drag.it.classList.add('dragging');
    }
    e.preventDefault();
    drag.it.style.transform = `translate(${dx}px, ${dy}px)`;
    const tiles = [...box.querySelectorAll('.it')];
    let to = drag.from;
    tiles.forEach((t, i) => { const r = t.getBoundingClientRect(); if (t !== drag.it && e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom) to = i; });
    tiles.forEach((t, i) => t.classList.toggle('drop-on', i === to && t !== drag.it));
    drag.to = to;
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.on) return;
    if (d.to != null && d.to !== d.from) { const [x] = ED.images.splice(d.from, 1); ED.images.splice(d.to, 0, x); }
    renderEdImages();
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
}
function renderEdIntro() {
  document.querySelectorAll('[data-edtab]').forEach((b) => b.classList.toggle('on', b.dataset.edtab === ED.introTab));
  $('edIntro').value = ED[ED.introTab] || '';
  $('edIntroLabel').textContent = ED.introTab === 'promo' ? L('판매 페이지의 소개글을 그대로 붙여넣어요') : L('번역문 · 직접 고칠 수 있어요');
}
// 판매 링크 다듬기: dlsharing.com(공유 링크)은 DLsite 주소로, 끝의 '/#…' 같은 꼬리는 떼요.
function normSaleUrl(u) {
  let v = String(u || '').trim();
  v = v.replace(/^https?:\/\/(www\.)?dlsharing\.com\//i, 'https://www.dlsite.com/');
  v = v.replace(/(\.html)\/?#.*$/i, '$1').replace(/(\.html)\/$/i, '$1');
  return v;
}
const urlCode = (u) => (String(u || '').match(/(?:RJ|BJ|VJ)\d{6,}/i) || [''])[0].toUpperCase();
function checkDuplicate() {
  const code = $('edCode').value.trim().toUpperCase();
  const url = $('edUrl').value.trim();
  const dup = S.works.find((w) => w.id !== ED.id && ((code && w.code === code) || (url && w.url === url)));
  $('edDup').hidden = !dup;
  if (dup) $('edDup').innerHTML = `${L("이미 등록된 작품일 수 있어요:")} <strong>${esc(displayTitle(dup))}</strong>`;
}
function bindEditor() {
  $('edCoupon').onclick = (e) => {
    const b = e.target.closest('[data-cp]'); if (!b) return;
    ED.couponType = b.dataset.cp;
    $('edCoupon').querySelectorAll('[data-cp]').forEach((x) => x.classList.toggle('on', x === b));
    $('edCouponRow').hidden = !ED.couponType;
    $('edCouponLabel').textContent = ED.couponType === 'yen' ? L('쿠폰 금액') : L('할인율 (%)');
    $('edCouponValue').placeholder = ED.couponType === 'yen' ? '200' : '30';
    recalcPrice();
  };
  for (const id of ['edListPrice', 'edSalePrice', 'edCouponValue', 'edCurrency']) $(id).addEventListener('input', recalcPrice);
  $('edPaidPrice').addEventListener('input', () => { ED.paidManual = true; recalcPrice(); });
  $('edOrderBox').closest('.ed-col, form, .m-body')?.addEventListener('click', (e) => { if (e.target.id === 'edPaidAuto') { ED.paidManual = false; recalcPrice(); } });
  $('edOrder').onclick = async () => {
    if (ED.isNew) return toast(L('먼저 저장한 뒤 묶을 수 있어요.'), true);
    readEdForm();
    const body = { listPrice: ED.listPrice, salePrice: ED.salePrice, purchaseDate: ED.purchaseDate, store: ED.store, currency: ED.currency };
    try { replaceWork(await api('api/works/' + encodeURIComponent(ED.id), { method: 'PATCH', body })); } catch (e) { return fail(e); }
    const id = ED.id;
    $('editor').close();
    openOrder(id);
  };
  recalcPrice();
  $('edWorkType').onclick = (e) => { const b = e.target.closest('[data-wt]'); if (b) setEdWorkType(ED.workType === b.dataset.wt ? '' : b.dataset.wt); };
  const dlg = $('editor');
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  $('edCode').addEventListener('input', checkDuplicate);
  // 링크를 바꾸면 작품 코드도 링크에 맞춰요. (코드가 비어 있거나 다를 때)
  $('edUrl').addEventListener('change', () => {
    const v = normSaleUrl($('edUrl').value);
    if (v !== $('edUrl').value.trim()) $('edUrl').value = v;
    const c = urlCode(v), cur = $('edCode').value.trim().toUpperCase();
    if (c && c !== cur) { $('edCode').value = c; if (cur) toast(L('작품 코드도 링크에 맞춰 {c}(으)로 바꿨어요.', { c })); }
    checkDuplicate();
  });
  dlg.addEventListener('click', (e) => {
    const t = e.target.closest('button, .drop');
    if (!t) return;
    if (t.dataset.rmtag) { readEdForm(); ED.tags.splice(Number(t.dataset.rmtag), 1); renderEdTags(); }
    if (t.dataset.rmactor) { ED.actors.splice(Number(t.dataset.rmactor), 1); renderEdActors(); }
    if (t.dataset.rmimg) { ED.images.splice(Number(t.dataset.rmimg), 1); renderEdImages(); }
    if (t.dataset.cover) { const [x] = ED.images.splice(Number(t.dataset.cover), 1); ED.images.unshift(x); renderEdImages(); }
    if (t.dataset.edtab) { ED[ED.introTab] = $('edIntro').value; ED.introTab = t.dataset.edtab; renderEdIntro(); }
    if (t.id === 'edDrop') $('edFile').click();
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.target.id === 'edActorInput' && (e.key === 'Enter' || e.key === ',' || e.key === '、')) {
      if (e.isComposing) return;
      e.preventDefault(); flushActorInput(); $('edActorInput').focus();
    }
    if (e.target.id === 'edActorInput' && e.key === 'Backspace' && !e.target.value && ED.actors.length) { ED.actors.pop(); renderEdActors(); $('edActorInput').focus(); }
    if (e.target.id === 'edTagInput' && (e.key === 'Enter' || e.key === ',')) {
      e.preventDefault();
      const v = e.target.value.trim().replace(/,$/, '');
      if (v && !ED.tags.includes(v)) ED.tags.push(v);
      renderEdTags();
      $('edTagInput').focus();
    }
    if (e.target.id === 'edTagInput' && e.key === 'Backspace' && !e.target.value && ED.tags.length) { ED.tags.pop(); renderEdTags(); $('edTagInput').focus(); }
  });
  dlg.addEventListener('input', (e) => {
    // 목록에서 고르면(이름 전체가 일치) 바로 칩으로
    if (e.target.id === 'edActorInput' && e.inputType !== 'insertText' && [...$('actorList').options].some((o) => o.value === e.target.value)) flushActorInput();
  });
  dlg.addEventListener('focusout', (e) => {
    if (e.target.id === 'edActorInput') flushActorInput();
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
    const url = normSaleUrl($('edUrl').value);
    if (!url) return toast(L('판매 페이지 링크를 먼저 넣어 주세요.'), true);
    $('edUrl').value = url;
    const btn = $('edFetch');
    btn.disabled = true; btn.textContent = L('가져오는 중…');
    try {
      const info = await api('api/info', { body: { url } });
      readEdForm();
      const filled = [];
      const fill = (key, el, value) => { if (value && !ED[key]) { ED[key] = value; if (el) $(el).value = value; filled.push(key); } };
      fill('title', 'edTitle', info.title);
      if (info.actor && !ED.actors.length) { addActors(info.actor); renderEdActors(); filled.push('actor'); }
      if (info.circle && !ED.circle) info.circle = withKnownNames(splitNames(info.circle), 'circle').join(', ');
      fill('circle', 'edCircle', info.circle);
      fill('date', 'edDate', info.date);
      fill('code', 'edCode', info.code);
      // 링크의 코드와 가져온 코드가 같은데 칸의 코드가 다르면, 링크 쪽이 맞아요.
      if (info.code && info.code.toUpperCase() === urlCode(url) && ED.code.toUpperCase() !== info.code.toUpperCase()) { ED.code = info.code.toUpperCase(); $('edCode').value = ED.code; filled.push('code'); }
      fill('store', 'edStore', info.store);
      if (!ED.workType) { const t = info.workType || guessWorkType({ code: ED.code || info.code, url }); if (t) { setEdWorkType(t); filled.push('workType'); } }
      if (info.listPrice && !ED.listPrice) { ED.listPrice = info.listPrice; $('edListPrice').value = info.listPrice; filled.push('listPrice'); if (info.currency) $('edCurrency').value = info.currency; recalcPrice(); }
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
    if (info.actor && !ED.actors.length) { addActors(info.actor); renderEdActors(); n++; }
    if (info.date && !ED.date) { $('edDate').value = info.date; n++; }
    toast(n ? `${n}${L("개 항목을 찾았어요.")}` : L('원문에서 새로 찾은 항목이 없어요.'));
  };
  $('edCopyReq').onclick = async () => {
    readEdForm();
    if (!ED.promo) return toast(L('일본어 원문을 먼저 넣어 주세요.'), true);
    const req = '아래 일본어 시추에이션 보이스 작품 소개를 자연스러운 한국어로 번역해 줘. 줄바꿈과 목록 구조는 유지하고, 인명은 한국어 발음 뒤에 괄호로 원문을 붙여 줘. 번역문만 답해 줘.\n\n' + ED.promo;
    try { await navigator.clipboard.writeText(req); toast(L('번역 요청을 복사했어요.')); }
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
    if (ED.isNew && !ED.workType) ED.workType = guessWorkType(ED);
    const body = { noStats: !!ED.noStats, workType: ED.workType || '', url: ED.url, titleKo: ED.titleKo, title: ED.title, actor: ED.actor, circle: ED.circle, date: ED.date, code: ED.code, tags: ED.tags, images: ED.images, promo: ED.promo, translation: ED.translation, folder: ED.folder, hidden: ED.hidden, organize: ED.organize, purchaseDate: ED.purchaseDate, store: ED.store, listPrice: ED.listPrice, paidPrice: ED.paidPrice, currency: ED.currency, salePrice: ED.salePrice, couponType: ED.couponType || '', couponValue: ED.couponValue, couponMemo: ED.couponMemo || '', paidManual: !!ED.paidManual, discountNote: ED.discountNote || '' };
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
// 별점만 ★로, 금액 같은 다른 숫자는 숫자 그대로 보여요.
const fmt = (v, key) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? L('예') : L('아니오')) : typeof v === 'number' ? (key === 'rating' ? (v ? '★'.repeat(v) : L('없음')) : v.toLocaleString()) : v) || L('(비어 있음)');
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
function diffPair(a, b, key) {
  a = String(fmt(a, key)); b = String(fmt(b, key));
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
  const rows = p.changes.map((c) => { const [lv, nv] = diffPair(c.local, c.notion, c.key); return `<div class="push-row">
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
      ${p.newPage ? `<div class="banner">${L("노션에 새 페이지를 만들어요. 넣을 항목을 고르세요.")}</div>` : ''}
      ${!p.changes.length ? `<div class="banner ok">${L("노션과 내용이 같아요. 반영할 것이 없어요.")}</div>` : ''}
      ${p.changes.some((c) => c.conflict) ? `<div class="banner warn">${L("노션에서도 바뀐 항목이 있어요. 남길 쪽을 확인하세요.")}</div>` : ''}
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
      toast([r.pushed?.length ? `${L("노션에")} ${r.pushed.length}${L("개 반영")}` : '', r.pulled?.length ? `${L("노션 값")} ${r.pulled.length}${L("개 가져옴")}` : '', r.skipped?.length ? `${L("노션에 없는 항목")} ${r.skipped.length}${L("개는 건너뜀")}` : '', r.imagesAdded ? L('이미지 {n}장 넣음', { n: r.imagesAdded }) : '', r.imagesSkipped ? L('직접 올린 이미지 {n}장은 노션에 못 넣어요', { n: r.imagesSkipped }) : ''].filter(Boolean).join(' · ') || L('완료했어요.'));
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
// ===== 내 서버 (정보 채우기 + 기기 간 동기화) =====
// 'Deploy to Cloudflare' 버튼으로 각자 자기 Cloudflare 계정에 서버를 만들어요. 개인 열쇠·주소는 앱에 들어 있지 않아요.
const DEPLOY_URL = 'https://deploy.workers.cloudflare.com/?url=https://github.com/wcoconut-design/voice-reviewcard/tree/main/vb-server';
const NEW_KEY = 'voicebox.newKey';
const SERVER_LATEST = 6;
function boxSyncText(st) {
  if (st.running) return L('동기화하는 중…');
  if (st.error) return L('동기화 오류: ') + st.error;
  if (st.lastSync) return L('마지막 동기화: ') + new Date(st.lastSync).toLocaleString(LOCALE());
  return L('아직 동기화한 적 없어요.');
}
const serverReady = (st) => (window.VB_MOBILE ? !!getRelay().url : !!st.configured);
function makeKey() {
  const b = crypto.getRandomValues(new Uint8Array(18));
  return 'vb-' + btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg || L('복사했어요.')); }
  catch { promptText(L('복사'), L('길게 눌러 복사해 주세요.'), text); }
}
function serverBlockHtml(st) {
  if (!serverReady(st)) {
    return `<div class="srv-intro"><strong>${L('내 서버로 더 편하게')}</strong>
        <span>${window.VB_MOBILE ? L('무료 Cloudflare 서버를 하나 만들면 판매 링크로 정보 자동 채우기와 기기 간 동기화를 쓸 수 있어요.') : L('폰 앱과 같은 서버를 연결하면 폰과 기록을 주고받아요.')}</span></div>
      <button type="button" class="primary-btn srv-main" id="srvGuide">${L('설정 방법 보기')}</button>
      <button type="button" class="ghost-btn srv-main" id="srvManualOpen">${L('이미 서버가 있어요 · 주소 넣기')}</button>
      <div class="srv-manual" id="srvManual" hidden>
        <input class="input" id="srvUrl" placeholder="https://voicebox-server.○○.workers.dev" autocomplete="off" autocapitalize="off" spellcheck="false">
        <div class="key-wrap"><input class="input" id="srvKey" type="password" placeholder="${L('비밀 열쇠 (VB_KEY)')}" autocomplete="new-password" autocapitalize="off" spellcheck="false"><button type="button" class="key-eye" data-eye="srvKey">${L('보기')}</button></div>
        <div class="set-row"><button type="button" class="ghost-btn" id="srvSave">${L('연결 확인')}</button></div>
        <div class="note" id="srvState"></div>
      </div>
      <div class="note">${L('없어도 앱은 그대로 다 쓸 수 있어요.')}</div>`;
  }
  const url = window.VB_MOBILE ? getRelay().url : st.url;
  const key = window.VB_MOBILE ? getRelay().key || '' : '';
  return `<div class="srv-status" id="srvStatus"><span class="muted">${L('서버 상태 확인 중…')}</span></div>
    <div class="srv-manual">
      <label class="field">${L('서버 주소')}<input class="input" id="srvUrl" value="${esc(url || '')}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label class="field">${L('비밀 열쇠 (VB_KEY)')}<div class="key-wrap"><input class="input" id="srvKey" type="password" value="${esc(key)}" placeholder="${window.VB_MOBILE ? '' : L('바꿀 때만 입력')}" autocomplete="new-password" autocapitalize="off" spellcheck="false"><button type="button" class="key-eye" data-eye="srvKey">${L('보기')}</button></div></label>
      <div class="set-row"><button type="button" class="ghost-btn" id="srvSave">${L('저장하고 연결 확인')}</button><button type="button" class="link-btn danger-link" id="srvOff">${L('연결 해제')}</button></div>
      <div class="note" id="srvState"></div>
    </div>
    <label class="check"><input type="checkbox" id="syncOn"${st.on ? ' checked' : ''}>${L('자동으로 동기화')} <small class="muted">${L('끄면 \'지금 동기화\'를 누를 때만 주고받아요')}</small></label>
    <div class="set-row"><button type="button" class="ghost-btn" id="syncNowBtn">${L('지금 동기화')}</button>${window.VB_MOBILE ? `<button type="button" class="ghost-btn" id="srvCopyKey">${L('열쇠 복사 (다른 기기용)')}</button>` : ''}</div>
    <div class="note" id="boxSyncState">${esc(boxSyncText(st))}</div>
    <div class="set-row"><button type="button" class="link-btn" id="srvGuide">${L('설정 방법 보기')}</button></div>`;
}
async function serverStatus(url) {
  const r = await fetch(url.replace(/\/+$/, '') + '/', { cache: 'no-store' });
  const j = await r.json();
  if (!j?.ok) throw new Error('bad');
  return j;
}
function statusDots(j) {
  const dot = (ok, label) => `<span class="sdot ${ok ? 'ok' : 'no'}">${ok ? '●' : '○'} ${label}</span>`;
  return [dot(true, L('서버 연결됨')), dot(j.keySet, L('열쇠')), dot(j.sync, L('동기화 저장소')), dot(j.files, L('이미지 저장소'))].join('');
}
// 주소·열쇠 확인 후 저장. 폰은 정보 채우기에도 쓰고, 동기화 저장소가 있으면 자동 동기화를 켜요.
async function connectServer(rawUrl, key, stateEl) {
  let url = rawUrl.trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//.test(url)) url = 'https://' + url;
  key = key.trim();
  const say = (t) => { if (stateEl) stateEl.innerHTML = t; };
  if (!/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)[:/])/.test(url + '/') || !key) { say(L('https로 시작하는 주소와 열쇠를 모두 넣어 주세요.')); return false; }
  say(L('확인 중…'));
  let st;
  try { st = await serverStatus(url); } catch { say(L('서버에 연결하지 못했어요. 주소를 확인해 주세요.')); return false; }
  if (!st.keySet) { say(L('서버에 VB_KEY가 아직 없어요. Cloudflare에서 열쇠를 넣었는지 확인해 주세요.')); return false; }
  try {
    const r = await fetch(url + '/info', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VB-Key': key }, body: '{}' });
    if (r.status === 401) { say(L('열쇠가 맞지 않아요.')); return false; }
  } catch { say(L('서버에 연결하지 못했어요. 주소를 확인해 주세요.')); return false; }
  if (window.VB_MOBILE) {
    try { localStorage.setItem('voicebox.relay', JSON.stringify({ url, key })); } catch {}
  } else {
    await api('api/sync/config', { body: { url, key } }).catch(fail);
  }
  try { localStorage.removeItem(NEW_KEY); } catch {}
  say('✓ ' + L('연결했어요.') + ' ' + statusDots(st) + (st.sync ? `<br>${L("동기화는 '지금 동기화'를 누를 때만 해요. 처음 동기화하기 전에 '복원용 백업 받기'를 해 두면 안전해요.")}` : ''));
  return true;
}
// 설정 방법 안내창 (A안: Deploy to Cloudflare 버튼)
function openServerGuide() {
  let key = ''; try { key = localStorage.getItem(NEW_KEY) || ''; } catch {}
  const dlg = document.createElement('dialog');
  dlg.className = 'modal srv-guide';
  const step = (n, title, body) => `<li class="sg-step"><span class="sg-num">${n}</span><div class="sg-body"><strong>${title}</strong>${body}</div></li>`;
  dlg.innerHTML = `<div class="m-body-wrap"><div class="m-head"><h2 tabindex="-1" autofocus>${L('내 서버 만들기')}</h2><span class="sg-time">${L('약 5분 · 무료')}</span><button type="button" class="close" data-close aria-label="${L('닫기')}">×</button></div>
    <div class="m-body">
      <p class="note">${L('정보 채우기와 기기 간 동기화를 한 번에 켜요. 기록은 내 계정에만 저장돼요.')}</p>
      <ol class="sg-steps">
        ${step(1, L('계정 두 개 만들기'), `<p>${L('Cloudflare와 GitHub 계정이 필요해요. 이미 있으면 넘어가요.')}</p><div class="set-row"><a class="ghost-btn" href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noopener">Cloudflare ↗</a><a class="ghost-btn" href="https://github.com/signup" target="_blank" rel="noopener">GitHub ↗</a></div>`)}
        ${step(2, L('열쇠 만들기'), `<p>${L('서버에 넣을 비밀 열쇠예요. 복사해 두세요.')}</p><div class="sg-key"><code id="sgKey">${esc(key || '—')}</code></div><div class="set-row"><button type="button" class="ghost-btn" id="sgMake">${key ? L('새로 만들기') : L('열쇠 만들기')}</button><button type="button" class="primary-btn" id="sgCopy"${key ? '' : ' hidden'}>${L('복사')}</button></div>`)}
        ${step(3, L('버튼 누르기'), `<p>${L('GitHub 연결 → 이름은 그대로 두고 → VB_KEY 칸에 열쇠 붙여넣기 → 만들고 배포하기(Create and deploy)')}</p><div class="set-row"><a class="primary-btn sg-deploy" href="${DEPLOY_URL}" target="_blank" rel="noopener">${L('Cloudflare에 서버 만들기 ↗')}</a></div><p class="muted">${L('1~2분 걸려요. 끝나면 ○○.workers.dev 주소가 나와요.')}</p>`)}
        ${step(4, L('주소를 앱에 넣기'), `<input class="input" id="sgUrl" placeholder="https://voicebox-server.○○.workers.dev" autocomplete="off" autocapitalize="off" spellcheck="false"><div class="set-row"><button type="button" class="primary-btn" id="sgConnect">${L('연결 확인')}</button></div><div class="note" id="sgState"></div>`)}
      </ol>
      <p class="note sg-more">${L('다른 기기에서는: 설정 → 고급 → 이미 서버가 있어요 → 같은 주소와 열쇠를 넣으면 돼요.')}</p>
    </div></div>`;
  document.body.appendChild(dlg);
  const setKey = (k) => { key = k; try { localStorage.setItem(NEW_KEY, k); } catch {} $('sgKey').textContent = k; $('sgCopy').hidden = false; $('sgMake').textContent = L('새로 만들기'); };
  $('sgMake').onclick = () => { if (key && !confirm(L('열쇠를 새로 만들까요? 이미 Cloudflare에 넣었다면 그 열쇠와 달라져요.'))) return; setKey(makeKey()); copyText(key, L('열쇠를 복사했어요.')); };
  $('sgCopy').onclick = () => copyText(key, L('열쇠를 복사했어요.'));
  $('sgConnect').onclick = async () => {
    if (!key) { $('sgState').textContent = L('2단계에서 열쇠를 먼저 만들어 주세요.'); return; }
    if (await connectServer($('sgUrl').value, key, $('sgState'))) setTimeout(() => { dlg.close(); if ($('settings').open) openSettings(); }, 1500);
  };
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}
async function runSyncNow(allowDelete = false) {
  const el = $('boxSyncState');
  if (el) el.textContent = L('동기화하는 중…');
  try {
    const r = await api('api/sync/run', { body: { allowDelete } });
    if (el) el.textContent = '✓ ' + L('받은 작품 {a}개 · 바뀐 작품 {b}개 · 보낸 작품 {c}개', { a: r.pulled ?? 0, b: r.changed ?? 0, c: r.pushed ?? 0 });
    if (r.changed) await load();
  } catch (e) {
    // 다른 기기에서 지운 작품이 많으면 멈추고 물어봐요.
    if (e.data?.code === 'MASS_DELETE') {
      if (el) el.textContent = L('동기화를 멈췄어요: ') + e.message;
      if (confirm(e.message + '\n\n' + L('정말 이 기기에서도 지울까요? 취소하면 아무것도 바뀌지 않아요. (지우더라도 \'되돌리기\'에서 되살릴 수 있어요)'))) return runSyncNow(true);
      return;
    }
    if (el) el.textContent = L('동기화 오류: ') + e.message;
  }
}
// ===== 되돌리기: 자동 백업(폰) · 동기화나 삭제로 지워지거나 바뀐 작품 =====
const RECOVER_LABEL = { '아이맥에서 삭제': '동기화로 지워짐', '폰에서 삭제': '동기화로 지워짐', '작품 삭제': '직접 지움', '아이맥에서 동기화': '동기화로 바뀜', '폰에서 동기화': '동기화로 바뀜', '백업 합치기 전': '백업 합치기로 바뀜', '되돌리기 전': '되돌리기 전 상태' };
async function openRecover() {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal rcv-dlg';
  document.body.appendChild(dlg);
  const when = (at) => new Date(at).toLocaleString(LOCALE(), { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  let data = { snapshots: [], groups: [] };
  const render = () => {
    const snaps = data.snapshots || [];
    const groups = (data.groups || []).filter((g) => g.restorable > 0);
    dlg.innerHTML = `<div class="m-body-wrap"><div class="m-head"><h2 tabindex="-1" autofocus>${L('되돌리기')}</h2><button type="button" class="close" data-close aria-label="${L('닫기')}">×</button></div>
      <div class="m-body">
        ${window.VB_MOBILE ? `<div class="set-group-title">${L('자동 백업 (이 기기)')}</div>
        <div class="set-group">${snaps.length ? snaps.map((sn) => `<div class="set-item rcv-row"><div class="si-label">${esc(when(sn.at))} · ${esc(L(sn.reason))}<small>${L('작품')} ${Number(sn.n).toLocaleString()}${L('개')}</small></div><button type="button" class="ghost-btn" data-snap="${esc(sn.at)}">${L('이 시점으로')}</button></div>`).join('') : `<div class="set-item"><div class="si-label"><small>${L('아직 자동 백업이 없어요.')}</small></div></div>`}</div>
        <p class="note">${L('하루 한 번, 그리고 동기화·백업 복원·초기화 전에 이 기기 안에 자동으로 저장해요. (최근 5개)')}</p>` : ''}
        <div class="set-group-title">${L('지워지거나 바뀐 작품')}</div>
        <div class="set-group">${groups.length ? groups.map((g) => `<div class="set-item rcv-row"><div class="si-label">${esc(when(g.at))} · ${esc(L(RECOVER_LABEL[g.reason] || g.reason))} <b>${g.restorable.toLocaleString()}${L('개')}</b><small>${g.sample.map((x) => esc(String(x).length > 28 ? String(x).slice(0, 28) + '…' : x)).join(' · ')}${g.restorable > g.sample.length ? ` ${L('외')} ${(g.restorable - g.sample.length).toLocaleString()}${L('개')}` : ''}</small></div><button type="button" class="ghost-btn" data-group="${esc(g.key)}">${g.kind === 'deleted' ? L('되살리기') : L('그 전으로')}</button></div>`).join('') : `<div class="set-item"><div class="si-label"><small>${L('되살릴 작품이 없어요.')}</small></div></div>`}</div>
        <p class="note">${L('되돌린 작품은 지금 고친 것으로 저장돼요. 다른 기기에도 되돌리려면 되돌린 뒤 \'지금 동기화\'를 누르세요.')}</p>
        ${window.VB_MOBILE ? `<div class="set-group-title">${L('이 기기 초기화')}</div>
        <div class="set-group set-pad"><p class="note">${L('이 기기의 작품을 모두 비우고 서버 연결도 풀어요. 다른 기기의 기록은 지워지지 않아요. 비우기 전 상태는 자동 백업에 남아요.')}</p><div class="set-row"><button type="button" class="ghost-btn danger-btn" id="rcvReset">${L('이 기기 초기화')}</button></div></div>` : ''}
      </div></div>`;
  };
  const reload = async () => { try { data = await api('api/recover'); } catch (e) { fail(e); } render(); };
  dlg.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.matches('[data-close]')) return dlg.close();
    try {
      if (t.dataset.snap) {
        const sn = data.snapshots.find((x) => x.at === t.dataset.snap);
        if (!confirm(L('{at} 상태로 되돌릴까요? 그 뒤에 새로 넣은 작품은 그대로 남아요.', { at: when(sn.at) }))) return;
        const r = await api('api/recover', { body: { snapshot: sn.at } });
        toast(L('되살린 작품 {a}개 · 되돌린 작품 {b}개', { a: r.added, b: r.updated })); await load(); await reload();
      }
      if (t.dataset.group) {
        const g = data.groups.find((x) => x.key === t.dataset.group);
        if (!confirm(g.kind === 'deleted' ? L('작품 {n}개를 되살릴까요?', { n: g.restorable }) : L('작품 {n}개를 바뀌기 전 내용으로 되돌릴까요?', { n: g.restorable }))) return;
        const r = await api('api/recover', { body: { group: g.key } });
        toast(L('되살린 작품 {a}개 · 되돌린 작품 {b}개', { a: r.added, b: r.updated })); await load(); await reload();
      }
      if (t.id === 'rcvReset') {
        if (!confirm(L('이 기기의 작품을 모두 비우고 처음 화면으로 돌아갈까요? 다른 기기의 기록은 그대로예요.'))) return;
        await api('api/reset', { body: {} });
        location.reload();
      }
    } catch (err) { fail(err); }
  });
  dlg.addEventListener('close', () => dlg.remove());
  render(); dlg.showModal();
  reload();
}
// ===== 이름 정리: 성우·서클 이름(한글 읽기)을 모든 작품에서 한 번에 바꿔요 =====
function nameStats(field) {
  const m = new Map();
  for (const w of S.works) for (const n of splitNames(w[field])) m.set(n, (m.get(n) || 0) + 1);
  return [...m].map(([name, n]) => ({ name, n, ...parseName(name) })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'ja'));
}
async function openNames(tab = 'missing') {
  let q = '';
  const done = new Map(); // 방금 바꾼 이름 → 작품 수
  const dlg = document.createElement('dialog');
  dlg.className = 'modal names-dlg';
  document.body.appendChild(dlg);
  let fix = [];
  if (!window.VB_MOBILE && S.notion?.connected) fix = (await api('api/names/notion-fix').catch(() => ({ items: [] }))).items || [];
  const field = () => (tab === 'circle' ? 'circle' : 'actor');
  const render = () => {
    const all = nameStats(field());
    const missingN = nameStats('actor').filter((x) => !x.ko).length;
    let list = tab === 'missing' ? all.filter((x) => !x.ko || done.has(x.name)) : all;
    if (q) { const k = nameKey(q); list = list.filter((x) => nameKey(x.name).includes(k)); }
    const shown = list.slice(0, 200);
    dlg.innerHTML = `<div class="m-body-wrap"><div class="m-head"><h2 tabindex="-1" autofocus>${L('이름 정리')}</h2><button type="button" class="close" data-close aria-label="${L('닫기')}">×</button></div>
      <div class="m-body">
        ${fix.length ? `<div class="nm-fix"><span>${L('노션의 성우·서클 이름 {n}개를 앱과 맞출 수 있어요.', { n: fix.length })}</span><button type="button" class="primary-btn" id="nmFix">${L('맞추기')}</button></div>` : ''}
        <div class="seg nm-tabs">${[['missing', L('한글 없음') + ' ' + missingN], ['actor', L('성우 전체')], ['circle', L('서클')]].map(([k, l]) => `<button type="button" data-nmtab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <input class="input" id="nmSearch" placeholder="${L('이름 찾기')}" value="${esc(q)}" autocomplete="off">
        <p class="note">${tab === 'missing' ? L('한글 읽기를 쓰고 Enter → 그 이름이 들어간 작품이 모두 바뀌어요.') : L('이름을 고치고 Enter → 그 이름이 들어간 작품이 모두 바뀌어요.')}</p>
        <div class="nm-list">${shown.map((x) => `<div class="nm-row" data-name="${esc(x.name)}">
            ${tab === 'missing' ? `<span class="nm-ja-cell">${esc(x.ja || x.name)}</span><input class="input nm-in" value="${esc(x.ko)}" placeholder="${L('한글 읽기')}" autocomplete="off">`
              : `<input class="input nm-in nm-full" value="${esc(x.name)}" autocomplete="off">`}
            <span class="nm-n">${done.has(x.name) ? `<span class="nm-ok">✓ ${done.get(x.name)}${L('개')}</span>` : `${L('작품')} ${x.n}`}</span>
          </div>`).join('') || `<p class="note">${tab === 'missing' ? L('한글 읽기가 없는 성우가 없어요.') : L('찾는 이름이 없어요.')}</p>`}
          ${list.length > shown.length ? `<p class="note">${L('이름 찾기로 좁혀 보세요.')} (${shown.length}/${list.length})</p>` : ''}</div>
      </div></div>`;
    dlg.querySelector('[data-close]').onclick = () => dlg.close();
  };
  const save = async (row, input) => {
    const from = row.dataset.name;
    let to = input.value.trim();
    if (tab === 'missing') { const ja = parseName(from).ja || from; to = to ? ja + ' ' + to : ja; }
    if (!to || to === from) return;
    input.disabled = true;
    try {
      const r = await api('api/names/rename', { body: { field: field(), from, to } });
      done.set(to, r.count);
      if (r.notionNote) toast(L('노션 이름은 바꾸지 못했어요: ') + r.notionNote, true);
      await load();
      const pos = dlg.querySelector('.m-body').scrollTop;
      render(); dlg.querySelector('.m-body').scrollTop = pos;
      const next = dlg.querySelector(`.nm-row[data-name="${CSS.escape(to)}"]`)?.nextElementSibling?.querySelector('.nm-in');
      next?.focus();
    } catch (e) { fail(e); input.disabled = false; }
  };
  dlg.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-nmtab]');
    if (t) { tab = t.dataset.nmtab; render(); return; }
    if (e.target.id === 'nmFix') {
      e.target.disabled = true;
      try { const r = await api('api/names/notion-fix', { body: {} }); toast(L('노션 이름 {n}개를 맞췄어요.', { n: r.fixed })); fix = []; render(); } catch (err) { fail(err); }
    }
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || !e.target.classList.contains('nm-in')) return;
    e.preventDefault(); save(e.target.closest('.nm-row'), e.target);
  });
  dlg.addEventListener('focusout', (e) => { if (e.target.classList?.contains('nm-in') && !e.target.disabled) { const row = e.target.closest('.nm-row'); const cur = tab === 'missing' ? parseName(row.dataset.name).ko : row.dataset.name; if (e.target.value.trim() && e.target.value.trim() !== cur) save(row, e.target); } });
  let st;
  dlg.addEventListener('input', (e) => { if (e.target.id !== 'nmSearch') return; clearTimeout(st); st = setTimeout(() => { q = e.target.value; const pos = e.target.selectionStart; render(); const i = $('nmSearch'); i.focus(); i.setSelectionRange(pos, pos); }, 200); });
  dlg.addEventListener('close', () => { dlg.remove(); renderList(); if (S.detail) renderDetail(); });
  render();
  dlg.showModal();
}
// ===== 영수증 메일 가져오기 (DLsite 월별 구매 명세) =====
const yenNum = (s) => Number(String(s || '').replace(/[^\d]/g, '')) || 0;
// 메일 본문 → 주문 목록. 표가 탭·띄어쓰기·줄바꿈 어느 쪽으로 복사돼도 읽어요.
function parseReceipts(text) {
  const src = String(text || '').replace(/\r/g, '').replace(/ /g, ' ');
  const starts = [...src.matchAll(/注文番号\s*[：:]\s*([A-Z0-9]+)/g)];
  const orders = [];
  starts.forEach((m, i) => {
    const block = src.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : src.length);
    const o = { orderNo: m[1], date: '', items: [], subtotal: 0, points: 0, coupon: 0, total: 0, pointAmount: 0 };
    const d = block.match(/購入日時\s*[：:]\s*(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/);
    if (d) o.date = `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}`;
    o.kind = /ポイント購入\s*[\d,]+\s*ポイント/.test(block) || /^BPT/.test(o.orderNo) ? 'points' : 'works';
    for (const it of block.matchAll(/(?:^|\n)\s*\d+\s+((?:RJ|VJ|BJ)\d{6,8})\s+([\s\S]*?)\s*[¥￥]\s*([\d,]+)\s*(?=\n|$)/gi)) {
      o.items.push({ code: it[1].toUpperCase(), title: it[2].replace(/\s+/g, ' ').trim(), price: yenNum(it[3]) });
    }
    const pa = block.match(/ポイント購入\s*([\d,]+)\s*ポイント\s*[¥￥]\s*([\d,]+)/);
    if (pa) o.pointAmount = yenNum(pa[2]);
    const num = (re) => { const x = block.match(re); return x ? yenNum(x[1]) : 0; };
    o.subtotal = num(/小計\s*[¥￥]\s*([\d,]+)/) || o.items.reduce((a, x) => a + x.price, 0);
    o.points = num(/ポイント利用\s*-?\s*[¥￥]\s*([\d,]+)/);
    o.coupon = num(/クーポン利用\s*-?\s*[¥￥]\s*([\d,]+)/);
    o.total = num(/合計金額\s*[¥￥]\s*([\d,]+)/);
    if (o.kind === 'points' && !o.pointAmount) o.pointAmount = o.total || o.subtotal;
    if (o.date && (o.items.length || o.kind === 'points')) orders.push(o);
  });
  return orders;
}
// 쿠폰을 가격 비율로 나눠요. 버린 소수점이 큰 작품부터 1엔씩 더해서 합계가 정확히 맞게.
function allocate(prices, total) {
  const base = prices.reduce((a, p) => a + p, 0);
  if (!base) return prices.map(() => 0);
  const raw = prices.map((p) => (total * p) / base);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, x) => a + x, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).filter(([, i]) => prices[i] > 0).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0 && order.length; k++, rest--) out[order[k % order.length][1]]++;
  return out;
}
function couponPct(coupon, subtotal) {
  if (!coupon || !subtotal) return { num: 0, text: '' };
  const pct = (coupon / subtotal) * 100, near = Math.round(pct);
  return Math.abs(pct - near) < 0.15 ? { num: near, text: `${near}%` } : { num: Math.round(pct * 10) / 10, text: `${L('약')} ${Math.round(pct)}%` };
}
// 번역판(한국어판 등): 제목 앞 【韓国語版】 같은 표시를 떼고 원작 제목으로 비교해요.
const EDITION_RE = /^\s*[【\[［]\s*(韓国語版|한국어판|繁体中文版|簡体中文版|中文版|英語版|English(?: ver\.?)?)[^】\]］]*[】\]］]\s*/i;
const titleKey = (t) => String(t || '').normalize('NFKC').replace(EDITION_RE, '').replace(/[\s　]/g, '').toLowerCase();
const editionOf = (t) => (String(t || '').normalize('NFKC').match(EDITION_RE) || [])[1] || '';
const dlUrl = (code) => `https://www.dlsite.com/maniax/work/=/product_id/${code}.html`;
async function openReceiptImport() {
  const st = { orders: [], look: new Map(), fetchPrice: true, step: 'paste', busy: false, msg: '' };
  const dlg = document.createElement('dialog');
  dlg.className = 'modal rc-dlg';
  document.body.appendChild(dlg);
  const byCode = (code) => S.works.find((w) => (w.code || '').toUpperCase() === code);
  const doneOrder = (no) => S.works.some((w) => w.orderNo === no) || S.others.some((w) => w.orderNo === no);
  const prepare = () => {
    for (const o of st.orders) {
      o.done = doneOrder(o.orderNo);
      o.include = !o.done;
      o.paid = o.subtotal - o.coupon;
      o.shares = allocate(o.items.map((x) => x.price), o.paid);
      o.pct = couponPct(o.coupon, o.subtotal);
      for (const it of o.items) {
        let w = byCode(it.code);
        // 코드가 없으면: 번역판이면 원작(일본판) 제목으로 찾아요.
        if (!w && !it.picked && !it.noAuto && editionOf(it.title)) {
          const k = titleKey(it.title);
          w = S.works.find((x) => titleKey(x.title) === k || (x.titleKo && titleKey(x.titleKo) === k));
          if (w) it.edition = editionOf(it.title);
        }
        if (it.picked) w = S.works.find((x) => x.id === it.workId);
        // 팩: 전에 연결한 적 있으면 그 작품들로 자동 연결
        if (!w && !it.pack) { const mem = S.works.filter((x) => x.packCode === it.code); if (mem.length) { it.pack = mem.map((x) => x.id); it.target ||= 'pack'; } }
        it.workId = w?.id || '';
        it.workTitle = w ? displayTitle(w) : '';
        it.hasBuy = !!(w && w.purchaseDate && w.orderNo !== o.orderNo);
        if (it.target) continue;
        it.target = w ? (it.hasBuy ? 'skip' : 'work') : 'ask';
      }
    }
    guessTargets();
  };
  // 앱에 없는 작품: 종류를 확인하기 전에도 미리 골라 둬요. (BJ 코드는 책·만화 → 기타 구매, 나머지는 새 음성 작품)
  // DLsite에서 종류를 확인하면 그 결과로 바뀌어요.
  const guessTargets = () => {
    for (const o of st.orders) for (const it of o.items) {
      if (it.workId || it.target !== 'ask' || st.look.get(it.code)?.workKind) continue;
      it.target = /^BJ/i.test(it.code) ? 'other' : 'new';
      it.guess = true;
    }
  };
  const applyLookups = () => {
    for (const o of st.orders) for (const it of o.items) {
      const r = st.look.get(it.code);
      if (!r || it.workId || !(it.target === 'ask' || it.guess)) continue;
      it.kind = r.workKind || '';
      if (r.workKind === '음성') { it.target = 'new'; it.guess = false; }
      else if (r.workKind) { it.target = 'other'; it.guess = false; }
    }
  };
  const needLook = () => {
    const set = new Set();
    for (const o of st.orders) if (o.include) for (const it of o.items) {
      if (!it.workId && !st.look.has(it.code)) set.add(it.code);
      else if (st.fetchPrice && it.workId && it.target === 'work' && !it.edition && !it.picked && S.works.find((w) => w.id === it.workId)?.listPrice == null && !st.look.has(it.code)) set.add(it.code);
      if (it.target === 'pack') for (const id of it.pack || []) { const w = S.works.find((x) => x.id === id); if (w?.code && w.listPrice == null && !st.look.has(w.code.toUpperCase())) set.add(w.code.toUpperCase()); }
    }
    return [...set];
  };
  const counts = () => {
    let items = 0, found = 0, missing = 0, ask = 0, others = 0, pointsN = 0, pointsSum = 0, done = 0;
    for (const o of st.orders) {
      if (o.done) { done++; continue; }
      if (o.kind === 'points') { if (o.include) { pointsN++; pointsSum += o.pointAmount; } continue; }
      if (!o.include) continue;
      for (const it of o.items) { items++; if (it.workId || (it.target === 'pack' && it.pack?.length)) found++; else missing++; if (it.target === 'ask' || (it.target === 'pack' && !it.pack?.length)) ask++; if (it.target === 'other') others++; }
    }
    return { items, found, missing, ask, others, pointsN, pointsSum, done };
  };
  const tSel = (oi, ii, it) => {
    const linked = it.edition || it.picked;
    const opts = it.workId
      ? [['work', linked ? L('연결한 작품에 넣기') : L('이 작품에 넣기')], ...(linked ? [['unlink', L('연결 끊기')]] : []), ['skip', L('건너뛰기')]]
      : [['ask', L('— 고르기 —')], ['new', L('새 음성 작품으로 추가')], ['pick', L('앱의 다른 작품에 넣기 (찾기)')], ['pack', L('팩 → 앱의 여러 작품에 나누기')], ['other', L('기타 구매 (만화 등)')], ['skip', L('건너뛰기')]];
    const sel = `<select class="rc-sel" data-o="${oi}" data-i="${ii}">${opts.map(([v, l]) => `<option value="${v}"${it.target === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    if (it.target === 'pack') {
      const k = nameKey(it.q || '');
      const mem = (it.pack || []).map((id) => S.works.find((x) => x.id === id)).filter(Boolean);
      const found = k ? S.works.filter((w) => !(it.pack || []).includes(w.id) && nameKey([w.title, w.titleKo, w.code].join(' ')).includes(k)).slice(0, 5) : [];
      const shares = packShares(it, st.orders[oi].shares[ii]);
      return sel + `<div class="rc-pick rc-pack">
        ${mem.map((w, j) => `<div class="rc-pack-row"><span>${esc(displayTitle(w))} <small class="muted">${esc(w.code)}${w.listPrice != null || st.look.get((w.code || '').toUpperCase())?.listPrice ? ` · ${L('정가')} ${money(w.listPrice ?? st.look.get(w.code.toUpperCase()).listPrice, 'JPY')}` : ''}</small></span><strong>${money(shares[j].paid, 'JPY')}</strong><button type="button" class="od-rm" data-packrm="${esc(w.id)}" data-o="${oi}" data-i="${ii}" aria-label="${L('빼기')}">×</button></div>`).join('') || `<p class="note">${L('팩에 든 작품을 찾아서 더해 주세요.')}</p>`}
        <input class="input rc-q" data-o="${oi}" data-i="${ii}" value="${esc(it.q || '')}" placeholder="${L('팩에 든 작품 찾기 · 제목이나 코드')}" autocomplete="off">
        ${found.map((w) => `<button type="button" class="od-found" data-packadd="${esc(w.id)}" data-o="${oi}" data-i="${ii}">+ ${esc(displayTitle(w))} <small class="muted">${esc(w.code)}</small></button>`).join('')}
        ${mem.length ? `<p class="note">${shares.byList ? L('정가 비율로 나눠요.') : L('정가가 없는 작품이 있어서 똑같이 나눠요.')}</p>` : ''}</div>`;
    }
    if (it.target !== 'pick') return sel;
    const k = nameKey(it.q || '');
    const found = k ? S.works.filter((w) => nameKey([w.title, w.titleKo, w.code].join(' ')).includes(k)).slice(0, 5) : [];
    return sel + `<div class="rc-pick"><input class="input rc-q" data-o="${oi}" data-i="${ii}" value="${esc(it.q || '')}" placeholder="${L('제목이나 코드로 찾기')}" autocomplete="off">
      ${found.map((w) => `<button type="button" class="od-found" data-pick="${esc(w.id)}" data-o="${oi}" data-i="${ii}">${esc(displayTitle(w))} <small class="muted">${esc(w.code)}</small></button>`).join('')}</div>`;
  };
  // 팩 금액을 연결한 작품들에 나눠요: 정가 비율(모두 정가가 있을 때) 아니면 똑같이.
  const packShares = (it, paidTotal) => {
    const mem = (it.pack || []).map((id) => S.works.find((x) => x.id === id)).filter(Boolean);
    const lp = mem.map((w) => w.listPrice ?? st.look.get((w.code || '').toUpperCase())?.listPrice ?? null);
    const byList = mem.length > 0 && lp.every((x) => x > 0);
    const weights = byList ? lp : mem.map(() => 1);
    const paid = allocate(weights, paidTotal), sale = allocate(weights, it.price);
    const out = mem.map((_, j) => ({ paid: paid[j], sale: sale[j] }));
    out.byList = byList;
    return out;
  };
  const render = () => {
    const pos = dlg.querySelector('.m-body')?.scrollTop || 0;
    let body;
    if (st.step === 'paste') {
      body = `<p class="note">${L('DLsite에서 받은 구매 명세 메일 본문을 통째로 복사해서 붙여넣어요. 여러 달을 이어 붙여도 돼요.')}</p>
        <textarea class="input rc-text" id="rcText" placeholder="2026年10月3日&#10;作品購入&#10;注文番号：PTA0I…&#10;購入日時：2026/10/03 00:57&#10;…"></textarea>
        ${st.msg ? `<p class="note rc-msg">${esc(st.msg)}</p>` : ''}`;
    } else {
      const c = counts();
      const nl = needLook();
      body = `<div class="rc-sum">${L('주문')} ${st.orders.filter((o) => o.kind === 'works' && !o.done).length}${L('건')} · ${L('작품')} ${c.items}${L('개')} (${L('찾음')} ${c.found} · ${L('앱에 없음')} ${c.missing})${c.pointsN ? ` · ${L('포인트 충전')} ${c.pointsN}${L('건')} ${money(c.pointsSum, 'JPY')}` : ''}${c.done ? ` · <span class="muted">${L('이미 넣은 주문')} ${c.done}${L('건')}</span>` : ''}</div>
        <div class="rc-tools">
          <label class="check"><input type="checkbox" id="rcPrice"${st.fetchPrice ? ' checked' : ''}>${L('정가 비어 있는 작품은 DLsite에서 정가 가져오기')}</label>
          ${nl.length ? `<button type="button" class="ghost-btn" id="rcLook"${st.busy ? ' disabled' : ''}>${st.busy ? esc(st.msg) : `${L('DLsite에서 종류·정가 확인')} (${nl.length})`}</button>` : ''}
          ${!st.busy && st.msg ? `<p class="note rc-msg">${st.msg}</p>` : ''}
          ${c.missing ? `<div class="rc-bulk"><span>${L('앱에 없는 작품 {n}개 한꺼번에', { n: c.missing })}</span><div class="rc-bulk-btns"><button type="button" class="ghost-btn" data-bulk="new">${L('새 음성 작품')}</button><button type="button" class="ghost-btn" data-bulk="other">${L('기타 구매')}</button><button type="button" class="ghost-btn" data-bulk="skip">${L('건너뛰기')}</button></div></div>` : ''}
        </div>
        ${st.orders.map((o, oi) => {
          if (o.kind === 'points') return `<div class="rc-order rc-points${o.done ? ' is-done' : ''}"><label class="check"><input type="checkbox" data-inc="${oi}"${o.include ? ' checked' : ''}${o.done ? ' disabled' : ''}>${esc(o.date)} · ${L('포인트 충전')} <strong>${money(o.pointAmount, 'JPY')}</strong></label>${o.done ? `<span class="muted">${L('이미 넣음')}</span>` : ''}</div>`;
          return `<div class="rc-order${o.done ? ' is-done' : ''}">
            <div class="rc-head"><label class="check"><input type="checkbox" data-inc="${oi}"${o.include ? ' checked' : ''}${o.done ? ' disabled' : ''}><strong>${esc(o.date)}</strong> <span class="muted">${esc(o.orderNo)}</span></label>
              <span class="rc-tot">${money(o.subtotal, 'JPY')}${o.coupon ? ` − ${o.pct.text} ${L('쿠폰')} ${money(o.coupon, 'JPY')}` : ''} = <strong>${money(o.paid, 'JPY')}</strong>${o.points ? ` <span class="muted">(${L('포인트')} ${money(o.points, 'JPY')})</span>` : ''}</span></div>
            ${o.done ? `<p class="note">${L('이미 넣은 주문이에요.')}</p>` : o.items.map((it, ii) => `<div class="rc-item${it.target === 'skip' ? ' is-skip' : ''}">
                <span class="rc-title">${it.workId ? '<span class="rc-ok">✓</span>' : ''}${esc(it.title)} <small class="muted">${esc(it.code)}${it.kind ? ` · ${esc(it.kind)}` : it.guess ? ` · ${L('자동 선택')}` : ''}${it.hasBuy ? ` · ${L('구매 정보 있음')}` : ''}</small>${it.target === 'pack' && it.pack?.length ? `<small class="rc-link">↳ ${L('팩')} → ${it.pack.length}${L('개 작품')}</small>` : ''}${(it.edition || it.picked) && it.workId ? `<small class="rc-link">↳ ${it.edition ? `${esc(it.edition)} → ${L('일본판')}: ` : ''}${esc(it.workTitle)}</small>` : ''}</span>
                <span class="rc-price">${money(it.price, 'JPY')} → <strong>${money(o.shares[ii], 'JPY')}</strong></span>
                ${tSel(oi, ii, it)}</div>`).join('')}
          </div>`;
        }).join('')}`;
    }
    const c = st.step === 'review' ? counts() : null;
    dlg.innerHTML = `<div class="m-body-wrap"><div class="m-head"><h2 tabindex="-1" autofocus>${L('영수증 메일 가져오기')}</h2><button type="button" class="close" data-close aria-label="${L('닫기')}">×</button></div>
      <div class="m-body">${body}</div>
      <div class="m-foot">${st.step === 'review' ? `<button type="button" class="link-btn" id="rcBack">${L('다시 붙여넣기')}</button>` : ''}<span class="spacer"></span>
        ${st.step === 'paste' ? `<button type="button" class="primary-btn" id="rcRead">${L('읽기')}</button>` : `<button type="button" class="primary-btn" id="rcApply"${st.busy || c.ask ? ' disabled' : ''}>${c.ask ? L('고를 작품 {n}개', { n: c.ask }) : L('넣기')}</button>`}</div></div>`;
    const mb = dlg.querySelector('.m-body'); if (mb) mb.scrollTop = pos;
  };
  async function lookup() {
    const codes = needLook();
    if (!codes.length) return;
    st.busy = true; let ok = 0, noKind = 0, fail = 0, serverMsg = '';
    for (let i = 0; i < codes.length; i++) {
      st.msg = `${L('확인 중')} ${i + 1}/${codes.length}`; render();
      try {
        const r = await api('api/info', { body: { url: dlUrl(codes[i]), quick: true } });
        st.look.set(codes[i], r); ok++;
        if (!r.workKind) noKind++;
      } catch (e) { if (i === 0 && /서버|server|サーバー/i.test(e.message)) { serverMsg = e.message; break; } fail++; st.look.set(codes[i], {}); }
      await new Promise((res) => setTimeout(res, 500));
    }
    st.busy = false;
    applyLookups();
    if (serverMsg) {
      st.msg = esc(L('정보 채우기 서버가 연결되지 않아 작품 종류를 확인하지 못했어요. 앱에 없는 작품은 새 음성 작품으로 골라 두었어요. 만화 등이 섞여 있으면 바꿔 주세요.'));
      return render();
    }
    // 조회하는 동안 새로 더한 작품(팩 등)이 있으면 이어서 조회
    if (needLook().length) return lookup();
    st.msg = [fail ? L('{n}개는 확인하지 못했어요.', { n: fail }) : '', noKind ? L('서버가 작품 종류를 알려주지 않아요. 설정 → 고급에서 서버 코드를 새로 고치면 돼요.') : ''].filter(Boolean).join(' ') || (ok ? '✓ ' + L('확인했어요.') : st.msg);
    render();
  }
  async function apply() {
    st.busy = true; render();
    let n = 0, newN = 0, otherN = 0, pointsN = 0;
    const note = (o, multi, price) => [multi ? `묶음 ${o.items.length}개 ${money(o.paid, 'JPY')}` : `할인가 ${money(price, 'JPY')}`, o.pct.num ? `${o.pct.text.replace(L('약') + ' ', '약 ')} 쿠폰` : '', o.points ? `포인트 ${money(o.points, 'JPY')}` : '', `주문 ${o.orderNo}`].filter(Boolean).join(' · ');
    try {
      for (const o of st.orders) {
        if (!o.include || o.done) continue;
        if (o.kind === 'points') {
          await api('api/works', { body: { entryType: 'points', title: `ポイント購入 ${o.pointAmount.toLocaleString()}`, purchaseDate: o.date, store: 'DLsite', paidPrice: o.pointAmount, orderNo: o.orderNo, paidManual: true } });
          pointsN++; continue;
        }
        const appCount = o.items.reduce((a, it) => a + (it.target === 'pack' ? (it.pack || []).length : ['work', 'new', 'other'].includes(it.target) ? 1 : 0), 0);
        const multi = o.items.length > 1 || o.items.some((it) => it.target === 'pack');
        const common = { purchaseDate: o.date, store: 'DLsite', currency: '', couponType: o.pct.num ? 'pct' : '', couponValue: o.pct.num || null, paidManual: true, orderNo: o.orderNo, pointsUsed: o.points || null, couponMemo: o.points ? `포인트 ${money(o.points, 'JPY')}` : '',
          orderId: multi ? 'dl-' + o.orderNo : '', orderType: multi ? (o.pct.num ? 'pct' : '') : '', orderValue: multi ? o.pct.num || null : null, orderTotal: multi ? o.paid : null, orderCount: multi ? appCount : 0 };
        for (let i = 0; i < o.items.length; i++) {
          const it = o.items[i];
          const look = st.look.get(it.code);
          const body = { ...common, salePrice: it.price, paidPrice: o.shares[i], discountNote: note(o, multi, it.price) };
          if (it.target === 'pack') {
            const shares = packShares(it, o.shares[i]);
            const mem = (it.pack || []).map((id) => S.works.find((x) => x.id === id)).filter(Boolean);
            for (let j = 0; j < mem.length; j++) {
              const w = mem[j], lp = st.look.get((w.code || '').toUpperCase())?.listPrice;
              const b2 = { ...common, salePrice: shares[j].sale, paidPrice: shares[j].paid, packCode: it.code, packTitle: it.title,
                couponMemo: [`팩 ${it.title.slice(0, 40)} (${it.code}) · ${j + 1}/${mem.length}`, common.couponMemo].filter(Boolean).join(' · '),
                discountNote: [note(o, true, shares[j].sale), `팩 ${it.code}`].join(' · ') };
              if (w.listPrice == null && lp && st.fetchPrice) b2.listPrice = lp;
              await api('api/works/' + encodeURIComponent(w.id), { method: 'PATCH', body: b2 }); n++;
            }
            continue;
          }
          if (it.target === 'work') {
            const w = S.works.find((x) => x.id === it.workId);
            // 다른 코드(한국어판 등)로 산 작품이면 메모에 남겨요.
            if ((w?.code || '').toUpperCase() !== it.code) { const ed = it.edition ? `${it.edition} ` : ''; body.couponMemo = [`${ed}${it.code}로 구매`, body.couponMemo].filter(Boolean).join(' · '); body.discountNote = [body.discountNote, `${ed}${it.code}`].join(' · '); }
            if (st.fetchPrice && w?.listPrice == null && look?.listPrice && (w?.code || '').toUpperCase() === it.code) body.listPrice = look.listPrice;
            await api('api/works/' + encodeURIComponent(it.workId), { method: 'PATCH', body }); n++;
          } else if (it.target === 'new') {
            await api('api/works', { body: { ...body, title: look?.title || it.title, code: it.code, url: dlUrl(it.code), circle: look?.circle || '', actor: look?.actor || '', date: look?.date || '', images: look?.images || [], listPrice: look?.listPrice ?? null, workKind: look?.workKind || '' } }); n++; newN++;
          } else if (it.target === 'other') {
            await api('api/works', { body: { ...body, entryType: 'other', title: it.title, code: it.code, workKind: it.kind || look?.workKind || '', listPrice: look?.listPrice ?? null } }); otherN++;
          }
        }
      }
      await load();
      dlg.close();
      toast([L('작품 {n}개에 넣었어요', { n }), newN ? L('새 작품 {n}개', { n: newN }) : '', otherN ? L('기타 구매 {n}개', { n: otherN }) : '', pointsN ? L('포인트 충전 {n}건', { n: pointsN }) : ''].filter(Boolean).join(' · '));
      if (S.nav === 'stats') renderStats();
    } catch (e) { st.busy = false; fail(e); render(); }
  }
  dlg.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.matches('[data-close]')) return dlg.close();
    if (t.id === 'rcRead') {
      st.orders = parseReceipts($('rcText').value);
      if (!st.orders.length) { st.msg = L('주문을 찾지 못했어요. 메일 본문 전체(注文番号, 購入日時가 있는 부분)를 붙여넣어 주세요.'); return render(); }
      st.msg = ''; prepare(); st.step = 'review'; render();
      if (needLook().length) lookup();
      return;
    }
    if (t.id === 'rcBack') { st.step = 'paste'; st.msg = ''; return render(); }
    if (t.id === 'rcLook') return lookup();
    if (t.dataset.bulk) {
      for (const o of st.orders) if (o.include && !o.done && o.kind !== 'points') for (const it of o.items) {
        if (it.workId || (it.target === 'pack' && it.pack?.length)) continue;
        it.target = t.dataset.bulk; it.guess = false;
      }
      return render();
    }
    if (t.dataset.packadd || t.dataset.packrm) {
      const it = st.orders[t.dataset.o].items[t.dataset.i];
      it.pack = it.pack || [];
      if (t.dataset.packadd) { it.pack.push(t.dataset.packadd); it.q = ''; } else it.pack = it.pack.filter((x) => x !== t.dataset.packrm);
      render();
      if (needLook().length && !st.busy) lookup();
      const q = dlg.querySelector(`.rc-q[data-o="${t.dataset.o}"][data-i="${t.dataset.i}"]`); if (q && t.dataset.packadd) q.focus();
      return;
    }
    if (t.dataset.pick) {
      const it = st.orders[t.dataset.o].items[t.dataset.i];
      const w = S.works.find((x) => x.id === t.dataset.pick);
      it.workId = w.id; it.workTitle = displayTitle(w); it.picked = true; it.q = '';
      it.hasBuy = !!(w.purchaseDate && w.orderNo !== st.orders[t.dataset.o].orderNo);
      it.target = 'work'; return render();
    }
    if (t.id === 'rcApply') return apply();
  });
  let rcQT;
  dlg.addEventListener('input', (e) => {
    if (!e.target.classList.contains('rc-q')) return;
    const it = st.orders[e.target.dataset.o].items[e.target.dataset.i];
    it.q = e.target.value;
    clearTimeout(rcQT);
    rcQT = setTimeout(() => { const o = e.target.dataset.o, i = e.target.dataset.i; render(); const q = dlg.querySelector(`.rc-q[data-o="${o}"][data-i="${i}"]`); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 250);
  });
  dlg.addEventListener('change', (e) => {
    const t = e.target;
    if (t.classList.contains('rc-sel')) {
      const it = st.orders[t.dataset.o].items[t.dataset.i];
      if (t.value === 'unlink') { it.workId = ''; it.edition = ''; it.picked = false; it.workTitle = ''; it.target = 'ask'; it.noAuto = true; return render(); }
      it.target = t.value; it.guess = false; return render();
    }
    if (t.dataset.inc != null) { st.orders[t.dataset.inc].include = t.checked; return render(); }
    if (t.id === 'rcPrice') { st.fetchPrice = t.checked; return render(); }
  });
  dlg.addEventListener('close', () => dlg.remove());
  render();
  dlg.showModal();
}
// 영수증에서 가져온 주문: 같은 주문의 작품·기타 구매와 금액을 보여줘요.
function openReceiptOrder(w) {
  const items = [...S.works, ...S.others].filter((x) => x.orderNo === w.orderNo && !x.entryType || x.orderNo === w.orderNo && x.entryType === 'other');
  const total = items.reduce((a, x) => a + (x.paidPrice ?? 0), 0);
  openActions([
    ...items.map((x) => ({ label: `${x.entryType ? `[${x.workKind || L('기타')}] ` : ''}${displayTitle(x).slice(0, 26)} · ${money(x.salePrice, 'JPY')} → ${money(x.paidPrice, 'JPY')}`, run: () => { if (!x.entryType) select(x.id); } })),
    { label: `${L('주문')} ${w.orderNo} · ${L('합계')} ${money(w.orderTotal ?? total, 'JPY')}${w.pointsUsed ? ` · ${L('포인트')} ${money(w.pointsUsed, 'JPY')}` : ''}`, run: () => {} },
  ]);
}
// 폰 앱: 앱으로 실행 중인지, 인터넷 없이 열 준비가 됐는지
function offlineStatusHtml() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ready = !!navigator.serviceWorker?.controller;
  if (standalone && ready) return `<div class="vb-offline">✓ ${L('앱으로 실행 중 · 인터넷 없이도 열려요')}</div>`;
  if (!standalone) return `<div class="vb-offline no">${L('브라우저에서 열려 있어요 · 홈 화면 아이콘으로 열어 주세요')}</div>`;
  return `<div class="vb-offline no">${L('오프라인 준비 중 · 인터넷 연결 후 다시 열어 주세요')}</div>`;
}
async function openSettings() {
  const dlg = $('settings');
  const n = await api('api/notion/status').catch(() => S.notion);
  S.notion = n;
  const img = await api('api/images/status').catch(() => ({}));
  const total = S.works.reduce((a, w) => a + w.images.length, 0);
  const syncSt = await api('api/sync/status').catch(() => ({}));
  const seg = (attr, cur, opts) => `<div class="tabs set-seg" role="radiogroup">${opts.map(([v, l, extra = '']) => `<button type="button" ${attr}="${v}" class="${cur === v ? 'on' : ''}">${extra}${esc(l)}</button>`).join('')}</div>`;
  const item = (label, control, sub = '') => `<div class="set-item"><div class="si-label">${label}${sub ? `<small>${sub}</small>` : ''}</div><div class="si-ctl">${control}</div></div>`;
  const advOn = !!getRelay().url || !!syncSt.configured;
  dlg.innerHTML = `<div class="m-body-wrap">
    <div class="m-head"><h2 tabindex="-1" autofocus>${L("설정")}</h2><button type="button" class="close" data-close aria-label="${L("닫기")}">×</button></div>
    <div class="m-body settings-body">
      ${n.unsupported ? `<div class="set-status">${offlineStatusHtml()}<div class="note">${L("기록은 이 기기 안에 저장돼요.")}</div></div>` : ''}
      <div class="set-group-title">${esc(tr('viewTitle'))}</div>
      <div class="set-group">
        ${item(esc(tr('paletteNote')), seg('data-palette', S.palette, [['indigo', tr('palIndigo'), '<i class="pal-dot" style="background:#3443C4"></i>'], ['green', tr('palGreen'), '<i class="pal-dot" style="background:#2E5A4A"></i>'], ['mono', tr('palMono'), '<i class="pal-dot" style="background:#232323"></i>']]))}
        ${item(esc(tr('modeNote')), seg('data-theme-mode', S.theme, [['system', tr('modeSystem')], ['light', tr('modeLight')], ['dark', tr('modeDark')]]))}
        ${item(esc(tr('langNote')) + (S.menuLang === 'en' ? '' : ' · Language'), seg('data-menu-lang', S.menuLang, [['ko', '한국어'], ['en', 'English'], ['ja', '日本語']]))}
        ${item(esc(tr('nameModeNote')), seg('data-name-mode', S.nameMode, [['both', tr('nameBoth')], ['ja', tr('nameJa')], ['ko', tr('nameKo')]]))}
        <button type="button" class="set-item set-switch" id="blurSwitch" role="switch" aria-checked="${S.coverBlur}"><div class="si-label">${L('표지 가리기')}<small>${L('표지를 흐리게 해요')}</small></div><span class="switch${S.coverBlur ? ' on' : ''}"></span></button>
      </div>
      ${n.unsupported ? '' : `<div class="set-group-title">${L("노션 연결")}</div><div class="set-group set-pad">
        ${n.connected ? `<div class="banner ok">${L("CD LIST에 연결돼 있어요.")}</div>
          <div class="note" id="syncState">${syncText(n)}</div>
          <div class="progress" id="syncBar" ${n.running ? '' : 'hidden'}><div style="width:${n.running ? 50 : 0}%"></div></div>
          <div class="set-row"><button type="button" class="ghost-btn" id="syncNow">${L("지금 노션에서 가져오기")}</button><button type="button" class="danger-btn" id="disconnect">${L("연결 해제")}</button></div>
          <div class="note">${L("로컬에서 고친 항목은 '반영 대기'에 남아요.")}</div>`
        : `<div class="note">${L("노션 연결 키를 넣어 주세요. 이 컴퓨터에만 저장돼요.")}<br>
            ${L("키 만들기:")} <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noopener">notion.so/profile/integrations ↗</a> ${L("→ CD LIST와 성우·서클·태그 DB에 연결 허용(읽기·업데이트·삽입)")}</div>
          <div class="set-row"><input class="input" id="tokenInput" type="password" placeholder="${L("ntn_… 또는 secret_…")}" style="flex:1;min-width:0" autocomplete="off"><button type="button" class="primary-btn" id="connect">${L("연결")}</button></div>`}
      </div>`}
      <div${img.unsupported ? ' hidden' : ''}><div class="set-group-title">${L("이미지 내려받기")}</div><div class="set-group set-pad">
        <div class="note">${L("표지와 이미지를 images 폴더에 저장해요.")}</div>
        <div class="note" id="imgState">${imgText(img, total)}</div>
        <div class="progress" id="imgBar" ${img.running ? '' : 'hidden'}><div style="width:${img.total ? Math.round(img.done / img.total * 100) : 0}%"></div></div>
        <div class="set-row"><button type="button" class="ghost-btn" id="imgCovers">${L("표지만 받기")}</button><button type="button" class="ghost-btn" id="imgAll">${L("모든 이미지 받기")}</button></div>
      </div></div>
      <div class="set-group-title">${L("정리")}</div>
      <div class="set-group">
        <button type="button" class="set-item set-link" id="openReceipts"><div class="si-label">${L("영수증 메일 가져오기")}<small>${L("DLsite 구매 명세로 구매 정보를 한 번에 넣어요")}</small></div><span class="si-go">›</span></button>
        <button type="button" class="set-item set-link" id="openDupes"><div class="si-label">${L("중복 작품 합치기")}<small>${L("같은 작품 코드가 두 번 있으면 구매 정보는 옮기고 하나로 합쳐요")}</small></div><span class="si-go">›</span></button>
        <button type="button" class="set-item set-link" id="openNames"><div class="si-label">${L("성우·서클 이름 정리")}<small>${L("한글 읽기를 한 번에 붙이거나 고쳐요")}</small></div><span class="si-go">›</span></button>
      </div>
      <div class="set-group-title">${L("백업")}</div>
      <div class="set-group">
        <a class="set-item set-link" href="api/backup" download><div class="si-label">${L("복원용 백업 받기")}<small>${window.VB_MOBILE ? L('복원하거나 다른 기기로 옮길 때 써요. 가끔 받아 두세요.') : L('앱을 되돌릴 때 써요. 노션 키는 들어가지 않아요.')}</small></div><span class="si-go">›</span></a>
        <label class="set-item set-link"><div class="si-label">${L("백업에서 복원")}</div><span class="si-go">›</span><input type="file" id="restoreFile" accept=".json,application/json" hidden></label>
        <button type="button" class="set-item set-link" id="openRecover"><div class="si-label">${L("되돌리기 · 지워진 작품 되살리기")}<small>${window.VB_MOBILE ? L('자동 백업이나 동기화 전 상태로 되돌려요') : L('동기화나 삭제로 지워진 작품을 되살려요')}</small></div><span class="si-go">›</span></button>
        <div class="set-item"><div class="si-label">${L("보기 좋은 백업")}<small>${L("보관·열람용이에요. 복원에는 쓸 수 없어요.")}</small></div>
          <div class="si-ctl set-row"><a class="ghost-btn" href="api/export/works.xlsx" download>${L("엑셀 (.xlsx)")}</a><a class="ghost-btn" href="api/export/works.csv" download>CSV</a><a class="ghost-btn" href="api/export/reviews.html" target="_blank" rel="noopener">${L("감상 모음 문서 ↗")}</a></div></div>
      </div>
      <details class="set-adv"${advOn ? ' open' : ''}><summary><span>${L("고급")}</span><small>${advOn ? L('연결됨') : L('내 서버 만들기 · 정보 채우기 · 동기화')}</small></summary>
        <div class="set-group set-pad srv-block">${serverBlockHtml(syncSt)}</div>
      </details>
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
  $('blurSwitch').onclick = () => { setCoverBlur(!S.coverBlur); $('blurSwitch').setAttribute('aria-checked', String(S.coverBlur)); $('blurSwitch').querySelector('.switch').classList.toggle('on', S.coverBlur); };
  dlg.querySelectorAll('[data-palette]').forEach((b) => (b.onclick = () => {
    S.palette = b.dataset.palette;
    rememberView();
    dlg.querySelectorAll('[data-palette]').forEach((x) => x.classList.toggle('on', x === b));
    applyTheme();
  }));
  $('imgCovers').onclick = () => startImages(true);
  $('imgAll').onclick = () => startImages(false);
  $('openNames').onclick = () => openNames('missing');
  $('openDupes').onclick = () => { $('settings').close(); openDupes(); };
  $('openReceipts').onclick = () => openReceiptImport();
  $('openRecover').onclick = () => openRecover();
  $('srvGuide') && ($('srvGuide').onclick = openServerGuide);
  dlg.querySelectorAll('[data-eye]').forEach((b) => (b.onclick = () => { const i = $(b.dataset.eye); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.textContent = show ? L('가리기') : L('보기'); }));
  $('srvManualOpen') && ($('srvManualOpen').onclick = () => { $('srvManual').hidden = false; $('srvManualOpen').hidden = true; $('srvUrl').focus(); });
  $('srvSave') && ($('srvSave').onclick = async () => {
    // 아이맥은 열쇠를 화면에 보여주지 않아요. 비워 두면 주소만 바꾸고 열쇠는 그대로 써요.
    if (!window.VB_MOBILE && serverReady(syncSt) && !$('srvKey').value.trim()) {
      await api('api/sync/config', { body: { url: $('srvUrl').value.trim().replace(/\/+$/, '') } }).catch(fail);
      $('srvState').textContent = '✓ ' + L('저장했어요.'); setTimeout(openSettings, 900); return;
    }
    if (await connectServer($('srvUrl').value, $('srvKey').value, $('srvState'))) setTimeout(openSettings, 1200);
  });
  $('syncNowBtn') && ($('syncNowBtn').onclick = runSyncNow);
  $('syncOn') && ($('syncOn').onchange = async (e) => { await api('api/sync/config', { body: { on: e.target.checked } }).catch(fail); if (e.target.checked) runSyncNow(); });
  $('srvCopyKey') && ($('srvCopyKey').onclick = () => copyText(getRelay().key || '', L('열쇠를 복사했어요. 다른 기기의 설정 → 고급에 붙여넣어요.')));
  $('srvOff') && ($('srvOff').onclick = async () => {
    if (!confirm(L('이 기기에서 서버 연결을 해제할까요? 기록과 서버는 그대로 남아요.'))) return;
    if (window.VB_MOBILE) { try { localStorage.removeItem('voicebox.relay'); } catch {} await api('api/sync/config', { body: { on: false } }).catch(() => {}); }
    else await api('api/sync/config', { body: { url: '', key: '' } }).catch(fail);
    openSettings();
  });
  if ($('srvStatus')) {
    const url = window.VB_MOBILE ? getRelay().url : syncSt.url;
    serverStatus(url).then((j) => {
      const el = $('srvStatus'); if (!el) return;
      el.innerHTML = statusDots(j);
      // 영수증 가져오기의 작품 종류 조회는 서버 코드 6판부터 돼요. 폰 앱에서만 안내해요.
      if (window.VB_MOBILE && (j.version || 0) < SERVER_LATEST) el.insertAdjacentHTML('afterend', `<div class="srv-update"><strong>${L('서버 코드 업데이트')}</strong><span>${L('영수증 가져오기에서 작품 종류(음성·만화)를 알아내려면 서버 코드를 새로 넣어야 해요.')}</span>
        <ol><li>${L('아래 버튼으로 새 코드 복사')}</li><li>${L('Cloudflare → Workers 및 Pages → 내 서버 → 코드 편집')}</li><li>${L('코드를 전부 지우고 붙여넣기 → 배포')}</li></ol>
        <div class="set-row"><button type="button" class="primary-btn" id="srvCodeCopy">${L('새 서버 코드 복사')}</button><a class="ghost-btn" href="https://dash.cloudflare.com/" target="_blank" rel="noopener">Cloudflare ↗</a></div></div>`);
      const b = $('srvCodeCopy');
      if (b) b.onclick = async () => { try { const code = await (await fetch('../vb-server/src/index.js', { cache: 'no-store' })).text(); if (!/VOICE BOX/.test(code)) throw new Error(); copyText(code, L('서버 코드를 복사했어요. Cloudflare 코드 편집기에 붙여넣으세요.')); } catch { toast(L('코드를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'), true); } };
    })
      .catch(() => { const el = $('srvStatus'); if (el) el.innerHTML = `<span class="sdot no">○ ${L('서버에 연결하지 못했어요. 인터넷이나 주소를 확인해 주세요.')}</span>`; });
  }
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
    const preview = keys.slice(0, 6).map((k) => `${FIELD_KO[k]}: ${esc(String(fmt(h.data[k], k)).slice(0, 40))}`).join(' · ');
    return `<div class="hist"><div class="hist-head"><span>${esc(h.reason)} · ${new Date(h.at).toLocaleString(LOCALE())}</span>${keys.length ? `<button type="button" class="link-btn" data-restore="${esc(h.at)}">${L("이 전 상태로 되돌리기")}</button>` : ''}</div><div class="hist-fields">${preview || L('변경 내용 없음')}</div></div>`;
  };
  dlg.innerHTML = `<div class="m-body-wrap"><div class="m-head"><h2>${L("수정 이력")}</h2><button type="button" class="close" data-close aria-label="${L("닫기")}">×</button></div>
    <div class="m-body"><div class="note">${L("바뀌기 전 값으로 되돌릴 수 있어요.")}</div>${list.length ? list.map(item).join('') : `<div class="note">${L("아직 기록이 없어요.")}</div>`}</div></div>`;
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
  // 표지 가리기가 켜져 있으면 크게 보기에서도 흐리게 보이고, 한 번 누르면 선명해져요.
  let revealed = !S.coverBlur;
  const show = () => {
    dlg.innerHTML = `<button type="button" class="lb-close" data-d="0" aria-label="${L("닫기")}">✕</button><img src="${esc(list[i])}" alt="" referrerpolicy="no-referrer" class="${revealed ? '' : 'lb-blur'}">${revealed ? '' : `<div class="lb-tip">${L('눌러서 보기')}</div>`}${list.length > 1 ? `<div class="lb-nav"><button type="button" data-d="-1">${L("‹ 이전")}</button><button type="button" data-d="0">${L("닫기")}</button><button type="button" data-d="1">${L("다음 ›")}</button></div>` : ''}`;
  };
  show();
  dlg.onclick = (e) => {
    if (!revealed && (e.target.tagName === 'IMG' || e.target.classList.contains('lb-tip'))) { revealed = true; return show(); }
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
  const cur = S.searching ? 'list' : isHome() ? 'home' : S.nav === 'stats' ? 'stats' : 'list';
  document.querySelectorAll('#tabbar [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === cur));
}
$('tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const tab = b.dataset.tab;
  if (S.selectMode && tab !== 'list') endSelect();
  if (tab === 'add') { openEditor(null); return; }
  if (tab === 'settings') { openSettings(); return; }
  if (S.searching) exitSearch(false);
  if (tab === 'home') { goHome(); return; }
  const wasHome = isHome();
  S.home = false;
  if (tab === 'stats') { S.nav = 'stats'; S.shown = 60; renderNav(); renderList(); $('main').scrollTop = 0; }
  if (tab === 'list' && (wasHome || S.nav === 'stats')) { if (S.nav === 'stats') { S.nav = 'all'; resetFilters(); } else { renderNav(); renderList(); } $('main').scrollTop = 0; return; }
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
    S.home = false;
    S.searching = true;
    navBeforeSearch = S.nav;
    if (S.nav !== 'all') { S.nav = 'all'; renderNav(); renderList(); }
    document.body.classList.add('searching');
    if (isNarrow()) history.pushState({ vbSearch: true }, '');
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
  if (history.state?.vbSearch) { skipPop = true; history.back(); }
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
  ['workType', L('동인·상업'), (w) => [w.workType ? L(w.workType) : L('미분류')]],
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
  // 숨김과 상관없이 세고, '통계에서 빼기'를 켠 작품만 빼요. (지출 통계에는 들어가요)
  const works = S.works.filter((w) => !w.noStats && scope(w));
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
        <div class="note">${kindLabel} ${rows.length.toLocaleString()}${L("개")}${S.statKind === 'actor' || S.statKind === 'circle' ? ` · <button type="button" class="link-btn" data-open-names="${S.statKind === 'circle' ? 'circle' : 'missing'}">${L('이름 정리')}</button>` : ''}</div>
        <div id="legRows"></div>
        <div class="leg-more" id="statMore"></div>
      </div>
    </div>`;
}
// 지출: 구매일·금액이 있는 작품을 월별로 더해요. 구매가가 없으면 정가로 셉니다.
S.spendView = (() => { try { return localStorage.getItem('voicebox.spendView') || 'month'; } catch { return 'month'; } })();
S.spendYear = '';
S.spendOthers = (() => { try { return localStorage.getItem('voicebox.spendOthers') === '1'; } catch { return false; } })();
const rememberSpend = () => { try { localStorage.setItem('voicebox.spendView', S.spendView); } catch {} };
S.spendMonth = '';
S.spendCur = '';
function renderSpend() {
  const hasBuy = (w) => w.purchaseDate && (w.paidPrice ?? w.listPrice) != null;
  // 위쪽 숫자와 막대는 음성 작품만. '기타 구매 포함'을 켜면 만화 등도 더해요. 포인트 충전은 따로 보여줘요.
  const otherBuys = S.others.filter((w) => w.entryType === 'other' && hasBuy(w));
  const bought = [...S.works.filter(hasBuy), ...(S.spendOthers ? otherBuys : [])];
  const charges = S.others.filter((w) => w.entryType === 'points' && w.purchaseDate);
  const curCount = new Map();
  for (const w of bought) curCount.set(w.currency || 'JPY', (curCount.get(w.currency || 'JPY') || 0) + 1);
  const curs = [...curCount].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  if (!curs.includes(S.spendCur)) S.spendCur = curs[0] || 'JPY';
  const cur = S.spendCur;
  const pad = (n) => String(n).padStart(2, '0');
  const paidOf = (w) => w.paidPrice ?? w.listPrice;
  const savedOf = (w) => (w.listPrice != null && w.paidPrice != null ? Math.max(0, w.listPrice - w.paidPrice) : 0);
  const inCur = bought.filter((w) => (w.currency || 'JPY') === cur);
  const thisYear = String(new Date().getFullYear());
  const years = [...new Set([...inCur.map((w) => w.purchaseDate.slice(0, 4)), thisYear])].sort();
  if (!years.includes(S.spendYear)) S.spendYear = inCur.some((w) => w.purchaseDate.startsWith(thisYear)) || !inCur.length ? thisYear : years[years.length - 1];
  const yearView = S.spendView === 'year';
  // 막대·목록 묶음: 월별(고른 연도의 1~12월) 또는 연도별
  const keys = yearView ? years : Array.from({ length: 12 }, (_, i) => `${S.spendYear}-${pad(i + 1)}`);
  const keyOf = (w) => (yearView ? w.purchaseDate.slice(0, 4) : w.purchaseDate.slice(0, 7));
  const scope = yearView ? inCur : inCur.filter((w) => w.purchaseDate.startsWith(S.spendYear));
  const groups = new Map(keys.map((k) => [k, { sum: 0, n: 0, saved: 0 }]));
  for (const w of scope) { const r = groups.get(keyOf(w)); if (r) { r.sum += paidOf(w); r.n++; r.saved += savedOf(w); } }
  const total = scope.reduce((a, w) => a + paidOf(w), 0);
  const saved = scope.reduce((a, w) => a + savedOf(w), 0);
  const chargeSum = charges.filter((w) => yearView || w.purchaseDate.startsWith(S.spendYear)).reduce((a, w) => a + (w.paidPrice || 0), 0);
  const activeMonths = new Set(scope.map((w) => w.purchaseDate.slice(0, 7))).size;
  const max = Math.max(1, ...[...groups.values()].map((r) => r.sum));
  const stores = new Map();
  for (const w of scope) { const k = w.store || L('구매처 미기재'); const r = stores.get(k) || { sum: 0, n: 0 }; r.sum += paidOf(w); r.n++; stores.set(k, r); }
  const storeRows = [...stores].sort((a, b) => b[1].sum - a[1].sum);
  if (yearView || (S.spendMonth && !keys.includes(S.spendMonth))) S.spendMonth = '';
  const monthWorks = S.spendMonth ? inCur.filter((w) => w.purchaseDate.startsWith(S.spendMonth)).sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate)) : [];
  const label = (k) => (yearView ? k : Number(k.slice(5)) + `<small>${L("월")}</small>`);
  const listRows = [...groups].filter(([, r]) => r.n).reverse();
  const yi = years.indexOf(S.spendYear);
  $('stats').innerHTML = `${statModeHtml()}
    <div class="spend-top">
      <div class="seg spend-view" role="radiogroup"><button type="button" data-spend-view="month" class="${yearView ? '' : 'on'}">${L('월별')}</button><button type="button" data-spend-view="year" class="${yearView ? 'on' : ''}">${L('연도별')}</button></div>
      ${yearView ? `<span class="note">${L('전체 기간')}</span>` : `<div class="year-nav"><button type="button" data-spend-year="${years[yi - 1] || ''}"${yi > 0 ? '' : ' disabled'} aria-label="${L('이전 해')}">‹</button><strong>${S.spendYear}${L('년')}</strong><button type="button" data-spend-year="${years[yi + 1] || ''}"${yi < years.length - 1 ? '' : ' disabled'} aria-label="${L('다음 해')}">›</button></div>`}
      ${curs.length > 1 ? `<div class="tabs" role="radiogroup" aria-label="${L("통화")}">${curs.map((c) => `<button type="button" data-spend-cur="${c}" class="${c === cur ? 'on' : ''}">${CUR_SIGN[c]} ${c}</button>`).join('')}</div>` : ''}
    </div>
    <div class="spend-opts">
      <button type="button" class="ghost-btn" id="rcOpen">${L('영수증 메일 가져오기')}</button>
      ${otherBuys.length ? `<label class="check"><input type="checkbox" id="spendOthers"${S.spendOthers ? ' checked' : ''}>${L('기타 구매(만화 등) 포함')} <small class="muted">${otherBuys.length}${L('개')}</small></label>` : ''}
      ${chargeSum ? `<span class="note">${L('포인트 충전')} ${money(chargeSum, 'JPY')} <small>(${L('지출에는 안 들어가요')})</small></span>` : ''}
    </div>
    <div class="stat-cards">
      <div class="stat-card"><div class="sc-label">${yearView ? L('전체 지출') : S.spendYear + L('년 지출')}</div><div class="sc-num">${money(total, cur) || money(0, cur)}</div></div>
      <div class="stat-card"><div class="sc-label">${L("월 평균 · 산 달 기준")}</div><div class="sc-num">${money(activeMonths ? total / activeMonths : 0, cur)}</div></div>
      <div class="stat-card"><div class="sc-label">${L("구매한 작품")}</div><div class="sc-num">${scope.length.toLocaleString()}</div></div>
      <div class="stat-card"><div class="sc-label">${L("할인으로 아낀 금액")}</div><div class="sc-num">${money(saved, cur)}</div></div>
    </div>
    <div class="stat-body spend-body">
      ${bought.length ? '' : `<div class="note">${L("아직 구매 정보가 없어요.")}</div>`}
      <div class="bars${yearView ? ' bars-year' : ''}" role="list" style="${yearView ? `grid-template-columns:repeat(${Math.max(keys.length, 3)}, minmax(0, 1fr))` : ''}">${keys.map((k) => { const r = groups.get(k); return `<button type="button" class="bar${S.spendMonth === k ? ' on' : ''}" ${yearView ? `data-spend-goyear="${k}"` : `data-spend-month="${k}"`} role="listitem" title="${k} · ${money(r.sum, cur)} · ${r.n}${L("개")}">
        <span class="bar-v">${r.sum ? money(r.sum, cur) : ''}</span>
        <span class="bar-track"><span class="bar-fill" style="height:${r.sum ? Math.max(3, Math.round(r.sum / max * 100)) : 0}%"></span></span>
        <span class="bar-m">${label(k)}</span></button>`; }).join('')}</div>
      ${listRows.length ? `<div class="spend-table">
        <div class="st-row st-head"><span>${yearView ? L('연도') : L('구매 월')}</span><span>${L('작품')}</span><span>${L('지출')}</span><span>${yearView ? L('월 평균') : L('아낀 돈')}</span></div>
        ${listRows.map(([k, r]) => { const months = yearView ? new Set(scope.filter((w) => w.purchaseDate.startsWith(k)).map((w) => w.purchaseDate.slice(0, 7))).size : 0; return `<button type="button" class="st-row${S.spendMonth === k ? ' on' : ''}" ${yearView ? `data-spend-goyear="${k}"` : `data-spend-month="${k}"`}>
          <span>${yearView ? k + L('년') : Number(k.slice(5)) + L('월')}</span><span>${r.n}${L('개')}</span><span class="st-sum">${money(r.sum, cur)}</span><span class="${!yearView && r.saved ? 'st-saved' : ''}">${yearView ? money(months ? r.sum / months : 0, cur) : r.saved ? money(r.saved, cur) : '–'}</span></button>`; }).join('')}
        <div class="st-row st-total"><span>${L('합계')}</span><span>${scope.length}${L('개')}</span><span class="st-sum">${money(total, cur)}</span><span class="${!yearView && saved ? 'st-saved' : ''}">${yearView ? money(activeMonths ? total / activeMonths : 0, cur) : saved ? money(saved, cur) : '–'}</span></div>
        <p class="note">${yearView ? L('연도를 누르면 그해 월별로 넘어가요.') : L('월을 누르면 그달 산 작품이 보여요.')}</p>
      </div>` : ''}
      ${S.spendMonth ? `<div class="spend-month"><div class="sec-head"><h3>${S.spendMonth.replace('-', ' / ')} · ${money(groups.get(S.spendMonth).sum, cur)}</h3><button type="button" class="link-btn" data-spend-month="">${L("닫기")}</button></div>
        ${(() => {
          // 묶음 구매는 한 줄로 (결제한 금액 그대로)
          const seen = new Set();
          return monthWorks.map((w) => {
            if (w.orderId) {
              if (seen.has(w.orderId)) return '';
              seen.add(w.orderId);
              const grp = monthWorks.filter((x) => x.orderId === w.orderId);
              const sum = grp.reduce((a, x) => a + paidOf(x), 0);
              return `<button type="button" class="spend-row" data-open-order="${esc(w.id)}"><span class="sr-date">${esc(w.purchaseDate.slice(5))}</span><span class="sr-title"><span class="chip chip-order">${L('묶음')} ${grp.length}${L('개')}</span> ${esc(displayTitle(w))}${grp.length > 1 ? ` ${L('외')} ${grp.length - 1}` : ''}</span><span class="sr-store">${esc(w.store)}</span><span class="sr-price">${money(sum, cur)}</span></button>`;
            }
            const cp = w.couponType && w.couponValue ? (w.couponType === 'pct' ? `${w.couponValue}% ${L('쿠폰')}` : `${money(w.couponValue, cur)} ${L('쿠폰')}`) : '';
            if (w.entryType) return `<button type="button" class="spend-row" data-other="${esc(w.id)}"><span class="sr-date">${esc(w.purchaseDate.slice(5))}</span><span class="sr-title"><span class="chip chip-kind">${esc(w.workKind || L('기타'))}</span> ${esc(w.title)}</span><span class="sr-store">${esc(w.store)}</span><span class="sr-price">${money(paidOf(w), cur)}</span></button>`;
            return `<button type="button" class="spend-row" data-open-work="${esc(w.id)}"><span class="sr-date">${esc(w.purchaseDate.slice(5))}</span><span class="sr-title">${esc(displayTitle(w))}${cp ? ` <small class="sr-cp">${cp}</small>` : ''}</span><span class="sr-store">${esc(w.store)}</span><span class="sr-price">${money(paidOf(w), cur)}</span></button>`;
          }).join('');
        })()}</div>` : ''}
      ${storeRows.length ? `<div class="spend-stores"><div class="note">${L("구매처별")}</div>
        ${storeRows.map(([k, r], i) => `<div class="leg-row"><span class="leg-rank">${i + 1}</span><span class="leg-dot" style="background:${STAT_COLORS[i % STAT_COLORS.length]}"></span><span class="leg-name">${esc(k)}</span><span class="leg-bar"><span style="width:${Math.max(2, Math.round(r.sum / (total || 1) * 100))}%;background:${STAT_COLORS[i % STAT_COLORS.length]}"></span></span><span class="leg-n">${r.n}${L("개")}</span><span class="leg-p">${money(r.sum, cur)}</span></div>`).join('')}</div>` : ''}
    </div>`;
}
$('stats').addEventListener('click', (e) => {
  const m = e.target.closest('[data-spend-month]');
  if (m) { S.spendMonth = S.spendMonth === m.dataset.spendMonth ? '' : m.dataset.spendMonth; return renderSpend(); }
  const c = e.target.closest('[data-spend-cur]');
  if (c) { S.spendCur = c.dataset.spendCur; S.spendMonth = ''; return renderSpend(); }
  const v = e.target.closest('[data-spend-view]');
  if (v) { S.spendView = v.dataset.spendView; S.spendMonth = ''; rememberSpend(); return renderSpend(); }
  const y = e.target.closest('[data-spend-year]');
  if (y && y.dataset.spendYear) { S.spendYear = y.dataset.spendYear; S.spendMonth = ''; return renderSpend(); }
  const gy = e.target.closest('[data-spend-goyear]');
  if (gy) { S.spendView = 'month'; S.spendYear = gy.dataset.spendGoyear; S.spendMonth = ''; rememberSpend(); return renderSpend(); }
  if (e.target.closest('#rcOpen')) return openReceiptImport();
  const ot = e.target.closest('[data-other]');
  if (ot) {
    const w = S.others.find((x) => x.id === ot.dataset.other);
    if (w) openActions([{ label: `${w.title} · ${money(w.paidPrice, 'JPY')}`, run: () => {} }, { label: L('이 기타 구매 지우기'), danger: true, run: async () => { if (!confirm(L('이 기록을 지울까요?'))) return; await api('api/works/' + encodeURIComponent(w.id), { method: 'DELETE' }).catch(fail); await load(); renderStats(); } }]);
    return;
  }
  const oo = e.target.closest('[data-open-order]');
  if (oo) return openOrder(oo.dataset.openOrder);
  const o = e.target.closest('[data-open-work]');
  if (o) select(o.dataset.openWork);
});
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
  const on = e.target.closest('[data-open-names]');
  if (on) { openNames(on.dataset.openNames); return; }
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
  if (S.statKind === 'workType') { S.wt = key === L('동인') ? '동인' : key === L('상업') ? '상업' : ''; $('fWorkType').value = S.wt; }
  if (S.statKind === 'status') S.nav = { [L('들음')]: 'played', [L('듣는 중')]: 'played', [L('안 들음')]: 'unplayed', [L('상태 미기재')]: 'unplayed' }[key];
  fillFilterOptions();
  renderNav();
  renderList();
  $('main').scrollTop = 0;
  if (S.statKind === 'rating' && S.rating !== '0' && S.rating !== '5') toast(`★${S.rating} ${L("이상인 작품이에요.")}`);
});
$('stats').addEventListener('change', (e) => { if (e.target.id === 'spendOthers') { S.spendOthers = e.target.checked; try { localStorage.setItem('voicebox.spendOthers', S.spendOthers ? '1' : ''); } catch {} return renderSpend(); } if (e.target.id === 'statScope') { S.statScope = e.target.value; rememberStats(); renderStats(); } });

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

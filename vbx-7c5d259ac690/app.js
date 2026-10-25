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
  if (p.detailWidth > 300) S.detailWidth = p.detailWidth;
} catch {}
const rememberView = () => { try { localStorage.setItem('voicebox.view', JSON.stringify({ view: S.view, showHidden: S.showHidden, nameMode: S.nameMode, menuLang: S.menuLang, theme: S.theme, detailWidth: S.detailWidth })); } catch {} };
const visible = (w) => S.showHidden || !w.hidden;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const isPhone = () => matchMedia('(max-width: 760px)').matches;
const isNarrow = () => matchMedia('(max-width: 900px)').matches; // 이 폭 이하에서는 상세가 목록 위를 덮어요
const displayTitle = (w) => w.titleKo || w.title || '제목 미정';
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
  if (!r.ok) throw new Error(data.error || '요청을 처리하지 못했어요.');
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
};
const MENU_JA = {
  all: 'すべての作品', played: '聴いた作品', unplayed: '未聴の作品', fav: 'お気に入り', reviewed: '感想あり',
  unreviewed: '感想なし', hidden: '非表示', stats: 'ボイスチャート', pending: '反映待ち',
  'g-library': 'ライブラリ', 'g-notion': 'Notion', 'g-folders': 'フォルダ', 'new-folder': '+ 新規',
  settings: '設定', 'tab-list': 'リスト', 'tab-search': '検索', 'tab-menu': 'ライブラリ', 'tab-settings': '設定',
  'pending-title': 'Notion反映待ち', 'stats-title': 'ボイスチャート', 'add': '+ 作品を追加',
};
const MENU_KO = {
  stats: '통계', pending: '반영 대기', 'g-library': '정리함', 'g-notion': '노션', 'g-folders': '내 폴더', 'new-folder': '+ 새 폴더',
  settings: '설정 · 노션 · 백업', 'tab-list': '목록', 'tab-search': '검색', 'tab-menu': '정리함', 'tab-settings': '설정',
  'pending-title': '노션 반영 대기', 'stats-title': '통계', 'add': '+ 작품 추가',
};
const menuText = (key) => (S.menuLang === 'en' ? MENU_EN[key] : S.menuLang === 'ja' ? MENU_JA[key] : MENU_KO[key] ?? (NAV.find((n) => n[0] === key) || [])[1]) || key;
function applyMenuLang() {
  document.querySelectorAll('[data-menu]').forEach((el) => { el.textContent = menuText(el.dataset.menu); });
  document.documentElement.classList.toggle('menu-en', S.menuLang === 'en');
  document.documentElement.lang = S.menuLang === 'ja' ? 'ja' : 'ko';
}
// 화면 모드: 시스템을 따르거나 라이트/다크로 고정
function applyTheme() {
  if (S.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = S.theme;
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
    : '<div class="nav-empty">폴더로 작품을 묶어 보세요.</div>';
}
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
  const name = await promptText('새 폴더', '폴더 이름');
  if (!name) return;
  try { S.folders = (await api('api/folders', { body: { name } })).folders; renderNav(); toast('폴더를 만들었어요.'); } catch (e) { fail(e); }
};

function renderSync() {
  const n = S.notion || {};
  let text = '노션 연결 안 됨';
  if (n.connected) {
    if (n.running) text = `노션에서 가져오는 중 · ${n.processed}개 확인`;
    else if (n.error) text = '노션 동기화 오류 · 설정에서 확인';
    else if (n.lastSync) text = '노션 동기화 · ' + new Date(n.lastSync).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    else text = '노션 연결됨';
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
    el.innerHTML = `<option value="">${label} · 전체</option>` +
      entries.map(([v, n]) => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(show(v))} (${n})</option>`).join('');
  };
  fill($('fActor'), '성우', count((w) => splitNames(w.actor)), S.actor, nameText);
  fill($('fCircle'), '서클', count((w) => splitNames(w.circle)), S.circle);
  fill($('fTag'), '장르', count((w) => w.tags), S.tag);
}

function filtered() {
  const q = S.q.trim().toLowerCase();
  let list = S.works.filter((w) => inView(S.nav, w));
  if (q) {
    const terms = q.split(/\s+/);
    list = list.filter((w) => {
      const hay = [w.title, w.titleKo, w.actor, w.circle, w.tags.join(' '), w.code, w.review, w.folder, w.date].join(' ').toLowerCase();
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
const marks = (w) => (w.hidden ? '<span class="tag-hidden">숨김</span>' : '') + (pendingTest(w) ? '<span class="dot-pending" title="노션 반영 대기"></span>' : '');
const starsHtml = (w) => (w.rating ? `<span class="stars-sm" aria-label="별점 ${w.rating}">${'★'.repeat(w.rating)}</span>` : '<span class="no-rating">별점 없음</span>');
function actorsBlock(w, max = 2) {
  const list = splitNames(w.actor);
  if (!list.length) return '<span class="muted-dash">—</span>';
  return list.slice(0, max).map((a) => `<div class="nm">${nameHtml(a)}</div>`).join('') + (list.length > max ? `<div class="nm-more">외 ${list.length - max}명</div>` : '');
}

// 넓을 때: 칸 나눔 + 별점·상태 바로 고르기
const TABLE_HEAD = '<div class="thead" aria-hidden="true"><span></span><span>작품</span><span>성우</span><span>서클</span><span>발매일</span><span>나의 기록</span><span></span></div>';
function tableRowHtml(w) {
  const sub = w.titleKo && w.title ? w.title : '';
  return `<div ${rowAttrs(w, 'trow')}>
    ${thumbHtml(w)}
    <div class="cell-title"><div class="row-title">${esc(displayTitle(w))}</div>${sub ? `<div class="row-orig">${esc(sub)}</div>` : ''}<div class="row-marks">${marks(w)}${w.tags.slice(0, 3).map((t) => `<span class="mini-tag">${esc(t)}</span>`).join('')}</div></div>
    <div class="cell-actor">${actorsBlock(w)}</div>
    <div class="cell-circle">${esc(splitNames(w.circle).join(', ')) || '<span class="muted-dash">—</span>'}</div>
    <div class="cell-date">${esc(w.date) || '<span class="muted-dash">—</span>'}</div>
    <div class="quick">
      <select data-quick="rating" aria-label="별점">${['별점 미기재', '★', '★★', '★★★', '★★★★', '★★★★★'].map((l, n) => `<option value="${n}"${n === w.rating ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select data-quick="status" aria-label="청취 상태">${[['', '상태 미기재'], ['미청취', '안 들음'], ['청취 중', '듣는 중'], ['청취 완료', '들음']].map(([v, l]) => `<option value="${v}"${v === w.status ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <button type="button" class="heart-btn${w.favorite ? ' on' : ''}" data-quick="fav" aria-label="즐겨찾기">${w.favorite ? '♥' : '♡'}</button>
  </div>`;
}
// 중간 폭: 제목 2줄 + 성우·서클
function twoRowHtml(w) {
  const actors = splitNames(w.actor);
  return `<div ${rowAttrs(w, 'two')}>
    ${thumbHtml(w)}
    <div class="row-main">
      <div class="row-title">${esc(displayTitle(w))}</div>
      <div class="meta">${actors.slice(0, 2).map((a) => `<span class="meta-actor">${nameHtml(a)}</span>`).join('')}${actors.length > 2 ? `<span class="nm-more">외 ${actors.length - 2}</span>` : ''}${w.circle ? `<span class="meta-circle">${esc(w.circle)}</span>` : ''}</div>
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
    <div class="card-cover">${thumbHtml(w)}${w.hidden ? '<span class="tag-hidden on-cover">숨김</span>' : ''}${w.favorite ? '<span class="card-heart">♥</span>' : ''}</div>
    <div class="row-title">${esc(displayTitle(w))}</div>
    <div class="row-sub">${esc(sub)}</div>
    <div class="card-foot">${starsHtml(w)}${pendingTest(w) ? '<span class="dot-pending" title="노션 반영 대기"></span>' : ''}</div>
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
  $('search').closest('.search').hidden = statsMode;
  if (statsMode) { $('viewTitle').textContent = menuText('stats-title'); $('viewCount').textContent = ''; renderStats(); return; }
  currentList = filtered();
  $('viewTitle').textContent = navLabel(S.nav);
  $('viewCount').textContent = currentList.length.toLocaleString();
  const activeCount = [S.actor, S.circle, S.tag, S.rating].filter((v) => v !== '').length;
  const active = !!S.q || activeCount > 0;
  $('resetFilters').hidden = !active;
  $('filterBtn').textContent = activeCount ? `필터 ${activeCount}` : '필터';
  $('filterBtn').classList.toggle('on', activeCount > 0);
  for (const [id, v] of [['fActor', S.actor], ['fCircle', S.circle], ['fTag', S.tag], ['fRating', S.rating]]) $(id).classList.toggle('on', v !== '');
  const list = $('list');
  list.className = 'list' + (S.view === 'grid' ? ' grid' : ' mode-' + S.listMode);
  if (!currentList.length) {
    list.innerHTML = '';
    $('listMore').innerHTML = active
      ? '<div class="empty"><strong>찾는 작품이 없어요</strong>검색어나 필터를 바꿔 보세요.</div>'
      : '<div class="empty"><strong>아직 작품이 없어요</strong>오른쪽 위 \'작품 추가\'로 시작해 보세요.</div>';
    return;
  }
  list.innerHTML = (S.view !== 'grid' && S.listMode === 'table' ? TABLE_HEAD : '') + currentList.slice(0, S.shown).map(itemHtml).join('');
  $('listMore').textContent = currentList.length > S.shown ? '아래로 내리면 더 보여요' : '';
}
// 스크롤 끝에 닿으면 더 그립니다.
new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting && currentList.length > S.shown) {
    const from = S.shown;
    S.shown += 80;
    $('list').insertAdjacentHTML('beforeend', currentList.slice(from, S.shown).map(itemHtml).join(''));
    $('listMore').textContent = currentList.length > S.shown ? '아래로 내리면 더 보여요' : '';
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
  dlg.innerHTML = `<div class="m-body-wrap"><div class="m-head"><h2>필터</h2><button type="button" class="close" data-close aria-label="닫기">×</button></div>
    <div class="m-body filter-body"></div>
    <div class="m-foot"><button type="button" class="link-btn" id="sheetReset">초기화</button><span class="spacer"></span><button type="button" class="primary-btn" data-close>적용</button></div></div>`;
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
  $('toggleHidden').title = S.showHidden ? '숨긴 작품을 목록에서 빼기' : '숨긴 작품도 목록에 보기';
}
document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => { S.view = b.dataset.view; rememberView(); renderViewTools(); renderList(); }));
$('toggleHidden').onclick = () => {
  S.showHidden = !S.showHidden;
  rememberView(); renderViewTools(); renderNav(); renderList();
  toast(S.showHidden ? '숨긴 작품도 목록에 보여요.' : '숨긴 작품은 목록에서 빠져요.');
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
  const pendingLabel = { title: '원제', titleKo: '한국어 제목', actor: '성우', circle: '서클', tags: '장르', date: '발매일', code: '코드', url: '판매 링크', review: '감상', status: '청취 상태', rating: '별점', lastPlayed: '청취일', favorite: '즐겨찾기', folder: '폴더', organize: '정리 상태', promo: '홍보 원문', translation: '번역' };
  let notionHtml = '';
  if (!S.notion.connected) notionHtml = '';
  else if (!w.notionPageId) notionHtml = `<div class="notion-bar"><span>노션에 아직 없는 작품이에요</span><button type="button" data-act="push">노션에 추가</button></div>`;
  else if ((w.pending || []).includes('unknown')) notionHtml = `<div class="notion-bar"><span>노션과 비교가 필요해요</span><button type="button" data-act="push">비교하기</button></div>`;
  else if (pending.length) notionHtml = `<div class="notion-bar"><span>노션과 다른 항목 ${pending.length}개 · ${esc(pending.slice(0, 3).map((k) => pendingLabel[k]).join(', '))}${pending.length > 3 ? ' 외' : ''}</span><button type="button" data-act="push">골라서 반영</button></div>`;
  else notionHtml = '<div class="notion-ok">노션과 같아요</div>';

  const hasT = !!w.translation, hasP = !!w.promo;
  let mode = S.introMode;
  if (mode === 'translation' && !hasT && hasP) mode = 'promo';
  if (mode === 'promo' && !hasP && hasT) mode = 'translation';
  if (mode === 'side' && !(hasT && hasP)) mode = hasT ? 'translation' : 'promo';
  let introBody;
  if (loading) introBody = '<p class="muted">불러오는 중…</p>';
  else if (!hasT && !hasP) introBody = '<p class="muted">소개글이 없어요. 정보 수정에서 판매 페이지 소개를 넣을 수 있어요.</p>';
  else if (mode === 'side') introBody = `<div>${renderIntro(w.promo)}</div><div>${renderIntro(w.translation)}</div>`;
  else introBody = renderIntro(mode === 'promo' ? w.promo : w.translation);

  d.innerHTML = `<div class="d-wrap">
    <div class="d-top">
      <button type="button" class="ghost-btn d-back" data-act="close" aria-label="${S.solo ? '창 닫기' : '닫기'}"><span class="lbl-back">${S.solo ? '✕ 창 닫기' : '‹ 목록'}</span><span class="lbl-close">✕ ${S.solo ? '창 닫기' : '닫기'}</span></button>
      ${S.solo ? '' : '<button type="button" class="ghost-btn d-pop" data-act="popout" title="이 작품을 새 창으로 열기">↗ 새 창</button>'}
      <div class="right">
        <button type="button" class="icon-btn${w.favorite ? ' on' : ''}" data-act="fav" aria-label="즐겨찾기" title="즐겨찾기">${w.favorite ? '♥' : '♡'}</button>
        <button type="button" class="ghost-btn${w.hidden ? ' on-warn' : ''}" data-act="hide" title="${w.hidden ? '다시 목록에 보이게' : '기록은 남기고 목록에서만 숨겨요'}">${w.hidden ? '숨김 해제' : '숨기기'}</button>
        <button type="button" class="ghost-btn" data-act="edit">정보 수정</button>
      </div>
    </div>
    <div class="d-hero">
      ${w.images?.[0] ? `<img class="d-cover" src="${esc(w.images[0])}" alt="표지" referrerpolicy="no-referrer" data-act="zoom" data-i="0" data-ph="${esc(w.code)}" data-color="${placeholderColor(w.id)}">` : `<div class="d-cover ph" style="background:${placeholderColor(w.id)}">${esc(w.code)}</div>`}
      <div class="d-titles">
        <div class="d-meta-top">${esc([w.circle, w.date].filter(Boolean).join(' · '))}</div>
        <h2 class="d-title">${esc(displayTitle(w))}</h2>
        ${w.titleKo && w.title ? `<div class="d-orig">${esc(w.title)}</div>` : ''}
      </div>
    </div>
    <div class="chips">
      ${actors.map((a) => `<button type="button" class="chip chip-name" data-filter="actor" data-v="${esc(a)}" title="이 성우 작품 보기">${nameHtml(a)}</button>`).join('')}
      ${splitNames(w.circle).map((c) => `<button type="button" class="chip" data-filter="circle" data-v="${esc(c)}" title="이 서클 작품 보기">${esc(c)}</button>`).join('')}
      ${w.date ? `<span class="chip">${esc(w.date)}</span>` : ''}
      ${w.code ? `<span class="chip">${esc(w.code)}</span>` : ''}
      ${w.tags.map((t) => `<button type="button" class="chip tag" data-filter="tag" data-v="${esc(t)}">${esc(t)}</button>`).join('')}
      ${w.folder ? `<span class="chip">폴더 · ${esc(w.folder)}</span>` : ''}
    </div>
    <div class="records">
      <div class="rec">
        <div class="rec-label">별점</div>
        <div class="stars" role="radiogroup" aria-label="별점">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="${n <= w.rating ? 'on' : ''}" data-star="${n}" aria-label="${n}점">★</button>`).join('')}</div>
      </div>
      <div class="rec">
        <div class="rec-label">청취</div>
        <div class="seg" role="radiogroup" aria-label="청취 상태">
          <button type="button" data-status="미청취" class="${status === '미청취' ? 'on' : ''}">안 들음</button>
          <button type="button" data-status="청취 중" class="${status === '청취 중' ? 'on' : ''}">듣는 중</button>
          <button type="button" data-status="청취 완료" class="${status === '청취 완료' ? 'on' : ''}">들음</button>
        </div>
        <label class="played-date">청취일 <input type="date" value="${esc(w.lastPlayed)}" data-act="played" aria-label="마지막 청취일"></label>
      </div>
    </div>
    <section class="review-card">
      <div class="sec-head"><h2>내 감상</h2><span class="hint" id="reviewState">눌러서 바로 쓰기</span></div>
      <textarea class="review-box" id="reviewBox" placeholder="목소리, 이야기, 마음에 남은 장면…">${esc(w.review)}</textarea>
      <div class="card-row">
        ${(w.reviewCard || []).length
          ? `<button type="button" class="card-thumb" data-act="cardzoom" title="대표 리뷰카드 크게 보기"><img src="${esc(w.reviewCard[0])}" alt="대표 리뷰카드"></button>
             <div class="card-acts"><span class="hint">대표 리뷰카드${w.reviewCard.length > 1 ? ` · ${w.reviewCard.length}장` : ''}</span>
             <div><button type="button" class="link-btn" data-act="card">다시 만들기 ↗</button> · <a class="link-btn" href="${esc(w.reviewCard[0])}" download="reviewcard-${esc(w.code || w.id)}.png">내려받기</a> · <button type="button" class="link-btn danger-link" data-act="carddel">빼기</button></div></div>`
          : '<button type="button" class="ghost-btn card-make" data-act="card">리뷰카드 만들기 ↗</button><span class="hint">감상과 작품 정보가 카드에 자동으로 들어가요</span>'}
      </div>
    </section>
    <section>
      <div class="sec-head"><h2>작품 소개</h2>
        ${hasT || hasP ? `<div class="tabs">${hasT ? `<button type="button" data-intro="translation" class="${mode === 'translation' ? 'on' : ''}">번역</button>` : ''}${hasP ? `<button type="button" data-intro="promo" class="${mode === 'promo' ? 'on' : ''}">원문</button>` : ''}${hasT && hasP ? `<button type="button" data-intro="side" class="${mode === 'side' ? 'on' : ''}">나란히</button>` : ''}</div>` : ''}
      </div>
      <div class="intro${mode === 'side' ? ' side' : ''}" id="intro">${introBody}</div>
      <button type="button" class="link-btn more-btn" id="introMore" hidden>더 보기</button>
    </section>
    ${w.images.length > 1 ? `<section><div class="sec-head"><h2>이미지 ${w.images.length}</h2></div><div class="gallery">${w.images.map((src, i) => `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-act="zoom" data-i="${i}">`).join('')}</div></section>` : ''}
    ${notionHtml}
    <div class="d-links">
      ${w.url ? `<a href="${esc(w.url)}" target="_blank" rel="noopener">판매 페이지 ↗</a>` : ''}
      ${w.notionPageId ? `<a href="https://www.notion.so/${esc(w.notionPageId.replace(/-/g, ''))}" target="_blank" rel="noopener">노션 원본 ↗</a>` : ''}
      <button type="button" data-act="history">수정 이력</button>
      ${S.notion.connected && w.notionPageId && !pending.length ? '<button type="button" data-act="push">노션과 비교</button>' : ''}
    </div>
  </div>`;
  const intro = $('intro');
  if (!loading && intro.scrollHeight > 300) { intro.classList.add('clamped'); $('introMore').hidden = false; }
  bindReview();
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
    toast('원래 창의 목록을 이 조건으로 걸렀어요.');
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
      const win = window.open((window.VB_CARD_URL || 'reviewcard') + '?work=' + encodeURIComponent(w.id), 'voicebox-card-' + w.id);
      if (!win) toast('새 탭이 막혔어요. 주소창 오른쪽의 팝업 허용을 눌러 주세요.', true);
      return;
    }
    case 'cardzoom': return openLightbox(w.reviewCard, 0);
    case 'carddel': {
      if (!confirm('대표 리뷰카드를 이 작품에서 뺄까요? (이미지 파일은 images 폴더에 남아요)')) return;
      return save(w.id, { reviewCard: [] });
    }
    case 'popout': {
      const win = window.open('./?work=' + encodeURIComponent(w.id), 'voicebox-' + w.id, 'width=760,height=920');
      if (!win) return toast('새 창이 막혔어요. 브라우저 주소창 오른쪽의 팝업 허용을 눌러 주세요.', true);
      if (!isNarrow()) closeDetail(); else backToList();
      return;
    }
    case 'fav': return save(w.id, { favorite: !w.favorite });
    case 'hide': {
      const hide = !w.hidden;
      await save(w.id, { hidden: hide });
      if (hide && !S.showHidden && S.nav !== 'hidden') {
        toast("목록에서 숨겼어요. 위의 '숨긴 작품' 버튼이나 왼쪽 '숨긴 작품'에서 다시 볼 수 있어요.");
      } else toast(hide ? '숨겼어요.' : '다시 목록에 보여요.');
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
    $('reviewState').textContent = '저장 중…';
    try {
      const full = await api('api/works/' + encodeURIComponent(id), { method: 'PATCH', body: { review: box.value } });
      replaceWork(full);
      if (S.selected === id) S.detail.review = full.review;
      const st = $('reviewState'); if (st) st.textContent = '저장됨';
      renderNav();
      refreshItem(id);
    } catch (e) { fail(e); }
  };
  box.addEventListener('input', () => { autosize(); $('reviewState').textContent = '입력 중…'; clearTimeout(reviewTimer); reviewTimer = setTimeout(commit, 900); });
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
    if (!quiet) toast('저장했어요.');
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
      <h2>${isNew ? '작품 추가' : '정보 수정'}</h2>
      <label class="ed-link"><span>판매 링크</span><input id="edUrl" value="${esc(ED.url)}" placeholder="https://www.dlsite.com/…/RJ01234567.html"></label>
      <button type="button" class="soft-btn" id="edFetch">정보 채우기</button>
      <button type="button" class="close" data-close aria-label="닫기">×</button>
    </div>
    <div class="ed-cols">
      <div class="ed-col">
        <div id="edDup" class="dup" hidden></div>
        <div class="sec-label">기본 정보</div>
        <label class="field">한국어 제목 · 목록에 먼저 보여요<input id="edTitleKo" value="${esc(ED.titleKo)}" placeholder="비워두면 원제로 보여요"></label>
        <label class="field">원제<input id="edTitle" value="${esc(ED.title)}"></label>
        <div class="grid2">
          <label class="field">성우 · 여러 명은 쉼표로<input id="edActor" value="${esc(ED.actor)}" list="actorList"></label>
          <label class="field">서클<input id="edCircle" value="${esc(ED.circle)}" list="circleList"></label>
          <label class="field">발매일<input id="edDate" type="date" value="${esc(ED.date)}"></label>
          <label class="field">작품 코드<input id="edCode" value="${esc(ED.code)}" placeholder="RJ01234567"></label>
        </div>
        <div class="field">장르<div class="tagbox" id="edTags"></div></div>
        <div class="grid2">
          <label class="field">폴더<select id="edFolder"><option value="">폴더 없음</option>${S.folders.map((f) => `<option${f === ED.folder ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></label>
          <label class="field">정리 상태<input id="edOrganize" value="${esc(ED.organize)}" list="organizeList"></label>
        </div>
        <div class="sec-label" style="margin-top:6px">이미지 · 첫 번째가 표지</div>
        <div class="img-edit" id="edImages"></div>
        <div class="set-row"><input class="input" id="edImgUrl" placeholder="이미지 주소 붙여넣기" style="flex:1;min-width:0"><button type="button" class="ghost-btn" id="edImgAdd">추가</button></div>
        <input type="file" id="edFile" accept="image/*" multiple hidden>
      </div>
      <div class="ed-col ed-intro">
        <div class="sec-head"><div class="sec-label">작품 소개</div>
          <div class="tabs"><button type="button" data-edtab="translation">한국어 번역</button><button type="button" data-edtab="promo">일본어 원문</button></div>
        </div>
        <label class="field" style="flex:1"><span id="edIntroLabel"></span><textarea id="edIntro"></textarea></label>
        <div class="ed-tools">
          <button type="button" class="link-btn" id="edExtract">원문에서 작품명·성우·발매일 찾기</button>
          <button type="button" class="link-btn" id="edCopyReq">ChatGPT 번역 요청 복사</button>
        </div>
        <div class="note">**굵게**, ### 제목, * 목록, --- 구분선은 상세 화면에서 정리돼 보여요.</div>
      </div>
    </div>
    <div class="m-foot">
      <label class="check"><input type="checkbox" id="edHidden"${ED.hidden ? ' checked' : ''}>목록에서 숨기기</label>
      ${S.notion.connected ? '<label class="check"><input type="checkbox" id="edPush">저장하면서 노션에도 반영</label>' : ''}
      ${isNew ? '' : '<button type="button" class="danger-btn" id="edDelete">삭제</button>'}
      <span class="spacer note">별점과 감상은 상세 화면에서 바로 써요</span>
      <button type="submit" class="primary-btn" id="edSave">저장</button>
    </div>
  </form>
  <datalist id="actorList">${[...new Set(S.works.flatMap((w) => splitNames(w.actor)))].slice(0, 2000).map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
  <datalist id="circleList">${[...new Set(S.works.flatMap((w) => splitNames(w.circle)))].map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
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
  ED[ED.introTab] = $('edIntro').value;
}
function renderEdTags() {
  const box = $('edTags');
  box.innerHTML = ED.tags.map((t, i) => `<span class="t">${esc(t)}<button type="button" data-rmtag="${i}" aria-label="${esc(t)} 빼기">×</button></span>`).join('') +
    '<input id="edTagInput" placeholder="입력 후 Enter" list="tagList">' +
    `<datalist id="tagList">${[...new Set(S.works.flatMap((w) => w.tags))].map((t) => `<option value="${esc(t)}">`).join('')}</datalist>`;
}
function renderEdImages() {
  $('edImages').innerHTML = ED.images.map((src, i) => `<div class="it">
      <img src="${esc(/^(https?:|\/|images\/|api\/|blob:)/.test(src) ? src : '')}" alt="" referrerpolicy="no-referrer" data-color="var(--chip)">
      ${i === 0 ? '<span class="cover-badge">표지</span>' : ''}
      <div class="acts">${i > 0 ? `<button type="button" data-cover="${i}" title="표지로">↑</button>` : ''}<button type="button" data-rmimg="${i}" title="빼기">×</button></div>
    </div>`).join('') + '<div class="drop" id="edDrop" tabindex="0">파일 선택<br>또는 끌어다 놓기</div>';
}
function renderEdIntro() {
  document.querySelectorAll('[data-edtab]').forEach((b) => b.classList.toggle('on', b.dataset.edtab === ED.introTab));
  $('edIntro').value = ED[ED.introTab] || '';
  $('edIntroLabel').textContent = ED.introTab === 'promo' ? '판매 페이지의 소개글을 그대로 붙여넣어요' : '번역문 · 직접 고칠 수 있어요';
}
function checkDuplicate() {
  const code = $('edCode').value.trim().toUpperCase();
  const url = $('edUrl').value.trim();
  const dup = S.works.find((w) => w.id !== ED.id && ((code && w.code === code) || (url && w.url === url)));
  $('edDup').hidden = !dup;
  if (dup) $('edDup').innerHTML = `이미 등록된 작품일 수 있어요: <strong>${esc(displayTitle(dup))}</strong>`;
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
  $('edImgAdd').onclick = () => { const v = $('edImgUrl').value.trim(); if (/^https?:\/\//.test(v)) { ED.images.push(v); $('edImgUrl').value = ''; renderEdImages(); } else toast('http로 시작하는 이미지 주소를 넣어 주세요.', true); };
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
    if (!url) return toast('판매 페이지 링크를 먼저 넣어 주세요.', true);
    const btn = $('edFetch');
    btn.disabled = true; btn.textContent = '가져오는 중…';
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
      if (info.promo && !ED.promo) { ED.promo = info.promo; filled.push('promo'); if (ED.introTab === 'promo') $('edIntro').value = info.promo; }
      for (const src of info.images || []) if (!ED.images.includes(src)) { ED.images.push(src); filled.push('image'); }
      renderEdImages();
      checkDuplicate();
      toast(filled.length ? `${filled.length}개 항목을 채웠어요. 확인해 주세요.` : '새로 채울 항목이 없어요. (이미 입력된 칸은 그대로 둬요)');
    } catch (e) { fail(e); } finally { btn.disabled = false; btn.textContent = '정보 채우기'; }
  };
  $('edExtract').onclick = () => {
    readEdForm();
    const info = extractInfo(ED.promo || $('edIntro').value);
    let n = 0;
    if (info.title && !ED.title) { $('edTitle').value = info.title; n++; }
    if (info.actor && !ED.actor) { $('edActor').value = info.actor; n++; }
    if (info.date && !ED.date) { $('edDate').value = info.date; n++; }
    toast(n ? `${n}개 항목을 찾았어요.` : '원문에서 새로 찾은 항목이 없어요.');
  };
  $('edCopyReq').onclick = async () => {
    readEdForm();
    if (!ED.promo) return toast('일본어 원문을 먼저 넣어 주세요.', true);
    const req = '아래 일본어 시추에이션 보이스 작품 소개를 자연스러운 한국어로 번역해 줘. 줄바꿈과 목록 구조는 유지하고, 인명은 한국어 발음 뒤에 괄호로 원문을 붙여 줘. 번역문만 답해 줘.\n\n' + ED.promo;
    try { await navigator.clipboard.writeText(req); toast('번역 요청을 복사했어요. ChatGPT에 붙여넣은 뒤 결과를 번역 탭에 넣어 주세요.'); }
    catch { toast('복사하지 못했어요.', true); }
  };
  $('edDelete') && ($('edDelete').onclick = async () => {
    if (!confirm(`'${displayTitle(ED)}'을(를) 로컬에서 삭제할까요? 노션 페이지는 그대로 남아요.`)) return;
    try {
      await api('api/works/' + encodeURIComponent(ED.id), { method: 'DELETE' });
      S.works = S.works.filter((w) => w.id !== ED.id);
      dlg.close();
      closeDetail();
      renderNav(); renderList();
      toast('삭제했어요. 수정 이력에는 남아 있어요.');
    } catch (e) { fail(e); }
  });
  $('edForm').onsubmit = async (e) => {
    e.preventDefault();
    readEdForm();
    if (!ED.title && !ED.titleKo) { $('edTitle').focus(); return toast('작품명을 입력해 주세요.', true); }
    const body = { url: ED.url, titleKo: ED.titleKo, title: ED.title, actor: ED.actor, circle: ED.circle, date: ED.date, code: ED.code, tags: ED.tags, images: ED.images, promo: ED.promo, translation: ED.translation, folder: ED.folder, hidden: ED.hidden, organize: ED.organize };
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
      toast(ED.isNew ? '작품을 추가했어요.' : '저장했어요.');
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
const fmt = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? '예' : '아니오') : typeof v === 'number' ? (v ? '★'.repeat(v) : '없음') : v) || '(비어 있음)';
async function openPush(id) {
  const dlg = $('pushDialog');
  if (!S.notion.connected) { toast('먼저 설정에서 노션을 연결해 주세요.', true); return openSettings(); }
  dlg.innerHTML = `<div class="m-body-wrap"><div class="m-head"><h2>노션에 반영</h2><button type="button" class="close" data-close aria-label="닫기">×</button></div><div class="m-body"><p class="note">노션의 현재 내용과 비교하고 있어요…</p></div></div>`;
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
      <input type="checkbox" data-pick="${c.key}"${p.pick.has(c.key) ? ' checked' : ''} aria-label="${esc(c.label)} 반영">
      <div>
        <div class="push-label">${esc(c.label)}
          ${c.conflict ? '<span class="pill warn">노션에서도 바뀜</span>' : c.notionChanged ? '<span class="pill">노션에서 바뀜</span>' : c.suggested ? '<span class="pill ok">로컬에서 고침</span>' : ''}
        </div>
        <div class="push-vals"><div><small>로컬 (이 컴퓨터)</small>${lv}</div><div><small>노션 (지금)</small>${p.newPage ? '(새 페이지)' : nv}</div></div>
        ${p.newPage ? '' : `<button type="button" class="pull-btn${p.pull.has(c.key) ? ' on' : ''}" data-pull="${c.key}">${p.pull.has(c.key) ? '✓ 노션 값을 로컬로 가져와요' : '대신 노션 값을 로컬로 가져오기'}</button>`}
      </div>
    </div>`; }).join('');
  const count = p.pick.size + p.pull.size;
  dlg.innerHTML = `<div class="m-body-wrap">
    <div class="m-head"><h2>노션에 반영</h2><button type="button" class="close" data-close aria-label="닫기">×</button></div>
    <div class="m-body">
      ${p.newPage ? '<div class="banner">노션 CD LIST에 새 페이지를 만들어요. 넣을 항목을 골라 주세요.</div>' : ''}
      ${!p.changes.length ? '<div class="banner ok">노션과 내용이 같아요. 반영할 것이 없어요.</div>' : ''}
      ${p.changes.some((c) => c.conflict) ? '<div class="banner warn">노션에서도 바뀐 항목이 있어요. 어느 쪽을 남길지 확인해 주세요. (기본으로 선택하지 않았어요)</div>' : ''}
      <div>${rows}</div>
    </div>
    <div class="m-foot">
      ${p.notionUrl ? `<a class="note" href="${esc(p.notionUrl)}" target="_blank" rel="noopener">노션에서 열기 ↗</a>` : ''}
      <span class="spacer"></span>
      <button type="button" class="ghost-btn" data-close>취소</button>
      <button type="button" class="primary-btn" id="pushApply"${count ? '' : ' disabled'}>${p.pull.size && !p.pick.size ? '로컬에 가져오기' : `선택한 ${count}개 반영`}</button>
    </div></div>`;
  dlg.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dlg.close()));
  dlg.querySelectorAll('[data-pick]').forEach((el) => (el.onchange = () => { const k = el.dataset.pick; el.checked ? (p.pick.add(k), p.pull.delete(k)) : p.pick.delete(k); renderPush(); }));
  dlg.querySelectorAll('[data-pull]').forEach((el) => (el.onclick = () => { const k = el.dataset.pull; if (p.pull.has(k)) p.pull.delete(k); else { p.pull.add(k); p.pick.delete(k); } renderPush(); }));
  const btn = $('pushApply');
  if (btn) btn.onclick = async () => {
    btn.disabled = true; btn.textContent = '반영 중…';
    try {
      const r = await api('api/notion/apply', { body: { token: p.token, keys: [...p.pick], pullKeys: [...p.pull] } });
      dlg.close();
      const full = await api('api/works/' + encodeURIComponent(p.id));
      replaceWork(full);
      renderNav();
      renderList();
      if (S.selected === p.id) renderDetail();
      toast([r.pushed?.length ? `노션에 ${r.pushed.length}개 반영` : '', r.pulled?.length ? `노션 값 ${r.pulled.length}개 가져옴` : '', r.skipped?.length ? `노션에 없는 항목 ${r.skipped.length}개는 건너뜀` : ''].filter(Boolean).join(' · ') || '완료했어요.');
    } catch (e) {
      btn.disabled = false; btn.textContent = '다시 시도';
      fail(e);
      if (/다시 비교/.test(e.message)) openPush(p.id);
    }
  };
}

/* ================= 설정 ================= */
let settingsTimer;
async function openSettings() {
  const dlg = $('settings');
  const n = await api('api/notion/status').catch(() => S.notion);
  S.notion = n;
  const img = await api('api/images/status').catch(() => ({}));
  const total = S.works.reduce((a, w) => a + w.images.length, 0);
  dlg.innerHTML = `<div class="m-body-wrap">
    <div class="m-head"><h2>설정</h2><button type="button" class="close" data-close aria-label="닫기">×</button></div>
    <div class="m-body">
      ${n.unsupported ? `<div class="set-block"><h3>이 기기의 기록</h3>
        <div class="note">폰 버전은 모든 기록을 이 기기 안에 저장해요. 다른 기기와 옮길 때는 아래 '복원용 백업'을 내보내고, 받는 쪽에서 '백업에서 복원 → 합치기'를 고르세요. 노션 연동은 다음 버전에서 추가할 예정이에요.</div></div>` : `<div class="set-block">
        <h3>노션 연결</h3>
        ${n.connected ? `<div class="banner ok">CD LIST에 연결돼 있어요.</div>
          <div class="note" id="syncState">${syncText(n)}</div>
          <div class="progress" id="syncBar" ${n.running ? '' : 'hidden'}><div style="width:${n.running ? 50 : 0}%"></div></div>
          <div class="set-row"><button type="button" class="ghost-btn" id="syncNow">지금 노션에서 가져오기</button><button type="button" class="danger-btn" id="disconnect">연결 해제</button></div>
          <div class="note">가져오기는 로컬에서 고치지 않은 항목만 노션 값으로 바꿔요. 로컬에서 고친 항목은 '반영 대기'에 남고, 작품마다 골라서 노션에 반영해요.</div>`
        : `<div class="note">노션 '내부 연결(integration)'의 키를 넣어 주세요. 키는 이 컴퓨터의 data/config.json에만 저장돼요.<br>
            키 만들기: <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noopener">notion.so/profile/integrations ↗</a> → CD LIST와 성우·서클·태그 DB에 연결 허용(읽기·업데이트·삽입)</div>
          <div class="set-row"><input class="input" id="tokenInput" type="password" placeholder="ntn_… 또는 secret_…" style="flex:1;min-width:0" autocomplete="off"><button type="button" class="primary-btn" id="connect">연결</button></div>`}
      </div>`}
      <div class="set-block"${img.unsupported ? ' hidden' : ''}>
        <h3>이미지 내려받기</h3>
        <div class="note">판매 사이트·노션에 있는 표지와 이미지를 이 컴퓨터의 images 폴더에 저장해요. 판매 페이지가 내려가도 계속 볼 수 있어요.</div>
        <div class="note" id="imgState">${imgText(img, total)}</div>
        <div class="progress" id="imgBar" ${img.running ? '' : 'hidden'}><div style="width:${img.total ? Math.round(img.done / img.total * 100) : 0}%"></div></div>
        <div class="set-row"><button type="button" class="ghost-btn" id="imgCovers">표지만 받기</button><button type="button" class="ghost-btn" id="imgAll">모든 이미지 받기</button></div>
      </div>
      <div class="set-block">
        <h3>보기</h3>
        <div class="note">성우 이름 표시 (데이터에 '六条銀 로쿠조 긴'처럼 함께 들어 있는 이름 기준)</div>
        <div class="tabs name-mode" role="radiogroup" aria-label="성우 이름 표시">
          ${[['both', '일본어 + 한국어'], ['ja', '일본어만'], ['ko', '한국어만']].map(([v, l]) => `<button type="button" data-name-mode="${v}" class="${S.nameMode === v ? 'on' : ''}">${l}</button>`).join('')}
        </div>
        <div class="note" style="margin-top:6px">메뉴 이름</div>
        <div class="tabs" role="radiogroup" aria-label="메뉴 이름 언어">
          ${[['ko', '한국어'], ['en', 'English'], ['ja', '日本語']].map(([v, l]) => `<button type="button" data-menu-lang="${v}" class="${S.menuLang === v ? 'on' : ''}">${l}</button>`).join('')}
        </div>
        <div class="note" style="margin-top:6px">화면 모드</div>
        <div class="tabs" role="radiogroup" aria-label="화면 모드">
          ${[['system', '시스템 설정 따르기'], ['light', '라이트'], ['dark', '다크']].map(([v, l]) => `<button type="button" data-theme-mode="${v}" class="${S.theme === v ? 'on' : ''}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="set-block">
        <h3>보기 좋은 백업</h3>
        <div class="note">보관하거나 다른 프로그램에서 보는 용도예요. 이 파일로는 앱을 되돌릴 수 없어요.</div>
        <div class="set-row">
          <a class="ghost-btn" href="api/export/works.xlsx" download>엑셀 (.xlsx)</a>
          <a class="ghost-btn" href="api/export/works.csv" download>CSV</a>
          <a class="ghost-btn" href="api/export/reviews.html" target="_blank" rel="noopener">감상 모음 문서 ↗</a>
        </div>
        <div class="note">엑셀: 작품 목록 · 감상 · 통계 · 요약 시트 / 감상 모음 문서: 새 탭에서 열린 뒤 '인쇄 / PDF로 저장'</div>
      </div>
      <div class="set-block">
        <h3>복원용 백업 (JSON)</h3>
        <div class="note">${window.VB_MOBILE ? '앱을 그대로 되돌리거나 다른 기기로 옮길 때 쓰는 파일이에요. 폰 기록은 이 기기 안에만 있으니 가끔 받아 두세요.' : '앱을 그대로 되돌릴 때 쓰는 파일이에요. 노션 연결키는 들어가지 않아요. 모든 데이터는 VOICE-BOX 폴더 안 data 폴더에도 있어서, 폴더째 복사해 두면 그것도 백업이 돼요.'}</div>
        <div class="set-row"><a class="ghost-btn" href="api/backup" download>복원용 백업 받기</a><label class="ghost-btn">백업에서 복원<input type="file" id="restoreFile" accept=".json,application/json" hidden></label></div>
      </div>
    </div></div>`;
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  if (!dlg.open) dlg.showModal();
  $('connect') && ($('connect').onclick = async () => {
    try { await api('api/notion/connect', { body: { token: $('tokenInput').value } }); toast('노션에 연결했어요. 바뀐 내용을 가져올게요.'); await api('api/notion/sync', { body: {} }); openSettings(); pollSync(); } catch (e) { fail(e); }
  });
  $('disconnect') && ($('disconnect').onclick = async () => {
    if (!confirm('노션 연결을 해제할까요? 로컬 데이터는 그대로 남아요.')) return;
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
    applyMenuLang(); renderNav(); renderList();
  }));
  $('imgCovers').onclick = () => startImages(true);
  $('imgAll').onclick = () => startImages(false);
  $('restoreFile').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const count = data.works?.length ?? 0;
      let merge = confirm(`백업의 작품 ${count}개를 지금 기록과 합칠까요?\n\n[확인] 합치기 — 같은 작품은 최근에 고친 쪽을 남기고, 없는 작품은 추가해요. (다른 기기에서 고친 내용을 가져올 때)\n[취소] 다른 방법 고르기`);
      if (!merge && !confirm(`지금 기록을 백업 내용(${count}개)으로 전부 바꿀까요?\n지금 기록은 따로 보관돼요.`)) return;
      const r = await api('api/restore', { body: { ...data, merge } });
      toast(merge ? `합쳤어요 · 새 작품 ${r.added}개, 바뀐 작품 ${r.updated}개` : '복원했어요.');
      dlg.close();
      load();
    } catch (err) { fail(err); }
  };
  if (n.running) pollSync();
  if (img.running) pollImages(total);
}
const syncText = (n) => n.running ? `가져오는 중 · ${n.processed}개 확인 (새 작품 ${n.added}, 바뀐 작품 ${n.updated})`
  : n.error ? '오류: ' + n.error
    : n.lastSync ? `마지막 가져오기: ${new Date(n.lastSync).toLocaleString('ko-KR')}${n.finishedAt && n.processed ? ` · 새 작품 ${n.added}, 바뀐 작품 ${n.updated}` : ''}` : '아직 가져온 적 없어요.';
const imgText = (s, total) => s.running ? `받는 중 · ${s.done}/${s.total} (실패 ${s.failed})`
  : `저장된 이미지 ${s.cached ?? 0}개 / 전체 ${total}개${s.total ? ` · 지난번: ${s.saved}개 저장, ${s.failed}개 실패` : ''}${s.failures?.length ? `<br>실패 예: ${esc(s.failures[0].error)}` : ''}`;
async function pollSync() {
  clearTimeout(settingsTimer);
  try {
    const n = await api('api/notion/status');
    S.notion = n;
    renderSync();
    if ($('syncState')) { $('syncState').textContent = syncText(n); $('syncBar').hidden = !n.running; }
    if (n.running) settingsTimer = setTimeout(pollSync, 1500);
    else { if (n.error) toast('노션 가져오기 오류: ' + n.error, true); else if (n.added || n.updated) toast(`노션에서 새 작품 ${n.added}개, 바뀐 작품 ${n.updated}개를 가져왔어요.`); load(); }
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
  else { toast(`이미지 ${s.saved}개를 저장했어요.${s.failed ? ` ${s.failed}개는 받지 못했어요.` : ''}`); load(); }
}
$('openSettings').onclick = () => openSettings();

/* ================= 수정 이력 ================= */
const FIELD_KO = { title: '원제', titleKo: '한국어 제목', actor: '성우', circle: '서클', tags: '장르', date: '발매일', code: '코드', url: '판매 링크', images: '이미지', status: '청취 상태', rating: '별점', lastPlayed: '청취일', favorite: '즐겨찾기', hidden: '숨김', folder: '폴더', organize: '정리 상태', review: '감상', promo: '홍보 원문', translation: '번역' };
async function openHistory(id) {
  const dlg = $('historyDialog');
  const list = await api(`api/works/${encodeURIComponent(id)}/history`).catch((e) => (fail(e), []));
  const item = (h) => {
    const keys = Object.keys(h.data || {}).filter((k) => FIELD_KO[k]);
    const preview = keys.slice(0, 6).map((k) => `${FIELD_KO[k]}: ${esc(String(fmt(h.data[k])).slice(0, 40))}`).join(' · ');
    return `<div class="hist"><div class="hist-head"><span>${esc(h.reason)} · ${new Date(h.at).toLocaleString('ko-KR')}</span>${keys.length ? `<button type="button" class="link-btn" data-restore="${esc(h.at)}">이 전 상태로 되돌리기</button>` : ''}</div><div class="hist-fields">${preview || '변경 내용 없음'}</div></div>`;
  };
  dlg.innerHTML = `<div class="m-body-wrap"><div class="m-head"><h2>수정 이력</h2><button type="button" class="close" data-close aria-label="닫기">×</button></div>
    <div class="m-body"><div class="note">각 기록에는 바뀌기 전 값이 남아 있어요. 되돌리면 그 값으로 다시 저장돼요.</div>${list.length ? list.map(item).join('') : '<div class="note">아직 기록이 없어요.</div>'}</div></div>`;
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  dlg.querySelectorAll('[data-restore]').forEach((b) => (b.onclick = async () => {
    if (!confirm('이 기록의 값으로 되돌릴까요?')) return;
    try { const full = await api(`api/works/${encodeURIComponent(id)}/restore`, { body: { at: b.dataset.restore } }); replaceWork(full); dlg.close(); renderNav(); renderList(); renderDetail(); toast('되돌렸어요.'); } catch (e) { fail(e); }
  }));
  dlg.showModal();
}

/* ================= 기타 ================= */
function openLightbox(list, i) {
  const dlg = $('lightbox');
  const show = () => {
    dlg.innerHTML = `<img src="${esc(list[i])}" alt="" referrerpolicy="no-referrer">${list.length > 1 ? `<div class="lb-nav"><button type="button" data-d="-1">‹ 이전</button><button type="button" data-d="0">닫기</button><button type="button" data-d="1">다음 ›</button></div>` : ''}`;
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
      <div class="m-foot"><span class="spacer"></span><button type="button" class="ghost-btn" value="cancel" id="promptCancel">취소</button><button class="primary-btn" value="ok">확인</button></div></form>`;
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
  const next = await promptText('폴더 이름 바꾸기', '새 이름 (비우고 확인하면 폴더 삭제)', name);
  try {
    if (next === name) return;
    if (!next) { if (!confirm(`'${name}' 폴더를 삭제할까요? 작품은 지워지지 않아요.`)) return; S.folders = (await api('api/folders/' + encodeURIComponent(name), { method: 'DELETE' })).folders; S.nav = 'all'; }
    else { S.folders = (await api('api/folders/' + encodeURIComponent(name), { method: 'PATCH', body: { name: next } })).folders; S.nav = 'folder:' + next; }
    await load();
  } catch (err) { fail(err); }
});

// 폰 하단 탭
function closeSidebar() { $('sidebar').classList.remove('open'); if ($('detail').hidden) $('scrim').hidden = true; }
$('tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const tab = b.dataset.tab;
  if (tab === 'list') { $('main').scrollTo({ top: 0, behavior: 'smooth' }); }
  if (tab === 'search') { $('search').focus(); }
  if (tab === 'menu') { $('sidebar').classList.add('open'); $('scrim').hidden = false; }
  if (tab === 'settings') openSettings();
});

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
  ['actor', '성우별', (w) => splitNames(w.actor)],
  ['circle', '서클별', (w) => splitNames(w.circle)],
  ['tag', '장르별', (w) => w.tags],
  ['year', '발매 연도', (w) => (w.date ? [w.date.slice(0, 4)] : [])],
  ['rating', '별점', (w) => [w.rating ? '★'.repeat(w.rating) : '별점 없음']],
  ['status', '청취 상태', (w) => [{ '미청취': '안 들음', '청취 중': '듣는 중', '청취 완료': '들음' }[w.status] || '상태 미기재']],
];
const STAT_SCOPES = [
  ['all', '전체 작품', () => true],
  ['played', '들은 작품', (w) => w.status === '청취 완료' || w.status === '청취 중'],
  ['rated', '별점 준 작품', (w) => w.rating > 0],
  ['reviewed', '감상 쓴 작품', (w) => !!w.review],
];
const STAT_COLORS = ['#B48AD8', '#E2C26E', '#DE7A6B', '#86BE94', '#6FB3CF', '#D88CAA', '#7F9BE0', '#D49A5E', '#9AC7A8', '#C59BD8', '#E5A3B5', '#84C3C0'];
S.statKind = 'actor';
S.statScope = 'all';
S.statMore = false;
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
  if (rest) parts.push({ key: '그 외', n: rest, color: 'var(--line)', other: true });
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
    return `<path d="${d}" fill="${x.color}" ${x.other ? '' : `data-stat-key="${esc(x.key)}"`} class="seg"><title>${esc(label)} · ${x.n}개 (${(x.n / total * 100).toFixed(1)}%)</title></path>`;
  }).join('');
  return { svg: `<svg viewBox="0 0 300 300" class="donut" role="img" aria-label="${esc(STAT_KINDS.find((k) => k[0] === S.statKind)[1])} 비율">${segs}
    <text x="150" y="146" text-anchor="middle" class="donut-num">${total.toLocaleString()}</text>
    <text x="150" y="172" text-anchor="middle" class="donut-label">작품</text></svg>`, parts };
}

function renderStats() {
  const { works, rows, none } = statData();
  const total = works.length;
  const kindLabel = STAT_KINDS.find((k) => k[0] === S.statKind)[1];
  const played = works.filter((w) => w.status === '청취 완료' || w.status === '청취 중').length;
  const rated = works.filter((w) => w.rating);
  const avg = rated.length ? (rated.reduce((a, w) => a + w.rating, 0) / rated.length).toFixed(1) : '–';
  const { svg, parts } = donutSvg(rows, total);
  const colorOf = new Map(parts.map((p) => [p.key, p.color]));
  const max = rows[0]?.n || 1;
  const limit = S.statMore ? rows.length : 30;
  const nameCell = (key) => (S.statKind === 'actor' ? nameHtml(key) : `<span class="nm-ja">${esc(key)}</span>`);
  $('stats').innerHTML = `
    <div class="stat-cards">
      <div class="stat-card"><div class="sc-label">작품</div><div class="sc-num">${total.toLocaleString()}</div></div>
      <div class="stat-card"><div class="sc-label">들은 작품</div><div class="sc-num">${played.toLocaleString()}</div></div>
      <div class="stat-card"><div class="sc-label">별점 준 작품</div><div class="sc-num">${rated.length.toLocaleString()}</div></div>
      <div class="stat-card"><div class="sc-label">평균 별점</div><div class="sc-num">${avg}</div></div>
    </div>
    <div class="stat-tools">
      <div class="tabs stat-kind" role="tablist">${STAT_KINDS.map(([k, l]) => `<button type="button" data-stat-kind="${k}" class="${S.statKind === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <select id="statScope" aria-label="통계 범위">${STAT_SCOPES.map(([k, l]) => `<option value="${k}"${S.statScope === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="stat-body">
      <div class="donut-wrap">${svg}</div>
      <div class="stat-legend">
        <div class="note">${kindLabel} ${rows.length.toLocaleString()}개${none ? ` · 정보 없는 작품 ${none}개` : ''}${['actor', 'tag'].includes(S.statKind) ? ' · 여러 명(개)이 들어간 작품은 각각에 모두 셌어요' : ''}</div>
        ${rows.slice(0, limit).map((x, i) => `<button type="button" class="leg-row" data-stat-key="${esc(x.key)}" title="이 조건의 작품 보기">
          <span class="leg-rank">${i + 1}</span>
          <span class="leg-dot" style="background:${colorOf.get(x.key) || 'var(--line)'}"></span>
          <span class="leg-name">${nameCell(x.key)}</span>
          <span class="leg-bar"><span style="width:${Math.max(2, Math.round(x.n / max * 100))}%;background:${colorOf.get(x.key) || 'var(--muted)'}"></span></span>
          <span class="leg-n">${x.n}</span>
          <span class="leg-p">${(x.n / (total || 1) * 100).toFixed(1)}%</span>
        </button>`).join('')}
        ${rows.length > 30 ? `<button type="button" class="link-btn" id="statMore">${S.statMore ? '접기' : `전체 ${rows.length}개 보기`}</button>` : ''}
      </div>
    </div>`;
}
const rememberStats = () => { try { localStorage.setItem('voicebox.stats', JSON.stringify({ kind: S.statKind, scope: S.statScope })); } catch {} };
$('stats').addEventListener('click', (e) => {
  const kind = e.target.closest('[data-stat-kind]');
  if (kind) { S.statKind = kind.dataset.statKind; S.statMore = false; rememberStats(); return renderStats(); }
  if (e.target.id === 'statMore') { S.statMore = !S.statMore; return renderStats(); }
  const keyEl = e.target.closest('[data-stat-key]');
  if (!keyEl) return;
  // 그 조건으로 목록 보기
  const key = keyEl.dataset.statKey;
  resetFilters();
  S.nav = { played: 'played', reviewed: 'reviewed' }[S.statScope] || 'all';
  if (S.statKind === 'actor' || S.statKind === 'circle' || S.statKind === 'tag') S[S.statKind] = key;
  if (S.statKind === 'year') { S.q = key + '-'; $('search').value = S.q; }
  if (S.statKind === 'rating') S.rating = key === '별점 없음' ? '0' : String(key.length);
  if (S.statKind === 'status') S.nav = { '들음': 'played', '듣는 중': 'played', '안 들음': 'unplayed', '상태 미기재': 'unplayed' }[key];
  fillFilterOptions();
  renderNav();
  renderList();
  $('main').scrollTop = 0;
  if (S.statKind === 'rating' && S.rating !== '0' && S.rating !== '5') toast(`★${S.rating} 이상인 작품이에요.`);
});
$('stats').addEventListener('change', (e) => { if (e.target.id === 'statScope') { S.statScope = e.target.value; rememberStats(); renderStats(); } });

// 새 창으로 연 경우: 그 작품의 상세만 크게 보여줍니다.
if (S.solo) document.body.classList.add('solo');
load().then(() => {
  if (S.solo) {
    select(S.solo, { push: false }).then(() => { if (S.detail) document.title = displayTitle(S.detail) + ' · VOICE BOX'; });
  }
  if (S.notion.running) pollSync();
}).catch((e) => {
  $('listMore').innerHTML = `<div class="empty"><strong>데이터를 불러오지 못했어요</strong>${esc(e.message)}</div>`;
});

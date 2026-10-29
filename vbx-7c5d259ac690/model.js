// 작품 데이터의 모양을 한곳에서 정합니다.
// works.json의 각 작품은 아래 필드만 가집니다.

// 노션과 주고받는 필드 (이미지는 노션에서 가져오기만 합니다)
export const SYNC_FIELDS = [
  'title', 'titleKo', 'actor', 'circle', 'tags', 'date', 'code', 'url',
  'review', 'status', 'rating', 'lastPlayed', 'favorite', 'folder',
  'organize', 'promo', 'translation',
  'purchaseDate', 'store', 'listPrice', 'paidPrice', 'currency', 'workType', 'salePrice', 'discountNote',
];

export const FIELD_LABELS = {
  title: '원제 → Name',
  titleKo: '한국어 제목 → 한국어 제목',
  actor: '성우 → Voice Actors',
  circle: '서클 → Bland / circle',
  tags: '장르 → Tag',
  date: '발매일 → Released',
  code: '작품 코드 → 작품 코드',
  url: '판매 링크 → 판매 링크',
  review: '감상 → Short Review',
  status: '청취 상태 → Status',
  rating: '별점 → Rating',
  lastPlayed: '마지막 청취일 → Last Played',
  favorite: '즐겨찾기 → 즐겨찾기',
  folder: '폴더 → 폴더',
  organize: '정리 상태 → 정리 상태',
  promo: '홍보 원문 → 본문 [원문] 토글',
  translation: '번역 → 본문 번역본 토글',
  purchaseDate: '구매일 → 구매일',
  store: '구매처 → 구매처',
  listPrice: '정가 → 정가',
  paidPrice: '구매가 → 구매가',
  currency: '통화 → 통화',
  workType: '구분(동인/상업) → 구분',
  salePrice: '할인가 → 할인가',
  discountNote: '쿠폰·묶음 메모 → 할인 메모',
};

// 청취 상태: 로컬 값 ↔ 노션 Status 값
export const STATUS_TO_NOTION = {
  '미청취': '🔇 Unplayed',
  '청취 중': '▶️ Listening',
  '청취 완료': '🎧 Played',
};
export const STATUS_FROM_NOTION = Object.fromEntries(
  Object.entries(STATUS_TO_NOTION).map(([a, b]) => [b, a]),
);

const str = (v) => (v == null ? '' : String(v)).trim();
const list = (v) =>
  [...new Set((Array.isArray(v) ? v : String(v || '').split(','))
    .map((x) => String(x).trim()).filter(Boolean))];

export function normalizeDate(v) {
  const s = str(v);
  if (!s) return '';
  const m = s.match(/^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

const money = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
export const CURRENCIES = ['JPY', 'KRW', 'USD'];
// 구매처 기본 목록 (직접 입력도 돼요)
export const STORES = ['DLsite', '포케도라', '스텔라워스', '애니메이트'];
// 동인 / 상업 구분
export const WORK_TYPES = ['동인', '상업'];
// 작품 코드와 판매 링크로 동인/상업을 짐작해요. (DLsite: RJ·maniax/girls/bl/home = 동인, VJ·BJ·pro/girls-pro/bl-pro/soft/books = 상업)
export function guessWorkType(w = {}) {
  const code = str(w.code).toUpperCase();
  if (/^RJ\d/.test(code)) return '동인';
  if (/^(VJ|BJ)\d/.test(code)) return '상업';
  const m = str(w.url).match(/dlsite\.com\/([a-z-]+)\//i);
  if (!m) return '';
  const floor = m[1].toLowerCase();
  if (/^(maniax|girls|bl|home|ai)$/.test(floor)) return '동인';
  if (/(^pro$|-pro$|^soft$|^books$|^comic$|-drama$|^appx$)/.test(floor)) return '상업';
  return '';
}

export function normalizeWork(w = {}) {
  const rating = Math.round(Number(w.rating) || 0);
  return {
    id: str(w.id),
    notionPageId: str(w.notionPageId),
    code: str(w.code).toUpperCase(),
    title: str(w.title),
    titleKo: str(w.titleKo),
    actor: str(w.actor),
    circle: str(w.circle),
    tags: list(w.tags),
    date: normalizeDate(w.date),
    url: str(w.url),
    images: list(w.images),
    reviewCard: list(w.reviewCard), // 대표 리뷰카드 이미지 (카드가 길면 여러 장)
    status: ['미청취', '청취 중', '청취 완료'].includes(str(w.status)) ? str(w.status) : '',
    rating: rating >= 1 && rating <= 5 ? rating : 0,
    lastPlayed: normalizeDate(w.lastPlayed),
    favorite: !!w.favorite,
    hidden: !!w.hidden,
    noStats: !!w.noStats, // 통계에서 빼기 (작품 통계만, 지출은 그대로) · 노션에는 보내지 않아요
    folder: str(w.folder),
    organize: str(w.organize),
    review: String(w.review || '').trim(),
    promo: String(w.promo || '').trim(),
    translation: String(w.translation || '').trim(),
    // 구매 정보 (노션: 구매일·구매처·정가·구매가·통화. 통화가 비어 있으면 엔화로 봐요)
    purchaseDate: normalizeDate(w.purchaseDate),
    store: str(w.store),
    listPrice: money(w.listPrice),
    paidPrice: money(w.paidPrice),
    currency: CURRENCIES.includes(str(w.currency).toUpperCase()) ? str(w.currency).toUpperCase() : '',
    workType: WORK_TYPES.includes(str(w.workType)) ? str(w.workType) : '',
    // 할인·쿠폰·묶음 구매 (최종 구매금 = paidPrice, 직접 고치면 paidManual)
    salePrice: money(w.salePrice),
    couponType: ['pct', 'yen'].includes(str(w.couponType)) ? str(w.couponType) : '',
    couponValue: money(w.couponValue),
    couponMemo: str(w.couponMemo),
    discountNote: str(w.discountNote), // 노션 '할인 메모'용 한 줄 요약
    paidManual: !!w.paidManual,
    orderId: str(w.orderId), // 같이 산 작품 묶음
    orderType: ['', 'pct', 'yen', 'bundle'].includes(str(w.orderType)) ? str(w.orderType) : '',
    orderValue: money(w.orderValue),
    orderTotal: money(w.orderTotal), // 묶음 전체 최종 구매금
    orderCount: Math.max(0, Math.round(Number(w.orderCount) || 0)),
    orderNo: str(w.orderNo), // 영수증 주문번호 (같은 주문을 두 번 넣지 않게)
    pointsUsed: money(w.pointsUsed),
    // 작품이 아닌 기록: 'other' = 만화 등 기타 구매, 'points' = 포인트 충전. 목록·통계·노션에는 안 나와요.
    entryType: ['other', 'points'].includes(str(w.entryType)) ? str(w.entryType) : '',
    workKind: str(w.workKind), // DLsite 작품 종류 (음성, 만화…)
    packCode: str(w.packCode), // 팩으로 산 작품: 영수증의 팩 코드 (다음에 같은 팩이 나오면 자동 연결)
    packTitle: str(w.packTitle),
    createdAt: str(w.createdAt),
    updatedAt: str(w.updatedAt),
    notionEditedAt: str(w.notionEditedAt),
  };
}

// 성우·서클 이름: '三橋渡 미츠하시 와타루' → 일본어 부분 '三橋渡'
export const splitNameList = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
export function nameJa(n) { const s = String(n || '').trim(); const i = s.search(/[가-힣]/); return i < 0 ? s : s.slice(0, i).trim(); }
export const nameKey = (s) => String(s || '').replace(/[\s\u3000・･·]/g, '').toLowerCase();
// 목록 문자열에서 이름 하나를 바꿔요. (같은 사람이 두 번 들어가지 않게)
export function renameInList(value, from, to) {
  const list = splitNameList(value);
  if (!list.includes(from)) return null;
  const out = [];
  for (const n of list.map((x) => (x === from ? to : x))) if (n && !out.includes(n)) out.push(n);
  return out.join(', ');
}
// 같은 사람들인데 한글 읽기만 다른지 (반영 대기로 세지 않으려고)
export function sameIgnoringReading(a, b) {
  const ka = splitNameList(a).map((n) => nameKey(nameJa(n) || n));
  const kb = splitNameList(b).map((n) => nameKey(nameJa(n) || n));
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

export function same(a, b) {
  return JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
}

// ===== 되돌리기: 기록 내역(history)을 '한 번에 일어난 일' 묶음으로 나눠요 =====
// kinds: { 이유: 'deleted' | 'changed' }  deleted = 지워진 작품 전체가 남아 있음, changed = 바뀌기 전 값이 남아 있음
// 같은 이유로 3분 안에 이어서 일어난 기록을 한 묶음으로 봐요.
export function groupHistory(entries, kinds, hasWork, titleOf = () => '') {
  const list = entries.filter((h) => h && kinds[h.reason] && h.id && h.id !== '*' && h.data && typeof h.data === 'object')
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const groups = [];
  let cur = null;
  for (const h of list) {
    const t = Date.parse(h.at) || 0;
    if (!cur || cur.reason !== h.reason || t - cur.lastT > 3 * 60 * 1000) {
      cur = { key: `${h.reason}|${h.at}`, reason: h.reason, kind: kinds[h.reason], at: h.at, to: h.at, lastT: t, items: new Map() };
      groups.push(cur);
    }
    cur.to = h.at; cur.lastT = t;
    if (!cur.items.has(h.id)) cur.items.set(h.id, h); // 같은 작품이 여러 번이면 처음(가장 이전) 상태를 써요
  }
  return groups.reverse().slice(0, 40).map((g) => {
    const items = [...g.items.values()];
    const ok = items.filter((h) => (g.kind === 'deleted' ? !hasWork(h.id) : hasWork(h.id)));
    return { key: g.key, reason: g.reason, kind: g.kind, at: g.at, to: g.to, n: items.length, restorable: ok.length,
      sample: ok.slice(0, 3).map((h) => h.data.titleKo || h.data.title || titleOf(h.id) || h.id), items: ok };
  });
}

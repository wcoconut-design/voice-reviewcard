// 작품 데이터의 모양을 한곳에서 정합니다.
// works.json의 각 작품은 아래 필드만 가집니다.

// 노션과 주고받는 필드 (이미지는 노션에서 가져오기만 합니다)
export const SYNC_FIELDS = [
  'title', 'titleKo', 'actor', 'circle', 'tags', 'date', 'code', 'url',
  'review', 'status', 'rating', 'lastPlayed', 'favorite', 'folder',
  'organize', 'promo', 'translation',
  'purchaseDate', 'store', 'listPrice', 'paidPrice', 'currency', 'workType',
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
    createdAt: str(w.createdAt),
    updatedAt: str(w.updatedAt),
    notionEditedAt: str(w.notionEditedAt),
  };
}

export function same(a, b) {
  return JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
}

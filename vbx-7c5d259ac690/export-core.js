// 보기 좋은 백업 만들기: 엑셀(.xlsx), CSV, 감상 모음 문서(HTML → 인쇄/PDF)
// 아이맥(서버)과 폰 앱(브라우저)이 함께 쓰는 코드예요. 외부 패키지 없이 만듭니다.
// 복원은 JSON 백업으로 하세요.

const STATUS_KO = { '미청취': '안 들음', '청취 중': '듣는 중', '청취 완료': '들음' };
const split = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const notionLink = (w) => (w.notionPageId ? 'https://www.notion.so/' + w.notionPageId.replace(/-/g, '') : '');

// 표로 내보낼 열
const COLUMNS = [
  ['코드', (w) => w.code, 12],
  ['제목', (w) => w.titleKo || w.title, 50],
  ['원제', (w) => (w.titleKo ? w.title : ''), 40],
  ['성우', (w) => split(w.actor).join(', '), 28],
  ['서클', (w) => w.circle, 18],
  ['장르', (w) => w.tags.join(', '), 18],
  ['발매일', (w) => w.date, 11],
  ['별점', (w) => (w.rating ? w.rating : ''), 6, 'number'],
  ['별점 표시', (w) => (w.rating ? '★'.repeat(w.rating) : ''), 10],
  ['청취 상태', (w) => STATUS_KO[w.status] || '', 9],
  ['마지막 청취일', (w) => w.lastPlayed, 12],
  ['즐겨찾기', (w) => (w.favorite ? '♥' : ''), 8],
  ['숨김', (w) => (w.hidden ? '숨김' : ''), 6],
  ['폴더', (w) => w.folder, 12],
  ['감상', (w) => w.review, 60],
  ['구매일', (w) => w.purchaseDate || '', 11],
  ['구매처', (w) => w.store || '', 12],
  ['통화', (w) => (w.listPrice != null || w.paidPrice != null ? w.currency || 'JPY' : ''), 6],
  ['정가', (w) => w.listPrice ?? '', 9, 'number'],
  ['구매가', (w) => w.paidPrice ?? '', 9, 'number'],
  ['판매 링크', (w) => w.url, 30],
  ['노션 링크', notionLink, 30],
];

/* ---------------- CSV ---------------- */
export function toCsv(works) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [COLUMNS.map((c) => cell(c[0])).join(',')];
  for (const w of works) lines.push(COLUMNS.map((c) => cell(c[1](w))).join(','));
  // 엑셀에서 한글이 깨지지 않게 BOM을 붙입니다.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/* ---------------- XLSX ---------------- */
const xmlEsc = (s) => String(s ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

// rows: 2차원 배열, 첫 줄은 머리글
function sheetXml(rows, widths, { types = [], wrapCols = [] } = {}) {
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => {
    const ref = colName(c) + (r + 1);
    if (r === 0) return `<c r="${ref}" t="inlineStr" s="1"><is><t>${xmlEsc(v)}</t></is></c>`;
    if (v === '' || v == null) return '';
    if (types[c] === 'number' && typeof v === 'number') return `<c r="${ref}" s="3"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr" s="${wrapCols.includes(c) ? 2 : 0}"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const last = colName(Math.max(0, (rows[0] || []).length - 1)) + Math.max(1, rows.length);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols><sheetData>${body}</sheetData>${rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : ''}</worksheet>`;
}

function countBy(works, getter) {
  const m = new Map();
  for (const w of works) for (const k of getter(w)) m.set(k, (m.get(k) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
}

export function toXlsx(works, compress) {
  const visible = works;
  const allRows = [COLUMNS.map((c) => c[0]), ...visible.map((w) => COLUMNS.map((c) => c[1](w)))];
  const types = COLUMNS.map((c) => c[3]);
  const wrap = [COLUMNS.findIndex((c) => c[0] === '감상')];
  const reviewed = visible.filter((w) => w.review).sort((a, b) => (b.lastPlayed || '').localeCompare(a.lastPlayed || ''));
  const revCols = ['제목', '원제', '성우', '서클', '별점 표시', '마지막 청취일', '감상'];
  const pick = revCols.map((n) => COLUMNS.find((c) => c[0] === n));
  const revRows = [revCols, ...reviewed.map((w) => pick.map((c) => c[1](w)))];

  // 통계: 성우 / 서클 / 장르 / 발매 연도를 나란히
  const groups = [
    ['성우', countBy(visible, (w) => split(w.actor))],
    ['서클', countBy(visible, (w) => split(w.circle))],
    ['장르', countBy(visible, (w) => w.tags)],
    ['발매 연도', countBy(visible, (w) => (w.date ? [w.date.slice(0, 4)] : [])).sort((a, b) => b[0].localeCompare(a[0]))],
  ];
  const statHead = groups.flatMap(([n], i) => [n, '작품 수', ...(i < groups.length - 1 ? [''] : [])]);
  const maxLen = Math.max(...groups.map((g) => g[1].length));
  const statRows = [statHead];
  for (let r = 0; r < maxLen; r++) {
    statRows.push(groups.flatMap(([, list], i) => [list[r]?.[0] ?? '', list[r]?.[1] ?? '', ...(i < groups.length - 1 ? [''] : [])]));
  }
  const statTypes = statHead.map((h) => (h === '작품 수' ? 'number' : ''));
  const statWidths = statHead.map((h) => (h === '' ? 3 : h === '작품 수' ? 9 : 26));

  const rated = visible.filter((w) => w.rating);
  const summary = [
    ['항목', '값'],
    ['내보낸 날짜', new Date().toLocaleString('ko-KR')],
    ['작품', visible.length],
    ['들은 작품', visible.filter((w) => w.status === '청취 완료' || w.status === '청취 중').length],
    ['별점 준 작품', rated.length],
    ['평균 별점', rated.length ? Math.round((rated.reduce((a, w) => a + w.rating, 0) / rated.length) * 10) / 10 : ''],
    ['감상 쓴 작품', reviewed.length],
    ['즐겨찾기', visible.filter((w) => w.favorite).length],
  ];

  // 지출: 월별 · 통화별 합계 (구매가가 없으면 정가로 셈)
  const spendMap = new Map();
  for (const w of visible) {
    const paid = w.paidPrice ?? w.listPrice;
    if (!w.purchaseDate || paid == null) continue;
    const key = w.purchaseDate.slice(0, 7) + '|' + (w.currency || 'JPY');
    const r = spendMap.get(key) || { n: 0, paid: 0, list: 0 };
    r.n++; r.paid += paid; r.list += w.listPrice ?? paid;
    spendMap.set(key, r);
  }
  const spendRows = [['월', '통화', '작품 수', '지출', '정가 합계', '아낀 금액'],
    ...[...spendMap].sort((a, b) => b[0].localeCompare(a[0])).map(([k, r]) => { const [m, c] = k.split('|'); return [m, c, r.n, Math.round(r.paid * 100) / 100, Math.round(r.list * 100) / 100, Math.round((r.list - r.paid) * 100) / 100]; })];

  const sheets = [
    ['작품 목록', sheetXml(allRows, COLUMNS.map((c) => c[2]), { types, wrapCols: wrap })],
    ['감상', sheetXml(revRows, [40, 30, 24, 16, 10, 12, 80], { wrapCols: [6] })],
    ['통계', sheetXml(statRows, statWidths, { types: statTypes })],
    ['지출', sheetXml(spendRows, [10, 7, 9, 12, 12, 12], { types: ['', '', 'number', 'number', 'number', 'number'] })],
    ['요약', sheetXml(summary, [16, 24], { types: ['', 'number'] })],
  ];

  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map(([name], i) => `<sheet name="${xmlEsc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'작품 목록'!$A$1:$${colName(COLUMNS.length - 1)}$${allRows.length}</definedName></definedNames>
</workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Apple SD Gothic Neo"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Apple SD Gothic Neo"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3443C4"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`],
    ...sheets.map(([, xml], i) => [`xl/worksheets/sheet${i + 1}.xml`, xml]),
  ];
  const enc = new TextEncoder();
  return zip(files.map(([name, text]) => [name, enc.encode(text)]), compress);
}

// 간단한 ZIP 만들기 (xlsx는 ZIP 파일이에요). compress가 없으면 압축 없이 담아요.
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(entries, compress) {
  const parts = [], centrals = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const [name, data] of entries) {
    const nameBuf = enc.encode(name);
    const comp = compress ? compress(data) : data;
    const method = compress ? 8 : 0;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, method, true);
    local.setUint32(14, crc, true); local.setUint32(18, comp.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nameBuf.length, true);
    parts.push(new Uint8Array(local.buffer), nameBuf, comp);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true); central.setUint16(8, 0x0800, true); central.setUint16(10, method, true);
    central.setUint32(16, crc, true); central.setUint32(20, comp.length, true); central.setUint32(24, data.length, true); central.setUint16(28, nameBuf.length, true); central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cdSize = centrals.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const a of all) { out.set(a, o); o += a.length; }
  return out;
}

/* ---------------- 감상 모음 문서 ---------------- */
export function reviewsHtml(works, localize, { order = 'played' } = {}) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const list = works.filter((w) => w.review).sort(order === 'rating'
    ? (a, b) => b.rating - a.rating || (b.lastPlayed || '').localeCompare(a.lastPlayed || '')
    : (a, b) => (b.lastPlayed || b.updatedAt || '').localeCompare(a.lastPlayed || a.updatedAt || ''));
  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  const items = list.map((w) => `
  <article class="item">
    ${w.images[0] ? `<img class="cover" src="${esc(localize(w.images[0]))}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : '<div class="cover"></div>'}
    <div class="body">
      <h2>${esc(w.titleKo || w.title)}</h2>
      ${w.titleKo && w.title ? `<p class="orig">${esc(w.title)}</p>` : ''}
      <p class="meta">${esc([split(w.actor).join(', '), w.circle, w.date].filter(Boolean).join(' · '))}</p>
      <p class="rec">${w.rating ? `<span class="stars">${'★'.repeat(w.rating)}<span class="off">${'★'.repeat(5 - w.rating)}</span></span>` : ''}${w.lastPlayed ? `<span>${esc(w.lastPlayed)} 들음</span>` : ''}${w.tags.length ? `<span>${esc(w.tags.join(', '))}</span>` : ''}</p>
      <div class="review">${esc(w.review)}</div>
    </div>
  </article>`).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>VOICE BOX 감상 모음 · ${esc(today)}</title>
<style>
:root{--ink:#22201C;--muted:#6B655C;--line:#E2DCCF;--accent:#3443C4;--star:#B76E00}
*{box-sizing:border-box}body{margin:0;background:#F6F3EC;color:var(--ink);font-family:'Apple SD Gothic Neo','Noto Sans KR',system-ui,sans-serif}
.bar{position:sticky;top:0;background:#fff;border-bottom:1px solid var(--line);padding:12px 20px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:14px}
.bar button,.bar a{height:36px;padding:0 14px;border-radius:8px;border:1px solid var(--line);background:#fff;font:inherit;cursor:pointer;color:var(--ink);text-decoration:none;display:inline-flex;align-items:center}
.bar .primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.bar .sp{margin-left:auto;color:var(--muted)}
.doc{max-width:820px;margin:0 auto;padding:40px 24px 80px}
.head{border-bottom:2px solid var(--ink);padding-bottom:18px;margin-bottom:12px}
.head h1{font-family:'Nanum Myeongjo','AppleMyungjo','Noto Serif KR',serif;font-size:34px;margin:0 0 6px;letter-spacing:-.01em}
.head p{margin:0;color:var(--muted);font-size:14px}
.item{display:grid;grid-template-columns:120px minmax(0,1fr);gap:22px;padding:26px 0;border-bottom:1px solid var(--line);break-inside:avoid;page-break-inside:avoid}
.cover{width:120px;height:120px;object-fit:cover;border-radius:6px;background:#EAE4D6}
h2{font-family:'Nanum Myeongjo','AppleMyungjo','Noto Serif KR',serif;font-size:19px;line-height:1.45;margin:0 0 4px}
.orig{margin:0 0 6px;color:var(--muted);font-size:12.5px;line-height:1.5}
.meta{margin:0 0 6px;font-size:13px;color:var(--muted)}
.rec{margin:0 0 12px;font-size:13px;color:var(--muted);display:flex;gap:12px;flex-wrap:wrap}
.stars{color:var(--star);letter-spacing:1px}.stars .off{color:#D9D2C3}
.review{white-space:pre-wrap;line-height:1.95;font-size:15px}
.empty{color:var(--muted);padding:40px 0;text-align:center}
@media (max-width:560px){.item{grid-template-columns:1fr}.cover{width:100%;height:auto;aspect-ratio:1}}
@media print{body{background:#fff}.bar{display:none}.doc{padding:0;max-width:none}.item{grid-template-columns:90px minmax(0,1fr)}.cover{width:90px;height:90px}@page{margin:16mm}}
</style></head><body>
<div class="bar"><button class="primary" onclick="print()">인쇄 / PDF로 저장</button>
<a href="?order=played">최근 들은 순</a><a href="?order=rating">별점 순</a><span class="sp">감상 ${list.length}개</span></div>
<main class="doc"><header class="head"><h1>감상 모음</h1><p>VOICE BOX · ${esc(today)} · ${list.length}편</p></header>
${items || '<p class="empty">아직 감상을 쓴 작품이 없어요.</p>'}</main></body></html>`;
}

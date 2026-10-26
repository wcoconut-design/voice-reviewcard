// VOICE BOX 정보 채우기 중계 서버 — tools/build-worker.mjs로 만든 파일이에요.
// 판매 페이지 링크로 작품 정보를 채웁니다. (DLsite 위주, 다른 사이트는 제목·이미지만)
// 사이트 구조가 바뀌면 일부 항목이 비어 올 수 있어서, 결과는 항상 편집 화면에서 확인합니다.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

const decode = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const text = (html) => decode(String(html || '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, ''))
  .split('\n').map((l) => l.replace(/[ \t]+$/g, '')).join('\n')
  .replace(/\n{3,}/g, '\n\n').trim();
const meta = (html, prop) => decode((html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)`, 'i')) || [])[1] || '');

// from 위치의 태그와 짝이 맞는 닫는 태그까지의 HTML
function balancedBlock(html, from) {
  const tag = (html.slice(from).match(/^<([a-z0-9]+)/i) || [])[1];
  if (!tag) return '';
  const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gi');
  re.lastIndex = from;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (m[2]) continue; // <div/> 같은 자체 닫힘
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(html.indexOf('>', from) + 1, m.index);
  }
  return html.slice(from, from + 30000); // 짝을 못 찾으면 앞부분만
}

// 설명 밖의 사이트 문구가 섞여 들어와도 걸러냅니다.
const CUT_AT = ['同一シリーズ作品', 'サークル作品一覧', '同一声優作品', 'この作品を買った人は', '最近チェックした作品', 'ユーザーレビュー', '販売作品', 'PAGE TOP', '作品をもっと見る'];
function cleanPromo(s) {
  const lines = String(s || '').split('\n').map((l) => l.trim());
  const out = [];
  for (const l of lines) {
    if (CUT_AT.includes(l)) break;
    if (/\{\{|\}\}|=>|^\[\s*\]$|^[{}()]+$/.test(l)) continue; // 화면 코드 조각
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function get(url, headers = {}) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ja,ko;q=0.8', Cookie: 'adultchecked=1; locale=ja-jp', ...headers },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error('판매 페이지가 응답하지 않았어요 (' + r.status + ').');
  return r;
}

async function fetchInfo(link) {
  let url;
  try { url = new URL(link); } catch { throw new Error('링크 형식을 확인해 주세요.'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('링크 형식을 확인해 주세요.');
  const code = (link.match(/(?:RJ|BJ|VJ)\d{6,}/i) || [''])[0].toUpperCase();
  const out = { url: link, code, title: '', circle: '', actor: '', date: '', images: [], promo: '', store: '', listPrice: null, currency: '' };
  const h = url.hostname;
  out.store = /dlsite\.com$/.test(h) ? 'DLsite' : /pokedora/.test(h) ? '포케도라' : /stellaworth/.test(h) ? '스텔라워스' : /animate/.test(h) ? '애니메이트' : '';
  if (out.store) out.currency = 'JPY';
  // 동인/상업: DLsite 작품 코드(RJ=동인, VJ·BJ=상업)와 매장 주소로 짐작
  const floor = (link.match(/dlsite\.com\/([a-z-]+)\//i) || [])[1]?.toLowerCase() || '';
  out.workType = /^RJ/.test(code) ? '동인' : /^(VJ|BJ)/.test(code) ? '상업'
    : /^(maniax|girls|bl|home)$/.test(floor) ? '동인' : /(^pro$|-pro$|^soft$|^books$|-drama$)/.test(floor) ? '상업' : '';

  if (/(^|\.)dlsite\.com$/.test(url.hostname) && code) {
    // 1) 작품 정보 JSON: 서클·성우·발매일·표지·가격이 들어 있어요.
    try {
      const arr = await (await get(`https://www.dlsite.com/maniax/api/=/product.json?workno=${code}`)).json();
      const d = Array.isArray(arr) ? arr[0] : null;
      if (d) {
        out.title = d.work_name || '';
        out.circle = d.maker_name || '';
        out.date = (d.regist_date || '').slice(0, 10);
        const voices = (d.creaters?.voice_by || []).map((x) => x.name).filter(Boolean);
        if (voices.length) out.actor = voices.join(', ');
        const price = Number(d.official_price || d.price || 0);
        if (price > 0) out.listPrice = price;
        const img = d.image_main?.url || d.work_image || '';
        if (img) out.images.push(img.startsWith('//') ? 'https:' + img : img);
        if (d.intro_s) out.promoShort = String(d.intro_s).trim();
      }
    } catch {}
    // 2) 예전 방식 (위가 비었을 때)
    if (!out.title) {
      try {
        const j = await (await get(`https://www.dlsite.com/maniax/product/info/ajax?product_id=${code}&cdn_cache_min=1`)).json();
        const d = j[code];
        if (d) {
          out.title = d.work_name || '';
          out.circle ||= d.maker_name || '';
          out.date = (d.regist_date || '').slice(0, 10);
          const price = Number(d.official_price || d.price || 0);
          if (price > 0) out.listPrice = price;
          if (d.work_image) out.images.push(d.work_image.startsWith('//') ? 'https:' + d.work_image : d.work_image);
        }
      } catch {}
    }
    // 폰용 주소(…-touch)는 PC용 판매 페이지로 바꿔서 읽어요.
    link = link.replace(/dlsite\.com\/([a-z]+)-touch\//, 'dlsite.com/$1/');
  }
  let html = '';
  try { html = await (await get(link)).text(); } catch (e) { if (!out.title) throw e; }
  out.title ||= text((html.match(/<h1[^>]*id=["']work_name["'][^>]*>([\s\S]*?)<\/h1>/i) || [])[1]) || meta(html, 'og:title');
  out.circle ||= text((html.match(/class=["']maker_name["'][^>]*>([\s\S]*?)<\/span>/i) || [])[1]);
  const row = (label) => {
    const m = html.match(new RegExp(`<th[^>]*>\\s*${label}\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`, 'i'));
    return m ? text(m[1]).replace(/\s*\n\s*/g, ' ').trim() : '';
  };
  out.actor ||= row('声優') || row('CV');
  if (!out.date) {
    const m = row('販売日').match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (m) out.date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  const og = meta(html, 'og:image');
  if (og && !out.images.length) out.images.push(og);
  // 작품 설명 영역: 설명 div의 시작부터 짝이 맞는 </div>까지만 잘라냅니다.
  const start = html.search(/itemprop=["']description["']/i);
  if (start >= 0) out.promo = cleanPromo(text(balancedBlock(html, html.lastIndexOf('<', start))));
  const og2 = meta(html, 'og:description');
  out.promo ||= out.promoShort || (/ダウンロードショップ|DLsite/.test(og2) && out.store === 'DLsite' ? '' : og2);
  delete out.promoShort;
  out.actor = out.actor.replace(/\s*\/\s*/g, ', ');
  return out;
}

/* ---------- VOICE BOX 정보 채우기 중계 서버 ----------
   폰 앱이 판매 페이지 링크를 보내면, 이 서버가 페이지를 읽어 제목·서클·성우·발매일·표지·정가를 돌려줘요.
   - 설정 → 변수(Variables and Secrets)에 VB_KEY(비밀 열쇠)를 넣어야 동작해요. 열쇠가 맞는 요청만 받아요.
   - 기록은 저장하지 않아요. 받은 링크의 페이지만 읽고 바로 돌려줘요. */
const VERSION = 5;
export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin');
    const cors = {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'POST, GET, PUT, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-VB-Key',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method === 'GET' && url.pathname === '/') return json({ ok: true, app: 'VOICE BOX info relay', version: VERSION, keySet: !!env.VB_KEY, sync: !!env.DB, files: !!env.FILES });
    if (!env.VB_KEY) return json({ error: '중계 서버에 VB_KEY가 설정되지 않았어요.' }, 500);
    const key = req.headers.get('X-VB-Key') || url.searchParams.get('key');
    if (key !== env.VB_KEY) return json({ error: '열쇠가 맞지 않아요.' }, 401);
    // 진단: 브라우저에서 /debug?key=열쇠&url=판매링크 로 열면 어디서 막히는지 보여줘요.
    if (req.method === 'GET' && url.pathname === '/debug') {
      const link = url.searchParams.get('url') || '';
      const code = (link.match(/(?:RJ|BJ|VJ)\d{6,}/i) || [''])[0].toUpperCase();
      const probe = async (u) => { try { const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja', Cookie: 'adultchecked=1; locale=ja-jp' }, redirect: 'follow' }); const t = await r.text(); return { status: r.status, finalUrl: r.url, length: t.length, head: t.slice(0, 160).replace(/\s+/g, ' '), hasDesc: /itemprop=["']description/.test(t), hasMaker: /maker_name/.test(t) }; } catch (e) { return { error: String(e) }; } };
      return json({ colo: req.cf?.colo, country: req.cf?.country, product: await probe('https://www.dlsite.com/maniax/api/=/product.json?workno=' + code), page: await probe(link.replace(/dlsite\.com\/([a-z]+)-touch\//, 'dlsite.com/$1/')), info: await fetchInfo(link).catch((e) => ({ error: e.message })) });
    }
    // 표지 이미지 전달: 폰 앱 리뷰카드에 판매 사이트 표지를 넣을 때 써요.
    if (req.method === 'GET' && url.pathname === '/image') {
      const src = url.searchParams.get('src') || '';
      if (!/^https?:\/\//.test(src)) return json({ error: '이미지 주소가 아니에요.' }, 400);
      try {
        const r = await fetch(src, { headers: { 'User-Agent': UA, Referer: new URL(src).origin + '/' } });
        const type = r.headers.get('Content-Type') || '';
        if (!r.ok || !type.startsWith('image/')) return json({ error: '이미지를 가져오지 못했어요.' }, 502);
        return new Response(r.body, { headers: { ...cors, 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' } });
      } catch { return json({ error: '이미지를 가져오지 못했어요.' }, 502); }
    }
    if (req.method === 'POST' && url.pathname === '/info') {
      let body;
      try { body = await req.json(); } catch { return json({ error: '요청 형식이 잘못됐어요.' }, 400); }
      try { return json(await fetchInfo(String(body.url || ''))); }
      catch (e) { return json({ error: e.message || '정보를 가져오지 못했어요.' }, 502); }
    }
    // ---------- 동기화 상자: 폰과 아이맥이 바뀐 작품을 주고받아요 ----------
    // D1 데이터베이스(DB)에 작품을, KV(FILES)에 첨부 이미지·리뷰카드를 보관해요.
    if (url.pathname.startsWith('/sync/') || url.pathname === '/files') {
      if (url.pathname === '/files') {
        if (!env.FILES) return json({ error: 'FILES(KV) 연결이 없어요.' }, 501);
        const path = url.searchParams.get('path') || '';
        if (!/^images\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(path)) return json({ error: '파일 경로가 잘못됐어요.' }, 400);
        if (req.method === 'PUT') {
          const type = req.headers.get('Content-Type') || 'application/octet-stream';
          await env.FILES.put(path, req.body, { metadata: { type } });
          return json({ ok: true });
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
          const r = await env.FILES.getWithMetadata(path, { type: 'stream' });
          if (!r.value) return json({ error: '없는 파일이에요.' }, 404);
          return new Response(req.method === 'HEAD' ? null : r.value, { headers: { ...cors, 'Content-Type': r.metadata?.type || 'application/octet-stream' } });
        }
      }
      if (!env.DB) return json({ error: 'DB(D1) 연결이 없어요.' }, 501);
      if (!globalThis.__vbTable) {
        await env.DB.prepare('CREATE TABLE IF NOT EXISTS works (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL, device TEXT)').run();
        await env.DB.prepare('CREATE INDEX IF NOT EXISTS works_rev ON works(rev)').run();
        globalThis.__vbTable = true;
      }
      if (req.method === 'GET' && url.pathname === '/sync/pull') {
        const since = Number(url.searchParams.get('since') || 0);
        const rows = (await env.DB.prepare('SELECT id, data, deleted, rev, updated_at FROM works WHERE rev > ? ORDER BY rev LIMIT 400').bind(since).all()).results || [];
        const last = rows.length ? rows[rows.length - 1].rev : since;
        const total = (await env.DB.prepare('SELECT COUNT(*) AS n FROM works').first())?.n || 0;
        return json({ rev: last, more: rows.length === 400, total, works: rows.map((r) => ({ id: r.id, deleted: !!r.deleted, at: r.updated_at, work: r.deleted ? null : JSON.parse(r.data) })) });
      }
      if (req.method === 'POST' && url.pathname === '/sync/push') {
        let body;
        try { body = await req.json(); } catch { return json({ error: '요청 형식이 잘못됐어요.' }, 400); }
        const device = String(body.device || '').slice(0, 40);
        const items = [
          ...(body.works || []).filter((w) => w && w.id).map((w) => ({ id: String(w.id), data: JSON.stringify(w), at: String(w.updatedAt || ''), deleted: 0 })),
          ...(body.deleted || []).filter((d) => d && d.id).map((d) => ({ id: String(d.id), data: '{}', at: String(d.at || new Date().toISOString()), deleted: 1 })),
        ].slice(0, 500);
        const top = (await env.DB.prepare('SELECT MAX(rev) AS m FROM works').first())?.m || 0;
        let rev = Math.max(Date.now() * 1000, top + 1);
        const stmts = items.map((it) => env.DB.prepare(
          'INSERT INTO works (id, data, updated_at, deleted, rev, device) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ' +
          'ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, rev = excluded.rev, device = excluded.device WHERE excluded.updated_at > works.updated_at'
        ).bind(it.id, it.data, it.at, it.deleted, rev++, device));
        let applied = 0;
        for (let i = 0; i < stmts.length; i += 50) {
          const res = await env.DB.batch(stmts.slice(i, i + 50));
          applied += res.reduce((a, r) => a + (r.meta?.changes || 0), 0);
        }
        return json({ ok: true, applied, received: items.length });
      }
    }
    return json({ error: '없는 주소예요.' }, 404);
  },
};

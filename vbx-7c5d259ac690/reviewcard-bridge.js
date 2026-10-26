// VOICE BOX ↔ 리뷰카드 메이커 연결
// 카드 메이커(maker.html)는 원본 그대로 두고, VOICE BOX가 열 때만 이 파일을 덧붙입니다.
// 하는 일: ① 작품 정보·감상·표지를 자동으로 채움 ② 만든 카드를 그 작품의 대표 카드로 저장
(function () {
  'use strict';
  const workId = new URLSearchParams(location.search).get('work');
  if (!workId) return;
  const $ = (id) => document.getElementById(id);
  const extraKey = 'vb_card_' + workId; // 한줄 코멘트·등급·수위는 작품별로 기억
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('voicebox') : null;
  let work = null;

  const api = async (path, opts = {}) => {
    const r = await fetch(path, opts);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || MSG.err);
    return d;
  };
  const say = (msg) => { try { showToast(msg); } catch { alert(msg); } };
  const setInput = (id, value) => {
    const el = $(id);
    if (!el) return;
    el.value = value || '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  // ---------- 위쪽 VOICE BOX 막대 ----------
  const LANG = (() => { try { return JSON.parse(localStorage.getItem('voicebox.view') || '{}').menuLang || 'ko'; } catch { return 'ko'; } })();
  const MSG = {
    en: { err: 'Something went wrong.', loading: 'Loading…', refillTip: 'Refill info, review and cover from VOICE BOX', refill: 'Refill', saveLong: 'Save to VOICE BOX as card', page: 'Review card', noCover: "Couldn't get the cover. Please upload it yourself.", curCard: 'Current card', makeFail: "Couldn't make the card image.", saving: 'Saving…', reviewDiff: 'The card text differs from your review.\nUpdate your review with the card text?', savedN: 'Saved {n} cards.', saved: 'Card saved.', refillAsk: 'Refill title, cast, circle, tags, review, rating and cover from VOICE BOX?' },
    ja: { err: 'うまくいきませんでした。', loading: '読み込み中…', refillTip: '作品情報・感想・表紙をもう一度入れます', refill: 'もう一度入れる', saveLong: 'VOICE BOX にカードを保存', page: 'レビューカード', noCover: '表紙を取得できませんでした。画像を直接アップロードしてください。', curCard: '今のカード', makeFail: 'カード画像を作れませんでした。', saving: '保存中…', reviewDiff: 'カードの文章が感想と違います。\nカードの文章で感想も更新しますか？', savedN: 'カード({n}枚)を保存しました。', saved: 'カードを保存しました。', refillAsk: 'タイトル・声優・サークル・タグ・感想・評価・表紙を VOICE BOX の内容で入れ直しますか？' },
  }[LANG] || { err: '요청을 처리하지 못했어요.', loading: '불러오는 중…', refillTip: '작품 정보·감상·표지를 다시 채워요', refill: '다시 채우기', saveLong: 'VOICE BOX에 대표 카드로 저장', page: '리뷰카드', noCover: '표지를 가져오지 못했어요. 썸네일은 직접 올려 주세요.', curCard: '지금 대표 카드', makeFail: '카드 이미지를 만들지 못했어요.', saving: '저장 중…', reviewDiff: '카드의 리뷰 글이 VOICE BOX 감상과 달라요.\n카드의 글로 감상도 바꿀까요?', savedN: '대표 카드({n}장)를 저장했어요.', saved: '대표 카드를 저장했어요.', refillAsk: '제목·성우·서클·장르·감상·별점·표지를 VOICE BOX 내용으로 다시 채울까요?' };
  const BACK = { en: 'Back', ja: '戻る' }[LANG] || '돌아가기';
  const isPhoneApp = /reviewcard\.html$/.test(location.pathname);
  // 간단 화면: 작품 정보는 VOICE BOX에서 자동으로 채우니 입력칸은 숨기고 디자인만 골라요. (?full=1 이면 원래 메이커 그대로)
  const LITE = !new URLSearchParams(location.search).has('full');
  const T = {
    ko: { full: '전체 편집', design: '디자인', show: '표시', cover: '표지', text: '글 고치기', textNote: '카드에만 쓰는 제목·글이에요. 앱의 제목은 바뀌지 않아요. 감상은 저장할 때 반영할지 물어봐요.', down: '이미지로 받기', qr: 'QR 코드 보이기 (판매 링크)' },
    en: { full: 'Full editor', design: 'Design', show: 'Display', cover: 'Cover', text: 'Edit text', textNote: 'Title and text for this card only. The app title stays the same.', down: 'Download image', qr: 'Show QR code (store link)' },
    ja: { full: 'フル編集', design: 'デザイン', show: '表示', cover: '表紙', text: '文章を編集', textNote: 'カード用のタイトル・文章です。アプリのタイトルは変わりません。', down: '画像を保存', qr: 'QRコードを表示 (販売リンク)' },
  }[LANG] || null;
  const UIL = {
    ko: { cardLang: '카드 언어', layout: '카드 형태', player: '세로형 카드', classic: '가로형 카드', theme: '테마', thumb: '표지', title: '카드에 쓸 제목', rating: '등급', heart: '수위 · 농도', headline: '한줄 코멘트', review: '리뷰', fontSize: '리뷰 글씨 크기', color: '리뷰 글씨 색', reviewer: '작성자', spoiler: '🚨 스포일러 주의', date: '작성일 표시', edit: '편집', change: '변경', del: '제거' },
    en: { cardLang: 'Card language', layout: 'Card layout', player: 'Portrait', classic: 'Landscape', theme: 'Theme', thumb: 'Cover', title: 'Title on the card', rating: 'Age rating', heart: 'Heat level', headline: 'One-line comment', review: 'Review', fontSize: 'Review text size', color: 'Review text color', reviewer: 'Author', spoiler: '🚨 Spoiler warning', date: 'Show date', edit: 'Edit', change: 'Change', del: 'Remove' },
    ja: { cardLang: 'カードの言語', layout: 'カードの形', player: '縦型カード', classic: '横型カード', theme: 'テーマ', thumb: '表紙', title: 'カードのタイトル', rating: 'レーティング', heart: '濃さ', headline: 'ひとことコメント', review: 'レビュー', fontSize: 'レビューの文字サイズ', color: 'レビューの文字色', reviewer: '作成者', spoiler: '🚨 ネタバレ注意', date: '作成日を表示', edit: '編集', change: '変更', del: '削除' },
  }[LANG] || null;
  function relabel() {
    if (!UIL || !LITE) return;
    const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
    set('lblLayout', UIL.layout); set('layoutPlayerTxt', UIL.player); set('layoutClassicTxt', UIL.classic);
    set('lblTheme', UIL.theme); set('lblThumb', UIL.thumb); set('lblTitle', UIL.title); set('lblRating', UIL.rating);
    set('lblHeart', UIL.heart); set('lblHeadline', UIL.headline); set('lblReview', UIL.review); set('lblFontSize', UIL.fontSize);
    set('lblColor', UIL.color); set('lblReviewer', UIL.reviewer); set('lblSpoiler', UIL.spoiler); set('lblDate', UIL.date);
    const acts = document.querySelectorAll('#thumbActions .tx');
    [UIL.edit, UIL.change, UIL.del].forEach((t, i) => { if (acts[i]) acts[i].textContent = t; });
    const ex = document.getElementById('exportBtn'); if (ex) ex.textContent = '📥 ' + tx.down;
  }
  const tx = T || { full: '전체 편집', design: '디자인', show: '표시', cover: '표지', text: '글 고치기', textNote: '카드에만 쓰는 제목·글이에요. 앱의 제목은 바뀌지 않아요.', down: '이미지로 받기', qr: 'QR 코드 보이기 (판매 링크)' };
  // 원래 화면으로: 새 탭으로 열렸으면 탭을 닫고, 폰 앱처럼 같은 화면에서 넘어왔으면 그 작품 상세로 돌아가요.
  function goBack() {
    if (window.opener && !window.opener.closed) { window.close(); return; }
    location.href = (isPhoneApp ? './' : '/') + '#open=' + encodeURIComponent(workId);
  }
  const bar = document.createElement('div');
  bar.id = 'vbBar';
  bar.innerHTML = `
    <style>
      #vbBar{position:sticky;top:0;z-index:9999;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 16px;background:#1B1D26;color:#fff;font:14px/1.4 'Apple SD Gothic Neo',system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.2)}
      #vbBar .t{font-weight:600;letter-spacing:.06em}
      #vbBar .w{opacity:.75;max-width:40vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #vbBar .sp{margin-left:auto}
      #vbBar button{height:34px;padding:0 14px;border-radius:8px;border:1px solid rgba(255,255,255,.3);background:transparent;color:#fff;font:inherit;cursor:pointer}
      #vbBar button.p{background:#3443C4;border-color:#3443C4;font-weight:600}
      #vbBar button:disabled{opacity:.6;cursor:default}
      #vbBar img{height:34px;border-radius:4px}
      #vbBar button.bk{border-color:transparent;padding:0 8px;font-weight:600}
      #vbBar button{white-space:nowrap}
      @media (max-width:600px){#vbBar{gap:8px;padding:max(10px,env(safe-area-inset-top)) 10px 10px}#vbBar .t,#vbBar #vbCurrent{display:none}#vbBar .w{max-width:none;flex:1;min-width:0}#vbBar .sp{flex-basis:100%;height:0;margin:0}#vbBar #vbRefill{flex:0 0 auto}#vbBar #vbSave{flex:1}}
    </style>
    <button type="button" id="vbBack" class="bk">‹ ${BACK}</button>
    <span class="t">VOICE BOX</span><span class="w" id="vbWork">${MSG.loading}</span>
    <span class="sp"></span>
    <span id="vbCurrent"></span>
    <button type="button" id="vbRefill" title="${MSG.refillTip}">${MSG.refill}</button>
    <button type="button" id="vbFull">${tx.full}</button>
    <button type="button" class="p" id="vbSave">${MSG.saveLong}</button>`;
  document.body.prepend(bar);
  document.getElementById('vbBack').onclick = goBack;
  document.getElementById('vbFull').onclick = () => {
    const u = new URL(location.href);
    if (LITE) u.searchParams.set('full', '1'); else u.searchParams.delete('full');
    location.replace(u.toString());
  };
  if (!LITE) document.getElementById('vbFull').textContent = '‹ ' + ({ en: 'Simple view', ja: 'かんたん表示' }[LANG] || '간단 화면');
  if (LITE) setupLite();

  function setupLite() {
    document.body.classList.add('vb-lite');
    const st = document.createElement('style');
    st.textContent = `
      .vb-lite .topbar, .vb-lite .editor-credit, .vb-lite #resetBtn, .vb-lite #vbRefill, .vb-lite #vbCurrent { display: none !important; }
      .vb-lite .field[data-vbtab="hide"] { display: none !important; }
      .vb-lite .field[data-vbtab]:not(.vb-on) { display: none !important; }
      .vb-lite .vb-tabs { grid-column: 1 / -1; display: flex; gap: 4px; padding: 4px; border-radius: 12px; background: var(--border, rgba(127,127,127,.15)); margin-bottom: 4px; }
      .vb-lite .vb-tabs button { flex: 1; border: none; background: none; padding: 9px 0; border-radius: 9px; font: inherit; font-size: 14px; color: inherit; opacity: .65; cursor: pointer; }
      .vb-lite .vb-tabs button.on { background: var(--card, #fff); opacity: 1; font-weight: 700; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
      .vb-lite .vb-note { grid-column: 1 / -1; font-size: 12px; opacity: .7; }
      .vb-lite .vb-note:not(.vb-on) { display: none; }
      .vb-lite #exportBtn { font-size: 14px; }
      .vb-lite .preview-wrap { top: var(--vbbar-h, 0px) !important; }
    `;
    document.head.appendChild(st);
    const field = (id) => document.getElementById(id)?.closest('.field');
    const groups = {
      design: ['layoutRow', 'themeSelect', 'fontSizeSlider', 'colorGrid'],
      show: ['ratingRow', 'heartSelectRow', 'chkSpoiler', 'chkDate', 'inHeadline', 'inReviewer'],
      cover: ['thumbBox'],
      text: ['inTitle', 'inReview'],
      hide: ['inCircle', 'inArtist', 'inGenre', 'starSelectRow', 'progressSlider', 'inQR'],
    };
    for (const [tab, ids] of Object.entries(groups)) for (const id of ids) { const f = field(id); if (f) f.dataset.vbtab = tab; }
    const grid = document.querySelector('.editor-grid');
    const tabs = document.createElement('div');
    tabs.className = 'vb-tabs';
    tabs.innerHTML = ['design', 'show', 'cover', 'text'].map((k) => `<button type="button" data-k="${k}">${tx[k]}</button>`).join('');
    grid.prepend(tabs);
    const note = document.createElement('div');
    note.className = 'vb-note'; note.dataset.vbtab2 = 'text'; note.textContent = tx.textNote;
    field('inTitle')?.before(note);
    const qrField = document.createElement('div');
    qrField.className = 'field full'; qrField.dataset.vbtab = 'show';
    qrField.innerHTML = `<label class="check-label"><input type="checkbox" id="vbQrOn"> <span>${tx.qr}</span></label>`;
    (field('inReviewer') || grid.lastElementChild).after(qrField);
    document.getElementById('vbQrOn').onchange = (e) => { setQr(e.target.checked); saveExtra({ qrOff: !e.target.checked }); };
    const show = (k) => {
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
      grid.querySelectorAll('.field[data-vbtab]').forEach((f) => f.classList.toggle('vb-on', f.dataset.vbtab === k));
      note.classList.toggle('vb-on', k === 'text');
    };
    // 카드 언어(카드에 찍히는 '스포일러 주의'·등급 글자): 한국어 / 日本語. 화면 글자는 앱 언어를 따라요.
    const langField = document.createElement('div');
    langField.className = 'field full'; langField.dataset.vbtab = 'design';
    langField.innerHTML = `<label id="vbLblCardLang">${UIL.cardLang}</label><div class="rating-row"><button type="button" class="rating-btn" data-cl="ko">한국어</button><button type="button" class="rating-btn" data-cl="ja">日本語</button></div>`;
    (field('layoutRow') || grid.firstElementChild).after(langField);
    const setCardLang = (l) => {
      try { localStorage.setItem('vb_card_lang', l); } catch {}
      try { setLanguage(l); } catch {}
      langField.querySelectorAll('[data-cl]').forEach((b) => b.classList.toggle('active', b.dataset.cl === l));
      relabel();
    };
    langField.onclick = (e) => { const b = e.target.closest('[data-cl]'); if (b) setCardLang(b.dataset.cl); };
    if (typeof window.setLanguage === 'function' && !window.setLanguage.vbWrapped) {
      const orig = window.setLanguage;
      window.setLanguage = function (...args) { const r = orig.apply(this, args); try { relabel(); } catch {} return r; };
      window.setLanguage.vbWrapped = true;
    }
    let cl = null; try { cl = localStorage.getItem('vb_card_lang'); } catch {}
    setCardLang(cl === 'ko' || cl === 'ja' ? cl : (LANG === 'ja' ? 'ja' : 'ko'));
    tabs.onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) show(b.dataset.k); };
    show('design');
    const ex = document.getElementById('exportBtn');
    if (ex) { ex.textContent = '📥 ' + tx.down; new MutationObserver(() => { if (!ex.textContent.includes(tx.down)) ex.textContent = '📥 ' + tx.down; }).observe(ex, { childList: true, characterData: true, subtree: true }); }
    const setH = () => document.documentElement.style.setProperty('--vbbar-h', bar.offsetHeight + 'px');
    setH(); addEventListener('resize', setH);
  }
  const saveLabel = matchMedia('(max-width:600px)').matches ? ({ en: 'Save as card', ja: 'カードを保存' }[LANG] || '대표 카드로 저장') : MSG.saveLong;
  document.getElementById('vbSave').textContent = saveLabel;

  // ---------- 채우기 ----------
  async function coverFile(src) {
    if (!src) return null;
    // 판매 사이트 이미지는 브라우저 보안상 카드에 그리면 저장이 막혀서, VOICE BOX가 받아서 같은 주소로 넘겨줍니다.
    const url = (src.startsWith('/images/') || src.startsWith('images/')) ? src : 'api/image-proxy?work=' + encodeURIComponent(workId) + '&src=' + encodeURIComponent(src);
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    return new File([blob], 'cover', { type: blob.type || 'image/jpeg' });
  }

  function readExtra() { try { return JSON.parse(localStorage.getItem(extraKey) || '{}'); } catch { return {}; } }
  function saveExtra(patch) { try { localStorage.setItem(extraKey, JSON.stringify({ ...readExtra(), ...patch })); } catch {} }
  function setQr(on) {
    setInput('inQR', on && work ? work.url : '');
    try { state.qrUrl = on && work ? (work.url || '') : ''; updateAll(); } catch {}
  }
  async function fill() {
    work = await api('api/works/' + encodeURIComponent(workId));
    $('vbWork').textContent = work.titleKo || work.title;
    document.title = MSG.page + ' · ' + (work.titleKo || work.title);
    const ex0 = readExtra();
    setInput('inTitle', ex0.cardTitle || work.titleKo || work.title);
    setInput('inArtist', String(work.actor || '').split(',').map((s) => s.trim()).filter(Boolean).join(', '));
    setInput('inCircle', work.circle);
    setInput('inGenre', (work.tags || []).join(' · '));
    setInput('inReview', work.review);
    setInput('inQR', ex0.qrOff ? '' : work.url);
    if ($('vbQrOn')) $('vbQrOn').checked = !ex0.qrOff && !!work.url;
    state.starRating = work.rating ? work.rating + '/5' : '선택안함';
    let extra = {};
    try { extra = JSON.parse(localStorage.getItem(extraKey) || '{}'); } catch {}
    setInput('inHeadline', extra.headline || '');
    if (extra.eroRating) state.eroRating = extra.eroRating;
    if (extra.ageRating) state.ageRating = extra.ageRating;
    // 재생 바 위치: 작품마다 무작위로 정하고 기억해요 (다시 열어도 같은 카드).
    if (typeof extra.progress !== 'number') { extra.progress = Math.round((0.15 + Math.random() * 0.7) * 100) / 100; try { localStorage.setItem(extraKey, JSON.stringify(extra)); } catch {} }
    state.progress = extra.progress;
    if ($('progressSlider')) $('progressSlider').value = extra.progress;
    updateAll();
    showCurrent();
    const f = await coverFile((work.sourceImages || work.images || [])[0]).catch(() => null);
    if (f) loadThumb(f);
    else say(MSG.noCover);
  }

  function showCurrent() {
    const cur = (work.reviewCard || [])[0];
    $('vbCurrent').innerHTML = cur ? `<a href="${cur}" target="_blank" title="${MSG.curCard}"><img src="${cur}" alt="${MSG.curCard}"></a>` : '';
  }

  // ---------- 저장: 카드 메이커의 이미지 저장 과정을 그대로 쓰고, 파일 받기 대신 VOICE BOX로 보냅니다 ----------
  function capture(scale) {
    return new Promise((resolve, reject) => {
      const pages = state.cardLayout === 'classic' ? getClassicLayout().pages.length : getReviewLayout().pages.length;
      const blobs = [];
      const origToBlob = HTMLCanvasElement.prototype.toBlob;
      const origClick = HTMLAnchorElement.prototype.click;
      const hadShare = Object.getOwnPropertyDescriptor(navigator, 'canShare');
      const restore = () => {
        HTMLCanvasElement.prototype.toBlob = origToBlob;
        HTMLAnchorElement.prototype.click = origClick;
        if (hadShare) Object.defineProperty(navigator, 'canShare', hadShare); else delete navigator.canShare;
      };
      HTMLCanvasElement.prototype.toBlob = function (cb, type, q) {
        return origToBlob.call(this, (b) => { blobs.push(b); cb && cb(b); }, type, q);
      };
      HTMLAnchorElement.prototype.click = function () {
        if (this.download && this.download.startsWith('voice-drama-')) return; // 파일 받기는 건너뜀
        return origClick.call(this);
      };
      Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
      const started = Date.now();
      const tick = () => {
        if (blobs.length >= pages) { restore(); resolve(blobs.slice(0, pages)); return; }
        if (Date.now() - started > 15000) { restore(); reject(new Error(MSG.makeFail)); return; }
        setTimeout(tick, 150);
      };
      try { exportImage(scale); } catch (e) { restore(); reject(e); return; }
      tick();
    });
  }

  $('vbSave').onclick = async () => {
    const btn = $('vbSave');
    btn.disabled = true; btn.textContent = MSG.saving;
    try {
      const blobs = await capture(2);
      const paths = [];
      for (const b of blobs) {
        const r = await api('api/upload?work=' + encodeURIComponent(workId), { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: b });
        paths.push(r.src);
      }
      const patch = { reviewCard: paths };
      const cardReview = $('inReview').value.trim();
      if (cardReview && cardReview !== (work.review || '').trim()) {
        if (confirm(MSG.reviewDiff)) patch.review = cardReview;
      }
      const t0 = work.titleKo || work.title;
      const ct = $('inTitle').value.trim();
      saveExtra({ headline: $('inHeadline').value, eroRating: state.eroRating, ageRating: state.ageRating, progress: state.progress, cardTitle: ct && ct !== t0 ? ct : '' });
      work = await api('api/works/' + encodeURIComponent(workId), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      channel?.postMessage({ type: 'work', id: workId });
      showCurrent();
      say(paths.length > 1 ? MSG.savedN.replace('{n}', paths.length) : MSG.saved);
      if (isPhoneApp) setTimeout(goBack, 1200); // 폰 앱은 저장하면 작품 화면으로 돌아가요
    } catch (e) {
      say(e.message);
    } finally {
      btn.disabled = false; btn.textContent = saveLabel;
    }
  };
  $('vbRefill').onclick = () => { if (confirm(MSG.refillAsk)) fill().catch((e) => say(e.message)); };

  // 카드 메이커가 이전 작업을 불러온 뒤에 채웁니다.
  setTimeout(() => fill().catch((e) => say(e.message)), 50);
})();

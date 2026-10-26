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
    if (!r.ok) throw new Error(d.error || '요청을 처리하지 못했어요.');
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
  const BACK = { en: 'Back', ja: '戻る' }[LANG] || '돌아가기';
  const isPhoneApp = /reviewcard\.html$/.test(location.pathname);
  // 간단 화면: 작품 정보는 VOICE BOX에서 자동으로 채우니 입력칸은 숨기고 디자인만 골라요. (?full=1 이면 원래 메이커 그대로)
  const LITE = !new URLSearchParams(location.search).has('full');
  const T = {
    ko: { full: '전체 편집', design: '디자인', show: '표시', cover: '표지', text: '글 고치기', textNote: '카드에만 쓰는 글이에요. 저장할 때 감상에도 반영할지 물어봐요.', down: '이미지로 받기' },
    en: { full: 'Full editor', design: 'Design', show: 'Display', cover: 'Cover', text: 'Edit text', textNote: 'Text for this card only. You will be asked whether to update your review when saving.', down: 'Download image' },
    ja: { full: 'フル編集', design: 'デザイン', show: '表示', cover: '表紙', text: '文章を編集', textNote: 'カード用の文章です。保存時に感想へ反映するか確認します。', down: '画像を保存' },
  }[LANG] || null;
  const tx = T || { full: '전체 편집', design: '디자인', show: '표시', cover: '표지', text: '글 고치기', textNote: '카드에만 쓰는 글이에요. 저장할 때 감상에도 반영할지 물어봐요.', down: '이미지로 받기' };
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
    <span class="t">VOICE BOX</span><span class="w" id="vbWork">불러오는 중…</span>
    <span class="sp"></span>
    <span id="vbCurrent"></span>
    <button type="button" id="vbRefill" title="작품 정보·감상·표지를 다시 채워요">다시 채우기</button>
    <button type="button" id="vbFull">${tx.full}</button>
    <button type="button" class="p" id="vbSave">VOICE BOX에 대표 카드로 저장</button>`;
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
      text: ['inReview'],
      hide: ['inTitle', 'inCircle', 'inArtist', 'inGenre', 'starSelectRow', 'progressSlider', 'inQR'],
    };
    for (const [tab, ids] of Object.entries(groups)) for (const id of ids) { const f = field(id); if (f) f.dataset.vbtab = tab; }
    const grid = document.querySelector('.editor-grid');
    const tabs = document.createElement('div');
    tabs.className = 'vb-tabs';
    tabs.innerHTML = ['design', 'show', 'cover', 'text'].map((k) => `<button type="button" data-k="${k}">${tx[k]}</button>`).join('');
    grid.prepend(tabs);
    const note = document.createElement('div');
    note.className = 'vb-note'; note.dataset.vbtab2 = 'text'; note.textContent = tx.textNote;
    field('inReview')?.before(note);
    const show = (k) => {
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
      grid.querySelectorAll('.field[data-vbtab]').forEach((f) => f.classList.toggle('vb-on', f.dataset.vbtab === k));
      note.classList.toggle('vb-on', k === 'text');
    };
    tabs.onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) show(b.dataset.k); };
    show('design');
    const ex = document.getElementById('exportBtn');
    if (ex) { ex.textContent = '📥 ' + tx.down; new MutationObserver(() => { if (!ex.textContent.includes(tx.down)) ex.textContent = '📥 ' + tx.down; }).observe(ex, { childList: true, characterData: true, subtree: true }); }
    const setH = () => document.documentElement.style.setProperty('--vbbar-h', bar.offsetHeight + 'px');
    setH(); addEventListener('resize', setH);
  }
  const saveLabel = matchMedia('(max-width:600px)').matches ? ({ en: 'Save as card', ja: 'カードを保存' }[LANG] || '대표 카드로 저장') : 'VOICE BOX에 대표 카드로 저장';
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

  async function fill() {
    work = await api('api/works/' + encodeURIComponent(workId));
    $('vbWork').textContent = work.titleKo || work.title;
    document.title = '리뷰카드 · ' + (work.titleKo || work.title);
    setInput('inTitle', work.titleKo || work.title);
    setInput('inArtist', String(work.actor || '').split(',').map((s) => s.trim()).filter(Boolean).join(', '));
    setInput('inCircle', work.circle);
    setInput('inGenre', (work.tags || []).join(' · '));
    setInput('inReview', work.review);
    setInput('inQR', work.url);
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
    else say('표지를 가져오지 못했어요. 썸네일은 직접 올려 주세요.');
  }

  function showCurrent() {
    const cur = (work.reviewCard || [])[0];
    $('vbCurrent').innerHTML = cur ? `<a href="${cur}" target="_blank" title="지금 저장된 대표 카드"><img src="${cur}" alt="지금 대표 카드"></a>` : '';
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
        if (Date.now() - started > 15000) { restore(); reject(new Error('카드 이미지를 만들지 못했어요.')); return; }
        setTimeout(tick, 150);
      };
      try { exportImage(scale); } catch (e) { restore(); reject(e); return; }
      tick();
    });
  }

  $('vbSave').onclick = async () => {
    const btn = $('vbSave');
    btn.disabled = true; btn.textContent = '저장 중…';
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
        if (confirm('카드의 리뷰 글이 VOICE BOX 감상과 달라요.\n카드의 글로 감상도 바꿀까요?')) patch.review = cardReview;
      }
      try { localStorage.setItem(extraKey, JSON.stringify({ headline: $('inHeadline').value, eroRating: state.eroRating, ageRating: state.ageRating, progress: state.progress })); } catch {}
      work = await api('api/works/' + encodeURIComponent(workId), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      channel?.postMessage({ type: 'work', id: workId });
      showCurrent();
      say(paths.length > 1 ? `대표 카드(${paths.length}장)를 저장했어요.` : '대표 카드를 저장했어요.');
      if (isPhoneApp) setTimeout(goBack, 1200); // 폰 앱은 저장하면 작품 화면으로 돌아가요
    } catch (e) {
      say(e.message);
    } finally {
      btn.disabled = false; btn.textContent = saveLabel;
    }
  };
  $('vbRefill').onclick = () => { if (confirm('제목·성우·서클·장르·감상·별점·표지를 VOICE BOX 내용으로 다시 채울까요?')) fill().catch((e) => say(e.message)); };

  // 카드 메이커가 이전 작업을 불러온 뒤에 채웁니다.
  setTimeout(() => fill().catch((e) => say(e.message)), 50);
})();

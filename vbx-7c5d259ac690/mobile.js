// VOICE BOX 폰 앱: 오프라인 준비, 새 버전 반영, 첫 화면(백업 불러오기 · 설치 안내)
import { hasData } from './local-api.js';

if ('serviceWorker' in navigator) {
  // 새 버전이 올라오면 한 번 새로고침해서 바로 바꿔요.
  const had = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!had || reloaded || document.querySelector('dialog[open]')) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
}

const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const isIOSOther = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(navigator.userAgent);

const ICON = {
  lock: '<path d="M7 11V8a5 5 0 0 1 10 0v3"/><rect x="5" y="11" width="14" height="10" rx="2"/>',
  offline: '<path d="M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5.1A15 15 0 0 1 22 8.8M5 12.5a10 10 0 0 1 5.1-2.4M16.9 11.2A10 10 0 0 1 19 12.5M8.5 16.1a5 5 0 0 1 7 0M12 20h.01M3 3l18 18"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  dots: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 12v6M9 15l3 3 3-3"/>',
};
const svg = (d, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const T = {
  ko: {
    head: '목소리로 남는 이야기,<br>내 기록장',
    lead: '들은 보이스 작품의 별점과 감상을 모아두는 개인 기록 앱이에요.',
    f1: '기록은 <b>이 기기 안에만</b> 저장돼요 · 서버로 보내지 않아요', f2: '설치하면 <b>인터넷 없이도</b> 열려요',
    install: '앱으로 설치하기', ios: '아이폰', android: '안드로이드',
    iosSteps: [`<b>Safari</b>로 이 주소 열기`, `아래쪽 공유 버튼 ${svg(ICON.share, 14)} → <b>홈 화면에 추가</b>`, '<b>웹 앱으로 열기</b>가 켜져 있는지 확인 → 추가', '홈 화면의 <b>VOICE BOX 아이콘</b>으로 열고 시작하기'],
    iosNote: 'Chrome 등 다른 브라우저로 추가하면 즐겨찾기처럼 브라우저로 열리고 인터넷 없이는 열리지 않아요. 기록도 브라우저와 앱이 따로 저장돼요.',
    andSteps: [`Chrome 오른쪽 위 ${svg(ICON.dots, 14)} 메뉴`, '<b>앱 설치</b> (없으면 <b>홈 화면에 추가</b> → 설치)', '앱 목록의 <b>VOICE BOX</b>로 열고 시작하기'],
    andNote: '설치한 앱과 브라우저의 기록은 따로 저장돼요. 설치한 앱에서 시작하세요.',
    installed: '앱으로 실행 중이에요. 인터넷 없이도 열려요.',
    load: '백업 파일 불러오기', blank: '처음부터 시작',
    small: '전에 받아 둔 <b>복원용 백업(JSON)</b>이 있으면 불러와서 이어서 쓸 수 있어요. 기록은 이 기기에만 있으니 가끔 <b>설정 → 복원용 백업 받기</b>로 보관해 두세요.',
    loading: '불러오는 중…', done: (n) => `작품 ${n}개를 불러왔어요.`, fail: '불러오지 못했어요: ',
    bIosOther: '지금은 브라우저 안에서 열려 있어요. 아이폰은 <b>Safari</b>로 홈 화면에 추가해야 인터넷 없이 열리고 기록도 안전하게 남아요.',
    bIosSafari: '브라우저 탭에서 열려 있어요. <b>공유 → 홈 화면에 추가</b>로 설치하면 인터넷 없이도 열려요.',
    bAndroid: '브라우저 탭에서 열려 있어요. Chrome <b>⋮ → 앱 설치</b>로 설치하면 인터넷 없이도 열려요.',
    copy: '주소 복사', copied: '복사했어요', later: '닫기',
  },
  en: {
    head: 'Stories that stay as voices,<br>your own log',
    lead: 'A personal app for keeping ratings and reviews of the voice works you listen to.',
    f1: 'Everything stays <b>on this device</b> · nothing is sent to a server', f2: 'Once installed, it opens <b>without internet</b>',
    install: 'Install as an app', ios: 'iPhone', android: 'Android',
    iosSteps: [`Open this address in <b>Safari</b>`, `Share ${svg(ICON.share, 14)} → <b>Add to Home Screen</b>`, 'Make sure <b>Open as Web App</b> is on → Add', 'Open the <b>VOICE BOX icon</b> and start there'],
    iosNote: 'Added from Chrome or another browser, the icon works like a bookmark and will not open offline. The browser and the app also keep separate data.',
    andSteps: [`Chrome menu ${svg(ICON.dots, 14)} at the top right`, '<b>Install app</b> (or <b>Add to Home screen</b> → Install)', 'Open <b>VOICE BOX</b> from your apps and start there'],
    andNote: 'The installed app and the browser keep separate data. Start in the installed app.',
    installed: 'Running as an app. It opens without internet.',
    load: 'Import backup file', blank: 'Start fresh',
    small: 'Have a <b>restore backup (JSON)</b>? Import it to continue where you left off. Your data lives only on this device, so save a backup now and then in <b>Settings</b>.',
    loading: 'Importing…', done: (n) => `Imported ${n} works.`, fail: 'Could not import: ',
    bIosOther: 'This is open inside a browser. On iPhone, add it to the Home Screen from <b>Safari</b> to open it offline and keep your data safe.',
    bIosSafari: 'Open in a browser tab. Install with <b>Share → Add to Home Screen</b> to open it without internet.',
    bAndroid: 'Open in a browser tab. Install with Chrome <b>⋮ → Install app</b> to open it without internet.',
    copy: 'Copy link', copied: 'Copied', later: 'Close',
  },
  ja: {
    head: '声で残る物語、<br>わたしの記録帳',
    lead: '聴いたボイス作品の評価と感想をまとめておく、個人用の記録アプリです。',
    f1: '記録は<b>この端末の中だけ</b>に保存 · サーバーには送りません', f2: 'インストールすると<b>オフラインでも</b>開けます',
    install: 'アプリとしてインストール', ios: 'iPhone', android: 'Android',
    iosSteps: [`<b>Safari</b>でこのアドレスを開く`, `下部の共有ボタン ${svg(ICON.share, 14)} → <b>ホーム画面に追加</b>`, '<b>Webアプリとして開く</b>がオンか確認 → 追加', 'ホーム画面の <b>VOICE BOX アイコン</b>から開いて始める'],
    iosNote: 'Chrome など他のブラウザで追加するとブックマークのようにブラウザで開き、オフラインでは開けません。記録もブラウザとアプリで別々に保存されます。',
    andSteps: [`Chrome 右上の ${svg(ICON.dots, 14)} メニュー`, '<b>アプリをインストール</b>(ない場合は<b>ホーム画面に追加</b> → インストール)', 'アプリ一覧の <b>VOICE BOX</b> から開いて始める'],
    andNote: 'インストールしたアプリとブラウザの記録は別々に保存されます。インストールしたアプリで始めてください。',
    installed: 'アプリとして実行中です。オフラインでも開けます。',
    load: 'バックアップを読み込む', blank: '最初から始める',
    small: '以前保存した<b>復元用バックアップ(JSON)</b>があれば、読み込んで続きから使えます。記録はこの端末にだけあるので、ときどき<b>設定 → 復元用バックアップを保存</b>で保管しましょう。',
    loading: '読み込み中…', done: (n) => `${n}作品を読み込みました。`, fail: '読み込めませんでした: ',
    bIosOther: 'いまブラウザの中で開いています。iPhone では <b>Safari</b> からホーム画面に追加すると、オフラインでも開けて記録も安全に残ります。',
    bIosSafari: 'ブラウザのタブで開いています。<b>共有 → ホーム画面に追加</b>でインストールするとオフラインでも開けます。',
    bAndroid: 'ブラウザのタブで開いています。Chrome の <b>⋮ → アプリをインストール</b>でインストールするとオフラインでも開けます。',
    copy: 'リンクをコピー', copied: 'コピーしました', later: '閉じる',
  },
};

function getLang() {
  try { const v = JSON.parse(localStorage.getItem('voicebox.view') || '{}').menuLang; if (T[v]) return v; } catch {}
  const n = (navigator.language || '').toLowerCase();
  return n.startsWith('ja') ? 'ja' : n.startsWith('ko') ? 'ko' : 'en';
}
function setLang(l) {
  try { const v = JSON.parse(localStorage.getItem('voicebox.view') || '{}'); v.menuLang = l; localStorage.setItem('voicebox.view', JSON.stringify(v)); } catch {}
}

function welcome() {
  let lang = getLang();
  let os = isIOS ? 'ios' : 'android';
  const box = document.createElement('div');
  box.className = 'vb-welcome';
  document.body.appendChild(box);
  const steps = (arr) => `<ol class="vb-steps">${arr.map((x) => `<li><span>${x}</span></li>`).join('')}</ol>`;
  const draw = () => {
    const t = T[lang];
    box.innerHTML = `
    <div class="vb-welcome-card" role="dialog" aria-label="VOICE BOX">
      <div class="vb-top">
        <div class="vb-logo"><svg class="vb-mark" viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" rx="24" fill="var(--accent)"/><rect x="28" y="18" width="50" height="64" rx="8" fill="var(--surface)"/><path d="M28 29h-6M28 41h-6M28 53h-6M28 65h-6" stroke="var(--surface)" stroke-width="4" stroke-linecap="round"/><rect x="45" y="30" width="16" height="24" rx="8" fill="var(--accent)"/><path d="M53 35.5l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" fill="var(--surface)"/><path d="M40 48a13 13 0 0 0 26 0M53 61v8M47 69h12" fill="none" stroke="var(--accent)" stroke-width="3.6" stroke-linecap="round"/></svg>VOICE BOX</div>
        <div class="vb-lang" role="group" aria-label="Language">${[['ko', '한'], ['en', 'EN'], ['ja', '日']].map(([v, l]) => `<button type="button" data-lang="${v}" class="${v === lang ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
      <h1>${t.head}</h1>
      <p class="vb-lead">${t.lead}</p>
      <div class="vb-feats"><span>${svg(ICON.lock)}<span>${t.f1}</span></span><span>${svg(ICON.offline)}<span>${t.f2}</span></span></div>
      ${isStandalone ? `<p class="vb-ok">✓ ${t.installed}</p>` : `
      <div class="vb-install">
        ${isIOSOther ? `<p class="vb-note">${t.bIosOther}</p>` : ''}
        <div class="vb-sec">${t.install}</div>
        <div class="vb-os" role="tablist">${[['ios', t.ios], ['android', t.android]].map(([v, l]) => `<button type="button" role="tab" data-os="${v}" class="${v === os ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${os === 'ios' ? steps(t.iosSteps) + `<p class="vb-note">${t.iosNote}</p>` : steps(t.andSteps) + `<p class="vb-note">${t.andNote}</p>`}
      </div>`}
      <div class="vb-actions">
        <label class="vb-btn vb-primary">${svg(ICON.file, 18)}${t.load}<input type="file" accept=".json,application/json" hidden></label>
        <button type="button" class="vb-btn" data-start>${t.blank}</button>
      </div>
      <p class="vb-small">${t.small}</p>
      <p class="vb-msg" aria-live="polite"></p>
    </div>`;
    box.querySelectorAll('[data-lang]').forEach((b) => (b.onclick = () => { lang = b.dataset.lang; setLang(lang); draw(); }));
    box.querySelectorAll('[data-os]').forEach((b) => (b.onclick = () => { os = b.dataset.os; draw(); }));
    box.querySelector('[data-start]').onclick = () => { setLang(lang); try { localStorage.setItem('voicebox.started', '1'); } catch {} location.reload(); };
    box.querySelector('input').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const msg = box.querySelector('.vb-msg');
      msg.textContent = t.loading;
      try {
        const data = JSON.parse(await f.text());
        const r = await fetch('api/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setLang(lang);
        msg.textContent = t.done(j.count);
        setTimeout(() => location.reload(), 600);
      } catch (err) {
        msg.textContent = t.fail + err.message;
      }
    };
  };
  draw();
}

// 설치하지 않고 브라우저 탭에서 열었을 때 안내 줄
function browserBanner() {
  if (isStandalone) return;
  try { if (Number(localStorage.getItem('voicebox.bannerHidden') || 0) > Date.now()) return; } catch {}
  const t = T[getLang()];
  const msg = isIOS ? (isIOSOther ? t.bIosOther : t.bIosSafari) : t.bAndroid;
  const bar = document.createElement('div');
  bar.className = 'vb-banner' + (isIOSOther ? ' warn' : '');
  bar.innerHTML = `<span>${msg}</span><div class="vb-banner-acts">${isIOSOther ? `<button type="button" data-copy>${t.copy}</button>` : ''}<button type="button" data-hide>${t.later}</button></div>`;
  document.body.appendChild(bar);
  document.body.classList.add('has-banner');
  bar.querySelector('[data-hide]').onclick = () => {
    bar.remove(); document.body.classList.remove('has-banner');
    try { localStorage.setItem('voicebox.bannerHidden', String(Date.now() + (isIOSOther ? 864e5 : 7 * 864e5))); } catch {}
  };
  const c = bar.querySelector('[data-copy]');
  if (c) c.onclick = async () => { try { await navigator.clipboard.writeText(location.href.split('?')[0]); c.textContent = t.copied; } catch {} };
}
const started = () => { try { return localStorage.getItem('voicebox.started') === '1'; } catch { return false; } };
hasData().then((has) => { if (!has && !started()) welcome(); else browserBanner(); });

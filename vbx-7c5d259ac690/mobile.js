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
    f1: '기록은 <b>이 폰 안에만</b> 저장돼요', f2: '인터넷이 없어도 열려요',
    install: '앱으로 설치하기', ios: '아이폰', android: '안드로이드',
    iosSteps: [`Safari 아래쪽 공유 버튼 ${svg(ICON.share, 14)}<br><small>Chrome은 주소창 오른쪽 공유 버튼</small>`, '<b>홈 화면에 추가</b> → 추가', '홈 화면의 <b>VOICE BOX 아이콘</b>으로 열기', '거기서 <b>백업 파일 불러오기</b>'],
    iosNote: '아이폰은 브라우저와 홈 화면 앱의 저장 공간이 따로예요. 꼭 설치한 아이콘에서 불러오세요.',
    andSteps: [`Chrome 오른쪽 위 ${svg(ICON.dots, 14)} 메뉴`, '<b>앱 설치</b> 또는 <b>홈 화면에 추가</b>', '설치된 <b>VOICE BOX</b> 아이콘으로 열기', '<b>백업 파일 불러오기</b>'],
    installed: '앱으로 설치되어 있어요.',
    load: '백업 파일 불러오기', blank: '빈 상태로 시작',
    small: '아이맥 VOICE BOX 등에서 받은 <b>복원용 백업(JSON)</b>을 불러오면 이어서 쓸 수 있어요. 기록은 가끔 설정 → 복원용 백업 받기로 보관해 두세요.',
    loading: '불러오는 중…', done: (n) => `작품 ${n}개를 불러왔어요.`, fail: '불러오지 못했어요: ',
  },
  en: {
    head: 'Stories that stay as voices,<br>your own log',
    lead: 'A personal app for keeping ratings and reviews of the voice works you listen to.',
    f1: 'Everything stays <b>on this phone</b>', f2: 'Works without internet',
    install: 'Install as an app', ios: 'iPhone', android: 'Android',
    iosSteps: [`Tap Share ${svg(ICON.share, 14)} at the bottom of Safari<br><small>In Chrome, Share is at the right of the address bar</small>`, '<b>Add to Home Screen</b> → Add', 'Open from the <b>VOICE BOX icon</b>', 'Then <b>Import backup</b> there'],
    iosNote: 'On iPhone, the browser and the home screen app keep separate data. Import from the installed icon.',
    andSteps: [`Chrome menu ${svg(ICON.dots, 14)} at the top right`, '<b>Install app</b> or <b>Add to Home screen</b>', 'Open the <b>VOICE BOX</b> icon', '<b>Import backup</b>'],
    installed: 'Installed as an app.',
    load: 'Import backup file', blank: 'Start empty',
    small: 'Import a <b>restore backup (JSON)</b> from VOICE BOX on your Mac to continue where you left off. Save a backup now and then from Settings.',
    loading: 'Importing…', done: (n) => `Imported ${n} works.`, fail: 'Could not import: ',
  },
  ja: {
    head: '声で残る物語、<br>わたしの記録帳',
    lead: '聴いたボイス作品の評価と感想をまとめておく、個人用の記録アプリです。',
    f1: '記録は<b>このスマホの中だけ</b>に保存', f2: 'オフラインでも開けます',
    install: 'アプリとしてインストール', ios: 'iPhone', android: 'Android',
    iosSteps: [`Safari 下部の共有ボタン ${svg(ICON.share, 14)}<br><small>Chrome はアドレスバー右の共有ボタン</small>`, '<b>ホーム画面に追加</b> → 追加', 'ホーム画面の <b>VOICE BOX アイコン</b>から開く', 'そこで<b>バックアップを読み込む</b>'],
    iosNote: 'iPhone ではブラウザとホーム画面アプリの保存領域が別です。必ずインストールしたアイコンから読み込んでください。',
    andSteps: [`Chrome 右上の ${svg(ICON.dots, 14)} メニュー`, '<b>アプリをインストール</b> または <b>ホーム画面に追加</b>', 'インストールした <b>VOICE BOX</b> を開く', '<b>バックアップを読み込む</b>'],
    installed: 'アプリとしてインストール済みです。',
    load: 'バックアップを読み込む', blank: '空の状態で始める',
    small: 'Mac 版 VOICE BOX などで保存した<b>復元用バックアップ(JSON)</b>を読み込むと、続きから使えます。設定からときどきバックアップしておきましょう。',
    loading: '読み込み中…', done: (n) => `${n}作品を読み込みました。`, fail: '読み込めませんでした: ',
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
        <div class="vb-logo"><span></span>VOICE BOX</div>
        <div class="vb-lang" role="group" aria-label="Language">${[['ko', '한'], ['en', 'EN'], ['ja', '日']].map(([v, l]) => `<button type="button" data-lang="${v}" class="${v === lang ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
      <h1>${t.head}</h1>
      <p class="vb-lead">${t.lead}</p>
      <div class="vb-feats"><span>${svg(ICON.lock)}<span>${t.f1}</span></span><span>${svg(ICON.offline)}<span>${t.f2}</span></span></div>
      ${isStandalone ? `<p class="vb-ok">✓ ${t.installed}</p>` : `
      <div class="vb-install">
        <div class="vb-sec">${t.install}</div>
        <div class="vb-os" role="tablist">${[['ios', t.ios], ['android', t.android]].map(([v, l]) => `<button type="button" role="tab" data-os="${v}" class="${v === os ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${os === 'ios' ? steps(t.iosSteps) + `<p class="vb-note">${t.iosNote}</p>` : steps(t.andSteps)}
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

const started = () => { try { return localStorage.getItem('voicebox.started') === '1'; } catch { return false; } };
hasData().then((has) => { if (!has && !started()) welcome(); });

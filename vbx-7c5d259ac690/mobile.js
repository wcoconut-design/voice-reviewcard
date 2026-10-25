// VOICE BOX 폰 앱: 오프라인 준비와 첫 화면(백업 불러오기 · 설치 안내)
import { hasData } from './local-api.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

function installGuide() {
  if (isStandalone) return '';
  return isIOS
    ? '<li>Safari 아래쪽 <b>공유 버튼(□↑)</b> → <b>홈 화면에 추가</b>를 누르면 앱처럼 설치돼요.</li>'
    : '<li>Chrome 오른쪽 위 <b>⋮ 메뉴</b> → <b>앱 설치</b>(또는 홈 화면에 추가)를 누르면 앱처럼 설치돼요.</li>';
}

function welcome() {
  const box = document.createElement('div');
  box.className = 'vb-welcome';
  box.innerHTML = `
    <div class="vb-welcome-card" role="dialog" aria-label="VOICE BOX 시작하기">
      <div class="vb-logo"><span></span>VOICE BOX</div>
      <h1>목소리로 남는 이야기, 내 기록장</h1>
      <p>보이스 드라마·시추에이션 보이스를 들은 기록과 별점, 감상을 모아두는 개인 기록 앱이에요.</p>
      <ul>
        <li>모든 기록은 <b>이 기기 안에만</b> 저장돼요. 서버로 보내지 않아요.</li>
        <li>인터넷이 없어도 기록을 보고 고칠 수 있어요.</li>
        ${installGuide()}
      </ul>
      <div class="vb-actions">
        <label class="vb-btn vb-primary">백업 파일 불러오기<input type="file" accept=".json,application/json" hidden></label>
        <button type="button" class="vb-btn" data-start>빈 상태로 시작</button>
      </div>
      <p class="vb-small">다른 기기(아이맥 VOICE BOX 등)에서 받은 <b>복원용 백업(JSON)</b>을 불러오면 그대로 이어서 쓸 수 있어요.<br>사용법: 작품 추가 → 별점·감상 남기기 → 설정에서 엑셀·감상 모음으로 내보내기</p>
      <p class="vb-msg" aria-live="polite"></p>
    </div>`;
  document.body.appendChild(box);
  box.querySelector('[data-start]').onclick = () => box.remove();
  box.querySelector('input').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const msg = box.querySelector('.vb-msg');
    msg.textContent = '불러오는 중…';
    try {
      const data = JSON.parse(await f.text());
      const r = await fetch('api/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      msg.textContent = `작품 ${j.count}개를 불러왔어요.`;
      setTimeout(() => location.reload(), 600);
    } catch (err) {
      msg.textContent = '불러오지 못했어요: ' + err.message;
    }
  };
}

hasData().then((has) => { if (!has) welcome(); });

// 소개글에 섞여 있는 간단한 마크다운(**굵게**, ### 제목, * 목록, ---)을 보기 좋게 바꿉니다.
// 먼저 HTML을 모두 이스케이프하므로 소개글 안의 태그는 실행되지 않습니다.
window.renderIntro = function renderIntro(src) {
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = [];
  const flushPara = () => { if (para.length) out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; };
  const flushList = () => { if (list.length) out.push('<ul>' + list.map((x) => '<li>' + inline(x) + '</li>').join('') + '</ul>'); list = []; };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); continue; }
    if ((m = line.match(/^\s*#{1,6}\s*(.+)$/))) { flushPara(); flushList(); out.push('<h4>' + inline(m[1].replace(/#+\s*$/, '')) + '</h4>'); continue; }
    if ((m = line.match(/^\s*[*\-•・]\s+(.+)$/))) { flushPara(); list.push(m[1]); continue; }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join('');
};

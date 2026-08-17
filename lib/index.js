// dsh-mobile-remote — 手机远程控制 DeepSeek Harness
// 在现有 webServer(3080) 上提供：
//   GET  /m         移动端页面
//   GET  /m/state   会话列表(含冷会话) / 单会话详情 (JSON)
//   POST /m/mount   挂载(恢复)一个冷会话，使其可被控制
//   POST /m/prompt  把提示注入「已挂载」会话（agent.followup）
// 所有路由都要求 ?t=<token> 认证；token 可用 row 的 config.token 覆盖。

export const name = 'mobile-remote'
export const inject = ['webServer']

const DEFAULT_TOKEN = 'mob-9e7c5a3b1f'

function qp(url, key) {
  const q = String(url == null ? '' : url).split('?')[1] || ''
  for (const pair of q.split('&')) {
    const i = pair.indexOf('=')
    if (i < 0) continue
    const k = decodeURIComponent(pair.slice(0, i))
    if (k === key) return decodeURIComponent(pair.slice(i + 1))
  }
  return null
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (c) => { body += c })
    req.on('end', () => resolve(body))
    req.on('error', () => resolve(body))
  })
}

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

function json(res, code, obj) { send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj)) }
function html(res, code, body) { send(res, code, 'text/html; charset=utf-8', body) }

function textOf(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks.map((b) => {
    if (b && b.type === 'text') return b.text || ''
    if (b && b.type === 'image') return '[图片]'
    if (b && (b.type === 'tool_use' || b.type === 'tool-use')) return '[调用 ' + (b.name || '工具') + ']'
    return ''
  }).join('')
}

function textOnlyOf(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('')
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inlineMd(s) {
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  return s
}

function renderMarkdown(src) {
  const lines = String(src == null ? '' : src).split('\n')
  let out = ''
  let i = 0
  let inCode = false
  let codeBuf = []
  let para = []
  let list = null

  const flushPara = () => {
    if (para.length) { out += '<p>' + para.map((l) => inlineMd(escapeHtml(l))).join('<br>') + '</p>'; para = [] }
  }
  const flushList = () => { if (list) { out += '</' + list + '>'; list = null } }

  while (i < lines.length) {
    const line = lines[i]
    const t = line.trim()

    if (t.startsWith('```')) {
      if (!inCode) { flushPara(); flushList(); inCode = true; codeBuf = [] }
      else { out += '<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>'; inCode = false; codeBuf = [] }
      i++; continue
    }
    if (inCode) { codeBuf.push(line); i++; continue }
    if (t === '') { flushPara(); flushList(); i++; continue }

    const h = t.match(/^(#{1,4})\s+(.+)$/)
    if (h) { flushPara(); flushList(); out += '<h' + h[1].length + '>' + inlineMd(escapeHtml(h[2])) + '</h' + h[1].length + '>'; i++; continue }

    if (t.startsWith('>')) { flushPara(); flushList(); out += '<blockquote>' + inlineMd(escapeHtml(t.slice(1).trim())) + '</blockquote>'; i++; continue }

    const ul = t.match(/^[-*]\s+(.+)$/)
    const ol = t.match(/^\d+[.)]\s+(.+)$/)
    if (ul || ol) {
      flushPara()
      const kind = ul ? 'ul' : 'ol'
      const content = ul ? ul[1] : ol[1]
      if (list !== kind) { flushList(); list = kind; out += '<' + kind + '>' }
      out += '<li>' + inlineMd(escapeHtml(content)) + '</li>'
      i++; continue
    }

    flushList()
    para.push(line)
    i++
  }

  if (inCode) out += '<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>'
  flushList()
  flushPara()
  return out
}

const PAGE = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>DSH 远程</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;background:#0b0f14;color:#e7ecf3;min-height:100vh}
header{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(18,23,31,.92);backdrop-filter:blur(10px);border-bottom:1px solid #1f2833}
header .brand{flex:1;min-width:0}
header .brand h1{margin:0;font-size:17px;font-weight:700;letter-spacing:.2px}
header .brand .sub{margin:1px 0 0;font-size:11px;color:#8a97a8}
.pill{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;border:1px solid #2a3442;background:#151b23}
.pill .dot{width:8px;height:8px;border-radius:50%;background:#5b6470}
.pill.running{color:#34d399;border-color:#1f4a3a;background:#0f2319}
.pill.running .dot{background:#34d399}
.pill.cold{color:#8a97a8}
.pill.cold .dot{background:#4a5560}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid #2a3442;background:#151b23;color:#cbd5e1;border-radius:10px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer}
.btn:active{transform:scale(.97);background:#1b232d}
main{padding:14px;max-width:620px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.card{background:#12171f;border:1px solid #1f2833;border-radius:16px;padding:14px;box-shadow:0 1px 0 rgba(255,255,255,.03) inset}
.card h2{display:flex;align-items:center;gap:7px;margin:0 0 10px;font-size:12px;font-weight:700;color:#8a97a8;text-transform:uppercase;letter-spacing:.6px}
.card h2 .ic{font-size:14px}
.card h2 .spacer{flex:1}
.mini{display:inline-flex;align-items:center;gap:4px;border:1px solid #2a3442;background:#151b23;color:#cbd5e1;border-radius:8px;padding:4px 9px;font-size:11px;font-weight:600;cursor:pointer}
.mini:active{background:#1b232d}
.sess{display:flex;align-items:center;gap:10px;padding:11px 12px;border:1px solid #1f2833;border-radius:12px;margin-bottom:8px;cursor:pointer;background:#151b23;transition:border-color .12s,background .12s}
.sess:last-child{margin-bottom:0}
.sess.sel{border-color:#3b82f6;background:#15202d}
.sess .statusdot{width:9px;height:9px;border-radius:50%;flex:none;background:#4a5560}
.sess .statusdot.running{background:#34d399;box-shadow:0 0 0 3px rgba(52,211,153,.15)}
.sess .statusdot.cold{background:#3a424c}
.sess .body{flex:1;min-width:0}
.sess .t{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sess .m{font-size:11px;color:#6b7686;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;font-family:ui-monospace,'SF Mono',Consolas,monospace}
.tag{flex:none;font-size:11px;font-weight:600;padding:3px 8px;border-radius:8px;background:#1f2833;color:#8a97a8}
.tag.running{background:#0f2319;color:#34d399}
.tag.cold{background:#1c2530;color:#60a5fa}
.goalbox .obj{font-size:15px;font-weight:600;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.goalbox .meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:9px;font-size:12px;color:#8a97a8}
.phase{font-size:11px;font-weight:700;padding:3px 9px;border-radius:8px}
.phase.active{background:#0f2319;color:#34d399}
.phase.paused{background:#2a2410;color:#fbbf24}
.phase.blocked{background:#2a1515;color:#f87171}
.phase.complete{background:#14212e;color:#60a5fa}
.blocked{margin-top:9px;font-size:12px;color:#fca5a5;background:#2a1515;border:1px solid #4a2020;border-radius:10px;padding:8px 10px}
.todo{display:flex;align-items:center;gap:9px;padding:6px 0;font-size:13px;border-bottom:1px solid #1a212b}
.todo:last-child{border-bottom:0}
.todo .st{width:9px;height:9px;border-radius:50%;flex:none}
.st.pending{background:#5b6470}.st.in_progress{background:#fbbf24;box-shadow:0 0 0 3px rgba(251,191,36,.14)}.st.completed{background:#34d399}
.todo .txt{flex:1;word-break:break-word}
.todo.done .txt{color:#5b6470;text-decoration:line-through}
.todosum{font-size:11px;color:#6b7686;margin-top:9px}
.statsgrid{display:flex;flex-wrap:wrap;gap:8px}
.stat{flex:1 1 30%;min-width:80px;background:#151b23;border:1px solid #1f2833;border-radius:10px;padding:8px 10px}
.sk{display:block;font-size:11px;color:#6b7686;margin-bottom:3px}
.sv{display:block;font-size:14px;font-weight:700;color:#dbe2ea;word-break:break-all}
.activity{position:relative;max-height:60vh;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding-right:2px}
.turn{display:flex;flex-direction:column;gap:6px;scroll-margin-top:6px}
.turn.thumb{flex-direction:row;align-items:center;gap:8px;background:#151b23;border:1px solid #1f2833;border-radius:10px;padding:9px 11px;cursor:pointer}
.turn.thumb .qtime{flex:none;font-size:11px;color:#6b7686;font-family:ui-monospace,Consolas,monospace}
.turn.thumb .qprev{flex:1;min-width:0;font-size:13px;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.turn.thumb .qcount{flex:none;font-size:11px;color:#8a97a8;background:#1f2833;border-radius:8px;padding:2px 7px}
.turn.thumb .qarrow{flex:none;color:#5b6470;font-size:12px}
.stickybar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;font-weight:700;color:#9fc2e8;background:#1b2a3d;border:1px solid #3b82f6;border-radius:10px;padding:8px 12px;cursor:pointer;margin-bottom:8px;box-shadow:0 4px 12px rgba(0,0,0,.4)}
.stickybar:active{background:#22364d}
.bubble{border-radius:14px;padding:9px 12px;max-width:100%;font-size:13px}
.bubble .qmeta{font-size:10px;color:#8a97a8;margin-bottom:4px;font-weight:600}
.bubble.user{align-self:flex-end;background:#1b3a5c;border:1px solid #2a4d78;max-width:92%}
.bubble.user .qmeta{color:#9fc2e8}
.bubble.sys{align-self:flex-start;background:#1a1f27;border:1px solid #232c38;max-width:92%}
.bubble.assistant{align-self:flex-start;background:#151b23;border:1px solid #232c38}
.toolchip{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#c4b5fd;background:#171327;border:1px solid #2a2140;border-radius:8px;padding:4px 9px;font-family:ui-monospace,Consolas,monospace;word-break:break-all}
.md{font-size:13px;line-height:1.6;color:#dbe2ea;word-break:break-word}
.md p{margin:4px 0}
.md h1{font-size:16px;font-weight:700;margin:8px 0 4px;line-height:1.4}
.md h2{font-size:15px;font-weight:700;margin:7px 0 3px;line-height:1.4}
.md h3{font-size:14px;font-weight:700;margin:6px 0 3px;line-height:1.4}
.md h4{font-size:13px;font-weight:700;margin:6px 0 3px;line-height:1.4}
.md code{font-family:ui-monospace,'SF Mono',Consolas,monospace;font-size:12px;background:#0b0f14;border:1px solid #26303c;border-radius:4px;padding:1px 5px;color:#a5d8ff}
.md pre{background:#0b0f14;border:1px solid #26303c;border-radius:8px;padding:10px;overflow-x:auto;margin:6px 0}
.md pre code{background:none;border:0;padding:0;font-size:12px;line-height:1.55;color:#c9d4e0;display:block;white-space:pre}
.md ul,.md ol{margin:4px 0;padding-left:20px}
.md li{margin:2px 0}
.md blockquote{border-left:3px solid #3b82f6;padding:4px 10px;margin:6px 0;color:#9aa7b5;background:#151b23;border-radius:0 6px 6px 0}
.md a{color:#60a5fa;text-decoration:none}
.md strong{font-weight:700}
.approvals{position:fixed;left:14px;right:14px;top:64px;z-index:40;display:none;max-width:592px;margin:0 auto}
.abanner{background:#241f0c;border:1px solid #6b5a1a;border-left:4px solid #fbbf24;border-radius:12px;padding:10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.5)}
.abanner .ahead{font-size:12px;font-weight:800;color:#fbbf24;display:flex;align-items:center;gap:6px;margin-bottom:6px}
.approval{padding:6px 0;border-bottom:1px solid #3a341c}
.approval:last-child{border-bottom:0}
.atitle{font-size:13px;font-weight:700;color:#fbbf24}
.areason{font-size:12px;color:#e0c05f;margin-top:3px;word-break:break-word;line-height:1.5}
.ameta{font-size:11px;color:#9a8a3a;margin-top:2px}
.abtns{display:flex;gap:8px;margin-top:8px}
.abtn{flex:1;padding:7px;border-radius:8px;border:1px solid;font-size:13px;font-weight:700;cursor:pointer}
.abtn.ok{background:#0f2319;border-color:#1f4a3a;color:#34d399}
.abtn.no{background:#2a1515;border-color:#4a2020;color:#f87171}
.abtn:active{opacity:.8}
.jumpoverlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:50;display:none;align-items:flex-start;justify-content:center;padding:12vh 14px 14px}
.jumpoverlay.open{display:flex}
.jumppanel{width:100%;max-width:480px;max-height:70vh;background:#12171f;border:1px solid #232c38;border-radius:16px;display:flex;flex-direction:column;overflow:hidden}
.jumphead{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #1f2833;font-weight:700;font-size:14px}
.jumplist{overflow-y:auto;padding:8px}
.jumpitem{display:block;width:100%;text-align:left;background:#151b23;border:1px solid #1f2833;border-radius:10px;padding:10px 12px;margin-bottom:8px;color:#dbe2ea;font-size:13px;cursor:pointer;line-height:1.5}
.jumpitem .jt{color:#6b7686;font-size:11px;margin-top:2px}
textarea{width:100%;min-height:70px;background:#0b0f14;color:#e7ecf3;border:1px solid #26303c;border-radius:12px;padding:11px 12px;font-size:15px;line-height:1.5;resize:vertical;font-family:inherit;outline:none}
textarea:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.15)}
.sendrow{margin-top:10px;display:flex;gap:8px}
.sendrow button{flex:1;padding:12px;background:#3b82f6;color:#fff;border:0;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer}
.sendrow button:active{background:#2f6fe0;transform:scale(.98)}
.sendrow button:disabled{background:#1f2833;color:#5b6470}
.sendmsg{font-size:12px;color:#34d399;margin-top:9px;display:none}
.err{font-size:12px;color:#f87171;margin-top:9px;display:none}
.empty{font-size:13px;color:#5b6470;padding:8px 2px}
.foot{text-align:center;font-size:11px;color:#4a5560;padding:4px 0 20px}
</style>
</head>
<body>
<header>
  <div class="brand"><h1>DSH 远程</h1><p class="sub">DeepSeek Harness 移动控制台</p></div>
  <span class="pill cold" id="conn"><span class="dot"></span><span id="connTxt">连接中…</span></span>
  <button class="btn" id="jumpBtn" title="快速跳转到提问">📑</button>
  <button class="btn" id="refresh" title="刷新">⟳</button>
</header>
<div class="approvals" id="approvals"></div>
<main>
  <div class="card"><h2><span class="ic">🗂</span>会话</h2><div id="sessions"><div class="empty">加载中…</div></div></div>
  <div class="card"><h2><span class="ic">📊</span>统计</h2><div id="stats"><div class="empty">—</div></div></div>
  <div class="card"><h2><span class="ic">🎯</span>目标</h2><div id="goal"><div class="empty">—</div></div></div>
  <div class="card"><h2><span class="ic">✅</span>待办</h2><div id="todos"><div class="empty">—</div></div></div>
  <div class="card"><h2><span class="ic">🕘</span>最近动态<span class="spacer"></span><button class="mini" id="bottomBtn">↓ 底部</button></h2><div class="activity" id="activity"><div class="empty">—</div></div></div>
  <div class="card"><h2><span class="ic">💬</span>发送提示</h2><textarea id="text" placeholder="输入要发送给 agent 的提示…（冷会话需先点击挂载）"></textarea><div class="sendrow"><button id="send">发送</button></div><div class="sendmsg" id="sendmsg"></div><div class="err" id="err"></div></div>
  <div class="foot">每 3 秒自动刷新 · 仅限 tailnet 内访问</div>
</main>
<div class="jumpoverlay" id="jumpoverlay">
  <div class="jumppanel">
    <div class="jumphead"><span>快速跳转到提问</span><button class="btn" id="jumpClose">✕</button></div>
    <div class="jumplist" id="jumplist"></div>
  </div>
</div>
<script>
var token='';var selected=null;var sessions=[];var turnsData=[];var expanded={};
(function(){var q=location.search||'';if(q.charAt(0)==='?')q=q.slice(1);var parts=q.split('&');for(var i=0;i<parts.length;i++){var kv=parts[i].split('=');if(kv[0]==='t')token=decodeURIComponent(kv[1]||'');}})();
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function url(path){return path+'?t='+encodeURIComponent(token);}
function fmtTime(t){if(!t)return '';var d=new Date(t);return d.toLocaleTimeString();}
function phaseBadge(p){if(!p)return '';return '<span class="phase '+p+'">'+esc(p)+'</span>';}
function sessTag(s){if(s==='running')return '<span class="tag running">运行中</span>';if(s==='idle')return '<span class="tag">空闲</span>';return '<span class="tag cold">点击挂载</span>';}
function renderSessions(){var el=document.getElementById('sessions');if(!sessions.length){el.innerHTML='<div class="empty">无会话</div>';return;}var h='';for(var i=0;i<sessions.length;i++){var s=sessions[i];var sel=selected===s.id?' sel':'';var title=s.title?esc(s.title):'（未命名会话）';var sub=esc(String(s.id).slice(0,34));h+='<div class="sess'+sel+'" data-id="'+esc(s.id)+'"><span class="statusdot '+esc(s.status)+'"></span><div class="body"><div class="t">'+title+'</div><div class="m">'+sub+'</div></div>'+sessTag(s.status)+'</div>';}el.innerHTML=h;var items=el.querySelectorAll('.sess');for(var j=0;j<items.length;j++){items[j].addEventListener('click',function(){var id=this.getAttribute('data-id');var st='';for(var k=0;k<sessions.length;k++){if(sessions[k].id===id)st=sessions[k].status;}selected=id;if(st==='cold'){mountSession(id);}else{renderSessions();loadDetail();}});}}
function renderGoal(d){var g=d.goal;var el=document.getElementById('goal');if(!g){el.innerHTML='<div class="empty">当前会话无目标</div>';return;}var blocked=g.blockedReason?'<div class="blocked">阻塞原因：'+esc(g.blockedReason)+'</div>':'';el.innerHTML='<div class="goalbox"><div class="obj">'+esc(g.objective)+'</div><div class="meta">'+phaseBadge(g.phase)+'<span>轮次 '+g.roundsStarted+' / '+g.maxGoalRounds+'</span></div>'+blocked+'</div>';}
function renderTodos(d){var el=document.getElementById('todos');if(!d.todos||!d.todos.length){el.innerHTML='<div class="empty">无待办</div>';return;}var h='';var done=0;for(var i=0;i<d.todos.length;i++){var t=d.todos[i];if(t.status==='completed')done++;var doneCls=t.status==='completed'?' done':'';h+='<div class="todo'+doneCls+'"><span class="st '+esc(t.status)+'"></span><span class="txt">'+esc(t.content)+'</span></div>';}el.innerHTML=h+'<div class="todosum">'+done+' / '+d.todos.length+' 完成</div>';}
function renderApprovals(list){var el=document.getElementById('approvals');if(!list||!list.length){el.style.display='none';el.innerHTML='';return;}var h='<div class="abanner"><div class="ahead">⚠️ 待审批 · '+list.length+' 项</div>';for(var i=0;i<list.length;i++){var a=list[i];h+='<div class="approval"><div class="atitle">'+esc(a.toolName)+'</div>';if(a.reason){h+='<div class="areason">'+esc(a.reason)+'</div>';}h+='<div class="ameta">'+fmtTime(a.time)+(a.sessionId?' · '+esc(String(a.sessionId).slice(0,12)+'…'):'')+'</div>';if(a.answerable){h+='<div class="abtns"><button class="abtn ok" data-id="'+esc(a.id)+'" data-out="allowed-once">同意</button><button class="abtn no" data-id="'+esc(a.id)+'" data-out="rejected">拒绝</button></div>';}else{h+='<div class="ameta">（由桌面端审批中）</div>';}h+='</div>';}h+='</div>';el.innerHTML=h;el.style.display='block';var items=el.querySelectorAll('.abtn');for(var j=0;j<items.length;j++){items[j].addEventListener('click',function(){answerApproval(this.getAttribute('data-id'),this.getAttribute('data-out'));});}}
function answerApproval(id,outcome){var err=document.getElementById('err');err.style.display='none';fetch(url('/m/approval'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,outcome:outcome})}).then(function(r){return r.json();}).then(function(j){if(j.ok){loadDetail();}else{err.style.display='block';err.textContent='审批失败：'+(j.error||'');}}).catch(function(e){err.style.display='block';err.textContent=String(e);});}
function buildTurnHTML(i){var turn=turnsData[i];var isLast=i===turnsData.length-1;if(!isLast&&!expanded[i]){var p=turn.u.p||'';var preview=p.length>60?esc(p.slice(0,60))+'…':esc(p);return '<div class="turn thumb" id="turn-'+i+'" data-i="'+i+'"><span class="qtime">'+fmtTime(turn.u.t)+'</span><span class="qprev">'+preview+'</span><span class="qcount">'+turn.items.length+' 条</span><span class="qarrow">▸</span></div>';}var h='<div class="turn" id="turn-'+i+'">';var who=turn.q?'你':'上下文';h+='<div class="bubble '+(turn.q?'user':'sys')+'"><div class="qmeta">'+who+' · '+fmtTime(turn.u.t)+'</div><div class="md">'+turn.u.h+'</div></div>';var j=0;while(j<turn.items.length){var it=turn.items[j];if(it.k==='assistant'){h+='<div class="bubble assistant"><div class="qmeta">助手 · '+fmtTime(it.t)+'</div><div class="md">'+it.h+'</div></div>';j++;}else{var names=[];var start=j;while(j<turn.items.length&&turn.items[j].k==='tool'){if(names.length<5)names.push(turn.items[j].n);j++;}var total=j-start;var label=names.join(' · ')+(total>5?' … 共'+total+'个':'');h+='<div class="toolchip">🛠 '+esc(label)+'</div>';}}h+='</div>';return h;}
function buildActivityHTML(){var h='';if(!turnsData.length){h='<div class="empty">暂无动态</div>';}else{var hasExp=false;for(var k=0;k<turnsData.length-1;k++){if(expanded[k]){hasExp=true;break;}}if(hasExp){h+='<div class="stickybar" id="stickybar">收起 ▴</div>';}for(var i=0;i<turnsData.length;i++){h+=buildTurnHTML(i);}}return h;}
function bindTurns(){var el=document.getElementById('activity');var th=el.querySelectorAll('.turn.thumb');for(var i=0;i<th.length;i++){th[i].addEventListener('click',function(){var idx=parseInt(this.getAttribute('data-i'),10);expanded[idx]=true;paintActivity();});}var sb=document.getElementById('stickybar');if(sb){sb.addEventListener('click',function(){expanded={};paintActivity();});}}
function paintActivity(){var el=document.getElementById('activity');var prev=el.scrollTop;el.innerHTML=buildActivityHTML();el.scrollTop=Math.min(prev,el.scrollHeight-el.clientHeight);bindTurns();}
function buildJumpList(){var el=document.getElementById('jumplist');var h='';for(var i=0;i<turnsData.length;i++){if(!turnsData[i].q)continue;var p=turnsData[i].u.p||'';var preview=p.length>40?esc(p.slice(0,40))+'…':esc(p);h+='<button class="jumpitem" data-i="'+i+'"><div>'+preview+'</div><div class="jt">'+fmtTime(turnsData[i].u.t)+'</div></button>';}el.innerHTML=h||'<div class="empty">暂无提问</div>';var it=el.querySelectorAll('.jumpitem');for(var j=0;j<it.length;j++){it[j].addEventListener('click',function(){jumpTo(parseInt(this.getAttribute('data-i'),10));});}}
function jumpTo(i){document.getElementById('jumpoverlay').classList.remove('open');expanded[i]=true;paintActivity();var c=document.getElementById('activity');var el=document.getElementById('turn-'+i);if(c&&el){c.scrollTop=el.offsetTop-4;}}
function renderActivity(d){turnsData=d.turns||[];var el=document.getElementById('activity');var nearBottom=el.scrollHeight-el.scrollTop-el.clientHeight<80;paintActivity();if(nearBottom){el.scrollTop=el.scrollHeight;}buildJumpList();}
function renderStats(s){var el=document.getElementById('stats');if(!s){el.innerHTML='<div class="empty">—</div>';return;}var cost=s.cost==null?'':'<div class="stat"><span class="sk">估算金额</span><span class="sv">¥'+s.cost.toFixed(4)+'</span></div>';var model=s.model?'<div class="stat"><span class="sk">模型</span><span class="sv">'+esc(s.model)+'</span></div>':'';el.innerHTML='<div class="statsgrid"><div class="stat"><span class="sk">轮次</span><span class="sv">'+s.turns+'</span></div><div class="stat"><span class="sk">输入 tokens</span><span class="sv">'+s.inputTokens+'</span></div><div class="stat"><span class="sk">输出 tokens</span><span class="sv">'+s.outputTokens+'</span></div><div class="stat"><span class="sk">缓存 tokens</span><span class="sv">'+s.cacheTokens+'</span></div><div class="stat"><span class="sk">合计 tokens</span><span class="sv">'+s.totalTokens+'</span></div>'+cost+model+'</div>';}
function renderDetail(d){var p=document.getElementById('conn');var t=document.getElementById('connTxt');if(d.status==='running'){p.className='pill running';t.textContent='运行中';}else if(d.status==='idle'){p.className='pill';t.textContent='空闲';}else{p.className='pill cold';t.textContent='未挂载';}renderGoal(d);renderTodos(d);renderStats(d.stats);renderApprovals(d.approvals);renderActivity(d);}
function loadSessions(){fetch(url('/m/state')).then(function(r){return r.json();}).then(function(j){sessions=j.sessions||[];renderApprovals(j.approvals);if(!selected&&sessions.length)selected=sessions[0].id;else if(selected){var still=false;for(var i=0;i<sessions.length;i++){if(sessions[i].id===selected)still=true;}if(!still)selected=sessions.length?sessions[0].id:null;}renderSessions();if(selected)loadDetail();}).catch(function(){});}
function loadDetail(){if(!selected)return;fetch(url('/m/state')+'&session='+encodeURIComponent(selected)).then(function(r){return r.json();}).then(function(j){if(j.error)return;renderDetail(j);}).catch(function(){});}
function mountSession(id){var msg=document.getElementById('sendmsg');var err=document.getElementById('err');msg.style.display='block';msg.textContent='挂载中…';err.style.display='none';fetch(url('/m/mount'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:id})}).then(function(r){return r.json();}).then(function(j){msg.style.display='none';if(j.ok){selected=id;loadSessions();loadDetail();}else{err.style.display='block';err.textContent='挂载失败：'+(j.error||'');}}).catch(function(e){msg.style.display='none';err.style.display='block';err.textContent=String(e);});}
document.getElementById('refresh').addEventListener('click',function(){loadSessions();});
document.getElementById('bottomBtn').addEventListener('click',function(){var el=document.getElementById('activity');el.scrollTop=el.scrollHeight;});
document.getElementById('jumpBtn').addEventListener('click',function(){document.getElementById('jumpoverlay').classList.add('open');});
document.getElementById('jumpClose').addEventListener('click',function(){document.getElementById('jumpoverlay').classList.remove('open');});
document.getElementById('jumpoverlay').addEventListener('click',function(e){if(e.target===this){this.classList.remove('open');}});
document.getElementById('send').addEventListener('click',function(){var text=document.getElementById('text').value.trim();if(!text||!selected)return;var msg=document.getElementById('sendmsg');var err=document.getElementById('err');var btn=document.getElementById('send');msg.style.display='none';err.style.display='none';btn.disabled=true;fetch(url('/m/prompt'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:selected,text:text})}).then(function(r){return r.json();}).then(function(j){btn.disabled=false;if(j.ok){document.getElementById('text').value='';msg.style.display='block';msg.textContent='已发送 ✓';setTimeout(function(){msg.style.display='none';},2000);}else{err.style.display='block';err.textContent=j.error||'发送失败';}}).catch(function(e){btn.disabled=false;err.style.display='block';err.textContent=String(e);});});
loadSessions();setInterval(function(){if(selected)loadDetail();else loadSessions();},3000);
</script>
</body>
</html>`

export function apply(ctx, config) {
  const TOKEN = (config && typeof config.token === 'string' && config.token) ? config.token : DEFAULT_TOKEN
  const agents = ctx.get('agents')
  const sessionQuery = ctx.get('sessionQuery')
  const agentPresets = ctx.get('agentPresets')

  const pendingApprovals = new Map()
  const observedApprovals = new Map()

  ctx.on('approval/request', (req, next) => {
    if (req.signal && req.signal.aborted) return Promise.resolve('cancelled')
    const rpcId = 'apr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    return new Promise((resolve) => {
      const entry = {
        rpcId,
        sessionId: (req.agent && req.agent.session && req.agent.session.id) || null,
        toolName: req.toolName,
        reason: req.reason || '',
        time: Date.now(),
        resolve
      }
      pendingApprovals.set(rpcId, entry)
      const onAbort = () => { if (pendingApprovals.delete(rpcId)) resolve('cancelled') }
      if (req.signal) req.signal.addEventListener('abort', onAbort, { once: true })
    })
  }, { global: true })

  ctx.on('session/event', (session, event) => {
    if (event.type === 'approval/asked') {
      observedApprovals.set(event.data.id, {
        id: String(event.data.id),
        sessionId: session.id,
        toolName: event.data.toolName,
        reason: event.data.reason || '',
        time: event.time
      })
    } else if (event.type === 'approval/decided') {
      observedApprovals.delete(event.data.id)
    }
  }, { global: true })

  const approvalList = () => {
    const out = []
    const claimedKeys = new Set()
    for (const a of pendingApprovals.values()) {
      claimedKeys.add(a.sessionId + '::' + a.toolName)
      out.push({ id: a.rpcId, sessionId: a.sessionId, toolName: a.toolName, reason: a.reason, time: a.time, answerable: true })
    }
    for (const a of observedApprovals.values()) {
      if (claimedKeys.has(a.sessionId + '::' + a.toolName)) continue
      out.push({ id: a.id, sessionId: a.sessionId, toolName: a.toolName, reason: a.reason, time: a.time, answerable: false })
    }
    return out
  }

  const liveStatus = (id) => {
    const a = agents && agents.get(id)
    return a ? a.status : 'cold'
  }

  const views = async () => {
    if (sessionQuery) {
      try {
        const records = await sessionQuery.listSessions()
        const ids = records.map((r) => r.header.id)
        const titles = new Map()
        try {
          const results = await sessionQuery.readTitleSnapshots(ids)
          for (const res of results) {
            if (res.status === 'fulfilled' && res.value && res.value.title) titles.set(res.sessionId, res.value.title.title)
          }
        } catch (_) { /* titles are best-effort */ }
        return records.map((r) => ({
          id: r.header.id,
          status: liveStatus(r.header.id),
          live: r.live,
          title: titles.get(r.header.id) || null
        }))
      } catch (_) { /* fall through to live-only */ }
    }
    if (!agents) return []
    return agents.list().map((a) => ({ id: a.id, status: a.status, live: true, title: null }))
  }

  const detail = async (sessionId) => {
    const a = agents && agents.get(sessionId)
    let events
    if (a && a.session && a.session.events) {
      events = a.session.events
    } else if (sessionQuery) {
      try { events = (await sessionQuery.readSession(sessionId)).events || [] } catch (_) { return null }
    } else {
      return null
    }

    let goalView = null
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === 'goal/change') {
        const d = events[i].data
        if (d && d.operation !== 'clear' && d.goal) {
          goalView = {
            objective: d.goal.objective,
            phase: d.goal.phase,
            roundsStarted: d.roundsStarted,
            maxGoalRounds: d.goal.maxGoalRounds,
            blockedReason: d.goal.blockedReason ? d.goal.blockedReason.message : null
          }
        }
        break
      }
    }

    let todos = null
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e.type === 'todo/write' && Array.isArray(e.data && e.data.todos)) {
        todos = e.data.todos.map((t) => ({ content: t.content, status: t.status }))
        break
      }
    }

    const MAX_TURNS = 40
    const MAX_ITEMS = 80
    const turns = []
    let items = []
    for (let i = events.length - 1; i >= 0 && turns.length < MAX_TURNS; i--) {
      const e = events[i]
      const d = e.data
      if (e.type === 'user/message') {
        const text = textOf(d && d.content)
        const isQuestion = !!(d && d.source && d.source.kind === 'user')
        turns.push({
          q: isQuestion,
          u: { p: text, h: renderMarkdown(text), t: e.time },
          items: items.slice(0, MAX_ITEMS).reverse()
        })
        items = []
      } else if (e.type === 'assistant/message') {
        const text = textOnlyOf(d && d.message && d.message.content)
        if (text) items.push({ k: 'assistant', h: renderMarkdown(text), t: e.time })
      } else if (e.type === 'tool/call') {
        if (items.length < MAX_ITEMS) items.push({ k: 'tool', n: (d && d.name) || '工具', t: e.time })
      }
    }
    turns.reverse()

    let statTurns = 0
    let statInput = 0
    let statOutput = 0
    let statCache = 0
    let statModel = null
    for (let i = 0; i < events.length; i++) {
      const e = events[i]
      if (e.type === 'turn/end') statTurns++
      if (e.type === 'assistant/message') {
        const u = e.data && e.data.usage
        if (u) {
          statInput += u.inputTokens || 0
          statOutput += u.outputTokens || 0
          statCache += (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0)
        }
        const src = e.data && e.data.message && e.data.message.source
        if (src && src.model) statModel = src.model
      }
    }
    let statCost = null
    if (statModel) {
      const reasoner = /reasoner/i.test(statModel)
      statCost = (statInput * (reasoner ? 4 : 2) + statCache * (reasoner ? 1 : 0.5) + statOutput * (reasoner ? 16 : 8)) / 1000000
    }

    return {
      id: sessionId,
      status: liveStatus(sessionId),
      goal: goalView,
      todos,
      turns,
      stats: {
        turns: statTurns,
        inputTokens: statInput,
        outputTokens: statOutput,
        cacheTokens: statCache,
        totalTokens: statInput + statCache + statOutput,
        cost: statCost,
        model: statModel
      },
      approvals: approvalList(),
      queue: (a && a.inbox) ? { turn: a.inbox.nextTurn.length, step: a.inbox.nextStep.length } : null
    }
  }

  const mount = async (sessionId) => {
    if (!agents) return { ok: false, error: 'agents 服务不可用' }
    const live = agents.get(sessionId)
    if (live) return { ok: true, status: live.status }
    if (!sessionQuery) return { ok: false, error: 'sessionQuery 服务不可用' }

    let snap
    try { snap = await sessionQuery.readSession(sessionId) } catch (e) { return { ok: false, error: String((e && e.message) || e) } }

    const events = snap.events || []
    let presetId = snap.session && snap.session.agentPreset
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i] && events[i].type === 'agent-preset/selected') {
        presetId = events[i].data && events[i].data.agentPreset
        break
      }
    }

    const setup = async (agentCtx) => {
      if (agentPresets && presetId) {
        const resolved = await agentPresets.resolve(presetId)
        await agentPresets.mount(agentCtx, resolved.id)
      }
    }

    try {
      await agents.resume({ resumeSessionId: sessionId, setup })
      const nowLive = agents.get(sessionId)
      return { ok: true, status: nowLive ? nowLive.status : 'idle' }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/m',
    handler: (req, res) => {
      if (qp(req.url, 't') !== TOKEN) return html(res, 401, '<h1>401 未授权</h1>')
      html(res, 200, PAGE)
    }
  }), 'mobile: page')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/m/state',
    handler: async (req, res) => {
      if (qp(req.url, 't') !== TOKEN) return json(res, 401, { error: 'unauthorized' })
      try {
        const sid = qp(req.url, 'session')
        if (sid) {
          const d = await detail(sid)
          return json(res, d ? 200 : 404, d || { error: 'session not found' })
        }
        json(res, 200, { sessions: await views(), approvals: approvalList() })
      } catch (err) {
        json(res, 500, { error: String((err && err.message) || err) })
      }
    }
  }), 'mobile: state')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/m/mount',
    handler: async (req, res) => {
      if (qp(req.url, 't') !== TOKEN) return json(res, 401, { error: 'unauthorized' })
      if (req.method !== 'POST') return json(res, 405, { error: 'use POST' })
      let data
      try { data = JSON.parse(await readBody(req)) } catch { return json(res, 400, { error: 'invalid json' }) }
      const sid = data && data.sessionId
      if (!sid) return json(res, 400, { error: 'sessionId required' })
      const result = await mount(sid)
      json(res, result.ok ? 200 : 500, result)
    }
  }), 'mobile: mount')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/m/approval',
    handler: async (req, res) => {
      if (qp(req.url, 't') !== TOKEN) return json(res, 401, { error: 'unauthorized' })
      if (req.method !== 'POST') return json(res, 405, { error: 'use POST' })
      let data
      try { data = JSON.parse(await readBody(req)) } catch { return json(res, 400, { error: 'invalid json' }) }
      const id = data && data.id
      const outcome = data && data.outcome
      if (!id || (outcome !== 'allowed-once' && outcome !== 'rejected')) return json(res, 400, { error: 'id and outcome (allowed-once|rejected) required' })
      const entry = pendingApprovals.get(id)
      if (!entry) return json(res, 404, { error: 'approval not pending' })
      pendingApprovals.delete(id)
      entry.resolve(outcome)
      json(res, 200, { ok: true })
    }
  }), 'mobile: approval')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/m/prompt',
    handler: async (req, res) => {
      if (qp(req.url, 't') !== TOKEN) return json(res, 401, { error: 'unauthorized' })
      if (req.method !== 'POST') return json(res, 405, { error: 'use POST' })
      let data
      try { data = JSON.parse(await readBody(req)) } catch { return json(res, 400, { error: 'invalid json' }) }
      const sid = data && data.sessionId
      const text = String((data && data.text) || '').trim()
      if (!sid || !text) return json(res, 400, { error: 'sessionId and text required' })
      const a = agents && agents.get(sid)
      if (!a) return json(res, 404, { error: '该会话未挂载（冷会话），请先点击会话挂载' })
      const message = {
        id: 'mob-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10),
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'user' }
      }
      try {
        a.followup(message)
        json(res, 200, { ok: true, id: message.id })
      } catch (err) {
        json(res, 409, { ok: false, error: String((err && err.message) || err) })
      }
    }
  }), 'mobile: prompt')

  console.log('[mobile] 远程访问就绪: http://127.0.0.1:3080/m?t=' + TOKEN)
}

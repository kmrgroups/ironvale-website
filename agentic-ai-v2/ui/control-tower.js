/* Agentic AI Control Tower + governed 5W1H feed. */
(function(){
  'use strict';
  var mounted=false;
  var state={registry:null,tasks:[],runs:[],updatedAt:null};
  var esc=function(s){return String(s==null?'':s).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c];});};
  var token=function(){try{return (window.Core&&window.Core.getToken?window.Core.getToken():'')||sessionStorage.getItem('app_token')||'';}catch(e){return '';}};
  var norm=function(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();};
  var pretty=function(s){return String(s||'').replace(/[_-]+/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase();});};

  function css(){
    if(document.getElementById('aa-v2-css')) return;
    var s=document.createElement('style'); s.id='aa-v2-css';
    s.textContent=`
      .aa-v2-shell,.aa-v2-feed{border-top:3px solid var(--gold,#c2932e);margin-bottom:16px}
      .aa-v2-feed{border-top-color:var(--sky,#3fa9e0)}
      .aa-v2-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;flex-wrap:wrap}
      .aa-v2-kicker{font-family:var(--mono);font-size:9px;letter-spacing:.11em;color:var(--gold-deep);font-weight:700}
      .aa-v2-head h3{font-family:var(--disp);font-size:22px;color:var(--navy);margin:4px 0}
      .aa-v2-head p{max-width:900px;margin:0}
      .aa-v2-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}
      .aa-v2-status{font-family:var(--mono);font-size:9.5px;color:var(--ink-soft);margin-top:9px;min-height:14px}
      .aa-v2-kpis{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:10px;margin-top:12px}
      .aa-v2-kpi{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:12px 14px;cursor:pointer;transition:.12s ease}
      .aa-v2-kpi:hover{transform:translateY(-1px);box-shadow:var(--shadow-sm);border-color:var(--gold,#c2932e)}
      .aa-v2-kpi:focus{outline:2px solid var(--gold,#c2932e);outline-offset:2px}
      .aa-v2-kpi b{display:block;font-family:var(--disp);font-size:24px;line-height:1;color:var(--navy)}
      .aa-v2-kpi span{display:block;font-family:var(--mono);font-size:9px;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.06em;margin-top:6px}
      .aa-v2-kpi em{display:block;font-family:var(--mono);font-size:8px;color:var(--sky-deep,#2b78a8);font-style:normal;margin-top:7px}
      .aa-v2-kpi.warn b{color:var(--bad,#d95f56)} .aa-v2-kpi.good b{color:var(--ok,#1f9d6b)}
      .aa-v2-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(300px,.8fr);gap:14px;margin-top:14px}
      .aa-v2-section{min-width:0}.aa-v2-section-head{display:flex;justify-content:space-between;gap:10px;align-items:center;margin:4px 0 8px}
      .aa-v2-section-head b{font-family:var(--disp);font-size:12px;color:var(--navy);text-transform:uppercase;letter-spacing:.06em}
      .aa-v2-table{width:100%;border-collapse:collapse;font-size:11px}.aa-v2-table th{font-family:var(--mono);font-size:8.5px;color:var(--ink-soft);text-align:left;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line);padding:7px}.aa-v2-table td{border-bottom:1px solid var(--line);padding:8px 7px;vertical-align:top}.aa-v2-table tr:last-child td{border-bottom:0}
      .aa-v2-pill{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;padding:2px 7px;font-family:var(--mono);font-size:8px;font-weight:700;white-space:nowrap}
      .aa-v2-pill.stop,.aa-v2-pill.high{color:var(--bad,#d95f56);border-color:rgba(217,95,86,.35)} .aa-v2-pill.stop{background:rgba(217,95,86,.08)}
      .aa-v2-pill.normal{color:var(--sky-deep,#2b78a8)} .aa-v2-pill.ok{color:var(--ok,#1f9d6b);border-color:rgba(31,157,107,.32)} .aa-v2-pill.pending{color:var(--gold-deep,#8e6a19);border-color:rgba(194,147,46,.4)}
      .aa-v2-agent-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(255px,1fr));gap:10px}.aa-v2-agent{background:var(--white);border:1px solid var(--line);border-radius:10px;padding:11px 12px;box-shadow:var(--shadow-sm)}
      .aa-v2-agent-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.aa-v2-agent-name{font-size:12px;font-weight:700;color:var(--navy);line-height:1.25}.aa-v2-agent-meta{font-family:var(--mono);font-size:8px;color:var(--ink-soft);margin-top:4px}.aa-v2-agent-stats{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;font-family:var(--mono);font-size:8px;color:var(--ink-mid)}.aa-v2-agent-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.aa-v2-agent-actions .btn{padding:5px 8px;font-size:10px}
      .aa-v2-empty{padding:12px;border:1px dashed var(--line);border-radius:9px;color:var(--ink-soft);font-size:11px}.aa-v2-result{margin-top:12px}.aa-v2-last{font-family:var(--mono);font-size:8.5px;color:var(--ink-soft)}
      .aa-v2-health-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.aa-v2-health{display:flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:9px;padding:7px}.aa-v2-lamp{width:10px;height:10px;border-radius:50%;box-shadow:0 0 0 2px rgba(0,0,0,.04);flex:0 0 auto}.aa-v2-lamp.red{background:var(--bad,#d95f56)}.aa-v2-lamp.amber{background:var(--gold,#c2932e)}.aa-v2-lamp.green{background:var(--ok,#1f9d6b)}.aa-v2-lamp.blue{background:var(--sky,#3fa9e0)}
      .aa-v2-feed-summary{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}.aa-v2-feed-legend{display:flex;gap:8px;flex-wrap:wrap;font-family:var(--mono);font-size:8px;color:var(--ink-soft)}.aa-v2-legend{display:inline-flex;align-items:center;gap:4px}.aa-v2-legend .aa-v2-lamp{width:8px;height:8px}
      .aa-v2-dept{margin-top:12px;border:1px solid var(--line);border-radius:11px;overflow:hidden;background:var(--white)}.aa-v2-dept-head{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 12px;background:linear-gradient(90deg,rgba(63,169,224,.08),rgba(194,147,46,.07));border-bottom:1px solid var(--line)}.aa-v2-dept-head b{font-family:var(--disp);color:var(--navy);font-size:13px}.aa-v2-dept-head span{font-family:var(--mono);font-size:8px;color:var(--ink-soft)}
      .aa-v2-feed-card{padding:11px 12px;border-bottom:1px solid var(--line)}.aa-v2-feed-card:last-child{border-bottom:0}.aa-v2-feed-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.aa-v2-feed-title{font-size:12px;font-weight:700;color:var(--navy)}.aa-v2-feed-sub{font-family:var(--mono);font-size:8px;color:var(--ink-soft);margin-top:3px}.aa-v2-5w1h{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px;margin-top:9px}.aa-v2-w1h{border:1px solid var(--line);border-radius:8px;padding:7px;background:var(--paper)}.aa-v2-w1h b{display:block;font-family:var(--mono);font-size:8px;color:var(--gold-deep);text-transform:uppercase;letter-spacing:.05em}.aa-v2-w1h span{display:block;font-size:10px;color:var(--ink);margin-top:3px;line-height:1.35}.aa-v2-feed-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.aa-v2-feed-actions .btn{padding:5px 8px;font-size:10px}
      @media(max-width:1000px){.aa-v2-5w1h{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:900px){.aa-v2-kpis{grid-template-columns:repeat(2,minmax(130px,1fr))}.aa-v2-grid{grid-template-columns:1fr}}@media(max-width:600px){.aa-v2-5w1h{grid-template-columns:repeat(2,minmax(0,1fr))}.aa-v2-head h3{font-size:19px}}
    `; document.head.appendChild(s);
  }

  async function api(url,opts){
    var h=Object.assign({'X-Auth-Token':token(),'Content-Type':'application/json'},(opts&&opts.headers)||{});
    var r=await fetch(url,Object.assign({},opts||{},{headers:h,cache:'no-store'}));
    var j; try{j=await r.json();}catch(e){throw new Error('Agentic AI returned an unreadable response ('+r.status+').');}
    if(!r.ok||!j.ok) throw new Error(j.error||('Agentic AI request failed ('+r.status+').')); return j;
  }
  async function refresh(){
    if(!token()) return false;
    var data=await Promise.all([api('/api/ai?mode=agentic&what=registry'),api('/api/idms?what=docs&kind=task&limit=1000'),api('/api/ai?mode=agentic&what=runs')]);
    state.registry=data[0].registry||{agents:[]}; state.tasks=data[1].docs||[]; state.runs=data[2].runs||[]; state.updatedAt=new Date(); render(); return true;
  }

  function openScreen(screen){
    if(!screen) return;
    var selector='[data-screen="'+CSS.escape(screen)+'"]'; var a=document.querySelector('.menubar '+selector)||document.querySelector(selector); if(a){a.click();return;}
    var g=document.querySelector('[data-goto="'+CSS.escape(screen)+'"]'); if(g){g.click();return;}
  }
  function openReview(){openScreen('agent_review')} function openRuns(){openScreen('agent_runs')}
  function openUserManagement(){
    var selectors=['user_management','users','user_admin','manage_users','admin_users','employee_users','hr_users','employee_master'];
    var nodes=Array.prototype.slice.call(document.querySelectorAll('.menubar [data-screen],.menubar [data-goto],.menubar button,.menubar a,[data-user-management]'));
    var exact=nodes.find(function(n){var t=norm(n.getAttribute('data-screen')||n.getAttribute('data-goto')||n.getAttribute('aria-label')||n.title||n.textContent);return ['user management','user admin','manage users','users','employee master','employees'].indexOf(t)>=0;});
    if(exact){exact.click();return;}
    for(var i=0;i<selectors.length;i++){var s=selectors[i];var x=document.querySelector('[data-screen="'+s+'"]')||document.querySelector('[data-goto="'+s+'"]');if(x){x.click();return;}}
  }
  function openScreenAndUser(screen){openScreen(screen);setTimeout(openUserManagement,120);}

  function openTasks(){return state.tasks.filter(function(t){var d=t.data||{};return !!d.aiProposed&&!/^(closed|completed|rejected)$/i.test(String(t.status||''));});}
  function priorityClass(t){var p=String((t.data||{}).priority||'Normal');return p==='Stop the line'?'stop':p==='High'?'high':'normal';}
  function overdue(t){var d=String((t.data||{}).dueOn||'');return !!d&&d<new Date().toISOString().slice(0,10);}
  function risk(t){if(priorityClass(t)==='stop'||overdue(t))return 'red';if(priorityClass(t)==='high')return 'amber';return 'green';}
  function lastRuns(a){var r=state.runs.filter(function(x){var d=x.data||{};return d.agentId===a.id||d.agentName===a.name||d.agent===a.name;});r.sort(function(x,y){var xd=x.data||{},yd=y.data||{};return new Date(yd.completedAt||yd.at||y.updated_at||0)-new Date(xd.completedAt||xd.at||x.updated_at||0);});return r;}
  function ago(r){if(!r)return 'Never run';var d=r.data||{},at=new Date(d.completedAt||d.at||r.updated_at);if(isNaN(at))return 'Recorded';var ms=Date.now()-at.getTime();if(ms<3600000)return Math.max(1,Math.round(ms/60000))+' min ago';if(ms<86400000)return Math.round(ms/3600000)+' hr ago';if(ms<7*86400000)return Math.round(ms/86400000)+' d ago';return at.toLocaleDateString('en-GB');}
  function sourceAgent(task){var d=task.data||{};var name=String(d.source||d.agentName||'');return (state.registry.agents||[]).find(function(a){return a.name.toLowerCase()===name.toLowerCase()||a.id.toLowerCase()===name.toLowerCase();})||null;}
  function menuFor(agent){return agent?(agent.department+' · '+pretty(agent.screen||'Agentic AI')):'Agentic AI';}
  function feedItem(task){
    var d=task.data||{}, a=sourceAgent(task), dept=(a&&a.department)||d.department||'Management', screen=(a&&a.screen)||d.screen||'agentic_ai';
    var due=d.dueOn||'No due date', owner=d.owner||d.assignee||'Human review', why=d.reason||d.why||d.risk||d.finding||'AI identified a reviewable exception from live IDMS data';
    var what=d.title||d.action||'AI-proposed action', how=d.proposedAction||d.action||d.recommendation||'Review the AI proposal and confirm the appropriate owner action';
    var when=d.when||due, where=menuFor(a); var r=risk(task);
    return {dept:dept,screen:screen,agent:a,what:what,why:why,where:where,when:when,who:owner,how:how,risk:r,priority:d.priority||'Normal',task:task};
  }

  function renderKpis(root,tasks,agents){
    var stop=tasks.filter(function(t){return priorityClass(t)==='stop'}).length,high=tasks.filter(function(t){return priorityClass(t)==='high'}).length,od=tasks.filter(overdue).length;
    root.querySelector('#aa-v2-kpis').innerHTML=[['Critical risks',stop,stop?'warn':'good','ncr_open','Open NCR / critical quality risks'],['High risks',high,high?'warn':'good','ncr_open','Open NCR / high-priority risks'],['Open AI actions',tasks.length,tasks.length?'warn':'good','agent_review','Open Agent Work for review'],['Overdue actions',od,od?'warn':'good','agent_review','Open overdue actions for follow-up']].map(function(x){return '<div class="aa-v2-kpi '+x[2]+'" role="button" tabindex="0" data-aa-kpi-screen="'+x[3]+'" aria-label="'+esc(x[0]+' '+x[1])+'"><b>'+x[1]+'</b><span>'+esc(x[0])+'</span><em>↗ '+esc(x[4])+'</em></div>';}).join('');
    root.querySelectorAll('[data-aa-kpi-screen]').forEach(function(c){c.onclick=function(){openScreen(c.dataset.aaKpiScreen);};c.onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();c.click();}};});
  }
  function renderQueue(root,tasks){
    var q=tasks.slice().sort(function(a,b){var p={stop:3,high:2,normal:1};return (p[priorityClass(b)]-p[priorityClass(a)])+(overdue(b)?1:0)-(overdue(a)?1:0);}).slice(0,10);
    root.querySelector('#aa-v2-queue').innerHTML=q.length?'<table class="aa-v2-table"><thead><tr><th>Agent</th><th>Action</th><th>Priority</th><th>Owner</th><th>Due</th><th></th></tr></thead><tbody>'+q.map(function(t){var d=t.data||{},a=sourceAgent(t);return '<tr><td><b>'+esc(d.source||d.agentName||'Agent')+'</b></td><td>'+esc(d.title||'Proposed action')+'</td><td><span class="aa-v2-pill '+priorityClass(t)+'">'+esc(d.priority||'Normal')+'</span></td><td>'+esc(d.owner||'—')+'</td><td>'+esc(d.dueOn||'—')+(overdue(t)?' · overdue':'')+'</td><td><button type="button" class="btn aa-v2-review">Open</button> <button type="button" class="btn aa-v2-user" data-user="1">User</button></td></tr>';}).join('')+'</tbody></table>':'<div class="aa-v2-empty"><b>No open AI-proposed actions.</b><br>Run an agent to populate the human review queue.</div>';
    root.querySelectorAll('.aa-v2-review').forEach(function(b){b.onclick=openReview;});root.querySelectorAll('.aa-v2-user').forEach(function(b){b.onclick=openUserManagement;});
  }
  function renderHealth(root,agents,tasks){
    var groups={}; agents.forEach(function(a){(groups[a.department]=groups[a.department]||[]).push(a);});
    var html=Object.keys(groups).map(function(dep){var as=groups[dep], open=tasks.filter(function(t){var a=sourceAgent(t);return a&&a.department===dep;}).length, lamp=open>0?'amber':'green';if(tasks.some(function(t){var a=sourceAgent(t);return a&&a.department===dep&&priorityClass(t)==='stop';}))lamp='red';return '<div class="aa-v2-health"><span class="aa-v2-lamp '+lamp+'"></span><div><b style="font-size:10px">'+esc(dep)+'</b><div class="aa-v2-last">'+open+' open action(s)</div></div></div>';}).join('');
    root.querySelector('#aa-v2-health').innerHTML='<div class="aa-v2-health-grid">'+html+'</div>';
  }
  function renderAgents(root,agents,tasks){
    var groups={};agents.forEach(function(a){(groups[a.department]=groups[a.department]||[]).push(a);});
    var order=['Management','Marketing','NPD','PPC & MMD','Purchase & SCM','Quality Assurance','Maintenance','HRM','Production','Accounts'];
    var deps=order.filter(function(d){return groups[d]}).concat(Object.keys(groups).filter(function(d){return order.indexOf(d)<0}));var cards=[];
    deps.forEach(function(dep){cards.push('<div style="grid-column:1/-1" class="bu-group">'+esc(dep)+'</div>');groups[dep].forEach(function(a){var rel=lastRuns(a),r=rel[0],open=tasks.filter(function(t){var x=sourceAgent(t);return x&&x.id===a.id;}).length;var status=open?'Needs review':r?'Monitored':'Ready',cls=open?'pending':r?'ok':'normal';cards.push('<div class="aa-v2-agent"><div class="aa-v2-agent-head"><div><div class="aa-v2-agent-name">'+esc(a.name)+'</div><div class="aa-v2-agent-meta">'+esc(a.department)+' · menu '+esc(pretty(a.screen||'agentic_ai'))+'</div></div><span class="aa-v2-pill '+cls+'"><span class="aa-v2-lamp '+(open?'amber':(r?'green':'blue'))+'" style="width:7px;height:7px;margin-right:4px"></span>'+status+'</span></div><div class="aa-v2-agent-stats"><span>'+open+' open task(s)</span><span>last '+esc(ago(r))+'</span><span>'+((a.reads||[]).length)+' data sets</span></div><div class="aa-v2-agent-actions"><button type="button" class="btn gold aa-v2-run" data-agent="'+esc(a.id)+'">Run Agent</button><button type="button" class="btn aa-v2-open" data-screen="'+esc(a.screen||'agentic_ai')+'">Open module</button><button type="button" class="btn aa-v2-user">User Management</button></div></div>');});});
    root.querySelector('#aa-v2-agents').innerHTML=cards.join('');root.querySelector('#aa-v2-count').textContent=agents.length+' governed agents registered';
    root.querySelectorAll('.aa-v2-open').forEach(function(b){b.onclick=function(){openScreen(b.dataset.screen);};});root.querySelectorAll('.aa-v2-user').forEach(function(b){b.onclick=openUserManagement;});root.querySelectorAll('.aa-v2-run').forEach(function(b){b.onclick=function(){runAgent(b.dataset.agent,b);};});
  }
  function renderFeed(tasks){
    var el=document.getElementById('aa-v2-feed-root');if(!el)return;var items=tasks.map(feedItem),groups={};items.forEach(function(x){(groups[x.dept]=groups[x.dept]||[]).push(x);});var html='';
    Object.keys(groups).sort().forEach(function(dep){var arr=groups[dep];html+='<section class="aa-v2-dept"><div class="aa-v2-dept-head"><b>'+esc(dep)+'</b><span>'+arr.length+' live item(s) · menu ownership</span></div>'+arr.slice(0,20).map(function(x){return '<article class="aa-v2-feed-card"><div class="aa-v2-feed-top"><div><div class="aa-v2-feed-title">'+esc(x.what)+'</div><div class="aa-v2-feed-sub">'+esc(x.agent?x.agent.name:'Agentic AI')+' · Menu: '+esc(x.where)+'</div></div><span class="aa-v2-pill '+(x.risk==='red'?'stop':x.risk==='amber'?'high':'ok')+'"><span class="aa-v2-lamp '+x.risk+'" style="width:8px;height:8px;margin-right:4px"></span>'+esc(x.priority)+'</span></div><div class="aa-v2-5w1h"><div class="aa-v2-w1h"><b>What</b><span>'+esc(x.what)+'</span></div><div class="aa-v2-w1h"><b>Why</b><span>'+esc(x.why)+'</span></div><div class="aa-v2-w1h"><b>Where</b><span>'+esc(x.where)+'</span></div><div class="aa-v2-w1h"><b>When</b><span>'+esc(x.when)+'</span></div><div class="aa-v2-w1h"><b>Who</b><span>'+esc(x.who)+'</span></div><div class="aa-v2-w1h"><b>How</b><span>'+esc(x.how)+'</span></div></div><div class="aa-v2-feed-actions"><button type="button" class="btn" data-feed-screen="'+esc(x.screen)+'">Open menu</button><button type="button" class="btn">Review action</button><button type="button" class="btn">User Management</button></div></article>';}).join('')+'</section>';});
    el.innerHTML=html||'<div class="aa-v2-empty"><b>No live Agentic AI feed items.</b><br>The department feed will populate when governed agents create reviewable actions.</div>';
    el.querySelectorAll('[data-feed-screen]').forEach(function(b){b.onclick=function(){openScreen(b.dataset.feedScreen);};});
    el.querySelectorAll('.aa-v2-feed-actions .btn:nth-child(2)').forEach(function(b){b.onclick=openReview;});el.querySelectorAll('.aa-v2-feed-actions .btn:nth-child(3)').forEach(function(b){b.onclick=openUserManagement;});
  }
  function render(){
    var root=document.getElementById('aa-v2-root');if(!root||!state.updatedAt)return;var tasks=openTasks(),agents=state.registry.agents||[];root.querySelector('#aa-v2-status').textContent='Live data · '+agents.length+' governed agents · updated '+state.updatedAt.toLocaleString('en-GB');renderKpis(root,tasks,agents);renderQueue(root,tasks);renderHealth(root,agents,tasks);renderAgents(root,agents,tasks);renderFeed(tasks);
  }
  async function runAgent(agentId,button){var old=button.textContent;button.disabled=true;button.textContent='Running…';var status=document.getElementById('aa-v2-status');if(status)status.textContent='Running '+agentId+' against live IDMS records…';try{var j=await api('/api/ai?mode=agentic',{method:'POST',body:JSON.stringify({agentId:agentId,eventType:'MANUAL'})});var result=document.getElementById('aa-v2-result');if(result)result.innerHTML='<div class="card"><b>Agent run completed</b><div class="aa-v2-last">'+esc(j.agentId||agentId)+' · '+esc(j.runId||'')+' · '+esc(j.model||j.provider||'AI')+'</div><div style="margin-top:8px;white-space:pre-wrap;font-size:12px;line-height:1.55">'+esc(j.narrative||'No narrative returned.')+'</div><div class="hint" style="margin-top:8px">Reviewable tasks created: <b>'+esc(j.taskCount||0)+'</b> · <a data-aa-review-link="1" style="cursor:pointer;color:var(--sky-deep);font-weight:600">Review Agent Work</a></div></div>';if(result&&result.querySelector('[data-aa-review-link]'))result.querySelector('[data-aa-review-link]').onclick=openReview;await refresh();}catch(e){var r=document.getElementById('aa-v2-result');if(r)r.innerHTML='<div class="note bad">'+esc(e.message)+'</div>';}button.disabled=false;button.textContent=old;}

  function mount(){
    var panel=document.querySelector('[data-panel="agentic_ai"]');if(!panel||mounted)return;mounted=true;css();
    var wrap=document.createElement('div');wrap.className='card aa-v2-shell';wrap.id='aa-v2-root';
    wrap.innerHTML='<div class="aa-v2-head"><div><div class="aa-v2-kicker">AGENTIC AI · LIVE FACTORY INTELLIGENCE</div><h3>Agentic AI Control Tower</h3><p class="hint">20 governed agents observe live IDMS records, rank risk and propose reviewable work. Every consequential action remains human-controlled.</p></div><div class="aa-v2-actions"><button type="button" class="btn gold" id="aa-v2-run-control">Run Control Tower</button><button type="button" class="btn" id="aa-v2-refresh">Refresh live status</button><button type="button" class="btn" id="aa-v2-review-top">Review Agent Work</button><button type="button" class="btn" id="aa-v2-runs-top">Agent Run Log</button><button type="button" class="btn" id="aa-v2-user-top">User Management</button></div></div><div id="aa-v2-status" class="aa-v2-status">Waiting for a signed-in session…</div><div id="aa-v2-kpis" class="aa-v2-kpis"></div><div class="aa-v2-grid"><div class="aa-v2-section"><div class="aa-v2-section-head"><b>Priority queue</b><span class="hint">Top live AI-proposed actions</span></div><div id="aa-v2-queue"></div></div><div class="aa-v2-section"><div class="aa-v2-section-head"><b>Agent health</b><span class="hint">Tower-light by department</span></div><div id="aa-v2-health"></div></div></div><div class="aa-v2-section-head" style="margin-top:16px"><b>20 governed agents</b><span class="aa-v2-last" id="aa-v2-count"></span></div><div id="aa-v2-agents" class="aa-v2-agent-grid"></div><div id="aa-v2-result" class="aa-v2-result"></div>';
    var feed=document.createElement('div');feed.className='card aa-v2-feed';feed.id='aa-v2-feed-root';feed.innerHTML='<div class="aa-v2-feed-summary"><div><div class="aa-v2-kicker">AGENTIC AI · DEPARTMENT FEED</div><h3 style="margin:3px 0 0;font-family:var(--disp);font-size:20px;color:var(--navy)">5W1H Action Feed</h3><div class="hint">Department-wise intelligence mapped to the menu ownership, with tower-light risk and User Management linkage.</div></div><div class="aa-v2-feed-legend"><span class="aa-v2-legend"><i class="aa-v2-lamp red"></i>Critical / overdue</span><span class="aa-v2-legend"><i class="aa-v2-lamp amber"></i>High / review</span><span class="aa-v2-legend"><i class="aa-v2-lamp green"></i>Normal / monitored</span></div></div><div style="margin-top:12px" id="aa-v2-feed-items"></div>';
    var anchor=panel.querySelector('#aa-tiles');panel.insertBefore(wrap,anchor||panel.firstChild);wrap.after(feed);document.getElementById('aa-v2-feed-root').querySelector('#aa-v2-feed-items').id='aa-v2-feed-root';
    document.getElementById('aa-v2-refresh').onclick=function(){refresh().catch(function(e){document.getElementById('aa-v2-status').textContent=e.message;});};
    document.getElementById('aa-v2-review-top').onclick=openReview;document.getElementById('aa-v2-runs-top').onclick=openRuns;document.getElementById('aa-v2-user-top').onclick=openUserManagement;
    document.getElementById('aa-v2-run-control').onclick=function(){var a=(state.registry&&state.registry.agents||[]).find(function(x){return x.id==='control_tower'});if(a)runAgent(a.id,this);};
    refresh().catch(function(e){document.getElementById('aa-v2-status').textContent=e.message;});
  }
  function renderFeed(tasks){
    var feed=document.getElementById('aa-v2-feed-root');if(!feed)return;var items=tasks.map(feedItem),groups={};items.forEach(function(x){(groups[x.dept]=groups[x.dept]||[]).push(x);});var host=feed.querySelector('#aa-v2-feed-items');if(!host)return;
    var html='';Object.keys(groups).sort().forEach(function(dep){var arr=groups[dep];html+='<section class="aa-v2-dept"><div class="aa-v2-dept-head"><b>'+esc(dep)+'</b><span>'+arr.length+' live item(s) · menu ownership</span></div>'+arr.slice(0,20).map(function(x){return '<article class="aa-v2-feed-card"><div class="aa-v2-feed-top"><div><div class="aa-v2-feed-title">'+esc(x.what)+'</div><div class="aa-v2-feed-sub">'+esc(x.agent?x.agent.name:'Agentic AI')+' · Menu: '+esc(x.where)+'</div></div><span class="aa-v2-pill '+(x.risk==='red'?'stop':x.risk==='amber'?'high':'ok')+'"><span class="aa-v2-lamp '+x.risk+'" style="width:8px;height:8px;margin-right:4px"></span>'+esc(x.priority)+'</span></div><div class="aa-v2-5w1h"><div class="aa-v2-w1h"><b>What</b><span>'+esc(x.what)+'</span></div><div class="aa-v2-w1h"><b>Why</b><span>'+esc(x.why)+'</span></div><div class="aa-v2-w1h"><b>Where</b><span>'+esc(x.where)+'</span></div><div class="aa-v2-w1h"><b>When</b><span>'+esc(x.when)+'</span></div><div class="aa-v2-w1h"><b>Who</b><span>'+esc(x.who)+'</span></div><div class="aa-v2-w1h"><b>How</b><span>'+esc(x.how)+'</span></div></div><div class="aa-v2-feed-actions"><button type="button" class="btn" data-feed-screen="'+esc(x.screen)+'">Open menu</button><button type="button" class="btn">Review action</button><button type="button" class="btn">User Management</button></div></article>';}).join('')+'</section>';});
    host.innerHTML=html||'<div class="aa-v2-empty"><b>No live Agentic AI feed items.</b><br>The department feed will populate when governed agents create reviewable actions.</div>';
    host.querySelectorAll('[data-feed-screen]').forEach(function(b){b.onclick=function(){openScreen(b.dataset.feedScreen);};});host.querySelectorAll('.aa-v2-feed-actions .btn:nth-child(2)').forEach(function(b){b.onclick=openReview;});host.querySelectorAll('.aa-v2-feed-actions .btn:nth-child(3)').forEach(function(b){b.onclick=openUserManagement;});
  }

  function boot(){var tries=0,timer=setInterval(function(){tries++;var panel=document.querySelector('[data-panel="agentic_ai"]');if(panel){clearInterval(timer);mount();if(token())refresh().catch(function(e){var st=document.getElementById('aa-v2-status');if(st)st.textContent=e.message;});return;}if(tries>240)clearInterval(timer);},250);document.addEventListener('click',function(e){var t=e.target&&e.target.closest&&e.target.closest('[data-screen="agentic_ai"]');if(t)setTimeout(function(){mount();if(token())refresh().catch(function(){});},0);});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
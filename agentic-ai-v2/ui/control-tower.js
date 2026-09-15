/* Agentic AI Control Tower — live overlay for the existing IDMS Agentic AI panel.
   It deliberately reuses the current panel rather than creating a second screen.
   Data comes from the governed Agentic V2 registry + live IDMS task/run records. */
(function(){
  'use strict';
  var mounted=false, state={registry:null,tasks:[],runs:[],updatedAt:null};
  var esc=function(s){return String(s==null?'':s).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c];});};
  var token=function(){return sessionStorage.getItem('idms_token')||'';};

  function css(){
    if(document.getElementById('aa-v2-css')) return;
    var s=document.createElement('style'); s.id='aa-v2-css';
    s.textContent=`
      .aa-v2-shell{border-top:3px solid var(--gold,#c2932e);margin-bottom:16px}
      .aa-v2-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;flex-wrap:wrap}
      .aa-v2-kicker{font-family:var(--mono);font-size:9px;letter-spacing:.11em;color:var(--gold-deep);font-weight:700}
      .aa-v2-head h3{font-family:var(--disp);font-size:22px;color:var(--navy);margin:4px 0}
      .aa-v2-head p{max-width:850px;margin:0}
      .aa-v2-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}
      .aa-v2-status{font-family:var(--mono);font-size:9.5px;color:var(--ink-soft);margin-top:9px;min-height:14px}
      .aa-v2-kpis{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:10px;margin-top:12px}
      .aa-v2-kpi{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
      .aa-v2-kpi b{display:block;font-family:var(--disp);font-size:24px;line-height:1;color:var(--navy)}
      .aa-v2-kpi span{display:block;font-family:var(--mono);font-size:9px;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.06em;margin-top:6px}
      .aa-v2-kpi.warn b{color:var(--bad,#d95f56)}
      .aa-v2-kpi.good b{color:var(--ok,#1f9d6b)}
      .aa-v2-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(300px,.8fr);gap:14px;margin-top:14px}
      .aa-v2-section{min-width:0}
      .aa-v2-section-head{display:flex;justify-content:space-between;gap:10px;align-items:center;margin:4px 0 8px}
      .aa-v2-section-head b{font-family:var(--disp);font-size:12px;color:var(--navy);text-transform:uppercase;letter-spacing:.06em}
      .aa-v2-table{width:100%;border-collapse:collapse;font-size:11px}
      .aa-v2-table th{font-family:var(--mono);font-size:8.5px;color:var(--ink-soft);text-align:left;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line);padding:7px}
      .aa-v2-table td{border-bottom:1px solid var(--line);padding:8px 7px;vertical-align:top}
      .aa-v2-table tr:last-child td{border-bottom:0}
      .aa-v2-pill{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;padding:2px 7px;font-family:var(--mono);font-size:8px;font-weight:700;white-space:nowrap}
      .aa-v2-pill.stop,.aa-v2-pill.high{color:var(--bad,#d95f56);border-color:rgba(217,95,86,.35)}
      .aa-v2-pill.stop{background:rgba(217,95,86,.08)}
      .aa-v2-pill.normal{color:var(--sky-deep,#2b78a8)}
      .aa-v2-pill.ok{color:var(--ok,#1f9d6b);border-color:rgba(31,157,107,.32)}
      .aa-v2-pill.pending{color:var(--gold-deep,#8e6a19);border-color:rgba(194,147,46,.4)}
      .aa-v2-agent-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(255px,1fr));gap:10px}
      .aa-v2-agent{background:var(--white);border:1px solid var(--line);border-radius:10px;padding:11px 12px;box-shadow:var(--shadow-sm)}
      .aa-v2-agent-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
      .aa-v2-agent-name{font-size:12px;font-weight:700;color:var(--navy);line-height:1.25}
      .aa-v2-agent-meta{font-family:var(--mono);font-size:8px;color:var(--ink-soft);margin-top:4px}
      .aa-v2-agent-stats{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;font-family:var(--mono);font-size:8px;color:var(--ink-mid)}
      .aa-v2-agent-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}
      .aa-v2-agent-actions .btn{padding:5px 8px;font-size:10px}
      .aa-v2-empty{padding:12px;border:1px dashed var(--line);border-radius:9px;color:var(--ink-soft);font-size:11px}
      .aa-v2-result{margin-top:12px}
      .aa-v2-last{font-family:var(--mono);font-size:8.5px;color:var(--ink-soft)}
      @media(max-width:900px){.aa-v2-kpis{grid-template-columns:repeat(2,minmax(130px,1fr))}.aa-v2-grid{grid-template-columns:1fr}}
      @media(max-width:560px){.aa-v2-kpis{grid-template-columns:1fr 1fr}.aa-v2-head h3{font-size:19px}}
    `;
    document.head.appendChild(s);
  }

  async function api(url, opts){
    var h=Object.assign({'X-Auth-Token':token(),'Content-Type':'application/json'},(opts&&opts.headers)||{});
    var r=await fetch(url,Object.assign({},opts||{},{headers:h,cache:'no-store'}));
    var j; try{j=await r.json();}catch(e){throw new Error('Agentic AI returned an unreadable response ('+r.status+').');}
    if(!r.ok||!j.ok) throw new Error(j.error||('Agentic AI request failed ('+r.status+').'));
    return j;
  }

  async function refresh(){
    if(!token()) return false;
    var data=await Promise.all([
      api('/api/ai?mode=agentic&what=registry'),
      api('/api/idms?what=docs&kind=task&limit=1000'),
      api('/api/ai?mode=agentic&what=runs')
    ]);
    state.registry=data[0].registry||{agents:[]};
    state.tasks=data[1].docs||[];
    state.runs=data[2].runs||[];
    state.updatedAt=new Date();
    render();
    return true;
  }

  function openScreen(screen){
    var selector='[data-screen="'+CSS.escape(screen)+'"]';
    var a=document.querySelector('.menubar '+selector) || document.querySelector(selector);
    if(a) { a.click(); return; }
    var goto='[data-goto="'+CSS.escape(screen)+'"]';
    var g=document.querySelector(goto);
    if(g) g.click();
  }

  function openReview(){openScreen('agent_review')}
  function openRuns(){openScreen('agent_runs')}

  function openTasks(){
    return state.tasks.filter(function(t){var d=t.data||{};return !!d.aiProposed&&!/^(closed|completed|rejected)$/i.test(String(t.status||''));});
  }
  function priorityClass(t){
    var p=String((t.data||{}).priority||'Normal'); return p==='Stop the line'?'stop':p==='High'?'high':'normal';
  }
  function overdue(t){var d=String((t.data||{}).dueOn||''); return !!d&&d<new Date().toISOString().slice(0,10);}
  function lastRuns(a){
    var r=state.runs.filter(function(x){var d=x.data||{};return d.agentId===a.id||d.agentName===a.name||d.agent===a.name;});
    r.sort(function(x,y){var xd=x.data||{},yd=y.data||{};return new Date(yd.completedAt||yd.at||y.updated_at||0)-new Date(xd.completedAt||xd.at||x.updated_at||0);});
    return r;
  }
  function ago(r){
    if(!r) return 'Never run';
    var d=r.data||{}, at=new Date(d.completedAt||d.at||r.updated_at); if(isNaN(at)) return 'Recorded';
    var ms=Date.now()-at.getTime(); if(ms<3600000)return Math.max(1,Math.round(ms/60000))+' min ago';
    if(ms<86400000)return Math.round(ms/3600000)+' hr ago'; if(ms<7*86400000)return Math.round(ms/86400000)+' d ago';
    return at.toLocaleDateString('en-GB');
  }

  function render(){
    var root=document.getElementById('aa-v2-root'); if(!root) return;
    var tasks=openTasks(), stop=tasks.filter(function(t){return priorityClass(t)==='stop'}).length,
        high=tasks.filter(function(t){return priorityClass(t)==='high'}).length,
        overdueN=tasks.filter(overdue).length,
        agents=(state.registry.agents||[]);
    root.querySelector('#aa-v2-status').textContent='Live data · '+agents.length+' governed agents · updated '+state.updatedAt.toLocaleString('en-GB');
    root.querySelector('#aa-v2-kpis').innerHTML=[
      ['Critical risks',stop,stop?'warn':'good'],['High risks',high,high?'warn':'good'],['Open AI actions',tasks.length,tasks.length?'warn':'good'],['Overdue actions',overdueN,overdueN?'warn':'good']
    ].map(function(x){return '<div class="aa-v2-kpi '+x[2]+'"><b>'+x[1]+'</b><span>'+esc(x[0])+'</span></div>';}).join('');

    var q=tasks.slice().sort(function(a,b){var p={stop:3,high:2,normal:1};return (p[priorityClass(b)]-p[priorityClass(a)])||(overdue(b)?1:0)-(overdue(a)?1:0);}).slice(0,10);
    root.querySelector('#aa-v2-queue').innerHTML=q.length
      ? '<table class="aa-v2-table"><thead><tr><th>Agent</th><th>Action</th><th>Priority</th><th>Owner</th><th>Due</th><th></th></tr></thead><tbody>'+q.map(function(t){var d=t.data||{};return '<tr><td><b>'+esc(d.source||'Agent')+'</b></td><td>'+esc(d.title||'Proposed action')+'</td><td><span class="aa-v2-pill '+priorityClass(t)+'">'+esc(d.priority||'Normal')+'</span></td><td>'+esc(d.owner||'—')+'</td><td class="'+(overdue(t)?'aa-v2-pill high':'')+'">'+esc(d.dueOn||'—')+(overdue(t)?' · overdue':'')+'</td><td><button type="button" class="btn aa-v2-review">Open</button></td></tr>';}).join('')+'</tbody></table>'
      : '<div class="aa-v2-empty"><b>No open AI-proposed actions.</b><br>Run an agent to populate the human review queue.</div>';
    root.querySelectorAll('.aa-v2-review').forEach(function(b){b.onclick=openReview;});

    var groups={}; agents.forEach(function(a){(groups[a.department]=groups[a.department]||[]).push(a);});
    var order=['Management','Marketing','NPD','PPC & MMD','Purchase & SCM','Quality Assurance','Maintenance','HRM','Production','Accounts'];
    var deps=order.filter(function(d){return groups[d]}).concat(Object.keys(groups).filter(function(d){return order.indexOf(d)<0}));
    var cards=[];
    deps.forEach(function(dep){cards.push('<div style="grid-column:1/-1" class="bu-group">'+esc(dep)+'</div>'); groups[dep].forEach(function(a){
      var rel=lastRuns(a), r=rel[0], open=tasks.filter(function(t){return String((t.data||{}).source||'').toLowerCase()===String(a.name||'').toLowerCase();}).length;
      var status=open?'Needs review':r?'Monitored':'Ready', cls=open?'pending':r?'ok':'normal';
      cards.push('<div class="aa-v2-agent"><div class="aa-v2-agent-head"><div><div class="aa-v2-agent-name">'+esc(a.name)+'</div><div class="aa-v2-agent-meta">'+esc(a.department)+' · '+esc(a.mode)+' · level '+esc(a.level)+'</div></div><span class="aa-v2-pill '+cls+'">'+status+'</span></div><div class="aa-v2-agent-stats"><span>'+open+' open task(s)</span><span>last '+esc(ago(r))+'</span><span>'+((a.reads||[]).length)+' data sets</span></div><div class="aa-v2-agent-actions"><button type="button" class="btn gold aa-v2-run" data-agent="'+esc(a.id)+'">Run Agent</button><button type="button" class="btn aa-v2-open" data-screen="'+esc(a.screen||'agentic_ai')+'">Open screen</button></div></div>');
    });});
    root.querySelector('#aa-v2-agents').innerHTML=cards.join('');
    root.querySelector('#aa-v2-count').textContent=agents.length+' governed agents registered';
    root.querySelectorAll('.aa-v2-open').forEach(function(b){b.onclick=function(){openScreen(b.dataset.screen);};});
    root.querySelectorAll('.aa-v2-run').forEach(function(b){b.onclick=function(){runAgent(b.dataset.agent,b);};});
  }

  async function runAgent(agentId,button){
    var old=button.textContent; button.disabled=true; button.textContent='Running…';
    var status=document.getElementById('aa-v2-status'); status.textContent='Running '+agentId+' against live IDMS records…';
    try{
      var j=await api('/api/ai?mode=agentic',{method:'POST',body:JSON.stringify({agentId:agentId,eventType:'MANUAL'})});
      var result=document.getElementById('aa-v2-result'); result.innerHTML='<div class="card"><b>Agent run completed</b><div class="aa-v2-last">'+esc(j.agentId||agentId)+' · '+esc(j.runId||'')+' · '+esc(j.model||j.provider||'AI')+'</div><div style="margin-top:8px;white-space:pre-wrap;font-size:12px;line-height:1.55">'+esc(j.narrative||'No narrative returned.')+'</div><div class="hint" style="margin-top:8px">Reviewable tasks created: <b>'+esc(j.taskCount||0)+'</b> · <a data-aa-review-link="1" style="cursor:pointer;color:var(--sky-deep);font-weight:600">Review Agent Work</a></div></div>';
      result.querySelector('[data-aa-review-link]').onclick=openReview;
      await refresh();
    }catch(e){document.getElementById('aa-v2-result').innerHTML='<div class="note bad">'+esc(e.message)+'</div>';}
    button.disabled=false; button.textContent=old;
  }

  function mount(){
    var panel=document.querySelector('[data-panel="agentic_ai"]');
    if(!panel||mounted) return;
    mounted=true; css();
    var wrap=document.createElement('div'); wrap.className='card aa-v2-shell'; wrap.id='aa-v2-root';
    wrap.innerHTML='<div class="aa-v2-head"><div><div class="aa-v2-kicker">AGENTIC AI · LIVE FACTORY INTELLIGENCE</div><h3>Agentic AI Control Tower</h3><p class="hint">Live view of the 20 governed agents. Agents observe IDMS records, rank risk and propose reviewable work; people approve consequential actions.</p></div><div class="aa-v2-actions"><button type="button" class="btn gold" id="aa-v2-run-control">Run Control Tower</button><button type="button" class="btn" id="aa-v2-refresh">Refresh live status</button><button type="button" class="btn" id="aa-v2-review-top">Review Agent Work</button><button type="button" class="btn" id="aa-v2-runs-top">Agent Run Log</button></div></div><div id="aa-v2-status" class="aa-v2-status">Waiting for a signed-in session…</div><div id="aa-v2-kpis" class="aa-v2-kpis"></div><div class="aa-v2-grid"><div class="aa-v2-section"><div class="aa-v2-section-head"><b>Priority queue</b><span class="hint">Top live AI-proposed actions</span></div><div id="aa-v2-queue"></div></div><div class="aa-v2-section"><div class="aa-v2-section-head"><b>Agent health</b><span class="hint">Latest run / pending work</span></div><div id="aa-v2-health"></div></div></div><div class="aa-v2-section-head" style="margin-top:16px"><b>20 governed agents</b><span class="aa-v2-last" id="aa-v2-count"></span></div><div id="aa-v2-agents" class="aa-v2-agent-grid"></div><div id="aa-v2-result" class="aa-v2-result"></div>';
    var anchor=panel.querySelector('#aa-tiles'); panel.insertBefore(wrap,anchor||panel.firstChild);
    document.getElementById('aa-v2-refresh').onclick=function(){refresh().catch(function(e){document.getElementById('aa-v2-status').textContent=e.message;});};
    document.getElementById('aa-v2-review-top').onclick=openReview;
    document.getElementById('aa-v2-runs-top').onclick=openRuns;
    document.getElementById('aa-v2-run-control').onclick=function(){var a=(state.registry&&state.registry.agents||[]).filter(function(x){return x.id==='control_tower'})[0];if(a)runAgent(a.id,this);};
    refresh().catch(function(e){document.getElementById('aa-v2-status').textContent=e.message;});
  }

  function boot(){
    var tries=0, timer=setInterval(function(){
      tries++;
      if(!document.querySelector('[data-panel="agentic_ai"]')){if(tries>120)clearInterval(timer);return;}
      if(token()){clearInterval(timer);mount();return;}
      if(tries>120)clearInterval(timer);
    },500);
    document.addEventListener('click',function(e){
      if(e.target&&e.target.closest&&e.target.closest('[data-screen="agentic_ai"]')){
        setTimeout(function(){if(!mounted&&token())mount(); else if(mounted)refresh().catch(function(){});},250);
      }
    });
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();

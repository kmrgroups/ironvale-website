/* Live IDMS bridge for the Agentic AI Executive Control screen. */
(function(){
  'use strict';
  var MENU_ID='agentic-executive-menu';
  var PANEL_ID='agentic-control-tower-v2';
  var HASH='agentic_exec';
  var panelReady=false;
  var stylesReady=false;

  function visiblePanel(){
    var target=document.getElementById(PANEL_ID);
    var panels=[].slice.call(document.querySelectorAll('.panel'));
    panels.forEach(function(p){
      if(p===target) p.classList.add('on');
      else p.classList.remove('on');
    });
  }

  function openExecutive(){
    if(!panelReady) return;
    visiblePanel();
    if(location.hash !== '#s='+HASH) history.pushState(null,'','#s='+HASH);
    var menu=document.getElementById(MENU_ID);
    if(menu) menu.classList.remove('open');
    var tower=document.getElementById(PANEL_ID);
    if(tower) tower.classList.add('on');
  }

  function installMenu(){
    var bar=document.getElementById('menubar') || document.querySelector('.menubar');
    if(!bar || document.getElementById(MENU_ID)) return;
    var g=document.createElement('div');
    g.className='mgroup';
    g.id=MENU_ID;
    g.innerHTML='<a href="#s='+HASH+'" class="mg-toggle">🤖 AGENTIC AI <span class="ar">▼</span></a>'+
      '<div class="drop"><div class="sec">AI Governance &amp; Executive Control</div>'+
      '<a href="#s='+HASH+'" data-agentic-executive-link="1"><span>🎯 AGENTIC AI · EXECUTIVE CONTROL</span></a></div>';
    bar.appendChild(g);
    var toggle=g.querySelector('.mg-toggle');
    if(toggle) toggle.addEventListener('click',function(e){
      e.preventDefault(); e.stopPropagation();
      var was=g.classList.contains('open');
      bar.querySelectorAll('.mgroup').forEach(function(x){x.classList.remove('open');});
      if(!was) g.classList.add('open');
    });
    var link=g.querySelector('[data-agentic-executive-link]');
    if(link) link.addEventListener('click',function(e){
      e.preventDefault();
      openExecutive();
    });
  }

  function copyPanelStyles(doc){
    if(stylesReady) return;
    doc.querySelectorAll('style,link[rel="stylesheet"]').forEach(function(n){
      var clone=n.cloneNode(true);
      clone.dataset.agenticExecutive='1';
      document.head.appendChild(clone);
    });
    stylesReady=true;
  }

  async function installPanel(){
    if(panelReady || !document.body) return;
    var firstPanel=document.querySelector('.panel');
    var host=firstPanel ? firstPanel.parentNode : null;
    if(!host) return;
    try{
      var r=await fetch('/agentic-ai-v2/ui/agentic-panel.html?v=20260915',{cache:'no-store'});
      if(!r.ok) throw Error('Agentic panel load failed ('+r.status+')');
      var html=await r.text();
      var doc=new DOMParser().parseFromString(html,'text/html');
      copyPanelStyles(doc);
      var node=doc.querySelector('#'+PANEL_ID);
      if(!node) throw Error('Agentic panel root not found');
      node.dataset.panel='agentic_ai';
      node.classList.remove('on');
      var scripts=[].slice.call(node.querySelectorAll('script'));
      scripts.forEach(function(s){s.remove();});
      host.appendChild(node);
      scripts.forEach(function(old){
        var s=document.createElement('script');
        for(var i=0;i<old.attributes.length;i++){
          var a=old.attributes[i];
          s.setAttribute(a.name,a.value);
        }
        s.text=old.textContent||'';
        node.appendChild(s);
      });
      panelReady=true;
      if((location.hash||'')==='#s='+HASH) openExecutive();
    }catch(err){
      console.error('[Agentic Executive]',err);
    }
  }

  function tick(){ installMenu(); installPanel(); }
  var obs=new MutationObserver(function(){ tick(); });
  function start(){
    tick();
    obs.observe(document.body,{childList:true,subtree:true});
    window.addEventListener('hashchange',function(){ if(location.hash==='#s='+HASH) openExecutive(); });
    window.addEventListener('popstate',function(){ if(location.hash==='#s='+HASH) openExecutive(); });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
})();

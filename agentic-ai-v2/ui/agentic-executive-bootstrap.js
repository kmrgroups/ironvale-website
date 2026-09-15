/* Live IDMS bridge for the Agentic AI Executive Control screen. */
(function(){
  'use strict';
  var MENU_ID='agentic-executive-menu';
  var BUTTON_ID='agentic-executive-launcher';
  var PANEL_ID='agentic-control-tower-v2';
  var HASH='agentic_exec';
  var panelReady=false;
  var stylesReady=false;

  function getBar(){
    return document.getElementById('menubar') ||
      document.querySelector('.menubar') ||
      document.querySelector('nav') ||
      document.querySelector('[role="navigation"]');
  }

  function visiblePanel(){
    var target=document.getElementById(PANEL_ID);
    if(!target) return;
    var panels=[].slice.call(document.querySelectorAll('.panel'));
    panels.forEach(function(p){
      if(p===target){
        p.classList.add('on');
        p.style.display='block';
      }else{
        p.classList.remove('on');
      }
    });
    window.scrollTo(0,0);
  }

  function openExecutive(){
    if(!panelReady) return;
    if(location.hash !== '#s='+HASH) history.pushState(null,'','#s='+HASH);
    visiblePanel();
    var menu=document.getElementById(MENU_ID);
    if(menu) menu.classList.remove('open');
    var launcher=document.getElementById(BUTTON_ID);
    if(launcher) launcher.setAttribute('aria-expanded','true');
  }

  function addLauncher(){
    if(document.getElementById(BUTTON_ID) || !document.body) return;
    var b=document.createElement('button');
    b.id=BUTTON_ID;
    b.type='button';
    b.textContent='🎯 AGENTIC AI · EXECUTIVE CONTROL';
    b.setAttribute('aria-label','Open Agentic AI Executive Control');
    b.setAttribute('aria-expanded','false');
    b.style.cssText='position:fixed;right:18px;top:72px;z-index:2147483000;border:1px solid #d6dee8;border-radius:10px;padding:10px 14px;background:#17243b;color:#fff;font:700 12px Arial,sans-serif;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.18);letter-spacing:.2px;';
    b.addEventListener('mouseenter',function(){b.style.transform='translateY(-1px)';});
    b.addEventListener('mouseleave',function(){b.style.transform='';});
    b.addEventListener('click',function(e){e.preventDefault();openExecutive();});
    document.body.appendChild(b);
  }

  function installMenu(){
    var bar=getBar();
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
    if(link) link.addEventListener('click',function(e){e.preventDefault();openExecutive();});
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
    var host=firstPanel ? firstPanel.parentNode : document.body;
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
      addLauncher();
      installMenu();
      if((location.hash||'')==='#s='+HASH) openExecutive();
    }catch(err){
      console.error('[Agentic Executive]',err);
      addLauncher();
    }
  }

  function tick(){ addLauncher(); installMenu(); installPanel(); }
  function start(){
    tick();
    var obs=new MutationObserver(function(){tick();});
    obs.observe(document.body,{childList:true,subtree:true});
    window.addEventListener('hashchange',function(){if(location.hash==='#s='+HASH) openExecutive();});
    window.addEventListener('popstate',function(){if(location.hash==='#s='+HASH) openExecutive();});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
})();

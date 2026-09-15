/* Live IDMS bridge for the Agentic AI screens: Control Tower and Agentic AI · More.
   These are two separate, independently navigable screens (not tabs on one screen). */
(function(){
  'use strict';
  var MENU_ID='agentic-executive-menu';
  var BUTTON_ID='agentic-executive-launcher';

  var SCREENS={
    control:{ panelId:'agentic-control-tower-v2', panelKey:'agentic_control_tower', file:'/agentic-ai-v2/ui/control-tower-panel.html', menuLabel:'🎯 Control Tower' },
    more:{ panelId:'agentic-ai-more-v2', panelKey:'agentic_ai_more', file:'/agentic-ai-v2/ui/agentic-more-panel.html', menuLabel:'🗂️ Agentic AI · More' }
  };
  var ready={ control:false, more:false };
  var stylesReady=false;

  function getBar(){
    return document.getElementById('menubar') ||
      document.querySelector('.menubar') ||
      document.querySelector('nav') ||
      document.querySelector('[role="navigation"]');
  }

  function hashFor(key){ return '#s='+SCREENS[key].panelKey; }
  function keyForHash(hash){
    for(var k in SCREENS){ if(SCREENS.hasOwnProperty(k) && hashFor(k)===hash) return k; }
    return null;
  }

  function visiblePanel(key){
    var target=document.getElementById(SCREENS[key].panelId);
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

  function openScreen(key){
    if(!ready[key]) return;
    var wantHash=hashFor(key);
    if(location.hash !== wantHash) history.pushState(null,'',wantHash);
    visiblePanel(key);
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
    b.textContent='🎯 AGENTIC AI · CONTROL TOWER';
    b.setAttribute('aria-label','Open Agentic AI Control Tower');
    b.setAttribute('aria-expanded','false');
    b.style.cssText='position:fixed;right:18px;top:72px;z-index:2147483000;border:1px solid #d6dee8;border-radius:10px;padding:10px 14px;background:#17243b;color:#fff;font:700 12px Arial,sans-serif;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.18);letter-spacing:.2px;';
    b.addEventListener('mouseenter',function(){b.style.transform='translateY(-1px)';});
    b.addEventListener('mouseleave',function(){b.style.transform='';});
    b.addEventListener('click',function(e){e.preventDefault();openScreen('control');});
    document.body.appendChild(b);
  }

  function installMenu(){
    var bar=getBar();
    if(!bar || document.getElementById(MENU_ID)) return;
    var g=document.createElement('div');
    g.className='mgroup';
    g.id=MENU_ID;
    g.innerHTML='<a href="'+hashFor('control')+'" class="mg-toggle">🤖 AGENTIC AI <span class="ar">▼</span></a>'+
      '<div class="drop"><div class="sec">AI Governance &amp; Executive Control</div>'+
      '<a href="'+hashFor('control')+'" data-agentic-link="control"><span>'+SCREENS.control.menuLabel+'</span></a>'+
      '<a href="'+hashFor('more')+'" data-agentic-link="more"><span>'+SCREENS.more.menuLabel+'</span></a>'+
      '</div>';
    bar.appendChild(g);
    var toggle=g.querySelector('.mg-toggle');
    if(toggle) toggle.addEventListener('click',function(e){
      e.preventDefault(); e.stopPropagation();
      var was=g.classList.contains('open');
      bar.querySelectorAll('.mgroup').forEach(function(x){x.classList.remove('open');});
      if(!was) g.classList.add('open');
    });
    [].slice.call(g.querySelectorAll('[data-agentic-link]')).forEach(function(link){
      link.addEventListener('click',function(e){e.preventDefault();openScreen(link.dataset.agenticLink);});
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

  async function installScreen(key){
    if(ready[key] || !document.body) return;
    var cfg=SCREENS[key];
    var firstPanel=document.querySelector('.panel');
    var host=firstPanel ? firstPanel.parentNode : document.body;
    try{
      var r=await fetch(cfg.file+'?v=20260915',{cache:'no-store'});
      if(!r.ok) throw Error('Agentic panel load failed ('+r.status+')');
      var html=await r.text();
      var doc=new DOMParser().parseFromString(html,'text/html');
      copyPanelStyles(doc);
      var node=doc.querySelector('#'+cfg.panelId);
      if(!node) throw Error('Agentic panel root not found for '+key);
      node.dataset.panel=cfg.panelKey;
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
      ready[key]=true;
      if((location.hash||'')===hashFor(key)) openScreen(key);
    }catch(err){
      console.error('[Agentic '+key+']',err);
    }
  }

  function installScreens(){
    installScreen('control');
    installScreen('more');
  }

  function tick(){ addLauncher(); installMenu(); installScreens(); }
  function start(){
    tick();
    var obs=new MutationObserver(function(){tick();});
    obs.observe(document.body,{childList:true,subtree:true});
    window.addEventListener('hashchange',function(){var k=keyForHash(location.hash);if(k)openScreen(k);});
    window.addEventListener('popstate',function(){var k=keyForHash(location.hash);if(k)openScreen(k);});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
})();

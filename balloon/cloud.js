/* =====================================================================
   Balloon Inspector – cloud layer (Supabase login, company workspaces,
   users & roles, saved reports, company logo/favicon).
   Nothing customer-specific is in this file: the connection comes from
   balloon/config.js, and every company's data lives in its own workspace.
   ===================================================================== */
(function(){
"use strict";
const CFG = window.BI_CONFIG || {};
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const BI = window.BI;
const APP = CFG.appName || "Balloon Inspector";

/* ---------- styles for the cloud screens ---------- */
const css = document.createElement("style");
css.textContent = `
.cl-veil{position:fixed;inset:0;z-index:40;background:color-mix(in srgb,var(--bg) 92%,transparent);display:grid;place-items:center;padding:20px;overflow:auto}
.cl-card{background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.18);width:min(440px,100%);padding:28px 26px}
.cl-card.wide{width:min(900px,100%)}
.cl-card h2{font:700 26px/1.1 var(--display);margin:0 0 6px}
.cl-card p.sub{color:var(--muted);margin:0 0 18px;font-size:14px}
.cl-card label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted);margin-bottom:12px}
.cl-card input,.cl-card select{border:1px solid var(--line);background:var(--field);border-radius:6px;padding:9px 10px;font-size:15px;color:var(--ink)}
.cl-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.cl-link{background:none;border:none;color:var(--sel);cursor:pointer;padding:4px 0;font-size:14px}
.cl-err{color:var(--fail);font-size:14px;min-height:20px;margin:6px 0}
.cl-ok{color:var(--pass);font-size:14px}
.cl-logo{width:44px;height:44px;border-radius:8px;object-fit:contain;background:#fff;border:1px solid var(--line)}
.cl-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:10px 0 16px;flex-wrap:wrap}
.cl-tabs button{border:none;background:none;padding:8px 12px;font:600 16px var(--display);cursor:pointer;border-bottom:2.5px solid transparent;color:var(--muted)}
.cl-tabs button[aria-selected=true]{color:var(--ink);border-color:var(--accent)}
.cl-list{border:1px solid var(--line);border-radius:8px;max-height:52vh;overflow:auto}
.cl-list table{min-width:0;table-layout:auto;font-size:14px}
.cl-list td,.cl-list th{padding:8px 10px}
.cl-list tr[data-open]{cursor:pointer}
.cl-list tr[data-open]:hover td{background:color-mix(in srgb,var(--sel) 8%,transparent)}
.cl-guide{font-size:14px;line-height:1.55;max-height:60vh;overflow:auto;padding-right:6px}
.cl-guide h3{font:600 18px var(--display);margin:18px 0 6px}
.cl-guide code{background:var(--mat);padding:1px 5px;border-radius:4px;font-size:13px}
.cl-user{display:flex;align-items:center;gap:8px}
.cl-orgname{font:600 15px var(--display);color:var(--muted);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cl-badge{font:600 12px var(--display);letter-spacing:.04em;text-transform:uppercase;border:1px solid var(--line);border-radius:10px;padding:1px 8px;color:var(--muted)}
.cl-offline{font-size:12.5px;color:var(--warn);border:1px dashed var(--warn);border-radius:12px;padding:2px 10px}
/* password field with eye */
.pw{position:relative;display:flex}
.pw input{flex:1;padding-right:44px!important;min-width:0}
.pw .eye{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:36px;height:36px;border:none;background:none;border-radius:6px;cursor:pointer;display:grid;place-items:center;color:var(--muted)}
.pw .eye:hover{color:var(--ink)} .pw .eye svg{width:20px;height:20px}
/* admin header */
.ad-head{display:flex;align-items:center;gap:14px}
.ad-logo{width:52px;height:52px;border-radius:10px;object-fit:contain;background:#fff;border:1px solid var(--line);padding:4px}
.ad-head h2{margin:0}
.ad-head small{display:block;color:var(--muted);font-size:13.5px;margin-top:2px}
.cl-pwbox{border:1px solid var(--line);border-radius:10px;padding:12px;margin:0 0 12px;background:var(--mat)}
.cl-card .btn.small{min-height:30px;padding:4px 10px;font-size:14px}
/* ---------- premium sign-in: 3D visual half + sign-in half ---------- */
.cl-veil.lg{background:#fff;padding:0;display:block;place-items:normal;overflow:auto;z-index:60;color:#16233A;--lg-ink:#16233A;--lg-muted:#5E6B7E;--lg-line:#E3E8EF;--lg-red:#C8102E;--lg-blue:#1F5FBF}
.lg-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);width:100%;min-height:100%;height:100%}
.lg-vis{position:relative;overflow:hidden;min-height:100vh;background:#0A0720;isolation:isolate}
.lg-aur{position:absolute;inset:-20%;z-index:0;filter:blur(60px) saturate(1.3);animation:lgHue 24s linear infinite}
.lg-aur i{position:absolute;border-radius:50%;opacity:.75;mix-blend-mode:screen}
.lg-aur i:nth-child(1){width:60%;height:60%;left:5%;top:10%;background:radial-gradient(circle,#7C3AED 0%,transparent 65%);animation:lgA1 22s ease-in-out infinite}
.lg-aur i:nth-child(2){width:55%;height:55%;right:0;top:25%;background:radial-gradient(circle,#06B6D4 0%,transparent 65%);animation:lgA2 26s ease-in-out infinite}
.lg-aur i:nth-child(3){width:50%;height:50%;left:20%;bottom:0;background:radial-gradient(circle,#EC4899 0%,transparent 65%);animation:lgA3 30s ease-in-out infinite}
.lg-aur i:nth-child(4){width:35%;height:35%;right:15%;bottom:12%;background:radial-gradient(circle,#F59E0B 0%,transparent 65%);opacity:.45;animation:lgA1 34s ease-in-out infinite reverse}
@keyframes lgA1{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(18%,12%) scale(1.15)}}
@keyframes lgA2{0%,100%{transform:translate(0,0) scale(1.1)}50%{transform:translate(-20%,-10%) scale(.9)}}
@keyframes lgA3{0%,100%{transform:translate(0,0)}50%{transform:translate(10%,-18%) scale(1.2)}}
@keyframes lgHue{to{filter:blur(60px) saturate(1.3) hue-rotate(360deg)}}
.lg-vis::before{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;opacity:.5;
  background:repeating-linear-gradient(0deg,rgba(255,255,255,.035) 0 1px,transparent 1px 3px)}
.lg-vis::after{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;background:radial-gradient(95% 75% at 50% 45%,transparent 50%,rgba(5,3,20,.65) 100%)}
.lg-vis canvas{position:absolute;inset:0;z-index:1;width:100%;height:100%;display:block;opacity:0;transition:opacity 1.4s ease}
.lg-vis.ready canvas{opacity:1}
.lg-vis .lg-fb{position:absolute;inset:8% 6% 16%;z-index:1;display:grid;place-items:center;transition:opacity .8s}
.lg-vis .lg-fb svg{width:100%;height:100%;filter:invert(1) hue-rotate(180deg) drop-shadow(0 0 6px rgba(34,211,238,.6))}
.lg-vis.ready .lg-fb{opacity:0}
.lg-fb .dr{fill:none} .lg-fb .scan{display:none} .lg-fb .dial,.lg-fb .dial2{opacity:.8}
.lg-chip{position:absolute;top:32px;left:40px;z-index:2;display:inline-flex;align-items:center;gap:10px;padding:8px 16px 8px 9px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);box-shadow:0 8px 30px rgba(0,0,0,.25);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.lg-chip .ring{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font:700 15px var(--display);color:#fff;background:linear-gradient(135deg,#22D3EE,#A855F7 55%,#EC4899);box-shadow:0 0 16px rgba(168,85,247,.7)}
.lg-chip span{font:700 15px var(--display);letter-spacing:.14em;text-transform:uppercase;color:#fff}
.lg-cap{position:absolute;left:40px;right:40px;bottom:32px;z-index:2;display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;pointer-events:none}
.lg-cap h3{margin:0;font:700 28px/1.1 var(--display);color:#fff;letter-spacing:.01em;text-shadow:0 2px 20px rgba(0,0,0,.35)}
.lg-cap h3 em{font-style:normal;background:linear-gradient(90deg,#22D3EE,#A855F7,#F472B6,#FBBF24);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:lgShine 8s linear infinite}
@keyframes lgShine{to{background-position:200% 0}}
.lg-cap p{margin:5px 0 0;font-size:13.5px;color:rgba(226,232,255,.78)}
.lg-tags{display:flex;gap:6px;flex-wrap:wrap}
.lg-tags span{font:600 12px var(--body);letter-spacing:.04em;color:#E9ECFF;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:5px 11px;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
@media (prefers-reduced-motion:reduce){ .lg-aur,.lg-aur i,.lg-cap h3 em{animation:none!important} }
.lg-panel{position:relative;display:flex;flex-direction:column;background:#fff;border-left:1px solid var(--lg-line);padding:40px 64px 28px;min-height:100vh;box-shadow:-30px 0 60px -40px rgba(22,35,58,.25)}
.lg-panel::before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:linear-gradient(90deg,#22D3EE,#7C3AED,#EC4899,#F59E0B);background-size:200% 100%;animation:lgShine 10s linear infinite}
.lg-form{width:100%;max-width:420px;margin:auto;padding:24px 0}
.lg-co{display:flex;align-items:center;gap:14px;margin:0 0 36px;min-height:56px}
.lg-co .lg-logo{height:56px;width:auto;max-width:200px;object-fit:contain;display:block}
.lg-co .lg-logo-fallback{width:52px;height:52px;flex:none;border-radius:50%;border:3px solid var(--lg-red);display:grid;place-items:center;font:700 26px var(--display);color:var(--lg-red);background:#fff;box-shadow:0 6px 18px rgba(200,16,46,.14)}
.lg-co div{font:600 19px/1.15 var(--display);letter-spacing:.02em;color:var(--lg-ink)}
.lg-co small{display:block;font:500 12px var(--body);letter-spacing:.08em;text-transform:uppercase;color:#8A96A8;margin-top:3px}
.lg-form h2{font:700 36px/1.05 var(--display);margin:0 0 8px;color:var(--lg-ink);letter-spacing:.005em}
.lg-form .lg-sub{color:var(--lg-muted);margin:0 0 30px;font-size:15px}
.lg-f{display:block;margin-bottom:18px}
.lg-f>span{display:block;font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:#6B788C;margin-bottom:8px;font-weight:600}
.lg-in{position:relative;display:flex;align-items:center}
.lg-in>svg{position:absolute;left:16px;width:18px;height:18px;color:#8A96A8;pointer-events:none;transition:color .15s}
.lg-in input{width:100%;height:54px;border-radius:12px;border:1px solid #D3DBE6;background:#F9FBFD;color:var(--lg-ink);padding:0 50px 0 46px;font-size:16px;transition:border-color .15s,box-shadow .15s,background .15s}
.lg-in input::placeholder{color:#A1ABBA}
.lg-in input:hover{border-color:#BAC5D4}
.lg-in input:focus{outline:none;background:#fff;border-color:#7C3AED;box-shadow:0 0 0 4px rgba(124,58,237,.14)}
.lg-in:focus-within>svg{color:#7C3AED}
.lg-in .eye{position:absolute;right:8px;width:38px;height:38px;border:none;background:none;border-radius:8px;cursor:pointer;display:grid;place-items:center;color:#7A879A}
.lg-in .eye:hover{color:var(--lg-ink);background:#EEF2F7} .lg-in .eye svg{width:20px;height:20px}
.lg-form .cl-err{color:#B00E28;min-height:22px;margin:0 0 12px;font-size:14px} .lg-form .cl-ok{color:#1E7B4A}
.lg-btn{width:100%;height:54px;border:none;border-radius:12px;cursor:pointer;font:700 18px var(--display);letter-spacing:.08em;text-transform:uppercase;color:#fff;position:relative;overflow:hidden;
  background:linear-gradient(120deg,#4F46E5 0%,#7C3AED 35%,#C026D3 70%,#DB2777 100%);background-size:160% 100%;box-shadow:0 14px 30px -10px rgba(124,58,237,.65),inset 0 1px 0 rgba(255,255,255,.25);transition:transform .12s,box-shadow .2s,background-position .6s}
.lg-btn::after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.2) 50%,transparent 70%);transform:translateX(-100%);transition:transform .7s}
.lg-btn:hover::after{transform:translateX(100%)} .lg-btn:hover{background-position:100% 0;box-shadow:0 18px 36px -10px rgba(219,39,119,.6)} .lg-btn:active{transform:translateY(1px)}
.lg-btn:disabled{opacity:.75;cursor:progress}
.lg-btn:focus-visible,.lg-in .eye:focus-visible,.lg-links button:focus-visible,.lg-foot a:focus-visible{outline:2px solid var(--lg-blue);outline-offset:2px}
.lg-links{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:18px;font-size:13.5px;color:#7A879A}
.lg-links button{background:none;border:none;color:var(--lg-blue);cursor:pointer;padding:4px 0;font-size:14px;font-weight:600}
.lg-links button:hover{text-decoration:underline}
.lg-foot{width:100%;max-width:420px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding-top:18px;border-top:1px solid var(--lg-line);font-size:12.5px;color:#8A96A8}
.lg-foot a{color:var(--lg-ink);text-decoration:none;display:inline-flex;align-items:center;gap:6px;font-size:13px}
.lg-foot a span{color:#8A96A8} .lg-foot a b{font-weight:700;border-bottom:1.5px solid transparent;transition:border-color .15s}
.lg-foot a:hover b{border-color:var(--lg-red)}
@media (max-width:900px){
  .lg-split{grid-template-columns:1fr;height:auto}
  .lg-vis{height:46vh;min-height:300px}
  .lg-chip{display:none} .lg-cap{left:16px;right:16px;bottom:14px} .lg-cap h3{font-size:20px} .lg-cap p,.lg-tags{display:none}
  .lg-panel{min-height:0;border-left:none;border-top:1px solid var(--lg-line);padding:8px 20px 22px;box-shadow:none}
  .lg-form{margin:0 auto;padding:22px 0 28px} .lg-co{margin-bottom:24px} .lg-form h2{font-size:30px} .lg-form .lg-sub{margin-bottom:22px}
  .lg-foot{justify-content:center;text-align:center} }
`;
document.head.append(css);

/* ---------- offline mode (no keys yet) ---------- */
if (!CFG.supabaseUrl || !CFG.supabaseAnonKey || !window.supabase) {
  const t = document.createElement("span"); t.className = "cl-offline";
  t.textContent = "Offline mode – nothing is saved. Add Supabase keys in balloon/config.js";
  document.querySelector(".tools").prepend(t);
  return;
}
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
const C = { user:null, memberships:[], org:null, role:null, platform:false, reportId:null, filePath:null, dirty:false, loading:false };
BI.onChange = () => { if (!C.loading && C.org) { C.dirty = true; updateSaveBtn(); } };

/* ---------- small UI helpers ---------- */
function veil(html, wide){ closeVeil(); const v=document.createElement("div"); v.className="cl-veil"; v.id="clVeil";
  v.innerHTML=`<div class="cl-card${wide?" wide":""}" role="dialog" aria-modal="true">${html}</div>`; document.body.append(v); return v; }
function closeVeil(){ const v=$("clVeil"); if(v) v.remove(); }
const EYE='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a10.5 10.5 0 0 0 5.4-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
/* adds the show/hide eye to a password box that sits inside .pw or .lg-in */
function eyeify(input){ if(!input||input.dataset.eye) return; input.dataset.eye="1";
  const b=document.createElement("button"); b.type="button"; b.className="eye"; b.innerHTML=EYE; b.setAttribute("aria-label","Show password"); b.setAttribute("aria-pressed","false"); b.title="Show password";
  b.onclick=()=>{ const show=input.type==="password"; input.type=show?"text":"password"; b.innerHTML=show?EYE_OFF:EYE; b.setAttribute("aria-pressed",String(show)); const l=show?"Hide password":"Show password"; b.setAttribute("aria-label",l); b.title=l; input.focus(); };
  input.after(b); }
function pwField(id,ph,ac){ return `<div class="pw"><input id="${id}" type="password" placeholder="${ph||""}" autocomplete="${ac||"new-password"}"></div>`; }
function suggestPw(){ const a="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789", r=new Uint32Array(10); crypto.getRandomValues(r); return Array.from(r,x=>a[x%a.length]).join("").replace(/^(.{5})/,"$1-"); }
function lastBrand(){ try{ return JSON.parse(localStorage.getItem("bi_brand")||"null"); }catch(e){ return null; } }
function rpcMsg(e){ const m=String(e&&e.message||e); if(/bi_admin_save_user|PGRST202|schema cache/i.test(m)) return "The database needs the v2 upgrade: run supabase/upgrade-v2.sql in the Supabase SQL Editor."; return m; }
function setFavicon(dataUrl){ let l=document.querySelector("link[rel=icon]"); if(!l){ l=document.createElement("link"); l.rel="icon"; document.head.append(l); } l.href=dataUrl; }
function brand(){ const o=C.org; const h1=document.querySelector(".brand h1"), sm=document.querySelector(".brand small"), mark=document.querySelector(".brand .mark");
  h1.textContent = APP; sm.textContent = o ? o.name : "";
  if (o && o.logo){ mark.innerHTML=`<img src="${o.logo}" alt="" style="width:34px;height:34px;object-fit:contain;border-radius:6px;background:#fff">`; mark.style.border="none"; mark.style.setProperty("--x","none"); mark.classList.add("haslogo"); setFavicon(o.logo); }
  else { mark.textContent="1"; mark.style.border=""; mark.classList.remove("haslogo"); }
  document.title = (o ? o.name + " – " : "") + APP;
  if (o) try{ localStorage.setItem("bi_brand", JSON.stringify({name:o.name, logo:o.logo||null})); }catch(e){}
  BI.S.logo = o && o.logo || null; if (BI.S.logo){ const im=new Image(); im.onload=()=>BI.S.logoRatio=im.width/im.height; im.src=BI.S.logo; }
}
const hideMarkLine = document.createElement("style"); hideMarkLine.textContent=".mark.haslogo::after{display:none}"; document.head.append(hideMarkLine);

/* ---------- toolbar additions ---------- */
const tools = document.querySelector(".tools");
const bar = document.createElement("div"); bar.className="cl-row"; bar.id="clBar"; bar.style.gap="6px";
bar.innerHTML = `<button class="btn" id="clReports">Reports</button><button class="btn primary" id="clSave" disabled>Save</button>
<span class="sep"></span><button class="btn" id="clAdmin" hidden>Admin</button>
<span class="cl-user"><select id="clOrg" class="btn" hidden aria-label="Company workspace"></select><span class="cl-badge" id="clRole"></span><button class="btn" id="clOut" title="Sign out">Sign out</button></span>`;
tools.prepend(bar);
function updateSaveBtn(){ const b=$("clSave"); if(!b) return; const can=C.role==="admin"||C.role==="editor";
  b.hidden=!can; b.disabled=!BI.S.sheets.length; b.textContent=C.dirty?"Save •":"Save"; }

/* ---------- sign in (premium screen) ---------- */
const ICON_MAIL='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
const ICON_LOCK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
/* animated engineering drawing: a flange being drawn, dimensioned, AI-scanned and ballooned – slow loop */
function lgArt(){
  const bolts=[0,60,120,180,240,300].map((a,i)=>{ const r=a*Math.PI/180, x=300+120*Math.cos(r), y=300+120*Math.sin(r); return `<circle class="dr" pathLength="1" style="--d:${1.2+i*.25}s" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="15"/>`; }).join("");
  const ticks=Array.from({length:72},(_,i)=>{ const a=i*5*Math.PI/180, r1=262, r2=i%6?254:244; return `<line x1="${(300+r1*Math.cos(a)).toFixed(1)}" y1="${(300+r1*Math.sin(a)).toFixed(1)}" x2="${(300+r2*Math.cos(a)).toFixed(1)}" y2="${(300+r2*Math.sin(a)).toFixed(1)}"/>`; }).join("");
  const B=[[1,118,120,190,180],[2,470,88,395,150],[3,420,258,352,282],[4,88,300,130,300],[5,600,560,580,512],[6,742,300,700,300],[7,210,560,250,516]];
  const balloons=B.map(([n,x,y,lx,ly],i)=>`<g class="bl" style="--d:${i*.55}s"><line x1="${lx}" y1="${ly}" x2="${x}" y2="${y}" stroke="#C8102E" stroke-width="1.6"/><circle cx="${lx}" cy="${ly}" r="3" fill="#C8102E"/><circle cx="${x}" cy="${y}" r="17" fill="#fff" stroke="#C8102E" stroke-width="2.2"/><text x="${x}" y="${y+6}" text-anchor="middle" font-size="17" font-weight="700" fill="#C8102E" font-family="Barlow Condensed,Arial Narrow,Arial">${n}</text></g>`).join("");
  return `<svg class="lg-art" viewBox="0 0 820 640" aria-hidden="true" focusable="false">
  <defs><linearGradient id="lgScanG" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#1F5FBF" stop-opacity="0"/><stop offset=".5" stop-color="#1F5FBF" stop-opacity=".22"/><stop offset="1" stop-color="#1F5FBF" stop-opacity="0"/></linearGradient></defs>
  <g class="dial" stroke="#16233A" stroke-opacity=".16" stroke-width="1.2">${ticks}<circle cx="300" cy="300" r="262" fill="none"/></g>
  <g class="dial2" fill="none" stroke="#1F5FBF" stroke-opacity=".16"><circle cx="300" cy="300" r="232" stroke-dasharray="2 10" stroke-width="2"/></g>
  <g stroke="#16233A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" stroke-opacity=".8">
    <circle class="dr" pathLength="1" style="--d:0s" cx="300" cy="300" r="175"/>
    <circle class="dr" pathLength="1" style="--d:.5s" cx="300" cy="300" r="62"/>
    <circle class="dr" pathLength="1" style="--d:.8s" cx="300" cy="300" r="82" stroke-opacity=".45"/>
    ${bolts}
    <path class="dr" pathLength="1" style="--d:1s" d="M540 125h110v350H540zM650 215h40v170h-40M540 238h110M540 362h110"/>
  </g>
  <g stroke="#1F5FBF" stroke-width="1.3" stroke-dasharray="14 5 3 5" stroke-opacity=".55" fill="none">
    <path class="fade" style="--d:.2s" d="M95 300h410M300 95v410M520 300h200"/>
    <circle class="fade" style="--d:.4s" cx="300" cy="300" r="120"/>
  </g>
  <g stroke="#16233A" stroke-opacity=".55" stroke-width="1.3" fill="#16233A">
    <path class="dr" pathLength="1" style="--d:2.2s" d="M125 300v230M475 300v230M125 516h350" fill="none"/>
    <path class="fade" style="--d:2.4s" d="M125 516l14-5v10zM475 516l-14-5v10z"/>
    <path class="dr" pathLength="1" style="--d:2.6s" d="M650 125h60M650 475h60M698 125v350" fill="none"/>
    <path class="fade" style="--d:2.8s" d="M698 125l-5 14h10zM698 475l-5-14h10z"/>
    <path class="dr" pathLength="1" style="--d:2.9s" d="M300 300l124-124h70" fill="none"/>
  </g>
  <g class="fade" style="--d:3s" fill="#16233A" fill-opacity=".75" font-family="Barlow Condensed,Arial Narrow,Arial" font-weight="600" font-size="20">
    <text x="300" y="506" text-anchor="middle" stroke="none">Ø350 ±0.1</text>
    <text x="720" y="305" stroke="none">350</text>
    <text x="436" y="168" stroke="none">Ø124 H7</text>
    <text x="100" y="600" font-size="15" fill-opacity=".5" stroke="none">6× Ø30 EQ SP · PCD 240</text>
  </g>
  <rect class="scan" x="40" y="0" width="720" height="60" fill="url(#lgScanG)"/>
  ${balloons}
</svg>`;
}
function loginShell(inner){
  closeVeil(); const v=document.createElement("div"); v.className="cl-veil lg"; v.id="clVeil";
  v.innerHTML=`<div class="lg-split">
   <section class="lg-vis" id="lgVis" aria-hidden="true">
     <div class="lg-aur"><i></i><i></i><i></i><i></i></div>
     <div class="lg-fb">${lgArt()}</div><canvas></canvas>
     <div class="lg-chip"><div class="ring">1</div><span>${esc(APP)}</span></div>
     <div class="lg-cap"><div><h3>Drawing to <em>inspection report</em>.</h3><p>Balloon, measure and report – in minutes.</p></div>
       <div class="lg-tags"><span>PDF · DWG · STEP · Photos</span><span>AI ballooning</span><span>ISO 2768</span></div></div>
   </section>
   <section class="lg-panel">
     <div class="lg-form" role="dialog" aria-modal="true" aria-labelledby="lgTitle">
       <div class="lg-co" id="lgCo"></div>
       ${inner}
     </div>
     <footer class="lg-foot"><span>© ${new Date().getFullYear()} ${esc(APP)}</span>
       <a href="https://www.kmr-groups.com" target="_blank" rel="noopener"><span>Powered by</span> <b>KMR Group of Companies</b></a></footer>
   </section>
  </div>`;
  document.body.append(v); showLoginBrand(); start3D($("lgVis")); return v;
}

/* ---------- HD 3D scene (three.js): a machined flange in a studio, slowly turning,
   dimensioned, scanned by the AI ring and ballooned – loops gently ---------- */
const THREE_URL="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
let threeLoading=null;
function loadThree(){ if(window.THREE) return Promise.resolve(); if(!threeLoading) threeLoading=new Promise((res,rej)=>{ const s=document.createElement("script"); s.src=THREE_URL; s.onload=res; s.onerror=()=>{ threeLoading=null; rej(new Error("3D library didn't load")); }; document.head.append(s); }); return threeLoading; }
function webglOK(){ try{ const c=document.createElement("canvas"); return !!(window.WebGLRenderingContext&&(c.getContext("webgl2")||c.getContext("webgl"))); }catch(e){ return false; } }
async function start3D(host){
  if(!host||!webglOK()) return;
  try{ await loadThree(); }catch(e){ return; }
  if(!host.isConnected) return;
  try{ buildScene(host); }catch(e){ console.warn("3D scene:",e); }
}
function buildScene(host){
  const T=window.THREE, cv=host.querySelector("canvas");
  const still=matchMedia("(prefers-reduced-motion: reduce)").matches;
  const R=new T.WebGLRenderer({canvas:cv,antialias:true,alpha:true,powerPreference:"high-performance"});
  R.setPixelRatio(Math.min(window.devicePixelRatio||1,2)); R.outputEncoding=T.sRGBEncoding;
  R.toneMapping=T.ACESFilmicToneMapping; R.toneMappingExposure=1.3; R.setClearColor(0x000000,0);
  const S=new T.Scene(), cam=new T.PerspectiveCamera(30,1,0.1,100);
  S.fog=new T.FogExp2(0x0A0720,.05);
  const ADD=T.AdditiveBlending;
  function radial(stops,size){ const c=document.createElement("canvas"); c.width=c.height=size||256; const x=c.getContext("2d"), h=c.width/2, g=x.createRadialGradient(h,h,0,h,h,h); stops.forEach(([o,col])=>g.addColorStop(o,col)); x.fillStyle=g; x.fillRect(0,0,c.width,c.height); const t=new T.CanvasTexture(c); return t; }

  /* colourful studio reflections: neon soft-boxes on a dark dome */
  const ec=document.createElement("canvas"); ec.width=2048; ec.height=1024; const g=ec.getContext("2d");
  let gr=g.createLinearGradient(0,0,0,1024); gr.addColorStop(0,"#2A1B5C"); gr.addColorStop(.48,"#1A1040"); gr.addColorStop(.55,"#0E0A26"); gr.addColorStop(1,"#05030F"); g.fillStyle=gr; g.fillRect(0,0,2048,1024);
  [[180,220,380,130,"#FFFFFF"],[700,160,300,110,"#22D3EE"],[1150,210,420,120,"#F0ABFC"],[1650,260,300,140,"#FBBF24"],[420,470,520,50,"#A855F7"],[1300,520,560,60,"#06B6D4"]]
    .forEach(([x,y,w,h,c])=>{ g.save(); g.filter="blur(22px)"; g.fillStyle=c; g.fillRect(x,y,w,h); g.restore(); });
  const et=new T.CanvasTexture(ec); et.mapping=T.EquirectangularReflectionMapping; et.encoding=T.sRGBEncoding;
  const pm=new T.PMREMGenerator(R); S.environment=pm.fromEquirectangular(et).texture; et.dispose(); pm.dispose();

  S.add(new T.HemisphereLight(0xC4B5FD,0x0B0720,.55));
  const key=new T.DirectionalLight(0xffffff,.9); key.position.set(4,9,6); S.add(key);
  /* coloured lights orbiting the part – their highlights glide over the chrome */
  const orbs=[[0xFF2BD6,0],[0x22E5FF,2.1],[0xFFB020,4.2]].map(([c,ph])=>{ const l=new T.PointLight(c,2.2,14,1.6); S.add(l);
    const halo=new T.Sprite(new T.SpriteMaterial({map:radial([[0,"rgba(255,255,255,1)"],[.15,"#"+c.toString(16).padStart(6,"0")],[1,"rgba(0,0,0,0)"]]),blending:ADD,transparent:true,depthWrite:false,opacity:.9}));
    halo.scale.set(.9,.9,1); S.add(halo); return {l,halo,ph}; });

  /* neon floor: glowing grid, pulse rings, light pool */
  const grid=new T.GridHelper(26,52,0xA855F7,0x3B2A7A); grid.material.transparent=true; grid.material.opacity=.3; grid.material.blending=ADD; S.add(grid);
  const pool=new T.Mesh(new T.PlaneGeometry(9,9),new T.MeshBasicMaterial({map:radial([[0,"rgba(34,211,238,.55)"],[.35,"rgba(124,58,237,.35)"],[.7,"rgba(236,72,153,.12)"],[1,"rgba(0,0,0,0)"]],512),transparent:true,blending:ADD,depthWrite:false}));
  pool.rotation.x=-Math.PI/2; pool.position.y=.01; S.add(pool);
  const ring=new T.Group(); S.add(ring); ring.position.y=.02;
  const rpts=[]; for(let i=0;i<120;i++){ const a=i/120*Math.PI*2, r1=3.25, r2=i%10?3.12:2.95; rpts.push(new T.Vector3(Math.cos(a)*r1,0,Math.sin(a)*r1),new T.Vector3(Math.cos(a)*r2,0,Math.sin(a)*r2)); }
  ring.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(rpts),new T.LineBasicMaterial({color:0x22D3EE,transparent:true,opacity:.7,blending:ADD})));
  const pulses=[0,1,2].map(i=>{ const m=new T.Mesh(new T.RingGeometry(1,1.04,128),new T.MeshBasicMaterial({color:[0x22D3EE,0xA855F7,0xF472B6][i],transparent:true,opacity:0,blending:ADD,side:T.DoubleSide,depthWrite:false})); m.rotation.x=-Math.PI/2; m.position.y=.015; S.add(m); return m; });

  /* orbiting light trails */
  const trails=[[3.4,.35,0x22D3EE,.5],[3.8,-.25,0xF472B6,-.38],[3.6,.9,0xFBBF24,.3]].map(([r,tilt,c,sp])=>{
    const tex=(()=>{ const cc=document.createElement("canvas"); cc.width=512; cc.height=4; const x=cc.getContext("2d"), lg=x.createLinearGradient(0,0,512,0); lg.addColorStop(0,"rgba(255,255,255,0)"); lg.addColorStop(.7,"rgba(255,255,255,.35)"); lg.addColorStop(1,"rgba(255,255,255,1)"); x.fillStyle=lg; x.fillRect(0,0,512,4); return new T.CanvasTexture(cc); })();
    const m=new T.Mesh(new T.TorusGeometry(r,.012,6,256,Math.PI*1.2),new T.MeshBasicMaterial({color:c,map:tex,transparent:true,opacity:.75,blending:ADD,depthWrite:false}));
    const gph=new T.Group(); gph.add(m); gph.rotation.x=Math.PI/2+tilt; gph.position.y=1; S.add(gph); return {gph,m,sp}; });

  /* the part */
  const part=new T.Group(); S.add(part);
  const metal=new T.MeshStandardMaterial({color:0xEEF1FA,metalness:.9,roughness:.18,envMapIntensity:2.1,transparent:true,opacity:1});
  const sh=new T.Shape(); sh.absarc(0,0,2,0,Math.PI*2,false);
  const hb=new T.Path(); hb.absarc(0,0,.55,0,Math.PI*2,true); sh.holes.push(hb);
  const BH=[]; for(let i=0;i<6;i++){ const a=i/6*Math.PI*2+Math.PI/6, h=new T.Path(); BH.push([Math.cos(a)*1.45,Math.sin(a)*1.45]); h.absarc(BH[i][0],BH[i][1],.19,0,Math.PI*2,true); sh.holes.push(h); }
  const fg=new T.ExtrudeGeometry(sh,{depth:.3,bevelEnabled:true,bevelThickness:.045,bevelSize:.045,bevelSegments:4,curveSegments:128}); fg.rotateX(-Math.PI/2); fg.translate(0,.045,0);
  const flange=new T.Mesh(fg,metal); part.add(flange);
  const hub=new T.Group(); part.add(hub);
  const prof=[[.55,.38],[1.02,.38],[1.02,1.22],[.94,1.32],[.62,1.32],[.55,1.25],[.55,.38]].map(([x,y])=>new T.Vector2(x,y));
  const hm=new T.Mesh(new T.LatheGeometry(prof,160),metal); hub.add(hm);
  const band=new T.Mesh(new T.TorusGeometry(1.03,.022,12,160),new T.MeshBasicMaterial({color:0x22D3EE,transparent:true,blending:ADD})); band.rotation.x=Math.PI/2; band.position.y=.8; hub.add(band);
  /* hologram wire-frame that flickers over the metal */
  const holoM=new T.LineBasicMaterial({color:0x67E8F9,transparent:true,opacity:.3,blending:ADD,depthWrite:false});
  part.add(new T.LineSegments(new T.EdgesGeometry(fg,25),holoM)); hub.add(new T.LineSegments(new T.EdgesGeometry(hm.geometry,25),holoM));

  /* digital fusion: thousands of coloured particles that assemble into the part and dissolve out of it */
  const NP=still?1:4200, home=new Float32Array(NP*3), from=new Float32Array(NP*3), cur=new Float32Array(NP*3), col=new Float32Array(NP*3), seed=new Float32Array(NP);
  const palette=[new T.Color(0x22D3EE),new T.Color(0x818CF8),new T.Color(0xC084FC),new T.Color(0xF472B6),new T.Color(0xFBBF24)];
  function surf(){ const r=Math.random();
    if(r<.42){ let x,z; do{ const a=Math.random()*Math.PI*2, rr=Math.sqrt(.3+Math.random()*(4-.3)); x=Math.cos(a)*rr; z=Math.sin(a)*rr; }while(BH.some(([bx,by])=>Math.hypot(x-bx,z+by)<.2)); return [x,Math.random()<.5?.39:.0,z]; }
    if(r<.6){ const a=Math.random()*Math.PI*2; return [Math.cos(a)*2.04,Math.random()*.39,Math.sin(a)*2.04]; }
    if(r<.85){ const a=Math.random()*Math.PI*2; return [Math.cos(a)*1.02,.38+Math.random()*.9,Math.sin(a)*1.02]; }
    const a=Math.random()*Math.PI*2, rr=.6+Math.random()*.36; return [Math.cos(a)*rr,1.32,Math.sin(a)*rr]; }
  for(let i=0;i<NP;i++){ const [x,y,z]=surf(); home.set([x,y,z],i*3);
    const a=Math.random()*Math.PI*2, e=(Math.random()-.3)*Math.PI*.6, d=5+Math.random()*6; from.set([Math.cos(a)*Math.cos(e)*d,1+Math.sin(e)*d*.8+Math.random()*2,Math.sin(a)*Math.cos(e)*d],i*3);
    const c=palette[Math.floor((y/1.4*.6+Math.random()*.4)*palette.length)%palette.length]; col.set([c.r,c.g,c.b],i*3); seed[i]=Math.random(); }
  const fgeo=new T.BufferGeometry(); fgeo.setAttribute("position",new T.BufferAttribute(cur,3)); fgeo.setAttribute("color",new T.BufferAttribute(col,3));
  const dotTex=radial([[0,"rgba(255,255,255,1)"],[.25,"rgba(255,255,255,.8)"],[1,"rgba(255,255,255,0)"]],64);
  const fusM=new T.PointsMaterial({size:.13,map:dotTex,vertexColors:true,transparent:true,opacity:0,blending:ADD,depthWrite:false,fog:false,toneMapped:false});
  const fusion=new T.Points(fgeo,fusM); part.add(fusion);

  /* rising data streams + floating colour dust */
  const ND=700, dp=new Float32Array(ND*3), dc=new Float32Array(ND*3);
  for(let i=0;i<ND;i++){ const col0=Math.floor(Math.random()*40), a=col0/40*Math.PI*2, r=4.4+(col0%3)*.5; dp.set([Math.cos(a)*r,Math.random()*6,Math.sin(a)*r],i*3); const c=palette[col0%palette.length]; dc.set([c.r,c.g,c.b],i*3); }
  const dgeo=new T.BufferGeometry(); dgeo.setAttribute("position",new T.BufferAttribute(dp,3)); dgeo.setAttribute("color",new T.BufferAttribute(dc,3));
  const data=new T.Points(dgeo,new T.PointsMaterial({size:.06,map:dotTex,vertexColors:true,transparent:true,opacity:.75,blending:ADD,depthWrite:false})); S.add(data);

  /* balloons + dimension labels (HD canvas sprites) */
  const aniso=R.capabilities.getMaxAnisotropy();
  function spriteTex(draw,w,h){ const c=document.createElement("canvas"); c.width=w; c.height=h; draw(c.getContext("2d"),w,h); const t=new T.CanvasTexture(c); t.encoding=T.sRGBEncoding; t.anisotropy=aniso; return t; }
  const FONT="'Barlow Condensed','Arial Narrow',Arial,sans-serif";
  function balloon(n){ const t=spriteTex((x,w,h)=>{ const cx=w/2, r=w*.34;
      x.shadowColor="rgba(236,72,153,.9)"; x.shadowBlur=w*.12; x.beginPath(); x.arc(cx,cx,r,0,Math.PI*2); x.fillStyle="rgba(255,255,255,.96)"; x.fill();
      const lg=x.createLinearGradient(0,0,w,h); lg.addColorStop(0,"#22D3EE"); lg.addColorStop(.5,"#A855F7"); lg.addColorStop(1,"#F43F5E");
      x.shadowBlur=w*.08; x.lineWidth=w*.06; x.strokeStyle=lg; x.stroke(); x.shadowColor="transparent";
      x.fillStyle=lg; x.font=`700 ${w*.4}px ${FONT}`; x.textAlign="center"; x.textBaseline="middle"; x.fillText(String(n),cx,cx+w*.02); },256,256);
    const s=new T.Sprite(new T.SpriteMaterial({map:t,transparent:true,depthTest:false,depthWrite:false,fog:false,toneMapped:false})); s.renderOrder=10; return s; }
  function label(txt){ const t=spriteTex((x,w,h)=>{ x.font=`600 60px ${FONT}`; const tw=x.measureText(txt).width+60, x0=(w-tw)/2;
      x.shadowColor="rgba(34,211,238,.8)"; x.shadowBlur=22; x.fillStyle="rgba(12,10,40,.82)"; x.beginPath(); if(x.roundRect) x.roundRect(x0,24,tw,80,40); else x.rect(x0,24,tw,80); x.fill();
      x.shadowBlur=0; x.lineWidth=3; const lg=x.createLinearGradient(x0,0,x0+tw,0); lg.addColorStop(0,"#22D3EE"); lg.addColorStop(1,"#E879F9"); x.strokeStyle=lg; x.stroke();
      x.fillStyle="#E0F7FF"; x.textAlign="center"; x.textBaseline="middle"; x.fillText(txt,w/2,65); },640,128);
    const s=new T.Sprite(new T.SpriteMaterial({map:t,transparent:true,depthTest:false,depthWrite:false,fog:false,toneMapped:false})); s.renderOrder=9; s.scale.set(1.6,.32,1); return s; }
  const BAL=[[1,[2.0,.2,0],[3.0,.95,.5],part],[2,[0,.9,1.02],[.2,2.25,1.9],hub],[3,[.55,1.32,0],[-.9,2.55,.2],hub],
    [4,[Math.cos(Math.PI/6)*1.45,.4,-Math.sin(Math.PI/6)*1.45],[2.0,1.6,-1.8],part],[5,[-1.2,.39,1.1],[-1.7,.25,2.9],part],[6,[.98,1.3,0],[1.9,2.25,-.3],hub]];
  const leadCols=[0x22D3EE,0x818CF8,0xC084FC,0xF472B6,0xFB7185,0xFBBF24];
  const balloons=BAL.map(([n,a,p,par],i)=>{ const s=balloon(n); s.position.set(...p); s.scale.set(.001,.001,1); par.add(s);
    const lm=new T.LineBasicMaterial({color:leadCols[i],transparent:true,opacity:0,depthTest:false,blending:ADD,fog:false,toneMapped:false}); const l=new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(...a),new T.Vector3(...p)]),lm); l.renderOrder=8; par.add(l);
    const dot=new T.Sprite(new T.SpriteMaterial({map:dotTex,color:leadCols[i],transparent:true,opacity:0,depthTest:false,blending:ADD,fog:false,toneMapped:false})); dot.position.set(...a); dot.scale.set(.22,.22,1); dot.renderOrder=8; par.add(dot);
    return {s,lm,dot}; });
  const dimMat=new T.LineBasicMaterial({color:0x67E8F9,transparent:true,opacity:0,blending:ADD,fog:false,toneMapped:false});
  const dims=new T.Group(); part.add(dims);
  function seg(pts){ dims.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(pts.map(p=>new T.Vector3(...p))),dimMat)); }
  seg([[-2,.42,0],[-2,-.02,0],[2,.42,0],[2,-.02,0]]); seg([[-2,.06,0],[2,.06,0]]); seg([[-2.55,0,0],[-2.55,1.32,0],[-1.02,1.32,0],[-2.7,1.32,0]]);
  const cone=new T.ConeGeometry(.045,.16,16), coneM=new T.MeshBasicMaterial({color:0x67E8F9,transparent:true,opacity:0,blending:ADD,fog:false,toneMapped:false});
  [[[-1.92,.06,0],-Math.PI/2],[[1.92,.06,0],Math.PI/2],[[-2.55,.08,0],Math.PI],[[-2.55,1.24,0],0]].forEach(([p,r])=>{ const c=new T.Mesh(cone,coneM); c.position.set(...p); c.rotation.z=r; dims.add(c); });
  const L1=label("Ø200 ±0.1"); L1.position.set(0,-.02,.35); dims.add(L1);
  const L2=label("65"); L2.scale.set(.9,.3,1); L2.position.set(-3.05,.66,0); dims.add(L2);
  const L3=label("Ø55 H7"); L3.position.set(-.1,1.85,-.9); hub.add(L3);
  const labels=[L1,L2,L3];

  /* AI scan: colour-cycling ring + light sheet */
  const scanM=new T.MeshBasicMaterial({color:0x22D3EE,transparent:true,opacity:0,side:T.DoubleSide,blending:ADD,depthWrite:false});
  const scan=new T.Mesh(new T.RingGeometry(2.25,2.36,160),scanM); scan.rotation.x=-Math.PI/2; S.add(scan);
  const sheetM=new T.MeshBasicMaterial({map:radial([[0,"rgba(255,255,255,0)"],[.6,"rgba(168,85,247,.25)"],[.88,"rgba(34,211,238,.6)"],[1,"rgba(0,0,0,0)"]],256),transparent:true,opacity:0,blending:ADD,depthWrite:false,side:T.DoubleSide});
  const sheet=new T.Mesh(new T.PlaneGeometry(5.4,5.4),sheetM); sheet.rotation.x=-Math.PI/2; S.add(sheet);

  /* framing + pointer parallax */
  const look=new T.Vector3(0,.2,0); let px=0,py=0,tx=0,ty=0;
  host.addEventListener("pointermove",e=>{ const r=host.getBoundingClientRect(); tx=(e.clientX-r.left)/r.width-.5; ty=(e.clientY-r.top)/r.height-.5; });
  function size(){ const w=host.clientWidth||1, h=host.clientHeight||1; R.setSize(w,h,false); cam.aspect=w/h; cam.updateProjectionMatrix(); }
  size(); const ro=new ResizeObserver(size); ro.observe(host);

  const ease=t=>t<0?0:t>1?1:t*t*(3-2*t), win=(t,a,b,c,d)=>ease((t-a)/(b-a))*(1-ease((t-c)/(d-c)));
  const tmpC=new T.Color();
  const LOOP=20; let t0=performance.now(), last=t0, rot=.6;
  function frame(now){
    if(!host.isConnected){ ro.disconnect(); R.dispose(); return; }
    const dt=Math.min(.05,(now-last)/1000), sec=(now-t0)/1000; last=now;
    const t=typeof window.__lgFreeze==="number"?window.__lgFreeze:still?.6:(sec%LOOP)/LOOP;
    if(!still) rot+=dt*.14; part.rotation.y=rot; ring.rotation.y=-rot*.4;
    px+=(tx-px)*.04; py+=(ty-py)*.04;
    const dist=Math.max(12,3.75/(Math.tan(cam.fov*Math.PI/360)*cam.aspect)), ang=.62+px*.35;
    look.y=cam.aspect<1.1?.75:.3; cam.position.set(Math.sin(ang)*dist, dist*.4-py*1.2, Math.cos(ang)*dist); cam.lookAt(look);

    /* fusion: assemble 0–.16, solid fades in .1–.2, dissolve .88–1 */
    const inA=ease(t/.16), out=ease((t-.88)/.12), solid=win(t,.1,.2,.87,.95);
    metal.opacity=solid; flange.visible=hm.visible=solid>.01; metal.depthWrite=solid>.9;
    fusM.opacity=still?0:Math.max(1-ease((t-.14)/.1),out);
    if(fusM.opacity>.01){ for(let i=0;i<NP;i++){ const k=i*3, sd=seed[i], p=out>0?Math.max(0,1-ease((out-sd*.3)/.7)):ease((inA-sd*.25)/.75), w=Math.sin((sec+sd*6)*2)*.02;
        cur[k]=from[k]+(home[k]-from[k])*p+w; cur[k+1]=from[k+1]+(home[k+1]-from[k+1])*p; cur[k+2]=from[k+2]+(home[k+2]-from[k+2])*p-w; }
      fgeo.attributes.position.needsUpdate=true; }
    holoM.opacity=.18+.55*win(t,.06,.14,.2,.3)+.35*win(t,.86,.9,.95,1)+(Math.random()<.03?.25:0);
    hub.position.y=.55*win(t,.5,.6,.78,.86);
    /* scan */
    const sc=win(t,.2,.25,.4,.45), sy=.05+1.45*ease((t-.21)/.22);
    scan.position.y=sy; sheet.position.y=sy; scanM.opacity=.95*sc; sheetM.opacity=.9*sc;
    tmpC.setHSL((sec*.08)%1,.9,.6); scanM.color.copy(tmpC); band.material.color.setHSL((sec*.05+.5)%1,.9,.6);
    /* dimensions + balloons */
    const dv=win(t,.26,.34,.86,.92); dimMat.opacity=.9*dv; coneM.opacity=.9*dv; labels.forEach(l=>l.material.opacity=dv);
    balloons.forEach((b,i)=>{ const v=win(t,.36+i*.045,.42+i*.045,.85,.91), pop=v<1?v*(1+.3*Math.sin(v*Math.PI)):1; b.s.scale.set(.48*pop+.001,.48*pop+.001,1); b.s.material.opacity=v; b.lm.opacity=v; b.dot.material.opacity=v*(.7+.3*Math.sin(sec*4+i)); });
    /* ambience */
    orbs.forEach((o,i)=>{ const a=sec*.35+o.ph; o.l.position.set(Math.cos(a)*3.4,1.4+Math.sin(sec*.5+i)*.9,Math.sin(a)*3.4); o.halo.position.copy(o.l.position); });
    trails.forEach(tr=>{ tr.m.rotation.z=sec*tr.sp; });
    pulses.forEach((m,i)=>{ const k=((sec*.22)+i/3)%1; m.scale.setScalar(1+k*4.5); m.material.opacity=(1-k)*.55; });
    if(!still){ for(let i=0;i<ND;i++){ dp[i*3+1]+=dt*(.35+(i%7)*.08); if(dp[i*3+1]>6) dp[i*3+1]=0; } dgeo.attributes.position.needsUpdate=true; }
    R.render(S,cam);
    if(!still) requestAnimationFrame(frame);
  }
  requestAnimationFrame(now=>{ frame(now); host.classList.add("ready"); });
}
/* company logo on the sign-in card – comes from Admin → Company.
   Order: ?c=<workspace id> in the link → this device's last workspace → the logo the owner chose for the sign-in page */
function paintBrand(b){ const el=$("lgCo"); if(!el) return;
  const nm=b&&b.name?`<div>${esc(b.name)}<small>Inspection workspace</small></div>`:`<div>${esc(APP)}<small>Inspection workspace</small></div>`;
  el.innerHTML = b&&b.logo ? `<img class="lg-logo" src="${b.logo}" alt="${esc(b.name||"")} logo">${b.name?nm:""}` : `<div class="lg-logo-fallback">1</div>${nm}`; }
async function showLoginBrand(){
  const qc=new URLSearchParams(location.search).get("c");
  const cached=lastBrand(); if(!qc&&cached&&cached.logo){ paintBrand(cached); }
  try{ const {data}=await sb.rpc("bi_public_brand",qc&&/^[0-9a-f-]{36}$/i.test(qc)?{p_org:qc}:{});
    const r=Array.isArray(data)?data[0]:data;
    if(r&&(r.logo||r.name)){ if(qc||!(cached&&cached.logo)) paintBrand(r); return; } }catch(e){}
  if(!(cached&&cached.logo)) paintBrand(cached);
}
function loginScreen(msg){
  loginShell(`<h2 id="lgTitle">Welcome back</h2>
  <p class="lg-sub">Sign in with the e-mail and password your company admin gave you.</p>
  <label class="lg-f"><span>E-mail</span><div class="lg-in">${ICON_MAIL}<input id="clEmail" type="email" autocomplete="username" placeholder="name@company.com"></div></label>
  <label class="lg-f"><span>Password</span><div class="lg-in">${ICON_LOCK}<input id="clPass" type="password" autocomplete="current-password" placeholder="Your password"></div></label>
  <div class="cl-err" id="clErr" role="alert">${esc(msg||"")}</div>
  <button class="lg-btn" id="clIn">Sign in</button>
  <div class="lg-links"><button id="clForgot" type="button">Forgot password?</button><span>No account? Ask your company admin.</span></div>`);
  const em=$("clEmail"), pw=$("clPass"), err=$("clErr"), go=$("clIn"); eyeify(pw);
  go.onclick = async()=>{ err.className="cl-err"; err.textContent="";
    if(!em.value.trim()||!pw.value){ err.textContent="Enter your e-mail and password."; return; }
    go.disabled=true; go.textContent="Signing in…";
    const {error}=await sb.auth.signInWithPassword({email:em.value.trim(),password:pw.value});
    if(error){ err.textContent=nice(error); go.disabled=false; go.textContent="Sign in"; } };
  em.onkeydown = e=>{ if(e.key==="Enter") pw.focus(); };
  pw.onkeydown = e=>{ if(e.key==="Enter") go.click(); };
  $("clForgot").onclick = async()=>{ err.className="cl-err"; if(!em.value.trim()){ err.textContent="Type your e-mail first."; em.focus(); return; }
    const {error}=await sb.auth.resetPasswordForEmail(em.value.trim(),{redirectTo:location.href.split("#")[0]});
    err.className=error?"cl-err":"cl-ok"; err.textContent=error?nice(error):"If that e-mail has an account, a reset link is on its way. You can also ask your company admin to set a new password."; };
  setTimeout(()=>em.focus(),50);
}
function nice(e){ const m=String(e&&e.message||e); if(/Invalid login/i.test(m)) return "Wrong e-mail or password."; if(/Email not confirmed/i.test(m)) return "This account isn't confirmed yet – ask your company admin to set your password."; if(/rate limit/i.test(m)) return "Too many attempts – wait a minute and try again."; if(/Failed to fetch|NetworkError/i.test(m)) return "Can't reach the server – check your internet connection."; return m; }
function newPasswordScreen(){
  loginShell(`<h2 id="lgTitle">Set a new password</h2><p class="lg-sub">Choose a password of at least 8 characters.</p>
  <label class="lg-f"><span>New password</span><div class="lg-in">${ICON_LOCK}<input id="clNp" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div></label>
  <div class="cl-err" id="clErr" role="alert"></div>
  <button class="lg-btn" id="clNpGo">Save password</button>`);
  eyeify($("clNp")); $("clNp").onkeydown=e=>{ if(e.key==="Enter") $("clNpGo").click(); }; setTimeout(()=>$("clNp").focus(),50);
  $("clNpGo").onclick=async()=>{ const v=$("clNp").value; if(v.length<8){ $("clErr").textContent="At least 8 characters."; return; }
    const {error}=await sb.auth.updateUser({password:v}); if(error){ $("clErr").textContent=nice(error); return; } closeVeil(); start(); };
}

/* ---------- AI reader (Supabase Edge Function "bi-ai-read") ---------- */
const AIFN = CFG.aiFunction===undefined ? "bi-ai-read" : CFG.aiFunction;
function blobB64(blob){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result).split(",")[1]); r.onerror=rej; r.readAsDataURL(blob); }); }
async function fitForAI(blob){ if(blob.size<=3.5e6) return blob;
  const bmp=await createImageBitmap(blob), c=document.createElement("canvas"); c.width=bmp.width; c.height=bmp.height;
  const g=c.getContext("2d"); g.fillStyle="#fff"; g.fillRect(0,0,c.width,c.height); g.drawImage(bmp,0,0);
  return await new Promise(r=>c.toBlob(r,"image/jpeg",0.88)); }
const aiProvider = { async json(prompt,{images,signal}={}){
  const b=await fitForAI(images[0]), image=await blobB64(b);
  const stop=new Promise((_,rej)=>{ if(!signal) return; if(signal.aborted) rej({code:"cancelled"}); signal.addEventListener("abort",()=>rej({code:"cancelled"}),{once:true}); });
  const {data,error}=await Promise.race([sb.functions.invoke(AIFN,{body:{prompt,image,mediaType:b.type||"image/png"}}),stop]);
  if(error){ let msg=error.message||"", st=error.context&&error.context.status; try{ const j=await error.context.json(); if(j&&j.error) msg=j.error; }catch(e){}
    if(st===429||msg==="rate_limited") throw {code:"rate_limited"};
    if(msg==="invalid_json") throw {code:"invalid_json"};
    if(st===404||/Failed to send|not found/i.test(msg)) throw new Error("the AI reader isn't installed on the server yet (see the setup guide)");
    throw new Error(msg); }
  if(!data||!data.result) throw {code:"invalid_json"};
  return data.result; } };

/* ---------- after sign in ---------- */
async function start(){
  if(C.starting) return; C.starting=true; try{ await start0(); } finally{ C.starting=false; }
}
async function start0(){
  const {data:{user}} = await sb.auth.getUser(); C.user=user; if(!user){ loginScreen(); return; }
  const email=(user.email||"").toLowerCase();
  const [{data:mem,error:e1},{data:pa}] = await Promise.all([
    sb.from("bi_members").select("org_id,role,bi_orgs(id,name,logo,settings)").eq("email",email),
    sb.from("bi_platform_admins").select("user_id").eq("user_id",user.id)]);
  if(e1){ loginScreen("Couldn't reach the database: "+e1.message+". Has supabase/schema.sql been run?"); return; }
  C.platform = !!(pa&&pa.length);
  C.memberships = (mem||[]).filter(m=>m.bi_orgs).map(m=>({role:m.role,...m.bi_orgs}));
  if(!C.memberships.length && !C.platform){
    veil(`<h2>No workspace yet</h2><p class="sub">You're signed in as <b>${esc(email)}</b>, but no company workspace has added this e-mail. Ask your company admin to add you under Admin → Users, then sign in again.</p>
    <button class="btn" id="clOut2">Sign out</button>`); $("clOut2").onclick=signOut; return; }
  closeVeil();
  const sel=$("clOrg"); sel.innerHTML=C.memberships.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join("");
  sel.hidden=C.memberships.length<2; sel.onchange=()=>chooseOrg(sel.value);
  const last=localStorage.getItem("bi_org"); const pick=C.memberships.find(m=>m.id===last)||C.memberships[0];
  if(pick) chooseOrg(pick.id); else { C.org=null; C.role=null; brand(); applyRole(); openAdmin("companies"); }
}
function chooseOrg(id){
  if(C.dirty && !confirm("You have unsaved changes. Switch workspace anyway?")){ $("clOrg").value=C.org.id; return; }
  const m=C.memberships.find(x=>x.id===id); C.org=m; C.role=m.role; try{localStorage.setItem("bi_org",id);}catch(e){}
  $("clOrg").value=id; brand(); applyRole(); resetReport(); applyOrgDefaults();
}
function applyOrgDefaults(){ const s=(C.org&&C.org.settings)||{};
  if(s.gen){ BI.S.set.gen=s.gen; $("sGen").value=s.gen; } if(s.grid){ BI.S.set.grid=s.grid; $("sGrid").value=s.grid; }
  if(s.cols){ BI.S.set.cols=+s.cols; $("sCols").value=s.cols; } if(s.rows){ BI.S.set.rows=+s.rows; $("sRows").value=s.rows; } }
function applyRole(){
  $("clRole").textContent = C.role ? C.role : (C.platform?"owner":"");
  $("clAdmin").hidden = !(C.role==="admin"||C.platform);
  BI.setReadonly(C.role==="viewer"); updateSaveBtn();
  if(AIFN && BI.useAI) BI.useAI((C.role==="admin"||C.role==="editor") ? aiProvider : null);
}
function resetReport(){ C.reportId=null; C.filePath=null; C.dirty=false; updateSaveBtn(); }
async function signOut(){ if(C.dirty&&!confirm("You have unsaved changes. Sign out anyway?")) return; await sb.auth.signOut(); location.reload(); }
$("clOut").onclick=signOut;

/* ---------- save / open reports ---------- */
async function saveReport(){
  if(!C.org||!BI.S.sheets.length) return;
  const snap=BI.getSnapshot(), h=snap.header;
  const row={org_id:C.org.id,title:h.partName||h.partNo||snap.fileName,part_no:h.partNo,rev:h.rev,drawing_no:h.drawingNo,customer:h.customer,data:snap,file_name:BI.S.originalFile?BI.S.originalFile.name:null};
  BI.busy("Saving to the cloud");
  try{
    if(!C.reportId){ const {data,error}=await sb.from("bi_reports").insert(row).select("id").single(); if(error) throw error; C.reportId=data.id; }
    else { const {error}=await sb.from("bi_reports").update(row).eq("id",C.reportId); if(error) throw error; }
    if(!C.filePath && BI.S.originalFile){
      const path=`${C.org.id}/${C.reportId}/${BI.S.originalFile.name.replace(/[^\w.\-]+/g,"_")}`;
      const {error}=await sb.storage.from("bi-drawings").upload(path,BI.S.originalFile,{upsert:true});
      if(error) throw error; C.filePath=path; await sb.from("bi_reports").update({file_path:path}).eq("id",C.reportId);
    }
    C.dirty=false; updateSaveBtn(); BI.toast("Saved. Everyone in "+C.org.name+" can open this report from Reports.");
  }catch(e){ BI.toast("Couldn't save: "+(e.message||e),8000); }
  finally{ BI.busy(null); }
}
$("clSave").onclick=saveReport;
document.addEventListener("keydown",e=>{ if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){ e.preventDefault(); if(!$("clSave").hidden) saveReport(); } });

async function openReports(){
  if(!C.org){ BI.toast("Choose or create a company workspace first."); return; }
  veil(`<div class="cl-row" style="justify-content:space-between"><h2>Reports – ${esc(C.org.name)}</h2><button class="btn" id="clX">Close</button></div>
  <div class="cl-row" style="margin:12px 0"><input id="clQ" placeholder="Search part no, drawing, customer…" style="flex:1;min-width:200px">${C.role!=="viewer"?`<button class="btn primary" id="clNew">New report</button>`:""}</div>
  <div class="cl-list" id="clRl"><div class="emptytable">Loading…</div></div>`, true);
  $("clX").onclick=closeVeil; if($("clNew")) $("clNew").onclick=()=>{ if(C.dirty&&!confirm("Discard unsaved changes?")) return; closeVeil(); resetReport(); $("file").click(); };
  const {data,error}=await sb.from("bi_reports").select("id,title,part_no,rev,drawing_no,customer,status,updated_at,file_path,file_name").eq("org_id",C.org.id).order("updated_at",{ascending:false}).limit(500);
  if(error){ $("clRl").innerHTML=`<div class="emptytable">${esc(error.message)}</div>`; return; }
  const render=q=>{ const rows=(data||[]).filter(r=>!q||JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
    $("clRl").innerHTML=rows.length?`<table><thead><tr><th>Part no</th><th>Title</th><th>Rev</th><th>Drawing</th><th>Customer</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr data-open="${r.id}"><td><b>${esc(r.part_no||"—")}</b></td><td>${esc(r.title||"")}</td><td>${esc(r.rev||"")}</td><td>${esc(r.drawing_no||"")}</td><td>${esc(r.customer||"")}</td><td>${esc(r.status)}</td><td>${new Date(r.updated_at).toLocaleString()}</td><td>${C.role==="admin"?`<button class="del" data-del="${r.id}" title="Delete report">×</button>`:""}</td></tr>`).join("")}</tbody></table>`:`<div class="emptytable">No reports yet. Open a drawing, balloon it, then press Save.</div>`; };
  render(""); $("clQ").oninput=e=>render(e.target.value);
  $("clRl").onclick=async e=>{ const d=e.target.closest("[data-del]"); if(d){ e.stopPropagation(); const r=data.find(x=>x.id===d.dataset.del);
      if(!confirm(`Delete report ${r.part_no||r.title||""} for everyone? This can't be undone.`)) return;
      if(r.file_path) await sb.storage.from("bi-drawings").remove([r.file_path]);
      const {error}=await sb.from("bi_reports").delete().eq("id",r.id); if(error){ BI.toast(error.message); return; }
      data.splice(data.indexOf(r),1); render($("clQ").value); if(C.reportId===r.id) resetReport(); return; }
    const tr=e.target.closest("tr[data-open]"); if(tr) openReport(tr.dataset.open); };
}
$("clReports").onclick=openReports;
async function openReport(id){
  if(C.dirty&&!confirm("Discard unsaved changes?")) return;
  closeVeil(); BI.busy("Opening report");
  try{
    const {data:r,error}=await sb.from("bi_reports").select("*").eq("id",id).single(); if(error) throw error;
    if(!r.file_path) throw new Error("this report has no drawing file stored");
    const {data:blob,error:e2}=await sb.storage.from("bi-drawings").download(r.file_path); if(e2) throw e2;
    const file=new File([blob],r.file_name||r.file_path.split("/").pop(),{type:blob.type});
    C.loading=true; await BI.loadFile(file,{restore:r.data}); C.loading=false;
    C.reportId=r.id; C.filePath=r.file_path; C.dirty=false; updateSaveBtn();
    BI.toast(`Opened ${r.part_no||r.title||"report"}.`);
  }catch(e){ C.loading=false; BI.toast("Couldn't open the report: "+(e.message||e),8000); }
  finally{ BI.busy(null); }
}
/* a newly opened local file starts a new (unsaved) report */
$("file").addEventListener("change",()=>{ C.reportId=null; C.filePath=null; setTimeout(()=>{ C.dirty=true; updateSaveBtn(); },300); },true);

/* ---------- admin: company, users, workspaces, guide ---------- */
$("clAdmin").onclick=()=>openAdmin(C.role==="admin"?"company":"companies");
async function openAdmin(tab){
  if(!(C.role==="admin"||C.platform)){ BI.toast("Only company admins can open Admin."); return; }
  const tabs=[]; if(C.role==="admin") tabs.push(["company","Company"],["users","Users"]); if(C.platform) tabs.push(["companies","Customer workspaces"],["guide","Setup guide"]);
  const o=C.org;
  veil(`<div class="cl-row" style="justify-content:space-between"><div class="ad-head">${o&&o.logo?`<img class="ad-logo" id="adLogo" src="${o.logo}" alt="${esc(o.name)} logo">`:`<div class="mark" id="adLogo" style="width:44px;height:44px;font-size:22px">1</div>`}
    <div><h2>Admin</h2><small>${o?esc(o.name)+" · ":""}${C.role==="admin"?"Company admin":"Platform owner"}</small></div></div><button class="btn" id="clX">Close</button></div>
  <div class="cl-tabs" role="tablist">${tabs.map(t=>`<button role="tab" data-t="${t[0]}" aria-selected="${t[0]===tab}">${t[1]}</button>`).join("")}</div><div id="clPane"></div>`, true);
  $("clX").onclick=closeVeil;
  document.querySelectorAll(".cl-tabs [data-t]").forEach(b=>b.onclick=()=>{ document.querySelectorAll(".cl-tabs [data-t]").forEach(x=>x.setAttribute("aria-selected",x===b)); pane(b.dataset.t); });
  pane(tab);
}
async function pane(t){
  const P=$("clPane");
  if(t==="company"){ const o=C.org, s=o.settings||{};
    P.innerHTML=`<div class="cl-row" style="gap:16px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:1;min-width:260px"><label>Company name<input id="coName" value="${esc(o.name)}"></label>
      <label>Company logo (PNG/JPG – also used as the browser tab icon and on printed reports)<input id="coLogo" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"></label>
      <div class="cl-row"><img class="cl-logo" id="coPrev" src="${o.logo||""}" alt="" ${o.logo?"":"hidden"}><button class="btn" id="coRm" ${o.logo?"":"hidden"}>Remove logo</button></div>
      ${C.platform?`<label style="flex-direction:row;align-items:center;gap:8px;margin-top:12px;color:var(--ink)"><input type="checkbox" id="coLb" ${s.login_brand?"checked":""} style="width:18px;height:18px"> Show this logo on the sign-in page for everyone</label>`:""}
      <label style="margin-top:10px">Sign-in link that always shows this company's logo
        <div class="cl-row" style="flex-wrap:nowrap"><input id="coLink" readonly value="${esc(location.origin+location.pathname+"?c="+o.id)}" style="flex:1;min-width:0"><button class="btn" id="coCopy" type="button">Copy</button></div></label></div>
      <div style="flex:1;min-width:260px"><label>Default general tolerance<select id="coGen">${["none","f","m","c"].map(v=>`<option value="${v}"${(s.gen||"m")===v?" selected":""}>${v==="none"?"Don't apply":"ISO 2768-"+v}</option>`).join("")}</select></label>
      <label>Default grid zone style<select id="coGrid"><option value="iso"${s.grid!=="asme"?" selected":""}>Numbers left→right, letters top→down</option><option value="asme"${s.grid==="asme"?" selected":""}>Numbers right→left, letters bottom→up</option></select></label>
      <div class="cl-row"><label style="flex:1">Grid columns<input id="coCols" type="number" min="1" max="24" value="${s.cols||8}"></label><label style="flex:1">Grid rows<input id="coRows" type="number" min="1" max="20" value="${s.rows||6}"></label></div></div></div>
      <div class="cl-err" id="coErr"></div><button class="btn primary" id="coSave">Save company settings</button>`;
    let logo=o.logo||null;
    $("coLogo").onchange=async e=>{ const f=e.target.files[0]; if(!f) return; logo=await shrinkLogo(f); $("coPrev").src=logo; $("coPrev").hidden=false; $("coRm").hidden=false; };
    $("coRm").onclick=()=>{ logo=null; $("coPrev").hidden=true; $("coRm").hidden=true; };
    $("coCopy").onclick=async()=>{ try{ await navigator.clipboard.writeText($("coLink").value); BI.toast("Link copied."); }catch(e){ $("coLink").select(); } };
    $("coSave").onclick=async()=>{ const upd={name:$("coName").value.trim()||o.name,logo,settings:{...(o.settings||{}),gen:$("coGen").value,grid:$("coGrid").value,cols:+$("coCols").value||8,rows:+$("coRows").value||6}};
      if($("coLb")) upd.settings.login_brand=$("coLb").checked;
      const {error}=await sb.from("bi_orgs").update(upd).eq("id",o.id); if(error){ $("coErr").textContent=error.message; return; }
      Object.assign(o,upd); const m=C.memberships.find(x=>x.id===o.id); if(m) Object.assign(m,upd);
      $("clOrg").querySelector(`option[value="${o.id}"]`).textContent=o.name; brand(); applyOrgDefaults(); $("coErr").className="cl-ok"; $("coErr").textContent="Saved.";
      const h=$("adLogo"); if(h){ h.outerHTML=o.logo?`<img class="ad-logo" id="adLogo" src="${o.logo}" alt="">`:`<div class="mark" id="adLogo" style="width:44px;height:44px;font-size:22px">1</div>`; }
      const sm=document.querySelector(".ad-head small"); if(sm) sm.textContent=o.name+" · Company admin"; };
  }
  if(t==="users"){
    P.innerHTML=`<p class="sub">Add a person with their e-mail, role and a starting password, then give them the page link and the password – they can sign in straight away. Use <b>Set password</b> whenever someone forgets theirs.<br><b>Admin</b>: everything incl. users &amp; company settings · <b>Editor</b>: create and edit reports · <b>Viewer</b>: open, print and export only.</p>
    <div class="cl-row" style="margin-bottom:8px;align-items:stretch"><input id="uEmail" type="email" placeholder="name@company.com" autocomplete="off" style="flex:1.3;min-width:200px">
      <select id="uRole"><option value="editor">Editor</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select>
      <div style="flex:1;min-width:190px">${pwField("uPass","Starting password (8+)")}</div>
      <button class="btn" id="uGen" title="Suggest a strong password">Suggest</button><button class="btn primary" id="uAdd">Add user</button></div>
    <div class="cl-err" id="uErr"></div><div id="uPwBox"></div><div class="cl-list" id="uList"><div class="emptytable">Loading…</div></div>`;
    eyeify($("uPass"));
    $("uGen").onclick=()=>{ $("uPass").value=suggestPw(); $("uPass").type="text"; const b=$("uPass").nextElementSibling; if(b&&b.getAttribute("aria-pressed")==="false") b.click(); };
    const me=(C.user.email||"").toLowerCase(), link=location.href.split("#")[0];
    const save=(email,role,pass)=>sb.rpc("bi_admin_save_user",{p_org:C.org.id,p_email:email,p_role:role,p_password:pass});
    const load=async()=>{ const {data,error}=await sb.from("bi_members").select("email,role,created_at").eq("org_id",C.org.id).order("email");
      if(error){ $("uList").innerHTML=`<div class="emptytable">${esc(error.message)}</div>`; return; }
      $("uList").innerHTML=`<table><thead><tr><th>E-mail</th><th>Role</th><th>Added</th><th></th><th></th></tr></thead><tbody>${data.map(u=>`<tr><td>${esc(u.email)}${u.email===me?" <small style='color:var(--muted)'>(you)</small>":""}</td><td><select data-role="${esc(u.email)}">${["admin","editor","viewer"].map(r=>`<option${r===u.role?" selected":""}>${r}</option>`).join("")}</select></td><td>${new Date(u.created_at).toLocaleDateString()}</td><td><button class="btn small" data-pw="${esc(u.email)}">Set password</button></td><td><button class="del" data-rm="${esc(u.email)}" title="Remove ${esc(u.email)}">×</button></td></tr>`).join("")}</tbody></table>`; };
    $("uAdd").onclick=async()=>{ const err=$("uErr"); err.className="cl-err"; err.textContent="";
      const email=$("uEmail").value.trim().toLowerCase(), pass=$("uPass").value;
      if(!/^\S+@\S+\.\S+$/.test(email)){ err.textContent="Enter a valid e-mail."; return; }
      if(pass&&pass.length<8){ err.textContent="The password needs at least 8 characters."; return; }
      $("uAdd").disabled=true; const {error}=await save(email,$("uRole").value,pass||null); $("uAdd").disabled=false;
      if(error){ err.textContent=/Set a password/i.test(error.message)?"This person has no account yet – enter a starting password.":rpcMsg(error); return; }
      err.className="cl-ok"; err.innerHTML=`Added <b>${esc(email)}</b>. Send them: ${esc(link)} — e-mail: ${esc(email)}${pass?` — password: <b>${esc(pass)}</b>`:" (they keep their existing password)"}`;
      $("uEmail").value=""; $("uPass").value=""; load(); };
    $("uList").onchange=async e=>{ const s=e.target.closest("[data-role]"); if(!s) return;
      const {error}=await save(s.dataset.role,s.value,null); if(error){ BI.toast(rpcMsg(error),7000); load(); } else BI.toast("Role updated."); };
    $("uList").onclick=async e=>{
      const p=e.target.closest("[data-pw]");
      if(p){ const email=p.dataset.pw;
        $("uPwBox").innerHTML=`<div class="cl-pwbox"><div style="margin-bottom:8px">New password for <b>${esc(email)}</b></div><div class="cl-row" style="align-items:stretch"><div style="flex:1;min-width:200px">${pwField("uNp","At least 8 characters")}</div><button class="btn" id="uNpGen">Suggest</button><button class="btn primary" id="uNpSave">Save password</button><button class="btn" id="uNpX">Cancel</button></div><div class="cl-err" id="uNpErr"></div></div>`;
        eyeify($("uNp")); $("uNp").focus();
        $("uNpGen").onclick=()=>{ $("uNp").value=suggestPw(); const b=$("uNp").nextElementSibling; if($("uNp").type==="password"&&b) b.click(); };
        $("uNpX").onclick=()=>{ $("uPwBox").innerHTML=""; };
        $("uNpSave").onclick=async()=>{ const v=$("uNp").value, er=$("uNpErr"); er.className="cl-err"; if(v.length<8){ er.textContent="At least 8 characters."; return; }
          const {error}=await save(email,null,v); if(error){ er.textContent=rpcMsg(error); return; }
          er.className="cl-ok"; er.innerHTML=`Password saved. ${email===me?"Use it next time you sign in.":`Give ${esc(email)} the new password: <b>${esc(v)}</b>`}`; };
        return; }
      const b=e.target.closest("[data-rm]"); if(!b) return; if(b.dataset.rm===me&&!confirm("Remove yourself? You'll lose access to this workspace.")) return;
      if(!confirm("Remove "+b.dataset.rm+" from "+C.org.name+"?")) return; const {error}=await sb.from("bi_members").delete().eq("org_id",C.org.id).eq("email",b.dataset.rm); if(error) BI.toast(error.message); load(); };
    load();
  }
  if(t==="companies"){
    P.innerHTML=`<p class="sub">Each customer company gets its own private workspace: its own users, logo and reports. Nobody sees another company's data.</p>
    <div class="cl-row" style="margin-bottom:12px"><input id="nName" placeholder="Company name" style="flex:1;min-width:180px"><input id="nAdmin" type="email" placeholder="Their admin's e-mail" style="flex:1;min-width:200px"><div style="flex:1;min-width:190px">${pwField("nPass","Admin password (8+)")}</div><button class="btn primary" id="nGo">Create workspace</button></div>
    <p class="sub" style="margin:-4px 0 10px;font-size:13px">Leave the password empty if that person already has an account.</p>
    <div class="cl-err" id="nErr"></div><div class="cl-list" id="nList"><div class="emptytable">Loading…</div></div>`;
    const load=async()=>{ const {data,error}=await sb.from("bi_orgs").select("id,name,created_at").order("name"); if(error){ $("nList").innerHTML=`<div class="emptytable">${esc(error.message)}</div>`; return; }
      const {data:mem}=await sb.from("bi_members").select("org_id,email,role").eq("role","admin");
      $("nList").innerHTML=data.length?`<table><thead><tr><th>Company</th><th>Admins</th><th>Created</th><th></th></tr></thead><tbody>${data.map(o=>`<tr><td><b>${esc(o.name)}</b></td><td>${esc((mem||[]).filter(m=>m.org_id===o.id).map(m=>m.email).join(", "))}</td><td>${new Date(o.created_at).toLocaleDateString()}</td><td><button class="btn" data-join="${o.id}">Add me as admin</button></td></tr>`).join("")}</tbody></table>`:`<div class="emptytable">No workspaces yet.</div>`; };
    eyeify($("nPass"));
    $("nGo").onclick=async()=>{ const name=$("nName").value.trim(), email=$("nAdmin").value.trim().toLowerCase(), pass=$("nPass").value; $("nErr").className="cl-err"; $("nErr").textContent="";
      if(!name||!/^\S+@\S+\.\S+$/.test(email)){ $("nErr").textContent="Enter the company name and a valid admin e-mail."; return; }
      if(pass&&pass.length<8){ $("nErr").textContent="The password needs at least 8 characters."; return; }
      const {data,error}=await sb.from("bi_orgs").insert({name,settings:{gen:"m",grid:"iso",cols:8,rows:6}}).select("id").single(); if(error){ $("nErr").textContent=error.message; return; }
      const {error:e2}=await sb.rpc("bi_admin_save_user",{p_org:data.id,p_email:email,p_role:"admin",p_password:pass||null});
      if(e2){ $("nErr").textContent=/Set a password/i.test(e2.message)?"Workspace created, but "+email+" has no account yet – enter a password and use Users → Add in that workspace, or create it again.":rpcMsg(e2); load(); return; }
      $("nErr").className="cl-ok"; $("nErr").innerHTML=`Workspace created. Send ${esc(email)}: ${esc(location.href.split("#")[0])}${pass?` — password: <b>${esc(pass)}</b>`:" (they sign in with their existing password)"}`; $("nName").value=""; $("nAdmin").value=""; $("nPass").value=""; load(); };
    $("nList").onclick=async e=>{ const b=e.target.closest("[data-join]"); if(!b) return; const {error}=await sb.from("bi_members").upsert({org_id:b.dataset.join,email:(C.user.email||"").toLowerCase(),role:"admin"}); if(error){ BI.toast(error.message); return; } closeVeil(); start(); };
    load();
  }
  if(t==="guide"){ P.innerHTML=`<div class="cl-guide">${GUIDE}</div>`; }
}
function shrinkLogo(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>{ const im=new Image(); im.onload=()=>{ const k=Math.min(1,256/Math.max(im.width,im.height)), c=document.createElement("canvas"); c.width=Math.round(im.width*k); c.height=Math.round(im.height*k); c.getContext("2d").drawImage(im,0,0,c.width,c.height); res(c.toDataURL("image/png")); }; im.onerror=rej; im.src=r.result; }; r.onerror=rej; r.readAsDataURL(f); }); }

const GUIDE = `
<p>This tool runs from a web page plus a free Supabase database. The same files serve every customer: each customer company is a separate <b>workspace</b> with its own users, logo and reports.</p>
<h3>A. Add a new customer on the shared site (2 minutes)</h3>
<ol><li>Admin → <b>Customer workspaces</b> → company name, their admin's e-mail and a starting password → <b>Create workspace</b>.</li>
<li>Send them the page link, the e-mail and the password. They sign in straight away – no confirmation e-mail.</li>
<li>Their admin uploads their logo (Admin → Company) and adds their own people with passwords (Admin → Users).</li></ol>
<h3>AI reading of photos and scans</h3>
<p>Needs the <code>bi-ai-read</code> Edge Function and an AI key in Supabase (see UPGRADE-V2-GUIDE). Without it, photos and scans are read by the free text scanner instead.</p>
<h3>B. Give a customer their own private copy (own database, own domain)</h3>
<ol><li>They create a free Supabase project and run <code>supabase/schema.sql</code> in its SQL Editor.</li>
<li>Copy the project URL and the <i>anon public</i> key (Project Settings → API) into <code>balloon/config.js</code>.</li>
<li>Upload <code>balloon.html</code> and the <code>balloon</code> folder to any web host (their website, Vercel, Netlify – all free).</li>
<li>In Supabase → Authentication → URL Configuration, set the Site URL to their page address.</li>
<li>Run <code>supabase/upgrade-v2.sql</code> too, create the owner account in Supabase → Authentication → Users → Add user (auto-confirm), then run the last SQL lines in schema.sql to make that e-mail the owner; create their workspace under Admin.</li></ol>
<h3>Free-plan limits to keep in mind</h3>
<p>Supabase free: 500 MB database, 1 GB file storage (roughly 300–1,000 drawings), projects pause after 7 days without use – open the page once a week or upgrade when a customer relies on it daily.</p>`;

/* ---------- boot ---------- */
sb.auth.onAuthStateChange((ev)=>{ if(ev==="PASSWORD_RECOVERY") newPasswordScreen(); else if(ev==="SIGNED_IN"&&!C.user) setTimeout(start,0); else if(ev==="SIGNED_OUT"){ C.user=null; loginScreen(); } });
window.addEventListener("beforeunload",e=>{ if(C.dirty){ e.preventDefault(); e.returnValue=""; } });
(async()=>{ const {data:{session}}=await sb.auth.getSession(); if(!session) loginScreen(); else start(); })();
})();

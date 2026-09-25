/* Balloon Inspector – core app (drawing reader, balloons, table, PDF). Shared by every deployment; do not put customer data here. */
"use strict";
/* ---------- state ---------- */
const S = {
  sheets: [], cur: 0, items: [], sel: null, mode: "pan", nextId: 1,
  header: { partNo:"", partName:"", drawingNo:"", rev:"", customer:"", material:"", inspector:"", date:new Date().toISOString().slice(0,10) },
  set: { gen:"m", grid:"iso", cols:8, rows:6, size:1, tiles:4 },
  view: { scale:1, ox:0, oy:0 },
  fileName: ""
};
let sample = null, imgLimits = null, downloads = null, aiCtl = null;
const $ = id => document.getElementById(id);
const cv = $("cv"), ctx = cv.getContext("2d");

/* ---------- helpers ---------- */
function toast(msg, ms = 4200){ const t=$("toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove("show"),ms); }
function busy(msg, stoppable){ const b=$("busy"); if(!msg){b.classList.remove("show");return;} $("busyMsg").textContent=msg; $("busyStop").hidden=!stoppable; b.classList.add("show"); }
const num = v => (v===""||v==null||isNaN(+v)) ? null : +v;
const fmt = v => v==null ? "" : (Math.round(v*10000)/10000).toString();
const fmtTol = v => v==null ? "" : (v>0?"+":"") + fmt(v);
const GDT = {"⌖":"Position","⊥":"Perpendicularity","∥":"Parallelism","⏥":"Flatness","○":"Circularity","⌭":"Cylindricity","⌒":"Profile of a line","⌓":"Profile of a surface","↗":"Circular runout","⌰":"Total runout","◎":"Concentricity","⌯":"Symmetry","∠":"Angularity","Ⓜ":"(M)","Ⓛ":"(L)","Ⓢ":"(S)","Ⓕ":"(F)","Ⓟ":"(P)"};
const TYPES = ["Linear","Diameter","Radius","Angle","Chamfer","Thread","GD&T","Surface finish","Material","Note"];

function r0(){ const s=S.sheets[S.cur]; return s ? Math.max(s.w,s.h)*0.0105*S.set.size : 10; }
function rFor(sh){ return Math.max(sh.w,sh.h)*0.0105*S.set.size; }

/* ---------- tolerance + parsing ---------- */
const ISO2768 = { lim:[3,6,30,120,400,1000,2000,4000], f:[.05,.05,.1,.15,.2,.3,.5,null], m:[.1,.1,.2,.3,.5,.8,1.2,2], c:[.2,.3,.5,.8,1.2,2,3,4] };
function genTol(n){
  if(S.set.gen==="none"||n==null) return null; const a=Math.abs(n); if(a<0.5) return null;
  const i=ISO2768.lim.findIndex(l=>a<=l); if(i<0) return null; return ISO2768[S.set.gen][i];
}
function applyGen(it){
  if(!["Linear","Diameter","Radius","Chamfer"].includes(it.type)) { if(it.gen){it.upper=it.lower=null;it.gen=false;} return; }
  if(it.gen || (it.upper==null && it.lower==null)){
    const t=genTol(it.nominal);
    if(t!=null){ it.upper=t; it.lower=-t; it.gen=true; } else if(it.gen){ it.upper=it.lower=null; it.gen=false; }
  }
}
function parseCallout(t){
  const o={}; if(!t) return o; const s=String(t).replace(/%%c/gi,"Ø").replace(/%%p/gi,"±").replace(/%%d/gi,"°").replace(/⌀/g,"Ø").replace(/−/g,"-").replace(/,(\d)/g,".$1");
  if(/\bM\d/.test(s)) o.type="Thread"; else if(/\bR[az](?=\s*\d|\b)|√\s*\d|^\s*N\d{1,2}\s*$/i.test(s)) o.type="Surface finish";
  else if(/Ø/.test(s)) o.type="Diameter"; else if(/(^|\s)R\s?\d/.test(s)) o.type="Radius";
  else if(/\d\s*[x×X]\s*45\s*°/.test(s)) o.type="Chamfer"; else if(/°/.test(s)) o.type="Angle";
  const m=s.replace(/^\s*\d+\s*[xX×]\s+/,"").replace(/^[^\d]*?(HEX|A\/F|AF|E|MIN|MAX|=|:|\s)+/i,"").match(/-?\d+(\.\d+)?/); if(m) o.nominal=+m[0];
  let pm=s.match(/±\s*(\d+(\.\d+)?)/); if(pm){o.upper=+pm[1];o.lower=-pm[1];}
  const st=s.match(/([+-]\s*\d*\.?\d+)\s*[\/^ ]\s*([+-]?\s*\d*\.?\d+)/);
  if(!pm&&st){ const a=+st[1].replace(/\s/g,""), b=+st[2].replace(/\s/g,""); o.upper=Math.max(a,b); o.lower=Math.min(a,b); }
  if(/\bMIN\b/i.test(s)&&o.upper==null){ o.lower=0; o.upper=null; }
  if(/\bMAX\b/i.test(s)&&o.upper==null){ o.upper=0; o.lower=null; }
  if(/\bHEX\b|A\/F|\bAF\b/i.test(s)&&!o.type) o.type="Linear";
  if(/^\s*N\d{1,2}\s*$/.test(s)){ o.type="Surface finish"; }
  if(o.type==="Surface finish"){ const NG={1:0.025,2:0.05,3:0.1,4:0.2,5:0.4,6:0.8,7:1.6,8:3.2,9:6.3,10:12.5,11:25,12:50};
    const ra=s.match(/(?:R[az]|√)\s*(\d+(\.\d+)?)/i), ng=s.match(/^\s*N(\d{1,2})\s*$/);
    if(ra){o.nominal=null;o.upper=+ra[1];o.lower=0;} else if(ng&&NG[+ng[1]]){o.nominal=null;o.upper=NG[+ng[1]];o.lower=0;} }
  return o;
}
function limits(it){
  if(it.upper==null&&it.lower==null) return [null,null];
  const base=it.nominal??0; return [it.lower!=null?base+it.lower:null, it.upper!=null?base+it.upper:null];
}
function result(it){
  const a=String(it.actual??"").trim(); if(!a) return "pend";
  if(/^(ok|pass|yes|accept(ed)?)$/i.test(a)) return "pass"; if(/^(ng|nok|not ok|fail|no|reject(ed)?)$/i.test(a)) return "fail";
  const v=num(a); if(v==null) return "pend"; const [l,u]=limits(it); if(l==null&&u==null) return "pend";
  return ((l==null||v>=l-1e-9)&&(u==null||v<=u+1e-9))?"pass":"fail";
}
function instrument(it){
  const band=(it.upper!=null&&it.lower!=null)?Math.abs(it.upper-it.lower):null, g=(it.gdt||"").toLowerCase();
  switch(it.type){
    case "Thread": return "Thread plug/ring gauge";
    case "Surface finish": return "Surface roughness tester";
    case "Note": return "Visual / certificate";
    case "Material": return "Material test certificate (MTC)";
    case "Radius": return band!=null&&band<0.1?"CMM / profile projector":"Radius gauge";
    case "Angle": return band!=null&&band<1?"CMM":"Bevel protractor";
    case "Chamfer": return "Profile projector";
    case "GD&T":
      if(/runout/.test(g)) return "Dial indicator + V-block";
      if(/flat/.test(g)) return "Surface plate + dial indicator";
      if(/circular/.test(g)) return "Roundness tester";
      return "CMM";
  }
  if(band==null) return "Vernier caliper";
  if(band<=0.02) return "CMM";
  if(band<=0.06) return it.type==="Diameter"?"Micrometer / bore gauge":"Micrometer";
  if(band<=0.3) return "Digital vernier caliper";
  return "Vernier caliper";
}
function zone(it){
  const sh=S.sheets[it.sheet]; if(!sh) return "";
  const c=Math.min(S.set.cols-1,Math.max(0,Math.floor(it.ax/sh.w*S.set.cols)));
  const r=Math.min(S.set.rows-1,Math.max(0,Math.floor(it.ay/sh.h*S.set.rows)));
  const letters="ABCDEFGHJKLMNPRSTUVWXYZ";
  return S.set.grid==="iso" ? letters[r]+(c+1) : letters[S.set.rows-1-r]+(S.set.cols-c);
}

/* ---------- items ---------- */
function newItem(sheet, ax, ay, data={}){
  const sh=S.sheets[sheet], r=rFor(sh);
  let bx=ax-r*2.4, by=ay-r*2.4; if(bx<r*1.3) bx=ax+r*2.4; if(by<r*1.3) by=ay+r*2.4;
  const it=Object.assign({id:S.nextId++, sheet, ax, ay, bx, by, type:"Linear", text:"", nominal:null, upper:null, lower:null, unit:"mm", gdt:"", datum:"", cls:"", actual:"", conf:null, gen:false, instr:""}, data);
  applyGen(it); if(!it.instr) it.instr=instrument(it); return it;
}
function renumber(){
  const rows=S.set.rows*2;
  S.items.sort((a,b)=>{ if(a.sheet!==b.sheet) return a.sheet-b.sheet; const sh=S.sheets[a.sheet];
    const ra=Math.floor(a.ay/sh.h*rows), rb=Math.floor(b.ay/sh.h*rows); return ra!==rb?ra-rb:a.ax-b.ax; });
  renderAll();
}

/* ---------- viewer ---------- */
function resize(){
  const r=cv.getBoundingClientRect(), d=devicePixelRatio||1;
  cv.width=Math.round(r.width*d); cv.height=Math.round(r.height*d); draw();
}
function fit(){
  const sh=S.sheets[S.cur]; if(!sh) return; const r=cv.getBoundingClientRect();
  const sc=Math.min(r.width/sh.w, r.height/sh.h)*0.95;
  S.view={scale:sc, ox:(r.width-sh.w*sc)/2, oy:(r.height-sh.h*sc)/2}; draw();
}
function zoomAt(f, sx, sy){
  const v=S.view, ns=Math.min(Math.max(v.scale*f, 0.02), 20);
  v.ox=sx-(sx-v.ox)*(ns/v.scale); v.oy=sy-(sy-v.oy)*(ns/v.scale); v.scale=ns; draw();
}
function toSheet(sx,sy){ return [(sx-S.view.ox)/S.view.scale,(sy-S.view.oy)/S.view.scale]; }

function drawBalloon(c, it, no, r, selected){
  const res=result(it), css=getComputedStyle(document.documentElement);
  const red="#C8102E", green="#1E7B4A";
  const stroke = res==="pass"?green:red;
  const dx=it.ax-it.bx, dy=it.ay-it.by, d=Math.hypot(dx,dy);
  c.lineWidth=r*0.13; c.strokeStyle=stroke; c.fillStyle=stroke;
  if(d>r){ c.beginPath(); c.moveTo(it.bx+dx/d*r, it.by+dy/d*r); c.lineTo(it.ax,it.ay); c.stroke();
    c.beginPath(); c.arc(it.ax,it.ay,r*0.18,0,Math.PI*2); c.fill(); }
  if(selected){ c.beginPath(); c.arc(it.bx,it.by,r*1.45,0,Math.PI*2); c.fillStyle="rgba(31,95,191,.22)"; c.fill();
    c.beginPath(); c.arc(it.ax,it.ay,r*0.42,0,Math.PI*2); c.strokeStyle="#1F5FBF"; c.lineWidth=r*0.1; c.stroke(); c.strokeStyle=stroke; c.lineWidth=r*0.13; }
  c.beginPath(); c.arc(it.bx,it.by,r,0,Math.PI*2); c.fillStyle=res==="fail"?red:"#fff"; c.fill(); c.stroke();
  c.fillStyle=res==="fail"?"#fff":stroke; c.textAlign="center"; c.textBaseline="middle";
  const s=String(no); c.font=`700 ${r*(s.length>2?0.8:1.05)}px "Barlow Condensed", Arial, sans-serif`; c.fillText(s, it.bx, it.by+r*0.05);
}
function draw(){
  const d=devicePixelRatio||1, v=S.view; ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,cv.width,cv.height);
  const sh=S.sheets[S.cur]; if(!sh) return;
  ctx.setTransform(d*v.scale,0,0,d*v.scale,d*v.ox,d*v.oy);
  ctx.shadowColor="rgba(0,0,0,.18)"; ctx.shadowBlur=12/v.scale; ctx.fillStyle="#fff"; ctx.fillRect(0,0,sh.w,sh.h); ctx.shadowBlur=0;
  ctx.imageSmoothingQuality="high"; ctx.drawImage(sh.canvas,0,0);
  const r=r0();
  S.items.forEach((it,i)=>{ if(it.sheet===S.cur) drawBalloon(ctx,it,i+1,r,it.id===S.sel); });
}

/* pointer interaction */
const ptrs=new Map(); let drag=null;
cv.addEventListener("pointerdown",e=>{
  if(!S.sheets.length) return; cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId,{x:e.offsetX,y:e.offsetY});
  if(ptrs.size===2){ const [a,b]=[...ptrs.values()]; drag={kind:"pinch", d:Math.hypot(a.x-b.x,a.y-b.y), mx:(a.x+b.x)/2, my:(a.y+b.y)/2}; return; }
  const [x,y]=toSheet(e.offsetX,e.offsetY), r=r0();
  const selIt=S.items.find(i=>i.id===S.sel&&i.sheet===S.cur);
  if(selIt && !S.readonly && Math.hypot(selIt.ax-x,selIt.ay-y)<r*0.9){ drag={kind:"anchor",it:selIt,moved:false}; return; }
  for(let i=S.items.length-1;i>=0;i--){ const it=S.items[i]; if(it.sheet===S.cur && Math.hypot(it.bx-x,it.by-y)<r*1.25){ if(S.readonly){ select(it.id,true); return; } drag={kind:"balloon",it,ox:x-it.bx,oy:y-it.by,moved:false}; select(it.id,true); return; } }
  if(S.mode==="sym"){ setMode("pan"); markFromTap(x,y); return; }
  if(S.readonly){ drag={kind:"pan",sx:e.offsetX,sy:e.offsetY,ox:S.view.ox,oy:S.view.oy,moved:false}; return; }
  if(S.mode==="add"){ const it=newItem(S.cur,x,y,{conf:null,source:"manual"}); S.items.push(it); S.sel=it.id; setMode("pan"); renderAll(); focusRow(it.id); readUnder(it); return; }
  drag={kind:"pan",sx:e.offsetX,sy:e.offsetY,ox:S.view.ox,oy:S.view.oy,moved:false};
});
cv.addEventListener("pointermove",e=>{
  if(!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId,{x:e.offsetX,y:e.offsetY}); if(!drag) return;
  if(drag.kind==="pinch"&&ptrs.size===2){ const [a,b]=[...ptrs.values()], nd=Math.hypot(a.x-b.x,a.y-b.y), mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
    S.view.ox+=mx-drag.mx; S.view.oy+=my-drag.my; zoomAt(nd/drag.d,mx,my); drag.d=nd; drag.mx=mx; drag.my=my; return; }
  const [x,y]=toSheet(e.offsetX,e.offsetY);
  if(drag.kind==="balloon"){ drag.it.bx=x-drag.ox; drag.it.by=y-drag.oy; drag.moved=true; draw(); }
  else if(drag.kind==="anchor"){ drag.it.ax=x; drag.it.ay=y; drag.moved=true; draw(); }
  else if(drag.kind==="pan"){ S.view.ox=drag.ox+e.offsetX-drag.sx; S.view.oy=drag.oy+e.offsetY-drag.sy; if(Math.abs(e.offsetX-drag.sx)+Math.abs(e.offsetY-drag.sy)>4) drag.moved=true; draw(); }
});
function endPtr(e){ ptrs.delete(e.pointerId);
  if(drag&&drag.kind==="anchor"&&drag.moved) renderTable();
  if(drag&&drag.kind==="pan"&&!drag.moved){ S.sel=null; renderTable(); draw(); }
  if(ptrs.size===0) drag=null; else if(drag&&drag.kind==="pinch") drag=null; }
cv.addEventListener("pointerup",endPtr); cv.addEventListener("pointercancel",endPtr);
cv.addEventListener("wheel",e=>{ if(!S.sheets.length) return; e.preventDefault(); zoomAt(Math.exp(-e.deltaY*0.0015),e.offsetX,e.offsetY); },{passive:false});
$("zIn").onclick=()=>{const r=cv.getBoundingClientRect(); zoomAt(1.3,r.width/2,r.height/2);};
$("zOut").onclick=()=>{const r=cv.getBoundingClientRect(); zoomAt(1/1.3,r.width/2,r.height/2);};
$("zFit").onclick=fit;
new ResizeObserver(resize).observe(cv);

function select(id, fromCanvas){
  S.sel=id; const it=S.items.find(i=>i.id===id);
  if(it && it.sheet!==S.cur){ S.cur=it.sheet; renderSheets(); fit(); }
  draw(); renderTable(); if(fromCanvas) focusRow(id);
}
function focusRow(id){ const tr=document.querySelector(`tr[data-id="${id}"]`); tr&&tr.scrollIntoView({block:"nearest",behavior:"smooth"}); }
function centerOn(it){ const r=cv.getBoundingClientRect(); S.view.ox=r.width/2-it.bx*S.view.scale; S.view.oy=r.height/2-it.by*S.view.scale; draw(); }
function setMode(m){ S.mode=m; $("bAdd").classList.toggle("on",m==="add"); $("bSym").classList.toggle("on",m==="sym"); cv.classList.toggle("add",m==="add"||m==="sym");
  if(m==="add") toast("Tap the drawing where the characteristic is."); if(m==="sym") toast("Zoom in and tap one special-characteristic symbol (for example the red ▼)."); }
$("bSym").onclick=()=>setMode(S.mode==="sym"?"pan":"sym");

/* ---------- table ---------- */
function renderStats(){
  const n=S.items.length, p=S.items.filter(i=>result(i)==="pass").length, f=S.items.filter(i=>result(i)==="fail").length;
  const low=S.items.filter(i=>i.conf!=null&&i.conf<0.7).length;
  $("stats").innerHTML=`<span class="stat"><b>${n}</b>characteristics</span><span class="stat p"><b>${p}</b>pass</span><span class="stat f"><b>${f}</b>fail</span><span class="stat"><b>${n-p-f}</b>not measured</span>${low?`<span class="stat" style="color:var(--warn)"><b>${low}</b>to check</span>`:""}${S.items.some(i=>i.cls)?`<span class="stat"><b>${S.items.filter(i=>i.cls).length}</b>SC/CC</span>`:""}${S.lang&&S.lang!=="English"?`<span class="lang" title="Translated with a built-in engineering glossary (offline). Check wording before sending.">${S.lang} → English</span>`:""}`;
}
function esc(s){ return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function renderTable(){
  renderStats();
  const tw=$("tw");
  if(!S.items.length){ tw.innerHTML=`<div class="emptytable">${S.sheets.length?"No balloons yet. Tap “Find dimensions” (free) to read the drawing, or “Add balloon” to place them by hand.":"Open a drawing to start the inspection table."}</div>`; return; }
  const sc=tw.scrollLeft, st=tw.scrollTop;
  const multi=S.sheets.length>1, showEn=S.lang&&S.lang!=="English"&&S.items.some(i=>i.en);
  const cols=[["No.","40px"],[multi?"Sh·Zone":"Zone","56px"],["Type","9%"],["Specification",showEn?"13%":"18%"]].concat(showEn?[["English","12%"]]:[]).concat([["Nominal","6.5%"],["+ Tol","6%"],["− Tol","6%"],["LSL","5.5%"],["USL","5.5%"],["Unit","4.5%"],["Class","4.5%"],["Instrument","11%"],["Actual","7%"],["Result","5.5%"],["Conf.","4.5%"],["","26px"]]);
  let h=`<table><colgroup>${cols.map(c=>`<col style="width:${c[1]}">`).join("")}</colgroup><thead><tr>${cols.map(c=>`<th title="${c[0]}">${c[0]}</th>`).join("")}</tr></thead><tbody>`;
  S.items.forEach((it,i)=>{
    const [l,u]=limits(it), res=result(it), g=it.gen?' class="gen" title="From general tolerance"':"";
    const spec = it.type==="GD&T" ? [it.gdt, it.text, it.datum?("| "+it.datum):""].filter(Boolean).join(" ") : it.text;
    h+=`<tr data-id="${it.id}" class="${it.id===S.sel?"sel ":""}${res}">
      <td><span class="no" data-act="go" title="Show on drawing">${i+1}</span></td>
      <td class="num">${multi?(it.sheet+1)+"·":""}${zone(it)}</td>
      <td><select data-f="type" title="${it.type}">${TYPES.map(t=>`<option${t===it.type?" selected":""}>${t}</option>`).join("")}</select></td>
      <td><input data-f="text" value="${esc(it.type==="GD&T"?spec:it.text)}" title="${esc(spec)}"></td>
      ${showEn?`<td class="en" title="${esc(it.en||"")}">${esc(it.en||"")}</td>`:""}
      <td><input data-f="nominal" value="${fmt(it.nominal)}" inputmode="decimal"></td>
      <td><input data-f="upper" value="${fmtTol(it.upper)}" inputmode="decimal"${g}></td>
      <td><input data-f="lower" value="${fmtTol(it.lower)}" inputmode="decimal"${g}></td>
      <td class="num">${fmt(l)}</td><td class="num">${fmt(u)}</td>
      <td><select data-f="unit"><option${it.unit==="mm"?" selected":""}>mm</option><option${it.unit==="in"?" selected":""}>in</option><option${it.unit==="deg"?" selected":""}>deg</option><option${it.unit==="µm"?" selected":""}>µm</option><option${it.unit==="—"?" selected":""}>—</option></select></td>
      <td><select data-f="cls" style="${it.cls?"font-weight:700;color:var(--accent)":""}"><option value=""${!it.cls?" selected":""}>—</option><option${it.cls==="SC"?" selected":""}>SC</option><option${it.cls==="CC"?" selected":""}>CC</option><option${it.cls==="KC"?" selected":""}>KC</option></select></td>
      <td><input data-f="instr" value="${esc(it.instr)}" title="${esc(it.instr)}"></td>
      <td><input data-f="actual" value="${esc(it.actual)}" placeholder="value/OK"></td>
      <td><span class="res ${res}">${res==="pass"?"PASS":res==="fail"?"FAIL":"—"}</span></td>
      <td><span class="conf${it.conf!=null&&it.conf<0.7?" low":""}">${it.conf==null?(it.source==="cad"?"CAD":"manual"):Math.round(it.conf*100)+"%"}</span></td>
      <td><button class="del" data-act="del" aria-label="Delete balloon ${i+1}">×</button></td></tr>`;
  });
  tw.innerHTML=h+"</tbody></table>"; tw.scrollLeft=sc; tw.scrollTop=st;
  if(S.readonly) tw.querySelectorAll("input,select,.del").forEach(e=>e.disabled=true);
  if(window.BI&&BI.onChange) BI.onChange();
}
$("tw").addEventListener("click",e=>{
  const tr=e.target.closest("tr[data-id]"); if(!tr) return; const id=+tr.dataset.id, act=e.target.closest("[data-act]")?.dataset.act;
  if(act==="del"){ S.items=S.items.filter(i=>i.id!==id); if(S.sel===id) S.sel=null; renderAll(); return; }
  if(act==="go"){ const it=S.items.find(i=>i.id===id); select(id); centerOn(it); return; }
  if(S.sel!==id){ S.sel=id; draw(); document.querySelectorAll("tr.sel").forEach(r=>r.classList.remove("sel")); tr.classList.add("sel"); }
});
$("tw").addEventListener("change",e=>{
  const f=e.target.dataset.f; if(!f) return; const id=+e.target.closest("tr").dataset.id, it=S.items.find(i=>i.id===id); const v=e.target.value;
  if(["nominal","upper","lower"].includes(f)){ it[f]=num(v.replace(/−/g,"-").replace("±","")); if(f!=="nominal") it.gen=false; if(f==="nominal") applyGen(it); }
  else if(f==="text"){ it.text=v; it.en=translate(v,S.lang); if(it.type==="GD&T"){it.gdt="";it.datum="";} }
  else it[f]=v;
  if(f==="type"){ applyGen(it); it.instr=instrument(it); }
  if(["nominal","upper","lower"].includes(f)&&it.autoInstr!==false) it.instr=instrument(it);
  if(f==="instr") it.autoInstr=false;
  renderTable(); draw();
});

/* ---------- sheets ---------- */
function renderSheets(){
  const el=$("sheets"); el.innerHTML="";
  if(S.sheets.length>1) S.sheets.forEach((s,i)=>{ const b=document.createElement("button"); b.textContent="Sheet "+(i+1); b.setAttribute("aria-pressed",i===S.cur); b.onclick=()=>{S.cur=i;renderSheets();fit();}; el.append(b); });
}
function renderAll(){
  const has=S.sheets.length>0; $("empty").hidden=has; $("zoomBar").hidden=!has;
  ["bAdd","bRenum","bPDF","bCSV","bSym"].forEach(id=>$(id).disabled=!has);
  $("bRenum").disabled=!S.items.length; $("bPDF").disabled=!has; $("bCSV").disabled=!S.items.length;
  $("bAI").disabled=!has; $("bAI").style.opacity=(sample&&imgLimits)?"":"0.55";
  $("bText").disabled=!has;
  $("bAI").title=!has?"Open a drawing first":(!sample||!imgLimits)?"AI reading isn't available in this view":"Extract characteristics with AI (uses your Claude plan)";
  renderSheets(); renderTable(); draw();
}

/* ---------- loading files ---------- */
const MAXPX=3200;
function canvasFromImage(img){
  const k=Math.min(1, MAXPX/Math.max(img.naturalWidth,img.naturalHeight));
  const c=document.createElement("canvas"); c.width=Math.round(img.naturalWidth*k); c.height=Math.round(img.naturalHeight*k);
  const x=c.getContext("2d"); x.fillStyle="#fff"; x.fillRect(0,0,c.width,c.height); x.drawImage(img,0,0,c.width,c.height); return c;
}
async function loadFile(file,opts={}){
  const name=file.name, ext=name.split(".").pop().toLowerCase();
  busy("Opening "+name);
  try{
    let sheets=[];
    if(ext==="pdf"||file.type==="application/pdf"){
      if(!window.pdfjsLib) throw new Error("PDF reader didn't load");
      pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
      const n=Math.min(pdf.numPages,20);
      for(let p=1;p<=n;p++){
        busy(`Rendering sheet ${p} of ${n}`);
        const page=await pdf.getPage(p), v1=page.getViewport({scale:1}), sc=MAXPX/Math.max(v1.width,v1.height), vp=page.getViewport({scale:sc});
        const c=document.createElement("canvas"); c.width=Math.round(vp.width); c.height=Math.round(vp.height);
        const x=c.getContext("2d"); x.fillStyle="#fff"; x.fillRect(0,0,c.width,c.height);
        await page.render({canvasContext:x,viewport:vp}).promise;
        let text=[]; try{ const tc=await page.getTextContent(); text=tc.items.filter(i=>i.str&&i.str.trim()).map(i=>{ const m=pdfjsLib.Util.transform(vp.transform,i.transform);
          return {s:i.str.trim(), x:m[4], y:m[5], h:Math.hypot(m[2],m[3])||10, w:(i.width||0)*sc, ang:Math.atan2(m[1],m[0])*180/Math.PI}; }); }catch(e){}
        sheets.push({canvas:c,w:c.width,h:c.height,text});
      }
      if(pdf.numPages>20) toast("Only the first 20 sheets were opened.");
    } else if(ext==="dxf"||ext==="dwg"){
      const txt= ext==="dwg" ? await convertDwg(await file.arrayBuffer()) : await file.text();
      busy("Drawing the sheet"); await tick();
      const res=loadDxf(txt); sheets=[res.sheet]; S._dxfItems=res.items; S._dxfUnit=res.unit;
    } else if(ext==="step"||ext==="stp"){
      const res=await convertStep(await file.arrayBuffer(), name.replace(/\.[^.]+$/,"")); sheets=[res.sheet]; S._dxfItems=res.items;
    } else if(file.type.startsWith("image/")||["png","jpg","jpeg"].includes(ext)){
      const url=URL.createObjectURL(file); const img=new Image(); img.src=url; await img.decode(); sheets=[{canvas:canvasFromImage(img)}]; URL.revokeObjectURL(url);
      sheets[0].w=sheets[0].canvas.width; sheets[0].h=sheets[0].canvas.height;
    } else { throw new Error("Unsupported file type ."+ext); }
    S.sheets=sheets; S.cur=0; S.items=[]; S.sel=null; S.fileName=name.replace(/\.[^.]+$/,""); S.originalFile=file;
    if(opts.restore){ S.cadItems=S._dxfItems||null; S._dxfItems=null; applySnapshot(opts.restore); renderAll(); requestAnimationFrame(()=>{resize();fit();}); return; }
    if(!opts.keepHeader){ S.header=Object.assign({},S.header,{partNo:"",partName:"",drawingNo:"",rev:"",customer:"",material:""}); }
    if(!S.header.drawingNo) S.header.drawingNo=S.fileName; syncHeader();
    S.cadItems=S._dxfItems||null;
    if(S._dxfItems){ S.items=S._dxfItems.map(d=>newItem(0,d.ax,d.ay,Object.assign({},d))); S._dxfItems=null;
      if(S.sheets[0].text&&S.sheets[0].text.length){ readTitleBlock(groupText(S.sheets[0].text),0); postProcess(); S.cadItems=S.items.map(i=>({...i})); }
      renumber();
      toast(ext==="step"||ext==="stp" ? `Converted the 3D model into front, top, left and isometric views with overall sizes. Add balloons for the features you need to inspect.` : `Read ${S.items.length} characteristics directly from the CAD data${ext==="dwg"?" (converted from DWG)":""}. Check them, then export.`,7000); }
    else if(S.sheets.some(s=>s.text&&s.text.length>5)){ const n=findTextItems(); if(n) toast(`Found ${n} characteristics in the PDF text at no cost${S._clsCount?`, ${S._clsCount} marked SC/CC`:""}. Check each row against the drawing.`,7000); else toast("No dimension text found in this PDF. Tap “Find dimensions” to read it with the free text scanner (OCR)."); }
    else toast("Drawing open. Tap “Find dimensions” to scan it for free (OCR), or place balloons with “Add balloon” — each new balloon reads the text under it.",8000);
    renderAll(); requestAnimationFrame(()=>{resize();fit();});
  }catch(err){ console.error(err); toast("Couldn't open this file: "+(err.message||err)); }
  finally{ busy(null); }
}
$("bOpen").onclick=$("bOpen2").onclick=()=>$("file").click();
$("file").onchange=e=>{ const f=e.target.files[0]; if(f) loadFile(f); e.target.value=""; };
const vw=$("viewer");
vw.addEventListener("dragover",e=>{e.preventDefault();vw.classList.add("drag");});
vw.addEventListener("dragleave",()=>vw.classList.remove("drag"));
vw.addEventListener("drop",e=>{e.preventDefault();vw.classList.remove("drag");const f=e.dataTransfer.files[0];if(f)loadFile(f);});

/* ---------- DXF ---------- */
function parseDxf(txt){
  const L=txt.split(/\r?\n/), recs=[]; let sec=null, rec=null, blockName=null; const blocks={}, header={};
  let hv=null;
  for(let i=0;i+1<L.length;i+=2){
    const code=parseInt(L[i].trim(),10), val=L[i+1].replace(/\s+$/,"");
    if(isNaN(code)) continue;
    if(code===0){
      const t=val.trim();
      if(t==="SECTION"){ sec="?"; rec=null; continue; }
      if(t==="ENDSEC"){ sec=null; rec=null; continue; }
      if(t==="EOF") break;
      rec={type:t,g:[]};
      if(sec==="BLOCKS"){ if(t==="BLOCK"){ rec.isBlock=true; } else if(t==="ENDBLK"){ blockName=null; rec=null; continue; } else if(blockName){ blocks[blockName].push(rec); } }
      else if(sec==="ENTITIES"){ recs.push(rec); }
      continue;
    }
    if(sec==="?"&&code===2){ sec=val.trim(); continue; }
    if(sec==="HEADER"){ if(code===9) hv=val.trim(); else if(hv){ (header[hv]=header[hv]||{})[code]=val.trim(); } continue; }
    if(rec){ rec.g.push([code,val]); if(rec.isBlock&&code===2&&!blockName){ blockName=val.trim(); blocks[blockName]=[]; } }
  }
  return {ents:recs, blocks, header};
}
const G=(r,c,d)=>{ const p=r.g.find(x=>x[0]===c); return p?p[1]:d; };
const GN=(r,c,d=0)=>{ const v=parseFloat(G(r,c)); return isNaN(v)?d:v; };
const GA=(r,c)=>r.g.filter(x=>x[0]===c).map(x=>parseFloat(x[1]));
function cleanMtext(s){
  return s.replace(/\\P/g,"\n").replace(/\\S([^;^\/#]*)[\^\/#]([^;]*);/g," $1/$2").replace(/\\[A-Za-z][^;\\{}]*;/g,"").replace(/\\[LlOoKk]/g,"").replace(/[{}]/g,"")
    .replace(/%%c/gi,"Ø").replace(/%%d/gi,"°").replace(/%%p/gi,"±").replace(/%%u|%%o/gi,"").trim();
}
const GDTF={a:"Angularity",b:"Perpendicularity",c:"Flatness",d:"Profile of a surface",e:"Circularity",f:"Parallelism",g:"Cylindricity",h:"Circular runout",i:"Symmetry",j:"Position",k:"Profile of a line",r:"Concentricity",t:"Total runout",n:"Ø",m:"(M)",l:"(L)",s:"(S)"};
function decodeTol(s){
  const parts=s.split(/%%v/i); let gdt="", tol="", datums=[];
  const dec=x=>x.replace(/\{\\Fgdt;([a-z])\}/gi,(m,c)=>"§"+c.toLowerCase()).replace(/[{}]/g,"");
  parts.forEach((p,i)=>{ const d=dec(p);
    if(i===0){ const m=d.match(/§([a-z])/); if(m) gdt=GDTF[m[1]]||""; }
    else if(i===1){ tol=d.replace(/§n/g,"Ø").replace(/§([a-z])/g,(m,c)=>GDTF[c]||"").trim(); }
    else { const t=d.replace(/§([a-z])/g,(m,c)=>GDTF[c]||"").trim(); if(t) datums.push(t); } });
  const n=tol.match(/\d*\.?\d+/);
  return {gdt, text:tol, datum:datums.join(" | "), upper:n?+n[0]:null, lower:n?0:null};
}
function loadDxf(txt){
  const {ents, blocks, header}=parseDxf(txt);
  const ins=+(header.$INSUNITS?.[70]??4), unit=ins===1?"in":"mm";
  // pass 1: bounds
  const B={x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity};
  const mul=(A,Bm)=>[A[0]*Bm[0]+A[2]*Bm[1],A[1]*Bm[0]+A[3]*Bm[1],A[0]*Bm[2]+A[2]*Bm[3],A[1]*Bm[2]+A[3]*Bm[3],A[0]*Bm[4]+A[2]*Bm[5]+A[4],A[1]*Bm[4]+A[3]*Bm[5]+A[5]];
  const ap=(T,x,y)=>[T[0]*x+T[2]*y+T[4],T[1]*x+T[3]*y+T[5]];
  function walk(list, T, depth, out){
    if(depth>6) return;
    for(let k=0;k<list.length;k++){ const e=list[k], t=e.type;
      if(t==="LINE") out.poly([ap(T,GN(e,10),GN(e,20)),ap(T,GN(e,11),GN(e,21))]);
      else if(t==="CIRCLE"||t==="ARC"){ const cx=GN(e,10),cy=GN(e,20),r=GN(e,40); let a0=t==="ARC"?GN(e,50):0, a1=t==="ARC"?GN(e,51):360; if(a1<=a0) a1+=360;
        const n=Math.max(8,Math.ceil((a1-a0)/6)), pts=[]; for(let j=0;j<=n;j++){ const a=(a0+(a1-a0)*j/n)*Math.PI/180; pts.push(ap(T,cx+r*Math.cos(a),cy+r*Math.sin(a))); } out.poly(pts); }
      else if(t==="LWPOLYLINE"){ const xs=GA(e,10), ys=GA(e,20), pts=xs.map((x,j)=>ap(T,x,ys[j])); if((GN(e,70)&1)&&pts.length) pts.push(pts[0]); out.poly(pts); }
      else if(t==="POLYLINE"){ const pts=[]; let j=k+1; for(;j<list.length&&list[j].type==="VERTEX";j++) pts.push(ap(T,GN(list[j],10),GN(list[j],20))); if((GN(e,70)&1)&&pts.length) pts.push(pts[0]); out.poly(pts); k=j; }
      else if(t==="SPLINE"){ const xs=GA(e,11).length?GA(e,11):GA(e,10), ys=GA(e,21).length?GA(e,21):GA(e,20); out.poly(xs.map((x,j)=>ap(T,x,ys[j]))); }
      else if(t==="ELLIPSE"){ const cx=GN(e,10),cy=GN(e,20),mx=GN(e,11),my=GN(e,21),ra=GN(e,40,1); let p0=GN(e,41,0),p1=GN(e,42,Math.PI*2); if(p1<=p0)p1+=Math.PI*2;
        const pts=[]; for(let j=0;j<=48;j++){ const p=p0+(p1-p0)*j/48, c=Math.cos(p), s=Math.sin(p); pts.push(ap(T,cx+mx*c-my*ra*s, cy+my*c+mx*ra*s)); } out.poly(pts); }
      else if(t==="TEXT"||t==="MTEXT"||t==="ATTRIB"){ let s=t==="MTEXT"?cleanMtext(e.g.filter(x=>x[0]===3).map(x=>x[1]).join("")+G(e,1,"")):cleanMtext(G(e,1,""));
        if(!s) continue; const h=GN(e,40,2.5), rot=GN(e,50,0); const p=t==="TEXT"&&GN(e,72)+GN(e,73)>0&&G(e,11)!=null?ap(T,GN(e,11),GN(e,21)):ap(T,GN(e,10),GN(e,20));
        out.text(p,s,h*Math.sqrt(Math.abs(T[0]*T[3]-T[1]*T[2])),rot+Math.atan2(T[1],T[0])*180/Math.PI, t==="MTEXT"?"mtext":"text"); }
      else if(t==="INSERT"){ const b=blocks[G(e,2,"").trim()]; if(!b) continue; const sx=GN(e,41,1),sy=GN(e,42,1),r=GN(e,50,0)*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
        walk(b, mul(T,[c*sx,s*sx,-s*sy,c*sy,GN(e,10),GN(e,20)]), depth+1, out); }
      else if(t==="DIMENSION"){ const b=blocks[G(e,2,"").trim()]; if(b&&b.length) walk(b,T,depth+1,out); else { const s=dimText(e); out.text(ap(T,GN(e,11,GN(e,10)),GN(e,21,GN(e,20))),s,2.5,0,"dim"); } }
      else if(t==="TOLERANCE"){ const p=ap(T,GN(e,10),GN(e,20)); const d=decodeTol(G(e,1,"")); out.text(p,`[${d.gdt} | ${d.text}${d.datum?" | "+d.datum:""}]`,GN(e,40,2.5)||2.5,0,"tol"); }
    }
  }
  walk(ents,[1,0,0,1,0,0],0,{ poly:pts=>pts.forEach(([x,y])=>{if(isFinite(x)&&isFinite(y)){B.x0=Math.min(B.x0,x);B.y0=Math.min(B.y0,y);B.x1=Math.max(B.x1,x);B.y1=Math.max(B.y1,y);}}), text:([x,y])=>{if(isFinite(x)){B.x0=Math.min(B.x0,x);B.y0=Math.min(B.y0,y);B.x1=Math.max(B.x1,x);B.y1=Math.max(B.y1,y);}} });
  if(!isFinite(B.x0)) throw new Error("No drawable entities found in this DXF");
  const dw=B.x1-B.x0||1, dh=B.y1-B.y0||1, k=(MAXPX*0.94)/Math.max(dw,dh), pad=MAXPX*0.03;
  const W=Math.round(dw*k+pad*2), H=Math.round(dh*k+pad*2);
  const X=x=>(x-B.x0)*k+pad, Y=y=>H-((y-B.y0)*k+pad);
  const c=document.createElement("canvas"); c.width=W; c.height=H; const g=c.getContext("2d");
  g.fillStyle="#fff"; g.fillRect(0,0,W,H); g.strokeStyle="#111"; g.fillStyle="#111"; g.lineWidth=Math.max(1.4,W/1800); g.lineJoin="round";
  walk(ents,[1,0,0,1,0,0],0,{
    poly:pts=>{ if(pts.length<2) return; g.beginPath(); pts.forEach(([x,y],i)=>i?g.lineTo(X(x),Y(y)):g.moveTo(X(x),Y(y))); g.stroke(); },
    text:([x,y],s,h,rot,kind)=>{ const px=Math.max(9,h*k); g.save(); g.translate(X(x),Y(y)); g.rotate(-rot*Math.PI/180); g.font=`${px}px Arial, sans-serif`;
      g.textBaseline=kind==="dim"||kind==="tol"?"middle":"alphabetic"; g.textAlign=kind==="dim"||kind==="tol"?"center":"left";
      s.split("\n").forEach((ln,i)=>g.fillText(ln,0,kind==="mtext"?px*(i+0.85):i*px*1.2)); g.restore(); }
  });
  // extract characteristics from CAD data
  const items=[], texts=[]; let lastInsert="";
  for(const e of ents){
    if(e.type==="DIMENSION"){
      const s=dimText(e), dt=GN(e,70)&7, p=parseCallout(s);
      let meas=GN(e,42,NaN); if(dt===2||dt===5) meas=meas*180/Math.PI;
      const type=dt===3?"Diameter":dt===4?"Radius":(dt===2||dt===5)?"Angle":(p.type||"Linear");
      const nominal = p.nominal!=null&&!/<>/.test(G(e,1,"<>")) ? p.nominal : (isNaN(meas)?p.nominal:+meas.toFixed(4));
      const x=GN(e,11,GN(e,10)), y=GN(e,21,GN(e,20));
      items.push({ax:X(x),ay:Y(y),type,text:s,nominal,upper:p.upper??null,lower:p.lower??null,unit:type==="Angle"?"deg":unit,source:"cad"});
    } else if(e.type==="TOLERANCE"){
      const d=decodeTol(G(e,1,"")); items.push({ax:X(GN(e,10)),ay:Y(GN(e,20)),type:"GD&T",gdt:d.gdt,text:d.text,datum:d.datum,nominal:null,upper:d.upper,lower:d.lower,unit,source:"cad"});
    } else if(e.type==="INSERT"){ lastInsert=G(e,2,"");
    } else if(e.type==="ATTRIB"){
      const tag=G(e,2,""), val=cleanMtext(G(e,1,"")); if(!val) continue; const th=GN(e,40,2.5)*k;
      texts.push({s:val,x:X(GN(e,10)),y:Y(GN(e,20)),h:Math.max(9,th),w:val.length*th*0.6});
      if(/ROUGH|SURF|FINISH|\bRA\b|RZ/i.test(tag+" "+lastInsert)||/\bR[az]\s*\d/i.test(val)){
        const sv=/R[az]/i.test(val)?val:"Ra "+val, p=parseCallout(sv);
        items.push({ax:X(GN(e,10)),ay:Y(GN(e,20)),type:"Surface finish",text:sv,nominal:null,upper:p.upper??null,lower:0,unit:"µm",source:"cad"}); }
    } else if(e.type==="TEXT"||e.type==="MTEXT"){
      const s=e.type==="MTEXT"?cleanMtext(e.g.filter(x=>x[0]===3).map(x=>x[1]).join("")+G(e,1,"")):cleanMtext(G(e,1,""));
      const th=GN(e,40,2.5)*k;
      if(s) s.split("\n").forEach((ln,i)=>texts.push({s:ln,x:X(GN(e,10)),y:Y(GN(e,20))+i*th*1.2,h:Math.max(9,th),w:ln.length*th*0.6}));
      if(/^(MATERIAL|MATL|PART\s*NO|REV|DRAWING|DRG|DWG)/i.test(s)) continue;
      const p=parseCallout(s);
      if(/^NOTES?\b/i.test(s)){ items.push({ax:X(GN(e,10)),ay:Y(GN(e,20)),type:"Note",text:s.replace(/^NOTES?\s*:?\s*/i,""),unit:"—",source:"cad"}); }
      else if(p.type==="Surface finish"||p.type==="Thread"||(p.type&&/Ø|R\d|°/.test(s)&&s.length<30)){
        items.push({ax:X(GN(e,10)),ay:Y(GN(e,20)),type:p.type,text:s,nominal:p.nominal??null,upper:p.upper??null,lower:p.lower??null,unit:p.type==="Surface finish"?"µm":p.type==="Angle"?"deg":unit,source:"cad"});
      }
    }
  }
  return {sheet:{canvas:c,w:W,h:H,text:texts,isCad:true}, items, unit};
}
function dimText(e){
  const dt=GN(e,70)&7; let meas=GN(e,42,NaN); if(dt===2||dt===5) meas=meas*180/Math.PI;
  const m=isNaN(meas)?"":(+meas.toFixed(3)).toString(), pre=dt===3?"Ø":dt===4?"R":"", post=(dt===2||dt===5)?"°":"";
  let o=G(e,1,""); if(!o||o==="<>") return pre+m+post; return cleanMtext(o.replace("<>",pre+m+post)).replace(/Ø\s*Ø/g,"Ø").replace(/RR(\d)/g,"R$1");
}


/* ---------- STEP → drawing views ---------- */
/* STEP (occt-import-js result) -> orthographic drawing geometry. Pure JS, no DOM. */
function stepToViews(res){
  // gather + weld vertices
  const P=[], T=[], F=[]; let faceBase=0;
  let bb=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for(const m of res.meshes){
    const pos=m.attributes.position.array, idx=m.index.array;
    for(let i=0;i<pos.length;i+=3){ const x=pos[i],y=pos[i+1],z=pos[i+2]; bb=[Math.min(bb[0],x),Math.min(bb[1],y),Math.min(bb[2],z),Math.max(bb[3],x),Math.max(bb[4],y),Math.max(bb[5],z)]; }
  }
  const diag=Math.hypot(bb[3]-bb[0],bb[4]-bb[1],bb[5]-bb[2])||1, q=diag*1e-5, vmap=new Map();
  for(const m of res.meshes){
    const pos=m.attributes.position.array, idx=m.index.array, remap=new Int32Array(pos.length/3);
    for(let i=0;i<pos.length/3;i++){ const k=Math.round(pos[3*i]/q)+","+Math.round(pos[3*i+1]/q)+","+Math.round(pos[3*i+2]/q);
      let id=vmap.get(k); if(id===undefined){ id=P.length/3; P.push(pos[3*i],pos[3*i+1],pos[3*i+2]); vmap.set(k,id);} remap[i]=id; }
    const faceOf=new Int32Array(idx.length/3).fill(-1);
    (m.brep_faces||[]).forEach((f,fi)=>{ for(let t=f.first;t<=f.last;t++) faceOf[t]=faceBase+fi; });
    for(let t=0;t<idx.length/3;t++){ T.push(remap[idx[3*t]],remap[idx[3*t+1]],remap[idx[3*t+2]]); F.push(faceOf[t]>=0?faceOf[t]:faceBase+100000+t); }
    faceBase+=(m.brep_faces||[]).length+1;
  }
  const nT=T.length/3, N=new Float32Array(nT*3);
  for(let t=0;t<nT;t++){ const a=T[3*t]*3,b=T[3*t+1]*3,c=T[3*t+2]*3;
    const ux=P[b]-P[a],uy=P[b+1]-P[a+1],uz=P[b+2]-P[a+2], vx=P[c]-P[a],vy=P[c+1]-P[a+1],vz=P[c+2]-P[a+2];
    let nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx; const l=Math.hypot(nx,ny,nz)||1; N[3*t]=nx/l;N[3*t+1]=ny/l;N[3*t+2]=nz/l; }
  // edges
  const E=new Map();
  for(let t=0;t<nT;t++) for(let e=0;e<3;e++){ let a=T[3*t+e], b=T[3*t+(e+1)%3]; if(a===b) continue; const k=a<b?a+"_"+b:b+"_"+a;
    let r=E.get(k); if(!r){ r={a:Math.min(a,b),b:Math.max(a,b),t:[]}; E.set(k,r);} r.t.push(t); }
  const hard=[], soft=[];
  for(const r of E.values()){
    if(r.t.length!==2) { hard.push(r); continue; }
    const [t1,t2]=r.t, dot=N[3*t1]*N[3*t2]+N[3*t1+1]*N[3*t2+1]+N[3*t1+2]*N[3*t2+2];
    if(F[t1]!==F[t2] && dot<0.985) hard.push(r);          // real B-rep edge (skip tangent seams)
    else if(F[t1]!==F[t2]) {}                               // tangent face boundary: silhouette only
    else soft.push(r);
    if(F[t1]!==F[t2] && dot>=0.985) soft.push(r);
  }
  const size=[bb[3]-bb[0],bb[4]-bb[1],bb[5]-bb[2]];
  function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
  function norm(a){const l=Math.hypot(...a)||1;return a.map(v=>v/l);}
  function project(d,up,withHidden){
    const f=norm(d.map(v=>-v)), r=norm(cross(f,up)), u=cross(r,f);
    const nV=P.length/3, U=new Float32Array(nV), V=new Float32Array(nV), D=new Float32Array(nV);
    let u0=Infinity,u1=-Infinity,v0=Infinity,v1=-Infinity,d0=Infinity,d1=-Infinity;
    for(let i=0;i<nV;i++){ const x=P[3*i],y=P[3*i+1],z=P[3*i+2]; U[i]=x*r[0]+y*r[1]+z*r[2]; V[i]=x*u[0]+y*u[1]+z*u[2]; D[i]=x*f[0]+y*f[1]+z*f[2];
      if(U[i]<u0)u0=U[i]; if(U[i]>u1)u1=U[i]; if(V[i]<v0)v0=V[i]; if(V[i]>v1)v1=V[i]; if(D[i]<d0)d0=D[i]; if(D[i]>d1)d1=D[i]; }
    const w=u1-u0||1e-6, h=v1-v0||1e-6, R=900, k=R/Math.max(w,h), GW=Math.ceil(w*k)+3, GH=Math.ceil(h*k)+3;
    const Z=new Float32Array(GW*GH).fill(Infinity);
    const gx=i=>(U[i]-u0)*k+1, gy=i=>(v1-V[i])*k+1;
    for(let t=0;t<nT;t++){ const a=T[3*t],b=T[3*t+1],c=T[3*t+2];
      const ax=gx(a),ay=gy(a),bx=gx(b),by=gy(b),cx=gx(c),cy=gy(c);
      const area=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax); if(Math.abs(area)<1e-9) continue;
      const minx=Math.max(0,Math.floor(Math.min(ax,bx,cx))), maxx=Math.min(GW-1,Math.ceil(Math.max(ax,bx,cx)));
      const miny=Math.max(0,Math.floor(Math.min(ay,by,cy))), maxy=Math.min(GH-1,Math.ceil(Math.max(ay,by,cy)));
      for(let py=miny;py<=maxy;py++) for(let px=minx;px<=maxx;px++){
        const X=px+0.5,Y=py+0.5;
        const w0=((bx-X)*(cy-Y)-(by-Y)*(cx-X))/area, w1=((cx-X)*(ay-Y)-(cy-Y)*(ax-X))/area, w2=1-w0-w1;
        if(w0<-1e-4||w1<-1e-4||w2<-1e-4) continue;
        const z=w0*D[a]+w1*D[b]+w2*D[c], o=py*GW+px; if(z<Z[o]) Z[o]=z; }
    }
    const eps=(d1-d0)*0.004+ (1.6/k);
    const zAt=(x,y)=>{ let m=Infinity; const cx=Math.floor(x),cy=Math.floor(y); for(let yy=cy-1;yy<=cy+1;yy++)for(let xx=cx-1;xx<=cx+1;xx++){ if(xx<0||yy<0||xx>=GW||yy>=GH) continue; const v=Z[yy*GW+xx]; if(v<m)m=v; } return m; };
    const vis=[], hid=[];
    const addEdge=(a,b)=>{
      const ax=gx(a),ay=gy(a),bx=gx(b),by=gy(b), len=Math.hypot(bx-ax,by-ay), n=Math.max(2,Math.ceil(len/1.5));
      let runStart=0, runVis=null;
      for(let s=0;s<=n;s++){ const t=s/n, x=ax+(bx-ax)*t, y=ay+(by-ay)*t, d=D[a]+(D[b]-D[a])*t; const v=d<=zAt(x,y)+eps;
        if(runVis===null){runVis=v;runStart=0;}
        else if(v!==runVis||s===n){ const tEnd=(v!==runVis)?(s-0.5)/n:1; const seg=[U[a]+(U[b]-U[a])*runStart,V[a]+(V[b]-V[a])*runStart,U[a]+(U[b]-U[a])*tEnd,V[a]+(V[b]-V[a])*tEnd]; (runVis?vis:hid).push(seg); runStart=tEnd; runVis=v; }
      }
    };
    for(const r of hard) addEdge(r.a,r.b);
    for(const r of soft){ if(r.t.length!==2) continue; const [t1,t2]=r.t; const s1=N[3*t1]*f[0]+N[3*t1+1]*f[1]+N[3*t1+2]*f[2], s2=N[3*t2]*f[0]+N[3*t2+1]*f[1]+N[3*t2+2]*f[2];
      if((s1>1e-6)!==(s2>1e-6)) addEdge(r.a,r.b); }
    return {vis, hid: withHidden?hid:[], u0,u1,v0,v1};
  }
  const views={
    front:project([0,-1,0],[0,0,1],true),
    top:project([0,0,1],[0,1,0],true),
    left:project([-1,0,0],[0,0,1],true),
    iso:project(norm([1,-1,1]),[0,0,1],false)
  };
  return {views,size,triangles:nT};
}

function layoutSheet(res, name){
  const {views:v,size}=res, W=3200, H=2263, M=60, cmds=[], dims=[];
  const L=(x1,y1,x2,y2,w=2.2,dash=null)=>cmds.push({t:"l",x1,y1,x2,y2,w,dash});
  const TX=(x,y,s,sz=26,al="center",b=false)=>cmds.push({t:"x",x,y,s,sz,al,b});
  // border + title block
  L(M,M,W-M,M,4);L(W-M,M,W-M,H-M,4);L(W-M,H-M,M,H-M,4);L(M,H-M,M,M,4);
  const tbW=900,tbH=190,tx=W-M-tbW,ty=H-M-tbH; L(tx,ty,W-M,ty,3);L(tx,ty,tx,H-M,3);L(tx,ty+95,W-M,ty+95,2);L(tx+560,ty,tx+560,H-M,2);
  // view placement (first-angle): front TL, left view right of front, top view below front, iso at right-top
  const fw=v.front.u1-v.front.u0, fh=v.front.v1-v.front.v0, lw=v.left.u1-v.left.u0, th=v.top.v1-v.top.v0;
  const iw=v.iso.u1-v.iso.u0, ih=v.iso.v1-v.iso.v0;
  const gap=240, availW=(W-2*M-gap*3)*0.66, availH=H-2*M-tbH-gap*3;
  const s=Math.min(availW/(fw+lw), availH/(fh+th));
  const fx=M+gap, fy=M+gap+30;               // front top-left
  const lx=fx+fw*s+gap, tyv=fy+fh*s+gap;
  const place=(view,ox,oy,sc,hidden)=>{
    const X=u=>ox+(u-view.u0)*sc, Y=vv=>oy+(view.v1-vv)*sc;
    view.vis.forEach(g=>L(X(g[0]),Y(g[1]),X(g[2]),Y(g[3]),2.4));
    if(hidden) view.hid.forEach(g=>L(X(g[0]),Y(g[1]),X(g[2]),Y(g[3]),1.2,[10,7]));
    return {X,Y};
  };
  place(v.front,fx,fy,s,true); place(v.left,lx,fy,s,true); place(v.top,fx,tyv,s,true);
  const isoRoomW=W-M-gap/2-(lx+lw*s+gap), isoRoomH=ty-M-gap;
  const si=Math.min(isoRoomW/iw, isoRoomH/ih, s*1.2)*0.85, ix=lx+lw*s+gap+(isoRoomW-iw*si)/2, iy=M+gap/2+(isoRoomH-ih*si)/2;
  if(si>0) place(v.iso,ix,iy,si,false);
  TX(fx+fw*s/2,fy+fh*s+60,"FRONT VIEW",26); TX(lx+lw*s/2,fy+fh*s+60,"LEFT VIEW",26); TX(fx+fw*s/2,tyv+th*s+60,"TOP VIEW",26); if(si>0) TX(ix+iw*si/2,iy+ih*si+60,"ISOMETRIC VIEW (REF)",24);
  // overall dimensions
  const fmt=n=>(+n.toFixed(3)).toString(), arrow=(x,y,dx,dy)=>{const a=Math.atan2(dy,dx),l=22;L(x,y,x+l*Math.cos(a+0.35),y+l*Math.sin(a+0.35),2);L(x,y,x+l*Math.cos(a-0.35),y+l*Math.sin(a-0.35),2);};
  const hdim=(x1,x2,y,yref,val,lab)=>{ L(x1,yref-8,x1,y-15,1.4);L(x2,yref-8,x2,y-15,1.4);L(x1,y,x2,y,1.6);arrow(x1,y,1,0);arrow(x2,y,-1,0);TX((x1+x2)/2,y-14,fmt(val),30); dims.push({ax:(x1+x2)/2,ay:y-24,nominal:+val.toFixed(3),label:lab}); };
  const vdim=(y1,y2,x,xref,val,lab)=>{ L(xref-8,y1,x-15,y1,1.4);L(xref-8,y2,x-15,y2,1.4);L(x,y1,x,y2,1.6);arrow(x,y1,0,1);arrow(x,y2,0,-1);cmds.push({t:"x",x:x-14,y:(y1+y2)/2,s:fmt(val),sz:30,al:"center",rot:-90}); dims.push({ax:x-24,ay:(y1+y2)/2,nominal:+val.toFixed(3),label:lab}); };
  hdim(fx,fx+fw*s,fy-70,fy,size[0],"Overall length (X)");
  vdim(fy,fy+fh*s,fx-70,fx,size[2],"Overall height (Z)");
  hdim(lx,lx+lw*s,fy-70,fy,size[1],"Overall width (Y)");
  // title block text
  TX(tx+20,ty+40,"TITLE",18,"left"); TX(tx+20,ty+78,name.toUpperCase().slice(0,32),30,"left",true);
  TX(tx+580,ty+40,"PROJECTION",18,"left"); TX(tx+580,ty+78,"FIRST ANGLE",26,"left",true);
  TX(tx+20,ty+130,"SOURCE",18,"left"); TX(tx+20,ty+168,"CONVERTED FROM STEP 3D MODEL",24,"left");
  TX(tx+580,ty+130,"SCALE / UNITS",18,"left"); TX(tx+580,ty+168,"NTS  /  mm",26,"left",true);
  return {W,H,cmds,dims};
}


/* ---------- free converters (run in the browser) ---------- */
const tick=()=>new Promise(r=>setTimeout(r,30));
let dwgMod=null, occtMod=null;
function convertersAllowed(){ try{ new WebAssembly.Module(Uint8Array.of(0,97,115,109,1,0,0,0)); return (new Function("return 1"))()===1; }catch(e){ return false; } }
const ENGINE_BASE=(window.BI_CONFIG&&window.BI_CONFIG.engineBase)||"balloon/engines/";
const ENGINE_FILES={"wasm-dwg":["libredwg-web.wasm",false,"createLibreDwgModule","libredwg-web.classic.js"],"wasm-step":["occt-import-js.wasm",false,"occtimportjs","occt-import-js.js"],"wasm-ocr":["tesseract-core-lstm.wasm",false,"TesseractCore","tesseract-core-lstm.js"],"ocr-eng":["eng.traineddata.gz",true]};
async function gunzip(u){ const out=new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))); return new Uint8Array(await out.arrayBuffer()); }
async function gunzipEl(id){
  const el=document.getElementById(id), f=ENGINE_FILES[id];
  if(!el){ // hosted version: engine files sit next to the page
    if(f[2]&&typeof window[f[2]]==="undefined") await loadScript(ENGINE_BASE+f[3]);
    const r=await fetch(ENGINE_BASE+f[0]); if(!r.ok) throw new Error("engine file missing: "+ENGINE_BASE+f[0]);
    const u=new Uint8Array(await r.arrayBuffer()); return f[1]?gunzip(u):u; }
  const b64=el.textContent.trim(), bin=atob(b64), u=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
  return gunzip(u);
}
async function convertDwg(buf){
  if(!convertersAllowed()) throw new Error("The DWG converter can't run in this viewer. Free fix: open the file in ODA File Converter or LibreCAD, save as DXF, and open that here.");
  try{
    if(!dwgMod){ busy("Loading the DWG converter (first time only)"); await tick();
      dwgMod=await createLibreDwgModule({wasmBinary:await gunzipEl("wasm-dwg"), locateFile:f=>f, print:()=>{}, printErr:()=>{}}); }
    busy("Converting DWG to DXF"); await tick();
    const M=dwgMod; M.FS.writeFile("in.dwg",new Uint8Array(buf));
    const code=M.dwg_write_dxf("in.dwg","out.dxf");
    const has=M.FS.analyzePath("out.dxf",false).exists; const txt=has?M.FS.readFile("out.dxf",{encoding:"utf8"}):"";
    try{M.FS.unlink("in.dwg");}catch(e){} try{M.FS.unlink("out.dxf");}catch(e){}
    if(!txt||txt.length<100) throw new Error("the converter couldn't read this DWG (code "+code+")");
    return txt;
  }catch(e){
    const mem=/memory|RangeError|allocation/i.test(String(e&&e.message||e));
    throw new Error(mem?"DWG conversion needs about 1 GB of free memory, which this device or browser didn't allow. Try a desktop browser, or save as DXF with the free ODA File Converter or LibreCAD.":
      (String(e&&e.message||e)+". Free fix: save as DXF with ODA File Converter or LibreCAD."));
  }
}
async function convertStep(buf,name){
  if(!convertersAllowed()) throw new Error("The STEP converter can't run in this viewer. Free fix: open the model in FreeCAD, make a TechDraw page, and export it as PDF or DXF.");
  if(!occtMod){ busy("Loading the STEP converter (first time only)"); await tick();
    occtMod=await occtimportjs({wasmBinary:await gunzipEl("wasm-step"), locateFile:f=>f, print:()=>{}, printErr:()=>{}}); }
  busy("Reading the 3D model"); await tick();
  const r=occtMod.ReadStepFile(new Uint8Array(buf),{linearUnit:"millimeter",linearDeflectionType:"bounding_box_ratio",linearDeflection:0.002,angularDeflection:0.3});
  if(!r||!r.success||!r.meshes||!r.meshes.length) throw new Error("no solid geometry found in this STEP file");
  busy("Projecting front, top, left and isometric views"); await tick();
  const v=stepToViews(r), lay=layoutSheet(v,name);
  const c=document.createElement("canvas"); c.width=lay.W; c.height=lay.H; const g=c.getContext("2d");
  g.fillStyle="#fff"; g.fillRect(0,0,lay.W,lay.H); g.strokeStyle="#111"; g.fillStyle="#111"; g.lineCap="round";
  for(const k of lay.cmds){
    if(k.t==="l"){ g.lineWidth=k.w; g.strokeStyle=k.dash?"#666":"#111"; g.setLineDash(k.dash||[]); g.beginPath(); g.moveTo(k.x1,k.y1); g.lineTo(k.x2,k.y2); g.stroke(); }
    else { g.setLineDash([]); g.save(); g.translate(k.x,k.y); if(k.rot) g.rotate(k.rot*Math.PI/180); g.font=`${k.b?"bold ":""}${k.sz}px Arial, sans-serif`; g.textAlign=k.al; g.textBaseline="alphabetic"; g.fillText(k.s,0,0); g.restore(); }
  }
  const items=lay.dims.map(d=>({ax:d.ax,ay:d.ay,type:"Linear",text:`${fmt(d.nominal)} (${d.label.toLowerCase()})`,nominal:d.nominal,unit:"mm",source:"cad"}));
  return {sheet:{canvas:c,w:lay.W,h:lay.H}, items};
}

/* ---------- free text reading for vector PDFs ---------- */
const NOTE_RX=/\b(HARDEN|HRC|HRB|HV\d|CASE DEPTH|COAT|PLAT|ZINC|PAINT|BURR|SHARP|FINISH|TREAT|ANODI|PHOSPHAT|PASSIVAT|WELD|TORQUE)\b/i;
function groupH(flat){
  flat=flat.slice().sort((a,b)=>a.y-b.y||a.x-b.x); const groups=[];
  for(const t of flat){
    const small=/^[+\-±]?\s*\d*[.,]?\d+$/.test(t.s.replace(/\s/g,""))&&/^[+\-±0]/.test(t.s.trim());
    const g=groups.find(g=>!(small&&t.h<0.85*g.h) && Math.abs(g.y-t.y)<0.45*Math.max(g.h,t.h) && t.x-(g.x1)<0.9*Math.max(g.h,t.h) && t.x-g.x1>-0.6*t.h);
    if(g){ g.s+=(t.x-g.x1>0.22*t.h?" ":"")+t.s; g.x1=Math.max(g.x1,t.x+t.w); g.h=Math.max(g.h,t.h); }
    else groups.push({s:t.s,x0:t.x,x1:t.x+t.w,y:t.y,h:t.h});
  }
  // limit dimensioning: two stacked numbers (upper limit over lower limit) = ONE characteristic
  const isNum=s=>/^(Ø|⌀|ø)?\s*\d+[.,]\d+$/.test(s.trim());
  for(const a of groups){ if(a.used||!isNum(a.s)) continue;
    const b=groups.find(b=>b!==a&&!b.used&&isNum(b.s)&&Math.abs(b.x0-a.x0)<1.3*a.h&&b.y-a.y>0.6*a.h&&b.y-a.y<2.1*a.h);
    if(!b) continue; const va=+a.s.replace(/[^\d.,]/g,"").replace(",","."), vb=+b.s.replace(/[^\d.,]/g,"").replace(",",".");
    if(!(Math.abs(va-vb)<=Math.max(va,vb)*0.12)) continue;
    let pre=/[Ø⌀ø]/.test(a.s+b.s)?"Ø":"";
    const sym=groups.find(g=>!g.used&&/^[Ø⌀ø]$/.test(g.s.trim())&&a.x0-g.x1<1.6*a.h&&a.x0-g.x1>-0.6*a.h&&g.y>a.y-2.2*a.h&&g.y<b.y+1.5*b.h);
    if(sym){ sym.used=true; pre="Ø"; a.x0=Math.min(a.x0,sym.x0); }
    const hi=Math.max(va,vb), lo=Math.min(va,vb);
    a.s=`${pre}${hi}/${lo}`; a.limits={hi,lo,dia:!!pre}; a.x1=Math.max(a.x1,b.x1); a.y=b.y; a.h=Math.max(a.h,b.h)*1.6; b.used=true;
  }
  // attach stacked / trailing tolerances to the nominal on their left
  const isTol=s=>/^[+\-±]\s*\d*[.,]?\d+$/.test(s.replace(/\s/g,""))||/^0$/.test(s.trim());
  groups.forEach(g=>g.xn=g.x1);
  for(const g of groups.filter(g=>!g.used&&isTol(g.s)).sort((a,b)=>a.y-b.y)){
    let best=null,bd=Infinity;
    for(const n of groups){ if(n===g||n.used||n.limits||isTol(n.s)||!/\d/.test(n.s)) continue;
      const dx=g.x0-n.xn, dy=Math.abs((g.y-g.h/2)-(n.y-n.h/2)); if(dx<-0.5*n.h||dx>2.5*n.h||dy>1.4*n.h) continue; const d=dx+dy; if(d<bd){bd=d;best=n;} }
    if(best){ best.s+=" "+g.s; g.used=true; }
  }
  return groups.filter(g=>!g.used);
}
function groupText(items){
  const buckets=new Map();
  for(const t of items){ const a=Math.round((t.ang||0)/90)*90; const k=((a%360)+360)%360; (buckets.get(k)||buckets.set(k,[]).get(k)).push(t); }
  let out=[];
  for(const [k,list] of buckets){
    if(k===0){ out=out.concat(groupH(list)); continue; }
    const r=k*Math.PI/180, d=[Math.cos(r),Math.sin(r)], n=[-Math.sin(r),Math.cos(r)];
    const loc=list.map(t=>({...t,x:t.x*d[0]+t.y*d[1],y:t.x*n[0]+t.y*n[1]}));
    for(const g of groupH(loc)){
      const P=(u,v)=>[u*d[0]+v*n[0],u*d[1]+v*n[1]], p0=P(g.x0,g.y-g.h*0.35), p1=P(g.x1,g.y-g.h*0.35);
      out.push({...g,rot:true,ax:p0[0],ay:p0[1],x0:Math.min(p0[0],p1[0])-g.h/2,x1:Math.max(p0[0],p1[0])+g.h/2,y:(p0[1]+p1[1])/2+g.h/2});
    }
  }
  return out;
}
const SC_GLYPH=/[▼▽▲△◆◇⬥⬦⯁⯆\uE000-\uF8FF]/g;
function classify(g,sh){
  let s=g.s.replace(/\s+/g," ").trim(), cls="";
  if(SC_GLYPH.test(s)){ SC_GLYPH.lastIndex=0; const t=s.replace(SC_GLYPH,"").trim(); if(t&&/\d/.test(t)){ s=t; cls="SC"; } }
  SC_GLYPH.lastIndex=0; if(!/\d/.test(s)) return null;
  if(g.limits){ const L=g.limits; return {type:L.dia?"Diameter":"Linear",text:s,nominal:L.lo,upper:+(L.hi-L.lo).toFixed(4),lower:0,unit:"mm",conf:0.85,cls}; }
  const r=classify0(g,sh,s); if(r&&cls) r.cls=cls; return r;
}
function classify0(g,sh,s){
  const cx=(g.x0+g.x1)/2, cy=g.y-g.h/2, edge=0.035;
  if(g.grid) return null;  // border grid labels
  if(cx>sh.w*0.62&&cy>sh.h*0.8) return null;                                                     // title block area
  if(/\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|SCALE|SHEET|\d+\s*:\s*\d+|DRG|DWG|REV\b|DATE|WEIGHT|MASS|PART\s*NO|MATERIAL|MATL|GOST|ГОСТ|DIN\s|ISO\s/i.test(s)) return null;
  if(NOTE_RX.test(s)&&s.length<=90) return {type:"Note",text:s.replace(/^\d+[.)]\s*/,""),conf:0.7,unit:"—"};
  if(s.length>42) return null;
  const letters=(s.replace(/THRU|DEEP|TYP\.?|EQ\.?\s?SP\.?|PCD|PCD\.?|CRS|MAX|MIN|HEX|A\/F|ALL ROUND|[A-H][0-9]{1,2}|[a-h][0-9]{1,2}|Ra|Rz|x|X|×|Ø|R|M/g,"").match(/[A-Za-z]/g)||[]).length;
  if(/^\(.*\)$/.test(s)) return null;                                                            // reference dimension
  const p=parseCallout(s);
  if(/\bR[az]\s*\d|√\s*\d|^N\d{1,2}$/i.test(s)) return {type:"Surface finish",text:s,conf:0.85,unit:"µm",...p};
  const pre=(s.match(/^[^\d]*/)||[""])[0];
  if(pre.length>9||!/^\s*(\d+\s*[xX×]\s*)?((HEX|A\/F|AF|E|L|MIN|MAX|PCD)\s*[=:]?\s*)*(Ø|⌀|ø|R|SR|SØ|M|∠|□)?\s*\d/i.test(s)) return null;
  const gd=s.match(/^(\d*[.,]\d+)\s+([A-Z](\s+[A-Z]){0,2})$/);                                  // "0.05 A B" → likely a GD&T frame
  if(gd) return {type:"GD&T",text:s,nominal:null,upper:+gd[1].replace(",","."),lower:0,datum:gd[2].replace(/\s+/g,"|"),gdt:"(check symbol)",conf:0.45};
  if(letters>2) return null;
  const n=p.nominal; if(n==null) return null;
  if(!p.type&&n<0.5&&p.upper==null) return {type:"GD&T",text:s,nominal:null,upper:n,lower:0,gdt:"(check symbol)",conf:0.4};
  return {type:p.type||"Linear",text:s.replace(/⌀/g,"Ø"),nominal:p.type==="Surface finish"?null:n,upper:p.upper??null,lower:p.lower??null,unit:p.type==="Angle"?"deg":"mm",conf:p.type?0.9:0.8};
}
function markGrid(groups,sh){
  const cand=groups.filter(g=>/^[A-Z]?\d{0,2}$/.test(g.s.trim())&&g.s.trim()), bk={};
  for(const g of cand){ const cx=(g.x0+g.x1)/2, cy=g.y-g.h/2, e=0.06;
    const key=cy<sh.h*e?"t"+Math.round(cy/(g.h*2)):cy>sh.h*(1-e)?"b"+Math.round(cy/(g.h*2)):cx<sh.w*e?"l"+Math.round(cx/(g.h*2)):cx>sh.w*(1-e)?"r"+Math.round(cx/(g.h*2)):null;
    if(key) (bk[key]=bk[key]||[]).push(g); }
  Object.values(bk).forEach(a=>{ if(a.length>=3) a.forEach(g=>g.grid=true); });
}
function itemsFromGroups(groups,sh,si,source,confScale=1){
  const out=[]; markGrid(groups,sh);
  for(const g of groups){ const c=classify(g,sh); if(!c) continue; if(c.conf!=null) c.conf=+(c.conf*confScale).toFixed(2);
    out.push(newItem(si,g.ax??g.x0,g.ay??(g.y-g.h*0.35),Object.assign({source,ex:g.ax!=null||g.rot?null:g.x1},c))); }
  return out;
}
function findTextItems(){
  let out=[];
  S.sheets.forEach((sh,si)=>{ if(!sh.text||!sh.text.length) return; const groups=groupText(sh.text);
    out=out.concat(itemsFromGroups(groups,sh,si,"text")); readTitleBlock(groups,si); });
  S.items=out; postProcess(); S.sel=null; renumber(); return out.length;
}
/* title block fields + material row */
const TB={partNo:/^PART\s*(NO|NUMBER|#)\.?/i, drawingNo:/^(DRAWING|DRG|DWG)\.?\s*(NO|NUMBER|#)\.?/i, rev:/^REV(ISION)?\.?\b/i, material:/^(MATERIAL|MATL|MAT'L)\b/i, partName:/^(PART\s*NAME|DESCRIPTION|TITLE|NAME)\b/i, customer:/^CUSTOMER\b/i};
function readTitleBlock(groups,si){
  const found={};
  for(const g of groups){ const s=g.s.trim();
    for(const [k,rx] of Object.entries(TB)){ if(found[k]||!rx.test(s)) continue;
      let v=s.replace(rx,"").replace(/^[\s.:#=-]+/,"").trim(), at=g;
      if(!v){ let best=null,bd=Infinity;
        for(const o of groups){ if(o===g) continue; const t=o.s.trim(); if(!t||Object.values(TB).some(r=>r.test(t))) continue;
          const dxr=o.x0-g.x1, dyr=Math.abs(o.y-g.y), dxb=Math.abs(o.x0-g.x0), dyb=o.y-g.y;
          let d=Infinity; if(dxr>-g.h&&dxr<14*g.h&&dyr<0.7*g.h) d=dxr; else if(dyb>0.3*g.h&&dyb<3.2*g.h&&dxb<8*g.h) d=dyb*1.5+dxb*0.3;
          if(d<bd){bd=d;best=o;} }
        if(best){ v=best.s.trim(); at=best; } }
      if(v&&v.length<=60){ found[k]=v; if(k==="material") found._matAt=at; } } }
  for(const k of Object.keys(TB)) if(found[k]&&(!S.header[k]||(k==="drawingNo"&&S.header[k]===S.fileName))) S.header[k]=found[k];
  syncHeader();
  if(found.material){ const g=found._matAt; S._mat={si,ax:g.x0,ay:g.y-g.h*0.35,text:found.material}; }
  return found;
}
/* special characteristic symbols near a callout → class */
const SC_RX=/[▼▽▲△◆◇⬥⬦⯁⯆]|^\(?(SC|CC|KC|CTQ|CSC)\)?$|^<(SC|CC)>$/i;
function markClasses(si,textItems,items){
  let n=0; if(!textItems) return 0;
  for(const t of textItems){ const s=t.s.trim(); if(!SC_RX.test(s)||/special|character/i.test(s)) continue;
    const cls=/CC|CSC/i.test(s)?"CC":/KC|CTQ/i.test(s)?"KC":"SC", cx=t.x+(t.w||0)/2, cy=t.y-t.h/2;
    let best=null,bd=Infinity; for(const it of items){ if(it.sheet!==si||it.type==="Material") continue; const d=Math.hypot(it.ax-cx,it.ay-cy); if(d<bd){bd=d;best=it;} }
    if(best&&bd<Math.max(t.h*8,S.sheets[si].w*0.04)){ best.cls=cls; n++; } }
  return n;
}
function postProcess(){
  if(S._mat){ const m=S._mat; S._mat=null;
    if(!S.items.some(i=>i.type==="Material")) S.items.push(newItem(m.si,m.ax,m.ay,{type:"Material",text:"Material: "+m.text,unit:"—",source:"text",conf:0.8})); }
  let n=0; S._legend=0; S.sheets.forEach((sh,si)=>{ n+=markClasses(si,sh.text,S.items); try{ n+=findSymbolClasses(si); }catch(e){ console.warn(e); } }); S._clsCount=n;
  applyLanguage();
}
$("bText").onclick=async()=>{
  const needOcr=!S.cadItems&&!S.sheets.some(s=>s.text&&s.text.length>5&&!s.ocr);
  const blanks=S.items.filter(i=>!i.text&&i.source==="manual");
  if(needOcr&&blanks.length&&confirm(`Read the text under your ${blanks.length} hand-placed balloons? (Cancel to scan the whole drawing instead.)`)){ await fillBlanks(blanks); return; }
  if(S.items.length&&!confirm("Replace the current balloons with the dimensions read from the file?")) return;
  if(needOcr){ await ocrAll(); return; }
  if(S.cadItems){ S.items=S.cadItems.map(d=>newItem(0,d.ax,d.ay,Object.assign({},d))); S.sel=null; renumber(); toast(`Read ${S.items.length} characteristics from the CAD data.`); return; }
  if(S.sheets.some(s=>s.text&&s.text.length>5&&!s.ocr)){ const n=findTextItems(); toast(n?`Found ${n} characteristics${S._clsCount?`, ${S._clsCount} marked SC/CC`:""}. Check each row against the drawing.`:"No dimension text found. Try the free scanner on an image, or add balloons by hand.",7000); return; }
  const n=findTextItems(); toast(n?`Found ${n} dimensions in the PDF text. Check each row against the drawing.`:"No dimension text found. Try “Read with AI” or add balloons by hand.");
};

/* ---------- language detection + glossary translation (free, offline) ---------- */
const GLOSS={
 Russian:{"острые кромки притупить":"break sharp edges","неуказанные предельные отклонения размеров":"general tolerances for unspecified dimensions","неуказанные предельные отклонения":"general tolerances","неуказанные радиусы":"unspecified radii","неуказанные фаски":"unspecified chamfers","технические требования":"technical requirements","размеры для справок":"reference dimensions","общие допуски":"general tolerances","не более":"max","не менее":"min","остальные поверхности":"remaining surfaces",
  "втулк":"bush","вал":"shaft","ос":"axle","корпус":"housing","крышк":"cover","фланец":"flange","шестерн":"gear","кольц":"ring","гайк":"nut","болт":"bolt","винт":"screw","шайб":"washer","пружин":"spring","штуцер":"fitting","материал":"material","стал":"steel","чугун":"cast iron","алюмин":"aluminium","латун":"brass","бронз":"bronze","мед":"copper","масса":"mass","масштаб":"scale","лист":"sheet","листов":"sheets","разраб":"designed","пров":"checked","утв":"approved","изм":"rev","лит":"letter","кромк":"edges","остр":"sharp","притуп":"break","твердост":"hardness","закал":"harden","термообработ":"heat treatment","цементир":"carburize","покрыти":"coating","цинк":"zinc","хром":"chrome","оксид":"oxide","фосфат":"phosphate","шероховатост":"roughness","остальн":"remaining","поверхност":"surfaces","допуск":"tolerance","отклонени":"deviations","предельн":"limit","размер":"dimensions","радиус":"radius","фаск":"chamfer","отверст":"hole","резьб":"thread","неуказанн":"unspecified","обработ":"machining","сварк":"welding","сварн":"welded","гост":"GOST","см":"see","и":"and","по":"per","в":"in","на":"on","с":"with","для":"for","все":"all","кроме":"except","длин":"length","диаметр":"diameter","глубин":"depth","шлиц":"spline"},
 German:{"scharfe kanten brechen":"break sharp edges","kanten gebrochen":"edges broken","nicht bemaßte radien":"undimensioned radii","maße in mm":"dimensions in mm","ohne toleranz":"without tolerance","werkstoff":"material","maßstab":"scale","massstab":"scale","blatt":"sheet","gewicht":"weight","allgemeintoleranzen":"general tolerances","freimaßtoleranz":"general tolerance","entgratet":"deburred","gratfrei":"burr-free","oberfläche":"surface","oberflächenbehandlung":"surface treatment","gehärtet":"hardened","härte":"hardness","einsatzgehärtet":"case hardened","verzinkt":"zinc plated","brüniert":"black oxide","gezeichnet":"drawn","geprüft":"checked","benennung":"title","zeichnungsnummer":"drawing number","sachnummer":"part number","gewinde":"thread","bohrung":"bore","fase":"chamfer","alle":"all","und":"and","nach":"per","stahl":"steel","messing":"brass","wärmebehandlung":"heat treatment","rauheit":"roughness","besondere merkmale":"special characteristics"},
 French:{"casser les angles vifs":"break sharp edges","arêtes vives":"sharp edges","tolérances générales":"general tolerances","sauf indication contraire":"unless otherwise specified","cotes en mm":"dimensions in mm","traitement thermique":"heat treatment","état de surface":"surface finish","matière":"material","matériau":"material","échelle":"scale","masse":"mass","ébavurer":"deburr","dureté":"hardness","rugosité":"roughness","acier":"steel","laiton":"brass","dessiné":"drawn","vérifié":"checked","désignation":"description","filetage":"thread","chanfrein":"chamfer","perçage":"drilling","caractéristique spéciale":"special characteristic"},
 Spanish:{"tolerancias generales":"general tolerances","aristas vivas":"sharp edges","matar aristas":"break edges","tratamiento térmico":"heat treatment","acabado superficial":"surface finish","salvo indicación":"unless otherwise stated","cotas en mm":"dimensions in mm","escala":"scale","peso":"weight","dureza":"hardness","rugosidad":"roughness","acero":"steel","latón":"brass","dibujado":"drawn","revisado":"checked","rosca":"thread","chaflán":"chamfer","característica especial":"special characteristic"},
 Italian:{"tolleranze generali":"general tolerances","spigoli vivi":"sharp edges","smussare gli spigoli":"break edges","trattamento termico":"heat treatment","quote in mm":"dimensions in mm","materiale":"material","scala":"scale","durezza":"hardness","rugosità":"roughness","acciaio":"steel","ottone":"brass","disegnato":"drawn","controllato":"checked","filettatura":"thread","smusso":"chamfer"},
 Chinese:{"技术要求":"technical requirements","未注倒角":"unspecified chamfers","未注圆角":"unspecified fillets","未注公差":"unspecified tolerances","锐边倒钝":"break sharp edges","去毛刺":"deburr","热处理":"heat treatment","调质":"quench & temper","淬火":"hardening","硬度":"hardness","表面粗糙度":"surface roughness","材料":"material","比例":"scale","重量":"weight","数量":"quantity","设计":"designed","审核":"checked","批准":"approved","图号":"drawing no.","名称":"name","零件":"part","钢":"steel","铝":"aluminium","黄铜":"brass","镀锌":"zinc plating","发黑":"black oxide","螺纹":"thread","倒角":"chamfer","圆角":"fillet","其余":"remaining","未注":"unspecified","公差":"tolerance","按":"per","及":"and","均为":"all","所有":"all","尺寸":"dimensions","关键特性":"critical characteristic","特殊特性":"special characteristic","重要特性":"key characteristic","孔":"hole","轴":"shaft","套":"sleeve"},
 Japanese:{"材質":"material","尺度":"scale","普通公差":"general tolerance","糸面取り":"small chamfer","面取り":"chamfer","バリなき事":"no burrs","バリ取り":"deburr","熱処理":"heat treatment","硬度":"hardness","表面粗さ":"surface roughness","図番":"drawing no.","品名":"part name","設計":"designed","検図":"checked","承認":"approved","指示なき":"unspecified","角部":"corners","鋼":"steel","めっき":"plating","黒染め":"black oxide","ねじ":"thread","特殊特性":"special characteristic","重要保安":"safety critical"}
};
const CYR={а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"kh",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya"};
function translit(s){ return String(s??"").replace(/[\u0400-\u04FF]/g,c=>{ const l=c.toLowerCase(), t=CYR[l]??c; return c===l?t:(t.charAt(0).toUpperCase()+t.slice(1)); }); }
function detectLang(str){
  const cnt=rx=>(str.match(rx)||[]).length;
  const cyr=cnt(/[\u0400-\u04FF]/g), han=cnt(/[\u4E00-\u9FFF]/g), kana=cnt(/[\u3040-\u30FF]/g), hang=cnt(/[\uAC00-\uD7AF]/g), lat=cnt(/[A-Za-z]/g);
  if(kana>=3) return "Japanese"; if(han>=4) return "Chinese"; if(hang>=4) return "Korean"; if(cyr>=6&&cyr>lat*0.2) return "Russian";
  const low=" "+str.toLowerCase()+" "; let best="English", bh=1;
  for(const L of ["German","French","Spanish","Italian"]){ let h=0; for(const k of Object.keys(GLOSS[L])) if(low.includes(k)) h++; if(/[äöüß]/.test(low)&&L==="German") h+=2; if(h>bh){bh=h;best=L;} }
  return best;
}
function translate(s,L){
  if(!s||!L||L==="English"||!GLOSS[L]) return "";
  const G=GLOSS[L], keys=Object.keys(G).sort((a,b)=>b.length-a.length); let t=s;
  if(L==="Chinese"||L==="Japanese"){ for(const k of keys) t=t.split(k).join(" "+G[k]+" "); t=t.replace(/\s+/g," ").trim(); }
  else if(L==="Russian"){
    const phr=keys.filter(k=>k.includes(" ")); for(const k of phr) t=t.replace(new RegExp(k,"gi"),G[k]);
    const stems=keys.filter(k=>!k.includes(" "));
    t=t.replace(/[\u0400-\u04FF]+/g,w=>{ const l=w.toLowerCase(); if(G[l]) return G[l];
      const st=stems.filter(k=>k.length>=3&&l.startsWith(k)).sort((a,b)=>b.length-a.length)[0]; return st?G[st]:translit(w); });
  } else { for(const k of keys) t=t.replace(new RegExp("(^|[^\\p{L}])"+k.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"(?=$|[^\\p{L}])","giu"),(m,p)=>p+G[k]); }
  t=t.trim(); return t.toLowerCase()===s.toLowerCase()?"":t;
}
function applyLanguage(){
  const all=[...S.sheets.flatMap(s=>(s.text||[]).map(t=>t.s)),...S.items.map(i=>i.text),...Object.values(S.header)].join(" ");
  S.lang=detectLang(all);
  S.items.forEach(it=>{ it.en=translate(it.text,S.lang)||it.en||""; });
  if(S.lang!=="English") for(const k of ["partName","material","customer"]){ const v=S.header[k]; const t=translate(v,S.lang); if(t&&!v.includes("(")) S.header[k]=`${t} (${v})`; }
  syncHeader();
}

function ccl(data,W,H,mask){
  const lab=new Int32Array(W*H), par=new Int32Array(Math.floor(W*H/2)+2); let next=1;
  const find=a=>{ while(par[a]!==a){ par[a]=par[par[a]]; a=par[a]; } return a; };
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const i=y*W+x, p=i*4; if(!mask(data[p],data[p+1],data[p+2])) continue;
    const l=x>0?lab[i-1]:0, u=y>0?lab[i-W]:0;
    if(!l&&!u){ lab[i]=next; par[next]=next; next++; if(next>=par.length) return []; }
    else if(l&&u){ const a=find(l), b=find(u); if(a!==b){ if(a<b) par[b]=a; else par[a]=b; } lab[i]=Math.min(a,b); }
    else lab[i]=l||u; }
  const n=next, x0=new Int32Array(n).fill(1e9), y0=new Int32Array(n).fill(1e9), x1=new Int32Array(n).fill(-1), y1=new Int32Array(n).fill(-1), cnt=new Int32Array(n), rs=new Float64Array(n), gs=new Float64Array(n), bs=new Float64Array(n);
  for(let i=0;i<W*H;i++){ if(!lab[i]) continue; const r=find(lab[i]), x=i%W, y=(i/W)|0, p=i*4;
    if(x<x0[r])x0[r]=x; if(x>x1[r])x1[r]=x; if(y<y0[r])y0[r]=y; if(y>y1[r])y1[r]=y; cnt[r]++; rs[r]+=data[p]; gs[r]+=data[p+1]; bs[r]+=data[p+2]; }
  const out=[]; for(let r=1;r<n;r++){ if(!cnt[r]) continue; const w=x1[r]-x0[r]+1, h=y1[r]-y0[r]+1;
    out.push({x:x0[r],y:y0[r],w,h,n:cnt[r],fill:cnt[r]/(w*h),col:[rs[r]/cnt[r],gs[r]/cnt[r],bs[r]/cnt[r]]}); }
  return out;
}
const lum=(r,g,b)=>0.299*r+0.587*g+0.114*b;
const sat=c=>{ const mx=Math.max(...c), mn=Math.min(...c); return mx?(mx-mn)/mx:0; };
function pickTemplate(data,W,H,H0){
  const comps=ccl(data,W,H,(r,g,b)=>lum(r,g,b)<200).filter(c=>c.h>=0.35*H0&&c.h<=2.8*H0&&c.w>=0.35*H0&&c.w<=2.8*H0&&c.fill>0.25);
  comps.sort((a,b)=>((sat(b.col)>0.3)-(sat(a.col)>0.3))||(b.n-a.n)); return comps[0]||null;
}
function matchSymbols(data,W,H,tpl){
  const colored=sat(tpl.col)>0.3, tc=tpl.col;
  const mask=colored?(r,g,b)=>Math.hypot(r-tc[0],g-tc[1],b-tc[2])<110:(r,g,b)=>lum(r,g,b)<120;
  return ccl(data,W,H,mask).filter(c=>Math.abs(c.w/tpl.w-1)<0.45&&Math.abs(c.h/tpl.h-1)<0.45&&Math.abs(c.fill-tpl.fill)<0.2&&c.n>=tpl.n*0.4);
}


/* ---------- special-characteristic symbols drawn as graphics (template from the legend) ---------- */
const LEGEND_RX=/special\s*char|critical\s*char|key\s*char|significant\s*char|safety\s*char|\bCTQ\b|besondere\s*merkmal|caract[ée]ristique\s*sp[ée]ciale|特殊特性|关键特性|重要特性|重要保安|особ\S*\s*характер/i;
function nearestItem(si,cx,cy,lim){
  let best=null,bd=Infinity;
  for(const it of S.items){ if(it.sheet!==si||it.type==="Material") continue;
    const dx=it.ex!=null?Math.max(it.ax-cx,0,cx-it.ex):Math.abs(cx-it.ax), d=Math.hypot(dx,cy-it.ay); if(d<bd){bd=d;best=it;} }
  return bd<lim?best:null;
}
function inTextBox(sh,cx,cy){ return (sh.text||[]).some(t=>!t.ang&&cx>=t.x-1&&cx<=t.x+t.w+1&&cy>=t.y-t.h&&cy<=t.y+t.h*0.3); }
function applySymbolHits(si,hits,cls,lim){
  let n=0; for(const c of hits){ const it=nearestItem(si,c.x+c.w/2,c.y+c.h/2,lim); if(it&&it.cls!==cls){ it.cls=cls; n++; } } return n;
}
function findSymbolClasses(si){
  const sh=S.sheets[si]; if(!sh.canvas) return 0;
  const groups=sh.text&&sh.text.length?groupText(sh.text):[], leg=groups.find(g=>LEGEND_RX.test(g.s));
  const cls=leg?(/critical|CTQ|safety|关键|重要保安/i.test(leg.s)?"CC":/key|重要特性/i.test(leg.s)?"KC":"SC"):"SC";
  const H0=leg?leg.h:(groups.length?groups.map(g=>g.h).sort((a,b)=>a-b)[groups.length>>1]:sh.w*0.006);
  let n=0;
  // (a) legend symbol typed as a font glyph → every other copy of that glyph
  if(leg){ const m=leg.s.match(/^\s*([^\w\s])\s*/); let glyph=m?m[1]:null;
    if(!glyph){ const t=(sh.text||[]).find(t=>t.s.trim().length<=2&&/[^\w\s]/.test(t.s)&&Math.abs(t.y-leg.y)<0.8*leg.h&&leg.x0-(t.x+t.w)<3*leg.h&&leg.x0-(t.x+t.w)>-leg.h); if(t) glyph=t.s.trim()[0]; }
    if(glyph) for(const t of sh.text){ if(!t.s.includes(glyph)||LEGEND_RX.test(t.s)) continue;
      const it=nearestItem(si,t.x+t.w/2,t.y-t.h/2,Math.max(8*t.h,sh.w*0.035)); if(it&&it.cls!==cls){ it.cls=cls; n++; } } }
  const g2=sh.canvas.getContext("2d",{willReadFrequently:true});
  let all=null; const getAll=()=>all||(all=g2.getImageData(0,0,sh.w,sh.h).data);
  // (b) legend symbol drawn as a shape → template match
  if(leg){ const tries=[[leg.x0-6*H0,leg.y-1.9*H0,7.6*H0,2.8*H0],[leg.x1+0.1*H0,leg.y-1.9*H0,5*H0,2.8*H0],[leg.x0-2*H0,leg.y-3.4*H0,6*H0,1.9*H0]];
    let tpl=null, trect=null;
    for(let [x,y,w,h] of tries){ x=Math.max(0,Math.round(x)); y=Math.max(0,Math.round(y)); w=Math.min(sh.w-x,Math.round(w)); h=Math.min(sh.h-y,Math.round(h)); if(w<4||h<4) continue;
      const t=pickTemplate(g2.getImageData(x,y,w,h).data,w,h,H0); if(t&&(sat(t.col)>0.3||!inTextBox(sh,x+t.x+t.w/2,y+t.y+t.h/2))){ tpl=t; trect=[x+t.x,y+t.y]; break; } }
    if(tpl){ const hits=matchSymbols(getAll(),sh.w,sh.h,tpl).filter(c=>!(Math.abs(c.x-trect[0])<tpl.w&&Math.abs(c.y-trect[1])<tpl.h)&&!inTextBox(sh,c.x+c.w/2,c.y+c.h/2));
      n+=applySymbolHits(si,hits,cls,Math.max(6*tpl.h,sh.w*0.03)); } }
  // (c) no result yet → small solid coloured symbols (e.g. red ▼) that are not text
  if(!n&&!sh.isCad){ const d=getAll();
    const cands=ccl(d,sh.w,sh.h,(r,g,b)=>{ const mx=Math.max(r,g,b), mn=Math.min(r,g,b); return mx>90&&(mx-mn)/mx>0.45; })
      .filter(c=>{ const asp=c.w/c.h; return asp>0.55&&asp<1.8&&c.fill>0.35&&c.fill<0.85&&c.h>0.6*H0&&c.h<2.6*H0&&!inTextBox(sh,c.x+c.w/2,c.y+c.h/2); });
    if(cands.length&&cands.length<=60) n+=applySymbolHits(si,cands,cls,Math.max(6*H0,sh.w*0.03)); }
  return n;
}
/* manual: tap one symbol on the drawing → find all copies */
async function markFromTap(x,y){
  const sh=S.sheets[S.cur], g2=sh.canvas.getContext("2d",{willReadFrequently:true}), R=Math.round(sh.w*0.012);
  const x0=Math.max(0,Math.round(x-R)), y0=Math.max(0,Math.round(y-R)), w=Math.min(sh.w-x0,2*R), h=Math.min(sh.h-y0,2*R);
  const comps=ccl(g2.getImageData(x0,y0,w,h).data,w,h,(r,g,b)=>0.299*r+0.587*g+0.114*b<200).filter(c=>c.fill>0.25&&c.w>3&&c.h>3&&c.x>0&&c.y>0&&c.x+c.w<w&&c.y+c.h<h);
  comps.sort((a,b)=>Math.hypot(a.x+a.w/2-R,a.y+a.h/2-R)-Math.hypot(b.x+b.w/2-R,b.y+b.h/2-R));
  const tpl=comps[0]; if(!tpl){ toast("Couldn't pick out a symbol there. Zoom in and tap right on the symbol."); return; }
  const cls=(prompt("Mark every copy of this symbol as which class? Type SC, CC or KC","SC")||"").trim().toUpperCase(); if(!["SC","CC","KC"].includes(cls)) return;
  busy("Finding every copy of the symbol"); await tick();
  const hits=matchSymbols(g2.getImageData(0,0,sh.w,sh.h).data,sh.w,sh.h,tpl); busy(null);
  const n=applySymbolHits(S.cur,hits,cls,Math.max(6*tpl.h,sh.w*0.03));
  renderAll(); toast(`Found ${hits.length} copies of the symbol; marked ${n} characteristics as ${cls}. Check the Class column.`,7000);
}
/* ---------- free OCR (Tesseract, runs in the browser) ---------- */
let ocrEng=null, ocrLoading=null;
function loadScript(src){ return new Promise((res,rej)=>{ const s=document.createElement("script"); s.src=src; s.onload=res; s.onerror=()=>rej(new Error("couldn't load the scanner files")); document.head.append(s); }); }
async function getOcr(){
  if(ocrEng) return ocrEng;
  if(!ocrLoading) ocrLoading=(async()=>{
    if(!convertersAllowed()) throw new Error("the text scanner can't run in this viewer");
    busy("Starting the free text scanner (first time only)"); await tick();
    const M=await TesseractCore({wasmBinary:await gunzipEl("wasm-ocr"),locateFile:f=>f,print:()=>{},printErr:()=>{}});
    M.FS.writeFile("/eng.traineddata", await gunzipEl("ocr-eng"));
    const api=new M.TessBaseAPI(); if(api.Init("/","eng")!==0) throw new Error("text scanner didn't start");
    api.SetVariable("user_defined_dpi","300"); api.SetVariable("preserve_interword_spaces","1");
    ocrEng={M,api}; return ocrEng; })();
  try{ return await ocrLoading; }catch(e){ ocrLoading=null; throw e; }
}
function toPng(c){ return new Promise(r=>c.toBlob(async b=>r(new Uint8Array(await b.arrayBuffer())),"image/png")); }
async function ocrCanvas(c,psm){
  const {M,api}=await getOcr(); M.FS.writeFile("/input",await toPng(c)); api.SetPageSegMode(psm); api.SetImageFile(1,0);
  const tsv=api.GetTSVText(0)||""; api.Clear();
  return tsv.split("\n").map(l=>l.split("\t")).filter(c=>c[0]==="5"&&c[11]&&c[11].trim()&&+c[10]>=35)
    .map(c=>({s:c[11].trim(),x:+c[6],y:+c[7]+ +c[9],h:+c[9],w:+c[8],conf:+c[10]/100}));
}
function rotCanvas(src,cw){ const c=document.createElement("canvas"); c.width=src.height; c.height=src.width; const g=c.getContext("2d");
  if(cw){ g.translate(c.width,0); g.rotate(Math.PI/2); } else { g.translate(0,c.height); g.rotate(-Math.PI/2); } g.drawImage(src,0,0); return c; }
function cleanOcr(s){ return s.replace(/[|]/g,"").replace(/(\d)\s*[:;]\s*(0[.,]\d)/g,"$1±$2").replace(/^[oO@](\d)/,"Ø$1").replace(/(\d),(\d)/g,"$1.$2"); }
async function ocrAll(){
  let out=[]; const total=S.sheets.length;
  try{
    for(let si=0;si<total;si++){ const sh=S.sheets[si];
      busy(`Scanning sheet ${si+1} of ${total} for text (free) — about 20 seconds`); await tick();
      const w0=(await ocrCanvas(sh.canvas,11)).map(w=>({...w,s:cleanOcr(w.s)}));
      busy(`Scanning vertical text on sheet ${si+1}`); await tick();
      const w1=(await ocrCanvas(rotCanvas(sh.canvas,true),11)).map(w=>({...w,s:cleanOcr(w.s)}));
      sh.text=w0; sh.ocr=true;
      const g0=groupText(w0), g1=groupText(w1).map(g=>{ const xr0=g.x0,xr1=g.x1,yr=g.y-g.h/2;
        return {...g, ax:yr, ay:sh.h-xr1, x0:yr-g.h/2, x1:yr+g.h/2, y:sh.h-(xr0+xr1)/2+g.h/2}; });
      const items0=itemsFromGroups(g0,sh,si,"ocr",0.7), items1=itemsFromGroups(g1,sh,si,"ocr",0.6)
        .filter(a=>!items0.some(b=>Math.hypot(a.ax-b.ax,a.ay-b.ay)<sh.w*0.012));
      out=out.concat(items0,items1); readTitleBlock(g0,si);
    }
  }catch(e){ busy(null); toast("The free text scanner couldn't run: "+(e.message||e)+". Place balloons with “Add balloon” instead.",8000); return; }
  busy(null); S.items=out; postProcess(); S.sel=null; renumber();
  toast(out.length?`Scanned ${out.length} characteristics for free${S._clsCount?`, ${S._clsCount} marked SC/CC`:""}. OCR can misread ± and Ø, so check every row — tap a balloon number to jump to it.`:"The scanner didn't find dimension text. Place balloons with “Add balloon” — each one reads the text under it.",9000);
}
async function readRegion(sh,x,y){
  const bw=Math.max(sh.w*0.11,160), bh=Math.max(sh.w*0.035,60), best=[];
  for(const vert of [false,true]){
    const w=vert?bh:bw, h=vert?bw:bh, x0=Math.max(0,x-w/2), y0=Math.max(0,y-h/2), cw=Math.min(w,sh.w-x0), ch=Math.min(h,sh.h-y0);
    const c=document.createElement("canvas"), k=2; c.width=Math.round(cw*k); c.height=Math.round(ch*k); const g=c.getContext("2d"); g.fillStyle="#fff"; g.fillRect(0,0,c.width,c.height);
    g.imageSmoothingQuality="high"; g.drawImage(sh.canvas,x0,y0,cw,ch,0,0,c.width,c.height);
    const words=await ocrCanvas(vert?rotCanvas(c,true):c,6);
    if(words.length){ const s=cleanOcr(words.map(w=>w.s).join(" ")), conf=words.reduce((a,w)=>a+w.conf,0)/words.length; best.push({s,conf:conf*(/\d/.test(s)?1:0.5)}); }
  }
  best.sort((a,b)=>b.conf-a.conf); return best[0]||null;
}
async function readUnder(it){
  const sh=S.sheets[it.sheet]; if(sh.isCad) return;
  if(sh.text&&sh.text.length>5&&!sh.ocr){
    const g=groupText(sh.text).map(g=>({g,d:Math.hypot((g.x0+g.x1)/2-it.ax,g.y-g.h/2-it.ay)})).sort((a,b)=>a.d-b.d)[0];
    if(g&&g.d<sh.w*0.05) applyRead(it,g.g.s,0.9); return; }
  try{ busy("Reading the text under the balloon"); const r=await readRegion(sh,it.ax,it.ay); busy(null); if(r) applyRead(it,r.s,Math.min(0.85,r.conf)); }
  catch(e){ busy(null); }
}
function applyRead(it,s,conf){
  const c=classify({s,x0:0,x1:0,y:0,h:1},{w:1e9,h:1e9})||Object.assign({type:"Note",text:s},parseCallout(s));
  Object.assign(it,{text:c.text||s,type:c.type||it.type,nominal:c.nominal??null,upper:c.upper??null,lower:c.lower??null,gdt:c.gdt||"",datum:c.datum||"",unit:c.unit||it.unit,conf:+conf.toFixed(2),gen:false,source:"ocr"});
  applyGen(it); it.instr=instrument(it); renderTable(); draw();
}
async function fillBlanks(list){
  try{ for(let i=0;i<list.length;i++){ busy(`Reading balloon ${i+1} of ${list.length}`); await tick(); await readUnder(list[i]); } }
  catch(e){ toast("The free text scanner couldn't run: "+(e.message||e)); }
  busy(null); toast("Filled the rows from the text under each balloon. Check each one against the drawing.",6000);
}

/* ---------- AI extraction ---------- */
const PROMPT=(w,h,zoneNote)=>`You are a quality inspection engineer ballooning a mechanical engineering drawing for a first-article inspection report.
The image is ${w}×${h} pixels${zoneNote}.
List EVERY inspectable characteristic visible: linear dimensions, diameters, radii, angles, chamfers, threads, GD&T feature control frames, surface finish symbols, and notes that state a measurable or checkable requirement (heat treatment, hardness, coating, "break sharp edges", etc.).
Do NOT include: title block fields, revision table rows, grid border letters/numbers, view labels, scale, or reference dimensions in parentheses (list those only if marked as inspectable).
A callout like "4X Ø10" is ONE item. A GD&T frame is ONE item.
For each item give a tight bounding box around the callout TEXT, as [x0,y0,x1,y1] in coordinates normalized 0-1000 over this image (0,0 = top-left).
Tolerances are signed deviations from nominal: "25 ±0.1" → nominal 25, upper 0.1, lower -0.1; "Ø10 +0.02/0" → upper 0.02, lower 0; "Ø10 H7" → keep "H7" in text and give the ISO fit deviations if you are sure, else null.
GD&T: nominal null, upper = tolerance zone value, lower 0, gdt = characteristic name in English (e.g. "Position"), datum = datum references like "A|B|C".
Surface finish: nominal null, upper = Ra/Rz max value, lower 0, unit "µm".
Notes: nominal/upper/lower null, text = short requirement.
cls = "SC", "CC" or "KC" when the callout carries a special/critical characteristic symbol (e.g. ▼, ◆, shield, (SC), (CC)) or a legend says so; otherwise "".
en = English translation of text when it is not in English, else "".
Include the MATERIAL specification from the title block or notes as one item with type "Material".
conf = your confidence 0-1 that the text and values are read correctly.
Also read the title block if visible.
Reply with ONLY JSON of this shape:
{"titleBlock":{"partNo":"","partName":"","drawingNo":"","rev":"","material":"","customer":"","units":"mm"},
 "items":[{"type":"Linear|Diameter|Radius|Angle|Chamfer|Thread|GD&T|Surface finish|Material|Note","cls":"","en":"","text":"as written","nominal":25,"upper":0.1,"lower":-0.1,"unit":"mm","gdt":"","datum":"","box":[x0,y0,x1,y1],"conf":0.9}]}`;

function tileRects(sh,n){
  if(n===1) return [[0,0,sh.w,sh.h]];
  const ov=0.06, rs=[]; for(let r=0;r<2;r++) for(let c=0;c<2;c++){
    const x0=Math.max(0,(c*0.5-ov)*sh.w), y0=Math.max(0,(r*0.5-ov)*sh.h), x1=Math.min(sh.w,((c+1)*0.5+ov)*sh.w), y1=Math.min(sh.h,((r+1)*0.5+ov)*sh.h);
    rs.push([x0,y0,x1,y1]); } return rs;
}
function cropBlob(sh,[x0,y0,x1,y1]){
  const w=x1-x0,h=y1-y0,k=Math.min(1,2000/Math.max(w,h)), c=document.createElement("canvas"); c.width=Math.round(w*k); c.height=Math.round(h*k);
  c.getContext("2d").drawImage(sh.canvas,x0,y0,w,h,0,0,c.width,c.height);
  return new Promise(res=>c.toBlob(b=>res({blob:b,w:c.width,h:c.height}),"image/png"));
}
async function runAI(){
  if(!sample){ toast("AI reading isn't available here: this viewer didn't give the page access to Claude. Use “Find dimensions” (free) instead.",7000); return; }
  if(!imgLimits){ toast("AI reading isn't available here: this viewer can't send images to Claude. Use “Find dimensions” (free) instead.",7000); return; }
  if(S.items.length && !confirm("Replace the current balloons with a fresh AI read of the drawing?")) return;
  aiCtl=new AbortController(); const found=[]; let tb=null;
  const n=+S.set.tiles, total=S.sheets.length*(n===4?4:1); let done=0;
  try{
    for(let si=0;si<S.sheets.length;si++){
      const sh=S.sheets[si];
      for(const rect of tileRects(sh,n)){
        done++; busy(`Reading drawing — part ${done} of ${total}. This can take a minute.`,true);
        const {blob,w,h}=await cropBlob(sh,rect);
        const note=n===4?" and shows ONE ZONE of a larger sheet; only list callouts whose text is fully inside this image":"";
        const out=await sample.json(PROMPT(w,h,note),{images:[blob],modelTier:"complex",signal:aiCtl.signal});
        if(out&&out.titleBlock&&!tb&&Object.values(out.titleBlock).some(v=>v)) tb=out.titleBlock;
        (out&&Array.isArray(out.items)?out.items:[]).forEach(o=>{
          if(!Array.isArray(o.box)||o.box.length<4) return;
          const [bx0,by0,bx1,by1]=o.box.map(Number), rw=rect[2]-rect[0], rh=rect[3]-rect[1];
          const X0=rect[0]+bx0/1000*rw, Y0=rect[1]+by0/1000*rh, X1=rect[0]+bx1/1000*rw, Y1=rect[1]+by1/1000*rh;
          found.push({o,si,x0:X0,y0:Y0,x1:X1,y1:Y1});
        });
      }
    }
  }catch(e){
    busy(null);
    if(e&&e.code==="cancelled"){ toast("Stopped. Nothing was changed."); return; }
    if(e&&e.code==="not_granted"){ toast("AI reading needs your permission. You can still add balloons by hand."); return; }
    if(e&&e.code==="rate_limited"){ toast("Too many requests right now. Wait a minute, then try again."); return; }
    if(e&&e.code==="invalid_json"){ toast("The AI answer couldn't be read as a table. Try again, or switch AI detail to “Whole sheet”."); return; }
    toast("AI reading failed: "+(e&&(e.message||e.code)||e)); return;
  }
  busy(null);
  // dedupe overlapping tile results
  const keep=[]; const norm=s=>String(s||"").replace(/\s+/g,"").toLowerCase();
  for(const f of found){
    const cx=(f.x0+f.x1)/2, cy=(f.y0+f.y1)/2, sh=S.sheets[f.si], tol=Math.max(sh.w,sh.h)*0.02;
    const dup=keep.find(k=>k.si===f.si&&norm(k.o.text)===norm(f.o.text)&&Math.hypot((k.x0+k.x1)/2-cx,(k.y0+k.y1)/2-cy)<tol);
    if(dup){ if((f.o.conf??0)>(dup.o.conf??0)) Object.assign(dup,f); } else keep.push(f);
  }
  S.items=keep.map(f=>{
    const o=f.o, p=parseCallout(o.text), type=TYPES.includes(o.type)?o.type:(p.type||"Linear");
    const pick=(a,b)=>a===undefined||a===null||a===""?(b??null):num(a);
    const gdtName=String(o.gdt||"").split("").map(c=>GDT[c]||c).join("");
    return newItem(f.si, f.x0, (f.y0+f.y1)/2, { type, text:String(o.text||""), nominal:type==="GD&T"||type==="Note"?num(o.nominal):pick(o.nominal,p.nominal),
      upper:pick(o.upper,type==="Note"?null:p.upper), lower:pick(o.lower,type==="Note"?null:p.lower),
      unit:o.unit||(type==="Angle"?"deg":type==="Surface finish"?"µm":type==="Note"?"—":"mm"), gdt:gdtName, datum:String(o.datum||""), cls:["SC","CC","KC"].includes(o.cls)?o.cls:"", en:String(o.en||""), conf:o.conf==null?null:Math.max(0,Math.min(1,+o.conf)), source:"ai" });
  });
  if(tb){ for(const k of ["partNo","partName","drawingNo","rev","material","customer"]) if(tb[k]&&!S.header[k]||(k==="drawingNo"&&tb[k]&&S.header[k]===S.fileName)) S.header[k]=String(tb[k]); syncHeader(); }
  S.sel=null; renumber();
  const low=S.items.filter(i=>i.conf!=null&&i.conf<0.7).length;
  toast(`Found ${S.items.length} characteristics${low?`; ${low} marked “to check”`:""}. Review each row against the drawing before exporting.`,7000);
}
$("bAI").onclick=runAI;
$("busyStop").onclick=()=>aiCtl&&aiCtl.abort();
$("bAdd").onclick=()=>setMode(S.mode==="add"?"pan":"add");
$("bRenum").onclick=()=>{renumber();toast("Balloons renumbered top-to-bottom, left-to-right on each sheet.");};

/* ---------- header + settings ---------- */
function syncHeader(){ document.querySelectorAll("[data-h]").forEach(i=>i.value=S.header[i.dataset.h]||""); headSum(); }
function headSum(){ const h=S.header; $("headSum").textContent=[h.partNo,h.rev&&("Rev "+h.rev),h.inspector].filter(Boolean).join(", ")||"Part no, revision, inspector"; }
document.querySelectorAll("[data-h]").forEach(i=>i.addEventListener("input",()=>{S.header[i.dataset.h]=i.value;headSum();}));
function setSum(){ const g=S.set.gen==="none"?"No general tol.":"ISO 2768-"+S.set.gen; $("setSum").textContent=`${g}, grid ${S.set.cols}×${S.set.rows}`; }
$("sGen").onchange=e=>{S.set.gen=e.target.value; S.items.forEach(it=>{applyGen(it); if(it.autoInstr!==false) it.instr=instrument(it);}); setSum(); renderTable(); draw();};
$("sGrid").onchange=e=>{S.set.grid=e.target.value; renderTable();};
$("sCols").onchange=e=>{S.set.cols=Math.max(1,Math.min(24,+e.target.value||8)); setSum(); renderTable();};
$("sRows").onchange=e=>{S.set.rows=Math.max(1,Math.min(20,+e.target.value||6)); setSum(); renderTable();};
$("sSize").onchange=e=>{S.set.size=+e.target.value; draw();};
$("sTiles").onchange=e=>{S.set.tiles=+e.target.value;};

/* ---------- export ---------- */
function pdfSafe(s){ return translit(String(s??"")).split("").map(c=>GDT[c]?GDT[c]:c).join("").replace(/⌀/g,"Ø").replace(/[−–—]/g,"-").replace(/µ/g,"u").replace(/[^\x20-\x7E\xA0-\xFF]/g,"?"); }
async function save(filename, data){
  if(!downloads){ if(window.claude){ toast("Saving files isn't available in this view."); return; }
    const url=URL.createObjectURL(data instanceof Blob?data:new Blob([data])); const a=document.createElement("a"); a.href=url; a.download=filename; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),4000); return; }
  try{ await downloads.save({filename,data}); }
  catch(e){ if(e.code==="declined") return; if(e.code==="rate_limited"){toast("A save is already waiting for your confirmation.");return;} toast("Couldn't save the file ("+e.code+")."); }
}
async function exportPDF(){
  if(!window.jspdf){ toast("PDF writer didn't load. Check your connection and reload."); return; }
  busy("Building PDF");
  await new Promise(r=>setTimeout(r,30));
  try{
    const {jsPDF}=window.jspdf, doc=new jsPDF({orientation:"landscape",unit:"mm",format:"a3"}), PW=420, PH=297, M=10, h=S.header;
    const hdr=(title)=>{ if(S.logo){ try{ const lh=11, lw=Math.min(45,lh*(S.logoRatio||1)); doc.addImage(S.logo,"PNG",PW-M-lw,M-3,lw,lh); }catch(e){} }
      doc.setFont("helvetica","bold"); doc.setFontSize(15); doc.setTextColor(22,35,58); doc.text(pdfSafe(title),M,M+5);
      doc.setFont("helvetica","normal"); doc.setFontSize(9.5); doc.setTextColor(70,80,95);
      const meta=[["Part no",h.partNo],["Part name",h.partName],["Drawing",h.drawingNo],["Rev",h.rev],["Customer",h.customer],["Material",h.material]].filter(x=>x[1]).map(x=>x[0]+": "+x[1]).join("     ");
      doc.text(pdfSafe(meta),M,M+11); doc.setDrawColor(22,35,58); doc.setLineWidth(0.5); doc.line(M,M+14,PW-M,M+14); };
    // ballooned sheets
    S.sheets.forEach((sh,si)=>{
      if(si>0) doc.addPage("a3","landscape");
      hdr(`Ballooned drawing - sheet ${si+1} of ${S.sheets.length}`);
      const c=document.createElement("canvas"); c.width=sh.w; c.height=sh.h; const g=c.getContext("2d");
      g.fillStyle="#fff"; g.fillRect(0,0,sh.w,sh.h); g.drawImage(sh.canvas,0,0);
      S.items.forEach((it,i)=>{ if(it.sheet===si) drawBalloon(g,it,i+1,rFor(sh),false); });
      const aw=PW-2*M, ah=PH-M-(M+17)-8, k=Math.min(aw/sh.w, ah/sh.h), w=sh.w*k, hh=sh.h*k;
      doc.addImage(c.toDataURL("image/jpeg",0.9),"JPEG",M+(aw-w)/2,M+17+(ah-hh)/2,w,hh,undefined,"FAST");
    });
    // table
    doc.addPage("a3","landscape"); hdr("Inspection report - dimensional results");
    const n=S.items.length, p=S.items.filter(i=>result(i)==="pass").length, f=S.items.filter(i=>result(i)==="fail").length;
    doc.setFontSize(10); doc.setTextColor(22,35,58);
    doc.text(`Characteristics: ${n}     Pass: ${p}     Fail: ${f}     Not measured: ${n-p-f}     General tolerance: ${S.set.gen==="none"?"not applied":"ISO 2768-"+S.set.gen}`,M,M+20);
    const body=S.items.map((it,i)=>{ const [l,u]=limits(it), r=result(it);
      const spec=it.type==="GD&T"?[it.gdt,it.text,it.datum?"| "+it.datum:""].filter(Boolean).join(" "):(it.en?`${it.en} [${it.text}]`:it.text);
      return [i+1,it.sheet+1,zone(it),it.type,pdfSafe(spec),fmt(it.nominal),fmtTol(it.upper)+(it.gen?"*":""),fmtTol(it.lower)+(it.gen?"*":""),fmt(l),fmt(u),pdfSafe(it.unit),it.cls||"",pdfSafe(it.instr),pdfSafe(it.actual),r==="pass"?"PASS":r==="fail"?"FAIL":""]; });
    doc.autoTable({ startY:M+24, head:[["No.","Sheet","Zone","Type","Specification","Nominal","+Tol","-Tol","LSL","USL","Unit","Class","Instrument","Actual","Result"]], body,
      margin:{left:M,right:M,bottom:24}, styles:{font:"helvetica",fontSize:9,cellPadding:1.8,lineColor:[190,198,205],lineWidth:0.2,textColor:[22,35,58]},
      headStyles:{fillColor:[22,35,58],textColor:255,fontStyle:"bold"}, alternateRowStyles:{fillColor:[244,246,244]},
      columnStyles:{0:{halign:"center",fontStyle:"bold",textColor:[200,16,46],cellWidth:12},1:{halign:"center",cellWidth:13},2:{cellWidth:13},4:{cellWidth:70},12:{cellWidth:48},14:{halign:"center",fontStyle:"bold",cellWidth:18}},
      didParseCell:d=>{ if(d.section==="body"&&d.column.index===14){ if(d.cell.raw==="PASS") d.cell.styles.textColor=[30,123,74]; if(d.cell.raw==="FAIL"){d.cell.styles.fillColor=[200,16,46];d.cell.styles.textColor=255;} } } });
    let y=doc.lastAutoTable.finalY+8; if(y>PH-40){ doc.addPage("a3","landscape"); y=M+10; }
    doc.setFontSize(9); doc.setTextColor(90,100,115);
    if(S.items.some(i=>i.gen)) { doc.text("* Tolerance taken from general tolerance class, not stated on the drawing.",M,y); y+=6; }
    if(S.items.some(i=>i.source==="ai")) { doc.text("Characteristics extracted with AI assistance and verified by the inspector below.",M,y); y+=6; }
    y+=6; doc.setTextColor(22,35,58); doc.setFontSize(10);
    [["Inspected by",h.inspector],["Date",h.date],["Approved by",""]].forEach((f,i)=>{ const x=M+i*130; doc.text(f[0]+":",x,y); doc.text(pdfSafe(f[1]||""),x+26,y); doc.line(x+25,y+1.5,x+115,y+1.5); });
    const pc=doc.getNumberOfPages(); for(let i=1;i<=pc;i++){ doc.setPage(i); doc.setFontSize(8.5); doc.setTextColor(120,128,140); doc.text(`Page ${i} of ${pc}`,PW-M,PH-6,{align:"right"}); doc.text(pdfSafe(`${h.partNo||S.fileName||"Drawing"}  Rev ${h.rev||"-"}`),M,PH-6); }
    const blob=doc.output("blob"); busy(null);
    await save(`${(h.partNo||S.fileName||"drawing").replace(/[^\w.-]+/g,"_")}_ballooned_report.pdf`, blob);
  }catch(e){ console.error(e); busy(null); toast("Couldn't build the PDF: "+(e.message||e)); }
}
function exportCSV(){
  const q=s=>`"${String(s??"").replace(/"/g,'""')}"`;
  const rows=[["No","Sheet","Zone","Type","Specification","GD&T","Datum","Nominal","UpperTol","LowerTol","LSL","USL","Unit","Class","Instrument","Actual","Result","AIConfidence"]];
  S.items.forEach((it,i)=>{ const [l,u]=limits(it); rows.push([i+1,it.sheet+1,zone(it),it.type,it.text,it.gdt,it.datum,fmt(it.nominal),fmt(it.upper),fmt(it.lower),fmt(l),fmt(u),it.unit,it.cls,it.instr,it.actual,result(it),it.conf==null?"":Math.round(it.conf*100)]); });
  save(`${(S.header.partNo||S.fileName||"drawing").replace(/[^\w.-]+/g,"_")}_characteristics.csv`, "\uFEFF"+rows.map(r=>r.map(q).join(",")).join("\r\n"));
}
$("bPDF").onclick=exportPDF; $("bCSV").onclick=exportCSV;

/* ---------- sample drawing (DXF) ---------- */
function sampleDxf(){
  const o=[]; const P=(...a)=>o.push(...a.map(String));
  P(0,"SECTION",2,"HEADER",9,"$INSUNITS",70,4,0,"ENDSEC",0,"SECTION",2,"ENTITIES");
  const line=(x1,y1,x2,y2)=>P(0,"LINE",8,0,10,x1,20,y1,11,x2,21,y2);
  const circ=(x,y,r)=>P(0,"CIRCLE",8,0,10,x,20,y,40,r);
  const text=(x,y,h,s)=>P(0,"TEXT",8,0,10,x,20,y,40,h,1,s);
  const dim=(x,y,t,meas,ov)=>P(0,"DIMENSION",8,0,2,"*NONE",10,x,20,y,11,x,21,y,70,t,42,meas,1,ov);
  // border + title block
  [[0,0,297,0],[297,0,297,210],[297,210,0,210],[0,210,0,0],[10,10,287,10],[287,10,287,200],[287,200,10,200],[10,200,10,10],[187,10,187,40],[187,40,287,40],[187,25,287,25],[237,10,237,40]].forEach(a=>line(...a));
  text(190,33,3.5,"PART NO: EX-2040"); text(240,33,3.5,"REV: B"); text(190,18,3,"NAME: MOUNTING PLATE"); text(240,18,3,"MATL: EN8 / C45");
  // plate 140 x 90 at (40,70)
  [[40,70,180,70],[180,70,180,160],[180,160,40,160],[40,160,40,70]].forEach(a=>line(...a));
  [[52,82],[168,82],[52,148],[168,148]].forEach(([x,y])=>circ(x,y,5)); circ(110,115,16);
  // dimension graphics (simple)
  line(40,170,180,170); line(40,160,40,173); line(180,160,180,173);
  line(190,70,190,160); line(180,70,193,70); line(180,160,193,160);
  line(126,115,140,128); line(57,148,70,158);
  dim(110,174,0,140,"<>%%p0.2"); dim(197,115,0,90,"<>"); dim(152,131,3,32,"%%c<>{\\H0.7x;\\S+0.025^0;}");
  dim(80,161,3,10,"4X %%c<>%%p0.1"); dim(52,62,0,12,"<>"); text(60,55,3,"R2 ALL CORNERS");
  P(0,"TOLERANCE",8,0,10,138,20,98,40,3,1,"{\\Fgdt;j}%%v{\\Fgdt;n}0.05{\\Fgdt;m}%%vA%%vB%%vC");
  text(40,40,3.5,"Ra 1.6"); text(40,30,3,"NOTE: HARDEN AND TEMPER 28-32 HRC"); text(120,52,3.5,"M8x1.25-6H THRU");
  P(0,"ENDSEC",0,"EOF");
  return o.join("\n");
}
$("bSample").onclick=()=>{ const f=new File([sampleDxf()],"EX-2040_sample.dxf",{type:"application/dxf"}); loadFile(f); };

/* ---------- layout: drawing / drawing+table / side by side / table ---------- */
const stacked=()=>$("work").classList.contains("m-stack")||matchMedia("(max-width:900px)").matches;
document.querySelectorAll(".seg [data-m]").forEach(b=>b.onclick=()=>{
  const m=b.dataset.m, w=$("work"); ["m-draw","m-table","m-stack"].forEach(c=>w.classList.remove(c));
  if(m==="draw") w.classList.add("m-draw"); if(m==="table") w.classList.add("m-table"); if(m==="stack") w.classList.add("m-stack");
  document.querySelectorAll(".seg [data-m]").forEach(x=>x.setAttribute("aria-pressed",x===b)); requestAnimationFrame(()=>{resize();fit();});
});
{ const sp=$("split"), w=$("work"); let on=false;
  sp.addEventListener("pointerdown",e=>{on=true;sp.setPointerCapture(e.pointerId);sp.classList.add("drag");});
  sp.addEventListener("pointermove",e=>{ if(!on) return; const r=w.getBoundingClientRect();
    if(stacked()) w.style.setProperty("--tableH",Math.min(r.height-120,Math.max(110,r.bottom-e.clientY))+"px");
    else w.style.setProperty("--split",Math.min(85,Math.max(15,(e.clientX-r.left)/r.width*100))+"%"); });
  const end=()=>{ if(!on) return; on=false; sp.classList.remove("drag"); fit(); };
  sp.addEventListener("pointerup",end); sp.addEventListener("pointercancel",end);
  sp.addEventListener("keydown",e=>{ const r=w.getBoundingClientRect();
    if(stacked()&&(e.key==="ArrowUp"||e.key==="ArrowDown")){ const cur=parseFloat(w.style.getPropertyValue("--tableH"))||300; w.style.setProperty("--tableH",Math.min(r.height-120,Math.max(110,cur+(e.key==="ArrowUp"?30:-30)))+"px"); fit(); }
    if(!stacked()&&(e.key==="ArrowLeft"||e.key==="ArrowRight")){ const cur=parseFloat(w.style.getPropertyValue("--split"))||56; w.style.setProperty("--split",Math.min(85,Math.max(15,cur+(e.key==="ArrowRight"?3:-3)))+"%"); fit(); } });
}
/* one settings popover open at a time; click outside closes */
document.querySelectorAll(".phead details").forEach(d=>d.addEventListener("toggle",()=>{ if(d.open) document.querySelectorAll(".phead details").forEach(o=>{ if(o!==d) o.open=false; }); }));
document.addEventListener("pointerdown",e=>{ if(!e.target.closest(".phead details")) document.querySelectorAll(".phead details[open]").forEach(d=>d.open=false); });

/* ---------- API used by the hosted (cloud) version ---------- */
function getSnapshot(){ return {v:1,fileName:S.fileName,header:{...S.header},set:{...S.set},
  items:S.items.map(({id,sheet,ax,ay,bx,by,type,text,nominal,upper,lower,unit,gdt,datum,cls,actual,conf,gen,instr,source,en,ex,autoInstr})=>({id,sheet,ax,ay,bx,by,type,text,nominal,upper,lower,unit,gdt,datum,cls,actual,conf,gen,instr,source,en,ex,autoInstr}))}; }
function applySnapshot(p){
  S.header=Object.assign({},S.header,p.header||{}); Object.assign(S.set,p.set||{});
  $("sGen").value=S.set.gen; $("sGrid").value=S.set.grid; $("sCols").value=S.set.cols; $("sRows").value=S.set.rows; $("sSize").value=String(S.set.size); $("sTiles").value=String(S.set.tiles);
  S.items=(p.items||[]).filter(i=>i.sheet<S.sheets.length).map(i=>({...i})); S.nextId=Math.max(1,...S.items.map(i=>i.id+1)); S.sel=null;
  syncHeader(); setSum(); applyLanguage();
}
function setReadonly(on){ S.readonly=!!on; document.body.classList.toggle("readonly",!!on); renderAll(); }
window.BI={S,loadFile,renderAll,syncHeader,toast,busy,getSnapshot,applySnapshot,setReadonly,fit,resize,exportPDF};

/* ---------- runtime ---------- */
if(!window.claude) $("bAI").hidden=true;
(async()=>{
  try{ sample=await window.claude?.use("sample"); if(sample){ const l=await sample.limits().catch(()=>null); imgLimits=l&&l.images?l.images:null; } }catch(e){ sample=null; }
  try{ downloads=await window.claude?.use("downloads"); }catch(e){ downloads=null; }
  renderAll();
})();
syncHeader(); setSum(); renderAll();
{ const ok=convertersAllowed()&&typeof DecompressionStream!=="undefined"; const el=$("convStatus"); el.className="conv "+(ok?"ok":"no");
  el.textContent=ok?"DWG and STEP converter ready — runs on this device, free.":"DWG and STEP conversion isn't available in this viewer. Save as DXF or PDF with a free tool (LibreCAD, ODA File Converter, FreeCAD) and open that."; }

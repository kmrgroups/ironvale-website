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
function setFavicon(dataUrl){ let l=document.querySelector("link[rel=icon]"); if(!l){ l=document.createElement("link"); l.rel="icon"; document.head.append(l); } l.href=dataUrl; }
function brand(){ const o=C.org; const h1=document.querySelector(".brand h1"), sm=document.querySelector(".brand small"), mark=document.querySelector(".brand .mark");
  h1.textContent = APP; sm.textContent = o ? o.name : "";
  if (o && o.logo){ mark.innerHTML=`<img src="${o.logo}" alt="" style="width:34px;height:34px;object-fit:contain;border-radius:6px;background:#fff">`; mark.style.border="none"; mark.style.setProperty("--x","none"); mark.classList.add("haslogo"); setFavicon(o.logo); }
  else { mark.textContent="1"; mark.style.border=""; mark.classList.remove("haslogo"); }
  document.title = (o ? o.name + " – " : "") + APP;
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

/* ---------- sign in ---------- */
function loginScreen(msg){
  veil(`<div class="cl-row" style="margin-bottom:14px"><div class="mark" style="width:36px;height:36px">1</div><div><h2>${esc(APP)}</h2></div></div>
  <p class="sub">Sign in with the e-mail your company admin added.</p>
  <label>E-mail<input id="clEmail" type="email" autocomplete="username"></label>
  <label>Password<input id="clPass" type="password" autocomplete="current-password"></label>
  <div class="cl-err" id="clErr">${esc(msg||"")}</div>
  <div class="cl-row"><button class="btn primary" id="clIn">Sign in</button><button class="btn" id="clUp">Create account</button></div>
  <div class="cl-row" style="margin-top:10px"><button class="cl-link" id="clForgot">Forgot password?</button></div>`);
  const em=$("clEmail"), pw=$("clPass"), err=$("clErr");
  $("clIn").onclick = async()=>{ err.textContent=""; const {error}=await sb.auth.signInWithPassword({email:em.value.trim(),password:pw.value}); if(error) err.textContent=nice(error); };
  pw.onkeydown = e=>{ if(e.key==="Enter") $("clIn").click(); };
  $("clUp").onclick = async()=>{ err.textContent=""; if(pw.value.length<8){ err.textContent="Use a password of at least 8 characters."; return; }
    const {data,error}=await sb.auth.signUp({email:em.value.trim(),password:pw.value,options:{emailRedirectTo:location.href.split("#")[0]}});
    if(error){ err.textContent=nice(error); return; }
    if(!data.session){ err.className="cl-ok"; err.textContent="Account created. Open the confirmation e-mail we sent, then sign in here."; } };
  $("clForgot").onclick = async()=>{ if(!em.value.trim()){ err.textContent="Type your e-mail first."; return; }
    const {error}=await sb.auth.resetPasswordForEmail(em.value.trim(),{redirectTo:location.href.split("#")[0]});
    err.className=error?"cl-err":"cl-ok"; err.textContent=error?nice(error):"Check your e-mail for a reset link."; };
  setTimeout(()=>em.focus(),50);
}
function nice(e){ const m=String(e&&e.message||e); if(/Invalid login/i.test(m)) return "Wrong e-mail or password."; if(/Email not confirmed/i.test(m)) return "Please confirm your e-mail first (check your inbox)."; if(/rate limit/i.test(m)) return "Too many attempts – wait a minute and try again."; return m; }
function newPasswordScreen(){
  veil(`<h2>Set a new password</h2><p class="sub">Choose a password of at least 8 characters.</p>
  <label>New password<input id="clNp" type="password" autocomplete="new-password"></label><div class="cl-err" id="clErr"></div>
  <button class="btn primary" id="clNpGo">Save password</button>`);
  $("clNpGo").onclick=async()=>{ const v=$("clNp").value; if(v.length<8){ $("clErr").textContent="At least 8 characters."; return; }
    const {error}=await sb.auth.updateUser({password:v}); if(error){ $("clErr").textContent=nice(error); return; } closeVeil(); start(); };
}

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
  const tabs=[]; if(C.role==="admin") tabs.push(["company","Company"],["users","Users"]); if(C.platform) tabs.push(["companies","Customer workspaces"]); tabs.push(["guide","Deployment guide"]);
  veil(`<div class="cl-row" style="justify-content:space-between"><h2>Admin</h2><button class="btn" id="clX">Close</button></div>
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
      <div class="cl-row"><img class="cl-logo" id="coPrev" src="${o.logo||""}" alt="" ${o.logo?"":"hidden"}><button class="btn" id="coRm" ${o.logo?"":"hidden"}>Remove logo</button></div></div>
      <div style="flex:1;min-width:260px"><label>Default general tolerance<select id="coGen">${["none","f","m","c"].map(v=>`<option value="${v}"${(s.gen||"m")===v?" selected":""}>${v==="none"?"Don't apply":"ISO 2768-"+v}</option>`).join("")}</select></label>
      <label>Default grid zone style<select id="coGrid"><option value="iso"${s.grid!=="asme"?" selected":""}>Numbers left→right, letters top→down</option><option value="asme"${s.grid==="asme"?" selected":""}>Numbers right→left, letters bottom→up</option></select></label>
      <div class="cl-row"><label style="flex:1">Grid columns<input id="coCols" type="number" min="1" max="24" value="${s.cols||8}"></label><label style="flex:1">Grid rows<input id="coRows" type="number" min="1" max="20" value="${s.rows||6}"></label></div></div></div>
      <div class="cl-err" id="coErr"></div><button class="btn primary" id="coSave">Save company settings</button>`;
    let logo=o.logo||null;
    $("coLogo").onchange=async e=>{ const f=e.target.files[0]; if(!f) return; logo=await shrinkLogo(f); $("coPrev").src=logo; $("coPrev").hidden=false; $("coRm").hidden=false; };
    $("coRm").onclick=()=>{ logo=null; $("coPrev").hidden=true; $("coRm").hidden=true; };
    $("coSave").onclick=async()=>{ const upd={name:$("coName").value.trim()||o.name,logo,settings:{gen:$("coGen").value,grid:$("coGrid").value,cols:+$("coCols").value||8,rows:+$("coRows").value||6}};
      const {error}=await sb.from("bi_orgs").update(upd).eq("id",o.id); if(error){ $("coErr").textContent=error.message; return; }
      Object.assign(o,upd); const m=C.memberships.find(x=>x.id===o.id); if(m) Object.assign(m,upd);
      $("clOrg").querySelector(`option[value="${o.id}"]`).textContent=o.name; brand(); applyOrgDefaults(); $("coErr").className="cl-ok"; $("coErr").textContent="Saved."; };
  }
  if(t==="users"){
    P.innerHTML=`<p class="sub">Add a person's e-mail and role. They then open this page, choose <b>Create account</b> with that same e-mail, confirm it, and sign in.<br><b>Admin</b>: everything incl. users & company settings · <b>Editor</b>: create and edit reports · <b>Viewer</b>: open, print and export only.</p>
    <div class="cl-row" style="margin-bottom:12px"><input id="uEmail" type="email" placeholder="name@company.com" style="flex:1;min-width:220px"><select id="uRole"><option value="editor">Editor</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select><button class="btn primary" id="uAdd">Add user</button></div>
    <div class="cl-err" id="uErr"></div><div class="cl-list" id="uList"><div class="emptytable">Loading…</div></div>`;
    const load=async()=>{ const {data,error}=await sb.from("bi_members").select("email,role,created_at").eq("org_id",C.org.id).order("email");
      if(error){ $("uList").innerHTML=`<div class="emptytable">${esc(error.message)}</div>`; return; }
      $("uList").innerHTML=`<table><thead><tr><th>E-mail</th><th>Role</th><th>Added</th><th></th></tr></thead><tbody>${data.map(u=>`<tr><td>${esc(u.email)}</td><td><select data-role="${esc(u.email)}">${["admin","editor","viewer"].map(r=>`<option${r===u.role?" selected":""}>${r}</option>`).join("")}</select></td><td>${new Date(u.created_at).toLocaleDateString()}</td><td><button class="del" data-rm="${esc(u.email)}" title="Remove">×</button></td></tr>`).join("")}</tbody></table>`; };
    $("uAdd").onclick=async()=>{ const email=$("uEmail").value.trim().toLowerCase(); if(!/^\S+@\S+\.\S+$/.test(email)){ $("uErr").textContent="Enter a valid e-mail."; return; }
      const {error}=await sb.from("bi_members").insert({org_id:C.org.id,email,role:$("uRole").value}); $("uErr").textContent=error?(/duplicate/i.test(error.message)?"That e-mail is already added.":error.message):""; if(!error){ $("uEmail").value=""; load(); } };
    $("uList").onchange=async e=>{ const s=e.target.closest("[data-role]"); if(!s) return; const {error}=await sb.from("bi_members").update({role:s.value}).eq("org_id",C.org.id).eq("email",s.dataset.role); if(error) BI.toast(error.message); };
    $("uList").onclick=async e=>{ const b=e.target.closest("[data-rm]"); if(!b) return; if(b.dataset.rm===(C.user.email||"").toLowerCase()&&!confirm("Remove yourself? You'll lose access to this workspace.")) return;
      if(!confirm("Remove "+b.dataset.rm+"?")) return; const {error}=await sb.from("bi_members").delete().eq("org_id",C.org.id).eq("email",b.dataset.rm); if(error) BI.toast(error.message); load(); };
    load();
  }
  if(t==="companies"){
    P.innerHTML=`<p class="sub">Each customer company gets its own private workspace: its own users, logo and reports. Nobody sees another company's data.</p>
    <div class="cl-row" style="margin-bottom:12px"><input id="nName" placeholder="Company name" style="flex:1;min-width:180px"><input id="nAdmin" type="email" placeholder="Their admin's e-mail" style="flex:1;min-width:200px"><button class="btn primary" id="nGo">Create workspace</button></div>
    <div class="cl-err" id="nErr"></div><div class="cl-list" id="nList"><div class="emptytable">Loading…</div></div>`;
    const load=async()=>{ const {data,error}=await sb.from("bi_orgs").select("id,name,created_at").order("name"); if(error){ $("nList").innerHTML=`<div class="emptytable">${esc(error.message)}</div>`; return; }
      const {data:mem}=await sb.from("bi_members").select("org_id,email,role").eq("role","admin");
      $("nList").innerHTML=data.length?`<table><thead><tr><th>Company</th><th>Admins</th><th>Created</th><th></th></tr></thead><tbody>${data.map(o=>`<tr><td><b>${esc(o.name)}</b></td><td>${esc((mem||[]).filter(m=>m.org_id===o.id).map(m=>m.email).join(", "))}</td><td>${new Date(o.created_at).toLocaleDateString()}</td><td><button class="btn" data-join="${o.id}">Add me as admin</button></td></tr>`).join("")}</tbody></table>`:`<div class="emptytable">No workspaces yet.</div>`; };
    $("nGo").onclick=async()=>{ const name=$("nName").value.trim(), email=$("nAdmin").value.trim().toLowerCase(); $("nErr").textContent="";
      if(!name||!/^\S+@\S+\.\S+$/.test(email)){ $("nErr").textContent="Enter the company name and a valid admin e-mail."; return; }
      const {data,error}=await sb.from("bi_orgs").insert({name,settings:{gen:"m",grid:"iso",cols:8,rows:6}}).select("id").single(); if(error){ $("nErr").textContent=error.message; return; }
      const {error:e2}=await sb.from("bi_members").insert({org_id:data.id,email,role:"admin"}); if(e2){ $("nErr").textContent=e2.message; return; }
      $("nErr").className="cl-ok"; $("nErr").textContent=`Workspace created. Send ${email} this link and ask them to choose “Create account”: ${location.href.split("#")[0]}`; $("nName").value=""; $("nAdmin").value=""; load(); };
    $("nList").onclick=async e=>{ const b=e.target.closest("[data-join]"); if(!b) return; const {error}=await sb.from("bi_members").upsert({org_id:b.dataset.join,email:(C.user.email||"").toLowerCase(),role:"admin"}); if(error){ BI.toast(error.message); return; } closeVeil(); start(); };
    load();
  }
  if(t==="guide"){ P.innerHTML=`<div class="cl-guide">${GUIDE}</div>`; }
}
function shrinkLogo(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>{ const im=new Image(); im.onload=()=>{ const k=Math.min(1,256/Math.max(im.width,im.height)), c=document.createElement("canvas"); c.width=Math.round(im.width*k); c.height=Math.round(im.height*k); c.getContext("2d").drawImage(im,0,0,c.width,c.height); res(c.toDataURL("image/png")); }; im.onerror=rej; im.src=r.result; }; r.onerror=rej; r.readAsDataURL(f); }); }

const GUIDE = `
<p>This tool runs from a web page plus a free Supabase database. The same files serve every customer: each customer company is a separate <b>workspace</b> with its own users, logo and reports.</p>
<h3>A. Add a new customer on the shared site (2 minutes)</h3>
<ol><li>Admin → <b>Customer workspaces</b> → type the company name and their admin's e-mail → <b>Create workspace</b>.</li>
<li>Send them the page link. They choose <b>Create account</b> with that e-mail, confirm the e-mail, and sign in.</li>
<li>Their admin uploads their logo (Admin → Company) and adds their own people (Admin → Users).</li></ol>
<h3>B. Give a customer their own private copy (own database, own domain)</h3>
<ol><li>They create a free Supabase project and run <code>supabase/schema.sql</code> in its SQL Editor.</li>
<li>Copy the project URL and the <i>anon public</i> key (Project Settings → API) into <code>balloon/config.js</code>.</li>
<li>Upload <code>balloon.html</code> and the <code>balloon</code> folder to any web host (their website, Vercel, Netlify – all free).</li>
<li>In Supabase → Authentication → URL Configuration, set the Site URL to their page address.</li>
<li>Sign up once in the page, then run the last SQL lines in schema.sql to make that e-mail the owner; create their workspace under Admin.</li></ol>
<h3>Free-plan limits to keep in mind</h3>
<p>Supabase free: 500 MB database, 1 GB file storage (roughly 300–1,000 drawings), projects pause after 7 days without use – open the page once a week or upgrade when a customer relies on it daily.</p>`;

/* ---------- boot ---------- */
sb.auth.onAuthStateChange((ev)=>{ if(ev==="PASSWORD_RECOVERY") newPasswordScreen(); else if(ev==="SIGNED_IN"&&!C.user) setTimeout(start,0); else if(ev==="SIGNED_OUT"){ C.user=null; loginScreen(); } });
window.addEventListener("beforeunload",e=>{ if(C.dirty){ e.preventDefault(); e.returnValue=""; } });
(async()=>{ const {data:{session}}=await sb.auth.getSession(); if(!session) loginScreen(); else start(); })();
})();

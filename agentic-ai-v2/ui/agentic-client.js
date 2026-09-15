/* Ironvale Agentic AI V2 browser client. Uses the existing signed-in session token. */
export async function agenticGet(what='registry'){
  const r=await fetch('/api/agentic?what='+encodeURIComponent(what),{headers:{'X-Auth-Token':sessionStorage.getItem('idms_token')||''},cache:'no-store'});
  return r.json();
}
export async function agenticRun(agentId,opts={}){
  const r=await fetch('/api/agentic',{method:'POST',headers:{'Content-Type':'application/json','X-Auth-Token':sessionStorage.getItem('idms_token')||''},body:JSON.stringify({agentId,...opts})});
  return r.json();
}
export async function agenticDryRun(agentId,opts={}){ return agenticRun(agentId,{...opts,dryRun:true}); }

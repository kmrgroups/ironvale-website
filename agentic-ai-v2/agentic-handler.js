// Agentic AI V2 — governed orchestration layer for the Ironvale/Elixir Tec IDMS.
// Additive endpoint: it reuses the existing /api/ai gateway and idms_docs store.
// No approval, release, dispatch, payment, employee-status or G-code action is executable here.
import fs from 'node:fs';
import path from 'node:path';
import { sql, ensureTables, tokenUser, cors, readBody } from '../server/_db.js';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const REGISTRY = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent-registry.json'), 'utf8'));
const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, 'action-policy.json'), 'utf8'));

function clean(s, n=4000){ return String(s ?? '').slice(0,n); }
function id(prefix){ return prefix + '-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,7).toUpperCase(); }
function today(){ return new Date().toISOString().slice(0,10); }

async function auth(req,res){
  const token = req.headers['x-auth-token'] || '';
  const u = await tokenUser(token);
  if(!u){ res.status(401).json({ok:false,error:'Sign in to use Agentic AI.'}); return null; }
  return u;
}

async function docs(kind, limit=250){
  const rows = await sql`SELECT doc_id,kind,part_id,doc_no,rev,status,data,created_at,updated_at,updated_by
    FROM idms_docs WHERE kind=${kind} ORDER BY updated_at DESC LIMIT ${Math.min(1000,Math.max(1,limit))}`;
  return rows.map(r=>({docId:r.doc_id,kind:r.kind,partId:r.part_id,docNo:r.doc_no,rev:r.rev,status:r.status,data:r.data,updatedAt:r.updated_at,updatedBy:r.updated_by}));
}
async function parts(limit=500){
  const rows=await sql`SELECT part_id,customer,part_no,part_name,lifecycle,quote_ref,data,created_at,updated_at
    FROM idms_parts ORDER BY updated_at DESC LIMIT ${Math.min(1000,Math.max(1,limit))}`;
  return rows;
}
async function cnc(kind, limit=250){
  if(kind==='cnc_machine'){
    const r=await sql`SELECT machine_id,name,controller,adapter,enabled,state,updated_at FROM cnc_machines WHERE enabled=true ORDER BY machine_id LIMIT ${limit}`; return r;
  }
  if(kind==='cnc_event'){
    const r=await sql`SELECT id,machine_id,event_type,part_no,program,tool_no,part_count,cycle_time_sec,ideal_cycle_sec,alarm_code,alarm_text,data,at FROM cnc_events ORDER BY at DESC LIMIT ${limit}`; return r;
  }
  if(kind==='cnc_tool_life'){
    const r=await sql`SELECT * FROM cnc_tool_life ORDER BY updated_at DESC LIMIT ${limit}`; return r;
  }
  return [];
}

async function collect(agent, extra={}){
  const out={};
  const unique=[...new Set(agent.reads||[])];
  for(const kind of unique){
    try{
      if(kind==='parts'||kind==='part') out.parts=await parts(500);
      else if(kind.startsWith('cnc_')) out[kind]=await cnc(kind,300);
      else out[kind]=await docs(kind,250);
    }catch(e){ out[kind]={error:clean(e.message,500)}; }
  }
  out.context=extra;
  return out;
}

function deterministicSummary(data){
  const count=(k)=>Array.isArray(data[k])?data[k].length:0;
  return {
    recordCounts:Object.fromEntries(Object.keys(data).filter(k=>k!=='context').map(k=>[k,count(k)])),
    generatedOn:new Date().toISOString(),
    ruleNote:'The AI must not invent measurements, dates, causes, statuses or ownership. It may only rank or explain facts present in the supplied records.'
  };
}

function taskBlocks(text){
  const result=[];
  const chunks=String(text||'').split(/^\s*TASK\s*$/mi);
  for(let i=1;i<chunks.length;i++){
    const b=chunks[i];
    const get=(key)=>{ const m=b.match(new RegExp('^\\s*'+key+'\\s*:\\s*(.+?)\\s*$', 'mi')); return m?m[1].trim():''; };
    const title=get('TITLE'); if(!title) continue;
    let due=get('DUE'); if(!/^\d{4}-\d{2}-\d{2}$/.test(due)) due=today();
    let priority=get('PRIORITY'); if(!['Normal','High','Stop the line'].includes(priority)) priority='Normal';
    result.push({title:clean(title,240),owner:clean(get('OWNER')||'Not yet assigned',160),dueOn:due,priority});
  }
  return result.slice(0,3);
}

async function callExistingAI(req, prompt, system){
  const host=req.headers['x-forwarded-host'] || req.headers.host;
  const proto=req.headers['x-forwarded-proto'] || 'https';
  if(!host) throw new Error('Cannot determine deployment host for the existing AI gateway.');
  const url=`${proto}://${host}/api/ai`;
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,system,maxTokens:2200})});
  const j=await r.json();
  if(!j.ok) throw new Error(j.error||'Existing AI gateway failed.');
  return j;
}

async function saveRun(agent, user, status, inputSummary, output, meta={}){
  const runId=id('AGRUN');
  await sql`INSERT INTO idms_docs(doc_id,kind,part_id,doc_no,rev,status,data,updated_by)
    VALUES(${runId},'agent_run','',${agent.id+'-'+today()},'1',${status},${JSON.stringify({runId,agentId:agent.id,agentName:agent.name,trigger:meta.trigger||'manual',startedAt:meta.startedAt||new Date().toISOString(),completedAt:new Date().toISOString(),user:user.username,inputSummary,output,governance:POLICY})}::jsonb,${user.username})
    ON CONFLICT(doc_id) DO UPDATE SET data=EXCLUDED.data,status=EXCLUDED.status,updated_at=now(),updated_by=EXCLUDED.updated_by`;
  return runId;
}

async function saveTasks(agent,user,tasks,source){
  const ids=[];
  for(const t of tasks){
    const taskId=id('TASK');
    await sql`INSERT INTO idms_docs(doc_id,kind,part_id,doc_no,rev,status,data,updated_by)
      VALUES(${taskId},'task','',${taskId},'0','Open',${JSON.stringify({title:t.title,owner:t.owner,dueOn:t.dueOn,priority:t.priority,source,raisedOn:today(),raisedBy:'AI agent',aiProposed:true})}::jsonb,${user.username})`;
    ids.push(taskId);
  }
  return ids;
}

function agentById(id){ return REGISTRY.agents.find(a=>a.id===id); }

export default async function handler(req,res){
  cors(res); if(req.method==='OPTIONS') return res.status(200).end();
  try{ await ensureTables();
    if(req.method==='GET'){
      const u=await auth(req,res); if(!u)return;
      const q=req.query||{};
      if(q.what==='registry') return res.status(200).json({ok:true,registry:REGISTRY,policy:POLICY});
      if(q.what==='runs'){
        const rows=await docs('agent_run',100); return res.status(200).json({ok:true,runs:rows});
      }
      return res.status(200).json({ok:true,version:REGISTRY.version,agents:REGISTRY.agents.length,policy:POLICY});
    }
    if(req.method!=='POST') return res.status(405).json({ok:false,error:'Use GET or POST'});
    const u=await auth(req,res); if(!u)return;
    const b=readBody(req); const agent=agentById(String(b.agentId||''));
    if(!agent) return res.status(400).json({ok:false,error:'Unknown agentId.'});
    const startedAt=new Date().toISOString();
    const data=await collect(agent,{eventType:b.eventType||'MANUAL',entityType:b.entityType||'',entityId:b.entityId||'',note:b.note||''});
    const summary=deterministicSummary(data);
    if(b.dryRun) return res.status(200).json({ok:true,dryRun:true,agent,summary,dataPreview:data});
    const system=`You are the ${agent.name} for a manufacturing IDMS. Follow these governance rules strictly: ${POLICY.principles.join(' ')} Never claim facts not present in the supplied records. Never approve, release, dispatch, purchase, pay, terminate, stop a machine, alter quality status or post G-code. Your output must be concise. After the explanation, add zero to three TASK blocks only for genuinely necessary reviewable internal actions. TASK format: TASK / TITLE: ... / OWNER: ... / DUE: YYYY-MM-DD / PRIORITY: Normal|High|Stop the line / END.`;
    const prompt=`Agent: ${agent.name}\nDepartment: ${agent.department}\nTrigger: ${b.eventType||'MANUAL'}\n\nDeterministic record counts:\n${JSON.stringify(summary.recordCounts,null,2)}\n\nData:\n${JSON.stringify(data).slice(0,90000)}\n\nGive: 1) top findings ranked by business risk, 2) evidence references using record IDs where present, 3) practical options, 4) only then TASK blocks for human review. Do not invent missing facts.`;
    const ai=await callExistingAI(req,prompt,system);
    const tasks=taskBlocks(ai.text);
    const taskIds=await saveTasks(agent,u,tasks,agent.name);
    const narrative=String(ai.text).split(/^\s*TASK\s*$/mi)[0].trim();
    const runId=await saveRun(agent,u,'Completed',summary,{provider:ai.provider,model:ai.model,narrative,taskIds}, {trigger:b.eventType||'MANUAL',startedAt});
    return res.status(200).json({ok:true,runId,agentId:agent.id,provider:ai.provider,model:ai.model,narrative,taskIds,taskCount:taskIds.length,governance:POLICY});
  }catch(e){ console.log('agentic v2 error:',e.message); return res.status(500).json({ok:false,error:e.message}); }
}

// Universal CNC / machine telemetry endpoint for IDMS.
// The browser never connects directly to a CNC. A factory-LAN edge gateway
// posts normalized machine state here. The UI reads the same normalized model
// regardless of controller/vendor.
import { sql, ensureTables, checkRole, cors, readBody, tokenUser } from './_db.js';

export const config = { api: { bodyParser: { sizeLimit: '256kb' } } };
const gatewayKey = () => process.env.CNC_GATEWAY_KEY || process.env.MACHINE_GATEWAY_KEY || '';

async function tables() {
  await ensureTables();
  await sql`CREATE TABLE IF NOT EXISTS cnc_machines (
    machine_id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    controller TEXT NOT NULL DEFAULT '',
    adapter TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT true,
    state JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS cnc_events (
    id BIGSERIAL PRIMARY KEY,
    machine_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    part_no TEXT DEFAULT '',
    program TEXT DEFAULT '',
    tool_no TEXT DEFAULT '',
    part_count INTEGER DEFAULT 0,
    cycle_time_sec NUMERIC DEFAULT 0,
    ideal_cycle_sec NUMERIC DEFAULT 0,
    alarm_code TEXT DEFAULT '',
    alarm_text TEXT DEFAULT '',
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS cnc_events_machine_at ON cnc_events (machine_id, at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS cnc_events_type_at ON cnc_events (event_type, at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS cnc_tool_life (
    id BIGSERIAL PRIMARY KEY,
    machine_id TEXT NOT NULL,
    part_no TEXT DEFAULT '',
    operation TEXT DEFAULT '',
    tool_no TEXT NOT NULL,
    life_limit_parts INTEGER NOT NULL DEFAULT 0,
    baseline_part_count INTEGER NOT NULL DEFAULT 0,
    current_part_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(machine_id, part_no, operation, tool_no)
  )`;
}

async function user(req, res) {
  const token = req.headers['x-auth-token'] || '';
  const u = await tokenUser(token);
  if (!u) { res.status(401).json({ ok:false, error:'Sign in to use machine monitoring.' }); return null; }
  return u;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    await tables();
    const body = req.method === 'GET' ? {} : readBody(req);
    const q = req.query || {};

    // Edge gateway ingestion is authenticated with a separate secret and does
    // not require a human login. Keep this endpoint private at the network edge.
    if (req.method === 'POST' && String(q.what || body.what || '') === 'state') {
      const supplied = String(req.headers['x-machine-gateway-key'] || body.gatewayKey || '');
      if (!gatewayKey() || supplied !== gatewayKey()) return res.status(401).json({ ok:false, error:'Invalid machine gateway key.' });
      const s = body;
      if (!s.machineId) return res.status(400).json({ ok:false, error:'machineId is required.' });
      const prevRows = await sql`SELECT state FROM cnc_machines WHERE machine_id=${String(s.machineId)}`;
      const prev = prevRows[0]?.state || {};
      const state = { ...s, partCount:Number(s.partCount||0), cycleTimeSec:Number(s.cycleTimeSec||0), idealCycleSec:Number(s.idealCycleSec||0) };
      await sql`INSERT INTO cnc_machines (machine_id,name,controller,adapter,state,updated_at)
        VALUES (${String(s.machineId)},${String(s.name||s.machineId)},${String(s.controller||'')},${String(s.adapter||'')},${JSON.stringify(state)}::jsonb,now())
        ON CONFLICT(machine_id) DO UPDATE SET name=EXCLUDED.name, controller=EXCLUDED.controller, adapter=EXCLUDED.adapter, state=EXCLUDED.state, updated_at=now()`;

      const events=[];
      if (prev.partCount !== state.partCount) events.push(['PART_COMPLETE', state.partCount]);
      if (String(prev.status||'') !== String(state.status||'')) events.push(['STATUS_CHANGE', state.partCount]);
      if (String(prev.alarmCode||'') !== String(state.alarmCode||'')) events.push([state.alarmCode ? 'ALARM_ON' : 'ALARM_OFF', state.partCount]);
      for (const [type,count] of events) await sql`INSERT INTO cnc_events(machine_id,event_type,part_no,program,tool_no,part_count,cycle_time_sec,ideal_cycle_sec,alarm_code,alarm_text,data)
        VALUES(${String(s.machineId)},${type},${String(s.partNo||'')},${String(s.program||'')},${String(s.toolNumber||'')},${count},${state.cycleTimeSec},${state.idealCycleSec},${String(s.alarmCode||'')},${String(s.alarmText||'')},${JSON.stringify(state)}::jsonb)`;
      return res.status(200).json({ok:true, recorded:true, events:events.length});
    }

    const u = await user(req,res); if (!u) return;
    const what = String(q.what || 'machines');
    if (what === 'machines') {
      const rows = await sql`SELECT machine_id,name,controller,adapter,enabled,state,updated_at FROM cnc_machines WHERE enabled=true ORDER BY machine_id`;
      return res.status(200).json({ok:true,machines:rows});
    }
    if (what === 'events') {
      const machine = String(q.machineId||''); const limit=Math.min(500,Math.max(1,parseInt(q.limit,10)||100));
      const rows = machine ? await sql`SELECT * FROM cnc_events WHERE machine_id=${machine} ORDER BY at DESC LIMIT ${limit}` : await sql`SELECT * FROM cnc_events ORDER BY at DESC LIMIT ${limit}`;
      return res.status(200).json({ok:true,events:rows});
    }
    if (what === 'summary') {
      const rows = await sql`SELECT machine_id,name,controller,state,updated_at FROM cnc_machines WHERE enabled=true ORDER BY machine_id`;
      const machines = rows.map(r => ({...r, state:r.state||{}}));
      const counts = machines.reduce((a,m)=>{ const s=String(m.state.status||'UNKNOWN').toUpperCase(); a[s]=(a[s]||0)+1; return a; },{});
      const total = machines.reduce((n,m)=>n+Number(m.state.partCount||0),0);
      return res.status(200).json({ok:true,summary:{totalPartCount:total,statusCounts:counts,machines}});
    }
    if (what === 'tool-life') {
      const machine=String(q.machineId||'');
      const rows = machine ? await sql`SELECT * FROM cnc_tool_life WHERE machine_id=${machine} ORDER BY updated_at DESC` : await sql`SELECT * FROM cnc_tool_life ORDER BY updated_at DESC LIMIT 500`;
      return res.status(200).json({ok:true,tools:rows});
    }
    if (what === 'set-tool-life' && req.method === 'POST') {
      if (!(await checkRole(req.headers['x-auth-token']||'', ['developer','admin']))) return res.status(403).json({ok:false,error:'Only an administrator may change tool-life standards.'});
      const x=body; if(!x.machineId||!x.toolNo) return res.status(400).json({ok:false,error:'Machine and tool are required.'});
      await sql`INSERT INTO cnc_tool_life(machine_id,part_no,operation,tool_no,life_limit_parts,baseline_part_count,current_part_count)
        VALUES(${x.machineId},${x.partNo||''},${x.operation||''},${x.toolNo},${Math.max(0,Number(x.lifeLimitParts||0))},${Number(x.baselinePartCount||0)},${Number(x.currentPartCount||0)})
        ON CONFLICT(machine_id,part_no,operation,tool_no) DO UPDATE SET life_limit_parts=EXCLUDED.life_limit_parts, baseline_part_count=EXCLUDED.baseline_part_count, current_part_count=EXCLUDED.current_part_count, updated_at=now()`;
      return res.status(200).json({ok:true});
    }
    return res.status(400).json({ok:false,error:'Unknown CNC request.'});
  } catch(e) {
    console.log('cnc error:',e.message);
    return res.status(500).json({ok:false,error:e.message});
  }
}

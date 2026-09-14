import fs from 'node:fs/promises';
import { read as readMt } from './adapters/mtconnect.mjs';
import { read as readHttp } from './adapters/http-json.mjs';
import { read as readSim } from './adapters/simulator.mjs';

const cfg = JSON.parse(await fs.readFile(new URL('./config.json', import.meta.url), 'utf8').catch(() => fs.readFile(new URL('./config.example.json', import.meta.url), 'utf8')));
const adapters = { mtconnect: readMt, 'http-json': readHttp, simulator: readSim };
const states = new Map();

async function poll(machine) {
  try {
    const fn = adapters[machine.adapter];
    if (!fn) throw new Error(`Unsupported adapter: ${machine.adapter}`);
    const data = await fn(machine);
    const prev = states.get(machine.id);
    const state = { machineId: machine.id, name: machine.name, controller: machine.controller, ...data, at: new Date().toISOString() };
    states.set(machine.id, state);
    if (!prev || prev.partCount !== state.partCount || prev.status !== state.status || prev.alarmCode !== state.alarmCode) await push('state', state);
  } catch (e) {
    const state = { machineId: machine.id, name: machine.name, controller: machine.controller, online: false, status: 'OFFLINE', error: e.message, at: new Date().toISOString() };
    states.set(machine.id, state); await push('state', state);
  }
}
/* The endpoint is /api/cnc?what=state — NOT /api/cnc/state.
   This used to append '/state' to the path, which Vercel answers with a 404
   because api/cnc.js is routed to /api/cnc and nothing below it. No machine
   data ever reached the IDMS. `what` is also put in the body so the ingest
   still resolves if the query string is stripped by a proxy. */
async function push(what, payload) {
  const base = String(cfg.idmsIngestUrl).replace(/\/+$/, '');
  const url = base + (base.includes('?') ? '&' : '?') + 'what=' + encodeURIComponent(what);
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-machine-gateway-key': cfg.machineGatewayKey },
      body: JSON.stringify({ what, ...payload }),
      signal: AbortSignal.timeout(3000)
    });
  } catch (e) {
    /* A dropped link must not take the gateway down with it. Say so once and
       carry on polling: the next push sends the current state anyway. */
    console.error('IDMS unreachable:', e.message);
    return;
  }
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    console.error('IDMS ingest', r.status, text);
    if (r.status === 401) console.error('  -> machineGatewayKey does not match CNC_GATEWAY_KEY on the server.');
    if (r.status === 404) console.error('  -> idmsIngestUrl should end with /api/cnc');
  }
}
setInterval(() => cfg.machines.forEach(poll), Number(cfg.pollMs || 2000));
setInterval(async () => { for (const state of states.values()) await push('state', state); }, Number(cfg.pushMs || 2000));
console.log(`Ironvale Universal CNC Gateway running: ${cfg.machines.length} machine(s)`);
cfg.machines.forEach(poll);

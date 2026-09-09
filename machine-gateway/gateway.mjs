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
    if (!prev || prev.partCount !== state.partCount || prev.status !== state.status || prev.alarmCode !== state.alarmCode) await push('/state', state);
  } catch (e) {
    const state = { machineId: machine.id, name: machine.name, controller: machine.controller, online: false, status: 'OFFLINE', error: e.message, at: new Date().toISOString() };
    states.set(machine.id, state); await push('/state', state);
  }
}
async function push(path, payload) {
  const url = String(cfg.idmsIngestUrl).replace(/\/$/, '') + path;
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-machine-gateway-key': cfg.machineGatewayKey }, body: JSON.stringify(payload), signal: AbortSignal.timeout(3000) });
  if (!r.ok) console.error('IDMS ingest', r.status, await r.text());
}
setInterval(() => cfg.machines.forEach(poll), Number(cfg.pollMs || 2000));
setInterval(async () => { for (const state of states.values()) await push('/state', state); }, Number(cfg.pushMs || 2000));
console.log(`Ironvale Universal CNC Gateway running: ${cfg.machines.length} machine(s)`);
cfg.machines.forEach(poll);

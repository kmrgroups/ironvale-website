export async function read(machine) {
  const r = await fetch(machine.url, { headers: machine.headers || {}, signal: AbortSignal.timeout(Number(machine.timeoutMs || 1500)) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const x = await r.json();
  return normalize(x, machine.map || {});
}
function pick(o, path, fallback = undefined) {
  if (!path) return fallback;
  return path.split('.').reduce((v, k) => v == null ? undefined : v[k], o) ?? fallback;
}
function normalize(x, m) {
  return {
    online: true,
    status: String(pick(x,m.status,'UNKNOWN')).toUpperCase(),
    mode: String(pick(x,m.mode,'')), program: String(pick(x,m.program,'')),
    partCount: Number(pick(x,m.partCount,0)) || 0,
    goodCount: Number(pick(x,m.goodCount,0)) || 0,
    rejectCount: Number(pick(x,m.rejectCount,0)) || 0,
    cycleTimeSec: Number(pick(x,m.cycleTimeSec,0)) || 0,
    idealCycleSec: Number(pick(x,m.idealCycleSec,0)) || 0,
    toolNumber: String(pick(x,m.toolNumber,'')),
    toolLifeUsedParts: Number(pick(x,m.toolLifeUsedParts,0)) || 0,
    toolLifeLimitParts: Number(pick(x,m.toolLifeLimitParts,0)) || 0,
    alarmCode: String(pick(x,m.alarmCode,'')), alarmText: String(pick(x,m.alarmText,''))
  };
}

let count = 0;
let last = Date.now();
export async function read(machine) {
  const now = Date.now();
  if (now - last >= Math.max(1000, Number(machine.idealCycleSec || 260) * 1000)) {
    count += 1; last = now;
  }
  const cycle = Math.max(1, Math.round((now - last) / 1000));
  return {
    online: true,
    status: 'RUNNING',
    mode: 'AUTO',
    program: 'SIM-DEMO',
    partCount: count,
    goodCount: count,
    rejectCount: 0,
    cycleTimeSec: cycle,
    idealCycleSec: Number(machine.idealCycleSec || 260),
    toolNumber: 'T01',
    toolLifeUsedParts: count,
    toolLifeLimitParts: Number(machine.toolLifeParts || 500),
    alarmCode: '', alarmText: ''
  };
}

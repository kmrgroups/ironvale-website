export async function read(machine) {
  const base = String(machine.baseUrl || '').replace(/\/$/, '');
  const path = machine.devicePath || '/current';
  const url = base + (path.startsWith('/') ? path : '/' + path);
  const r = await fetch(url, { headers: { Accept: 'application/xml,text/xml,*/*' }, signal: AbortSignal.timeout(Number(machine.timeoutMs || 1800)) });
  if (!r.ok) throw new Error(`MTConnect HTTP ${r.status}`);
  const xml = await r.text();
  const text = tag(xml, 'PartCount') ?? tag(xml, 'PartCountActual') ?? '0';
  const execution = tag(xml, 'Execution') || '';
  const mode = tag(xml, 'ControllerMode') || tag(xml, 'Mode') || '';
  const program = tag(xml, 'Program') || tag(xml, 'ProgramComment') || '';
  const alarm = tag(xml, 'Alarm') || '';
  const tool = tag(xml, 'ToolNumber') || '';
  return {
    online: true,
    status: executionToStatus(execution, alarm), mode,
    program, partCount: Number(text) || 0,
    goodCount: Number(text) || 0, rejectCount: 0,
    cycleTimeSec: Number(tag(xml, 'CycleTime') || 0) || 0,
    idealCycleSec: Number(machine.idealCycleSec || 0) || 0,
    toolNumber: tool,
    toolLifeUsedParts: Number(tag(xml, 'ToolLifeUsedParts') || 0) || 0,
    toolLifeLimitParts: Number(tag(xml, 'ToolLifeLimitParts') || machine.toolLifeParts || 0) || 0,
    alarmCode: alarm ? String(tagAttr(xml, 'Alarm', 'nativeCode') || '') : '', alarmText: alarm
  };
}
function tag(xml, name) {
  const re = new RegExp(`<[^>]*${name}[^>]*>([^<]*)<\\/[^>]+>`, 'i');
  const m = xml.match(re); return m ? m[1].trim() : '';
}
function tagAttr(xml, name, attr) {
  const re = new RegExp(`<[^>]*${name}[^>]*\\b${attr}="([^"]*)"`, 'i');
  const m = xml.match(re); return m ? m[1] : '';
}
function executionToStatus(v, alarm) {
  if (alarm) return 'ALARM';
  const x = String(v).toUpperCase();
  if (x.includes('ACTIVE')) return 'RUNNING';
  if (x.includes('STOP')) return 'STOPPED';
  if (x.includes('READY')) return 'IDLE';
  return x || 'UNKNOWN';
}

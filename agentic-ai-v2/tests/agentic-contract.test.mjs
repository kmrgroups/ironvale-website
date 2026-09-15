import fs from 'node:fs';
import assert from 'node:assert/strict';
const base=new URL('../',import.meta.url).pathname;
const registry=JSON.parse(fs.readFileSync(base+'agent-registry.json','utf8'));
const policy=JSON.parse(fs.readFileSync(base+'action-policy.json','utf8'));
assert.equal(registry.version,'2.0.0');
assert.ok(registry.agents.length>=20);
const ids=new Set(registry.agents.map(a=>a.id));
assert.equal(ids.size,registry.agents.length);
for(const a of registry.agents){
  assert.ok(a.name&&a.department&&Array.isArray(a.reads)&&Array.isArray(a.triggers));
  assert.ok([0,1,2,3,4].includes(a.level));
  assert.ok(a.level<=2,'default package agents must remain reviewable');
}
for(const forbidden of ['release_gcode','approve_ncr','release_production','release_dispatch','post_payroll']) assert.ok(policy.neverAllowedByAgent.includes(forbidden)||policy.requiresNamedHumanApproval.includes(forbidden));
console.log(`Agentic contract OK: ${registry.agents.length} agents`);

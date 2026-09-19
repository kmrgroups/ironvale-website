import fs from 'node:fs';import assert from 'node:assert/strict';
const api=fs.readFileSync('api/index.js','utf8'),rfq=fs.readFileSync('server/routes/rfqs.js','utf8'),reg=JSON.parse(fs.readFileSync('agentic-ai-v2/agent-registry.json','utf8')),policy=JSON.parse(fs.readFileSync('agentic-ai-v2/ruflo-policy.json','utf8')),mcp=fs.readFileSync('server/routes/mcp.js','utf8');
assert.match(api,/mcp\.js/);assert.match(rfq,/triggerRufloRFQ/);assert.equal(reg.agents.find(a=>a.id==='rfq_estimator')?.orchestrator,'ruflo');assert.equal(policy.orchestrator,'ruflo');
for(const n of ['ironvale_get_rfq','ironvale_get_drawing','ironvale_get_part','ironvale_get_bom','ironvale_get_process','ironvale_get_machine_capability','ironvale_get_material_options','ironvale_get_quality_requirements','ironvale_get_previous_quotes','ironvale_get_costing_data','ironvale_save_ai_proposal'])assert.match(mcp,new RegExp(n));
for(const n of ['release_quotation','send_external_customer_message','create_purchase_order','approve_ppap','post_gcode','stop_machine'])assert.ok(policy.humanApprovalRequired.includes(n));
console.log('ruflo-rfq-contract: 0 failed');

# Ruflo RFQ workflow

Trigger: RFQ_CREATED or DRAWING_UPLOADED.

1. Collect facts with all IRONVALE MCP tools.
2. Run six specialist workers: Engineering, Material, Process, Machine, Costing, Quality.
3. Each worker returns facts, assumptions, missing information, risks, options and evidence/tool references.
4. Orchestrator combines outputs and never invents dimensions, tolerances, material grades, machine limits, cycle times or prices.
5. Save one proposal with ironvale_save_ai_proposal.
6. Saved status must be Draft - Human Review Required.
7. A signed-in IRONVALE user decides whether to create/release/send the quotation.

Required proposal fields: RFQ reference, customer/part, drawing/specification summary, material, process route, machine match, cycle-time assumptions, tooling assumptions, quality requirements, estimated cost, quotation recommendation, missing information and risk/review points.

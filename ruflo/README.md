# IRONVALE + Ruflo RFQ integration

IRONVALE stays the system of record. Ruflo is the external AI orchestrator.

Flow: Customer RFQ -> IRONVALE -> Ruflo -> Engineering/Material/Process/Machine/Costing/Quality AI -> IRONVALE draft -> human approval -> quotation.

Set Vercel variables: IRONVALE_MCP_KEY, optional RUFLO_TRIGGER_URL, optional RUFLO_TRIGGER_KEY, optional RUFLO_TRIGGER_TIMEOUT_MS.

IRONVALE exposes /api/mcp. Example Ruflo custom server:
\`\`\`json
{"mcpServers":{"ironvale":{"url":"https://YOUR-IRONVALE-DOMAIN/api/mcp","headers":{"X-MCP-Key":"\${IRONVALE_MCP_KEY}"}}}}
\`\`\`

Tools: ironvale_get_rfq, ironvale_get_drawing, ironvale_get_part, ironvale_get_bom, ironvale_get_process, ironvale_get_machine_capability, ironvale_get_material_options, ironvale_get_quality_requirements, ironvale_get_previous_quotes, ironvale_get_costing_data, ironvale_save_ai_proposal.

The write tool only saves Draft - Human Review Required. Ruflo must never release/send a quotation, create a PO, approve PPAP/PFMEA/Control Plan, release production, change quality acceptance, post G-code, change machine programs, or stop a machine.

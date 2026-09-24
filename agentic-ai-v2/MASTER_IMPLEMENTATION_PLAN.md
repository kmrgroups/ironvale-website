# Agentic AI V2 — Master Implementation Plan

## 1. Current platform baseline

The uploaded application is an integrated manufacturing/QMS/ERP-style IDMS with a central `idms_parts` spine, generic `idms_docs` records, a server-side `/api/ai` gateway, CNC telemetry gateway, existing agent runs, AI-proposed records, and a single Review Agent Work queue. Existing governance is retained: the agent looks, a person decides; deterministic rules establish facts and AI ranks/explains; every AI write is reviewable and auditable.

## 2. Target architecture

```text
Business event / scheduler
        |
        v
Agent Orchestrator
        |
        +--> deterministic collectors / rules
        |
        +--> existing /api/ai gateway
        |
        +--> structured proposal parser
        |
        v
Agent Run Log + AI Proposed Task
        |
        v
Review Agent Work
        |
        v
Named human decision
        |
        v
Existing IDMS workflow
```

## 3. Twenty agents

| Agent | Primary screen/module | Trigger | Reads | Output | Level |
|---|---|---|---|---|---:|
| Manufacturing Control Tower | Agentic AI | daily/critical | cross-functional | management tasks/escalation | 2 |
| RFQ & Estimation | RFQ Pipeline | RFQ/drawing | RFQ, parts, routing, costing | costing/quotation draft | 2 |
| Drawing Intelligence | Parts/NPD | drawing | drawing/dimensions/process/QMS | characteristic/consistency proposals | 2 |
| APQP/NPD Project | NPD | part/gate | APQP chain | readiness tasks | 2 |
| Production Planning | PPC | PO/plan/machine event | demand/WIP/capacity/material/tool | plan/reschedule proposal | 2 |
| Delivery Risk | PPC | daily/order/machine/quality | order through dispatch | recovery/escalation tasks | 2 |
| Material & Procurement | Raw Material | daily/stock | demand/WIP/GRN/inward/supplier | purchase requirement draft | 2 |
| Quality Investigation | QA | NCR/SPC/rejection | quality + production + machine | investigation tasks | 2 |
| Predictive Maintenance | Maintenance/CNC | alarm/down/daily | CNC + maintenance + production | maintenance tasks | 2 |
| Supplier Risk | SCM | GRN/inward/daily | supplier + receipts + NCR | supplier review tasks | 2 |
| Workforce & Skill | HRM | shift/absence/plan | attendance/skills/training/production | allocation/training tasks | 2 |
| Audit & Compliance | Audit Readiness | daily/audit/change | QMS evidence | audit/document tasks | 2 |
| Traceability | QA | complaint/trace request | production/material/inspection/dispatch | evidence pack | 1 |
| Tool Life | CNC | part complete/tool update | tool/CNC/quality | tool change/check task | 2 |
| SPC Early Warning | Control Charts | SPC/inspection | SPC/control plan/process/CNC | investigation task | 2 |
| Customer Complaint | QA | complaint | traceability/quality | complaint/8D tasks | 2 |
| 4M Change Impact | 4M Change | change | affected QMS/process records | review task | 2 |
| Manufacturing Cost & COPQ | KPI/Accounts | daily/month-end | production/quality/cost | reduction task | 1 |
| Customer Profitability | KPI/Accounts | month-end | sales/invoice/cost/quality | margin review task | 1 |
| Task Follow-up | Task List | daily/overdue | tasks/actions | reminder/escalation task | 2 |

## 4. Deployment by existing screen families

### Management
- Agentic AI hub: control tower, cross-department morning brief, AI run health, pending proposals.
- KPI dashboards: management briefing and cost/COPQ/customer profitability.
- Task List: AI follow-up and escalation.

### Marketing / Sales
- RFQ Pipeline: triage, drawing intelligence, cost estimate, quotation draft, follow-up.
- Customer/quotation screens: AI can explain history and draft communication but cannot release externally.

### NPD
- Parts, routing, dimensions, PFD, PFMEA, Control Plan, MSA, PPAP: consistency and APQP gate checks.
- Drawing revision: impact analysis across downstream quality documents.

### Purchase & SCM
- Supplier Watch, GRN, inward inspection, material planning: supplier risk, material shortage, incoming quality trends.

### PPC & MMD
- Sales Plan, Production Plan, Capacity Plan, Machine Loading Plan, Dispatch: delivery risk and dynamic rescheduling proposals.

### Production
- CNC, Production Entry, tool history, machine loading: anomaly, tool-life and utilization intelligence.

### Quality Assurance
- NCR/8D, control charts, inspections, audit readiness, 4M: investigation, traceability, corrective-action and compliance intelligence.

### Maintenance
- PM, machine state and downtime: maintenance prioritization and predictive warning.

### HRM
- Attendance, competency, skill gap, training, recruitment: workforce allocation and training recommendations.

### Accounts
- KPI, invoice and cost data: COPQ, margin erosion and customer profitability.

## 5. Event-driven evolution

Create event producers at the point where the application already knows a state changed. Examples: PO received, machine down, NCR created, SPC warning, GRN received, employee absent, document revised, 4M changed. The event producer should be deterministic and lightweight; the agent is a consumer.

Do not make the browser responsible for scheduled execution. Use a server-side scheduler/cron/queue to call the Agentic API. Vercel deployments can use an external scheduler or Vercel Cron where available; the agent endpoint itself remains authenticated and idempotent.

## 6. Idempotency

Every event needs `event_id`. Before an agent runs, check whether the same `agent_id + event_id` has already completed. Never create duplicate tasks because a gateway retried a request.

## 7. Deterministic rules

Examples:
- capacity overload = hours required > hours available
- delivery risk = projected completion date > committed date
- calibration risk = due/overdue state from recorded dates
- tool risk = current count approaching configured life limit
- SPC warning = existing statistical rule output
- audit gap = missing/expired required evidence
- skill gap = required competency minus assessed competency

AI receives the rule results and evidence; it does not replace the arithmetic.

## 8. Human approval gates

Mandatory human approval remains for: quotation release, purchase order creation, production release, quality release, PPAP approval, PFMEA approval, Control Plan approval, NCR/8D closure, dispatch, invoice posting, customer messages, supplier blocking, employee status changes, payroll posting, machine program/G-code changes and machine stop commands.

## 9. Recommended rollout

### Phase 1 — Foundation
Deploy registry, policy, event tables, API endpoint, run logging and Control Tower read-only/dry-run mode.

### Phase 2 — High-value proposals
Enable Delivery Risk, Quality Investigation, Material Shortage, Predictive Maintenance and APQP proposals.

### Phase 3 — Machine intelligence
Connect CNC event stream, tool-life prediction and SPC early warning.

### Phase 4 — Cross-agent orchestration
Allow one event to invoke multiple agents and consolidate duplicate findings into one management action.

### Phase 5 — Controlled low-risk automation
Only after audit evidence and approval history are stable, allow low-risk internal reminders/notifications under explicit policy. Keep all manufacturing and commercial releases human-controlled.

## 10. Acceptance criteria

- Every agent run has a unique run ID.
- Every AI-created task has `aiProposed:true`.
- Every proposal is visible in Review Agent Work.
- No agent endpoint exposes provider keys.
- No agent can execute forbidden actions.
- Deterministic KPI values remain identical with AI enabled or disabled.
- Retried events do not create duplicate tasks.
- AI failure does not corrupt manufacturing records.
- Missing data is reported as missing; it is never fabricated.
- Full audit trail exists for AI run, proposal, reviewer and decision.

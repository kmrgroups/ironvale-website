# Ironvale / Elixir Tec — Agentic AI V2 Ready-to-Use Package

This package adds a governed, event-oriented Agentic AI layer to the existing IDMS without changing the existing human-approval philosophy.

## What is included

- `agent-registry.json` — 20 production agents, triggers, data sources, outputs and autonomy levels.
- `event-catalog.json` — business events that can wake agents.
- `action-policy.json` — hard guardrails for what agents may and may not do.
- `migration.sql` — optional dedicated Agentic AI tables for event queue, proposals and schedules.
- `agentic-ai-v2/agentic-handler.js` (mounted into the existing `/api/ai` function) — Vercel-ready Agentic AI API endpoint. It reads IDMS data, invokes the existing `/api/ai` gateway, parses structured task proposals, and writes everything as reviewable `task` records plus an `agent_run` record.
- `ui/agentic-client.js` — browser client for the endpoint.
- `ui/agentic-executive-bootstrap.js` — self-installing bridge script. Adds a "🤖 AGENTIC AI" menu group with two links, and fetches/mounts the two screens below as their own `.panel` elements, each with its own `#s=…` hash — no in-page tabs.
- `ui/control-tower-panel.html` — the **Control Tower** screen (drop-in markup; the live KPI/agent view is rendered into it by `control-tower.js`, loaded automatically).
- `ui/control-tower.js` — renders the live Control Tower UI (KPIs, latest agent feedback, the 20 governed agents) into `control-tower-panel.html`'s host element.
- `ui/agentic-more-panel.html` — the **Agentic AI · More** screen (Review & Approvals, AI Insights, Run History, and the per-user Agentic AI access-control editor under Admin → User Management).
- `tests/agentic-contract.test.mjs` — contract tests for registry and policy integrity.
- `MASTER_IMPLEMENTATION_PLAN.md` — complete screen/module/agent mapping and rollout plan.

## Installation

1. The supplied project is already wired: `api/ai.js` mounts `agentic-ai-v2/agentic-handler.js` internally. Do not create a separate `api/agentic.js` file, because that would exceed the Hobby function limit.
2. `api/idms-screen.js` already injects `<script src="/agentic-ai-v2/ui/agentic-executive-bootstrap.js">` before `</body>` of the proxied `idms.html`, so no manual markup needs to be pasted into the IDMS page — the bootstrap script installs the "🤖 AGENTIC AI" menu and both screens (`ui/control-tower-panel.html` and `ui/agentic-more-panel.html`) itself, from static files served at those paths.
3. Optional but recommended: run `agentic-ai-v2/migration.sql` against the same Neon database. The endpoint also works without it by using the existing `idms_docs` store.
4. Keep the existing `/api/ai` provider keys and gateway. No provider key is exposed to the browser.
5. Deploy normally to Vercel. The project keeps exactly 12 endpoint files under `api/`, while shared helpers are under `server/`. `/api/agentic` remains available through a Vercel rewrite to `/api/ai?mode=agentic`.
6. Run `node agentic-ai-v2/tests/agentic-contract.test.mjs`.

## Safety model

The package deliberately implements:

- Agent observes and recommends; a named human decides.
- Deterministic business rules remain authoritative for arithmetic and status.
- AI may propose tasks, never approve/release/dispatch/post G-code/pay/terminate.
- Every run is logged.
- Every AI-created task is marked `aiProposed:true` so the existing Review Agent Work queue can govern it.
- The endpoint supports `dryRun:true` so a deployment can be validated before anything is written.

## First deployment

Use these agents first: Manufacturing Control Tower, Delivery Risk, Quality Investigation, Production Rescheduling, Material Shortage, APQP/NPD, Drawing Intelligence, Predictive Maintenance, Supplier Risk and Audit Readiness.

The package is additive: it does not replace the existing AI gateway, NPD Agent, Supplier Watch Agent, Audit Readiness Agent, RFQ Triage Agent, or the current review queue.

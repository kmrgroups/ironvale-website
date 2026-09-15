# Ironvale / Elixir Tec — Agentic AI V2 Ready-to-Use Package

This package adds a governed, event-oriented Agentic AI layer to the existing IDMS without changing the existing human-approval philosophy.

## What is included

- `agent-registry.json` — 20 production agents, triggers, data sources, outputs and autonomy levels.
- `event-catalog.json` — business events that can wake agents.
- `action-policy.json` — hard guardrails for what agents may and may not do.
- `migration.sql` — optional dedicated Agentic AI tables for event queue, proposals and schedules.
- `api/agentic.js` — Vercel-ready Agentic AI API endpoint. It reads IDMS data, invokes the existing `/api/ai` gateway, parses structured task proposals, and writes everything as reviewable `task` records plus an `agent_run` record.
- `ui/agentic-client.js` — browser client for the endpoint.
- `ui/agentic-panel.html` — drop-in control-tower panel markup.
- `tests/agentic-contract.test.mjs` — contract tests for registry and policy integrity.
- `MASTER_IMPLEMENTATION_PLAN.md` — complete screen/module/agent mapping and rollout plan.

## Installation

1. Copy `api/agentic.js` into the project's `api/` directory.
2. Copy `agentic-ai-v2/ui/agentic-client.js` into the web assets or load it from the package.
3. Add the supplied panel markup to the existing Agentic AI page, or use it as the basis for a new Control Tower screen.
4. Optional but recommended: run `agentic-ai-v2/migration.sql` against the same Neon database. The endpoint also works without it by using the existing `idms_docs` store.
5. Keep the existing `/api/ai` provider keys and gateway. No provider key is exposed to the browser.
6. Add the route to your normal Vercel deployment. It is protected by the same `X-Auth-Token` session mechanism as IDMS.
7. Run `node agentic-ai-v2/tests/agentic-contract.test.mjs`.

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

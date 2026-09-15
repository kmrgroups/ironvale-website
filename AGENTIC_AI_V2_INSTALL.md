# Agentic AI V2 installation

See `agentic-ai-v2/README.md` and `agentic-ai-v2/MASTER_IMPLEMENTATION_PLAN.md`.

The new endpoint is `POST /api/ai?mode=agentic` and is protected by `X-Auth-Token`. It reuses the existing `/api/ai` provider gateway and writes reviewable proposals to the existing `idms_docs` task queue. It is intentionally additive and does not authorize approvals/releases.

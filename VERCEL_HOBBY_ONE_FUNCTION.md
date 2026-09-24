# Ironvale — Vercel Hobby One-Function Deployment

This build deliberately exposes **one** Vercel Serverless Function: `api/index.js`.
All application API handlers live under `server/routes/` and are dispatched by `api/index.js`.

## Routes preserved

`/api/ai`, `/api/assets`, `/api/auth`, `/api/cnc`, `/api/content`, `/api/device`, `/api/hr`, `/api/idms`, `/api/notify`, `/api/orders`, `/api/rfqs`, `/api/settings`

`/iclock/:op` is rewritten to the device handler for attendance terminals.

## Agentic AI

Agentic AI remains available through `/api/ai?mode=agentic` and the compatibility path `/api/agentic` if your UI uses it. The Agentic AI registry remains in `agentic-ai-v2/`.

## Deployment

1. Replace the contents of the GitHub repository with this ZIP's project contents.
2. Commit and push to the branch connected to Vercel.
3. Vercel should detect **1** Serverless Function.
4. Keep existing environment variables, especially `DATABASE_URL` and AI provider keys.
5. Redeploy.

Do not leave old `.js` files inside `/api/`; they would be detected as additional Vercel functions.

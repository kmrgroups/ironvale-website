# Vercel Hobby deployment — consolidated API architecture

This build is structured to stay within the Vercel Hobby Serverless Function limit.

## API function layout

The `api/` directory contains the application endpoints only. Shared helpers live in `server/` and are **not** Vercel functions.

Agentic AI is consolidated into the existing `/api/ai` function:

- `POST /api/ai?mode=agentic`
- `GET /api/ai?mode=agentic&what=registry`
- `GET /api/ai?mode=agentic&what=runs`

A compatibility rewrite also maps `/api/agentic` to `/api/ai?mode=agentic`.

## Expected serverless function count

12 endpoint files remain under `api/`:

`ai`, `assets`, `auth`, `cnc`, `content`, `device`, `hr`, `idms`, `notify`, `orders`, `rfqs`, `settings`.

`server/_db.js` and `server/_attendance.js` are ordinary shared modules and are not API endpoints.

## Deployment

1. Push this project to GitHub.
2. Import/redeploy the repository in Vercel.
3. Keep the existing environment variables, especially `DATABASE_URL` and AI provider keys.
4. Redeploy after the repository update.
5. Open the Agentic AI screen and test the registry/dry-run first.

The agentic layer keeps the existing human-in-the-loop policy. It can propose reviewable tasks, but it does not approve/release/dispatch/pay/terminate/stop machines/post G-code.

# CLAUDE.md — project brief

Read this before changing anything. It carries the decisions and the reasoning
behind them so they don't have to be rediscovered or re-argued.

---

## What this repository is

One codebase serving **two things** on one Vercel project and one Neon Postgres
database:

| File | What it is | Who uses it |
|---|---|---|
| `index.html` | The public website + admin: content, enquiry, RFQ, costing, quotation, HR & payroll, PPC | Public + staff |
| `idms.html` | IDMS — manufacturing system: parts, APQP, quality, stores, planning | Staff only |
| `core.js` / `core.css` | Shared plumbing and design system used by both | Both |
| `api/*.js` | Vercel serverless functions | Both |

The same code is deployed twice, once per customer company, each with **its own
Neon database**. Elixir Tec (elixirtec.com) and Devasya Udyoga
(devasyaudyoga.com) run identical files. A third customer means a copy of the
repo, one `DATABASE_URL`, and filling in their profile.

**The two deployed `index.html` files must stay byte-identical.** Anything that
differs between companies belongs in the database, never in the code.

---

## Hard rules

### 1. No company details in code, ever

The IDMS is sold to multiple manufacturers. Company name, address, GSTIN, logo
and **document number prefixes** all come from the site profile
(`site_content` → `company`), read through `Core.loadProfile()`.

The system this was derived from hard-coded `DENO-` as a document prefix in 66
places. Do not reintroduce that pattern. Document numbers are built by
`Core.docNumber(kind)` → `ELIX-GRN-0001`, where the prefix is derived from the
profile and the serial comes from the database.

### 2. Serial numbers come from the database

`idms_counters` is incremented inside Postgres via `INSERT … ON CONFLICT DO
UPDATE … RETURNING`. Never increment a counter in a browser variable — two
people saving at the same moment would get the same GRN number.

### 3. No browser storage for data

`localStorage` and `sessionStorage` hold **session tokens only**. The system
this came from kept everything in `localStorage`, which meant data lived on one
PC, died with a cleared cache, and hit the ~5MB ceiling. Everything persistent
goes through `/api`.

### 4. Quality records are auditable

Every create, update, status change and deletion writes to `idms_audit` with
who, what, why, and the previous value. Deleting a document requires an admin
role **and** a stated reason. Do not add a delete path that bypasses this.

### 5. Validate what would corrupt downstream data

Example already in place: a GRN where accepted + rejected ≠ received is
refused, because a miscount silently corrupts every stock figure after it.
Prefer refusing with a sentence that names the numbers over saving something
wrong.

---

## Database

Tables are created idempotently by `ensureTables()` in `api/_db.js` on every
request. To add a table, add a `CREATE TABLE IF NOT EXISTS` there.

**Website:** `site_content`, `rfqs`, `ppc_orders`, `assets`, `users`, `auth`,
`login_codes`, `secrets`, and `hr_*` (employees, attendance, leave, payruns,
items, training, audit).

**IDMS:** `idms_parts`, `idms_docs`, `idms_counters`, `idms_settings`,
`idms_audit`.

`idms_docs` is one generic store keyed by `kind` — the same pattern as
`hr_items`, which already holds candidates, jobs, policies, tasks and KPIs. A
new module needs **no migration**: pick a `kind` and save. `part_id` on every
row is what makes the digital thread real — one query returns everything ever
recorded against a part.

`tenant` columns exist on the IDMS tables but are unused, because each customer
has their own database. They are insurance so consolidating later is config, not
a rewrite.

---

## The spine: how work flows

```
enquiry → RFQ → costing → quotation        (website, index.html)
        ↓  "Customer approved — send to IDMS"
part created                                (idms_parts, lifecycle = New)
        ↓
New → APQP → Sample → PPAP → Series         (idms.html)
        ↓
planning · production · quality · dispatch
```

The **customer part number is the thread**. It is created once, on the website,
at the moment a quotation is won. APQP, PFMEA, control plan, MSA, PPAP, routing,
planning and dispatch are all attributes of a part at a stage — not separate
systems.

The handover is `[data-act="won"]` in `index.html`: one quotation line becomes
one part, carrying customer, quotation number, quoted quantity and rate. It is
idempotent — once sent, the button is replaced by a confirmation.

---

## Current state

**Live in the IDMS:** Home, Parts, GRN, Company Profile.
**Declared but not built:** 65 further screens, marked `soon` in the menu, each
showing an explanation rather than a blank page. The menu structure mirrors the
system the team already uses.

To make a screen live: add `1` as the 4th element of its `MENU` entry, add a
`<div class="panel" data-panel="…">`, and a branch in `go()`.

**Still on the website, moving later:** HR & payroll and PPC. When they move,
`index.html` must keep permanent redirects for `#me`, `#hr` and `#ppc` — **every
printed employee ID card has a QR code pointing at `#me` on the website**, and
those cards are already in people's pockets. Run HR in both places for one
release before removing it.

---

## Conventions

- **No build step.** Plain ES5-compatible JS in `idms.html`, modern JS in
  `index.html`. `core.js` is an IIFE exposing `window.Core`.
- `index.html` is one large file with a single IIFE. Edit surgically with exact
  string replacement; do not restructure it.
- Errors reach the user as a sentence they can act on, never a bare status code.
  See the `api()` wrapper in `core.js`.
- Empty states say what to do next. Never render a bare table header.
- Comments explain **why**, not what.

---

## Testing

There is no test runner in the repo; tests were written as throwaway Node
scripts using `jsdom`, loading the real HTML with `fetch` stubbed by an
in-memory fake server. This caught real bugs — a fold that hid the Save button,
a shape mismatch that made TDS compute as zero.

If you formalise this, keep two habits that mattered:

1. **When a test fails, find out why before changing the assertion.** Several
   "failures" were the harness lying — stubbing `HTMLAnchorElement.prototype.click`
   disabled every menu link; jsdom never firing `Image.onload` meant favicon code
   never ran at all.
2. **Test what matters, not what is easy.** Testing that a fold worked passed
   while the Save button was being folded away with it.

Useful smoke checks after any change:
- Statutory → the tax checker: ₹12,00,000 → ₹0 · ₹13,00,000 → ₹26,000/yr ·
  ₹95,00,000 → ₹27,54,180/yr. If those four hold, the tax engine is intact.
- IDMS → save two GRNs; numbers must be `…-0001` then `…-0002`.
- Search the built files for `deno` — there must be no match.

---

## Suggested next work, in dependency order

1. **Delivery Challan** — mirrors GRN, completes material movement.
2. **Move HR and PPC into `idms.html`** — the API (`api/hr.js`) is already
   shared, so this relocates front-end code only; **no data migration**. Keep
   the redirects above.
3. **APQP programme** — timing plan, phase gates, CFT, hung off `part_id`.
4. **PFMEA → control plan → MSA → PPAP** — one chain; PFMEA feeds the control
   plan, the control plan defines what MSA proves.
5. **Planning** — sales plan, production plan, machine loading, capacity. Only
   after parts carry routings and cycle times, since planning depends on them.
6. **Production entry, inspections, dispatch.**

---

## Deployment

Vercel serves any file in the repo root, so `idms.html` needs no configuration.
`package.json` has one dependency, `@neondatabase/serverless`, and
`"type": "module"` — API files use ESM.

`DATABASE_URL` is the only required environment variable.

**Note:** the Ironvale/Elixir Tec repo has stale duplicate copies of six API
files in the repo root (`_db.js`, `auth.js`, `content.js`, `notify.js`,
`assets.js`, `rfqs.js`). Vercel only routes `/api`, so they are dead weight, but
they are out of date and will mislead. They can be deleted.

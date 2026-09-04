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

**Live in the IDMS:** Home (with loadable sample data), Customer Addition,
Parts (+ customer/price links), Process Master (routing), Dimensions Master,
Process Flow Diagram, PFMEA, Control Plan, CNC Programme, PPAP, Setup Approval,
Self Inspection, GRN, Delivery Challan, People (HR records), Company Profile.

**Setup approval** is the first shop-floor screen and the pattern for the rest:
what gets checked comes from the **control plan** for that operation (falling
back to the recorded dimensions, and saying so when there is no plan), limits are
computed from nominal plus tolerance, and a reading outside them **blocks
approval** rather than warning. Partial sheets cannot be approved either — an
approval on partial evidence is not an approval. A bad setup can still be
recorded as *rejected*, with its readings, because that is a quality record. The
out-of-tolerance message names the characteristic and warns that parts run since
the last approval are suspect.

**Self inspection** is the same characteristics recorded repeatedly through a
shift, and adds the rule that matters most on a shop floor: a failed check
requires **containment** — what happened to the parts made since the last good
check — and the sheet cannot be closed until every failure has one. Blank
containment is refused. One sheet per part/operation/date/shift, keyed so
reopening continues it rather than starting a second record for the same shift.
Both screens share `limitsOf()` and `verdict()`; keep them shared, because two
implementations of "is this in tolerance" would eventually disagree.

**The NPD chain is now complete end to end**: a won quotation on the website
produces customer, part and price; routing and dimensions are entered against
the part; PFD draws itself; PFMEA is drafted from the routing and dimensions;
the control plan is drafted from the PFMEA; the CNC programme is drafted from
the operation and the control plan parameters.

**Sample data.** The home screen loads one worked example — customer, part,
priced link, four operations, seven dimensions including two CC and one SC.
Every record it writes carries `demo:true` and removal deletes on that flag
alone, so real data can never be caught by it. Useful for demonstrating the
chain to a prospective customer.

**The NPD chain**, each level hanging off the one above: customer → part →
customer-part link (their number, their price) → process/routing → dimensions
per process → BOM → PFD → PFMEA (AI) → control plan (AI, AIAG) → CNC program
(AI). Customer, part, priced link, routing and dimensions are done.

**Routing and dimensions.** Operations are `idms_docs` kind `process`, keyed by
`partId`, numbered in tens so one can be inserted later without renumbering.
Dimensions are kind `dimension`, carrying both `partId` and `processId`, plus
`cls` = `SC`/`CC` for significant and critical characteristics. Rules enforced:
no two operations share a number on one part; a lower tolerance above the upper
is refused; an SC or CC characteristic must have a gauge and a check frequency,
or the control plan cannot be worked to; and an operation carrying dimensions
cannot be deleted, because those characteristics would be orphaned and silently
dropped from the control plan.

**PFD** is drawn from the routing, never typed, so it cannot disagree with the
operations. Inspection steps are detected by name and drawn as diamonds. The
screen states whether the part is ready for PFMEA — i.e. whether every operation
has dimensions — because generating a PFMEA over operations with no
characteristics produces a document that controls nothing.

**PFMEA — how AI generation is handled here, and why.** The draft is built from
the routing and dimensions only; the prompt forbids inventing an operation,
gauge or feature, and any returned line naming an operation that does not exist
is **dropped by the parser** rather than displayed, because a control over a step
that does not exist looks like control and is not. The SC/CC class shown against
each line is copied from the dimension record, not taken from the model's reply.

S, O and D land as editable numbers with the RPN recalculating live, and the
document is stored **separate from its sign-off**: printing before a CFT is named
stamps the copy `DRAFT — NOT APPROVED` and states it must not go to a customer.
Sign-off requires named people. The **control plan** follows the same pattern and adds one rule: it cannot be
generated without a PFMEA, because an auditor cross-checks the two and controls
written from nothing answer nothing. It carries the source PFMEA's document
number and whether that PFMEA was signed, records product characteristics
(technique, sample size, frequency, control method, reaction plan, poka-yoke)
and process parameters (tool spec, tool life, speed, feed, depth of cut,
clamping pressure, coolant and concentration), and reports any RPN-100+ failure
mode left without a control. **CNC generation** carries the same pattern plus more, because it is the only
output here that breaks metal rather than paperwork. The warning is written
**into the file** (`CNC_WARNING`), so it travels with every copy, download and
print — a programme pasted into a control without it loses the one thing that
stops someone running it cold. Status starts at `Unproven` and only a named
prove-out changes it; the record asks *what was changed at the machine*, which
is what the next person needs. Inspection and sub-contract operations are not
offered a programme at all. The model is told to mark every assumption with
`ASSUMED` and the count is reported back to the user. Do not add a path that
marks a programme proven without a name against it.

Everything the AI generation stages need is now in place: the routing says what
happens and where, the dimensions say what must be held and how it is measured.

**Part identity — important.** A part is *ours*, not a customer's. Its internal
number is issued by the database in one continuous series (`ELIX-PART-0001`) and
is never typed. The customer's own part number, their drawing number, HSN and
**their price** live on a separate `idms_docs` record of kind `cust_part`, so one
part can be sold to several customers at different prices with a single APQP
record behind it. Rules enforced: one drawing number = one part; one customer =
one live price per part.

A won quotation on the website creates all three — customer (with address and
contact from the enquiry), part (reusing an existing one if the drawing matches),
and the priced link. Nothing in that path is typed by hand: the quotation line
carries the customer's part number, drawing number, revision and HSN, and
"Add to quotation" on the costing screen fills those from the title block the AI
already read off the drawing.
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
- `parseAiJson` in both files is the tolerant reader for AI replies. Models break
  JSON five ways that all occur in practice: code fences, real line breaks inside
  strings, `//` and `/* */` comments, prose after the closing brace, and replies
  **cut off at the token limit**. The reader scans once tracking string state so
  it can strip comments safely, stop at the real end of the object, and close
  what a truncated reply left open — dropping a dangling key but keeping a value
  that was cut short. Sixteen cases are covered. If you change it, keep the
  distinction between a truncated reply and invalid JSON in the error message:
  they need different fixes.
- Numbers: `Core.inr()` is whole numbers, for counts only. Use `Core.qty()` for
  anything measurable (kg, metres — keeps 3 decimals) and `Core.rate()` for
  money (always 2). A price of 82.50 printed as 83 is a real defect found in
  testing; do not use `inr()` for prices or weights.

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

1. **Finish moving HR into `idms.html`** — People is done and reads the same
   `/api/hr`. Attendance, leave and payroll remain on the website. Note that HR
   code in `index.html` is **not contiguous**: 48 HR functions are interleaved
   with 263 unrelated ones across ~8,000 lines, so a mechanical lift is not
   possible. Rebuild each screen against the shared API instead, one at a time,
   and only remove the website copy once the IDMS one is proven on live data.
   PPC is the same story — `renderPpcAdmin` depends on a planning engine
   (`planOrder`, `machineLoad`, `partById`) tied to the website's masters.
2. **APQP programme** — timing plan, phase gates, CFT, hung off `part_id`.
3. **PFMEA → control plan → MSA → PPAP** — one chain; PFMEA feeds the control
   plan, the control plan defines what MSA proves.
4. **Planning** — sales plan, production plan, machine loading, capacity. Only
   after parts carry routings and cycle times, since planning depends on them.
5. **Production entry and inspections.**

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

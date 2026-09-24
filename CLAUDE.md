# CLAUDE.md — project brief

Read this before changing anything. It carries the decisions and the reasoning
behind them so they don't have to be rediscovered or re-argued.

---

## What this repository is

One codebase serving **two things** on one Vercel project and one Neon Postgres
database:

| File | What it is | Who uses it |
|---|---|---|
| `index.html` | The public website. It also still *serves* the staff screens (RFQ pipeline, PPC, HR, attendance, admin panel), but nothing on the site links to them — the IDMS opens them | Public; staff only through the IDMS |
| `idms.html` | IDMS — the whole manufacturing system, and now the only way in to every staff screen | Staff only |
| `kpi.js` | The KPI dashboards: chart engine, KPI registry, and the derivations that compute figures from records | IDMS |
| `drawing-convert.js` | Turns a customer's PDF/DXF/PNG into the JPEG the drawing reader can read, in their browser, before upload | Website |
| `core.js` / `core.css` | Shared plumbing and design system used by both | Both |
| `api/*.js` | Vercel serverless functions — **12 routes, the Hobby-plan limit** (`_*.js` are helpers, not routes) | Both |
| `vercel.json` | Only a rewrite: `/iclock/*` → `/api/device?proto=adms` for push attendance devices | — |

The same code is deployed twice, once per customer company, each with **its own
Neon database**. Elixir Tec (elixirtec.com) and Devasya Udyoga
(devasyaudyoga.com) run identical files. A third customer means a copy of the
repo, one `DATABASE_URL`, and filling in their profile.

**Only the Ironvale/Elixir Tec package is being shipped from v90 onward.** The
Devasya deployment shares the same files; copy `index.html`, `idms.html`,
`core.js` and `core.css` across when it is next updated. Anything that differs
between companies belongs in the database, never in the code.

---

## Agents — the two rules

Agentic features are wanted throughout this platform, and these two rules hold
wherever one appears.

**1. The agent looks; a person decides.** No agent signs, approves, releases,
despatches or posts G-code. Where an agent produces something, it produces a
*draft* in the state an unreviewed draft would be in. The Audit Readiness Agent
is read-only and says so on its own screen.

**2. The rules are arithmetic; the AI only ranks.** Every finding the audit agent
reports comes from a fixed rule over records that already exist — same input,
same answer, and each rule can be argued with on its own terms. The AI is asked
one thing, separately and optionally: what to work through first. Nothing depends
on that being exactly right, and the findings stand without it. Do not move a
check into the prompt to "make it smarter".

**3. Everything an agent writes goes through review.** `Agents → Review Agent
Work` is the single queue: anything carrying `aiProposed` (routing, dimensions)
or `byAgent` (PFMEA, control plan) sits there until a **named** person accepts or
rejects it. Accepting clears `aiProposed` and stamps `reviewedBy`/`reviewedOn`,
while keeping `wasAiProposed` so the origin is never lost — the badge on the
routing and dimension screens changes from *AI proposed* to *checked*, with the
reviewer in the tooltip. Rejecting deletes it and requires a written reason.
PFMEA and control plans are listed but **not signable from the queue**: they have
their own sign-off with the whole document in view, and one document must not
have two ways to be approved.

Every run writes an `agent_run` record with what it read and what it found. An
agent whose work cannot be audited has no place in a quality system.

**NPD Agent** chains routing → dimensions → PFD → PFMEA → control plan for one
part. It shows a plan first and writes nothing until Run is pressed; it never
overwrites work that already exists; everything it creates is stamped
`aiProposed` (routing, dimensions) or `byAgent` (PFMEA, control plan) and shows
as **AI proposed** on the screens that display it. A failure stops the chain,
marks later steps "not attempted", and leaves earlier drafts in place.

The PFMEA and control plan prompts live in `pfmeaPromptFor()` and `cpPromptFor()`
so the screens and the agent cannot drift apart — change the prompt in one place
and both change.

**Plan against the end state, not the current one.** A bug caught in testing:
the plan judged PFMEA and control plan against the part as it was, so with no
routing they were marked blocked and the run skipped the very steps the routing
step was about to make possible.

**Supplier Watch Agent** counts performance from the goods receipts and inward
inspections already on file — rejection rate, deviations accepted, repeat
non-conformances, receipts never inspected, returns. The **grade is a stated
rule, not a judgement**: C is over 5% rejected, or the same problem twice, or
more than one deviation; B is anything rejected, any deviation, or an uninspected
receipt; A is none of those. That rule is printed on the screen and on the
scorecard, so a supplier can be shown exactly why they are where they are — the
only kind of rating worth putting in front of them. A repeat of the *same*
problem is weighted above two different problems, because a repeat means nothing
was fixed the first time.

**RFQ Triage Agent** lives on the *website*, on the RFQ pipeline page — the only
agent outside the IDMS. It reads every open enquiry and reports what is stopping
each one: no drawing read, unanswered points on the drawing, not costed, costed
with no quotation, a quotation gone quiet for over a fortnight, a won job never
sent to the IDMS, an enquiry untouched for a week. Closed enquiries are ignored.
It writes its run to `agent_run` through `/api/idms` so **all agent runs sit in
one log** regardless of which half of the platform they ran in.

Five agents now exist; all five follow the three rules above. When adding a
sixth, the pattern is: deterministic rules produce the findings, the AI is asked
one narrow question afterwards, the run is logged, and anything written goes to
the review queue.

## The website is a website (v104)

The public site has **no staff entry points at all**: no Operations dropdown at
the top, no staff links in the footer, no My Attendance, no ⚙ admin button. The
admin panel, the RFQ pipeline, planning, payroll and attendance are reached from
the IDMS menu and nowhere else. `#pipeline`, `#ppc` and `#hr` no longer open a
sign-in box — an old bookmark gets a sentence saying where the screen went.

`#me` is the one exception and must stay: **the QR code on every printed
employee ID card points at it**, and those cards are already in pockets.

The screens themselves were not rewritten — a mechanical lift is impossible
(48 HR functions interleaved with 263 unrelated ones across ~8,000 lines), and
rewriting them blind would have been the wrong risk to take in one pass. Instead
the IDMS opens them in a same-origin frame at `/?embed=<target>`:

- `embed=admin` opens the admin panel only, with the public page hidden, and only
  for the developer role.
- `embed=pipeline|ppc|hr|me` open those staff screens the same way.
- `body.embedded` in `index.html` hides the header, footer, chat and every public
  section, so what shows in the frame is the screen and nothing else.

**Both pages share one session.** `index.html` now reads and writes the same
`sessionStorage` key as `core.js` (`app_token`), so signing in to the IDMS is
what signs you in to the framed screen. There is no second login and no way into
these screens from the public site. When a screen is eventually rebuilt natively
in `idms.html`, the menu entry changes and nothing else does.

## Drawing conversion happens in the customer's browser

The free-tier AI provider reads images, not PDFs and not CAD, so a PDF enquiry
used to mean re-keying by hand. `drawing-convert.js` converts before upload:

- **PDF** → each page rendered to JPEG (pdf.js, loaded lazily from a CDN only when
  a PDF is picked); multi-page PDFs get a page chooser, because the drawing is
  not always page 1.
- **PNG/WEBP/GIF/BMP** → re-encoded onto a **white** canvas. A drawing on a
  transparent background becomes black-on-black in JPEG otherwise.
- **DXF** → a small reader draws LINE, ARC, CIRCLE, polylines and text to a
  canvas. Blocks, hatches and dimension annotations are *not* expanded, and the
  sender is told so rather than being sold a CAD viewer.
- **DWG, STEP, IGES, native CAD, TIFF** → refused, with the export to make
  instead. These are binary formats with no reader that runs in a browser.
  Saying "cannot be read" and stopping was the old behaviour and it wasted the
  customer's time.

The converted image is shown to the sender before they submit — a conversion
nobody can see is a conversion nobody can check — and the **original file is
still attached** whenever conversion was not possible, so nothing sent is lost.

## Authentication — do not undo this

Until v103 the session token **was the password hash**: `auth.js` returned
`token: u.pass_hash` and `tokenUser()` resolved a caller with
`SELECT ... WHERE pass_hash = <token>`, over an unsalted single-round SHA-256.
A leaked token was therefore a permanent, unrevocable credential, and the
`users` table was a plaintext-equivalent password list.

It now works like this, and none of it should be reverted:

- Passwords are **scrypt with a per-user salt**, stored as `scrypt$<salt>$<hash>`
  and compared in constant time. Legacy hashes are accepted **once** at sign-in
  and silently upgraded, so nobody is locked out at cutover.
- Sessions are **opaque 32-byte random tokens** in a `sessions` table with a
  7-day expiry, a `last_seen` touch, and server-side revocation. `tokenUser()`
  reads that table and nothing else. **Never reinstate a lookup against
  `users.pass_hash`.**
- Changing a password, an administrator setting one, deleting a login, or
  running recovery all **end the relevant sessions immediately**.
- The browser keeps the token in `sessionStorage` (per-tab, dies with the
  browser). **Never in localStorage** — that would survive closing the browser.
- **Opening `idms.html` with no signed-in IDMS tab open signs nobody in.** Any
  token left in the tab is signed out on the server and discarded, so the
  sign-in screen stands. This was asked for directly: a shared works PC must not
  walk the next person into live quality records because the last one closed
  the lid. The login fields carry `autocomplete="new-password"` and neutral
  names so the browser does not offer to save or refill them.
- **A tab opened from a signed-in tab joins its session (v119).** Right-click →
  Open Link in New Tab / Window on any menu item no longer asks for a second
  sign-in — an explicit requirement, reversing the earlier one-sign-in-per-tab
  rule. It works by *asking*, not storing: on opening, `Core.askOpenTabs()`
  posts on the same-origin `BroadcastChannel('idms-session')`; any tab that is
  signed in (`Core.shareSession()` is told how to tell) answers with its token;
  the new tab checks it with `action:'session'` before drawing anything. No tab
  open, nobody answers, sign-in screen. **Signing out broadcasts `signed-out`**
  with the dead token, and every tab holding it reloads to the sign-in screen.
  A browser without BroadcastChannel simply asks for a sign-in, as before.
  Known and accepted: any same-origin page can ask the channel, which is only
  our own two pages; it does not widen what a script already running on this
  origin could do. `sessionsharetest.mjs` covers it with several jsdom "tabs".
- **The framed website screens read the tab's session.** `index.html` kept its
  token in localStorage while core.js had moved to sessionStorage, so RFQ
  Pipeline, HR and Site Admin inside the IDMS had no token and asked for a
  second login. In `?embed=` mode it now reads (and writes) sessionStorage,
  which a same-origin frame shares with its tab; outside embed mode (`#me`) it is
  unchanged.
- The sign-in screen shows the company logo, name and address from the site
  profile (readable without a session, which is why it can be shown before one
  exists) and carries **Powered by — KMR Groups of Companies**.
- Minimum password length is 8 everywhere.

`sectest.mjs` covers this: 35 checks including that the password hash no longer
works as a token and that the old lookup path is gone from the source.

**Still to do:** HTTP-only cookies (§7 of the master prompt). The header-token
scheme is immune to CSRF, which cookies are not, so moving to cookies means
adding CSRF protection at the same time. The catastrophic parts are fixed; this
is the next increment, not an emergency.

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
Self Inspection, Inward Inspection, Calibration, MSA, PDI, GRN, Delivery
Challan, Production Entry, Sales Plan, Production Plan, Works Dashboard,
Non-conformance & 8D, Open Actions, Machine Addition, Preventive Maintenance,
Skill Matrix, 4M Change, Audit Readiness Agent,
NPD Agent, Supplier Watch
Agent, Review Agent Work, Agent Run Log, People (HR records), Company Profile.

**Production entry** is the record everything else assumed existed. Two things
make it more than a tally sheet. It **will not book against an operation with no
approved setup** — the same gate pattern as PDI on the delivery challan, with the
same named override stored as `bookedWithoutSetup`. And it computes the actual
cycle from the time booked less downtime, and compares it with the routing: a
drift of 20% or more is reported as *the routing being wrong*, because every
quotation and capacity plan is built on that number. Rejections need a reason
code and downtime needs a reason, because a figure nobody can explain is a figure
nobody can improve.

**Sales Plan** holds customer orders; **Production Plan** computes the balance
on each, the daily rate needed to hit the date, and machine hours per work
centre against available capacity. Both numbers come from records — made from
production bookings, never from an estimate.

**Production is allocated across orders, earliest due first.** A real bug found
in testing: counting production against each order independently let 300 pieces
satisfy a 200-piece order and a 1000-piece order at the same time, so demand
showed as met twice and both balances were wrong. `allocateProduction()` fills
the earliest due date first, which is what a works actually does — and the
**agent allocates identically**, because two places computing a balance
differently is worse than not showing it at all.

Orders for parts with no routing are shown as *no routing* rather than dropped,
with a note that the plan is short by however long they take. Silently excluding
them would understate the load.

**Works Dashboard** reads across every module: what needs somebody today
(overdue orders, runs booked with no setup, overdue gauges, lots on hold,
uninspected receipts, open inspection sheets), production totals with rejection
rate, the order book with the late ones named, and parts by lifecycle stage.
**Every tile is a link to the screen it came from** — a dashboard figure nobody
can go and check is a figure nobody trusts. The *Morning briefing* button asks
the AI for one paragraph for the plant manager; the numbers stand without it and
the AI is never called by the dashboard itself.

**Non-conformance and 8D** is where a problem gets closed out — every other
screen only finds them. An NC is **raised against the record it came from**
(a production rejection, a lot on hold, a supplier rejection, a failed in-process
check), so the fault and the action are one thread; a source already answered
drops off the list.

Two rules hold it together. **Closing is refused with any of D1–D6 empty**, and
**D7 is checked separately with its own message**, because it is the one that
decides whether anything was actually prevented: if nothing changed in the PFMEA,
control plan, routing or work instruction, the same fault comes back. Do not
merge D7 back into the general "missing steps" list — that was a real defect, the
dedicated message was unreachable behind the broader check.

**Draft with AI** fills D3, D4 (a five-why chain), D5 and D7 from the problem
statement plus the part's actual route and characteristics. It is told it is not
deciding anything, that "operator error" and "lack of training" are not root
causes, and it **never overwrites a field a person has already written in**.

**Machines and maintenance.** Machines were free text on the routings, which
costs two things quietly: the same machine spelled two ways splits the loading
report, and a breakdown pattern spread across those spellings is invisible. The
machine screen therefore **starts from what the routings actually say** — every
name in use that is not on the list is shown with where it appears, to be adopted
or corrected — rather than starting a clean list nobody uses. Sub-contract
operations are excluded. The same machine twice is refused whatever the case.

Preventive maintenance derives the due date from last-maintained plus interval,
and **counts breakdowns and lost minutes from the production bookings** where the
downtime reason was a machine breakdown — nobody types a downtime figure twice.
Recording maintenance demands a name; a record with nobody against it cannot be
evidenced. A machine that has broken down more than once *and* is overdue is
called out specifically.

**Skill matrix.** Production records who ran each job; nothing checked they were
assessed for it. Like the machine list, this starts from the names already on the
bookings and setup approvals rather than presenting an empty grid. The gap it
shows is computed from the bookings themselves — who ran what against who was
assessed for it — so it **cannot be dodged by not filling the matrix in**; an
empty matrix produces the most gaps, not the fewest.

Levels are 1 under instruction, 2 supervised, 3 can run alone, 4 can train
others. Level 3 or above demands a note of what the person was watched doing,
because "competent" on its own is the first thing an auditor picks on. An
assessment past its reassessment interval counts as **no longer current**, shown
as `3!`. Reassessment updates the record and keeps the history. The matrix also
flags machines only one person can run, and machines nobody can.

**4M change.** A change of man, machine, material or method is the commonest
reason a capable process stops being capable, and the commonest thing nobody
writes down. Two rules earn the screen its place. The form **names which changes
require the customer to agree first** — material, machine and method do, man does
not — and refuses to save one of those with the customer position blank; saying
they agreed demands a name and a date, because "the customer knows" is not a
record. And whether anything ran afterwards with an approved setup is **read from
the production bookings**, not from a tick on the form.

The **Audit Readiness Agent** reads changes too: runs booked after a change with
no approved setup (high — *a change is exactly when the first pieces need
checking*), and non-man changes with no customer position recorded. It reads
competence too: somebody who booked
production with no assessment on file (medium), and somebody who ran a machine
alone while assessed only at level 1 or 2 (high) — put as *either the record is
wrong or they should not have been running it*. It reads machines too: overdue or never-maintained
machines (high when the machine is critical, with its breakdown count quoted),
and machine names on a routing that are not on the machine list. It reads
corrective actions too: overdue ones (high
past 30 days), ones with no containment recorded, and **rejections of 10 or more
with no non-conformance raised at all** — the parts were scrapped and nothing
followed it to a cause. It also reads production and orders: runs booked
without a setup, rejection rates at or above 5%, cycle drift over 20% (raised
against the routing, not the run), series parts nothing has been booked against,
orders past their date, orders due within a week with a balance, and orders for
parts with no routing.

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

**Inward inspection** hangs off the goods receipt rather than standing alone: a
GRN appears on a pending list until it is inspected, and the inspection writes
the outcome back onto the GRN (`status` becomes `Inspected — <disposition>`,
`data.inspected = true`) so stores can see whether material is released. Rules:
accepted + rejected must equal received, same as the GRN itself; a disposition
is mandatory, because a rejection that ends nowhere is how material creeps back
into stores; non-conforming material cannot be plainly accepted — it needs a
deviation with a **named approver**, or return, rework or scrap. The print
carries a segregation instruction whenever anything was rejected.

**Calibration** is a gauge register that is *checked against the control plans*
rather than kept beside them: it lists gauges named in a control plan's
`technique` field that are missing from the register, which is the first thing an
auditor looks for. Due dates are derived from last-calibrated plus frequency, so
they cannot drift out of step. Recording a calibration is one action from the
list and demands a certificate number — a calibration with no certificate cannot
be evidenced. Withdrawing a gauge needs a reason and correctly *reopens* the
control-plan gap, because the plan still calls for it. An overdue gauge is
reported as a recall question, not a red row: readings taken with it since its
last valid calibration are in doubt.

**MSA** is the AIAG average-and-range gauge R&R. The constants (K1/K2/K3) and
the arithmetic are verified against the worked example published in the AIAG MSA
manual and reproduce it to four decimals — %GRR 5.37, %PV 99.86, ndc 26. Do not
"simplify" that maths; it is the part that can be challenged in an audit. Two
percentages are reported, of total variation and of tolerance, and **the harsher
governs the verdict**, because the tolerance figure is what a customer asks
about. ndc below 5 is called out separately: a gauge can pass on percentage and
still be unable to resolve the parts. A part-filled study is refused rather than
averaged. Studies feed **PPAP element 8** automatically, but only count as
satisfied when none of them is "Not acceptable".

**The NPD chain is now complete end to end**: a won quotation on the website
produces customer, part and price; routing and dimensions are entered against
the part; PFD draws itself; PFMEA is drafted from the routing and dimensions;
the control plan is drafted from the PFMEA; the CNC programme is drafted from
the operation and the control plan parameters.

**Sample data.** The home screen loads a whole works: 5 customers, 10 parts
across every lifecycle stage, priced customer links, ~22 operations, ~30
characteristics (CC and SC, plus a sub-contract operation), 6 gauges (one
overdue, one never calibrated), 5 goods receipts, 4 inward inspections (one
receipt deliberately left uninspected, one accepted under deviation, a repeat
hardness failure at the same supplier), 3 setups (one rejected), 12 production
bookings over four days (one booked with no approved setup, one bad day at 8%
rejection, one breakdown), 3 PDI lots (one on hold), 4 challans, 6 customer
orders (one already late, one due this week), and an open self-inspection sheet
with a failed check and no containment.

**It is deliberately imperfect.** Every agent has something real to find, and the
dashboard shows a works with problems rather than a clean demo. Every record
carries `demo:true`; removal deletes on that flag alone and takes the sample
parts with it now that `PATCH what=parts remove` exists (admin role, stated
reason, cascades to the part's records and reports how many).

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
## Modules added in v105

**Supplier master.** Suppliers were free text on the goods receipts, which is the
same defect the machine list fixed: two spellings are two suppliers, and the
Supplier Watch rating on each is then built from half the evidence. The screen
**starts from the names already on the receipts** and offers them for adoption,
rather than an empty list nobody fills in. Two rules: the same name twice is
refused (fix the receipt, do not add both), and a supplier cannot be marked
**Approved on an expired certificate** — record the renewal or set them On hold.
The GRN keeps its free-text field, because refusing an unknown supplier mid-
delivery would stop the stores working; it now offers the panel as suggestions.
The screen shows receipt counts but **deliberately does not repeat the rating** —
that is worked out in one place, by the agent, so there is only ever one answer.

**Raw material master.** The list the bill of materials, stock and reorder will
be built on. Same adopt-from-usage pattern against the material descriptions on
the receipts. One description = one code, refused otherwise: two codes for one
material means stock is counted twice and neither figure is right.

**Organisation masters** (department, designation, position) share one screen,
since they are three views of one small list. A position carries its sanctioned
strength; **how many are filled is counted from the employee records**, never
typed, so the vacancy figure cannot drift from who is actually on the roll. A
position with no designation is refused, because the designation is what the
employee records are matched on. If filled reads zero where people are in post,
the employee records do not carry the same wording — fix the record, not the
number.

**APQP programme** — the one CLAUDE.md has had at the top of the list since v90.
The point is not another sheet of tick boxes. Of its 26 deliverables, **16 are
read from records that already exist**: the quotation on the part, the customer
part and price link, the routing, dimensions against every operation, SC/CC
marking, a gauge and frequency on every special characteristic, the PFD, whether
the PFMEA is signed, the control plan, whether the CNC programmes are proved, an
approved setup, pieces actually booked, MSA verdicts, whether every gauge the
control plan names is in the register, PDI lots on hold, the PPAP, and open
non-conformances. Those lines **cannot be ticked by hand** and name the screen
where the work is done. The remaining 10 carry a planned date, an actual date and
an owner.

The gate is what makes the sign-off worth having: **a phase cannot be signed off
while any deliverable in it is outstanding**, the outstanding ones are named, and
a sign-off with no name against it is refused. Do not add a path that marks a
phase complete without both.

Records: kind `supplier`, `rawmat`, `orgmaster` (with `data.type`), `apqp` (one
per part, `{manual, gates, sop}`). No migration — the generic `idms_docs` store.

**A bug worth keeping in mind.** Every date field on the APQP screen saves on
change, and somebody filling in a phase changes several in a row. The first write
has no `doc_id` yet, so the second, third and fourth all inserted: one part ended
up with four APQP records, each holding part of the answer. Writes are now
chained through `apqpQueue` so the next waits for the previous to come back with
the id. **Any screen that saves on `change` rather than on a Save button has this
same hazard.**

**Menu correction.** MSA and SPC were listed under NPD as `soon` while the screens
that do the work sat under Quality Assurance — the same thing on the menu twice,
and the NPD copy a dead end. They are listed once, under Quality, and the APQP
programme links straight to them.

## Modules added in v106 — the material chain, and SPC

**Bill of materials.** Lines point at the material master by id, never free text,
so what a part consumes and what a receipt delivered are the same thing and can
be netted off. **Rates are not copied into the line** — they are read from the
master each time the bill is drawn, so revising a rate revises every bill instead
of leaving stale copies quoting a price nobody charges. A material listed twice
is refused (stock would be netted off twice for it), a zero quantity is refused,
and a material with no standard rate is shown as *no rate* rather than silently
costed at zero.

**Raw material stock.** Nothing on it is typed except the opening balance:
**balance = opening + accepted receipts − what production consumed**. Two
decisions inside it change the number, and both are load-bearing:

1. Material counts as stock when it is **accepted at inward inspection**, not
   when the lorry arrives. An uninspected receipt gets its own column — it is on
   site but not yours to use.
2. Material is consumed at the **first operation of the routing only**. A part
   booked through four operations does not eat the bar four times; getting this
   wrong quadruples consumption and drives stock negative inside a week. The
   `materialtest.mjs` fixture books production at three operations precisely so
   that mistake fails the suite.

Negative balances are **shown, not clamped to zero**: a negative is a record gap
(no opening balance, an uninspected receipt, or a bill that overstates usage) and
clamping hides it. Receipts whose description matches nothing on the master are
listed rather than dropped, and parts with no bill are named rather than counted
as consuming nothing.

**Control charts.** Drawn from the self-inspection readings that operators
already record — nothing is entered twice. **Each check records one piece, so the
subgroup is one and the chart is individuals and moving range, not X̄–R.** An
X̄–R chart from single readings would put limits on the page that mean nothing.
Sigma is estimated as MR̄/1.128; the individuals limits are X̄ ± 2.66·MR̄. Both the
control limits and the drawing tolerance are drawn, because they are different
things: one describes what the process does, the other what the customer asked
for. Two rules are checked — a point beyond the limits, and a run of seven on one
side, which is a shift the limits alone will not catch.

**Capability is withheld below 20 readings.** A Cpk from six points is unstable
and it is exactly the number that ends up quoted at a customer. The screen says
so and says to keep recording. Do not remove that guard.

Records: kind `bom` (one per part), `rawmat.data.opening`/`openingOn` for the
opening balance (no new kind), and control charts store nothing — they are
computed on every open.

## Modules added in v107 — capacity and loading

These two sit next to the machine-loading section the **Production Plan** already
has, and it is worth being clear why all three exist. The production plan asks
*is there enough capacity overall* and answers it in one blended bucket. The two
new screens ask the questions that bucket cannot answer.

**Capacity Plan** — hours needed against hours available, **machine by machine
and month by month**, over a 3, 6 or 12 month horizon. That is the view that
decides whether you buy a machine or work a third shift, and a blended total
cannot give it: a works whose total balances can still have one machine that
does not, which is why the screen says so in as many words.

Capacity is stored **per machine, on the machine record** (`shiftsPerDay`,
`hoursPerShift`, `workDaysPerWeek`, `availabilityPct` — no new kind), because one
grinder on a single shift beside a cell running three is the ordinary case and
averaging them hides the constraint. Availability is refused above 100% and
shifts/hours/days are refused at zero. Demand is the balance still to make on
each open order times the routing cycle times, **placed in the month the order is
due**; anything already past its date goes in the current month, because that is
when the hours are needed. A machine named on a routing but missing from the
machine master is planned on the default pattern **and flagged** — otherwise its
work would quietly vanish from both screens.

**Machine Loading Plan** — a finite forward schedule, not a load percentage.
Orders go on earliest due date first; each operation waits for **both** the
machine ahead of it and the previous operation on its own order. What comes out
is the date each order will actually finish, which is the only version of that
date worth telling a customer. Two assumptions are stated on the screen rather
than buried: no batch overlaps another, and earliest due date wins. Hours convert
to calendar days at each machine's own week length, so a six-day machine and a
five-day machine do not finish on the same date.

Both screens share `capLoadData()` and reuse `orderProgress`/`opsFor`/
`allocateProduction` from the production plan — **do not fork that allocation**;
it is the code that stopped 300 pieces satisfying a 200-piece order and a
1000-piece order at the same time.

## Modules added in v108 — the competency chain

Five screens, one thread, and **only one of them takes an opinion**:

| Screen | What it does | Where the number comes from |
|---|---|---|
| Competency Mapping | the level each **role** must reach on each machine | decided here — the only judgement in the chain |
| Skill Gap Analysis | required minus assessed | worked out |
| Training Need Identification | every gap, plus needs from elsewhere | mostly worked out |
| Training Plan vs Actual | sessions planned, then held | recorded |
| Training Effectiveness | level on the day against level now | worked out |

**Requirements are set per designation, never per person.** Set them per person
and the standard moves every time somebody leaves, which is how a skill matrix
ends up describing the people instead of the job.

**The name-matching problem is surfaced, not hidden.** The skill matrix keys on
the operator name as it appears on production bookings; employee records key on
their own name. Where the two do not match, the person is listed as unmatched
with the reason — an empty gap list caused by a spelling is the worst possible
answer this screen could give. Somebody never assessed reads **"never"**, not
level 0, for the same reason.

**A gap is already a need.** Gaps arrive on the TNI screen on their own and
cannot be typed or ticked off there; they close when the person is reassessed on
the matrix, which is the only thing that actually closes them. Trying to record a
need the gap analysis already found is refused with the numbers, because two
records of one need get closed at different times and one stays open forever.

**Training rules.** A session cannot be marked held without a date and at least
one attendee (a training record with no attendees is the one an auditor asks
about), cannot be held in the future, and the same person cannot be added twice.

**Effectiveness cannot be judged the same week.** A session only appears for
review **30 days** after it was held, because the question is whether it stuck on
the shop floor, not whether it was enjoyed. The level each attendee held on the
day is read from their assessment history as it stood then; the level now is read
from the same record — so "improved" is something the records show, not something
the trainer says. If nobody has reassessed them since, the movement is **blank
rather than zero**, because nobody has looked. A verdict of *Effective* with no
evidence is refused, and a partial review (verdicts against some attendees only)
is refused.

**One KPI moved from entered to computed:** *Training — plan vs actual* on the HR
dashboard now counts sessions planned in the month they were due against sessions
held in the month they happened. Both halves come from the same records, so they
cannot drift.

Records: kind `competency`, `tni`, `training` (effectiveness is stored on the
training record as `data.effectiveness`, keyed by attendee name).

**A bug worth remembering.** `select.value = previousChoice` when the option no
longer exists leaves the select **blank**, and the screen then complains that
nothing was chosen while an option is plainly visible. Restore a remembered
choice only after checking it is still in the list.

## Modules added in v109 — organisation, roles, succession

All three finish the HR block and all three are mostly **read** rather than
maintained.

**Organisation Chart.** Drawn, not drawn up. Departments, designations and
sanctioned strength come from the organisation masters; who is in post comes from
the employee records. There are no positions to arrange, so the chart **cannot
drift from the payroll** — a chart people drag boxes around on disagrees with the
records within a month. Unfilled sanctioned posts appear as *vacant* chips
(3 of 5 in post draws two of them), and anybody whose department or designation
is not on the masters is **listed underneath as unplaceable** rather than dropped:
that is a record to correct, not a box to invent.

**Roles & Responsibilities.** One controlled sheet per designation. The
**competence section is read from the competency map**, not typed, so the role
description and the skill matrix cannot say different things about the same job —
which is the usual finding when they are kept separately. Issuing is gated: no
purpose line, no responsibilities, or **no competence set against the role** all
block it. That last one matters — a role sheet issued with an empty competence
section says nobody needs to be able to do anything. Issuing stamps a revision,
the date and the user; saving without issuing leaves it a draft.

**Succession Planning.** Readiness is measured, never typed:

- **ready now** — no gap on anything the role requires
- **ready with training** — one level short, and nothing on safety or quality
- **not ready** — anything more

Each candidate is compared against the competency map for the target role using
the levels on the skill matrix, so a plan updates itself when somebody is
reassessed or trained. The rule is printed on the screen and on the report, so
nobody has to guess what "ready" meant a year later.

Three refusals worth keeping: a candidate who is not on the employee records
(a plan naming somebody who does not work here is worse than an empty one); **the
sole incumbent named as their own successor** — the classic empty plan, which
reads back the question it was asked; and signing off a plan with nobody named,
because an empty plan signed off looks answered.

*Where the works is exposed* is derived too: posts with one person or nobody in
them and no candidate at ready or nearly-ready. It is not a list anybody
maintains, so removing the only ready candidate puts the post straight back on it.

Records: kind `role` (one per designation), `succession` (one per position).

## Modules added in v110 — CFT members and the audit register

This was built before the QMS document levels for one reason: **it turns sixteen
typed KPIs into computed ones.** Every "audit plan vs actual" and "NC closure"
figure on the QMS dashboard was entered by hand because there was no audit record
to count. The QMS dashboard is now **17 of 17 computed** — nothing on it is typed.
Across the whole system that takes computed KPIs from 29 to **46 of 101**.

**CFT Members** records who represents which function and, more usefully, **what
each is qualified to audit** and when that qualification lapses. Members must
exist on the employee records (an auditor who cannot be found is a finding in
itself), and a qualification with no date is refused — it cannot later be shown
to have been current on the day of the audit.

**Audit Plan & Register** holds the plan and the findings on one record, because
an audit whose result is filed elsewhere is an audit nobody closes. Two rules are
**enforced, not reported**:

- **Nobody audits their own department.** Independence is the first thing an
  external auditor tests, and the department is read from the employee record
  rather than asked for.
- **Nobody is named as auditor for a kind of audit they are not qualified for**,
  and not if their qualification lapses before the planned date. The
  qualification record exists, so it can be checked rather than assumed.

Sequencing is enforced too: findings cannot be recorded against an audit that has
not been carried out, and an audit cannot be recorded as carried out in the
future. A finding needs an **owner** and a **date to be closed by** — without a
date it can never be overdue, which is how findings sit open for a year and
nothing on the dashboard goes red. Closing one asks for a root cause, what was
done, and who verified it; all three are required, because a finding closed
without a root cause comes back.

The three closure derivations are built as a **factory** rather than fifteen
near-identical functions (`mkAuditPlanActual`, `mkNcPlanActual`, `mkNcStatus`),
so a change to how closure is counted lands in one place. Closure "plan" is the
month a finding was **due**; "actual" is the month it **closed**. The status pie
buckets the year's findings as closed / open within date / overdue as at today.

**A KPI engine change came with it:** a derived KPI can now supply a pie chart as
`{labels, values}`. Before this, `chart: 'pie'` only worked for entered figures.

Records: kind `cft`, and kind `audit` (plan and findings on one record).

## Modules added in v111 — the rest of the QMS block

**Document Format Numbers.** One numbering scheme per level and kind of document.
The register issues the next number from it, which is the only reliable way to
avoid two documents sharing one — and the duplicate is always the one the auditor
picks up. Two schemes for the same kind are refused. The serial only advances
**after the number has actually been taken**, so a refused save does not burn one.

**Signatories.** Who may prepare, review and approve each kind of document. Not a
list for show: the register checks names against it. One refusal worth keeping —
if the same single person is the only preparer and the only approver, the list is
rejected, because nothing of that kind could then ever be issued.

**The four document levels** share one register with four views. What makes it a
controlled register rather than a list is what it refuses:

- a **duplicate number**, and a document whose kind has no numbering format
- issuing without a preparer, a reviewer and an approver
- **the same person preparing and approving** — the control an auditor checks
  first, and the only thing standing between a draft and an issued procedure
- a signature from somebody not on the signatory list for that kind

Issuing stamps a revision, the date and the user, and keeps the history.
Documents past their review date are flagged in the register: a procedure nobody
has looked at since it was written is the second thing an auditor asks for.

**Master lists (PFD / PFMEA / Control Plan)** are entirely derived — one row per
part, showing what exists. **The useful half is the parts that have none**, and
the part in series production with none is called out by name. That is the half a
hand-kept master list never contains, because the person keeping it lists what
they have.

**Compliance & Audit Trail** is a read-only window on what the system already
wrote, with the changed fields worked out by diffing before against after. There
is deliberately no way to edit or remove an entry from here, and none anywhere
else either — a trail that can be tidied is not a trail.

**Two bugs found by the tests, both worth remembering.** `C.idms.audit()` already
unwraps the rows (`.then(j => j.audit || [])`); reaching for `.audit` on the
result gave an empty trail that looked exactly like an empty database. And the
three master lists share one screen, so a filter left on *missing* from the last
one silently hid most of the next — **any screen shared by several menu entries
has to reset its own filters when the entry changes.**

Records: kind `docformat`, `signatory`, `qmsdoc`. The master lists and the trail
store nothing.

## Modules added in v112 — logins, tools, machine checks

**User Management.** The server already checked the role on every one of these
calls, so what this screen does is make the rules visible. Two are stated on the
page because people are surprised by them: setting a password here **ends every
session that person has open**, and a deleted login stops working immediately
rather than when its session expires. One rule is added client-side that the
server does not have: **the only developer login cannot be demoted to staff**,
because that leaves nobody able to manage logins or edit the website and no way
back in. The screen also points out when there is only one developer login at
all — a second costs nothing and is worth having.

**Tool History Card.** One card per tool, and every event on it carries a cost
and a date. That is what turns the two tool cost lines on the production
dashboard from a monthly guess into something the shop floor already recorded:
**`prd_toolbreak` and `prd_toolcons` are now computed** (48 of 101 overall). A
breakage or a scrapping **cannot be recorded without a cost** — one with no cost
is one that never happened as far as that chart is concerned. Consumption counts
issues, regrinds and wear-out; breakages sit on their own line and are **not
double-counted**. A tool past its expected life is flagged, because the piece it
breaks on is somebody else's problem by then.

**Machine Check Sheet.** The list of checks lives **on the machine record**, so it
is the same list every shift and changing it is a decision rather than an
oversight; a machine with no list of its own gets the standard ten. Two refusals:
a blank result is **not** treated as a pass (if a check does not apply, say so),
and a failed check with nothing written against it blocks sign-off — the machine
either ran on it or it did not, and both answers belong on the record. The sheet
for today opens on arrival rather than behind an Open button, because the check is
done at the start of the shift and a screen you have to press first is a screen
somebody skips.

**One KPI-engine correction came out of the regression suite.** When these two
tool KPIs became fully derived, the KPI Data Entry screen still offered them —
you could type a figure that nothing would ever read. Fully derived KPIs
(`derive` with no `plan`) are now filtered out of the entry list, the same filter
the outstanding-items list already used. **Any KPI moved from entered to computed
has to be checked against that entry screen**, or it becomes a dead end that
looks like it works.

Records: kind `tool`, `checksheet`, and `machine.data.checks` for the per-machine
list (no new kind).

## v114 — DWM and the Organisation Chart rebuilt from the v74 reference

The user supplied `Key_Process_v74_Production_Entry.html`, an earlier single-file
build with much richer HR screens, and asked for the HR thread to be redone
against it. **That file is the reference for the remaining HR screens — read it
before building them** (it is large and mostly base64 images; grep for
`panel-<name>` to find a screen and for `function render<Name>` to find its
logic).

What the reference does that the previous IDMS screens did not: per-screen
signatory blocks (prepared / reviewed / approved with dates and a doc number),
department and status filters, Excel export alongside PDF, skill levels 0–4 as
coloured badges, and — most importantly — a **per-employee** rather than
per-designation model.

What was deliberately *not* copied: `prompt()` chains for data entry,
`masterData` in localStorage, and the absence of validation. The structure and
the functions came across; the record-keeping did not.

**DWM is now a per-employee monthly activity board**, not the SQDCP works board
built in v113. Pick a department and a person, then their activities are laid
out against the days of the month: `O` planned, `✔` done, `C` concession.
Adherence is scored per list — department activities, general activities, annual
calendar — and overall against a 98% target.

The plan is **not typed**: it falls out of how often the activity is done (daily
= every non-Sunday, weekly = its day, monthly = the months chosen, as-needed =
its date). What is typed is what happened.

[DECISION] **A month's plan is frozen the first time anything in it is marked.**
Otherwise changing "weekly on Tuesday" to "weekly on Friday" in November
silently rewrites every month back to January and last year's adherence changes
overnight. A record that can be rewritten by editing a dropdown is not a record.
The same reasoning blocks removing an activity that has days marked against it.

Only the month in progress can be marked, and only days that have already
happened. Records: kind `dwm`, one document per employee, holding the activity
list and a frozen plan plus actuals per month key (`YYYY-MM`).

**Organisation Chart** is now decided *and* checked, rather than purely derived.
Reporting lines are a decision, so they are stored (kind `orgnode`: post,
department, who holds it, level, parent). Everything else is read: departments
from the org masters, people from the employee records. Seven hierarchy levels
with colours, drawn as a tree.

The check is the point. Every box is re-checked against the payroll on every
draw and disagreements are named: a person not on the employee records, a person
whose record puts them in another department, a person whose record says they
have left. Vacant boxes show as vacant, and everybody on the payroll who is on
no box is listed underneath — not an error, but nobody goes missing by accident.

Refuses: a second box at the top (an organisation with two tops is two
organisations); a reporting line that closes a loop (the chart would have no top
and could not be drawn); removing a box others report to.

[CODE] `holdersOf()` is shared with succession planning — it was briefly deleted
with the old chart code and had to be restored. **Check for shared helpers before
replacing a screen wholesale.**

[CODE] `loadDwm()` must `await compLoad()` before filling the department
dropdown; without it `departments()` is empty, the department option does not
exist, setting `select.value` fails silently and the filter appears to do
nothing. This is the same select-value trap noted at v105.

**Still to redo against the reference:** Competency Mapping, TNI, Training Plan
vs Actual, Skill Matrix, Gap Analysis, Training Effectiveness, Succession
Planning. The competency chain is currently per-designation with derived gaps;
the reference is per-employee with typed actual levels. Reconcile rather than
copy — typing an actual level that the skill matrix already records would create
two sources of truth for the same fact.

**Key Process Input (`form`) is on hold at the user's request** until the rest is
done.

## Modules added in v115 — Customer PO, mandatory checks, and sales value

**Won → IDMS is now refused, not just completed, on a gap.** The seam already
created the customer, the part and the priced `cust_part` link automatically;
what it did not do was check the line was fit to create records from. It now
refuses — naming the line and the missing field — a quotation line with no
price or no HSN code, and refuses the whole transfer if the enquiry carries no
customer name. A part or a customer record created with a blank in it is worse
than a transfer that waited for the quotation to be finished.

**Quotation currency** is now a field on the quotation document (`q.currency`,
INR or USD, defaulting to the site's quote configuration) rather than assumed,
and it is carried into the `cust_part` price link on win. Nothing downstream
guesses a currency any more — it is read off the record that set the price.

**Customer PO** is the existing Customer Orders screen under Sales Plan, not a
second one: PO Number, Customer, Part, Quantity and Delivery date were already
there. What was missing was the price, so a PO could carry a quantity and a
date but nothing to value it by. **Part Price now fills in from the customer/
part price link the moment the part is chosen** (still editable — a specific PO
can be agreed at its own rate), Currency travels with it, and **PO Value is
computed, never typed** (`qty × price`), shown live on the form and on the
order book. The same duplicate-PO refusal that already existed for the order
number now also requires a price before the line can be saved — a PO with no
value cannot be measured against anything.

**Sales value is derived the same way everywhere it appears**, never entered a
second time:
- **Sales Plan register** — Plan Value is the firm quantity times the current
  customer/part price; a link with no price shows *no price link* rather than
  a silent zero.
- **Sales Invoice** — rate and currency fill in from the same price link when
  the customer and part are chosen (still editable, because an invoice can be
  raised at whatever was actually agreed), and the invoice now carries its own
  currency so a rate revision later does not rewrite what was actually billed.
  **Actual Value is summed from what each invoice line was really raised at**,
  not recomputed from today's price.
- **Sales Dashboard** — the overall panel now shows Plan / Actual / Pending
  **value**, and the customer table shows it **customer-wise**, both split as
  **two separate currency columns (₹ and $)**. There is no exchange rate on
  file, so the two are never blended into one figure nobody agreed the rate
  for — a customer bought in both currencies shows a value on both lines
  rather than one converted total.

`moneyFmt(n, currency)` and `priceFor(customerId, partId)` are the shared
helpers behind all three screens — the same lookup, the same currency symbol,
everywhere a value is shown. Do not add a second way to read a customer/part
price; if a screen needs one, it calls `priceFor`.

## Modules added in v113 — the morning board and the task list

**Daily Work Management** is the board walked at the morning meeting, in the
order everybody already walks it: safety, quality, delivery, cost, people. **Every
figure on it is read from what was recorded yesterday and nobody prepares it.**
That is the whole point — a board somebody prepares is a board that shows what
they want it to show, and the meeting then argues about the numbers instead of
the problems.

It reads production bookings (rejections, ppm, worst reject reason, OEE and its
three parts, downtime), check sheets (failed checks, and sheets left unsigned),
audit findings past their date, open non-conformances, gauges past their
calibration date, delivery challans and orders past their date, tool cards
(breakages and what they cost), and the attendance register. A failed check with
**nothing written against it** says so on the board rather than showing as a
plain failure.

Anything on the board can be raised as an action, which lands on the task list
prefilled with what it was about and which day it came from.

**Task List.** Actions raised at the meeting and anywhere else. What it
deliberately does **not** do is copy in the actions that already live on another
screen. Open non-conformances and open audit findings are **shown, with where
they live and a link, and are not copied** — two records of one action get closed
at different times and one stays open forever. This is the same rule as the TNI
screen and it should stay that way everywhere.

An action needs an owner (one everybody owns is one nobody does) and a date
(without one it can never be overdue, and it sits on the list until somebody
quietly deletes it). Closing needs a note of what was actually done.

Records: kind `task`. The board stores nothing — it is computed on every open.

**Declared but not built:** 6 screens still marked `soon` (down from 42, then 7):
`pfmea_master`, `pp_spec_master`, `supplier_competency`,
`form`, `report_inprocess_inspection`, `accounts_pl`.

**Machine & Process is now built.** A reference-only screen under NPD: filters
by machine, by process (operation name typed on a routing), and by in-house/
sub-contract, reading `process` docs (the routing) cross-referenced against
`machine` docs (the Machine Addition master) — nothing new is written. It shows
the matching operations (machine, part, op no., setup, cycle time), a summary
strip, a printable report, and a table of active machines on the master with no
operation against them yet (the same cross-reference read the other way, to
surface idle or unrouted machines). `tests/moduletest.mjs`'s pending-count
check was updated from 7 to 6 accordingly.

**Suggested order for the rest**, of the six left:

1. **PFMEA master**, **PP spec master**, **supplier
   competency** — reference screens over data that already exists. Small, and
   mostly views rather than new records.
2. **Key Process Input** — needs a decision on what it is for; the name predates
   the process master, which may already cover it.
3. **P&L** — should wait until there is a costing model, or it becomes another
   entry screen pretending to be an account.

Two of the six are **decisions rather than work**: `report_inprocess_inspection`
(see below) and `form`.

**Still undecided: `report_inprocess_inspection`.** Self Inspection already is
in-process inspection. Building a second near-identical sheet would give two
records of one check that can disagree. The version worth building is a QA patrol
inspection that cross-references the operator's sheet for the same operation and
shift and flags where the two differ. Do not build it as a copy.

**One item needs a decision before it is built.** `report_inprocess_inspection`
is still on the menu as `soon`, but **Self Inspection already is in-process
inspection** — one sheet per operation per shift, with the characteristics and
frequency from the control plan. Building a second near-identical sheet would
give two records of the same check that can disagree. The version worth building
is a **QA patrol inspection**: the inspector's independent check, which
cross-references the operator's sheet for the same operation and shift and flags
where the two disagree — that is how a sheet filled in from memory gets caught.
Ask before building it either way.

**Two KPIs can now be moved from entered to computed** on the back of v106, and
should be when the next KPI pass happens: *SPC plan vs actual* (count the
characteristics with a chart drawn against those the control plan marks for SPC)
and *total inventory cost* for the raw material and tools lines (the stock screen
already values the balance at the master rate).

## The menu, and the KPI dashboards (v104)

The menu is now organised by **the department that owns the work**, in the order
the business reviews it: Home, Top Management, QMS, Marketing, NPD, Purchase &
SCM, PPC & MMD, Production, Quality Assurance, Maintenance, HRM, Accounts,
Admin. Every group **opens with that department's dashboard**, so the first thing
anyone sees is how their own area is doing, and the screens that produce those
figures sit directly beneath it. Screens did not move between files; only their
grouping changed. `PANEL_OF` maps the ids that share one panel (every dashboard
draws into `kpidash`, every framed website screen into `embed`).

`kpi.js` holds all of it: a plain-SVG chart engine (grouped bar, line, donut,
radar, pareto — no library, no build step, no network call), a registry of **101
KPIs across twelve dashboards**, and the derivations. The rule that matters:

> **A number arrives one of two ways, and the card says which.**
> *Derived* — computed from records already in the database. Nobody types it, so
> nobody can massage it. **29 KPIs are of this kind**: OEE and its three parts,
> operator and machine efficiency, the loss and rejection paretos, rejection PPM
> at all four gates, supplier PPM and quality rating, calibration due against
> done, MSA and PPAP counts, breakdown hours, MTTR/MTBF, preventive maintenance,
> on-time delivery, despatched quantity, manpower on roll, absenteeism, RFQ
> received against won, and non-conformances raised against closed.
> *Entered* — a monthly plan and actual typed on **KPI Data Entry**, because the
> system holds no record to compute it from. Budgets, audit calendars and survey
> results are all of this kind.

Where the actual is derived and the plan is not, **only the plan can be typed** —
the actual column is locked and says *computed from records*, so the two cannot
be made to disagree.

**A card with no data says so.** It never draws an invented figure and never
treats "not entered" as zero; it offers a link that lands on the right KPI on the
entry screen. Accounts works the same way: a department that has not entered its
budget is *listed as not entered*, not shown as having spent nothing.

Entries are `idms_docs` kind `kpi`, one record per KPI per financial year
(`{kpiId, fy, rows:{Plan:[12], Actual:[12]}}`), so a new KPI needs no migration.
The financial year is April–March throughout.

Top Management adds no figures of its own: the radar and every tile on it are
KPIs already shown on a department dashboard.

**Home, banner and shortcuts.** The Quick Access shortcut grid is gone. The
banner is no longer edited from the screen it appears on — it is set in
**Admin → Home Banner** (upload or address, tagline, strapline, with a preview),
because branding is an admin decision, not a per-user one. **Export/Import JSON
left the top bar** for Admin → Backup & Restore, and restoring now requires an
admin or developer role: it overwrites records, and that does not belong one
click from the theme picker. The database chip stayed and is now a button that
re-checks rather than a label that goes stale. Sample data moved to Admin too.

To make a screen live: add `1` as the 4th element of its `MENU` entry, add a
`<div class="panel" data-panel="…">`, and a branch in `go()`.

**Still served by `index.html`, shown inside the IDMS:** the RFQ pipeline, PPC,
HR & payroll, attendance and the admin panel. They are reached only from the
IDMS menu. Rebuilding them natively in `idms.html` remains the right end state —
rebuild each screen against the shared API, one at a time, and only change its
menu entry once the new one is proven on live data. **Keep `#me` answering on the
website whatever happens** (printed ID cards).

---

## The v115 restructuring pass — what was wrong and what was done

This pass changed no feature. 93 of 95 screens render byte-for-byte what they
rendered before; the two that differ are the two defects below being fixed.
Verified by an equivalence harness that boots both builds against one fake
server, walks every live menu screen and compares the markup.

### Four defects, three of them silent

**Two screens were writing into a different screen's elements.** `su-msg`,
`su-print` and `su-list` were declared twice: once on Supplier Master, once on
Setup Approval. `getElementById` returns the first match in document order, so
Setup Approval's messages and its Recent-setups list went into the Supplier
panel, which is hidden — the screen looked dead and nobody could see why. The
Print button had two handlers on one element. Setup Approval's are now `sa-*`.
The same fault existed on the website: the job-application modal and the HR
appraisal panel both used `ap-msg`, so **validation errors on the public careers
form were invisible to applicants**. The modal's is now `japp-msg`.

*Keep literal ids unique.* Neither of these throws, neither shows in a console,
and both look like "the screen is a bit odd" until somebody checks.

**Open Actions threw every time it opened.** `taskPrefill` was read, and assigned
to, but never declared anywhere. Under `'use strict'` that is a ReferenceError,
raised before `loadTasksElsewhere()` ran, so the screen drew half of itself on
every visit. It is declared now. Nothing sets it — the morning-board "raise this
as a task" handover it was written for was never wired up, and that is still
outstanding rather than invented here.

**pdf.js was loaded on every page view of the public site.** ~340KB, in `<head>`,
blocking first paint, for a library only needed when somebody attaches a PDF.
`drawing-convert.js` already lazy-loaded and memoised it; `pdfToText()` was the
only reason the eager tag existed, because it gave up silently when the library
was absent. It now awaits the shared loader. **Do not reinstate an eager tag.**

### Why screens were slow: 363 awaits, 2 of them batched

Reads that do not depend on each other were run one after another. The Audit
Readiness Agent made 13 round trips in series, the Works Dashboard 12 — every
one of them independent. 15 clusters are now `Promise.all`, so those screens make
one wait instead of a dozen.

Three clusters were deliberately **not** batched: one is non-contiguous and two
have a call that reads an earlier result. A read that depends on a previous read
must stay serial; batching it would send the second request with an undefined
argument.

Two details worth keeping when adding more:
- An empty `catch(e){}` left the variable at its **previous** value. Batching it
  as `.catch(function(){ return undefined; })` would silently wipe it, so those
  read the variable back instead.
- `Promise.all` rejects the whole batch on one failure, so every guarded read
  keeps its own `.catch` inside the array rather than one around the outside.

`core.js` shares **in-flight** reads: two callers asking for the same thing before
the first answer arrives get one request. A time-based cache was tried here and
**removed** — it shows one user another user's superseded figure for as long as
it lives, and two people working the same part is the ordinary case on a shop
floor. `materialtest` caught it. Do not add one back without solving that.

### Duplication

`say` was pasted out 72 times and `g` 21 times, identically. They are
`noteWriter(el)`, `badWriter(el)`, `quietWriter(el)`, `fieldVal(id)` and
`fieldFromBlock(block)` now. The three writers are kept **distinct on purpose**:
they differ in whether an ordinary message is styled as an error, and folding
them together would turn three screens' notes red.

The six stale root copies of the API files are deleted. One of them, `auth.js`,
still contained `token: current.pass_hash` — the withdrawn scheme — and Vercel
served it as a static file, so the schema and the old hashing approach were
downloadable from the live domain. `.vercelignore` now keeps tests and docs out
of the deployment.

### Tests

They live in `tests/` and run with `npm test`. 438 pass. Two failures are left
**deliberately visible** rather than deleted: the sign-in screen no longer shows
the company name from the site profile, which both this file and the original
requirement say it should. The check used to crash on the missing element and
took the whole suite down with it, which is why nobody saw it. It is null-safe
now and reports. Restoring the branding is an output change and was left for a
decision.

Three assertions were stale and were corrected, not weakened: the user-facing
wording changed from "developer" to "administrator", and `Live Production` was
added to the menu between Accounts and Admin.

### Two things found and deliberately left alone

- The AI routing and dimension importers build their regex from `'^\\\\s*'`,
  which in JavaScript is a literal backslash followed by `s`, not whitespace.
  If that is what it looks like, those importers return empty for every field.
  Preserved byte-for-byte; test against a real reply before changing it.
- Spacing is applied ad hoc: 772 inline `style=` attributes in `idms.html` using
  15 different `margin-top` values. That is why screens look slightly different
  from one another. Normalising it changes pixels, so it was not done here.

## Live Production — the guide, and the bug it was hiding

**The feature had never worked.** `machine-gateway/gateway.mjs` posted to
`cfg.idmsIngestUrl + '/state'` → `/api/cnc/state`. Vercel routes `api/cnc.js` to
`/api/cnc` and **nothing below it**, so every push came back 404. Even reaching
the handler would not have helped: the ingest branch requires
`what === 'state'`, and neither the query string nor the body carried it. The
Live Monitor therefore sat on *"No CNC machines connected yet"* permanently,
with no way for anyone to tell whether it was their wiring or the software.

The gateway now posts to `/api/cnc?what=state` and **also puts `what` in the
body**, so the ingest still resolves if a proxy strips the query string. A
dropped link is logged and survived rather than thrown; a 401 and a 404 each
print the specific thing to fix. `SETUP-CNC-UNIVERSAL.md` carried the same wrong
URL and is corrected.

`cnctest.mjs` pins the URL shape at both ends. **Do not change the ingest path
without changing both sides and that test.**

### The Setup Guide

`Live Production → Setup Guide — Connect a Machine` (`cnc_setup`). Seven steps,
written for a maintenance engineer rather than a programmer. Three things it
does that a written document cannot:

- **Generates the shared key** with `crypto.getRandomValues`, so nobody invents
  a weak one. It is shown once and **deliberately never stored** — not in
  `idms_settings`, not anywhere. `cnctest` asserts it does not reach the server.
- **Writes `config.json` from a form.** A mistyped comma in hand-written JSON was
  the commonest failure; now the file is generated, and `idmsIngestUrl` is built
  from `location.origin` so it cannot be wrong.
- **Asks the server whether data has actually arrived** and answers in a
  sentence that names the fix — not a status code. A machine that has gone quiet
  for over two minutes is called out rather than shown as live.

The machine list is saved to `idms_settings` key `cnc_gateway` so it need not be
retyped. Two rules are enforced: a duplicate machine code is refused (two
machines under one code overwrite each other's readings, and the figures would
be wrong in a way nobody would spot), and a non-simulator machine with no IP is
refused.

**The test machine matters more than it looks.** It lets somebody prove the key,
the URL, the firewall and the whole chain before touching a CNC — so when a real
machine fails, the fault is known to be between the gateway PC and that machine
and nowhere else. Keep it.

The empty state on the Live Monitor links here. Landing on an empty screen with
nowhere to go is why this feature was never commissioned.

**Still to do:** the gateway pushes every state every `pushMs` whether it changed
or not — 30 invocations/minute/machine on Vercel. Fine for a few machines, worth
making change-only before a works-wide rollout. And the guide tells the user to
verify part count against the machine's own counter for a full shift before
trusting it; that instruction is load-bearing and should not be softened.

## The four "moved to the IDMS" screens — what "merged" actually meant

Four staff screens reached from the IDMS menu were website pages shown inside
an `<iframe>` (`data-panel="embed"`, `#em-frame`). That is why they read as a
remote-desktop view rather than part of the IDMS: each one is a second
document, with its own navy header bar, its own Sign Out / View Website / Site
Admin buttons, sitting inside a frame.

**They do not all take the same fix, and finding that out was most of the
work.** Before changing anything, each screen's actual data coupling was
checked:

- **My Attendance** → fully native now (`attendance_lookup` panel in
  `idms.html`). It called `/api/hr?what=me`, the same DOB-gated endpoint the
  public self-service page uses — meaning a staff member had to know an
  employee's date of birth to look anything up. A new role-gated route,
  `what=lookup` (`api/hr.js`), shares its query logic with `what=me` via one
  `attendancePacket()` function rather than two copies that could drift. The
  reconciliation arithmetic (present/paid-leave/LOP/OT/permission-hours) is
  ported line-for-line from the website's `renderMe()`, so a manager sees
  exactly what the employee sees of themselves. **The public `#me` self-service
  page was deliberately left untouched** — it is reached by QR codes already
  printed on employee ID cards, has no IDMS session, and removing it would
  lock out every card already issued.

- **Website Content admin, RFQ Pipeline, HR & Payroll** → chrome stripped, the
  engine underneath **deliberately left on the website**. All three generate
  branded, config-driven output — the live site's sections, quotations and
  cost sheets, payslips and statutory forms — through the one shared `data`/
  `DEFAULTS` content object and its `CO()`/`QC()`/`documentLogo()` accessors,
  which is the same engine that renders the public pages. Copying any of the
  three into `idms.html` would mean a second copy of company branding and
  quoting/pay configuration, with no mechanism to keep the two in sync — a
  change to the company GST number or the quoting validity period in one place
  would quietly stop matching the other. That is a worse outcome than the
  screen it would replace, and it is exactly the class of duplication the rest
  of this pass exists to remove, not add. `.staff-bar`/`.admin-head`'s own
  title, Sign Out, Site Admin and View Website are hidden under
  `body.embedded`; Refresh and Publish stay, because they are real actions,
  not window dressing. Positioning was deliberately **not** touched — each of
  the three is already `position:fixed;inset:0`, which fills the iframe's own
  viewport correctly on its own; an earlier draft of this fix also forced
  `position:static`, which changed the admin panel's flex layout for no actual
  benefit, and was reverted.

### A real bug this uncovered, not just a look

`index.html` and `core.js` store the session token under the same
`localStorage` key, `app_token`. Same origin, so same storage. The "Sign Out"
button inside RFQ Pipeline and HR & Payroll called `keepToken('')`, which
cleared that key — **silently ending the IDMS tab's own session**, with nothing
to explain why the IDMS asked for a fresh sign-in shortly after. Hiding those
buttons under `body.embedded` (above) fixes the symptom described here; the
underlying collision is documented in `tests/sitetest.mjs`, which sets the
token, clicks Sign Out inside the embedded pipeline, and asserts the shared
key is gone — so if either app's storage key is ever changed independently,
that test explains why the other broke.

### `#ppc-page` ("Production Planning") is not one of the four

It still exists in `index.html` with the same `.staff-bar` chrome, but nothing
in the IDMS menu opens it — `PPC & MMD` is already a native panel. It picked
up the same `body.embedded` chrome rule as a side effect of sharing `.staff-bar`,
but it is unreached dead weight otherwise, worth deleting in a future pass
rather than this one.

## Masters, Bulk Upload, Org Chart and DWM

### DWM moved to HRM; Org Chart was already there

Only DWM was under Production — Organisation Chart was already correctly
under HRM. Moved DWM; no other change to the menu tree beyond the new Masters
group below.

### The Masters menu, and what "ensure the screen exists" actually found

Customer Addition, Supplier Master, Parts, Machine Addition and Bill of
Materials were **relocated** (single location, not duplicated) into a new
`masters` menu group. Three of the eight requested masters were **not
missing** — they existed already, just buried under different names:

- **Tools Addition** → `report_tool_history` already is the tool master (adds
  a tool, tracks its life). Listed under Masters, not rebuilt.
- **Consumables Addition** → `entry_rawmat` (Raw Material Master) already has
  `Consumable` as one of its Type options, with the same auto-generated code
  (`C.docNumber('rm')`) the request asked for. Listed under Masters as
  "Consumables Addition (Raw Material Master)" rather than built as a second,
  competing material list.
- **Equipment / Instruments / Gauges** → the gauge register already lives on
  `report_calibration`, because adding a gauge and scheduling its calibration
  are correctly one screen, not two.

Building new screens for these three would have meant a tool, a consumable or
a gauge could end up under two different codes in two different places — the
same class of problem the rest of this codebase's restructuring has been
removing, not adding. `LABEL[panel id]` resolves to whichever menu entry runs
last in `MENU.forEach` (array order), so the page header shows the screen's
real identity (e.g. "Raw Material Master") even when reached via its Masters
shortcut; the Masters menu label itself says both names so this isn't a
surprise.

### Parts gained real drawing upload

`p-drg` was a drawing **number** field only — no file. Parts now has a file
input wired to the existing `C.uploadFile()` (the same mechanism the Home
Banner image uses, backed by `api/assets.js`), stored as `data.drawingFile`
and shown as a clickable link in the parts list.

### Bulk Upload — one engine, eight categories, in `BULK_KINDS`

Customer, Supplier, Parts, Machine, Tools, Consumables, BOM, Gauges each get
a downloadable CSV template, a hand-rolled parser (no CDN library — this
should work the instant the screen opens, and the format is ours to define),
per-row validation against both the database and duplicates within the same
file, and only writes on pressing Import. Every row's own pass/fail is kept,
not merged into one file-level result.

BOM is the one category that is `grouped:true`: several CSV rows (one per
material) become one bill-of-materials document per Part No. Adding a new
category means adding one entry to `BULK_KINDS` — do not write a ninth bespoke
screen.

### Org Chart: redrawn, not rebuilt

The tree-building logic (payroll cross-check, reporting-loop detection) was
already more capable than the reference and is untouched. It was rendering as
a plain nested `<ul><li>` with no chart CSS, so the browser drew it as an
indented bulleted list. Added the standard pure-CSS horizontal box-and-
connector-line technique — `ul{display:flex}` + `li::before/::after` for the
lines — which only changes the drawing, not the tree. Added the PDF
Signatories row (saved to `idms_settings.org_signatories`, a single default
since the chart itself is one shared document) and split Print into
**Print Full** / **Print Dept**, plus **View Full** / **View Dept** buttons
that drive the pre-existing Show filter rather than adding a second, competing
way to filter the chart.

### DWM: Plan/Actual columns, and per-board sign-off

Added explicit Plan and Actual count columns alongside the existing % column
in `drawDwm()`'s grid (`daysInMonth + 4` header cells now, not `+2` —
`dwmtest.mjs`'s column-count check was updated to match). Added a Prepared/
Reviewed/Approved By row, saved into **`dwmDoc.data.signatories`** — the DWM
document itself, not a shared default like the org chart's, because a DWM
board belongs to one person for one month and a different employee's board
must never show another's sign-off. Included in the printed report too.

### Dropdown wiring: three machine fields were free text, wired to nothing

Production Entry, Setup Approval and Self Inspection all had a "Machine"
field as plain `<input>` — free text with no connection to the Machine
Addition master, the same drift-risk the Machine Addition screen's own hint
already warns about for routings. Given a `<datalist>` suggesting from
`C.idms.docs('machine')`, the same pattern the GRN screen already used for
suppliers (`fillMachineDatalist()`, shared by all three). Deliberately kept as
free text, not a locked `<select>` — refusing an unrecognised machine mid-
shift would stop the floor working.

### Tests

`tests/bulkuploadtest.mjs` (18), `tests/dropdownwiretest.mjs` (7),
`tests/orgcharttest.mjs` (11), `tests/dwmsignofftest.mjs` (7) — 43 new checks.
Whole suite: 546 passing.

## Customer PO: two PO types, and a Sales Plan that is arrived at, not typed

Renamed "Order Book" to **Customer PO** everywhere (menu, panel headings, print
titles, the dashboard summary card) — no behaviour change, purely the name.

### The two PO shapes, and a third that is really neither

`orders` (kind:'order') now carries a `poType`: `onetime`, `ratecontract`, or
`schedule`. All three still save to the same collection and the same form
(`data-panel="sales_plan"`), with `soUpdateType()` showing and hiding fields —
deliberately one screen, not three, so a schedule and the contract it depends
on are never far apart.

- **One-time PO** (`onetime`) — quantity, price, delivery date, all its own.
  Unchanged from what Order Book always did.
- **Rate Contract PO** (`ratecontract`) — customer, part, price, optional
  validity dates. **No quantity, no delivery date** — `qty` is saved as `0`
  and `due` as `''`, deliberately, so it can never be counted as demand by
  accident. `soOpenContracts()` only offers ones still within validity when a
  schedule is being raised.
- **Schedule** (`schedule`) — raised against an open Rate Contract, chosen
  from a dropdown. The moment a contract is chosen, `fillScheduleFromContract()`
  fills **and locks** (`readOnly`/`disabled`) Customer Part No., Customer Part
  Name, Price and Currency from that contract — a schedule cannot invent its
  own price. Only quantity and delivery date are the schedule's own.
  `scheduleAgainst` holds the contract's doc id, `scheduleAgainstPo` its PO
  number, purely for display.

Two bugs found and fixed while building this, both by the new test suite
(`tests/customerpotest.mjs`) rather than by inspection:

- Switching PO Type to Schedule called `fillScheduleFromContract()` — which
  reads fields *from* a selected contract — instead of `fillContractDropdown()`,
  which populates the list of contracts to choose from. The dropdown was
  empty until the customer was reselected. Fixed; `soUpdateType()` now calls
  the right one.
- `loadOrders()` reset `#so-cust` with `customerOptions('')` (no selection
  kept) after every save — meaning adding a Rate Contract and then
  immediately raising a Schedule against it for the *same* customer required
  reselecting the customer in between. `loadOrders()` now preserves the
  current selection and refreshes the contract dropdown for it.

### Sales Plan: computed, not typed

`sales_monthly_plan` no longer has a "firm plan quantity" you type in. Demand
for a customer/part/month is **`demandOrders()`** — every `onetime` or
`schedule` order due that month, summed — with a manually entered forecast
(`kind:'salesplan'`, unchanged doc shape) used **only** when no real PO or
schedule exists for that month; `saveSalesPlan()` now refuses a forecast for
a month a real PO already covers, so the two can never double-count. All of
this lives in `salesPlanRows()`, which is the *single* place both the Sales
Plan register and the Sales Dashboard now read from — they cannot disagree
with each other because they are not two calculations, they are one.

**Backward compatibility, deliberately protected by a test:** an order saved
before `poType` existed has no such field. `isDemandOrder(v)` treats anything
that is *not explicitly* `ratecontract` as demand — so pre-existing POs do
not silently vanish from the Sales Plan the moment this deploys. Do not
change that condition to an explicit allow-list of `onetime`/`schedule`
without re-checking `customerpotest.mjs`'s "an order saved before PO types
existed still counts as demand" case, which exists specifically to catch
that regression.

`priceFor()` and the customer↔part link (Parts screen → "Customers for this
part") gained **Customer Part Name** (`custPartName`) alongside the
Customer Part Number that already existed — both now flow through to Order
Book/Customer PO's auto-fill, to `demandFor()`, and to every Sales Plan row.

### Sales Dashboard: three views, one of them new

Rewritten to call `salesPlanRows()` instead of filtering the raw `salesplan`
docs directly — it was reading the *old*, now-fallback-only manual entries
before this pass, which would have shown demand only from forecasts and
missed every real PO. Added:

- **% alongside the INR/USD values** on the Overall section (actual% and
  pending% of demand, overall and per currency).
- **Overall Sales Value — day-wise**, a new section using
  `window.KPIX.charts.line` — the existing KPI chart engine, not a new one —
  fed by summing each day's invoiced value. **INR only, deliberately**: a
  chart mixing two currencies on one axis would not mean anything, and this
  was the one place in this whole pass where the requirement asked for INR
  specifically rather than "whichever currency the customer buys in" (kept
  everywhere else, per an explicit decision to preserve existing multi-
  currency support rather than narrow it).

**A second, quieter bug found while rewiring this:** `excessForInvoice()`
(used by both the Excess Sales section and the Sales Invoice screen's own
"is this over the plan" check) called `planFor()`, which read *only* the old
manual `salesplan` docs — so excess sales were being measured against
forecasts, not real Customer PO commitments, and would have been wrong for
any customer/part with a real PO but no matching manual forecast line.
`planFor()` now delegates to `demandFor()`. Its return shape changed (`.qty`
instead of `.data.firmQty`); both call sites that read the old shape
(`saveSalesInvoice()` and `excessForInvoice()` itself) were updated — a
third caller in `drawInvoiceRegister()` only did a truthy check and needed no
change. Covered by `tests/salesdashboardtest.mjs`'s excess-sales case.

### Tests

`tests/customerpotest.mjs` (25) and `tests/salesdashboardtest.mjs` (14) — 39
new checks, covering the full Rate Contract → Schedule → computed Sales Plan
→ Dashboard chain end to end, not just each screen in isolation. Whole
suite: 586 passing.

## Matching the Esbee Sales Plan spreadsheet, and edit/delete for Sales Plan

A real spreadsheet in daily use (Esbee_Sales_Plan.xlsx — Sales Plan register,
two 31-day dispatch/value grids, a Dashboard bar chart, and two pivots:
Customer vs Sales, Daily Value) was the reference for this pass. Its demand
model (type a quantity once per part per month) was **not** adopted — Sales
Plan stays computed from Customer PO, per the decision already recorded above
— but its dashboard shape and its dispatch-tracking approach were.

### Sales Invoice: a real invoice, not a log line

Was one record = one customer/part/qty, no document produced. Rebuilt as a
genuine header + multiple line items: one customer, one invoice number,
several parts, a live subtotal/GST/total as lines are added, and pressing
Save **both** writes the record and opens a real printable tax invoice
(`printInvoiceDoc()`) — letterhead, Bill To, line items, GST summary — using
`C.openReport()`, the same engine every other printed document in the IDMS
uses. Nothing new was built for the document itself.

**Everything that reads invoices now goes through one function:**
`invoiceLines()` flattens every invoice's `data.lines[]` into individually
attributable entries (customer, part, qty, value, which invoice and which
line position). `invoicedQty()`, `invoicedValue()`, `excessForLine()`
(replaces the old `excessForInvoice()` — excess is a property of a *line*,
since one invoice can now have several), the day-wise dashboard chart, and
the new per-customer day-wise view all call this rather than reading
`salesInvoices` directly. Do not add a new reader of `salesInvoices` that
assumes one invoice = one part; it will be silently wrong the first time
someone raises a multi-line invoice.

### Sales Dashboard: per-customer day-wise added

`Daily Value` in the spreadsheet was a pivot: customer × day-of-month,
dispatched value — genuinely different from the overall day-wise total
already built. Added as a second chart, `sd-daywise-cust`, same INR-only
scope and same reasoning as the overall one.

### Edit and delete, on both Customer PO and Sales Plan

Customer PO only had Remove before. Now has **Edit**: `editOrder(docId)`
loads a PO/contract/schedule back into the exact same form `saveOrder()`
validates — editing a schedule still cannot end up with a hand-typed price,
because it goes through the same locking logic a new one would. `soEditing`
holds which record is being changed; `saveOrder()` checks it to decide
between creating and updating, and the duplicate-PO-number check exempts a
record from matching itself while it's being edited.

Sales Plan is a **computed** register, so "edit the row" has to mean "edit
what's behind it." Each row backed by real orders gets a **Manage** button
that expands to list every contributing PO/schedule, each with its own Edit
(hands off to Customer PO's `editOrder()`, via `navigate()`) and Remove. A
row backed only by a manual forecast gets a Remove for the forecast itself.
`demandFor()` now returns `orderIds` (the real-demand case) or
`forecastDocId` (the fallback case) alongside the figures, and
`salesPlanRows()` carries them through — this is what the Manage button
reads to know what it's managing.

### A recurring mistake worth naming

Twice in this pass, a `\'` meant for one literal backslash before an
apostrophe in a JS string ended up as `\\'` — two backslashes — after being
written through a tool call, breaking the script's syntax at load. Both were
caught by the `node --check` step this project already runs after every
edit, not by inspection. If a string built with `str_replace` needs an
escaped apostrophe, prefer double-quoting the string instead (`"…don't…"`)
to sidestep the escaping entirely, or verify the raw byte content with
`cat -A` before moving on rather than assuming the tool call applied cleanly.

### Tests

`tests/editdeletetest.mjs` — 19 checks covering Edit/Cancel-edit on Customer
PO and Manage/Edit/Remove on both PO-backed and forecast-backed Sales Plan
rows. `tests/salesdashboardtest.mjs` was updated for the new multi-line
invoice shape. Whole suite: 623 passing.

## v119 — invoice against PO, the full tax invoice, bulk PO upload, sessions

### Sales Invoice lines are raised against a Customer PO

Choosing customer and part fills a **Customer PO dropdown** from `ivPoCandidates()`:
every live one-time PO, schedule and open rate contract for that pair. **Never
an obsolete one.** What is "left to invoice" on each is ordered quantity less
what invoice lines already raised against that PO — saved ones (`invoiceLines()`
now carries `poDocId`/`po`) *and* lines already on the invoice being built. The
earliest-due PO with something left is pre-selected (schedules and POs before
rate contracts); the dropdown exists because it is not always that one, and the
hint says how many are on file. Rate, currency and customer part number follow
the chosen PO. A "no PO for this line" choice is kept for samples.

A schedule prints as `<contract PO> / Sch. <release>` and its date falls back to
the contract's PO date, because the customer matches invoices to the contract.
The header **Customer PO No. / PO Date are read-only and derived from the lines**
(`ivHeaderPo`): one PO → its number and date; several → each number and "per
line", and the document then prints PO and date under each line's description.

Refusals: a second currency on one invoice; the same part against the same PO
twice (the same part against two POs is allowed — end of one PO, start of the
next); no place of supply; due date before invoice date; discount larger than
the goods; negative charges; a ship-to GSTIN that is not 15 characters; Ack No.
or QR without an IRN; an IRN that is not 64 hex characters.

### One calculation: `ivCompute(lines, header)`

Used by the screen totals, the save and the print — never three versions.
Taxable value = goods − discount + freight + packing + other (GST is charged on
the consideration including those). Tax is computed **per HSN code** with the
discount and charges shared in proportion to value; the last HSN row takes the
rounding so the rows add up exactly. Same state as the company GSTIN's code →
CGST+SGST, anything else (including `96` export) → IGST. Reverse charge "Yes"
states the tax but leaves it out of the grand total. Due date comes from the
digits in the payment terms until somebody types one.

### The printed tax invoice: `invoiceDocHtml()` + `IV_PRINT_CSS`

Built to the works' tax-invoice template, every section in order: letterhead
(logo, legal name, address, GSTIN, PAN, state and state code, phone, email,
website), invoice details, e-invoice (IRN, Ack, QR — only when an IRN exists),
bill to (with customer code, PAN from the GSTIN, state code), ship to, items
(part no., description, drawing/rev, HSN, qty, UOM, rate, taxable), tax details
by HSN, totals, amount in words, bank and UPI, traceability (the template's
Field/Details layout, one Details column per line, four lines to a table),
terms, declaration, signatory, and the computer-generated note.

It is its own print window, not `C.openReport`, because the generic report has
no cell borders. **Every cell is bordered, `table-layout:fixed`, and text uses
`overflow-wrap:anywhere`** so a long value wraps inside its box. Money cells are
`nowrap` and the columns are sized for them. This was checked by rendering a
worst case in headless Chromium (six lines, 100-character names, 1,219-crore
values, 64-character IRN) and asserting no cell's `scrollWidth` exceeds its
width: only a 123,456.789 quantity overflowed, by 2px, and the Qty column was
widened. If columns are changed, repeat that check. USD invoices group numbers
the international way and read the amount in words in US dollars/millions.

Invoices saved before v119 carry no `hsnSummary`; the print recomputes from
their lines rather than failing.

Company-level invoice settings that the website profile does not hold — UPI
ID, jurisdiction, place, signatory override, terms, copies (1 or
Original/Duplicate/Triplicate), show bank — live in `idms_settings` key
`invoice_settings`, edited on the Sales Invoice screen. **Not in code.**

### QR codes are drawn locally: `Core.qrSvg(text)`

The e-invoice signed QR and the UPI QR carry invoice values, GSTINs and a
payment handle; they must not go to a third-party image service (the website's
ID cards still use one — a separate decision). `qrSvg` is a byte-mode ISO 18004
encoder (versions 1–40, Reed–Solomon, all 8 masks scored). It was verified by
decoding its output with jsQR at 20 lengths up to 2,300 bytes. **Do not tune the
tables in it without re-running that decode.**

### Customer PO

- **PO documents:** a *PO document* column with **View** (new tab) and
  **Download** (original file name) for any PO with `poFile`, and **Attach** for
  one without. Attaching patches `poFile` directly with an audit reason — it is
  *not* an Edit, because Edit makes a revision, which is right for a new price
  and wrong for adding the paper. The Obsolete tab had one fewer body cell than
  header cells; fixed while adding the column.
- **Tentative labels name the month** ("Tentative — October"), from the
  delivery date the tentatives project from (`tentativeFor` uses due+1, due+2),
  or from this month until a date is typed. The year is added when it is not
  this year.
- `Core.uploadFile` now stores a file with no browser MIME type as
  `application/octet-stream`; such files were refused by the asset store.

### A revised PO was counted twice — fixed

Editing a PO keeps the old record marked `obsolete`, but only the register's
tabs knew that. `isDemandOrder`, `allocateProduction`, `orderProgress` (obsolete
→ balance 0, which removes it from production plan, capacity, loading and the
works dashboard in one place), `soOpenContracts`, `orderPriceFor`, the audit
agent's order read and the invoice PO list now skip obsolete POs. The duplicate
PO-number check also skipped nothing, so a PO could only ever be revised once —
its own superseded copy was "a duplicate". `editdeletetest.mjs` had five
failures that were this: its stub ignored `patch`, so the obsolete mark never
landed, and it still expected an in-place update. The stub now behaves like the
API and the checks assert revision behaviour, including a second revision.

### Bulk upload: Customer PO and Sales Plan

Two `BULK_KINDS` entries, `order` and `salesplan`, plus Masters menu items
`bulk_po` / `bulk_salesplan` that open the same panel with the category chosen
(`loadBulkUpload(preset)`), and shortcut buttons on Customer PO and Sales Plan.
Column notes (`colHint`, written for every category but never shown)
are now displayed with an optional `intro`.

- **Customer PO** rows apply the screen's rules. The customer is found by name or
  code; the part by our number *or* theirs, but only through that customer's
  `cust_part` link. A schedule may name a rate contract on file **or an earlier
  row of the same file** (`ctx.fileContracts` at validation, `ctx.savedContracts`
  at import — rows import top to bottom); it takes the contract's price and
  refuses one of its own. Dates are **DD-MM-YYYY** (day first, as Indian Excel
  writes them) or YYYY-MM-DD; an impossible date is refused, not rolled over.
- **Sales Plan** rows create `salesplan` forecasts, the fallback `demandFor()`
  already reads. A month a real PO or a tentative already covers is refused, as
  is a month already over and a forecast already on file — a forecast never sits
  on top of demand.

### Tests

`invoicetest.mjs` (59), `bulkpotest.mjs` (33), `sessionsharetest.mjs` (17);
`editdeletetest.mjs` corrected (22). Set `STRESS=1` when running
`invoicetest.mjs` to also write `/tmp/invoice-stress.html` for the render check.

## v120 — HR & Payroll native workspace, automatic attendance from devices, tile Bulk Upload

### HR & Payroll is a tile workspace in the IDMS (`hr_payroll`), not the framed page

The menu entry `emb_hr` (the website HR page in an iframe, which read as a remote
desktop) is replaced by `hr_payroll`. `go('emb_hr')` redirects to it and a user
whose saved permissions name `emb_hr` keeps access (`isPermitted`). The
workspace is tiles (`HP_TILES`), each opening one of four ways:

- `v:` a view built in this panel — **Attendance Register** and **Attendance Devices**;
- `s:` an IDMS screen that already exists — Employees (`hrm`), DWM, Competency, Training;
- `b:` a Bulk Upload category — Employee Bulk Upload, Import Device Log;
- `e:` **one tab of the website HR engine**, framed inside the workspace with
  `/?embed=hr&tab=<tab>`: Leave, Control Tower, Recruitment, Engagement, Exit &
  F&F, Payroll, Statutory & Masters, KPI, Policies, Audit Readiness, Audit Trail.
  `index.html` clicks that tab after `openTarget('hr')` and adds
  `body.embed-onetab`, which hides its group buttons and tab bar.

**Still on the website engine, deliberately:** payroll (the tax slabs, 87A,
marginal relief, PF/ESI/PT/LWF, payslip PDFs, statutory forms), leave,
statutory masters, recruitment, exit/F&F, policies, audit. They are rebuilt here
one at a time and the website copy removed only after the IDMS copy is proven on
live payroll figures — the plan in "Suggested next work" is unchanged, it has
simply started with attendance.

A status strip on the workspace shows devices reporting in the last 15
minutes, punches today, people marked by device, unmatched device user IDs,
overtime waiting, and devices calling in unregistered.

### Automatic attendance: `api/device.js` + `api/_attendance.js`

`_attendance.js` is pure (no DB) so the rules are tested exactly as they run;
`device.js` stores. Tables `hr_punches` (id `device|user|time`, so a re-sent log
cannot double) and `hr_devices` (serial, registered flag, data with `keyHash`,
last seen/IP, punch count) are created by `ensureTables`.

Three device protocols, because the company's equipment decides:

| Equipment | Protocol | Identified by |
|---|---|---|
| ZKTeco, eSSL, Identix, Realtime (fingerprint or face) | ADMS push: `/iclock/cdata`, rewritten to `/api/device?proto=adms` by **`vercel.json`** | serial number, which must be registered |
| Hikvision face terminals | HTTP listening event push (JSON or multipart), `?proto=hik&key=` | device key (only its SHA-256 is stored; shown once) |
| Anything else (BioStar, COSEC, middleware) | `POST ?proto=json`, `X-Device-Key`, `{punches:[{userId,time}]}` | device key |

An **unregistered ADMS device is refused with 403** — a refused device keeps its
punches and retries, so nothing is lost — and is recorded with
`registered=false` so HR registers it from the list instead of typing the
serial. Optional allowed-IP list and an off switch per device.

**Matching:** `employee.biometricId`, else `empId` (new field on People and in
the employee upload; duplicates refused in both). Unmatched punches are stored
with `emp_id=''` and listed; after the ID is added, **Mark this month again**
(`what=reprocess`) re-matches them.

**Marking a day** (`summariseDay`) from all of that person's punches for the
working day: repeat scans within `dedupeMinutes` are one punch; first in, last
out; worked = span − break (break only if span > 5 h); late beyond
`leavePolicy.lateGraceMin`; half day when arriving later than
`leavePolicy.halfDayAfterMin` or working under half the shift; a single punch is
Present + `missedPunch` (or half day by policy); overtime beyond the shift in
`otStepMinutes` steps, ignored under `otMinMinutes`. **Overtime waits for
approval by default** (`otPendingHours`), because payroll pays `otHours`;
`autoOt` counts it straight away. **Night shifts** (`end <= start`): a punch
within 4 h after shift end belongs to the previous day (`workDayFor`). Shifts
come from `site_content.shifts` by code or name; the late/half-day limits from
`leavePolicy`; device rules, time zone and default shift from `idms_settings`
key `attendance_devices`. Hikvision times carrying a zone are moved onto the
plant's wall clock; all day arithmetic is wall-clock, never UTC.

**The record written is the shape the HR sheet already writes** —
`{empId, day, status, dayFraction, otHours, late}` plus detail — so the website
payroll's `attendanceSummary()` counts device days unchanged. **A day with no
`source`, or `source:'manual'`, is never overwritten** (`attendanceRecord`
returns null); the device's in/out is noted on it instead. Approved overtime
survives re-marking. Corrections on the register write `source:'manual'` with a
required reason; "Use the punches again" hands a day back to the device.

Staff routes (session): `what=devices` GET/POST/PATCH, `punches`, `import` (the
Bulk Upload device log, same engine), `reprocess`, `approveOt`. Registering,
removing, reprocessing and approving overtime need the developer role and are
written to `hr_audit`.

**Known limits, stated to the user:** (1) the IDMS is HTTPS-only, so a push
device must support HTTPS; plain-HTTP-only units need the log import. (2)
`api/device.js` is the **12th serverless function — the Vercel Hobby limit.**
A 13th route must be merged into an existing file or needs a paid plan. (3)
Devices that can only be *pulled* over the LAN (no push) are not reachable from
the cloud; the CNC-gateway pattern could host a relay later.

`tests/devicetest.mjs` drives the parsers and rules, then the **real handler**
against `tests/fake-db.mjs`, swapped in for `_db.js` with a Node module hook.
The fake throws on any SQL it does not recognise, so a new query must be added
to it deliberately.

### Bulk Upload is tiles

`#bu-home` holds grouped square tiles (Masters / Sales / People & attendance),
each with its own inline SVG (`BU_ICONS`); pressing one shows `#bu-work` with
the category's template, column notes, preview, refusals and Import, plus where
the records go (`screen`/`screenLabel` on each kind) and an Open button — also
offered after a successful import. **`#bu-kind` is still a `<select>`, hidden,**
so every existing handler and test that sets it keeps working; tiles set it and
dispatch `change`. `openBulkUpload(kind)` opens a category from anywhere
(Customer PO, Sales Plan, People, HR & Payroll). The Masters menu entries
`bulk_po`/`bulk_salesplan` are gone. A kind may define `saveAll(goodRows, ctx)`
to import in one call (device punches, 500 per request).

New categories:
- **Employees** → `/api/hr` employees. Never overwrites an ID on file; blank ID
  takes the next in `hrMasters.empIdPrefix/Pad/NextSeq`; department and
  designation checked against the org masters when those are in use, shift
  against the shift master; unique Biometric ID; PAN/IFSC/UAN/phone/email forms;
  refuses a joining age under 14; pay structure from the columns, or from
  AnnualCTC with `salaryStructure` percentages (the website's `structureFromCtc`).
- **Attendance punches** → `/api/device?what=import`.

### Tests

`devicetest.mjs` (56), `hrpayrolltest.mjs` (66); `bulkpotest.mjs` updated for
tiles (38).

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

0. **Stubs must behave like the real API.** The delivery-challan stub ignored
   `docId` and inserted instead of updating, which hid the PDI drawdown entirely
   — the test passed on a duplicate row. If the real endpoint updates in place,
   the stub must too.
0.5 **Patches must be all-or-nothing.** `patchlib.py` validates every anchor
   before writing any of them. Three separate times a patch script aborted half
   way and wrote nothing, leaving a block I believed was applied silently
   missing — the panel markup for Customers, for PFD, and the whole NPD agent
   module. Validate first, then write.
1. **When a test fails, find out why before changing the assertion.** Several
   "failures" were the harness lying — stubbing `HTMLAnchorElement.prototype.click`
   disabled every menu link; jsdom never firing `Image.onload` meant favicon code
   never ran at all.
2. **Test what matters, not what is easy.** Testing that a fold worked passed
   while the Save button was being folded away with it.

`dwmtest.mjs` (43 checks over the v114 DWM board and organisation chart: the
fixture puts today inside the month under test so the marking rules can be
exercised at all, marks whatever the board itself says is markable rather than
assuming today is a working day, and checks the freeze by editing an activity's
frequency after a month has been marked. The old v113 pair: yesterday seeded with one of
everything the board should notice, so a board that quietly drops one fails here
rather than in a meeting; plus the not-copied rule on the task list).
`opstest.mjs` (36 checks over the v112 screens: the demote-the-last-developer
refusal, a breakage with no cost, a blank check not passing as OK, and the tool
money reaching the production dashboard). `qmstest.mjs` (38 checks over the v111 screens: the numbering refusals, the
prepare-and-approve control, the unauthorised-signature refusal, the missing-PFMEA
finding, and the trail diff). `audittest.mjs` (38 checks over the v110 register: the two independence rules,
the sequencing, the finding-closure requirements, and the QMS dashboard keeping
one kind of audit apart from another). `orgtest.mjs` (33 checks over the v109 screens: vacancies drawn from sanctioned
strength, the unplaceable-employee report, the role issuing gates, and readiness
coming out ready / not ready from the competency map with the sole-incumbent
refusal). `competencytest.mjs` (42 checks over the v108 chain: the unmatched-name report,
"never" rather than zero, the duplicate-need refusal, the training rules, and the
30-day wait with level-on-the-day read out of the assessment history).
`planningtest.mjs` (24 checks over the v107 modules: two machines with
deliberately different shift patterns so a blended average fails, demand landing
in the month it is due, the capacity validations, and an order that the queue
ahead of it pushes past its date being called late rather than on time).
`materialtest.mjs` (29 checks over the v106 modules: the BOM refusals and scrap
arithmetic, the stock identity with its two load-bearing decisions, and the
control chart catching a deliberate outlier and a deliberate run of seven while
withholding capability from six readings). `moduletest.mjs` (50 checks over the
v105 modules: adoption from receipts, the
duplicate and expired-certificate refusals, the derived filled/vacancy count, and
the APQP gate refusing a sign-off that is unnamed or has work outstanding — it is
what caught the four-records bug above). `smoketest.mjs` (IDMS: 65 checks — no auto sign-in, the gate branding, the menu
order, the home screen, the top bar, all twelve dashboards rendering without an
error note, KPI entry saving *and updating rather than duplicating*, the framed
screens, the banner) and `sitetest.mjs` (website: 20 checks — no staff entry
points anywhere, embed mode with and without a session, and the converter
refusing DWG/STEP/TIFF with the export to make instead). Both need `jsdom`
installed as a throwaway dev dependency; **do not commit it to `package.json`**,
which has exactly one dependency and must keep it.

Useful smoke checks after any change:
- Statutory → the tax checker: ₹12,00,000 → ₹0 · ₹13,00,000 → ₹26,000/yr ·
  ₹95,00,000 → ₹27,54,180/yr. If those four hold, the tax engine is intact.
- IDMS → save two GRNs; numbers must be `…-0001` then `…-0002`.
- Search the built files for `deno` — there must be no match.

---

## Suggested next work, in dependency order

1. **Finish moving HR into `idms.html`** — People, the Attendance Register and
   device attendance are done and read the same `/api/hr`. Leave and payroll
   remain on the website engine, opened tab by tab inside HR & Payroll. Note that HR
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

## Agentic AI coverage pass (post-v122)

Extended existing agent buttons out to screens that only had rule-based
flags before, following the exact shape already proven on Supplier Watch
Agent and the Works Dashboard's Morning Briefing — read what the screen has
already computed by fixed rules, ask the AI to rank or explain it in plain
prose, never let it invent a fact the screen does not already show, and
never let it write a record by itself.

- **Every department dashboard** (`kpidash`, so all twelve — Company
  Scorecard down to Accounts) now has an "AI briefing" button
  (`briefKpiDash`), reading each KPI card's own text with its chart SVG
  stripped out, so it can never disagree with the dashboard above it.
- **Preventive Maintenance** — "Ask the AI to prioritise" (`explainMaintenance`),
  ranking `pmRows` (already computed: overdue state, breakdown minutes).
- **Open Actions** — "Ask the AI to prioritise" (`explainOpenActions`), ranking
  the open NCR/8D actions already sorted by days overdue.
- **Skill Gap Analysis** — "Suggest a training plan" (`explainGapAnalysis`).
  Deliberately advisory only — it does not create a Training Need
  Identification record; that stays a human step on the TNI screen.
- **Calibration Report** — "Ask the AI to prioritise" (`explainCalibration`),
  ranking gauges already flagged overdue/due/never-calibrated by `calState()`.
- **Production Plan** — "AI risk brief" (`explainPlan`), the same job the
  website's older, since-orphaned production-planner risk brief did, rebuilt
  against this screen's own `planRows` instead.
- **4M Change** — "Draft impact assessment with AI" (`draft4MImpact`) suggests
  which documents (PFMEA/control plan/PFD/CNC programme/PPAP/re-qualification)
  likely need re-checking for the specific change described. Separate from the
  existing rule-based customer-notification warning, which is untouched.

All of the above were added directly to `idms.html` (the file actually
served — see the note above about it, not `idms-app.js`, being the live
source). `node --check` was run after every edit and the full suite
(`node tests/run-all.mjs`) was run clean after each screen — no test needed
changing for this pass.

**Still not covered**, and worth doing the same way next: Capacity Plan and
Machine Loading Plan (natural continuations of the Production Plan risk
brief), MSA Study Report (interpret a study's result in plain language),
Control Charts (explain an out-of-control point). Plain CRUD masters
(Customer/Supplier/Parts/Machine/etc.) were deliberately left without an
agent — there is no ranking or drafting judgement for the AI to add to
typing in a customer's address.

## Agentic AI coverage pass, part 2

Continued the same pass immediately after the above:

- **Capacity Plan** — "AI risk brief" (`explainCapacity`), on the
  machine-months already flagged over 100% by the fixed hours-needed-vs-
  available arithmetic; says which shortfall to deal with first and what the
  realistic options are (overtime, a shift, sub-contract, move the date).
- **Machine Loading Plan** — "AI risk brief" (`explainLoading`), on the
  orders the finite forward schedule already projects as late, cross-read
  against which machine's queue is the real bottleneck behind them.
- **Control Charts** — "What to investigate" (`explainCc`). Deliberately
  *not* a restatement of the existing rule-based verdict (beyond-limits/
  run-of-seven/out-of-tolerance warnings already say what broke, in plain
  language, and duplicating that adds nothing) — instead it hands the AI
  only the flagged readings' own recorded shift/operator/machine and asks
  whether they share one, which nothing on the screen cross-checks today.

**MSA Study Report was deliberately skipped.** Looked at it: `drawMsaResult`
already produces a complete plain-language verdict (Gauge R&R %, NDC, a
plain "should not be used to accept or reject parts" line when it fails) —
adding an AI button here would restate that, not add judgement, the same
reason Control Charts' agent was scoped away from the verdict text and onto
the one thing not already covered.

Same discipline as part 1: every screen's own already-computed rule-based
output is what gets handed to the AI, `node --check` after every edit, full
suite run clean after each screen (same 2 pre-existing smoketest failures
throughout, nothing new).

**Genuinely nothing left that fits this pattern.** Everything remaining on
the menu is either a plain master/CRUD screen, a report that already states
its finding in full plain language with nothing further for an AI to add, or
one of the 6 screens not built yet (`pfmea_master`, `pp_spec_master`,
`supplier_competency`, `form`, `report_inprocess_inspection`, `accounts_pl`).

## Agentic AI coverage pass, part 3 — every prioritising agent now proposes, not just narrates

The user asked for every agent to work like the NPD Agent: not just explain
something in prose, but produce a real, reviewable draft artefact — the same
propose/flag/review shape NPD Agent already uses for routing and dimensions,
applied to a plain action instead of an engineering record.

**Shared infrastructure**, added once near the existing Agents section:
- `TASK_BLOCK_INSTRUCTION` — a prompt suffix any agent can append, asking the
  AI to follow its prose with up to 3 `TASK` blocks (`TITLE`/`OWNER`/`DUE`/
  `PRIORITY`), reusing the same block-parsing shape `agentProposeRouting` and
  `agentProposeDimensions` already use for `OP`/`DIM` blocks.
- `agentParseTasks(txt)` / `agentStripTasks(txt)` — split the reply into the
  narrative (kept exactly as before) and the structured tasks.
- `agentSaveTasks(tasks, source)` — writes each as `kind:'task'`,
  `aiProposed:true`, exactly the same flag NPD Agent puts on a proposed
  operation or dimension.

**Review Agent Work** now pulls in `aiProposed` tasks alongside routing and
dimension proposals — same Accept/Reject buttons, grouped under "General
actions — not tied to one part" since a task has no `partId`. **Task List**
now shows the same "AI proposed" / "checked" badge routing and dimensions
already show, so a proposed task is visible on its own home screen
immediately, not only in the review queue.

**Converted to propose tasks**: Preventive Maintenance, Skill Gap Analysis,
Calibration Report, Production Plan, Capacity Plan, Machine Loading Plan,
Control Charts, 4M Change — 8 of the 9 agents from part 1/2.

**Open Actions was deliberately left narrative-only.** A task proposing to
"chase NCR-123" would be a second record of the exact action the NCR's own
D-stage already is — precisely the duplication Task List's own design note
warns against ("two records of one action get closed at different times and
one stays open forever"). The NCR already surfaces on Task List under "open
elsewhere"; that stays the one record.

Same discipline throughout: `node --check` after every edit, full suite run
clean after every conversion (same 2 pre-existing smoketest failures
throughout, nothing new), and a plain manual sanity check of the TASK block
parser against a sample AI reply before trusting it in seven functions at
once.

## Agentic AI hub — a new top-level menu entry

Added `Agentic AI` as the first item in the menu, right after Home. One
screen (`agentic_ai`), showing every agent built in parts 1–3 above as a
square tile (reusing the `.bu-tile`/`.bu-tilegrid`/`.bu-group` classes Bulk
Upload and HR & Payroll already use, so no new visual language), grouped
under the same department headings the main menu itself uses.

Two kinds of tile, `AA_TILES` in the code:
- **`auto`** — agents that work over a whole list (Preventive Maintenance,
  Skill Gap Analysis, Calibration, Production/Capacity/Loading Plan, Supplier
  Watch, Audit Readiness, Works Dashboard). Each tile's badge is a live count
  — read straight from the same module-level array the screen's own table
  draws from, by literally calling that screen's own `load...()` function
  and then reading the result, so the hub can never show a number the real
  screen would disagree with. Each also gets a **"Fix with AI →"** link that
  navigates to the screen and then calls that screen's own `load` then
  `explain`/`brief`/`run` function in sequence — the exact two clicks a
  person would make themselves, done for them. Still only *proposes*:
  whatever gets written lands as `aiProposed` and is reviewed on Review
  Agent Work exactly as before, nothing here saves anything by itself.
- **`open`** — agents that work on one part or one record at a time (PFMEA,
  Control Plan, CNC Programme, NPD Agent, Non-conformance & 8D, Control
  Charts, 4M Change, HR Recruitment, RFQ Pipeline). There is no single "run
  it" for these that would not mean silently choosing a part, a record, or a
  customer on the person's behalf, so the tile only opens the screen. Where
  a real count exists — parts with no routing/PFMEA/control plan yet — it is
  still computed and shown (`partsGap()`, one cheap parts+kind query, cached
  per kind across tiles), so the gap is visible before deciding what to open.

`node tests/smoketest.mjs` gained its own section for this: tile count and
grouping, that a tile click actually navigates to that agent's screen, and
that every badge resolves (to a number or a dash) rather than being left on
its "checking…" placeholder. `tests/smoketest.mjs`'s menu-order check was
also updated — it is a positional check that has needed a one-line update
every time a menu group was added (Masters, Live Production, now this),
which is expected and noted in the test's own comment.

## Biometric device setup guide

Attendance Devices (inside HR & Payroll) already had a one-paragraph,
protocol-aware "what to type into the device" box (`hd-howto`) — accurate,
but not the walk-a-non-technical-person-through-it guide the CNC screen has.
Added a proper six-step accordion above it, `#hd-guide`, using the exact same
`.cs-step` visual language the CNC Setup Guide (`cnc_setup`) already
established, so the two guides look and behave identically without adding a
second design language to the app.

Deliberately **not** a second copy of `csBindSteps()` — a new
`hdBindGuideSteps()`, scoped to `#hd-guide` and keyed on its own
`data-hdstep`/`data-hdnext` attributes rather than CNC's `data-step`/
`data-cs-next`, so the two accordions' "next" buttons can never answer each
other (both exist on the same page at once; CNC's original binder queries
`document` globally for `data-step`, unscoped by panel — harmless while only
one guide existed, would have broken the moment a second one did without this
separation). `tests/hrpayrolltest.mjs` checks that specifically: pressing
Attendance Devices' step 1 does not mark CNC Setup Guide's step 1 done.

The six steps: what you need (serial number, network) → set attendance rules
(points at the existing equipment section right below) → register the device
→ point it at this site (menu path for the Cloud Server / ADMS setting most
fingerprint and face terminals sold in India use, referring to `hd-howto`'s
live address rather than duplicating it) → test with one punch → match
punches to people via the Biometric ID field. Content is static HTML, not
generated — nothing about the steps themselves depends on data, only the
existing `hd-howto` box below it still carries the live address/key, exactly
as before.

## Title bar: search, and a tagline

Two small, unrelated additions to `.top`, the navy bar at the very top of
every screen:

- **Tagline.** "Agentic AI — Intelligent Digital Manufacturing System" now
  sits under the company name. There was already a `.top .id .tag` CSS rule
  for exactly this, defined but never used in any markup — filed under
  `.co`, which is what made it easy to find.
- **Search.** `SEARCH_INDEX` is built once, straight off `MENU` itself —
  every live screen, with its icon and department — so a screen can never be
  searchable and missing from the actual menu, or the other way round.
  Typing a few letters (`tSearchMatches`) scores label-starts-with above
  label-contains above department-starts-with/contains, shows up to 8
  results (`tSearchDraw`) with arrow-key navigation, and a click or Enter
  calls the same `navigate()` the menu itself uses. Screens without a LIVE
  flag are left out on purpose — searching one up would only land on the
  "not built yet" placeholder. `tests/smoketest.mjs` covers both: the
  tagline text, and that searching "calibration" surfaces Calibration
  Report grouped under Quality Assurance and actually navigates there.

## SPC — upgrading Control Charts rather than adding a second screen

Asked for directly: an "SPC screen," built to the SPC Manual. Control
Charts (`report_control_charts`) already did a real, correct slice of
this — an individuals/moving-range chart with Cp/Cpk, a beyond-limits
check and a run-of-seven check — because each self-inspection reading is
one piece, not a subgroup, which rules out X̄–R/X̄–S charts without a
change to how self-inspection itself records data (out of scope here).
Building a second, separate "SPC" screen next to it would have been
exactly the "same thing on the menu twice" this codebase has avoided
elsewhere (Machine & Process, the MSA/Control-Chart overlap noted
earlier) — so this extends Control Charts in place instead, and renames
it to **SPC — Control Charts** in the menu so it is still found under
that name.

**Added:**
- **Pp/Ppk** (performance capability, built on the plain standard
  deviation of every reading — "overall" or long-term sigma) alongside the
  existing **Cp/Cpk** (potential capability, built on the short-term sigma
  the control limits themselves use, from the average moving range ÷
  1.128). The SPC Manual's own distinction: Cp/Cpk says what the process
  is capable of when it is behaving itself moment to moment; Pp/Ppk says
  what it has actually delivered, drift included. A Cpk comfortably above
  1.33 with a Ppk well below it is itself a finding — variation is coming
  from drift over time, not short-term spread — so the screen says that
  outright when the gap exceeds 0.2, rather than leaving two numbers on
  screen for someone to notice the gap between themselves.
- **Western Electric zone tests**: Zone A (2 of any 3 consecutive
  readings beyond 2σ, same side) and Zone B (4 of any 5 beyond 1σ, same
  side) — both built on the same short-term sigma the control limits use,
  so a Zone A flag and a beyond-limits flag are always talking about the
  same yardstick. Only the readings that actually qualify are flagged,
  not every reading in a passing window.
- **Six-point trend rule**: 6 readings in a row steadily increasing or
  decreasing (5 consecutive rises or falls) — catches a drift that may
  never leave the middle of the chart at all, so neither the limits nor
  the zone tests would catch it.
- The existing beyond-limits and run-of-seven checks, and the AI
  investigation agent, are unchanged in their own logic — the agent's
  flagged-reading list now also includes Zone A/B and trend readings, on
  top of what it already covered.
- **Deliberately left at 7, not changed to 8**, for the run rule: sources
  vary on this (7 is common in AIAG-adjacent training material; strict
  Western Electric/Nelson uses 8), and this codebase already shipped and
  presumably relies on 7 — changing already-verified behaviour without
  being asked risked being a silent regression dressed as an improvement,
  so the new rules were added instead of touched.

**Tested properly, not just run once:** `tests/spctest.mjs` is new — a
second self-inspection data set, engineered by running the exact same
formulas used in `idms.html` against candidate readings until one
genuinely triggered a beyond-limits point, a Zone A pattern, a Zone B
pattern and a six-point trend together, so every expected value in the
test is a hand-checked fact about that data, not a guess at what the
screen ought to say. Covers the menu/heading rename, all four rule types
firing (and the loose-tolerance case NOT firing outSpec), both capability
pairs appearing with their potential/performance framing, the Cpk-vs-Ppk
gap warning, and that the printed report carries the same new figures.
`materialtest.mjs`'s own smaller control-chart check (its own data set,
the one with the wild outlier) was left untouched and still passes
unmodified — its 22-reading set happens not to trigger any of the three
new rules, which is a fact about that particular data, not a gap in the
new logic.

## Flush Data, Flush Settings, manual Employee CRUD, and a first native slice of Recruitment

Four separate requests, done in one pass.

**Two flush actions**, Admin → Backup & Restore, `what=flush` on `api/idms.js`
(new — nothing else in the codebase needed a bulk wipe before). Both are
gated behind typing an exact phrase into a text box rather than a
dismissible `confirm()`, checked again server-side, and restricted to
developer/admin:
- **Flush all data and records** — every part, order, routing, PFMEA,
  control plan, production booking, attendance record, punch, payslip and
  uploaded attachment. Explicitly does NOT touch company profile, branding,
  users, provider keys, or registered devices — the same team can carry
  straight on entering fresh data. `idms_audit` is wiped last, then one
  fresh audit row is written recording the flush itself, so the trail is
  never silently empty.
- **Flush all settings & admin data** — company profile/branding, website
  content and pricing, print/home settings, AI/email/WhatsApp provider keys,
  registered devices. Explicitly does NOT touch user accounts (remove those
  from User Management yourself — a self-service button that can lock out
  the person clicking it is the wrong shape for this) and does NOT touch any
  data — run Flush Data too if a new customer needs a genuinely blank slate.

Tested in `tests/flushtest.mjs`: the button gate (near-miss phrases,
including the OTHER scope's own phrase, do not enable it), that each button
sends its own scope, and that a server-side rejection is surfaced rather
than swallowed.

**Manual Add/Edit/Delete on People** (`hrm`). Turned out the backend already
supported Add and Edit through one upsert endpoint, and Delete already
existed — just no UI for any of the first two, and Delete had no role or
reason check, unlike every other deletion on this platform. Added that check
to `api/hr.js`, and built the missing "Add employee" / "Delete employee"
buttons. A new employee's ID is auto-assigned — the exact prefix + next-free
scheme Bulk Upload already uses, checked against who is actually on file
rather than a stored counter — never typed, the same way a part number is
never typed on Add a Part. Tested in `tests/employeecrudtest.mjs`.

**Recruitment — investigated first, then split into two phases.** The ask
was to hide the other tabs in the embedded Recruitment view and get it off
the website. Checking `openTarget('hr')` found something more serious than
extra tabs: the whole embedded HR engine (Recruitment, Leave, Engagement,
Exit, Payroll, Statutory, KPI, Policies, Audit) is hard-gated to the
developer login — `if(currentRole!=='developer'){ toast('HR records need
the developer login.'); return; }` — so no other role could open any of it
at all, regardless of what IDMS's own User Management grants them. That
changed this from a cosmetic fix to a real functional gap.

Phase 1, built now: a native **Recruitment** screen (`recruitment`, a proper
MENU entry under HRM, also reachable from HR & Payroll's Recruitment tile,
now `s:recruitment` instead of `e:recruit`) — requisitions, AI JD drafting,
candidates, the full seven-stage pipeline, AI CV-match screening (same
MATCH/VERDICT/DETAIL reply shape and the same "never assess the person,
only what's evidenced" rules the website's version used), and Convert to
Employee, which auto-assigns an ID the same way Add Employee does. No server
changes needed — `requisition`/`candidate` are already generic `hr_items`
records behind `/api/hr?what=items`, the exact endpoint the website's own
version used, so this reads and writes the same data, not a second,
competing copy of anyone's hiring history.

Phase 2, deliberately not built yet, flagged on the screen itself so nobody
mistakes the gap for an oversight: interview invitations by email/WhatsApp,
offer-letter generation with editable terms templates, and the quick
candidate-message templates. Each touches sending/document infrastructure
this pass did not verify end to end, and a broken offer letter or a missed
candidate email is a real cost, not a cosmetic one — worth its own pass
rather than rushing it alongside everything else here.

Tested in `tests/recruitmenttest.mjs`: raising a requisition, adding a
candidate, the AI screening call and reply parsing (including that a low
match does not auto-move the stage — the hiring decision stays human), a
manual stage change, and Convert to Employee producing a real, auto-ID'd
employee record linked back to the candidate.

**Still openly running from the website**, for whoever picks up Phase 2 or
the rest of this migration next: Leave, Engagement, Exit, Payroll,
Statutory, KPI, Policies, Audit-Readiness, Audit Trail (all still `e:`
tiles in `HP_TILES`, still behind the developer-only gate), and the RFQ
Pipeline (`emb_pipeline`). Recruitment is the first of these moved
natively; the pattern here — reuse the existing generic endpoint, port the
same AI prompts verbatim, defer anything touching send/document
infrastructure to its own pass — is the one to repeat for the rest.

## Six more HR screens moved natively — Audit Trail, Policies, Leave, Engagement, Exit, Control Tower

Continuing the migration directly after Recruitment, on the instruction to
move everything off the website and leave it alone rather than do this
piecemeal. Same discipline as Recruitment throughout: reuse the existing
generic `/api/hr?what=items` and `?what=audit` endpoints (no new tables),
port the same field names and the same calculations where a calculation
existed and was safe to port, and flag plainly on-screen anywhere something
was deliberately left out rather than silently doing a thinner job.

- **HR Audit Trail** (`hr_audit_trail`) — read-only, `what=audit`. Was
  restricted to the developer role only on the server; relaxed to
  developer-or-admin, matching how every other restricted deletion and
  audit view on this platform is gated (nothing else here was
  developer-only specifically).
- **Policies** (`hr_policies`) — draft → publish, exactly as the website
  version worked: publishing supersedes whatever it replaces and resets
  acknowledgements to zero, and published text itself is never edited (a
  correction is a new version).
- **Leave & Permission** (`hr_leave`) — apply, approve, reject. This is the
  one that mattered most: it was completely unreachable for anyone without
  the developer login before this. **Leave balances are not shown yet** —
  entitlement and carry-forward depend on the leave-rule masters, which
  still live on Statutory & Masters (not yet migrated); applying and
  approving do not need them and are fully native now.
- **Engagement** (`hr_engage`) — recognition and surveys, the two things
  that actually exist in the website's version (its own tile description
  mentioned "grievances" too; there was no such feature to port — the
  panel was corrected to match what the code actually does, not what the
  label implied). Survey response collection (a form for an employee to
  answer) was not ported this pass — creating and listing surveys was.
- **Exit & Full and Final** (`hr_exit`) — recording a resignation/exit and
  the clearance checklist is fully native. The settlement figure itself
  (final salary pro-rated, leave encashment, gratuity under the Payment of
  Gratuity Act) is **not calculated here** — `calcFnF()` on the website
  depends on `leaveBalance()`, which depends on the same un-migrated leave
  rules Leave & Permission is waiting on, and gratuity/statutory
  calculations are exactly the kind of thing not worth porting under time
  pressure. The screen says so plainly and points at HR & Payroll for the
  calculated version until leave rules move here too.
- **Control Tower** (`hr_tower`) — a small native cross-HR summary (on
  leave today, leave pending, candidates in process, exits in progress),
  not a port of the website's own Control Tower, which pulled together
  several more data sources than were worth wiring up for a single
  landing-page dashboard.

`HP_TILES` updated so the HR & Payroll tiles for all six now open the
native screens (`s:`) instead of the website iframe (`e:`).

**Still genuinely left running from the website**, and worth naming
plainly rather than letting the list quietly shrink in people's heads:
**Payroll** (pay runs, payslips, approval — the heaviest and riskiest of
everything here, deliberately last), **Statutory & Masters** (PF/ESI/PT/TDS,
shifts, holidays, leave rules — Leave and Exit above are both already
waiting on this one), **KPI & Appraisal**, **Audit Readiness**, and the
**RFQ Pipeline** (a separate, much larger system — drawing reading, AI
costing, AI quotation drafting — that deserves its own dedicated pass, not
a rushed corner of this one).

Tested in `tests/hrnativetest.mjs`: all six screens are live menu entries,
and one real flow through each — audit rows actually showing, a policy
drafted then published, an employee applying for leave then it being
approved with the approver's name recorded, recognition and a survey both
saved, an exit recorded with its clearance checklist actually saving, and
the Control Tower reading a live cross-screen summary rather than being a
static page. `node --check` after every edit; full suite (31 files now)
clean throughout — same 2 pre-existing, unrelated smoketest failures the
whole way, nothing new broken.

## Bug fixes from real usage — flush crash, search, title bar, employee row actions

Reported directly from a live deployment, with screenshots. Five real bugs,
one clarification.

**Flush All Data crashed in production**: `sql.query is not a function`.
The driver actually deployed does not expose `.query()` — interpolating a
table name into the tagged-template `sql` isn't possible either (the
template tag binds interpolated values as query parameters, not
identifiers), so each table now gets its own literal `sql\`DELETE FROM
x\`` statement via a `flushTable()` switch, the same pattern every other
query in this file already uses. This is exactly the class of bug that
only shows up against a *real* driver, and the original `flushtest.mjs`
entirely mocked the client's fetch, so it could not have caught it —
`tests/fake-db.mjs` was extended with `checkRole`, `checkToken`, `readBody`,
and a literal-table-name DELETE matcher, and a new `flushservertest.mjs`
drives the actual exported handler in `api/idms.js`, the same end-to-end
pattern `devicetest.mjs` already used for `api/device.js`. Proved it would
have caught the original bug by reintroducing `sql.query(...)` on one line,
confirming 7 of 18 checks fail, then reverting.

**Search dropdown hid behind the menu bar**: `.menubar` had an explicit
`z-index:500`; `.top` (holding the search box) had none, so its entire
subtree — including the dropdown's own `z-index:60` — lost to the menu
bar regardless, since z-index only competes within a shared stacking
context and `.top` never entered one. Fixed by giving `.top` its own
`position:relative;z-index:600`.

**Search excluded screens not yet built** (P&L, etc.) — deliberate at the
time, but wrong: not finding a screen you know exists reads as more broken
than landing on the honest "not built yet" placeholder. `SEARCH_INDEX` now
carries every menu item regardless of its LIVE flag, with a `not built yet`
label on the ones that aren't.

**Title bar reorganised**: dividers between identity / search / utility
chips / user, a search icon inside the box, dropdown widened from 280px to
300px with its own border for definition against light card backgrounds.

**Employee row actions were only inside the opened profile.** The original
ask was for Add/Edit/Delete outside the profile too — `drawHrList()` now
puts Edit and Delete directly on each row (`hr-open` renamed to read
"Edit", not "Open"); deleting no longer requires opening the record first.
Both the row's Delete and the profile's own Delete now call one shared
`hrDeletePerson()` so the two can never prompt or behave differently.

**Recruitment "hidden tab"**: there isn't one. Recruitment is a fully
standalone native screen with no tab bar — nothing hidden via CSS, unlike
the website's old embedded version. What was likely meant is the
deferred-features note (interview invites, offer letters), which sits as a
hint at the top of the Recruitment screen itself.

Tests added/extended: `flushservertest.mjs` (new, 18 checks against the
real handler), `smoketest.mjs` (+3: P&L searchable and marked not-built,
title bar z-index above the menu bar's), `employeecrudtest.mjs` (+2:
row-level Delete button present, row button reads "Edit" not "Open").
Full suite (32 files) clean throughout — same 2 pre-existing, unrelated
smoketest failures, nothing new broken.

## KPI & Appraisal, Audit Readiness, and two more gaps found along the way

Continuing the HR migration directly after Statutory & Masters.

**KPI & Appraisal** (`hr_kpi`). Manual KPIs plus three genuine auto-sources —
attrition, competency, tasks — each computed from the real native records
(employees, `computeGaps()`, `C.idms.docs('task')`), never guessed. On-time-
delivery, absenteeism and training-closure auto-sources are explicitly not
offered: they depend on data models (website order planning, website
attendance, website training sessions) that have not moved here, and a
source that silently computed the wrong thing would be worse than one that
is not offered at all. Appraisals reuse `computeGaps()` completely
unmodified for the competency table, so an appraisal can never show a
number Skill Gap Analysis itself would disagree with. Approving now
requires a rating AND a non-empty reason — slightly stricter than the
website's version (which allowed an empty reason), matching the
reason-required convention every other approval on this platform already
follows.

**A real, wide-reaching bug found while testing KPI's competency
auto-source**: the "has this person left" check, used across Org Chart,
Succession Planning, CFT Membership, Skill Matrix, Competency Mapping and
Skill Gap Analysis, compared employee status against the literal string
`'Left'` — but nothing that actually sets a status (Recruitment's
convert-to-employee, Exit settle) ever writes `'Left'`; they write
`'Exited'`. The check never matched real data, so an exited employee was
silently still counted as active in all six of those already-shipped
screens. Fixed all 13 occurrences to check `'Exited'`, then found and fixed
the one existing test (`dwmtest.mjs`) whose own fixture had encoded the
same stale assumption.

**A second real gap, found while porting Exit's settle button last
session**: settling an exit patched the exit record's own status but never
actually set the employee's status to `Exited` — the website's original
version does both together (and warns if clearance is still pending).
Fixed to match, covered by a dedicated test in `hrnativetest.mjs`.

**Audit Readiness** (`hr_audit_ready`). Every check reads a screen that
already exists — Competency Mapping and Skill Matrix (via the same
`comps`/`compSkills` compLoad() already loads), `computeGaps()` unmodified,
Policies, People, and Statutory & Masters' own review record — so a green
tick here can never disagree with what those screens themselves show.
Building this exposed a third gap: the native Statutory & Masters screen
never carried the "Rules effective from / Last reviewed by / Reviewed on"
fields the website's version had, which this screen needs to judge whether
statutory rates have been formally reviewed. Added a **Review record** card
to Statutory & Masters to close that gap before building on top of it.
Training-effectiveness is explicitly not checked — training sessions
haven't moved off the website yet, and checking against the wrong record
would be worse than admitting the gap plainly, which the screen does.

Tested in `tests/kpitest.mjs` (12 checks — including that a low match
never auto-moves an appraisal's status, keeping the human decision human)
and `tests/auditreadytest.mjs` (9 checks — seeded to produce one green, one
amber and one red check on purpose, and asserting the screen reports
exactly those three outcomes, not a plausible-looking guess). Full suite
(35 files) clean throughout — same 2 pre-existing, unrelated smoketest
failures, nothing new broken.

**Left deliberately for its own pass**: Payroll. Everything above computes
counts and ratios from records; Payroll computes what somebody is actually
paid — gross-up, PF/ESI/TDS deduction, LOP from attendance, payslip
generation, approval. Wrong there costs real money, not a wrong percentage
on a dashboard, and it depends on nearly everything else in this HR
migration (Statutory rates, Leave, Attendance) being right first — which is
now the case, but the calculation engine itself still deserves its own
careful pass rather than being rushed in at the end of this one.

## Company Profile / User Management overlap check, and a native Setup Wizard

Checked before moving anything, as asked.

- **Company Profile**: genuinely the same `site_content.company` record the
  website's Site Admin edits — not a second copy. The native screen already
  read it; it just couldn't write. Made it fully editable (identity, address,
  contact, statutory, bank details, signature block, logo/signature/seal
  uploads via the existing `C.uploadFile()` used everywhere else). Checked
  the website's own code for the real image storage keys rather than
  guessing — `company.letterheadLogo`, `company.signatureImg`,
  `company.sealImg` — since a wrong key would silently show no logo despite
  a "successful" save. Saving sends the whole `site_content` object back,
  verified not to clobber unrelated settings living in the same record
  (`tests/companyprofiletest.mjs`, 12 checks).
- **User Management**: already the one real, authoritative login system —
  the website's "Logins" tab and IDMS's native Users screen both sit on the
  same `/api/auth` records. The one real gap: no self-service "change my own
  password" in IDMS. Added it, reusing the existing shared `action:'change'`
  endpoint — no server changes needed. Covered in `opstest.mjs` (+7 checks).

**Setup Wizard** (`admin_wizard`, first item under Admin). A genuine linear
step-through — progress dots, Back/Next, no separate final Save — covering
Company Profile → Users → Masters → Statutory & Masters → Sample Data → a
Done summary. Every step reads and writes the exact same records its
underlying screen uses (Company Profile's own fields, real customer/
supplier/part/machine counts via `C.idms.docs()`/`C.idms.parts()`, the real
user list, the real statutory settings), so a "done" tick here can never
disagree with the screen itself. Caught and fixed one bug before it shipped:
an early draft of the data loader kept only a few sub-keys of the site
content object, which would have wiped everything else in `site_content` on
the very first save from this screen — exactly the mistake already guarded
against in Company Profile and Statutory & Masters, fixed the same way
(keep the whole object, mutate only the relevant keys). Tested in
`tests/setupwizardtest.mjs` (20 checks): step-gating (an incomplete step 1
is refused), the whole-object-preserved-on-save check, progress dots
reflecting genuinely computed completion state (not assumed), and jumping
directly to a step via the dots.

**Still not done — the website-side wizard.** Only the IDMS side was built
this pass. The website already has a good, functioning checklist-style
Setup tab (status badges, "how to get this" instructions) — turning that
into the same linear step-by-step shape, or deciding the checklist format
is actually better suited to what it configures, is a decision worth making
deliberately rather than converting it on momentum.

**Unchanged from before**: Payroll, RFQ Pipeline, and 26 of the 27 Website
Content tabs are still on the website. Full suite (37 files) clean
throughout this pass — same 2 pre-existing, unrelated smoketest failures.

## Setup Wizard, Step 6 — Connections (Email/AI/WhatsApp), and a real bug caught along the way

Continuing through the Website Content tabs — this pass ported the website's
own "Setup" tab (email/AI/WhatsApp provider keys). Unlike Company Profile
and Statutory & Masters, this one carries no whole-blob clobber risk at
all: `/api/settings` is a genuinely per-key store (the `secrets` table,
same one Flush Settings already knew about), GET returns each key's status
individually and POST saves one key at a time — so a typo in one key can
never risk another that already works. No server changes needed; the
website's own `loadSettings()`/`saveSetting()` pattern was ported as-is.

Added as **Step 6 — Connections** (Setup Wizard grew from 6 steps to 7;
Done moved to Step 7), grouped exactly like the source: Email
(RESEND_API_KEY, FROM_EMAIL, OWNER_EMAIL), AI (Mistral/Groq/Gemini/
Anthropic keys), WhatsApp (token, phone ID, template, alert number) — each
group has its own Save button, matching the one-key-at-a-time save the
website itself uses rather than one large risky save-everything button.

**A real bug caught while extending the wizard, not introduced by this
step**: the progress dots' "done" flags were off by one against the
`labels` array (`doneKey[0]` was `null` while `labels[0]` was 'Company'),
so the Company dot could never show as done regardless of actual
completion — the Step 6 summary text was still correct (it reads
`wizDoneFlags()` directly), but the dot itself was silently always wrong.
Fixed the index alignment; `setupwizardtest.mjs`'s existing dot check
happened not to exercise this specific path, which is itself worth noting
for whoever extends this wizard further — checking the summary text is not
the same as checking each dot's own state.

Tested in `tests/setupwizardtest.mjs` (grew from 20 to 25 checks): a group
save posts only the keys actually typed in (not the whole group blindly),
the status line shows the saved key masked rather than in the clear, and
the Done summary's "Email or AI connected" row reflects a key that was
actually just saved.

**Still unchanged**: Payroll, RFQ Pipeline, 25 of the 27 Website Content
tabs (Company Profile and Setup/Connections are the two done so far), and
the website-side wizard. Full suite (37 files) clean throughout — same 2
pre-existing, unrelated smoketest failures.

## Quoting & Costing Setup — Cost Base, Quotation terms, Machines/Labour/Materials

Continuing straight through the Website Content tabs, as directed. Checked
the underlying data shapes in the website's own source before building
anything, same discipline as every screen before this one:
`data.costBase` (13 fields), `data.quoteCfg` (16 fields — numbering,
currency, tax, payment/delivery/warranty terms), and three arrays —
`data.machines`, `data.labourGrades`, `data.materials` — that feed the RFQ
Pipeline's "Work out cost with AI" and "AI draft quote". These are
deliberately a separate, simplified list from Machine Addition / Parts
Addition (by original design, noted on the screen itself) — quick costing
needs far less than full engineering does, and merging the two would have
been a bigger, riskier change than porting the screen as it already works.

Built as `admin_quoting`, same whole-object-preserving save pattern as
Company Profile and Statutory & Masters (`/api/content` overwrites
everything; read the full record first, change only these five keys).
Array editing (add/edit/delete row) follows the same table pattern
Statutory & Masters already established for shifts/holidays/leave types.

Tested in `tests/quotingsetuptest.mjs` (17 checks): existing values load
into all three tables correctly, add/delete on the array editors, numeric
and boolean fields are saved as real numbers/booleans rather than strings
(`downtimePct: 18` not `"18"`, `showTax: false` not `"no"`), and — the one
that matters most on every one of these screens — saving Quoting & Costing
Setup does not clobber the unrelated Company Profile living in the same
`site_content` record.

**Unchanged**: Payroll, RFQ Pipeline, the 15 pure website-design tabs (Hero,
Gallery, Founders, Brand, Design, Sizing, Capabilities, Process, Stats,
Industries, Certifications, AI Chatbot, Testimonial, Contact, Sections —
none of which have an IDMS equivalent concept), and the website-side
wizard. Full suite (39 files) clean throughout — same 2 pre-existing,
unrelated smoketest failures.

## RFQ Pipeline — Phase 1 (native), same phased discipline as Recruitment

Investigated before building anything, same as every screen this session:
RFQs live in their own dedicated `rfqs` table behind `/api/rfqs` (GET list,
PATCH update/remove) — never duplicated in `hr_items` or `idms_docs`, and
public submission from the website's contact form correctly stays exactly
where it is (a customer submitting an enquiry is a website-facing act by
nature, not something that belongs in an internal system).

What this revealed changed the plan: `renderRfqAdmin()` alone is a genuine
line-item quotation builder — items, HSN codes, discount, lead time, its own
PDF generation — comparable in size to everything built in the entire HR
migration combined. Attempting all of it in one pass risked the first
half-broken thing shipped this session. Applied the exact same phase split
that worked for Recruitment:

**Phase 1, built now**, replacing `emb_pipeline` in the menu with native
`rfq_pipeline` (the old embed's code — focus mode, floating bar — was left
in place, just unreferenced, rather than deleted, in case Phase 2 wants the
same patterns): the enquiry list with stage counts, a stage-change dropdown
and delete calling the real shared endpoint, and the **Triage Agent**.
`rfqTriage()` was ported line-for-line from the website's own
`triageRfqs()` — same eight rules, same wording, same order — not
reimplemented from a description of what it does, specifically so a "not
costed yet" flag here can never disagree with what the website's own
version would say about the identical enquiry.

**Phase 2, deliberately not built, stated plainly on the screen itself**:
reading a drawing, working out a cost, drafting the line-item quotation
(with its own PDF), and sending it — still run from the website's RFQ
Pipeline. Each is substantial AI/document-generation machinery in its own
right and deserves its own unhurried pass.

The Agentic AI hub's tile was updated to match — it now runs the Triage
Agent directly (`kind:'auto'`, matching Maintenance/Supplier Watch/etc.)
rather than just opening the screen, since triage operates over the whole
pipeline the same way those do, not on one record at a time.

Tested in `tests/rfqpipelinetest.mjs` (17 checks): five RFQs seeded
specifically to exercise the ported rules — an untouched 10-day-old
enquiry, one sent 20 days ago with no reply, one won but never sent to the
IDMS, one fully costed/quoted/numbered with its drawing read (correctly
flags nothing at all), and one Closed (correctly excluded from triage
regardless of its own state). One test-fixture mistake caught along the
way: an RFQ intended to prove "nothing gets flagged" still tripped the
"drawing not read" rule because the fixture never set `extract.readAt` —
a fact about the test, not the app, fixed by completing the fixture rather
than weakening the assertion.

**Unchanged**: Payroll and the 15 pure website-design tabs. Full suite (40
files) clean throughout — same 2 pre-existing, unrelated smoketest
failures.

## Payroll — native, with the engine proved identical before any UI was built

The one screen deliberately held back all session, on the grounds that a
mistake here does not show as a wrong number on a dashboard — it shows in
someone's bank account.

**A real gap found first, which would have caused silent miscalculation.**
The statutory rules Payroll reads include `enabled` toggles on PF/ESI/PT
(`if(pf.enabled && emp.pfApplicable!==false)`) plus LWF, overtime
multiplier/basis, and gratuity/bonus accrual — none of which the earlier
Statutory & Masters build captured. Had Payroll been built on it as it
stood, `pf.enabled` would have been `undefined` and **PF, ESI and PT would
have silently not been deducted at all**. Extended Statutory & Masters with
those fields first (+4 tests), before touching Payroll.

**The engine was ported line-for-line, then proved, before any UI existed.**
`calcPayslip()` and its four helpers (`slabTax`, `surchargeRate`,
`annualTaxBeforeCess`, `grossMonthly`) became `prCalcPayslip`/`prSlabTax`/
`prSurchargeRate`/`prAnnualTaxBeforeCess`/`prGrossMonthly`. This code
computes marginal relief on *both* the 87A rebate and the surcharge —
subtle, legally-specific arithmetic where a plausible-looking
reimplementation is worse than useless. A throwaway harness extracted both
implementations from their real source files and ran them against identical
inputs across ten cases: low earner, LOP + overtime, above the ESI limit
with the PF ceiling biting, just under and just over the 87A rebate limit
(the marginal-relief boundary), a surcharge band, the surcharge
marginal-relief edge, a manual TDS override, per-employee PF/ESI/PT
opt-outs, and a zero structure. **All ten byte-identical.** Only then was
the screen built on top.

**The screen** (`hr_payroll_native`, replacing `e:payroll` in HP_TILES):
a readiness guard listing what to fix before approving (missing structures,
unconfirmed tax slabs, no recorded reviewer), draft building from the real
attendance register, an editable pay register with every deduction shown
per line, approval with a stated reason, and a printable pay register.
Payable days come from attendance; anyone with no attendance marked is
included at full days and flagged `fromAttendance:false` rather than
quietly omitted from their own payslip. Approved runs render read-only with
no Save/Approve/Discard, matching the server's own rules (already enforced
in `api/hr.js` — approved runs cannot be edited, reopened or deleted), and
a period with an approved run refuses a second one.

Tested in `tests/payrolltest.mjs` (22 checks) against hand-calculated
figures — Asha at 28/30 days on a 15,000 structure with 4 OT hours gives
gross 14,267, PF 896, ESI 108, asserted to the rupee — plus the
immutability rules and the exited-employee exclusion. `hrpayrolltest.mjs`
had one assertion still expecting the old iframe behaviour; updated to
assert the native screen, the same way every other migrated tile's test
was.

**Remaining, and honestly stated**: RFQ Pipeline Phase 2 (drawing reading,
costing, the line-item quotation builder with its own PDF), the 15 pure
website-design tabs (Hero, Gallery, Founders, Brand, Design, Sizing,
Capabilities, Process, Stats, Industries, Certifications, AI Chatbot,
Testimonial, Contact, Sections — an image-heavy CMS with no IDMS
equivalent concept), and the website-side setup wizard. Full suite (42
files) clean — same 2 pre-existing, unrelated smoketest failures.

## RFQ Pipeline — Phase 2: drawing reading, costing, quotation drafting

Same discipline as Payroll, for the same reason: the costing engine is
arithmetic with a right answer, so it was **ported and proved, not
reimplemented**. `computeCosting`, `machineRate`, `labourRate`,
`availableHours`, `totalMachineHours`, `defaultLabourRate` and `listCost`
became `rcComputeCosting` and its `rc*` helpers. A throwaway harness
extracted both implementations from their real source files and ran them on
six cases — simple weight×rate, an itemised BOM overriding it, tooling
amortised over tool life, an unmatched machine falling back to a zero rate,
packaging/freight/special processes together, and a zero-quantity guard.
**All six identical.** One real bug caught in the process: the first draft
of `rcListCost` dropped the original's `isFinite` guard, so a tool with a
zero life would have produced `Infinity` and poisoned the whole cost sheet.
Fixed before the comparison was run.

**The division of labour is the point of this screen, and it is enforced
rather than described**: the AI reads the drawing and proposes the route and
the times; *every rupee* comes from the company's own figures on Quoting &
Costing Setup. The prompt says outright "Do NOT price machine time, labour
or overhead", lists only the company's real machines and labour grades, and
material prices found in the price book override whatever the AI supplied.
`tests/rfqpipelinetest.mjs` proves this rather than trusting it: the mocked
AI deliberately returns a material rate of 999, and the test asserts the
saved costing carries 85 — the real price-book rate — with its source
recorded as "Company price book".

**Built**: drawing reading (with the 3D-CAD refusal and the missing-items
list intact), the full costing breakdown per operation with the cost
build-up beneath it, quotation drafting numbered from the configured format
and sequence with tax at the configured rate, plus a printable internal
cost sheet (marked CONFIDENTIAL, carrying the AI's stated assumptions and a
note on exactly what the AI did and did not supply) and a printable
customer quotation.

**Still on the website, deliberately**: sending the quotation by email and
its customer-facing PDF template. Those touch the send path and its own
document layout, which is its own piece of work — and a quotation sent with
the wrong template is a customer-facing mistake, not an internal one.

30 checks in `tests/rfqpipelinetest.mjs` (up from 17). One existing
assertion needed updating: per-RFQ controls moved inside the expandable
detail in Phase 2, so the test now opens the row before reaching for the
stage selector. Full suite (42 files) clean — same 2 pre-existing,
unrelated smoketest failures.

**Remaining after this**: the 15 pure website-design tabs (Hero, Gallery,
Founders, Brand, Design, Sizing, Capabilities, Process, Stats, Industries,
Certifications, AI Chatbot, Testimonial, Contact, Sections) and the
website-side setup wizard.

## Website Content — fifteen design tabs as one schema-driven screen

I had flagged this as the hardest remaining piece and possibly not worth
doing — an image CMS with no IDMS equivalent to port into. Looking at the
actual data changed that assessment: the fifteen tabs are only **two shapes**
underneath. A handful of plain text fields (`heroHeadline`, `capTitle`,
`contactAddress`…), and lists of `{id, image, one or two labels}` —
`capabilities`, `process`, `stats`, `gallery`, `industries`, `certs`,
`founders`, plus two plain string lists (`ticker`, `botChips`).

So this is one screen driven by a `WC_SECTIONS` schema, not fifteen bespoke
editors. Writing fifteen would have been fifteen times the code and fifteen
places for the same bug. Each entry declares its `fields` and, where it has
one, its `list` (array name, image key, columns). The renderer handles text
inputs, textareas, image upload/clear via the same `C.uploadFile()` every
attachment in this system already uses, row reordering and removal. One
notable irregularity handled by the schema rather than a special case:
`founders` stores its image under `photo` while every other list uses `img`.

Also carried over: the section visibility toggles (`data.sections`), which
hide a section from visitors while keeping everything entered, so it can be
turned back on unchanged.

**The check worth having**, and the reason this screen could be trusted at
all: a field name that *looks* right but is not one the website reads would
save happily and change nothing on the live site — the worst kind of
failure, because it looks like it worked. `tests/websitecontenttest.mjs`
therefore reads `index.html` itself and asserts that every text key and
every array this screen writes actually appears in the website's own source.
20 checks, including reordering, the `photo`-vs-`img` irregularity, section
toggles saved as real booleans, and the unrelated company profile surviving
a save to the same shared record.

**Deliberately not moved**: Design, Sizing and Brand. Those are the
website's own theme system — colour tokens, type scale, spacing — and they
are edited against a live preview of the site itself, which is the website's
job, not the ERP's. Moving them would mean rebuilding a theme previewer
inside IDMS to no benefit.

**What genuinely remains**: quotation email sending with its
customer-facing PDF template, and the website-side setup wizard. Full suite
(43 files) clean — same 2 pre-existing, unrelated smoketest failures.

## Sending the quotation — and a caution that turned out to be overstated

I had twice deferred this as "touches the send path and its customer-facing
PDF template, which is its own piece of work." Reading the actual code
showed that was wrong on the substantive point: **there is no PDF
attachment pipeline on either side.** The website's own `mailquote` action
builds a plain-text body from `quoteDoc` and posts it to `/api/notify` —
the same endpoint already used for RFQ acknowledgements and owner alerts,
already handling Resend and the WhatsApp Cloud API, already reachable with
the session the IDMS holds. So this was a small, well-understood addition,
not a document-generation project.

Built as a **Send to customer** button on the native RFQ Pipeline, which:
- is gated behind a `confirm()` naming the customer, the quotation number
  and the total. This is the one action in the platform that puts a price
  in front of a customer and cannot be taken back, so it gets the same
  deliberate friction Payroll approval does — and if the quotation has been
  sent before, the confirmation says so and when;
- builds the body from the quotation itself (part, quantity, unit price,
  subtotal, tax at the configured rate, total, validity, payment and
  delivery terms), not just the AI's covering text;
- **reads the send result and refuses to lie about it** — `/api/notify`
  returns per-channel result strings, so a response without `EMAIL SENT`
  raises the error and the quotation is *not* marked as sent. A send that
  silently looked successful would be worse than one that plainly failed;
- records `sentAt`/`sentTo` on success and moves the stage to Approved &
  Sent.

`tests/rfqpipelinetest.mjs` grew to 40 checks, covering both failure paths
explicitly: declining the confirmation sends nothing at all, and a server
refusal surfaces as an error without marking the quotation sent.

**What is actually left**: the website-side setup wizard — the website's
own Setup tab is a self-checking checklist rather than a linear
step-through, and whether to convert it is a judgement about that screen,
not an unfinished migration. Everything else the IDMS should own now lives
in the IDMS. Full suite (43 files) clean — same 2 pre-existing, unrelated
smoketest failures.

## The setup wizard — and closing the last duplicate

Rather than convert the website's Setup tab into a linear wizard, I read it
properly first and found it had **three things the IDMS wizard's Connections
step lacked**, which mattered more than its shape: a live readiness badge per
service, collapsible "how to get this" instructions (getting a Resend key,
verifying a sending domain), and real test buttons that actually send.

So the work went the other way round: those were brought into the IDMS
wizard instead.

- **Readiness badges** mean "could actually work", not "somebody typed
  something". Email needs a key *and* a sender; WhatsApp needs token, phone
  id *and* template together; any one AI provider is enough. Anything
  part-filled reads **Incomplete**, which is the honest answer and the one
  that saves a support call.
- **The how-to guidance** was carried over, including the warning that
  `onboarding@resend.dev` only delivers to the address registered with
  Resend — so customers receive nothing. That is exactly the kind of thing
  somebody discovers the expensive way.
- **Test buttons** for email, AI and WhatsApp, reporting the server's own
  result string rather than a cheerful assumption. The WhatsApp test refuses
  outright if no number is saved instead of sending nowhere.

**A duplicate closed**: the old framed `admin_site` was still in the menu as
"Website Content" alongside the new native screen of the same name — two
entries, same label, different screens. Renamed to **Website — theme &
preview**, with its description corrected to say what it still owns (the
theme editor and its live preview) and where everything else now lives.
That framing is deliberate, not leftover: a theme previewer belongs with the
thing it previews.

`tests/setupwizardtest.mjs` grew to 32 checks. One of my own assertions was
wrong — I asserted email would read Incomplete at a point where the test had
already saved both the key and the sender, so Ready was correct. Fixed the
assertion rather than the behaviour; asserting my own mistaken assumption
would have been worse than no test.

Full suite (43 files) clean — same 2 pre-existing, unrelated smoketest
failures that predate all of this work.

## The two failures I reported every turn and never fixed

For roughly twenty turns this log ended with "same 2 pre-existing, unrelated
smoketest failures". They were pre-existing, and they were unrelated to each
migration — but "unrelated to what I am doing right now" is not the same as
"not my problem", and repeating the phrase had quietly turned a real defect
into background noise.

Both were the same bug. `loadGateContent()` read a custom `welcomeTitle`
from the login-screen record and, when none was set, left the hard-coded
headline "Welcome to the future of manufacturing" in place. It never fell
back to the company name — so the sign-in screen of a system sold to another
company greeted them with stock marketing copy and their own name nowhere on
it. The test's own comment had said exactly this all along: "the sign-in
screen is supposed to carry the company name from the site profile. If it
fails, the screen has lost it."

The fix is four lines: a custom welcome still wins; failing that, the gate
names the company from the profile `/api/content` was already returning and
the gate was already fetching. The generic line survives only as the
last-resort default when there is no company name at all — a brand-new
deployment before anything is set up.

**`node tests/run-all.mjs` now reports `all suites clean`** — 40 files,
1,155 checks, zero failures. That is the whole board green for the first
time in this work.

## Website Theme & Preview — native, and my "belongs with the website" call overturned

I had argued this one should stay framed: "a theme previewer belongs with
the thing it is previewing." Asked to move it anyway, and the reasoning was
weaker than it sounded. The preview does have to be the real site — but that
only means the *preview pane* is an iframe. It never meant the *editor* had
to live on the website.

So: editing is native (`admin_theme`), previewing is the real site in a
frame beside it. Six colours, twelve spacing sliders, brand name/suffix and
two toggles — small and regular, like the design tabs turned out to be.

**Unsaved changes show in the preview without being published.** Moving a
control pushes CSS variables straight into the frame using the same names
and the same derived shades `applyVars()` uses on the site itself
(`--sky-light` from `--sky`, `--radius-sm` from `--radius`, and so on), so
what is previewed is what will be published. Nothing reaches the record
until Save. Discard restores the last saved state; Reset restores the
original defaults but still waits for Save — a reset that published
immediately would be a trap.

**Two collisions found and fixed**, both mine:
- `th-save`/`th-msg` were already the Tool History screen's ids. `opstest`
  caught it immediately — the tool test read *"Saved. The live website uses
  this now."* Renamed the theme's to `wt-`. Worth noting the test suite
  caught this within seconds of the change; a manual pass would very likely
  have missed a wrong message on an unrelated screen.
- I consumed the `Website Content (native)` comment header in a
  `str_replace` and had to restore it.

The old framed `admin_site` entry is gone from the menu entirely, along with
its `EMBEDS` description and routing. `smoketest`'s "the website screens
open in a frame" check was updated to assert the opposite: the screen is a
native panel, the old entry is gone, and the preview points at the real
site.

**The embed machinery itself is now vestigial** — `emb_hr` redirects to the
native Payroll screen and `emb_pipeline` is no longer in the menu. It is
left in place deliberately: old bookmarks and stored per-user permissions
still name those ids, and removing the redirects would break them for no
gain.

`tests/themetest.mjs` is new (26 checks). Full suite: **all suites clean**
— 41 files, 1,207 checks, zero failures.

## Three-part audit: working screens, complete agent cover, complete sample data

### The Agentic AI screen covered 30 of 116 screens

It was a hand-written list, so it had drifted badly. Rewritten to derive
itself from `MENU`: `aaAllTiles()` merges the hand-described agent tiles
(`AA_TILES`, which carry the load/run/gap functions) over every live menu
entry, so a screen cannot exist on the menu and be missing here again —
the same self-deriving approach the title-bar search already used.

Every tile now offers an action, as asked: **Fix with AI →** where an agent
can genuinely do the work (11 screens), **Open and fix →** everywhere else,
which navigates so it can be done by hand. `aaFixWithAi()` falls through to
plain navigation for a screen with no agent rather than silently doing
nothing. Verified in a live DOM: 113 tiles against 113 live menu screens,
0 missing, 113 offering an action.

**A real bug this surfaced**: a few screens are deliberately on the menu
twice under different names (Tools Addition / Tool History Card are one
screen; Equipment & Gauges / Calibration Report likewise). Two tiles meant
two DOM elements with the same badge id, and the second never resolved —
it sat on "…" forever. Deduped by screen id, keeping the first occurrence.

### Sample data seeded 13 record kinds; the screens read over 50

Added `demoSeedRest()`: suppliers, machines, tooling, raw material, PFMEA,
control plan, CNC programme, PPAP, APQP, MSA, NCR, machine check sheet,
invoice, sales plan, employees, policies, leave, requisitions, candidates,
recognition, surveys, KPIs, appraisals, exits, competency, skills, TNI,
training, roles, succession, org chart, DWM, tasks, QMS documents, audit,
CFT, signatories, document formats and legal documents — with `removeDemo()`
extended to match, including the HR endpoint, which lives behind its own API
and so needed its own clearing pass.

It is **deliberately imperfect**: a machine never serviced, a gauge overdue,
an insert near the end of its life, a published policy nobody has
acknowledged, a review date already past, an NCR past its due date, a
licence expired, somebody short of their role standard, somebody never
assessed. A works with nothing wrong gives the agents nothing to find and
proves nothing about them.

`tests/sampledatatest.mjs` runs the real seeder through the real client code
and reads every kind back the way a screen would — so it covers saving *and*
retrieval across nearly the whole record model in one test — then checks
Remove takes out exactly what it put in and nothing else.

### Two things worth recording about the test run itself

The sample-data test polled in 500ms chunks while the seeder ran, which made
it appear to take minutes. Tightened to 50ms: **6 seconds**.

And I wasted several turns on a broken completion check: `pgrep -f
run-all.mjs` matched the shell command *containing that string*, so the
runner always looked "STILL RUNNING". Replaced with a sentinel appended to
the output file. Worth remembering — a check that can never report success
is worse than no check.

**All 42 suites, 1,237 checks, zero failures**, verified by diffing the
result list against the suite files so nothing could be silently missing.

## Backup split into two scopes, matching the two flushes

Export/Import was a single "everything" JSON while the flushes were already
split into settings-and-admin versus data-and-records. That mismatch was
the actual problem: you could flush one half but only ever back up or
restore both together, so there was no safe way to move a company's
branding to a new deployment without dragging its parts along, or to
re-seed data without overwriting the keys that make email work.

Backup & Restore is now two self-contained blocks, each with its own
download, upload and flush:

- **Settings & admin** — company profile and branding, website content and
  theme, login screen, quoting/costing rates, statutory rates, document
  numbering, devices, provider keys. Exports `scope:'settings'`.
- **Data & records** — parts, documents, HR employees, HR items and RFQs.
  Exports `scope:'data'`. This one deliberately gained HR and RFQs, which
  the old single export never included at all: it only carried parts, docs
  and idms settings, so an employee master or an enquiry pipeline could
  never actually be restored from a backup.

**Each upload checks the `scope` of the file and refuses the wrong half by
name** rather than half-applying it. Restoring a data file into the
settings slot would have wiped the branding; a mismatch now says so and
does nothing.

**Provider keys are exported masked, and say so.** The server returns them
masked and this does not try to defeat that — the settings export lists
what was configured so it can be checked, and the restore message states
plainly that keys must be set again on the new deployment from the Setup
Wizard. A backup that silently carried working secrets between deployments
would be the wrong thing to build.

`smoketest.mjs` gained seven checks proving the separation is real rather
than described: the data download carries records and no company profile or
keys, the settings download carries the profile and no parts, documents or
employees, and uploading a data file into the settings slot is refused with
nothing written.

**42 suites, 1,244 checks, zero failures**, verified by diffing the result
list against the suite files.

**A note on the runner**, since it has now cost time twice: individual
suites that take four seconds standalone occasionally hang indefinitely
inside `run-all.mjs` (smoketest once, themetest once). It is environmental,
not a code fault — each was re-run standalone immediately afterwards and
passed in seconds. Worth fixing properly at some point by having run-all
kill a child that outlives its timeout rather than waiting on it forever.

## The right-side hero visual — a real gap in my own Website Content screen

Asked where the hero video upload had gone. It had gone nowhere: when the
fifteen design tabs were collapsed into the schema-driven Website Content
screen, the hero section carried its **text** (eyebrow, headline,
sub-headline, buttons, ticker) and none of its **visual**. Six keys were
simply absent from the editor — `heroBannerDataUrl`, `heroVisual`,
`heroVideoDataUrl`, `heroVideoUrl`, `heroVideoCaption`, `heroSignatureImg`.

The website still reads all six, so any site already using a promotional
video kept showing it — but there was no longer any way to change it from
the IDMS. A gap that leaves existing content working is the easy kind to
miss, and the cross-file key check written at the time did not catch it
because it only verified that every key the screen *writes* is one the
website reads — never the reverse.

Added to the schema as two new capabilities, not as a hero special case:
`images:` for plain image fields on any section, and `visual:` for the
mode-dependent block. `wcDrawVisual()` shows only the fields the chosen
mode needs — a video address sitting under a "signature image" choice reads
as broken even when it is merely unused — and previews a video with
`<video>` rather than `<img>`.

The website's ~8 MB direct-upload limit is now **enforced before the upload
runs** rather than discovered as a failure afterwards, with the message
pointing at the URL field as the alternative, which is what the website's
own hint says.

`tests/websitecontenttest.mjs`: 20 checks → 32, including that the mode
switch reveals and hides the right controls, that an oversized video is
refused with no upload attempted, and that all six keys are ones
`index.html` genuinely reads.

## Backup & Restore: the logout bug, and three real gaps in what it carried

Four things were asked for together, after a real deployment found that
flushing settings dropped the person back to the sign-in screen. Three of
the four turned out to be the same underlying problem in different places:
**the backup only ever carried some of what the flush beside it wipes.**

### 1. Flush, Restore and Save no longer drop you at the sign-in screen

The bug was the *correct* security rule catching the wrong case. Opening
`idms.html` with no other signed-in tab open deliberately signs nobody in —
the shared-works-PC protection documented under Authentication, which must
not be undone. But Company Profile save, Settings restore and both flushes
each `location.reload()` *immediately after* proving the session is alive,
and the boot sequence could not tell that reload apart from a crash or a
handover, so it revoked a perfectly good, just-proven token.

The fix is a one-shot, short-lived hint rather than any weakening of the
rule: `Core.markSelfReload()` writes `app_self_reload` to sessionStorage
immediately before those three reloads, and `Core.consumeSelfReloadHint()`
spends it once, 15-second window, on the way back in. With a live hint,
`adoptOpenSession()` re-checks the leftover token with the server directly
instead of discarding it; **without one, nothing changes at all** — no
hint, no token, sign-in screen, exactly as before.

**Sign Out deliberately does NOT mark its reload**, and `selfreloadtest.mjs`
asserts that against the source. Marking it would mean somebody who signs
out on a shared PC is silently signed back in by the reload their own click
caused — the precise scenario the whole design exists to prevent.

### 2–3. The two scopes now mirror the two flushes, table for table

`flushTable()` in `server/routes/idms.js` is the authoritative list of what
each scope owns, and Backup & Restore is supposed to mirror it exactly.
It did not. **Settings** never carried registered attendance devices.
**Data** never carried counters, attendance, leave, training, pay runs,
punches or the PPC order book — and RFQs were *exported but never
restored at all*, so an enquiry pipeline in a backup file was unrecoverable.

Several list endpoints also capped a single request well below what a
backup needs (parts at a hardcoded 1000, RFQs at 500, and so on). Every one
of them gained **additive** `limit`/`offset` — omit both and the behaviour
is byte-for-byte what it was, so no existing caller changed — and
`bkFetchAll()` pages each until a page comes back shorter than asked for.
A works with 2,400 parts now backs up 2,400 parts instead of 1,000 and no
warning.

Three decisions worth keeping:

- **Counters restore to an absolute value, not a relative bump.** A new
  `set` mode on `what=serial` (admin/developer only) puts each counter back
  exactly where it was, so the next GRN issued after a restore cannot reuse
  a number a restored document already carries.
- **Raw device punches are exported but never restored automatically.** The
  summarised `hr_attendance` day-records — which payroll and every report
  actually read — *are* restored, in batches of 500 through the endpoint's
  existing `records:[]` upload. The screen says so rather than leaving the
  asymmetry to be discovered.
- **Restoring an RFQ must not re-fire live notifications.** The public POST
  unconditionally emails the owner and acknowledges to the customer;
  replaying a year of enquiries through it would spam both. `restore:true`
  (honoured only for a signed-in caller) inserts the record and returns
  without calling `sendNotification` at all, and upserts rather than
  `DO NOTHING`, so re-running the same backup is not silently a no-op.

**Login credentials and audit trails are still deliberately excluded.**
`auth`/`users`/`login_codes` must never travel in a JSON file, and an audit
trail is a log of what happened on *this* deployment, not something to
splice into another one's history — the same reasoning flush itself applies
when it wipes `idms_audit` last and writes a fresh entry.

### 4. Pictures and videos travel in the JSON now

The backup carried the records that *point at* files and none of the files,
so a restored deployment came back with every drawing, logo, signature and
video reference resolving to nothing. Every stored asset now rides in the
same `idms-data` JSON as the identical `data:` URL `Core.uploadFile()`
already sends, alongside its id — which matters more than it looks:
`POST /api/assets` now accepts a **caller-supplied id and upserts on it**
(additive; an ordinary upload sends no id and still mints one), because a
freshly-minted id on restore would silently orphan every reference to that
file everywhere else. A malformed id is refused in favour of a fresh one.
Assets sit in the **data** scope because that is where `flushTable()` puts
them, branding images included.

One file that cannot be read back is **named and skipped**, not silently
dropped and not allowed to fail the whole export.

### Two rules the restore side now follows everywhere

**A failed restore never reloads or navigates away.** Both handlers used to
reload after ~1.8s regardless of the outcome — long enough to miss
"Restored 0, 4 failed", which is usually a session that expired mid-restore.
Nothing reloads or leaves the screen until every record is confirmed
written, and an expired session is named as the cause with what to do.

**A one-time secret is never hidden behind a timer.** A non-ADMS device's
shared key never leaves the server, so restoring one necessarily mints a
brand-new key. When that happens the restore **skips the automatic reload
entirely** and leaves the key on screen until the admin reloads by hand.

### Tests

`tests/backuprestoretest.mjs` — 77 checks. It drives the real
`server/routes/rfqs.js` and `server/routes/assets.js` handlers end to end
(module hook, in-memory fakes, the same technique `devicetest.mjs` uses)
and the real Backup & Restore screen in jsdom. The ones that earn their
keep: a restored RFQ sends **no** notification while an ordinary submission
still sends two (so the recording fake cannot be trivially empty); a 2,005-
record collection is proved to be fetched across two pages with all 2,005
surviving; a restored picture and video arrive as real base64 content under
their original ids; and a new-key device restore leaves `app_self_reload`
unset — the observable proof that no auto-reload was scheduled over the top
of a key shown once. `selfreloadtest.mjs` — 15 checks — covers the sign-in
fix, including that an expired hint and a hint-less leftover token are both
still revoked.

**A note on this checkout**, for whoever picks it up: 10 suites fail before
any of this work and still fail identically after it. `devicetest.mjs` and
`flushservertest.mjs` import from `api/device.js` / `api/idms.js`, which do
not exist here — the routes live under `server/routes/` — so they crash at
import, before their own first assertion. `server/_db.js` also exists twice
(`server/server/_db.js` is what `server/routes/*.js` actually resolves to;
the two are byte-identical), and `agentic.js` imports a third copy under
`api/`. None of that was touched here, but it is the first thing that will
confuse the next person.

## Five things a live deployment found — and one explanation of mine that was wrong

All five were reported together with screenshots of elixirtec.com. Four were
real defects; the fifth was a feature that did not exist. What links the first
three is the shape of the failure rather than the cause: **in each one the
screen said something different from what had actually happened**, which is the
kind of bug that costs a user far more than an honest error does.

### 1. A successful enquiry was announced as a failure

`rnSaveEnquiry` saved the RFQ, then called `wireGoto(document.getElementById(
'rn-msg-box'))`. **`wireGoto` has never existed anywhere in this codebase** —
every other screen wires those links inline with
`querySelectorAll('[data-goto]').forEach(...)`. Under `'use strict'` that is a
ReferenceError, it was raised *inside* the `try` whose `catch` reports failure,
and the outer catch overwrote the confirmation with **"Not created — wireGoto is
not defined"** over an enquiry that was already on file. People then entered it
again.

The wiring is now the inline pattern, and — this is the part worth keeping —
**everything after the save runs outside the try that reports failure**. The save
records what it achieved in `rnSaved`; the confirmation is drawn from that
afterwards. A fault while drawing a link can no longer report that a record was
not created. Any screen that does presentation work after a write has this same
hazard; this is the second time in this project a cosmetic step has been able to
misreport a completed write (the first was the APQP save-on-change queue).

### 2. Costing failed on ordinary AI replies

`rfqParseAiJson` was a **third, weaker copy** of the tolerant reader, private to
the RFQ pipeline. It handled code fences and raw line breaks, then did
`lastIndexOf('}')` and gave up. `core.js`'s `parseAiJson` — the one the
Conventions section above has always said is the reader for AI replies in both
files — additionally strips comments, ignores prose after the object, and
**repairs a reply cut off at the token limit**.

That last case was not an edge case here. The costing prompt asks for the
material, every operation, the dimensions under each operation, tooling, jigs,
gauges, consumables, packaging, logistics, freight, special processes and the
assumptions behind all of it, and it asked for it in **4500 tokens**. A real
answer for a six-operation part does not fit, so the reply was truncated as a
matter of course and the user was told *"The AI answered, but not in the shape
the costing needs"*. The shape was right; the reply was unfinished.

Three changes, and the third matters most:

- `rfqParseAiJson` now delegates to `C.parseAiJson`. One reader, as intended.
- The costing call asks for **9000** tokens (the server caps at 12000).
- **A repaired reply is declared, not silently accepted.** A truncated costing
  parses cleanly and reads as complete while missing the end of the route — on a
  cost sheet that understates the price invisibly. `rfqReplyCutOff()` detects it
  (one pass, tracking string state, so a brace inside a quoted value is not
  mistaken for structure), stores `costing.truncated`, and says on screen that
  the last operations are missing. The two failure messages are also kept apart,
  as the Conventions note requires: a reply cut off even at 9000 tokens needs a
  different answer from one that ignored the format.

### 3. Restored settings came back with every image broken

`site_content` holds only **references** to pictures — the logo, the hero banner
and video, every capability, gallery, founder and certificate image are all
`/api/assets?id=…` — while the bytes live in the `assets` table. The two-scope
split followed `flushTable()` exactly, which puts `site_content` in **settings**
and `assets` in **data**. So restoring a settings backup brought back every
reference and none of the images, and the public site came up with broken
pictures and nothing on screen explaining why.

The settings export now carries **the files its own content points at**
(`bkContentAssetIds()` walks the content record for asset ids; `bkFetchAssets()`
is shared with the data export, which still carries every file unchanged). An
asset landing twice is a no-op — `/api/assets` upserts on a caller-supplied id.
Restoring writes the images **before** the content that references them, and an
older file that has references but no images **says so by count** and points at
the data JSON, rather than leaving broken pictures to be discovered.

`idmsSettings:` also read `settings`, a module-level variable belonging to the
home screen rather than anything that function owns. It is read fresh now.
**See the correction below — this one was not the bug I first said it was.**

### 4. "Parts, BOM & routing (for quoting)" was dead, and the objection was right

The user's own reasoning was the correct one: *every part has a unique BOM and
routing and it should be derived by AI from the drawing data.* The panel was
worse than redundant — `rfqCfg` is loaded as `{costBase, machines, labourGrades,
materials, quoteCfg, company, quoteSender}` and **has no `parts` key at all**, so
nothing in the native costing path ever read it. Its only consumer was
`partById()` in the website's `#ppc-page`, already recorded above as unreachable
from the menu. It was a second, hand-kept part list with a second BOM and a
second routing, feeding a screen nobody could open.

The editor is removed and replaced with a note saying where the real ones live:
the RFQ Pipeline derives route, times and BOM from the drawing, and
`Send route to the part` writes them onto the part, where Process Master, Bill
of Materials and the Dimensions Master own them and the PFD, PFMEA and control
plan are built from them. **The records are deliberately not deleted** — the save
posts the whole content object, so an old deployment's typed-in list survives
untouched. `quotingsetuptest.mjs` asserts exactly that: editor gone, records
kept.

### 5. Balloon drawing and drawing data — new, not a fix

Nothing of the kind existed. Reading a drawing produced `requirements`, a flat
list that mixed a bore diameter, a material grade and a plating spec into one
column of prose with no item numbers — nothing to balloon against, nothing to
inspect from.

`characteristics[]` is that list done properly: numbered from 1, typed
(Dimension / GD&T / Material / Finish / Treatment / Thread / Note / Standard),
with the nominal and the **signed** deviations kept apart from the text, the GD&T
callout kept as written, and a position on the sheet. **Balloon drawing** prints
the customer's own drawing with those numbers over it; **Print drawing data**
prints the table alone.

Four decisions worth keeping:

- **The AI never decides CC/SC.** It marks a class only where the drawing itself
  does. Same rule as the PFMEA parser: the class is copied, never inferred.
- **An unplaceable characteristic is listed, never guessed at.** The prompt says
  to set the position null rather than estimate it, and the sheet prints those
  beneath the drawing as *"real requirements and still have to be inspected"*. A
  balloon in the wrong place is read as fact by everyone downstream.
- **A balloon is a circle, and it does not cover what it points at.** Both were
  got wrong first and caught by rendering it rather than by reading the code.
  Drawn inside an SVG whose viewBox is stretched to the image's aspect, every
  balloon came out an oval; and placed at the callout's own position — which is
  what the AI is asked for — it hid the dimension it numbered, so the title block
  read `MAT( 4 )D` instead of `EN8D`. The balloons are now positioned elements
  sized in **px** (round at any aspect), offset clear of the callout with a
  **vertical** leader back to it — vertical being the one direction a stretched
  viewBox cannot skew.
- **Both sheets carry the draft warning.** The numbers, the values and every
  balloon position are the AI's reading, and the sheet says so, because this is
  an FAI/PPAP-shaped artefact that somebody will otherwise hand to a customer.

### 6. The New Enquiry form could not attach a readable drawing

Not reported as such, but it is what *"the RFQ form should have the same function
as the website"* actually amounts to. The fields were never the problem — this
form has more of them than the public one. The **function** missing was drawing
conversion: the public form converts PDF/DXF/PNG to JPEG in the browser before
upload, because the drawing reader is given images and not PDFs, and
`drawing-convert.js` was not even loaded by `idms.html`. A PDF taken over the
phone uploaded happily, the enquiry saved, everything looked right — and
*Read drawing with AI* could not read it, days later, with nothing to say why.

`idms.html` now loads the same converter, with the same 3MB ceiling, the same
page chooser (the drawing is not always page 1), the same preview — *a
conversion nobody can see is a conversion nobody can check* — and the same rule
on failure: a file that cannot be converted is **still attached**, with the
reason said out loud.

---

### The correction: an explanation of mine that was wrong

I told the user the `idmsSettings: settings` line meant **the whole
`idms_settings` table had never been exported**. The first half was right; the
second was not. That variable is also filled during boot
(`var settingsP = C.idms.settings()...`), so in practice it usually holds the
real settings by the time anyone presses Export.

I found this by **reintroducing the bug to check my own new test caught it**. It
did not — the image checks failed and the settings checks passed. The fix is
still worth keeping (a boot-time snapshot goes stale as soon as a setting is
saved without a reload, which is why the invoice screen already patches that same
variable by hand), but it is a robustness change, not the cause of anything the
user saw, and the test comment now says so rather than claiming a bug it never
caught.

**The habit that is actually load-bearing here:** reintroduce the defect and
watch the new test fail. It has now caught two things in this project — a fake
`_db.js` that could not have seen the `sql.query` crash, and an explanation of
mine that was simply wrong. A test written after a fix proves nothing until it
has been shown to fail without it.

Worth recording alongside it: `newenquirytest.mjs` initially failed four checks
because its stand-in `File` was a plain object. The converted path posts a data
URL straight to `/api/assets` and never touches `FileReader`; the **fallback**
path — the file that could not be converted and must still be attached — goes
through `Core.uploadFile()` and therefore through `readAsDataURL`, which refuses
anything that is not a real `Blob`. The stand-in passed every converted case and
failed every fallback case, which was precisely the half worth testing. Use a
real `new window.File([...])`.

### Tests

`balloontest.mjs` (38) — the prompt asking for what the feature needs, a fenced
reply with prose in front of it, ± and asymmetric tolerances printing with the
right signs, the unplaced characteristic listed rather than dropped, a position
past the edge pulled back on, the top-of-sheet offset going downward instead,
and the draft warning on both sheets. `newenquirytest.mjs` (24) — the save
reported honestly both ways, the link wired without being able to take the
confirmation down with it, and conversion including the multi-page chooser, the
refusal-still-attaches rule and the oversized-image refusal.
`backuprestoretest.mjs` 77 → 92. `quotingsetuptest.mjs` 17 → 23.

**The baseline is unchanged:** the same 10 suites fail before and after this
work, for the reasons recorded at the end of the previous section (`api/*.js`
imports that do not exist in this checkout, and `server/_db.js` existing three
times over). None of that was touched here, and it is still the first thing that
will confuse the next person.

## Flush Data deleted the company's branding while promising not to

Reported with screenshots after the round above: every image on the public site
broken, the IDMS home banner broken, and — the screenshot that gave it away —
**the Website Content editor showing a broken thumbnail with a REMOVE button
beside it**. A REMOVE button means the record still holds a value. The reference
was intact; the file it pointed at was gone.

### The bug

`flushTable()`'s data scope ended with `assets`, under a comment reading *"not
users, not company profile/branding, not settings"*, and the screen said the
same thing in bold: **"Does not touch your company profile, branding, users,
keys or devices."**

But `assets` is where the branding lives. The logo, the hero banner, the hero
video and every capability/gallery/founder/certificate image are stored by
`C.uploadFile()` and referenced from `site_content` as `/api/assets?id=…` —
and `site_content` is deliberately **not** in the data scope. So Flush Data
deleted every picture on the website while promising it would not, and left
every reference behind pointing at nothing.

This is the same structural fault as the settings-backup bug in the previous
section, from the other direction: **the branding's references and its bytes sit
in different flush scopes.** Anything that touches one without the other breaks
the site. Both halves are now handled, and that is the thing to remember when
adding a third scope or a new kind of upload.

### The fix

The data flush keeps whatever the website content still refers to:

```sql
DELETE FROM assets WHERE position(id in
  COALESCE((SELECT data::text FROM site_content WHERE id = 1), '')) = 0
```

**One literal statement, deliberately** — no dynamic SQL, no array parameters,
nothing driver-specific. This file has already cost a release to `sql.query`
turning out not to exist on the deployed driver, and there is no precedent for
array binding anywhere in `server/routes/`. Matching on the id appearing
anywhere in the content JSON can in principle keep an asset it should not; ids
are base36 timestamp+random, so a collision with prose is negligible, and the
error direction is the safe one — a stray orphan row costs bytes, a missing logo
costs the website.

### It was verified against a real server, not reasoned about

PostgreSQL 16, four cases:

| case | result |
|---|---|
| content present | logo, hero video and a capability image nested in an array kept; part drawing and PO document deleted |
| **no `site_content` row at all** | everything deleted — correct for a fresh deployment |
| content row present but `{}` | everything deleted |
| **the same statement without `COALESCE`** | **2 of 2 assets survived — nothing deleted at all** |

That last row is why the `COALESCE` is load-bearing and not decoration: with no
content row the subquery is NULL, `position(id in NULL)` is NULL, the WHERE
never matches, and the flush would quietly do nothing to assets while reporting
success. Reasoning about it would very likely have got that backwards.

`flushtest.mjs` (+6) pins the shape so nobody simplifies it back to a bare wipe:
the bare `DELETE FROM assets` is gone, the guard and the `COALESCE` are present,
`site_content` is still absent from the data branch (checked against a **slice**
of that branch — an unscoped regex reaches into the settings list below it and
reports the opposite of the truth), and the screen's own wording now tells the
user the pictures are kept.

### Two smaller things from the same screenshots

- **The enquiry's attachment is a link now.** When a reading comes back empty the
  first question is whether the file is actually the drawing and can still be
  opened, and there was no way to ask it from that screen. It also makes a
  reference to a file that has gone missing show itself immediately instead of
  reading as an AI failure — which is exactly what this flush bug looked like.
- **"Nothing could be read from this drawing." was a dead end.** It now says the
  image is almost always the cause and names what to check: a photo of a screen,
  a scan too faint, the wrong page of a multi-page PDF, or a file that needed
  converting to an image first.

`balloontest.mjs` 38 → 42 covers both, with the AI mock returning a well-formed
reply that simply found nothing — an empty reading is not a parse failure and
must not be reported as one.

**Recovery, for anyone who hits this before deploying the fix:** a data JSON
downloaded before the flush carries every asset under its original id, so
restoring it puts the pictures back exactly where the references expect. Nothing
has to be re-uploaded by hand.

## The drawing was never sent to the AI — and why no test could see it

Asked to stop and re-read the whole thread rather than keep patching symptoms.
Doing that found the fault underneath most of what had been reported, and it
had been there since the native RFQ pipeline was built.

### The bug

```js
C.callAI(prompt, { attachmentUrl: r.fileUrl || r.fileName, maxTokens: 6000 })
```

`Core.callAI` reads `opts.attachment`. It has never read `attachmentUrl`, and
that word appeared **exactly once in the entire codebase** — on that line.
Every other AI caller on both halves of the platform uses `attachment`.

It was also the wrong shape. `/api/ai` expects `attachment` to be
`{ b64, mime }` — the bytes. The website's reader downloads the file and
base64s it; the IDMS version passed a URL string and had no download step at
all.

So **"Read drawing with AI" sent a vision model a prompt and no image.** The
model answered with empty arrays, and the screen reported *"Nothing could be
read from this drawing"* — which sent everyone to look at the file, when the
file had never left the browser. The test proves it: with the bug reintroduced
the recorded call reads `attachment=undefined attachmentUrl=undefined`.

Everything downstream inherited that emptiness — no material, no dimensions,
no features for the costing, so the route was invented from the enquiry text,
and the cost sheet and quotation came out unlike the ones the website
produces. **Four requirements that looked like separate features were one
bug.**

### The second half: two stores for one drawing

| | where the drawing lives | field |
|---|---|---|
| website enquiry form | inlined on the RFQ record as a `data:` URL | `fileDataUrl` |
| IDMS New Enquiry form | the `assets` table, referenced by link | `fileUrl` |

Neither side read the other's field, so a website enquiry opened in the IDMS
had no attachment at all — no link, no balloon drawing, and a reader with
nothing to fetch. `rfqDrawingSrc()` is now the single answer to "where is this
enquiry's drawing" and reads both; the reader, the link and the balloon
drawing all go through it. Enquiries already on file in either shape keep
working.

Three things are now refused honestly instead of reported as an empty reading:
a **PDF** (names the type, points at New Enquiry which converts), a **file
that has gone missing** (a storage problem — exactly what Flush Data
produced), and **3D CAD**, as before.

### Why no test caught it

Every earlier test of this chain **mocked the AI reply** — stubbing out
precisely the step that was broken. The whole feature could pass its tests
while never once sending a drawing, and it did. That is what made "all seven
things are already implemented" true structurally and hollow in fact.

`balloontest.mjs` now asserts on **what leaves the browser**, not on what
comes back: the attachment is present, under the right key, in the `{b64,
mime}` shape, and its base64 is byte-identical to the stored file. Reintroduce
the original line and five checks go red.

**Do not mock the thing under test.** Where an integration is the risk — what
actually reaches `/api/ai`, what the driver actually executes — assert on the
real payload.

### Two more defects, found only by rendering the documents

Running the whole chain end to end (read → characteristics → balloon →
costing → cost sheet → quotation) and *looking at the output* found two faults
on the **customer-facing quotation**, neither visible in the code:

**The printed line did not add up to its own subtotal.** `unitPrice` was
`Math.round(t.sellingPrice)` — whole rupees — while `subtotal` came from the
unrounded `t.lineTotal`. A real quotation printed `500 × ₹164.00 =
₹82,000.00` above a subtotal of `₹82,097.00`: ₹97 appearing nowhere on the
page, on the one document a customer checks with a calculator. The unit price
is now rounded to the two decimals the document prints and everything below is
derived from it, so the line multiplies out exactly. This is the money rule
already in Conventions — two decimals, never whole rupees.

**A raw model reply was printed to the customer.** `body: C.stripMarkup(txt)`
put whatever came back onto the document; a quotation was seen carrying
`{"coveringNote":"…","leadTimeDays":21}` above its terms. `rfqCoveringText()`
drops a reply that is not prose (JSON, a refusal) and strips a "Here is…"
preamble. The covering paragraph is decoration; the price and the terms are
the document, and they still print.

### What the reference cost sheet actually asked for

Worth recording, because it changes the requirement. In the reference PDF the
user supplied, those cost heads read **₹0.00** — Tooling, Consumables,
Packaging, Freight — with no detail tables, no jigs, no gauges, no logistics
line at all and no price sources. The request was never "reproduce this
sheet"; it was "these are zeros and they should be real". They are now: each
head has its own table with unit cost, life, cost/pc and **where the price
came from**, and material carries stock form, stock size, cut length and prep
cost. The sheet is a superset of the reference.

### A timezone bug found on the way, not yet fixed

`customerpotest` failed with two errors that were not in the baseline. It
failed identically against the previous build, so not new — it was the clock.
`thisMonthKey()` is:

```js
function thisMonthKey(){ return new Date().toISOString().slice(0,7); }
```

`toISOString()` is **UTC**. The works runs on Asia/Kolkata (+05:30), so
between midnight and 05:30 every day any date derived from "now" is a day
behind. Demonstrated: at 05:00 IST on 1 October 2026, `toISOString()` gives
day `2026-09-30` and month `2026-09`.

**89 sites** use `toISOString().slice(0,10)` for a day key and 5 use
`.slice(0,7)` for a month key. Anything recorded before 05:30 — a night-shift
production booking, an early check sheet, a DWM day — is filed under
yesterday, and Sales Plan opens on the previous month on the 1st. The records
are not corrupt, they are **dated wrong**, which is worse in a quality system
because nothing looks broken.

Two things make the fix cheap when it is done: `addMonths()` in `idms.html`
already does it correctly from local parts, and **`Core.dayKey()` already
exists in `core.js` and is already exported** — the correct helper, unused at
those 89 sites. The app was deliberately **not** swept in this pass; only the
test was fixed, and its own helper had the identical UTC/local mix (it passes
in the afternoon and fails after midnight). `monthFromNow()` there now uses
local parts and says why.

### Tests

`balloontest.mjs` 42 → 53 (the payload assertions, a website-shaped enquiry
read from `fileDataUrl`, the PDF refusal, the missing-file message).
`rfqpipelinetest.mjs` 40 → 45 (the line multiplying out to the subtotal, the
unit price keeping its paise, and a model that really answers in JSON having
its reply dropped — first written as a check that *could not fail* in that
suite, then rewritten to drive the fault for real). `customerpotest.mjs`
restored to 27.

One more harness lesson: a diagnostic that called `.slice()` on
`JSON.stringify(undefined)` **crashed the suite** instead of reporting the
failure it existed to catch. A harness has to survive the very case it tests
for.

**Baseline unchanged:** the same 10 suites fail before and after.

## Seven things from the live site — the AI strip, the menu, the form, the parser

Reported together with screenshots of elixirtec.com. What follows is what each
one actually turned out to be, which in three cases was not what it looked like.

### The costing error nobody could diagnose (item 7)

The screen said *"The AI answered, but not in the shape the costing needs"* and
showed a 160-character preview — **every character of which was valid JSON**.
The fault was further in than the preview reached, so there was no way to tell
from the screen what had gone wrong, and the only remedy offered (Re-plan route)
fixes a different problem.

Two changes, and the second matters more than the first.

**`parseAiJson` learned the bare words a model writes into a numeric schema.**
`NaN`, `Infinity`, `-Infinity` and `undefined` become `null` — "no value", which
every caller already handles — and an unquoted key or bare word value is quoted,
which is what a JavaScript object literal needed all along. A model asked for a
schema with forty numeric fields produces these constantly.

**Hardening a character scanner breaks its neighbours silently.** The first
version lifted the `e` out of `1e3` and quoted it, turning a good number into
invalid JSON. A letter directly after a digit or a decimal point is an exponent,
not a bare word, and there is now a guard saying so. That was caught by a test,
not by reading the code, which is the whole argument for writing the test first.

**The reply itself is now kept and shown.** `rfqParseFail` records what arrived
(up to 20,000 characters), the parser's own complaint, the length and the time;
it rides onto the stored costing error as `parseFail` and appears on screen as a
`<details>` disclosure — *"What the AI actually sent (N characters, when)"*. It
is cleared after use, so a later failure of a different kind cannot show the
previous reply as if it were its own. **A preview that stops before the fault is
worse than nothing, because it looks like evidence.**

### The RFQ form asked for what the drawing already says (item 4)

*Part or description\**, *Their part number* and *Drawing number* are gone. They
asked somebody on a phone call to copy out what is printed on the sheet, which
produced two versions of one fact with no way to tell which was right when they
disagreed. The reading in the pipeline supplies all three, and the drawing is the
one of the two that cannot be mistyped.

**Quantity stays**, and that is deliberate: it is the one thing in that group a
drawing cannot tell you — a commercial term the customer states, not a feature of
the part. It is now carried as a **number on the record** rather than surviving
only as a line of prose inside the message, and `rfqGenerateCosting` reads it, so
a 500-off enquiry is no longer planned and costed as a single piece unless
somebody notices and retypes it. Order of authority: what the estimator typed on
the cost sheet, then a quantity printed on the drawing, then what the customer
asked for, then one.

Removing the required field removed the only thing stopping an empty enquiry, so
the rule is now **a drawing, or the customer's words, or we stop here** — the
website accepts exactly the latter, and this form must not be stricter than the
public one.

### `chrome.js` — and why core.js was the wrong home (item 6)

An AI call takes fifty seconds. A screen where nothing moves for fifty seconds
looks exactly like one that has failed, so people pressed the button again, which
started a second call, and whichever answer came back last overwrote the other.

`chrome.js` is a new, dependency-free file carrying two things every screen has:

- **the progress strip** — one bar across the top of the window, naming the job
  and counting the seconds. The counter is a **depth, not a flag**: two calls in
  flight do not let the first to finish clear the strip out from under the
  second. It is raised in a `finally`, because a strip that sticks after a
  failure is worse than no strip — a failure is exactly when somebody is staring
  at the screen.
- **the scroll arrows** — two round buttons, and they hide the one that would do
  nothing. The height of an IDMS screen changes without anyone scrolling
  (expanding an RFQ row, drawing a table) and no event fires for that, so
  visibility is also re-checked on a slow timer.

**This was written into `core.js` first and that was wrong: `index.html` does not
load `core.js` at all** — it is a standalone page with its own AI gateway — so
half the platform would have got neither. Both gateways now raise the same strip;
`core.js` calls into `chrome.js` through a guard, because a progress strip is
worth having and it is not worth a broken IDMS if the file fails to load.

### Two layout faults jsdom could never have caught (items 1 and 3)

jsdom reports every height as zero, so *"does this menu run off the bottom of the
screen"* has no answer there. `tests/layouttest.mjs` drives real Chromium at real
window sizes. It **skips itself, passing, when Playwright is absent** — a layout
suite that cannot run must not fail the suite for everyone else.

**"Some hidden text in the screen"** was the hero banner's **alt text**. The
container is `line-height:0; overflow:hidden` so a picture sits flush with no gap
beneath it — right for a picture, wrong for anything else. When the file behind
the src had gone missing the img collapsed to its alt text (the hero headline)
and that CSS sliced it in half, leaving a broken icon and half a sentence jammed
under the menu bar. It read as a rendering fault; it was a missing file, and
nothing said so. The banner now waits for `onload` before showing, hides itself
on `onerror`, and says the picture is missing with a link to the backup that puts
it back. The handlers are attached **before** the src, or a cached image fires
them before anyone is listening.

**"Menu list getting hidden at the bottom"** — and the height was never the
fixable part. Measured at three window heights: HRM has 23 entries and **between
214 and 435 pixels of that list sat below the fold** inside a scrolling box that
only a thin scrollbar hinted at. A menu you have to scroll to discover is a menu
whose bottom half nobody knows exists.

The screen is 1366 across and the column was 268. **The room missing vertically
was there horizontally all along**, so a list too tall for the space is laid out
in two or three columns. Re-measured the same way: every group, at every window
height, now shows every entry with nothing hidden. Removing the widening puts
232px of HRM back under the fold at the user's own window size, which is how the
fix was proved.

### A check that could not fail, again

The concurrency check in `chrometest.mjs` first held both AI calls on one promise
and released them together — and **passed with the bug deliberately in place**.
With two calls ending in the same tick, "remove this job" and "clear every job"
look identical. It now releases them one at a time and asserts the strip survives
the first, which fails three ways without the depth counter.

This is the third time in this project a check has been written that could not
fail. The tell is always the same: **the fixture never puts the code in the state
the bug needs.**

### A harness tuned until it agrees with you proves nothing

A rendered reproduction of the banner symptom was written and thrown away: an img
with a dead src, alone in the shipped rule, did not clip the way the live screen
did. The honest move was to delete the repro and prove the fix by reverting it,
not to adjust the harness until it agreed with the diagnosis. The comment in
`layouttest.mjs` says so, so nobody adds it back.

### Tests

`aijsontest.mjs` (39, new) — the live reply now parsing, the whole bare-word
family, the exponent regression, words inside strings left alone, everything the
parser already did, and the `parseFail` capture reaching the screen. Proved by
reintroducing both defects: 9 fail without the parser fix, 9 without the capture.
`chrometest.mjs` (38, new), `layouttest.mjs` (19, new, real browser),
`newenquirytest.mjs` 24 → 35.

**Baseline unchanged:** the same 10 suites fail before and after, for the reasons
recorded earlier (`api/*.js` imports that do not exist in this checkout).

### Still open from this list

- **Item 2, images and videos after a JSON restore.** The carriage fix is in the
  code (the settings export carries the files its own content points at; the data
  flush keeps whatever the content still refers to). What the live site is
  showing is the *aftermath* of the older Flush Data bug: the pictures were
  deleted while the references were kept. Restoring a data JSON taken before that
  flush puts every file back under its own id. Nothing has to be re-uploaded.
### Item 5 — where the balloons land, and what the reading misses

**The balloons.** Two faults, and the second was what made the first unfixable.
Every balloon was offset the same fixed distance above its callout with nothing
stopping two landing on one spot — and dimensions cluster, which is what a
drawing *is*. The leader had to be vertical, because it was drawn in an SVG
whose viewBox was stretched to the sheet's aspect and any other angle skewed,
which pinned each balloon directly above its callout: precisely where its
neighbour wanted to be.

Both need a **pixel** measurement of the rendered sheet, which nothing has until
the image is on screen. So the layout now runs in the print window on load:
the viewBox is set to the sheet's real pixel size (leaders can then point any
direction without skewing), and the balloons are **relaxed apart** until none
overlaps another, each held within a short leader of its own callout and inside
the sheet. It never moves the callout, only the balloon, so what the leader
points at is still what the AI read. Deterministic — same reading, same sheet,
same layout, which a sheet used as evidence needs.

**What this does not do is make the AI's coordinates right, and the sheet says
so.** Spreading the balloons apart is what makes a wrong one visible and
checkable instead of buried in a pile. That is the whole claim this layer can
honestly make, and the printed sheet now states it in as many words.

**The reading.** One pass does not list everything on a drawing. A model asked
to extract every characteristic returns the obvious ones and drops chamfers,
corner radii, thread callouts, surface-finish symbols and written notes — and a
missing characteristic is **invisible on the sheet it produces**, because
nothing draws a balloon that was never extracted.

So the reading is now two calls. The second shows the model its **own list** and
asks the narrower question: what is on this drawing that is not in that list.
That is checking rather than extracting, which is a far easier question, and it
is what a person does when they take a second look. It names the things a first
pass actually drops, so it has somewhere to start.

Three rules make it safe to merge, and all three are pinned by tests:
- **it only adds.** Every characteristic from the first reading survives
  unchanged, so a worse second look cannot spoil a good first one.
- **duplicates are caught here, not by the prompt.** "Do not repeat what is
  listed" is an instruction a model follows most of the time, and this sheet
  becomes an inspection record: two rows for one dimension means the part gets
  measured twice and the report carries a characteristic that never existed.
  `rfqCharKey()` matches on the feature text flattened to letters and digits
  with Ø/dia/diameter folded together, plus the nominal — so "Ø17.5 ground
  diameter" and "Dia 17.5 ground diameter" are one thing, while a 20mm bore and
  a 20mm length are not. Numbers are rebuilt from 1 across the merge, because
  **the numbers are the balloons**: a gap or a repeat is a balloon pointing at
  the wrong row.
- **a failure leaves the first reading whole**, and says so. A completeness pass
  that can lose the reading is worse than none. The screen distinguishes all
  three outcomes, because they mean different things: added nothing (two looks
  agree), added six (the first missed six — check the rest harder), or did not
  run (this sheet has had **one** look, which must not be mistaken for either).

Cost: reading a drawing is now two AI calls instead of one. The progress strip
names each, so the wait is legible rather than mysterious.

`balloonlayouttest.mjs` (25, new, real browser) puts six callouts on top of each
other plus one on the top edge and one on the right, across landscape, portrait
and a wide strip, and asserts what a person needs from the sheet rather than how
the code works: no balloon covers another, none covers the callout it numbers,
every leader lands **exactly** on the point the AI gave, nothing is off the
sheet, every balloon is still a circle, and two runs lay out identically.
Removing the relaxation reports "1/2 12px apart" with 22px balloons — the pile
from the screenshot, measured. `balloontest.mjs` 53 → 72.

**Two harness faults worth recording**, both mine and both in the tests rather
than the code they were accusing:
- The CSS extractor split the print window's concatenated fragments on `+` and
  got nothing usable, so every balloon rendered as a plain inline span and
  twelve geometry checks failed at once. The second attempt scanned for string
  literals and fell out of step on an **escaped apostrophe inside a `/* */`
  comment**, swallowing the `.bl-b` rule whole. Strip comments before scanning
  for literals.
- A check reached into an undefined result and **crashed the suite** instead of
  reporting the failure it existed to catch. Second time in this project. A
  harness has to survive the very case it tests for.

## Four reports from the live site — and two of my own diagnoses that were wrong

### Item 7 — the costing error was a different fault this time

*"Expected ',' or '}' after property value in JSON at position 5669"*, on a
14,819-character reply. Not truncation, not a bare word: **an unescaped `"`
inside a string**. A drawing is full of inch marks and quoted callouts, so the
model writes

```
"stockSize": "Bar 1/2" dia x 3000 mm"
"spec": "M34 x 0.75 "H" class"
```

the string ends at the inch mark, and the rest of the text sits where JSON wants
a comma. One character several thousand in — which is exactly why it was
invisible until the reply itself was put on screen last round.

`parseAiJson` now decides whether a quote closes its string by **what follows
it**: a real closing quote is only ever followed by `,` `}` `]` `:` or the end of
the reply. Anything else and it is escaped and the string carries on. The one
risk of that rule — a genuinely missing comma, `"a":"x" "b":"y"` — is told apart
by looking further: `"key":` is a new member, not text, so a comma is inserted
instead. Five checks, all failing without it with the user's own error message.

### Item 2 — the uploaded JSON was the answer

The user attached the settings export and asked whether the images were in it.
**They were not.** 36 KB, top-level keys `scope / exportedAt / content /
idmsSettings / devices / providerKeys`, **no `assets` key at all**, and 37
`/api/assets?id=…` references inside `content`. It was exported from a build
before the carriage fix, so restoring it can only ever produce broken images.

Nothing further to fix in code. Worth stating plainly rather than re-explaining
the mechanism: a file with references and no bytes cannot restore pictures, and
the pictures the old Flush Data deleted are only recoverable from a **data** JSON
taken before that flush.

### Item 3 — my stacking-context diagnosis was wrong, and the synthetic test could never have caught the real one

I said the dropdown was being painted over. It was not. Cropping the screenshot
and reading the pixels settled it: the dropdown's own white box **stops with a
flat edge mid-glyph and its rounded bottom corners are gone**, with page
background below. That is clipping, not over-painting.

Booting the real `idms.html` in Chromium with `/api` stubbed found the clipper in
one call: **`body` itself**. It carries `overflow-x:hidden` (to stop a wide table
scrolling the page sideways), and per spec an element with one axis hidden has
the other computed to `auto` — so body is a clipping box, **only as tall as its
content**. An empty dashboard made it 468px inside a 645px window, and every
absolutely-positioned dropdown was sliced off at 468. Measured: Masters cut by
87px, HRM by 45, Admin by 3.

The fix is `position:fixed` on the open dropdown, placed by script in viewport
coordinates (`rfqMenuPlace`), because a fixed element's containing block is the
viewport and it is **not** clipped by an ancestor's overflow. It is re-placed on
scroll and resize while open, and the listener is removed on close. The
column-widening from last round is kept and still does its job — HRM lays out in
three columns with nothing hidden inside the box.

**The lesson is about the test, not the app.** Last round's menu checks were
driven against a hand-built shell carrying a copy of the menubar CSS. That shell
had no `body` overflow and no real page content, so it could not have found a bug
that lives in exactly those two properties — and it passed while the live site
was visibly broken. `layouttest.mjs`'s menu half now **boots the real page**: real
files served, `/api` stubbed, a real sign-in, the menu drawn from the real `MENU`
array, and the question asked of the browser rather than of a model of it — *is
the bottom of this dropdown actually painted?* (`elementFromPoint`, not "does an
overflow ancestor exist", which proves nothing about a fixed element). Reverting
the fix fails 10 checks and names **eleven of the fifteen menus** as cut off.

> A shell that omits one property of the real page cannot find a bug that lives
> in that property. When a layout report survives a fix, suspect the harness.

The website's scroll arrows were also checked the same way for the first time —
booted, scrolled, and `elementFromPoint` used to prove nothing sits on top of the
button. They work; the deployment in the screenshot simply predates `chrome.js`.

### Item 5 — the balloon sheet, looked at rather than reasoned about

Rendering the supplied PDF showed the layout work from last round is doing its
job: 21 balloons, none overlapping, every leader drawn, the table complete. It
also showed the limit plainly — balloons 8–13 and 19–21 sit down the left margin
and along the bottom pointing into empty space, while the notes they name are in
the middle of the sheet.

**The AI's coordinates are wrong, and no layout pass can fix wrong coordinates.**
Spreading the balloons apart makes a wrong one visible instead of buried; it
cannot make it right. The sheet says so. Worth recording what else the render
showed, because it bounds what is achievable here: row 16 reads *"Diameter of the
outer cylindrical section 34 +0.75/0 mm"* where the drawing says **M34 × 0.75** —
a thread misread as a diameter with a tolerance. That is a reading error, not a
placement error, and a second pass that only looks for *missing* items will not
catch it.

## The round after that — a unit after a number, and balloons you can place yourself

### The costing error, a third distinct cause

*"Expected ',' or '}' after property value in JSON at position 5669"* again — same
message, different fault. Not truncation, not a bare word, not an unescaped
quote. **A unit written after a number:**

```
"cutLength": 120 mm        "rate": 142/kg        "scrapPct": 5 %
```

An estimator's schema is forty numeric fields and a model answering it writes the
unit in about one field in twenty.

**This one was mine.** The guard added two rounds ago to protect exponents
(`1e3`) tested only *"does a digit come before this letter"*, so it skipped the
bare-value branch for **any** letter following a number — and a unit sailed
straight through untouched. The guard now asks whether it is really an exponent:
adjacent, `e` or `E`, followed by an optional sign and a digit.

The larger change is that a bare value is now taken as **one whole run** up to
the next character that could only be structure, rather than one word at a time.
Quoting each word separately turned `High Carbon Steel` into `"High" "Carbon"
"Steel"` — three strings in a row, which is not JSON either. `true/false/null`
pass through, `NaN/Infinity/undefined` become null, a clean number stays a
number, anything else becomes the string it was plainly meant to be. The unit is
kept rather than discarded because every consumer runs the field through
`C.num()`, so `"142/kg"` still costs at 142 — and `"120 mm"` is what a
`cutLength` field wanted all along.

**A proof that pulled the wrong lever.** Reverting the exponent guard failed only
*one* of the eight new checks, which looked like seven useless tests. It was not:
the **run absorption** is what fixes most cases, and the narrowed guard only
matters where the unit is a single non-letter character (`5 %`). Reverting the
absorption instead fails them properly, with the user's own error message.
Reverting the wrong half of a two-part fix proves nothing about either half.

### Item 2, answered from the file rather than re-explained

The user attached the export and asked whether the pictures were in it. **36 KB,
37 `/api/assets?id=…` references, and no `assets` key at all.** Exported from a
build before the carriage fix, so restoring it can only ever produce broken
images. No code change; the answer was in the file.

### Item 5 — the balloons can be placed by hand now

Rendering the supplied PDF confirmed the layout work is doing its job (21
balloons, none overlapping, every leader drawn) and confirmed the limit just as
plainly: balloons 8–13 and 19–21 sit down the left margin and along the bottom
pointing into empty space, because that is where the model said those notes
were.

**No layout pass can make a wrong coordinate right.** Two rounds of prompt work
and relaxation have taken this as far as it goes. So: `rfqPlaceBalloons()` opens
the drawing full-screen and every balloon is draggable. What moves is written
back onto the enquiry, so the balloon sheet, the drawing data and every reprint
use the corrected positions — it is a record, not a view setting.

Three decisions worth keeping:
- **A characteristic the AI could not place is in a tray and can be dragged on.**
  That is the half no re-read recovers: a balloon that was never drawn cannot be
  noticed as missing on the sheet it produces.
- **This screen moves balloons and does not edit the reading.** A drag must never
  quietly change a tolerance, and a test asserts the feature, nominal and class
  survive a save untouched.
- **The printed sheet tells the two claims apart.** "A model guessed where these
  are" and "a named person put them there while looking at the drawing" carry
  different weight on an FAI-shaped document. A hand-placed sheet says who and
  when — and still says the **values** are the AI's and unverified, because
  placing a balloon does not check a tolerance.

**A reading error the render also showed**, which no completeness pass can catch
because nothing is missing: row 16 read *"Diameter of the outer cylindrical
section, 34 +0.75/0"* where the drawing says **M34 × 0.75** — a thread read as a
diameter with a tolerance. Quoted, planned and inspected as a turned diameter,
the thread never gets cut. The prompt now names that shape and the others that
look like a size and are not (surface finish, scale, quantity multiplier, radius,
chamfer).

### The real-page test earned its keep immediately

Moving the placer's markup in meant it sat **after** the app's own `<script>`, so
the binding at load threw and took the whole page down — every screen, not just
this one. `balloontest` (jsdom, which evaluates the script against the parsed
document) passed all 90 checks. `layouttest`, which boots the real file in a real
browser, crashed on the first selector.

> A suite that evaluates the script separately from the document cannot see an
> ordering bug between them. The one that boots the page can.

### Tests

`aijsontest.mjs` 45 → 55, `balloontest.mjs` 72 → 90 (the placer end to end: the
tray, a real pointer drag, the save reaching the record, the reading surviving
it, and the sheet's two different warnings). Both proved by reintroducing the
defect. **Baseline unchanged at 10.**

## Six items from a fresh punch list — balloon placement, a real quotation email, and a customer-facing quote link

Six of ten items from a combined feedback round, in the order they were given.

**1–2. Balloons landed away from the dimension they numbered, and there was no
way to match one up by hand.** The drawing reader already carried a free-text
`locationNote` per characteristic — where on the sheet it was read — and
nothing ever surfaced it, so a misplaced balloon looked exactly like a
correctly placed one until somebody opened the drawing and checked. The Place
Balloons legend now lists **every** characteristic, placed and unplaced alike,
numbered: an unplaced one carries the AI's own note as a hint ("AI read it
near: …") so it can be dragged onto the right feature without re-reading the
sheet from scratch, and a placed one is click-to-highlight — click the number,
the balloon flashes on the drawing. That is the side panel item 2 asked for,
and it is the same list item 1 needs, so it is one list rather than two.

A latent bug came with the change: once the tray held placed rows too, the drop
handler still **removed** the row (the old unplaced-only model) instead of
converting it, so both the row and the "N not placed" count went stale the
moment a balloon was placed. It converts in place now (`pl-off` → `pl-on`), and
the count reads `tray.querySelectorAll('.pl-row.pl-off').length` rather than
the tray's total children. Neither was covered before; both are now.

The clustering itself had a cause worth naming: title-block fields (Material,
Mass, Finish, general Notes) genuinely do sit together on the sheet, and the
model was giving them one **shared** x/y as a result — so four balloons stacked
on one point while the features they named were scattered. Both passes of
`rfqReadDrawing` now say outright never to give several characteristics the
same position merely because they are all "general".

**3–4. The quotation email read as one dense block with no signature.** Not the
ordering bug it looked like — the cover text already came before the numbers
and the signature already came last. The real defect was a single
`.filter(function(x){ return x !== ''; })` doing two different jobs: dropping
conditionally absent fields **and** carrying the deliberate blank-line
separators. Stripping the former silently stripped the latter, and every
paragraph ran together. `rfqQuoteMailText(r)` now builds each section
(greeting, covering text, pricing, terms, reference, links, sign-off) as its
own paragraph and joins **sections**, never raw lines, with `\n\n`. The
signature was a bare name; it is now the sender role or team (the existing
"Quote sender name" setting — "Marketing Team" in the reporter's case), the
company's legal name, its phone and its email, every line from Company Profile
and none of it in code, so it signs correctly for whichever company this
deployment belongs to.

**5. There is no PDF pipeline on either channel, so a link stands in for the
attachment.** Read `server/routes/notify.js` before designing anything: Resend
takes `{from,to,subject,text}` and the WhatsApp Cloud API takes text or a
template. Neither carries a binary. So what the customer gets is a **view,
print or save this quotation** link and a direct link to their own drawing on
file. `index.html` gained a `#quote?ref=X&t=Y` route, parsed the same way `#me`
already is, and `buildNativeQuoteHtml()` — a **new** letterhead template, not a
reuse of the site's existing `buildQuotationHtml()`, which is built around the
old website-side `items[]`/`discount` quote schema and would have rendered the
native `qty/unitPrice/subtotal/tax/total` document as an empty page. Two
incompatible quote schemas live in this repo; do not conflate them.

The link carries an unguessable `publicToken` beside the reference.
`GET /api/rfqs?ref=X` still returns only `{ref,status,date,approvedAt}` for a
bare reference — that restriction is deliberate and stays — and now returns the
quotation itself **only** when `qtoken` matches `quoteDoc.publicToken` exactly.
References are often close to sequential; a reference must never double as a
credential for seeing somebody else's price.

The token is minted in `rfqDraftQuote`, at draft time, **not** lazily at send
time. Minting it lazily would have meant the mail draft — rendered from the
quoteDoc the moment it exists, before any lazy token could — never showed the
link on a quote's first send, silently, every time. A fallback in
`rfqSendQuote` still mints one for a quotation drafted before this existed, and
in that one case rebuilds the mail fresh and updates the box to match, so what
is on screen and what just went out are never two different things.

**6. The mail draft is what Send sends, not a preview of it.** The quotation
panel is an editable textarea (`quoteDoc.mailDraft`) rather than a read-only
paragraph. It opens showing exactly what `rfqQuoteMailText(r)` would build, a
hand edit saves quietly on **blur** — no `loadRfqPipeline()`, which would
redraw the list and lose the person's place mid-edit, so `rfqRows` is allowed
to run briefly stale here — and **Rewrite professionally with AI** sends
whatever is in the box right now back through the model, told explicitly to
keep every name, date, number, price, term and link unchanged and reword only
the prose, then saves the result the same quiet way. An empty box is refused
before the AI is called at all.

**Send reads the live textarea**, which is the whole point: the edit or rewrite
the staff member is looking at is what goes to the customer. A **redraft** is a
genuinely new `quoteDoc` with no `mailDraft` key, so the box correctly starts
over from the fresh text instead of carrying a stale hand edit forward as
though it were still current — verified against the saved record, not inferred
from the screen.

### Tests

`balloontest.mjs` 90 → 96 (a real drag from the tray converting the row rather
than deleting it, the count following it, and click-to-highlight clearing
itself). `sitetest.mjs` gained a section for the `#quote` route — 9 checks, 37
in total — driving it end to end against a `qtoken`-gated fake server, down to
a wrong token opening nothing and saying so rather than failing silently;
`boot()` grew an optional `setup(window)` hook so `window.open` can be mocked
in the same tick the inline script is evaluated, before `init()`'s hash routing
runs. `rfqpipelinetest.mjs` 45 → 72: +7 for the paragraph-built email, the
complete signature and the token mechanics (including that "Send again" reuses
the same link rather than breaking one already forwarded), then +20 for the
editable draft — pre-fill, a hand edit saved on blur **without** the list being
redrawn underneath it, the AI handed exactly what was in the box rather than a
fresh rebuild, an empty box never reaching the AI, Send matching the live box
byte for byte, and a redraft starting over.

Both of the load-bearing ones were proved by reintroducing the opposite
behaviour: making Send rebuild the text instead of reading the box fails
exactly one check, and making a redraft carry `mailDraft` forward fails ten —
three of the new ones plus seven of the existing send assertions, which is the
right blast radius for a stale draft going to a customer.

**Baseline unchanged at 10** — `audittest`, `cnctest`, `competencytest`,
`devicetest`, `flushservertest`, `onboardingtest`, `opstest`, `planningtest`,
`salesdashboardtest`, `smoketest`, the same names before and after, for the
reasons already recorded (three stale `api/*.js` imports that do not exist in
this checkout, and seven chart/SVG or unrelated-module faults).


## Item 7 — Won → NPD, the handover that had quietly stopped existing

The native RFQ Pipeline could mark an enquiry **Won** and create nothing at
all. Everything downstream — the part, the customer, the priced link, and so
every dropdown that reads them — came from `[data-act="won"]` on the
*website's* RFQ admin, and that screen left the menu when the pipeline went
native. Meanwhile `rfqRouteToPart`, sitting on the same screen, refused with
*"a part is created when the quotation is won … so mark this enquiry Won
first, then send the route across"* — advice that could not be followed,
because marking it Won is exactly what did nothing. Item 7 is that gap.

**The handover is ported, not reinvented** — same three records, same order,
same refusals as the website's version (CLAUDE.md's v115 rule): no customer
name, no agreed price, no HSN code, each refused with what to fix rather than
creating a customer or a part with a gap in it. What could not be ported is
the shape it reads: the website's version walks `quoteDoc.items[]`, and the
native quotation is one part at one unit price. That is the second time this
round the two quote schemas have had to be kept apart; they are not
interchangeable and nothing should treat them as if they were.

**The form exists because the pipeline has nowhere else to ask.** The drawing
reading supplies the part name, drawing number, revision, the customer's own
part number and the raw material from the costing — all pre-filled and all
editable, because a reading that got a thread wrong should be corrected before
records are created from it. **HSN is the one field nothing upstream can
supply**: no drawing states it, and the invoice screen cannot raise a line
without one. So it is asked for here and refused when blank, rather than
quietly creating a link that fails months later at the one moment somebody is
trying to invoice.

Three rules the records themselves impose, and one the website version was
missing:

- **One drawing number is one part.** A second customer winning the same
  drawing reuses the part and gets their own priced link — one APQP record
  however many customers buy it, which is the whole reason part identity is
  *ours* rather than theirs.
- **The part number is issued by the database**, with the prefix from the site
  profile (`TEST-PART-0001`), never built in the browser.
- **One customer, one live price.** The Parts screen refuses a second link for
  a customer already linked to a part, because two prices leave nothing able to
  say which one to invoice. The website's handover never checked this and would
  happily have written the second link; this one keeps the existing link and
  says so.
- It writes **`idmsParts`**, the same field the website wrote, because the
  triage rule *"won, but never sent to the IDMS"* reads it. A new field name
  would have left every transferred enquiry flagged forever.

Once moved, the button is replaced by a confirmation naming where the part
went — the same idempotence the website had — and the message links straight to
Parts Addition.

### A dead matcher found while testing the seam

`rfqRouteToPart`'s drawing-number fallback read `cp.data.drawingNumber`. **No
part of this codebase has ever written that field**: the Parts screen stores
`data.drawingNo` on the part and `custDrawingNo` on the customer link, and the
bulk upload, the sample data and the website's own handover all agree with it.
So the fallback could never match, and an enquiry whose drawing was already on
file as a part — one added by hand, say — was told *"No part on file matches
this enquiry"* unless the handover had stamped `idmsParts` on it. It now checks
the part's own drawing number first and the link's second. Proven by restoring
the old line and watching three checks fail with that exact message.

### Tests

`npdhandovertest.mjs` (52, new). Its fake IDMS is a **real little store** — it
keeps what it is given and returns it on the next read — because every rule
worth testing here is about what is already on file: a drawing that is already
a part, a customer already linked to it at a price. A stub answering `{}` to
everything would pass all of those while proving none of them. It covers the
section appearing only on a won enquiry, all four refusals with nothing
written, the three records and every field on them, the audit reason on each
write, idempotence, a second customer on one drawing, the one-live-price rule,
and — the point of the whole item — **the two seams joined**: move to NPD, then
send the route and characteristics to the part that move created, landing as
`aiProposed` for Review Agent Work.

Three of those were proved by injecting the opposite behaviour: never reusing a
part fails 6, never noticing an existing link fails 2, restoring the dead
matcher fails 3. Full suite: **baseline unchanged at 10**.

## Item 8 — the keys can be backed up, and the masking rule still stands

A live deployment flushed its settings and lost every provider key, then found
that the settings backup it had been taking all along could not put them back:
**`GET /api/settings` has only ever returned masked values**, and Backup &
Restore says so plainly. That is the right default and it has not been
changed — a backup file travels between deployments and inboxes, and one
carrying a working key is a leak waiting to happen.

So this is a second, deliberate path rather than a loosening of the first:

- **`GET /api/settings?reveal=1`**, the only place in the platform that hands a
  working key to a browser. The administrator role only, **checked on the
  server** rather than hidden in the screen; panel-entered keys only, because a
  Vercel environment variable is not this system's to give away and a flush
  cannot lose it anyway; and **written to `idms_audit`** so a reveal is a
  recorded act rather than an invisible one. The audit row names the **keys**,
  never their values — a trail holding the secrets would just be a second copy
  of them in a table nobody can delete from.
- **On the wizard's Connections step**, a Download that says in the screen *and
  inside the file* that it holds working keys, named after the company
  (`Acme-Precision-connections-2026-09-20.json`), and a Restore beside it.
- **Restore needs no new server path.** The file goes back one key at a time
  through the same POST the screen already uses, so the endpoint's own
  allow-list decides what may be written — a file naming a setting this panel
  does not own is refused exactly as if somebody had typed it. A file whose
  `scope` is the other half of Backup & Restore is named and refused rather
  than half-applied, the same refusal those two scopes already make between
  themselves.

Records, parts and documents are deliberately still the other backup — the
screen says so and points at it, rather than growing a second way to restore
the same things.

### Tests

`keybackuptest.mjs` (21, new) drives the **real handler** with the module-hook
technique `flushservertest.mjs` uses, against an extended `fake-db.mjs` that now
keeps a real secrets table. It pins the masking default, the 401 and the 403,
that a refused attempt carries no key and writes no audit row, that a Vercel
variable never appears in the file, and that the audit row contains the key
names and not one key value. `setupwizardtest.mjs` 32 → 48 covers the screen:
the warning, declining the confirmation, the file's scope/contents/name, a
non-JSON file, a data-scope file being refused with nothing written, and every
key in a good file going back through the ordinary save.

Proved by injecting three defects in turn: dropping the role gate fails 5,
handing out Vercel variables fails 1, ignoring the file's scope fails 1. Full
suite: **baseline unchanged at 10**.

## Item 9 — Client Admin and Developer Admin, and the gap that was already there

The admin menu held two different kinds of screen in one list. A company's own
administrator needs their Company Profile, their legal documents, their quoting
rates and their org masters. What they do not need — and what costs somebody a
day when pressed by mistake — is the screen that creates logins, the one
holding both flushes, the one that seeds and clears sample records, and the
wizard that holds the provider keys.

**Checking the existing model turned up a real gap rather than just a missing
feature.** `isPermitted()` reads:

```js
if (me.role === 'developer') return true;
if (!me.restrictAccess) return true;      // ← and restrictAccess is off by default
```

So a login that nobody had explicitly restricted was offered **User Management
and Backup & Restore in its own menu**. The screens themselves refuse (User
Management shows its own gate, the server checks every call), but being offered
them at all was wrong, and "tick restrictAccess and then tick 47 boxes" is not a
default anybody arrives at.

`ADMIN_DEV_DEFAULT` now names the four Developer Admin screens, and
`isPermitted` withholds them from anyone who is not an administrator **whether
or not that login has been restricted**. The menu bar draws the admin group as
two — *Admin* and *Developer Admin* — so the classification is something you can
see rather than an invisible rule. Only the menu bar is built from the split;
the permission grid, the search index and the agent hub still read the whole
`MENU`.

**Which screen belongs to whom is a judgement about a commercial relationship,
not a fact about the code**, so the four are a default and not a law. User
Management grew a grid listing every screen in the admin group — built from the
group itself, so a screen added later turns up to be classified rather than
silently landing on one side — and the administrator moves any of them either
way. The choice is stored in `idms_settings.admin_access` as the list kept
back.

Two things that make it a control rather than decoration:

- **Writing `admin_access` requires the administrator role, checked on the
  server**, and the change is audited before-and-after. Every other settings key
  stays writable by any signed-in user, because a works preference is not an
  access control and every screen that saves one must keep working.
- **The menu is not the only gate.** A hidden entry is not a lock — an old
  bookmark or "open in a new tab" lands straight on `#s=<screen>` — and `go()`
  asks `isPermitted` the same way the menu does, so it ends up on Home with a
  sentence saying why.

Stated plainly on the screen, because it would otherwise be easy to mistake for
more than it is: **this decides what is offered.** Managing logins, flushing and
revealing the connection keys each carry their own server-side role check and
stand whatever is ticked here.

**Deliberately not done: a third role.** `checkRole(token, ['developer','admin'])`
appears in several routes, but `saveUser` only ever stores `developer` or
`staff`, so those `admin` branches are unreachable today. Making them reachable
would hand a new role the flush, the part deletion and the HR deletion paths in
one go — a privilege change wearing a menu feature's clothes. Client Admin here
means *the screens a non-administrator login is given*, which is what item 9
asked to classify.

### Tests

`adminaccesstest.mjs` (39, new), in two halves because the feature is: the real
`/api/idms` handler for who may change the rule (staff refused with nothing
stored, an ordinary setting still saveable by anyone, the administrator's change
audited), and two booted pages for what each role is offered. It pins the split
and its order, the four defaults on the right side, moving a screen each way and
the menu redrawing, the reset that changes the screen and saves nothing, a staff
menu with no Developer Admin group at all, the address-bar route landing on
Home, a stored rule overriding the default, and a stale rule naming a working
screen being ignored rather than obeyed.

Proved by injection: dropping the `isPermitted` rule fails 7, dropping the
server role gate fails 3. One failure along the way was the harness, not the
app — panels are switched with a `.on` class, not inline `display`, so the first
version of the address-bar check was asking the wrong question. Full suite:
**baseline unchanged at 10**.

## Item 10 — the assistant, and what it is barred from

A chat box on Home and in the title bar, for the questions that come up while
working. One drawer, two ways in — a question usually arrives while looking at
something else, and sending somebody to another screen to ask it loses whatever
they were looking at.

**Two things it deliberately is not, and the screen says both:**

- **It does not search the web.** `/api/ai` is a chat gateway over whichever
  provider key is configured — OpenRouter, Mistral, Groq, Gemini, Anthropic —
  and none of those calls is given a search tool. An answer comes from what the
  model knows plus the works figures below. The request asked for online search
  with images and video; that needs a search provider and a key nobody has
  bought yet, and claiming it while quietly answering from training data would
  be a claim nobody could check. Worth doing properly later, as its own item.
- **It writes nothing.** Everywhere else here an agent proposes and a person
  accepts. A chat box able to change a record would be the one exception to
  that, and it is not worth being one.

**It does know this works.** Four reads — parts by lifecycle, open customer POs
and how many are past their date, open non-conformances, open and overdue
actions — are counted and handed over as WORKS FIGURES, so "what is overdue?"
gets a real answer. Nothing goes in that the person could not already see on
their own screens, and the prompt says that section is everything it knows
about the company: if the answer is not there, name the screen rather than
guess.

**What it must not discuss is enforced in code, before the question leaves the
browser.** `ASK_OFF_LIMITS` — source code, repository, keys and credentials,
hosting and deployment, the system prompt itself, "ignore previous
instructions" — is checked first, and a barred question produces **no AI call
at all**. The prompt says the same thing as a second layer, because both are
worth having, but a model can be talked round and a regular expression cannot.
The reply is scanned on the way back for anything key-shaped (`re_…`, `sk-…`,
`gsk_…`, `AIza…`, `EAA…`) and replaced if one appears.

The patterns are deliberately narrow, and that is tested as carefully as the
refusals themselves: *keyway*, *neon lighting*, *deploy people across three
shifts* and *PPAP level 3* all answer normally. A filter that refuses real work
would be abandoned within a week, and then it protects nothing.

### And a defect the reporter's own screenshot showed

The quotation email in the screenshot read *"Best regards, [Your Name],
[Company Name]"* — above the figures, with the company's real signature added
underneath. Nothing had told the model not to sign off, so it wrote its own,
placeholders and all, and the builder wrapped a second signature around it.
The prompt now forbids a greeting, a sign-off and placeholders, **and**
`rfqCoveringText` strips from any sign-off line to the end plus any
placeholder-only line — because an instruction is a request and this is the
part that holds.

### Tests

`assistanttest.mjs` (38, new): both ways in, the drawer, the empty state, a real
question reaching `/api/ai` with the three rules and the works figures in its
system prompt, every figure checked against the records it was counted from, a
follow-up carrying the exchange before it, **eight barred phrasings each
producing zero AI calls**, four legitimate questions still answered, a
key-shaped reply replaced, nothing written, Clear and close. Proved by removing
the in-code refusal: 8 checks fail. `rfqpipelinetest.mjs` 72 → 76 for the
sign-off strip, proved the same way.

Full suite: **baseline unchanged at 10.**

---

## Note for whoever reads this next: items 1–10 are in the code, not on the live site

The reporter's screenshots for this round were taken from elixirtec.com, and
every one of them shows the **pre-fix build** — the Place Balloons panel with no
characteristic list, the quotation email with its pricing below the signature.
None of the work above reaches anybody until the repository is deployed. This
checkout has no `.git` directory, so the deploy path is whatever the repo's
Vercel project is wired to; the files that changed this round are `idms.html`,
`index.html`, `server/routes/idms.js`, `server/routes/settings.js`,
`server/routes/rfqs.js` and `tests/`.

## Round B — the six reported this round, and the misreadings a real GOST drawing exposed

Six items, reported with screenshots of elixirtec.com and one real customer
drawing (`НПРК.713551.002`, a Russian-language bushing on a GOST title block).
That drawing is the most useful thing in the report, because it turned "the AI
is not capturing the tolerances" into four named, separately fixable faults.

### Item 1 — four more screens moved to Developer Admin

`ADMIN_DEV_DEFAULT` gained `admin_theme`, `admin_content`, `admin_banner` and
`profile`. The reasoning is the same one the split already used: the website's
appearance and identity are the vendor's to maintain, the profile is what every
printed document takes its letterhead from, and none of it is the client
administrator's day-to-day work. They remain a **default** — the grid on User
Management moves any of them back.

### Items 3 and 4 — "Lead time [x]", and a quotation email worth sending

**The lead time was never a field.** `rfqQuotationHtml` has always printed
`q.leadTime`, and **nothing on the native side has ever written it** — that
field belongs to the website's older `items[]` quote schema. So the only lead
time on the document was whatever the model wrote into its covering prose, and
what it wrote was `Lead time: [X] weeks`.

It is now derived from two figures that are already on file:

- the matched price-book entry's own **lead days**, carried onto the costing as
  `material.leadDays` (the price book has had a *Lead days* column all along and
  nothing read it);
- a new **Production lead time (days)** on Quoting & Costing Setup — the works'
  own standard allowance, typed once.

`rfqLeadTimeDays()` adds them; `rfqLeadTimeText()` turns that into *"21 days
from receipt of your purchase order"*. **With neither figure on file it returns
an empty string and the line does not appear** — silence is the honest answer
and a placeholder is not. The figure is **stamped onto the quotation at draft
time**, so changing the standard allowance later cannot rewrite a document a
customer is already holding; a quotation drafted before this existed has no
stamped value and falls through to the derivation, which is what makes the fix
reach records already on file.

**The mail body is rebuilt.** The reporter's Gmail screenshot showed, in one
message: a `Subject:` line inside the body, a second `Dear Raja,` under the real
one, `Lead time: [x] weeks`, `Best regards / [Your Name] / [Company Name]`, and
`Total: ₹2,799.8`.

- `rfqCoveringText` now strips a leading `Subject:` line, a leading greeting,
  everything from a sign-off line onward, and **any line containing a `[…]`
  hole**, and it is applied at **render** time in both the mail builder and the
  printed quotation — so the quotations already on file clean themselves up,
  which is what the reporter is actually looking at. The printed quotation's
  terms table drops any term whose value still contains a hole.
- **Money is `C.rate()`, never `C.qty()`.** `C.qty` keeps three decimals and
  drops trailing zeros, so 2799.80 printed as `₹2,799.8`. This is the rule
  Conventions has always stated; the builder simply used the wrong helper.
- The body is now: greeting · opening paragraph · reference, quotation number
  and date · part, quantity and the price table · lead time, validity, payment
  and delivery · the quotation link and the customer's drawing link · a closing
  line · the full signature. **The opening paragraph is ours when the AI's is
  absent** — stripping a reply to nothing must not leave the mail opening
  straight onto a price table, which is exactly what stripping introduced.

### Item 5 — four systematic misreadings, two of them fixable in code

Reading the supplied drawing against what the Place Balloons panel showed:

| the drawing says | the reading said | what it is |
|---|---|---|
| `1,6 +0,5` | `16 +0.5` | a **comma decimal** read as a whole number |
| `40₋₀,₁₆` | `40 +0.16/0` | a deviation printed **below** the line read as plus |
| `⌀6H7` | `6` | the **fit class** dropped |
| `⊥ 0,01 A` | "Concentricity…" | the **wrong GD&T control** |

**The comma is fixable in code, and had to be.** `Core.num("1,6")` strips
everything that is not a digit, a dot or a minus — so it returns **sixteen**.
No amount of prompting removes that, because the model can hand the figure back
as the string it read. `rfqDecimal()` is the one place a drawing figure is read:
a lone comma with digits either side and no full stop is a decimal point (no
drawing prints `1,600 mm` meaning one thousand six hundred), and it returns
**null rather than 0** for anything unreadable, because a nominal of 0 prints as
"0 mm" and looks like a reading. It runs on the way **in** (in `rfqMergeChars`,
the one point both reading passes go through) and on the way **out** (in
`rfqTolText`), so a characteristic read before it existed is corrected too.

The other three are prompt work, and both passes carry it — a completeness pass
that reads `1,6` as sixteen puts the misreading back on the way out. The prompt
now names all fourteen GD&T symbols so `⊥` cannot come back as `◎`, says a fit
class stays in the feature text, says a single deviation printed low is the
lower one and is minus, and says to work every view, section and detail bubble
before answering.

`balloontest` drives a GOST-shaped reply through the real reader with every
figure as the string a model would return. Removing `rfqDecimal` reproduces the
reporter's symptoms exactly: `16 µm` and `40 0/-16`.

### Item 6 — a leader with two ends, and the reading made editable

**A characteristic now carries two points, not one.** `x/y` is the **anchor** —
the point on the drawing the leader points at — and `bx/by` is where the
**balloon** is drawn. Conflating them is what forced every balloon onto its own
callout and made the leader's angle unfixable. On the Place Balloons screen both
are draggable: drag the balloon to where the number reads clearly, drag the
small ring onto the exact feature, and the line between them swings through a
full 360°, redrawn from the elements' own positions so it keeps up mid-drag.

**The printed sheet obeys a hand-placed balloon rather than laying it out
again.** `rfqBalloonOverlay` emits `data-bx`/`data-by` where one has been set
and the relaxation pass marks that point `fixed` — it never moves, and the free
balloons are pushed around it. Balloons with no hand position are still relaxed
apart exactly as before, so nothing changes for a sheet nobody has been through.
On save, every placed balloon is pinned at the position that was on screen, so
the printed sheet is the sheet that was checked.

**The reading itself is editable.** Every row in the legend has Edit and Delete;
there is an Add above it. The form carries the type, the feature text, nominal,
upper, lower, unit, the GD&T callout, the spec, the class and the location note,
with a **palette of 33 drawing symbols** (⌀ ± ° ⊥ ∥ ⌖ ◎ ⌭ ⏥ ↗ Ⓜ …) that inserts
at the caret — bound on `mousedown`, because `click` fires after the field has
already lost focus and the caret with it. Numbers typed by a person go through
the same `rfqDecimal`, so a comma means what it means on the drawing.

Three decisions worth keeping:

- **Everything is a working copy until Save.** Somebody opens this to go through
  a sheet, and half a dozen corrections saved one at a time is half a dozen
  chances to leave the record half-changed. Closing without saving changes
  nothing on the enquiry, and a test asserts exactly that.
- **The numbers are renumbered 1..n after any add or delete.** The numbers *are*
  the balloons; a gap or a repeat is a balloon pointing at the wrong row of an
  inspection record.
- **The printed sheet tells three claims apart**, not two. A sheet nobody has
  touched says the values and positions are the AI's. A sheet somebody dragged
  into shape says who and when. A sheet whose **list** was also corrected says
  how many were read, how many are listed now, and how many were written or
  corrected by hand — counted from `editedBy`/`addedBy` on the lines, because
  correcting one line and adding another leaves the totals unchanged.

Everything flows from `extract.characteristics`, the one list the drawing-data
table, the balloon sheet, the printed sheet, the costing and the Move-to-NPD
handover all read — so a correction made here is the correction everywhere.

### Item 2 — three login tiers, and the rule that a menu is not a lock

`admin` is a real role now. CLAUDE.md deferred this at item 9 on the grounds
that making the unreachable `['developer','admin']` branches reachable would
hand a new role the flush, the deletion paths and the keys in one go. That
concern is answered by **not touching any other route**: `admin` was added to
`listUsers`, `saveUser` and `deleteUser` and nowhere else. Flushing, part and
employee deletion, and revealing the provider keys stay developer-only.

`MANAGES` in `server/routes/auth.js` is the whole rule:

```
developer → developer, admin, staff
admin     → admin, staff            (no developer, in any direction)
```

A Client Admin's `listUsers` is **filtered on the server** — a developer login
is absent from it, not greyed out and not marked restricted, because a list
filtered in the browser has already been sent to it. `saveUser` refuses a target
above the actor's tier and refuses to grant a role above it, as two separate
refusals because they are two separate mistakes. `deleteUser` refuses the same.
The refusal says *"that login cannot be changed from this account"* and
deliberately does not say the word developer.

**The last Developer Admin is now protected on the server**, not only on the
screen — demoting or deleting it is refused with what would be lost. That rule
has existed in `saveUser`'s client half since v112 and a rule that lives on a
screen is not a rule.

**Self sign-up** (`action:'signup'`) creates an **inactive** login with an
optional Face ID enrolment attached, at the User or Admin tier and never
developer (refused by tier *and* by role). It cannot sign in until a Developer
Admin approves it, and the sign-in screen tells a pending account it is waiting
rather than that it was deactivated — two states that look identical on `active`
alone and mean different things to the person in front of the screen. User
Management grows a **Pending sign-ups** card; Approve goes through the ordinary
`saveUser` path so the role rules and the audit apply to an approval exactly as
to any other change.

**The sign-in screen** offers three cards — User, Admin, Developer Admin. The
choice is sent with the sign-in so the server can say *"that is not a User
login"* rather than dropping somebody onto a menu they did not expect; it is
**checked only after the password**, so it can never be used to find out what
kind of login a name belongs to. It is not a boundary — every screen is gated on
the role in the record — and its real job is deciding what the card offers:
**Create a login** and **Change my password** are withdrawn entirely on the
Developer Admin tier. Change-password works with no session because the old
password is the credential, which is why it belongs here at all.

### Tests

`logintierstest.mjs` (53, new) — the real auth handler through a `fake-db` that
now keeps a real `users` table, plus the real sign-in screen booted in jsdom.
`balloontest.mjs` 96 → 149. `rfqpipelinetest.mjs` 76 → 103.

Proved by injection throughout, and two of those are worth recording:

- **Reverting one of two places proves nothing.** The Developer Admin tier
  withdraws self sign-up in `gateSetTier` *and* again in `gateAltShow`, so
  removing it from one left the check passing. Both had to go before it failed.
  Same lesson as the two-part parser fix earlier in this log.
- **A fake that hard-codes what the real code is supposed to say cannot catch
  it saying something else.** `fake-db`'s signup INSERT wrote `active: false`
  unconditionally, so "signup activates the account straight away" passed with
  the defect in place. It now reads `active` out of the statement text, because
  it is written there as a literal rather than bound. It also had the parameter
  positions wrong — `false`, `now()` and `'self sign-up'` are literals, not
  bound values — which the handler reported as a 500 rather than a wrong row.

**Baseline unchanged at 10.**


## PPC Planning Module (v142)

`ppc_planning` turns the Sales Plan into "what to start at the 1st operation"
and "what raw material to buy". It reuses `salesPlanRows()`/`demandFor()` for
demand (so it can never disagree with the Sales Plan) and `computeRmStock()` for
RM balances (so it can never disagree with Raw Material Stock). Part stock at
the five stages is derived in `pmPartStock()`; physical counts (`part_stock`
docs) override a stage per part until cleared. Both the part stock and each
material are drawn down in delivery-date order — the same reason
`allocateProduction()` allocates instead of counting per order. It writes only
when asked (`ppc_plan` snapshot, `part_stock` counts) and never raises a PO.


## PPC Planning Module v143 — MRP netting, edits, RFQ → masters

Supersedes the stock definitions in the v142 note. Stock stages are net
(in − out) so each piece is counted once — cumulative completed quantities
would count one piece at every stage it passed and make the planner under-start
and under-buy. Planned results are never typed over: master data is edited in
its master (the line editor writes there), demand-line changes are planner
adjustments in `ppc_adj` keyed by `month|horizon|customer`, and a released plan
(`ppc_plan` status Released) is locked until reopened with a reason.
`rmPoPosition()` is the one place on-order is worked out. `mNorm()` / `mKey()` /
`rmFindDup()` / `jigFindDup()` are the one identity rule for master items —
use them in any new master or import rather than comparing strings directly.
`rfqTransferToMasters()` is idempotent by design; keep it that way.

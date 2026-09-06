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
| `api/*.js` | Vercel serverless functions | Both |

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
- The browser keeps the token in `sessionStorage` (per-tab, dies with the tab).
- **Opening `idms.html` signs nobody in.** Any token left in the tab is signed
  out on the server and discarded before the page draws, so the sign-in screen
  always stands. This was asked for directly: a shared works PC must not walk
  the next person into live quality records because the last one closed the lid.
  The session still lasts while the tab is open — that is what lets the framed
  website screens run without a second sign-in — it simply does not survive
  re-opening the page. The login fields carry `autocomplete="new-password"` and
  neutral names so the browser does not offer to save or refill them.
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

**Declared but not built:** the screens still marked `soon` in the menu (23 at
v109, down from 42), each showing an explanation rather than a blank page.

**Suggested order for the rest.** The QMS block is now the whole of what is left
that matters: the four document levels, the master lists, the document format
numbers, signatories and CFT members, and the audit calendars. It is the largest
remaining piece and the one that would turn roughly **twenty entry-only KPIs into
computed ones** — every "audit plan vs actual" and "NC closure" figure on the QMS
dashboard is typed today because there is no audit record to count. Build the
audit calendar and the NC closure first for that reason; the document levels are
mostly filing and can follow.

After that: the remaining production screens (DWM, task list, machine check
sheet, tool history), Key Process Input, P&L, and User Management.

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

`orgtest.mjs` (33 checks over the v109 screens: vacancies drawn from sanctioned
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

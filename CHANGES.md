## v143 — Planning Module reworked to MRP netting; RFQ → masters; master codes

**Planning Module (PPC & MMD → Planning Module (MRP))**
- Part stock counts each piece once, in the stage it is in now: WIP = OK at
  each in-house op − taken into the next (a sub-contract op in the routing takes
  in what went out on returnable challans and gives out what was accepted back);
  FI = OK at last op − offered to PDI; FG = PDI accepted − despatched; Supplier =
  returnable job-work challans − received back; Incoming = part GRNs not yet
  inspected. Rejected / on hold / rework shown for information only. Job work
  out > 180 days is flagged (GST ITC-04).
- Net requirement = gross − despatched − stock (earliest first, FG safety stock
  kept back); ÷ (1 − rejection %), rounded up to the batch size = balance to
  start 1st op; start-by = delivery − manufacturing lead time (late flagged).
  Batch round-up surplus is carried to the part's next delivery.
- RM: required − on hand (accepted, RM safety kept back) − on order (new RM
  Purchase Orders) = to purchase; summary rounded up to MOQ; order-by = start
  date − supplier lead time.
- Editable: **Edit** on a line changes the part master (rejection %, batch,
  FG safety, lead time), the BOM (material / RM code, qty per piece, scrap %)
  and the material (UOM, lead time, MOQ, safety) — written to the masters,
  audit-logged — and the line's date / quantity as a planner adjustment
  (`ppc_adj`, reason required, original kept, marked ✎). **Delete** excludes a
  line with a reason (PO untouched; Restore brings it back). **+ Add demand
  line** for samples / spares. **Release plan** freezes a `ppc_plan` snapshot
  and locks edits; **Reopen for revision** needs a reason.
- Headings frozen on vertical scroll; Part No and Customer Part No frozen on
  horizontal scroll; shaded group bands with borders.

**RFQ Pipeline → Move to PPC & MMD** now copies the costing into the masters:
BOM → BOM Master, raw material → Raw Material Master, routing → Process Master
(aiProposed, job-work ops marked sub-contract, existing op numbers never
overwritten), tooling → Tool Master (Tool History Card), jigs & fixtures → Jig
& Fixture Master, gauges → Gauge Master (Calibration Report), consumables →
Consumables Master. All marked provisional + fromRfq. An item already on a
master is linked, not duplicated; pressing again creates nothing new. A result
table shows created / linked / skipped per master.

**Masters**
- One identity rule (`mNorm` / `mKey`): case, spacing, punctuation and
  Ø/⌀/Dia/Diameter do not make a new item. Raw material / consumables are
  refused as duplicates on description, or on type + grade + form + size.
  Jigs on description + part + operation. Tools warn (two cards of one tool
  on one machine are allowed deliberately).
- Auto codes from the database counter: RM, CON (new), TOOL, JF (new), GAUGE,
  RMPO (new).
- New screens: Jig & Fixture Master, Consumables Master (the material master
  filtered to Type = Consumable — one record, one code), RM Purchase Orders
  (receipts matched to POs oldest first, short-close, delete if unreceived).
- New fields: part — rejection %, batch size, FG safety stock, mfg lead time;
  material — supplier lead time, MOQ, safety stock.
- Fixed: editing a material on the master wiped its opening balance; part GRNs
  (job work) were listed as unknown raw materials.

Tests: `tests/ppcplanningtest.mjs` (58), `tests/rfqppctest.mjs` (16).

## v142 — PPC & MMD: Planning Module (MRP), one click from the Sales Plan

New screen **PPC & MMD → Planning Module (MRP)** (`ppc_planning`), and a
**▶ Run Planning** button on the Sales Plan that opens it and runs it for the
month being viewed.

One row per demand line (each PO / schedule due in the plan months, or the
tentative / forecast quantity where there is no real PO), with:

Part No (auto-generated) · Customer Part No · Customer Part Name · Delivery
Date · PO/Schedule Qty · FG · FI · Supplier · WIP (all stages) · Incoming
inspection · Overall stock (sum of the five) · Balance to start 1st operation ·
RM Code · RM Specification/Description · RM per part · UOM · Total RM required
(balance × RM per part) · RM available · RM balance to purchase (required −
available).

- **Stock is worked out from records**, not typed: FG = PDI-cleared lots not yet
  despatched; FI = good pieces off the last operation not yet offered to PDI;
  Supplier = returnable delivery challans not yet received back on a GRN; WIP =
  good at each operation not yet taken up by the next, summed over every stage;
  Incoming = part GRNs not yet inspected.
- **Physical counts** can replace any of the five per part (kind `part_stock`,
  needs a "counted by" name, shown with a *counted* tag). Clear the box to go
  back to the worked-out figure.
- **Pools, not per-line counting.** A part's stock is used by its earliest
  delivery first; a raw material shared by several parts is used the same way.
  Anything already invoiced against the month's demand is taken off first.
- RM per part is the BOM's gross figure (qty per piece × (1 + scrap %)).
- RM available is the Raw Material Stock balance. That arithmetic now lives in
  `computeRmStock()`, used by both screens, so they cannot disagree.
- Gaps are named, not hidden: parts with no BOM, no routing, or bookings that
  would make a stage negative.
- **Raw material to purchase** card adds the lines up per material (required,
  on hand, awaiting inspection, to purchase, value at standard rate).
- Save a plan run (kind `ppc_plan`, snapshot), export to CSV (opens in Excel),
  print. No purchase order is raised — MMD raises it; the screen says what and
  how much.

Test: `tests/ppcplanningtest.mjs` (33 checks).

## v141 — reading accuracy, duplicate callouts, balloon placement, speed

Reported directly: the AI reading was inaccurate and missed items, ballooning
landed in the wrong place, the table showed duplicate entries, characteristics
appeared that were not really on the drawing, and a reading took too long.

- **Duplicates across the three AI passes (main reading, completeness sweep,
  adversarial audit)**: `rfqNormCallout` now folds Ø/⌀/"Dia"/"Diameter" to one
  token before comparing callouts, matching what the OCR layer already did —
  previously "Ø17.5" from one pass and "⌀17.5" from another were treated as two
  different characteristics and both survived to the table.
- **Same bug, coordinate side**: the final duplicate collapse in
  `rfqStrictEvidenceSanitize` bucketed positions to a tenth of a percentage
  point. Three independent AI reads of the same sheet report slightly
  different coordinates for the same real callout, so that bucket size treated
  ordinary cross-pass jitter as three separate characteristics. Widened to a
  1.5-point bucket, matching the proximity threshold `rfqMergeChars` already
  uses elsewhere.
- **Characteristics not actually on the drawing**: `EngineeringVision.apply()`
  previously only removed the balloon (cleared the coordinate) when OCR found
  no supporting text — the row itself stayed in the table looking like a real,
  if unplaced, requirement. A characteristic that scores below 0.30 — no
  match for its text or its numbers anywhere on the sheet, not a weak match —
  is now dropped from the table entirely rather than left to be discovered on
  the drawing. Removed items are logged on the reading (`noEvidenceRemoved`),
  the same way every other filter in this pipeline reports what it took out.
- **Balloons landing on the wrong occurrence of a repeated value**: on a dense
  drawing with several identical callouts (the same tolerance, the same
  chamfer angle, repeated across the sheet), prose similarity and number
  matching cannot tell them apart — only position can. The spatial-proximity
  term in `matchCandidate` was weighted at 0.10 against 0.24 for prose
  similarity; raised to 0.16, taken from prose similarity's own weight, so the
  AI's reported location can break a tie against a strong text match on the
  wrong occurrence.
- **Speed**: the focused-crop re-verification step awaited up to 8 AI calls
  one at a time, so the wall-clock cost was their sum. It now runs them in
  batches of 3 with `Promise.all`. The threshold for sending a characteristic
  to this step was also tightened from "OCR score below 0.82" to "below
  0.72" — a callout OCR already matched strongly gains nothing from a third
  AI opinion, and skipping it is pure saved time.

## v140 — RFQ engineering balloon auto-location + symbol editor

- Added local recovery of balloon targets for existing RFQs using saved PDF vector text metadata plus fresh OCR.
- Added `AI place all` in the balloon workspace.
- Preserved the original AI callout coordinates as review candidates even when verification is unresolved; export verification remains blocked until evidence is complete.
- Added direct dimension/characteristic text editing with an engineering symbol palette in the RFQ screen.
- Added direct GD&T/symbol editing with insertion at the current caret position.
- Added numeric-signature/vector-text matching to improve decimal/tolerance-sensitive callout localization.
- Added v140 regression test.

## v133 — hybrid engineering-drawing evidence pipeline

Lossless high-resolution drawing rasterization, PDF text-layer positioning, dual-pass OCR evidence, focused crop rereads, stricter semantic cleanup, and callout-box-aware balloon placement.

# v120 — HR & Payroll in the IDMS, automatic attendance, Bulk Upload tiles

No manual database step: the two new tables (`hr_punches`, `hr_devices`) are
created automatically on first use. No new environment variable, no new
dependency.

## Files to copy across

| File | Why |
|---|---|
| `idms.html` | HR & Payroll workspace, Attendance Register, Attendance Devices, Bulk Upload tiles, employee and device-log uploads, Biometric ID on People |
| `index.html` | opens one HR screen at a time inside the IDMS |
| `api/device.js`, `api/_attendance.js` | **new** — receives punches and marks attendance |
| `api/_db.js` | creates the two new tables |
| `vercel.json` | **new** — sends `/iclock/…` (fingerprint / face push devices) to the device endpoint |
| `CLAUDE.md`, `CHANGES.md`, `tests/` | records and tests |

## After deploying, check these

1. **HRM → HR & Payroll** opens as tiles, not the old framed page. Payroll opens
   inside it without the website's tab bar.
2. **Masters → Bulk Upload** shows tiles. Customer PO and Sales Plan are tiles
   there (no longer separate menu items). Try **Employees**: download the
   template, add two rows, upload, check the preview, Import, then open People.
3. **HR & Payroll → Attendance Devices:** choose your equipment, save the rules,
   register one device (serial number for ZKTeco/eSSL, or Hikvision for a face
   terminal — copy its key, it is shown once).
4. On the device, enter the settings shown under the form. Within a minute of a
   scan the device should show **Reporting** and the punch in **Punch log**.
5. Put each person's device user ID in **Biometric / Face ID** on People (or in
   the upload). Any ID matched to nobody is listed under Punch log.
6. **Attendance Register:** today's punches appear as P; press a day to see its
   punches, approve overtime, or correct it with a reason.

Before buying or setting up devices: the device must support **HTTPS** for
server push. A plain-HTTP-only unit cannot connect; use **Import Device Log**
for it.

## Run the tests

```bash
npm install jsdom --no-save
npm test
```

Expect every suite clean except `smoketest`'s 2 known sign-in branding failures.

---

# v119 — what changed and how to check it

Drop-in replacements. **No database migration, no new environment variable, no
new dependency** (`package.json` still has exactly one). New settings are stored
in the existing `idms_settings` table the first time they are saved.

## Files to copy across

| File | Why |
|---|---|
| `idms.html` | invoice against PO, full tax invoice, PO documents, tentative month names, bulk PO / Sales Plan upload, revised-PO double count, tab session sharing |
| `core.js` | tab session sharing, local QR codes, USD amount in words, upload type fix |
| `index.html` | framed staff screens use the IDMS session (no second sign-in) |
| `CLAUDE.md`, `CHANGES.md` | records this pass |
| `tests/` | `invoicetest`, `bulkpotest`, `sessionsharetest` new; `editdeletetest` corrected |

## After deploying, check these

1. **New tab.** Sign in, right-click any menu item → *Open link in new tab*. It
   opens on that screen without asking to sign in. Close every IDMS tab, open
   the IDMS again: the sign-in screen must appear. Sign out in one tab: the other
   tabs return to the sign-in screen.
2. **RFQ Pipeline / HR & Payroll** from the IDMS menu open without a sign-in box.
3. **Sales Invoice → Invoice settings** (bottom of the screen): enter UPI ID,
   jurisdiction, place, copies. Save.
4. **Sales Invoice.** Choose a customer and a part with two POs on file. The
   *Customer PO* dropdown lists both; the earliest due is chosen; PO No. and PO
   date at the top fill in when the line is added. Save — the invoice opens with
   borders on every box and every section of the format. Print preview should
   show nothing running outside its box.
5. **Customer PO register:** *View* / *Download* on a PO with a document,
   *Attach* on one without. Type a delivery date: the tentative boxes read
   *Tentative — <month>*.
6. **Masters → Customer PO Bulk Upload / Sales Plan Bulk Upload:** download the
   template, fill two rows, upload, check the preview, Import.
7. **Revise a PO twice** (Edit → change quantity → Update, then again). Both
   saves are accepted, and Sales Plan shows the quantity once.

## Run the tests

```bash
npm install jsdom --no-save     # throwaway; do NOT commit it to package.json
npm test
```

Expect every suite clean except `smoketest`, which still reports its **2 known
failures** (company name on the sign-in screen — left for a decision, see
CLAUDE.md).

---

# What changed — deployment checklist

Every file below is a drop-in replacement. No database migration, no new
environment variable, no dependency change (`package.json` still has exactly one
dependency).

## Files to copy across

| File | Why |
|---|---|
| `idms.html` | id collision fixed, `taskPrefill` declared, 15 read-batches, 91 helper copies removed |
| `index.html` | `ap-msg` collision fixed, blocking pdf.js removed |
| `core.js` | in-flight read sharing |
| `drawing-convert.js` | `loadPdfLib()` exported |
| `CLAUDE.md` | records this pass |
| `.vercelignore` | **new** — keeps tests and docs off the live domain |
| `package.json` | adds `npm test` only |
| `tests/` | **new folder** — the suites, plus a runner and the equivalence harness |

## Files to DELETE from the repo root

These are stale duplicates of the `api/` versions and are served publicly:

```
_db.js   auth.js   content.js   notify.js   assets.js   rfqs.js
```

`auth.js` still contains the withdrawn `token: current.pass_hash` scheme, so this
deletion is worth doing even on its own.

## After deploying, check these four things

1. **IDMS → Setup Approval.** Load characteristics, save a setup. The messages
   and the "Recent setups" list should now appear **on that screen**. Before this
   change they were being written into the hidden Supplier panel.
2. **IDMS → Open Actions.** Should now draw completely. It threw a
   `ReferenceError` part-way through on every previous visit.
3. **Website → Careers → apply, leave name blank.** "Name and phone are required"
   should now be visible. It was going into a hidden staff panel.
4. **Website first load.** Should be noticeably quicker — ~340 KB of pdf.js is no
   longer downloaded before the page paints. Attaching a PDF still works; the
   library loads at that moment.

Two smoke checks from CLAUDE.md still apply and should still hold:
IDMS → save two GRNs, numbers must run `…-0001` then `…-0002`; and searching the
built files for `deno` must return nothing.

## Run the tests

```bash
npm install jsdom --no-save     # throwaway; do NOT commit it to package.json
npm test
```

Expect **438 passing**. `smoketest` reports **2 deliberate failures** about the
company name on the sign-in screen — that is a real regression being surfaced,
not a broken test. See ANALYSIS.md §6.

## Verify nothing moved

```bash
node tests/equivalence.mjs <old-dir> <new-dir>
```

Expect `93/95 screens render identically`, with `report_setup_approval` and
`task_list` differing — those two are the defects being fixed.

## Nothing here is irreversible

Every change is confined to the files listed above. Reverting any single file
restores its previous behaviour independently of the others.


## v134 — RFQ click reliability fix
- Replaced per-link RFQ menu navigation with a delegated capture-phase menu handler.
- Added explicit `data-nav="idms-screen"` and accessible labels to menu links.
- `rfq_pipeline` navigation now selects the panel before asynchronous loading and reports load failures instead of appearing non-responsive.
- `rfq_new` navigation is protected with an actionable error message.

## v135 — RFQ deployment/navigation fix

- Fixed the production routing bug that made RFQ Pipeline clicks appear dead after deployment.
- Removed the `/idms.html -> /api/idms-screen` rewrite. That rewrite fetched `idms.html` from the `kmrgroups/ironvale-website` GitHub `main` branch, so the deployed app could ignore the locally edited RFQ navigation code entirely.
- `/idms` and `/idms/` now resolve to the deployed local `/idms.html` document.
- Added `tests/rfqdeploymenttest.mjs` to prevent this regression.

## v138 — RFQ runtime error fix

Fixed the live RFQ runtime failure shown by the application: `rfqNormalizeTolerance is not defined`. The RFQ page was opening, but the Drawing section aborted on that missing function. Restored the shared drawing-number parser and tolerance normalizer used by the RFQ drawing pipeline, including decimal-comma handling and signed/plus-minus tolerance normalization. Added a focused runtime regression test.

## v139 — RFQ drawing direct editing + smarter balloon placement
- Added inline Edit/Delete actions for every drawing characteristic directly on the RFQ screen.
- Added + Add characteristic directly inside Drawing Data.
- Added inline Save/Cancel editor for characteristic values, tolerances, GD&T, specification, class and location note.
- Added Ctrl/Cmd+S and Escape shortcuts for the inline editor.
- Kept the Place Balloons side list visible while editing and retained drag/delete controls.
- Automatic balloon starting positions now derive from verified callout bounding boxes and choose among eight nearby candidates instead of a fixed diagonal offset.
- Persisted edits back to the RFQ extract so drawing data, balloons and downstream screens share the same corrected list.

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

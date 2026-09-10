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

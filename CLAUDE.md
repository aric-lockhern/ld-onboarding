# CLAUDE.md

Google Apps Script project. Client onboarding CRM for a paid-search agency, bound to a Google Sheet that acts as the database.

## The five things that will bite you

### 1. Trailing underscore means "not callable from the browser"

Apps Script refuses to expose functions ending in `_` to `google.script.run`. This is a hard platform rule, not a convention.

- `getSendQueue(token)` — callable from `Admin.html`
- `buildQueue_()` — server-internal only

**Renaming a public function to add `_`, or calling a `_` function from HTML, breaks the UI silently at runtime.** Nothing catches it at parse time. `npm run check` catches it — run it before you claim anything works.

### 2. Column maps are the source of truth

`src/Code.gs` defines `C` (Clients) and `A` (Access) as 1-based column maps. Every read and write goes through them.

Adding or reordering a column means changing **three** places:
1. The `C` or `A` object, including `WIDTH`
2. The header array in `setup()`
3. Any `getRange(row, 1, 1, N)` that hardcodes a width

The `Platforms` and `Phases` tabs are read with raw indices (`r[8]`, `r[9]`) because they're config, not records. If you touch those seeds, check `seedPlatforms_`, `getPlatformList`, and `buildAccessRows_` together — they all index the same array shape.

### 3. Seeds bail if data exists

`seedPlatforms_`, `seedPhases_`, `seedTemplates_`, `seedConfig_` all return early if row 2 is populated. This protects the user's edits — `setup()` is safe to re-run to repair headers without wiping their config.

Consequence: **changing a seed array does not update an existing sheet.** To test a seed change you need a fresh spreadsheet, or the user clears the tab first. Say so rather than assuming the change took.

### 4. Sheet content overrides code

`getTemplate_()` reads the `Templates` tab first and falls back to the constants in `Templates.gs`. Editing email copy in the code has no effect on a deployed sheet whose `Templates` tab is populated. Same pattern for `Platforms` and `Phases`.

### 5. There is no local runtime

Apps Script only executes inside Google. You cannot run this code, hit a breakpoint, or write a unit test that exercises `SpreadsheetApp`. `npm run check` does syntax parsing and cross-reference validation — that is the ceiling of what's automatable here.

Anything beyond that needs `npm run push` and a manual click-through. Don't report a behavioural change as verified when only `check` has run.

## Layout

```
src/
  Code.gs        setup(), menu, column maps, intake, task board, Drive folders
  Phases.gs      phase state, gate evaluation, send eligibility
  Send.gs        preview, send, queue construction, preflight
  Templates.gs   email copy + merge + composer
  PlanGen.gs     Anthropic API call, prompt, plan Doc output
  Admin.gs       PIN gate, dashboard reads, field writes
  Digest.gs      daily overdue email + trigger installer
  Intake.html    intake sidebar (~300px)
  Admin.html     dashboard modal (760px)
design/
  mockup.html    standalone UI reference, fake data, no Apps Script calls
docs/
  OPERATIONS.md  install, phases, daily use, deploying, adjusting
scripts/
  check.mjs      static validation — node builtins only, no dependencies
.github/workflows/
  deploy.yml     check on PRs, clasp push on merge to main
```

`design/mockup.html` is documentation, not shipped code. It duplicates the UI intentionally so the design can be reviewed without a deployment. If you change the dashboard's structure, either update it or delete it — a stale mockup is worse than none.

## Conventions

- Plain ES2015+ on V8. No build step, no bundler, no TypeScript. Files are pushed verbatim.
- HTML files are referenced without extension: `createHtmlOutputFromFile('Admin')`.
- Inline `<script>` in HTML runs in an iframe sandbox. `localStorage` and `sessionStorage` are unavailable — keep state in JS variables.
- Secrets live in `PropertiesService.getScriptProperties()`, never in a cell and never in the repo. Currently: `ANTHROPIC_API_KEY`, `DASH_PIN_HASH`.
- The dashboard PIN is a convenience lock. Anyone with edit access to the Sheet can read around it via the script editor. Don't describe it as access control.

## Domain rules worth preserving

These encode decisions that took real thought. Changing them is fine; changing them by accident is not.

- **Phase gates exist for a mechanical reason.** The Phase 2 client email contains the client's alias and points at their Drive folder, both created in Phase 1. Sending before Phase 1 closes produces a broken email. The gate isn't process theater.
- **Preview never mutates.** `dashPreview` and `dashPreviewNudge` must stay side-effect free — no `markRequested_`, no logging. Only `dashSend` writes.
- **Preview and send run identical checks in the same order** (phase gates, then preflight) so the preview can't show something the send would refuse. If you add a check, add it to `buildPhaseEmail_` where both paths share it.
- **Access is granted to a client alias, never a person.** Every template says so. This survives staffing changes and makes offboarding a clean revoke.
- **No credentials in Drive.** `DRIVE_SUBFOLDERS` deliberately has no credentials folder, and the Reddit Organic template tells clients to use a password manager.
- **Gate vs non-gate is a real distinction.** Brand assets is intentionally not a gate — it always trails and gating on it would stall every account. Media billing is a gate because a failed card pauses campaigns.

## Commands

```
npm run check    syntax + cross-reference validation
npm run push     clasp push to the bound script
npm run open     open the script editor
npm run pull     pull remote changes (overwrites src/)
```

`clasp pull` overwrites local files. If someone edited in the browser, pull before you push or you'll clobber them.

## Merging to main deploys

`.github/workflows/deploy.yml` runs `check` on every PR and `clasp push --force` when a commit lands on `main`. There is no staging sheet — a merge reaches the live tool people are using that day.

Two consequences worth holding onto:

- **`--force` clobbers browser edits silently.** It's required because a non-interactive runner hangs on the manifest prompt. Nothing warns you, and there's no undo.
- **`check` passing is not evidence the change works.** It parses and cross-references; that's all. Per rule 5 above, a behavioural change is unverified until someone clicks through the sheet. Say so rather than implying the deploy proved anything.

Setup and secrets: `docs/OPERATIONS.md`.

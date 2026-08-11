# CLAUDE.md

Google Apps Script project. Client onboarding CRM for a paid-search agency, bound to a Google Sheet that acts as the database.

## The six things that will bite you

### 0. Two files cannot share a basename

Apps Script drops the extension. `Admin.gs` and `Admin.html` both want to be `Admin`, and names are unique across types — so a project holding both fails the push with:

```
A file with this name already exists in the current project: Admin
```

It fails *partway through*, leaving the script project half-written. This shipped broken; the server file is now `AdminServer.gs` so it doesn't collide with `Admin.html`. `npm run check` enforces it.

Never name a `.gs` file after an HTML file.

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

### 5. There is no local runtime for the server half

Apps Script only executes inside Google. You cannot run a `.gs` file, hit a breakpoint, or unit-test anything touching `SpreadsheetApp`. `npm run check` does syntax parsing and cross-reference validation — that is the ceiling for server code.

The *client* half is testable. `npm run ui` renders `App.html` in headless Chromium with `google.script.run` stubbed, walks every view at desktop and mobile widths, fails on any JS error, and writes screenshots to `.uicheck/`. It has already caught a duplicated client row, clipped `<select>` text, and a mobile layout that squeezed company names to zero width.

It proves nothing about the server: every response is fake. A behavioural change still needs `clasp push` and a click-through. Don't report one as verified when only `check` and `ui` have run.

## Layout

```
src/
  Code.gs        setup(), menu, column maps, intake, task board, Drive folders
  WebApp.gs      doGet — serves App.html at a URL; menu pages still available
  Phases.gs      phase state, gate evaluation, send eligibility
  Send.gs        preview, send, queue construction, preflight
  Templates.gs   email copy + merge + composer
  PlanGen.gs     Anthropic API call, prompt, plan Doc output
  AdminServer.gs PIN gate, dashboard reads, field writes
  Extract.gs     ClickUp/Doc fetch (readSource) + AI extraction (runExtraction)
  Drafts.gs      draft clients — Drive-backed document storage, resume, re-analyse
  Profile.gs     client profile — how to work with them, written from the calls
  Digest.gs      daily overdue email + trigger installer
  Intake.html    intake sidebar (~300px, in-sheet menu)
  Admin.html     dashboard modal (760px, in-sheet menu)
  App.html       the web app UI — own nav, four views, built for a browser
design/
  mockup.html    standalone UI reference, fake data, no Apps Script calls
netlify.toml     redirects a short URL to the Apps Script deployment
docs/
  OPERATIONS.md  install, phases, daily use, deploying, adjusting
scripts/
  check.mjs      static validation — node builtins only, no dependencies
  uicheck.mjs    renders App.html in headless Chromium with a stubbed backend
.github/workflows/
  deploy.yml     check on PRs, clasp push on merge to main
```

`design/mockup.html` is documentation, not shipped code. It duplicates the UI intentionally so the design can be reviewed without a deployment. If you change the dashboard's structure, either update it or delete it — a stale mockup is worse than none.

## Conventions

- Plain ES2015+ on V8. No build step, no bundler, no TypeScript. Files are pushed verbatim.
- HTML files are referenced without extension: `createHtmlOutputFromFile('Admin')`.
- `SpreadsheetApp.getUi()` exists only in the sheet. Menu wrappers may call it; anything reachable from `Admin.html`, `Intake.html`, or `doGet` may not, or the web app URL breaks while the menu keeps working.
- `netlify.toml` forwards, it never hosts. If the deployment ID changes — a *new deployment* rather than a new version of the existing one — every redirect in it silently points at old code.
- A `clasp push` does not update the web app URL. That needs a new deployment version in the editor, so the menu and the URL can run different code.
- `App.html` dispatches server calls dynamically through `api()`, which hides them from `check.mjs`. Its targets are declared in the `SERVER_FNS` array, which `check.mjs` validates by name — add a call there or `api()` rejects it.
- Inline `<script>` in HTML runs in an iframe sandbox. `localStorage` and `sessionStorage` are unavailable — keep state in JS variables.
- Secrets live in `PropertiesService.getScriptProperties()`, never in a cell and never in the repo. Currently: `ANTHROPIC_API_KEY`, `DASH_PIN_HASH`, `CLICKUP_API_TOKEN`.
- `Extract.gs` is named that way because `Intake.html` already owns the name `Intake` — see rule 0. It reuses `callAnthropic_` from `PlanGen.gs` rather than opening a second API client.
- The dashboard PIN is a convenience lock. Anyone with edit access to the Sheet can read around it via the script editor. Don't describe it as access control.

## Domain rules worth preserving

These encode decisions that took real thought. Changing them is fine; changing them by accident is not.

- **Phase gates exist for a mechanical reason.** The Phase 2 client email contains the client's alias and points at their Drive folder, both created in Phase 1. Sending before Phase 1 closes produces a broken email. The gate isn't process theater.
- **Preview never mutates.** `dashPreview` and `dashPreviewNudge` must stay side-effect free — no `markRequested_`, no logging. Only `dashSend` writes.
- **Preview and send run identical checks in the same order** (phase gates, then preflight) so the preview can't show something the send would refuse. If you add a check, add it to `buildPhaseEmail_` where both paths share it.
- **Access is granted to a client alias, never a person.** Every template says so. This survives staffing changes and makes offboarding a clean revoke.
- **No credentials in Drive.** `DRIVE_SUBFOLDERS` deliberately has no credentials folder, and the Reddit Organic template tells clients to use a password manager.
- **Services and Platforms are different lists.** Services are what the client bought (the contract); Platforms are what we need access to. One service implies several platforms via the `Services` tab, and some platforms arrive regardless via Always Include. Conflating them puts a Merchant Center request in a lead-gen client's access email.
- **Reading a source and analysing it are separate calls.** `readSource` fetches exactly one document and returns its outcome; `runExtraction` sends the ones that worked to the model. Fetching is the step that fails — a ClickUp doc in a Space you're not in, a scanned PDF, an unshared deck — and one combined call can only report failure for the whole batch. Split, a failure is attributable to one document, and that one can be retried, replaced or skipped while the others keep their result. `readSource` must never throw: the UI needs the reason on that document's row, not a rejected promise.
- **Extracted text lives in Drive, on the draft, not in a cache.** `readSource` writes each document's text into the draft's Drive folder and returns a file ID; `runExtraction` reads it straight back from there. That is what makes re-analysing a draft opened a week later cost nothing — no re-upload, no re-fetch, no expiry. It replaced a chunked `CacheService` scheme whose six-hour TTL made "come back to it tomorrow" impossible. The original upload is kept alongside the text: the text is what gets analysed, the PDF is what someone wants to look at in six months.
- **A draft survives submission.** `submitIntake` marks it `Submitted` and stamps the client ID on it; it never deletes it. The draft's Drive folder is the deal's document record, which is where you look when someone asks in November what was actually agreed — and it is what lets a fee be corrected and re-analysed later without hunting for files.
- **A saved draft form beats the extraction, and a fresh extraction clears it.** `exVal` reads `DRAFTFORM` before `EXTRACT`, because typing over a value is the later and more deliberate act. Re-analysing nulls `DRAFTFORM` so the new reading is not masked by what was typed against the old one. Get this backwards and either corrections vanish or re-analysis silently does nothing.
- **A PDF is attached to the model, not just transcribed.** `runExtraction` sends the original file as a `document` content block alongside the text pulled out of it. Fee tables are routinely exported as images with no text layer at all, so extraction returns the sentence introducing the table and then stops — and nothing looks wrong, because the other nine pages came through fine. The `< 40 chars` scanned-PDF check does not catch this; a 17,000-character contract with an image fee table passes it easily. `looksPriceless_` flags a scope of work or deck whose text holds no currency at all, and the row says so.
- **Organic and paid on the same platform are different services.** `Meta Ads` vs `Meta Organic Social`, `Reddit Ads` vs `Reddit Organic Social`. Running a page and buying inventory on it have different deliverables and different access, and conflating them puts an ad-account request in front of a client who only wanted their posts scheduled. The extraction is told this explicitly, and it does hold the line — it declined to tick Reddit Ads off a scope selling Reddit organic, and said why in `conflicts`.
- **The prompt offers the Services TAB, never the `SERVICES` constant.** The tab is what the review screen renders checkboxes from, so anything else lets the model return a service with nowhere to land. That is exactly how "Reddit Organic Social" came back off a signed scope of work, priced at 2000 on the fee table, and appeared nowhere on the form. `repairServices_` appends code-added services to an existing tab on the next `setup()` — append-only, so edits survive; deactivate a service with `Active = FALSE` rather than deleting the row, or it comes back.
- **A platform can depend on the business type.** The Services tab's platform cell accepts `Google Merchant Center [eCommerce]` — needed for Shopping and PMax, useless to a lead-gen advertiser with no feed. The qualifier lives in the cell rather than a new column because the Platforms and Services tabs are read by raw index in three places (rule 2). `parsePlatformSpec_` parses it; `platformApplies_` decides. Changing Business type on the form re-applies every ticked service's platforms.
- **The client profile is how to work with them, not what they bought.** `Profile.gs` reads the draft's transcripts at creation and writes prose — tone, priorities, what will annoy them, who decides — into `C.PROFILE`. It is markdown, not JSON, because the Clients tab is read by people and half the team works in the sheet. It never blocks: a failed profile leaves the client record untouched, and it can be rebuilt from the client page for as long as the draft survives.
- **A service is something sold, not a deliverable inside one.** A contract bundling "one custom landing page at a time" into Google Ads management has bought Google Ads, not a Landing Page — and ticking Landing Page would request WordPress access for a Shopify store. The fee table is the check: three fee lines usually means three services.
- **A service that was sold but has no name goes in `unmatchedServices`.** The prompt requires services to match the `SERVICES` list exactly, which is right — "Reddit Organic Social Management" is not "Reddit Ads", and forcing it there would put a paid-media access request into an organic-only account. But the model used to drop the mismatch silently, so a workstream named on page two of the SOW vanished. Now it comes back with its quote and the UI shows it. If it happens, the fix is usually a new row on the Services tab, not a prompt change.
- **Trimming is reported, never silent.** `allocateBudget_` gives short documents only what they need so one long transcript can't squeeze a scope of work to a proportional sliver; whatever still overflows is trimmed head-and-tail and named in `runExtraction`'s `trimmed` array, which the UI surfaces. A monthly fee agreed forty minutes into a call is exactly what a dropped middle costs you.
- **Creating a client and starting its onboarding are separate acts.** `submitIntake` writes the record only. `startOnboarding` builds the task rows, and from that moment there are due dates, owners and a queue entry — undoing it means deleting rows. The split exists so the record can be corrected freely first.
- **Fees are stored per line, not as a total.** The pricing slide's channels and discounts survive into the `Fees` cell as JSON; MRR is their sum. A mid-term upsell is a new line, so the history of what changed stays readable.
- **Gate vs non-gate is a real distinction.** Brand assets is intentionally not a gate — it always trails and gating on it would stall every account. Media billing is a gate because a failed card pauses campaigns.

## Commands

```
npm run check    syntax + cross-reference validation
npm run ui       render App.html in a browser, screenshot every view
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

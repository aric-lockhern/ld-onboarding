# Lockhern Onboarding CRM

Intake, AI onboarding plan, instruction emails, Drive structure, due dates, and a daily overdue digest — on Apps Script + Sheets.

## Install

1. New Google Sheet → **Extensions → Apps Script**. Names must match exactly.

   | File | Type |
   |---|---|
   | `Code.gs` | script |
   | `PlanGen.gs` | script |
   | `Templates.gs` | script |
   | `AdminServer.gs` | script |
   | `Digest.gs` | script |
   | `Send.gs` | script |
   | `Phases.gs` | script |
   | `Intake` | HTML |
   | `Admin` | HTML |

2. Run `setup()`. Approve the OAuth scopes.
3. Reload the sheet.
4. **Onboarding → Set Anthropic API key**, then **Set dashboard PIN**.
5. Fill in **Config**: alias domain, Drive root folder ID, digest recipients, MCC ID, Meta BM ID, Merchant Center ID, Shopify partner name, signature, default owner.
6. **Onboarding → Enable daily digest.**

Optionally run `protectSensitiveRanges()` to lock MRR and Config to owner-edit.

> **Upgrading from the previous version:** column layout changed on `Clients`, `Access`, and `Platforms`. Easiest path is a fresh sheet. To keep existing data, add the new columns manually in the order listed in `setup()` before re-running it — the column maps `C` and `A` at the top of `Code.gs` are the reference.

## Phases

Onboarding runs in five phases. A phase advances when its **gate** tasks are Complete; non-gate tasks in the same phase can trail without blocking.

| Phase | Gates | Why it gates |
|---|---|---|
| 1 · Internal Setup | Alias, Drive folder | The client email *contains* the alias and points at the folder. Sending before these exist produces a broken email. |
| 2 · Client Requests | Core access, media billing | Can't audit without access; can't launch without a funded account. |
| 3 · Data & Validation | Baseline snapshot, tracking validated | Baseline is unrecoverable once you start optimising. Tracking before spend moves. |
| 4 · Launch | Kickoff call | — |
| 5 · Steady State | none | First report and the 30-day check trail naturally. |

Gates are marked with ▮ in the task list. Phase and Gate are columns on the `Platforms` tab — editable, nothing hardcoded. The `Phases` tab holds the names, the meaning shown in the UI, and which template each phase sends.

This is the mechanism behind "internal work influences client-facing work." Alderwood can't be emailed until Drake creates its alias, and the queue says exactly that, with his name on it.

## Daily use — the queue

The dashboard opens on **Queue**. Four sections:

- **Ready to send** — phase gates closed, preflight clean. Tap **Preview**.
- **Waiting on client** — already chased, sorted by days waiting. **Nudge** previews the short follow-up.
- **Held by internal work** — phase gates still open, naming the task and its owner.
- **Needs fixing** — preflight problems: missing recipient, unfilled merge tag, empty Config row.

### Preview then send

Nothing sends without being looked at. **Preview** shows the exact recipient, subject, and body — a read-only call that sends nothing and marks nothing Requested. **Send now** in that panel delivers it. Two taps, and the second one is on real content.

The preview and the send run the same two checks in the same order — phase gates, then preflight — so the preview can never show something the send would refuse.

Every send logs to a `Sent Log` tab with who sent it.

> Gmail caps sending at 500/day on Workspace, 100/day on consumer accounts.

**New client intake** → one submit writes the client record, builds the dated task checklist, creates the Drive folder with subfolders, and generates the onboarding plan.

**Clients tab** → every client with a segmented bar, one tick per task. Click through for the detail view: a phase rail across the top showing where they are, the current phase's meaning and open gates, then tasks grouped by phase with completed ones collapsed per phase.

**Digest** → daily 8am email of overdue, due today, blocked, and waiting-on-client 7+ days, grouped by owner.

## What was added beyond access

The checklist now carries these automatically on every client:

| Task | Due | Why it's there |
|---|---|---|
| Media billing setup | +5 | Campaigns pause on a failed card. The most common launch delay that has nothing to do with the work. |
| Baseline performance snapshot | +5 | Export 12 months before touching anything. The only proof of lift you will ever have, and it's unrecoverable once you start optimising. |
| Historical data export | +7 | Pull search terms, creative, audiences, feed snapshots while access is fresh. |
| Brand assets and constraints | +7 | Not the logos — the restricted terms, claims limits, and competitor rules that live in one person's head until an ad goes live. |
| Conversion tracking validated | +12 | Access is not measurement. Fire a test conversion and confirm it lands everywhere before spend moves. |
| First report delivered | +35 | A late first report resets expectations badly and permanently. |
| 30-day client check-in | +30 | Owned by Justin, not the pod. |

Plus the internal setup: alias, Drive folder, Slack channel, ClickUp space, weekly call, kickoff.

## Due dates and owners

`Platforms` has two columns doing the work:

- **Due Offset (days)** — days from contract start, falling back to intake date. Change the number, change the schedule.
- **Default Owner** — overrides the client's onboarding owner for that one task. This is how the 30-day check-in lands on Justin while everything else sits with the pod. Blank inherits the client owner.

Neither is hardcoded. Adding a partner-owned 90-day review is one row.

## Drive folder

Auto-created as `Company (CLIENT-ID)` under the configured root, with:

```
01 Contract & SOW
02 Call Recordings & Transcripts
03 Brand & Creative
04 Reports
05 Audits & Strategy
06 Feed & Product Data
```

There is deliberately no credentials folder. Shared logins belong in a password manager with an audit trail, not a Drive folder that half the client's team can see. The Reddit Organic template says the same thing to clients.

## Why one email, not seventeen

The composer bundles every outstanding client-action task into a single Gmail draft with a section per platform, then moves those tasks to Requested. Sending nine separate access emails is how onboarding stalls — the client does three and loses the thread.

Internal tasks never appear in client email. API-method platforms do, because the client still has to accept the invite and send an account ID.

## Tabs

| Tab | Purpose |
|---|---|
| `Clients` | Master record: scope, cadence, Slack, alias, Drive, billing, approvals, renewal, live progress |
| `Intake` | Raw transcript / contract / notes |
| `Access` | One row per client × task, with due date and owner |
| `Plans` | Generated plans as JSON + Doc link |
| `Platforms` | Reference table — method, due offset, default owner, always-include |
| `Templates` | Editable email copy. Sheet edits override the code. |
| `Config` | Agency settings, Drive root, digest recipients, account IDs |

## On the PIN

A convenience lock. It stops a teammate opening the dashboard and reading MRR and scope; it does not stop anyone with edit access to this Sheet, who can open the script editor and read the values directly. If financials genuinely need restricting, keep them in a separate sheet shared more narrowly.

## Worth considering next

Things deliberately left out, in rough order of value:

1. **ClickUp task sync** — you already have connectors. Pushing the checklist into ClickUp means the pod works where it already works instead of in a second system.
2. **Client-facing status page** — a published web app view of their own progress. Kills the "where are we on onboarding" email.
3. **Offboarding checklist** — the mirror of this. Revoking access is the step that never gets done, and stale agency access on a former client's accounts is a real liability.
4. **Renewal triggers** — the `Renewal Date` field is captured but nothing reads it yet. A 60-day-out task would close the loop.
5. **The five API request flows** — the biggest lift but the most setup. Google Ads and Meta first; between them they cover ad accounts, Pages, Instagram, pixels, and catalogs.

## New client: sources first, then the form

The **+ New client** button opens a two-step flow.

**Step 1 — sources.** Four optional boxes: sales call transcript, onboarding/kickoff transcript, scope of work, and the ClickUp onboarding form. Each takes pasted text, a ClickUp doc link, a Google Doc link, or an **uploaded file** — PDF, Word, or plain text. Scopes of work are almost always PDFs, which is why uploads exist. The whole step is skippable; not every client arrives with documents, and a flow you cannot skip is a flow people work around.

**Step 2 — review and create.** Anthropic reads whatever was supplied and returns a pre-filled form. Every extracted value carries the sentence it came from and a confidence chip, shown by default rather than behind a hover — the point is checking a number without going hunting for it.

Three things it produces beyond the fields:

- **Conflicts.** When the sales call and the scope of work disagree, both readings are shown with their quotes. The scope-of-work value is the one used: the contract governs, the sales call is what was hoped for.
- **Open questions.** Things the documents do not answer that must be resolved before launch. These are copied into Context notes so they reach the onboarding plan.
- **Pre-selected platforms**, constrained to the names on the `Platforms` tab so the task builder always recognises them.

It guesses wherever the evidence supports it and omits fields it cannot quote. **Check MRR and the dates before submitting.** A confident wrong number on a commercial term is the expensive failure here, which is why the quote sits under every one.

### ClickUp links

Reading a ClickUp doc needs an API token: **ClickUp → Settings → Apps → API Token**, then in the sheet **Onboarding → Set ClickUp API token**. It lives in Script Properties as `CLICKUP_API_TOKEN`, never in a cell and never in the repo.

Two kinds of ClickUp link are understood, behind two different APIs:

| Link | What it is | How it is read |
|---|---|---|
| `doc.clickup.com/{workspaceId}/d/h/{docId}/{pageId}` | a doc | **every page** in the doc, not just the linked one — transcripts get split across pages and grabbing only the deep-linked page silently truncates the input |
| `app.clickup.com/t/{teamId}/{taskId}` | a task, which is what a submitted **ClickUp Form** becomes | name, description, and every filled custom field rendered as question/answer |

The form case matters: a ClickUp Form writes its answers into **custom fields**, not the description. Reading only the description returns an apparently empty form. Dropdowns and label fields store option indexes and IDs rather than text, so those are resolved back to their labels — otherwise the model receives `Vertical: 2`.

Without a token, the step-1 screen says so up front. Pasted text and Google Doc links work regardless.

### Uploads

Anything that is not plain text is converted by Drive: the file is uploaded with a Google Doc mimeType, which makes Drive run its own conversion — including OCR on scanned PDFs — and `DocumentApp` reads the result. The temporary Doc is **trashed immediately**, including when the conversion fails, so reading a scope of work does not leave a copy lying in My Drive.

This needs the advanced Drive service, declared in `src/appsscript.json`. **Enabling it changes the manifest, so the first deploy after this will re-prompt for OAuth consent** — that is expected, not a fault.

Limit is 12 MB, enforced in the browser and again on the server. A PDF that is pure scanned images with no OCR layer converts to almost nothing; the extractor detects that and says so rather than returning a confidently empty form.

Picking a file disables that source's text box. The file wins — choosing one is the more deliberate act, and sending both would double the prompt for no gain.

### Cost and limits

Each analysis is one Anthropic call against the model named in `Config`. Transcripts over ~60k characters are trimmed head-and-tail before sending: openings carry the company and the ask, closings carry the commitments, the middle is usually rapport.

## The web app URL

The same two UIs are also served at a URL, so staff can use the tool without opening the spreadsheet.

```
<url>/exec              dashboard
<url>/exec?page=intake  new client intake
```

Nothing is duplicated — `doGet` in `WebApp.gs` hands back the same `Admin.html` and `Intake.html` the menu uses, and `google.script.run` behaves identically in a web app.

### Deploying it

In the script editor: **Deploy → New deployment → Web app**, then Deploy. The URL is shown on the confirmation screen. Afterwards, **Onboarding → Show web app URL** prints it any time.

**Every code change needs a new deployment version to reach that URL.** `clasp push` updates the code; it does not update a deployment. In the editor: **Deploy → Manage deployments → ✏️ edit → Version: New version → Deploy**. The sheet's menu picks up pushed code immediately, so the menu and the URL can run different versions — if a fix appears in the sheet but not at the URL, this is why.

### Who can reach it, and as whom

Set in `src/appsscript.json`:

```json
"webapp": { "executeAs": "USER_DEPLOYING", "access": "DOMAIN" }
```

- `access: DOMAIN` — anyone signed in on the Workspace domain. Use `MYSELF` while testing, `ANYONE` only with a real reason.
- `executeAs: USER_DEPLOYING` — the code runs as whoever deployed it, not as the visitor.

That second setting has teeth. Everyone using the URL is operating as the deploying account: reads and writes to the sheet happen with that account's permissions, **client access emails send from that account**, and they consume that account's Gmail quota (500/day Workspace, 100/day consumer). A colleague who opens the URL and clicks Send has sent mail as you.

The dashboard PIN is the only thing in front of that, and it is a convenience lock — it is not access control. If that trade isn't acceptable, switch `executeAs` to `USER_ACCESSING`, which makes each person act as themselves and requires them to have edit access to the sheet.

Changing either value requires a new deployment version. Editing the manifest alone does nothing.

### Bringing in clients you already have

**Clients → Import existing clients.** Paste from whatever spreadsheet the client list already lives in — headings on the first row, in any order.

`Company` is the only column that matters. `Contact`, `Email`, `Website`, `Owner`, `Services`, `MRR`, `Slack`, `Vertical`, `Business type`, `Contract start`, `Cadence` and `Term` are all read if present, and the heading names are matched loosely (`Owner`, `Account Manager` and `AM` are the same column). Anything it does not recognise is **named on screen** rather than dropped.

Read the paste first — it never writes — then check the preview. It shows what each row will become, refuses anything already in the tool, and flags a service that is not on the Services tab or an owner who is not on the Team tab. Those still import; they just tell you what to fix.

Imported clients land as **Live** with **no onboarding checklist**. They granted access months ago, and a checklist of access requests for a client of two years is noise. Everything else works on them immediately: audit action items, the ClickUp push, Slack, the profile, the call scan.

If you *do* want a checklist for one of them, press **Start onboarding** on that client. Due dates are anchored to today rather than to a contract start in the past, so it is not born overdue.

Two limits worth knowing: 300 rows per paste, and somebody who cannot see MRR imports everything except the money — a partner fills that in afterwards.

### Sending the checklist to ClickUp

**Send to ClickUp** on the client page creates one ClickUp task per checklist item — assigned to the same person, with the due date, and with why it matters in the description.

Pick a **workspace** and a **list** the first time; both are remembered against that client, so it is one press from then on. The list picker shows the space and folder above each list, because two lists called "Tasks" are otherwise the same word twice.

It sends the **audit follow-ups** by default. Tick *the whole checklist* to send the access-chasing rows too.

**Nothing is ever sent twice.** The created task's ID is written into the `ClickUp Task` column on the Access tab, and a row carrying one is skipped. So after rebuilding the action items, pressing the button again sends only the new ones. Clear that cell by hand to force a row to send again.

**Assignees are matched on email** — the owner's name on the checklist, to their row on the Team tab, to their ClickUp account. Anybody without an email on the Team tab, or not in that ClickUp workspace, is named on screen and their task goes over unassigned rather than being silently dropped.

Needs `CLICKUP_API_TOKEN` set (Onboarding → Set ClickUp API token), which is the same token the meeting-doc scan uses.

### The Slack app's scopes

`slackTest` reads the granted scopes off Slack's own response and names anything missing, so **Test connection** on any client page is the check. The tool wants:

`channels:manage` · `channels:join` · `groups:write` · `channels:read` · `groups:read` · `users:read` · `users:read.email` · `chat:write` · `bookmarks:write` · `bookmarks:read`

The two bookmark scopes are what put an **Onboarding** tab in a client's channel, beside Messages and Pins, that opens that client in this tool. Without `bookmarks:write` everything else still works and channels still link — the tab just does not appear, and the toast says so. Without `bookmarks:read` the tab is added but cannot be checked for first, so relinking a channel can leave two.

Ticking a scope does nothing until the app is **reinstalled** to the workspace. That is where this usually goes wrong.

Channels connected before the tab existed do not have one. **Add link to Slack** on the client's Slack card adds it — the card is hidden once a channel is set, so reach it through the `manage` link beside the channel name at the top of the client page.

The bot has to be in the channel to add a tab to it. For a private channel that means somebody inviting it: `/invite @your-bot`.

### Hiding what clients pay

MRR and the fee lines are hidden from everybody except the account that deployed the tool and anyone ticked **Sees finances** on the Team page.

How to set it up, once:

1. Re-run **Onboarding → Set up / repair sheet**. That adds the `Sees Finances` column to the Team tab (and the `Kind` column to the Actions tab, which the out-of-scope list needs).
2. Open **Team** in the web app. Every existing person is unticked, so at that moment nobody but you sees the numbers.
3. Edit each partner and tick **Sees finances**. The tick only appears for someone who already has it, so the first one has to be done by you.

What it covers: MRR and the fee lines on the client page, the fee table on the intake review screen and on any draft reopened later, and the scope confirmation — which restates the contract and cannot be drafted without printing the fee. Writes are refused as well as hidden, and nothing withheld is sent to the browser in the first place.

What it does not cover, and cannot:

- **The spreadsheet.** Anyone the Sheet is shared with reads MRR in column J, and can read around all of this from the script editor. The tool runs as the deploying account, so **nobody needs the Sheet to use it** — stopping sharing it is the part that actually closes this. The gate is what makes that practical rather than punitive.
- **Drive.** The signed scope of work states the fee on page four. Whoever can open the deal folder can read it there.

It relies on `executeAs: USER_DEPLOYING` plus `access: DOMAIN` — that pairing is what lets Google name the visitor without them needing the Sheet. Switching `access` to `ANYONE` breaks it: Google stops reporting who is looking, and everybody is then treated as unable to see the numbers.

A person who cannot see the fee can still do the intake. Their form comes back without it and the number is read off the draft when the client is created, so nothing is lost — it just never passes through their browser.

## Deploying code changes

Code lives in this repo. `clasp push` uploads it to the script bound to the sheet — there is never a reason to paste files into the browser editor.

**From your machine:**

```bash
npm run pull     # first, if anyone edited in the browser — see the warning below
npm run check    # parse, resolve google.script.run targets, verify column maps
npm run push     # runs check, then clasp push
```

**Automatically, on merge to `main`:** `.github/workflows/deploy.yml` runs the static checks on every pull request, and pushes to Apps Script when a commit lands on `main`. Merging a PR is the deploy.

### One-time CI setup

**One** repository secret, at **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `CLASPRC_JSON` | The entire contents of `~/.clasprc.json`, verbatim, after running `npx clasp login` locally |

It must be a **Secret**, not a Variable — those live on an adjacent tab of the same page and are invisible to `secrets.*`. Environment secrets and Codespaces/Dependabot secrets do not work here either. If the deploy log prints `CLASPRC_JSON:` followed by nothing, the secret does not exist; a secret that exists prints as `***`.

`~/.clasprc.json` holds an OAuth refresh token for your Google account. Treat it like a password: it is not in this repo, `.gitignore` excludes it, and the workflow writes it to the runner at `chmod 600`, then deletes it in an `always()` step. Anyone with admin access to this repo can use it to act on your Apps Script projects. Revoke it at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) if it ever leaks.

**The script ID is committed**, in `.clasp.json` at the repo root. That is deliberate. A script ID is an address, not a credential — holding it grants nothing, since reaching the script still requires Google permission on it. Committing it means one less secret to configure, and a fresh clone can `npm run push` with no setup. To point the repo at a different script, edit that file.

The workflow pins `@google/clasp@3.3.0` exactly, and the pin has to be **at least** the version used to produce the credential file. clasp changed its credential format across major versions:

| clasp | `~/.clasprc.json` shape |
|---|---|
| 3.x | `{"tokens": {"default": {…}}}` |
| 2.x | `{"token": {…}, "oauth2ClientSettings": {…}}` |
| 1.x | flat `{"access_token": …}` |

3.x reads all three; 2.x reads only its own. Since `npx clasp login` installs the latest, a 2.x pin in CI against a freshly generated file fails with `Cannot read properties of undefined (reading 'access_token')` — which looks like a broken token but is purely a version mismatch. The workflow now identifies the shape and prints it before pushing, so that failure names itself.

### The credential expires daily unless you change one Workspace setting

`invalid_grant … reauth related error (invalid_rapt)` is not a broken token and
not a clasp bug. It is Google Workspace's **Google Cloud session control**
reaching the end of its session and demanding the human re-authenticate. The
default is 16 hours, which is why a CI credential that worked yesterday fails
this morning, every morning.

The refresh token in `~/.clasprc.json` is fine — the policy is simply refusing
to honour it without a fresh human login, and a GitHub runner has no human.

**Fix it in the Admin console:**

Security → Access and data control → **Google Cloud session control** →
set **Session never expires**.

(Google moves this around; on older consoles it sits directly under Security.
The error's own link — `support.google.com/a/answer/9368756` — always lands on
the right page.)

It governs OAuth tokens carrying Google Cloud and Apps Script API scopes, which
is exactly what clasp holds. Nothing else about the setup changes.

**If you would rather not relax it for everyone**, the setting applies per
organisational unit. Put a dedicated deploy account in its own OU, give that
account edit access to the script, generate `CLASPRC_JSON` as them, and leave
everybody else on the shorter session. That is the better shape anyway: the
credential in CI then belongs to a machine identity rather than to a founder's
personal account, and revoking it costs nobody their morning.

Until one of those is done, a failed deploy needs no re-merge — the workflow
has a `workflow_dispatch` trigger, so refresh the secret and press **Run
workflow**.

### Three things to know before you turn it on

1. **`clasp push --force` overwrites the remote unconditionally.** The `--force` flag is there because a non-interactive runner would otherwise hang on the manifest-change prompt. The consequence: if someone edits in the browser and a deploy runs afterwards, their edits are gone with no warning and no undo. Either treat the browser editor as read-only, or `npm run pull` and commit before merging anything.

2. **A deploy reaches people mid-task.** The tool is a live sheet your team uses during the day. There is no staging copy, and `check` cannot catch a behavioural break — it only parses and cross-references. Prefer merging when nobody is mid-onboarding.

3. **A deploy pushes code, not configuration.** The `Config` tab, the seeded `Platforms` / `Phases` / `Templates` rows, and anything `setup()` writes are untouched. That is deliberate — the seeds bail when data exists so they never clobber your edits — but it also means a seed change in code does not reach an existing sheet. Clear the tab first, or start from a fresh spreadsheet.

If you would rather approve each deploy by hand, add an [environment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment) with a required reviewer and set `environment:` on the `deploy` job.

## Adjusting

- **Add a task:** row on `Platforms`. Add a matching `Templates` row only if it's client-facing.
- **Change email copy:** edit `Templates` in the sheet — `getTemplate_()` reads the sheet first, code second.
- **Change plan structure:** `buildPrompt_()` in `PlanGen.gs`; `writePlanDoc_()` must match.
- **Model:** the `Model` row in `Config`. Verify the string is current — a bad one fails with a 404 surfaced in the sidebar.

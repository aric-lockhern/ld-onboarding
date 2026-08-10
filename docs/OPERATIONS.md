# Lockhern Onboarding CRM

Intake, AI onboarding plan, instruction emails, Drive structure, due dates, and a daily overdue digest — on Apps Script + Sheets.

## Install

1. New Google Sheet → **Extensions → Apps Script**. Names must match exactly.

   | File | Type |
   |---|---|
   | `Code.gs` | script |
   | `PlanGen.gs` | script |
   | `Templates.gs` | script |
   | `Admin.gs` | script |
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

## Adjusting

- **Add a task:** row on `Platforms`. Add a matching `Templates` row only if it's client-facing.
- **Change email copy:** edit `Templates` in the sheet — `getTemplate_()` reads the sheet first, code second.
- **Change plan structure:** `buildPrompt_()` in `PlanGen.gs`; `writePlanDoc_()` must match.
- **Model:** the `Model` row in `Config`. Verify the string is current — a bad one fails with a 404 surfaced in the sidebar.

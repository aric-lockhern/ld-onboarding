# Lockhern Onboarding CRM

Client onboarding for a paid-search agency, running on Google Apps Script with a Sheet as the database.

Phased onboarding with gates, AI-generated onboarding plans from sales transcripts and contracts, templated access-request emails across 17 platforms, preview-then-send, and a daily overdue digest.

## First-time setup

You need Node 18+ and a Google account.

```bash
git clone <your-repo-url>
cd lockhern-onboarding
npm install
npx clasp login
```

### Bind to a spreadsheet

`.clasp.json` is committed and already points at the live script, so a fresh clone needs no binding step.

**To point at a different sheet:** open it, **Extensions → Apps Script** (this creates the bound script project if it doesn't exist), copy the script ID from that editor's URL, and paste it into `.clasp.json`. The script ID is *not* the ID in the spreadsheet URL — they're different objects.

**For a brand-new sheet instead:**

```bash
npx clasp create --type sheets --title "Lockhern Onboarding" --rootDir src
```

This overwrites `.clasp.json` and creates the sheet.

### Push and initialise

```bash
npm run push
npx clasp open
```

In the script editor, run `setup()` once and approve the OAuth scopes. Then reload the sheet and use the **Onboarding** menu:

1. **Set Anthropic API key** — stored in Script Properties, never in the sheet or the repo
2. **Set dashboard PIN**
3. **Enable daily digest**

Then fill in the **Config** tab. Do this before anyone else touches the tool — an empty MCC ID or Business Manager ID is the single most likely thing to block a send on day one.

## Working on it

```bash
npm run check    # syntax + cross-reference validation
npm run push     # runs check, then clasp push
npm run pull     # pull browser edits (overwrites src/)
npm run open     # open the script editor
```

`npm run check` is the only automated verification available — Apps Script has no local runtime. It parses every file, resolves every `google.script.run` target to a real server function, rejects targets ending in `_` (Apps Script won't expose those), and verifies the column maps match the `setup()` headers.

That last check has already caught one live bug. Run it before pushing.

If someone edited in the browser, `npm run pull` first — `clasp push` overwrites remote without asking.

## Deploying

Merging to `main` deploys. `.github/workflows/deploy.yml` runs the static checks on every pull request and pushes to Apps Script when a commit lands on `main`.

It needs one repository secret — `CLASPRC_JSON`, the contents of your local `~/.clasprc.json` after `npx clasp login`. The script ID isn't a secret and is committed in `.clasp.json`. Setup, the credential-handling details, and three things worth understanding before enabling it are in [`docs/OPERATIONS.md`](docs/OPERATIONS.md#deploying-code-changes). The short version: the push force-overwrites the remote, it lands on a sheet people are actively using, and it deploys code but never configuration.

There is no web host involved anywhere. Apps Script runs inside Google, and the dashboard and intake UI are served by `HtmlService` from within the bound sheet — they are not static pages and will not work anywhere else.

## Layout

| Path | What it is |
|---|---|
| `src/Code.gs` | `setup()`, menu, column maps, intake, task board, Drive folders |
| `src/Phases.gs` | Phase state and gate evaluation |
| `src/Send.gs` | Preview, send, queue, preflight |
| `src/Templates.gs` | Email copy, merge tags, composer |
| `src/PlanGen.gs` | Anthropic call, prompt, plan Doc |
| `src/Admin.gs` | PIN gate, dashboard reads, field writes |
| `src/Digest.gs` | Daily overdue email |
| `src/Intake.html` | Intake sidebar |
| `src/Admin.html` | Dashboard modal |
| `design/mockup.html` | Standalone UI reference with fake data — open it in a browser, PIN `1234` |

## Sheet tabs

| Tab | Purpose |
|---|---|
| `Clients` | Master record — scope, cadence, Slack, alias, Drive, billing, renewal |
| `Intake` | Raw transcript / contract / notes |
| `Access` | One row per client × task, with phase, gate, due date, owner |
| `Plans` | Generated plans as JSON + Doc link |
| `Platforms` | Task catalogue — method, phase, gate, due offset, default owner |
| `Phases` | Phase names, meanings, and which template each sends |
| `Templates` | Email copy. Sheet edits override the code. |
| `Config` | Agency settings, Drive root, digest recipients, account IDs |
| `Sent Log` | Every send, with sender |

## Phases

| Phase | Gates | Why |
|---|---|---|
| 1 Internal Setup | Alias, Drive folder | The client email *contains* the alias and points at the folder |
| 2 Client Requests | Core access, media billing | Can't audit without access; a failed card pauses campaigns |
| 3 Data & Validation | Baseline snapshot, tracking validated | Baseline is unrecoverable once you optimise |
| 4 Launch | Kickoff call | — |
| 5 Steady State | none | First report and 30-day check trail naturally |

Phase and Gate are columns on `Platforms`. Nothing is hardcoded.

## Security

- Secrets live in `PropertiesService` Script Properties: `ANTHROPIC_API_KEY`, `DASH_PIN_HASH`. Neither is in this repo, and `.clasp.json` / `.clasprc.json` are gitignored — `.clasprc.json` holds your Google OAuth token, so never commit it.
- The dashboard PIN is a convenience lock, not access control. Anyone with edit access to the Sheet can read around it through the script editor. Sheet sharing permissions are the real boundary.
- No credentials are stored in the Drive folder structure, deliberately. Shared logins belong in a password manager.
- Gmail caps sending at 500/day on Workspace, 100/day on consumer accounts.

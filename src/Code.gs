/**
 * LOCKHERN ONBOARDING CRM — Core
 *
 * Setup: run setup() once from the Apps Script editor.
 */

const TABS = {
  CLIENTS: 'Clients',
  SERVICES: 'Services',
  INTAKE: 'Intake',
  ACCESS: 'Access',
  PLANS: 'Plans',
  PLATFORMS: 'Platforms',
  TEMPLATES: 'Templates',
  PHASES: 'Phases',
  DRAFTS: 'Drafts',
  TEAM: 'Team',
  ACTIONS: 'Actions',
  CONFIG: 'Config'
};

/** Shared so Drafts.gs can repair the tab on a sheet that predates drafts. */
const DRAFT_HEADERS = [
  'Draft ID', 'Name', 'Created', 'Updated', 'Status', 'Client ID',
  'Folder ID', 'Sources', 'Extraction', 'Form'
];

/**
 * Who works here, and what they are good at.
 *
 * Owner was free text, which made it useless for anything but reading — you
 * cannot notify "Drake", assign by skill, or add someone to a Slack channel
 * from a string someone typed. Skills is a comma list matched loosely against
 * services and platforms, so audit work can land on whoever actually does it.
 *
 * Slack ID is the member ID (U01ABC…), not the handle: handles change, IDs do
 * not, and the API wants the ID anyway.
 */
const TEAM_HEADERS = ['Name', 'Email', 'Slack Member ID', 'Skills', 'Role', 'Active'];

/**
 * Work the audit says to do, as opposed to access we need before we can start.
 *
 * Deliberately not the Access tab. That one is the onboarding checklist — it
 * has phases, gates, due dates driven off the contract start, and it closes
 * once the client is live. Audit findings are account work with their own
 * priority and lifecycle, and folding them in would gate onboarding on a
 * negative-keyword sweep.
 */
const ACTION_HEADERS = [
  'Client ID', 'Action', 'Why it matters', 'Source', 'Priority',
  'Effort', 'Owner', 'Status', 'Created'
];

const ACT = {
  CLIENT: 1, ACTION: 2, WHY: 3, SOURCE: 4, PRIORITY: 5,
  EFFORT: 6, OWNER: 7, STATUS: 8, CREATED: 9, WIDTH: 9
};

const ACTION_STATUSES = ['To do', 'In progress', 'Done', 'Not doing'];
const ACTION_PRIORITIES = ['Now', 'Next', 'Later'];

const STATUSES = ['Not started', 'Info needed', 'Requested', 'Complete', 'Blocked', 'N/A'];
const CADENCES = ['Weekly', 'Biweekly', 'Monthly', 'Quarterly', 'Ad hoc'];
/**
 * What we sell. Distinct from Platforms, which is what we need ACCESS to —
 * one service usually implies several platforms, and some platforms (GA4,
 * Tag Manager) are needed no matter what was sold. The mapping lives on the
 * Services tab so it can be changed without a deploy.
 */
const SERVICES = ['Google Ads', 'Microsoft Ads', 'Meta Ads', 'Meta Organic Social',
  'Reddit Ads', 'Reddit Organic Social', 'AI Search SEO',
  'Google Business Profile', 'Landing Page', 'Web Design'];

/**
 * The Services tab as first written. Shared by seedServices_ (fresh sheet) and
 * repairServices_ (append what is missing), so a service added in code reaches
 * an existing sheet on the next setup() instead of only new ones.
 *
 * Keep in step with SERVICES above — npm run check enforces it.
 */
const SERVICE_SEED = [
  // service, category, platforms needed, default fee, active
  // The bracket means "only for this business type". Shopping and PMax need a
  // Merchant Center; a lead-gen advertiser has no feed and no use for one, and
  // asking for it anyway is how a Merchant Center request lands in a plumber's
  // access email.
  ['Google Ads', 'Paid',
    'Google Ads, Google Analytics (GA4), Google Tag Manager, '
    + 'Google Merchant Center [eCommerce]', 6000, true],
  ['Microsoft Ads', 'Paid', 'Microsoft Ads', 1500, true],
  ['Meta Ads', 'Paid',
    'Meta Ads, Meta / Instagram Organic, Google Analytics (GA4)', 3000, true],
  // Organic social is sold separately from paid on the same platform. Running a
  // page and buying inventory on it are different products with different
  // deliverables and different access — a scope that sells one has not bought
  // the other, and conflating them puts an ad-account request in front of a
  // client who only wants their posts scheduled.
  ['Meta Organic Social', 'Organic', 'Meta / Instagram Organic', 2000, true],
  ['Reddit Ads', 'Paid', 'Reddit Ads, Reddit Organic', 2000, true],
  ['Reddit Organic Social', 'Organic', 'Reddit Organic', 2000, true],
  ['AI Search SEO', 'Organic',
    'Google Search Console, Google Analytics (GA4), WordPress', 2000, true],
  ['Google Business Profile', 'Local', 'Google Business Profile', 750, true],
  ['Landing Page', 'Build', 'WordPress, Google Tag Manager', 1500, true],
  ['Web Design', 'Build', 'WordPress', 2500, true]
];

const TERMS = ['Month to month', '3 months', '6 months', '12 months', 'Custom'];
const BIZ_TYPES = ['Lead Gen', 'eCommerce'];

/**
 * Platforms that follow from the kind of business, whatever was sold.
 *
 * An eCommerce client is running Shopping or PMax sooner or later, and both
 * need a Merchant Center. Waiting for a document to name it means discovering
 * at build time that nobody asked for it.
 *
 * This lives in code and NOT on a tab on purpose. Seeds bail once a tab has
 * rows, so a rule expressed in seed data cannot reach a sheet that already
 * exists — which is exactly how the first attempt at this failed: the
 * qualifier was added to the Google Ads seed row, and every installed sheet
 * already had its own Google Ads row without it.
 *
 * It pre-ticks a box on a review screen. Untick it if a client genuinely has
 * no feed.
 */
const BIZ_TYPE_PLATFORMS = {
  'ecommerce': ['Google Merchant Center']
};

function bizTypePlatforms_(bizType) {
  return BIZ_TYPE_PLATFORMS[String(bizType || '').toLowerCase()] || [];
}

const INK = '#14181D';

// Clients column map (1-based) — single source of truth for index changes.
const C = {
  ID: 1, COMPANY: 2, CONTACT: 3, EMAIL: 4, WEBSITE: 5, VERTICAL: 6, STATUS: 7,
  PLATFORMS: 8, START: 9, MRR: 10, OWNER: 11, SCOPE: 12, CADENCE: 13, SLACK: 14,
  ALIAS: 15, DRIVE: 16, SERVICES: 17, APPROVALS: 18, TERM: 19, CALL: 20,
  BIZTYPE: 21, FEES: 22, ONBOARDING: 23,
  PROGRESS: 24, PLAN_STATUS: 25, PLAN_DOC: 26, CREATED: 27, PROFILE: 28,
  RECENT: 29, WIDTH: 29
};

/**
 * Access column map (1-based).
 *
 * ASSIGNED is when the task last changed hands, not when it was created. Due
 * dates come off the contract start and say nothing about whether anyone has
 * picked the work up — a task can sit unassigned for a fortnight and still not
 * be late. "Assigned 9 days ago and still Not started" is the sentence that
 * needs saying, and only this column can say it.
 */
const A = {
  ID: 1, COMPANY: 2, TASK: 3, CATEGORY: 4, METHOD: 5, NEEDS: 6, ACCOUNT: 7,
  STATUS: 8, DUE: 9, REQUESTED: 10, COMPLETED: 11, OWNER: 12, NOTES: 13,
  PHASE: 14, GATE: 15, ASSIGNED: 16, WIDTH: 16
};

/**
 * The task library — one row per thing that can end up on a checklist.
 *
 * This used to be read by raw index in three places, on the grounds that it is
 * config rather than records. That was defensible while nothing wrote to it.
 * There is now a settings screen that edits every column, so it gets a map like
 * the other tabs: a thirteenth column added by hand is exactly the change that
 * silently shifts r[8] and moves every task to the wrong phase.
 */
const PLATFORM_HEADERS = [
  'Task', 'Category', 'Method', 'Client Info Needed', 'How Access Is Granted',
  'Typical Lead Time', 'Due Offset (days)', 'Default Owner', 'Phase', 'Gate',
  'Always Include', 'Active', 'Business Type', 'Requires'
];

/**
 * Work that only exists because access landed.
 *
 * A task is normally included because its name IS a platform the client
 * bought. That cannot express "once we have Google Ads, label the account
 * Active in the manager" — the work is real, it is ours rather than the
 * client's, and it applies to exactly the clients who have Google Ads.
 *
 * Requires names another task. The row is included when that one is, and left
 * out otherwise. Without it the only options were Always Include, which puts a
 * Google Ads chore on a client who never bought Google Ads, or nothing, which
 * is where these steps have lived until now: in somebody's head.
 */
function templateRequired_(row, platforms) {
  const needs = String(row[P.REQUIRES - 1] || '').trim();
  if (!needs) return false;
  return platforms.indexOf(needs) !== -1;
}

const P = {
  TASK: 1, CATEGORY: 2, METHOD: 3, NEEDS: 4, HOW: 5, LEAD: 6, OFFSET: 7,
  OWNER: 8, PHASE: 9, GATE: 10, ALWAYS: 11, ACTIVE: 12, BIZTYPE: 13,
  REQUIRES: 14, WIDTH: 14
};

/**
 * Whether a task template applies to this kind of business.
 *
 * Blank means every client, which is what every existing row will be — a new
 * column on a populated tab reads as empty, and empty has to mean "as before"
 * or re-running setup() would quietly drop tasks off every checklist.
 */
function templateApplies_(rowBizType, clientBizType) {
  const want = String(rowBizType || '').trim().toLowerCase();
  if (!want || want === 'any') return true;
  return want === String(clientBizType || '').trim().toLowerCase();
}

// ---------------------------------------------------------------- MENU

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Onboarding')
    .addItem('New client intake', 'showIntakeSidebar')
    .addItem('Dashboard', 'showAdminDashboard')
    .addSeparator()
    .addItem('Generate onboarding plan (selected row)', 'generatePlanForActiveRow')
    .addItem('Build task checklist (selected row)', 'buildAccessForActiveRow')
    .addItem('Preview & send email (selected row)', 'sendAccessEmailForActiveRow')
    .addItem('Create Drive folder (selected row)', 'createDriveFolderForActiveRow')
    .addSeparator()
    .addItem('Show web app URL', 'showWebAppUrl')
    .addSeparator()
    .addItem('Send digest now', 'sendDigestNow')
    .addItem('Enable daily digest', 'installDigestTrigger')
    .addItem('Scan ClickUp for calls now', 'scanRecentCallsNow')
    .addItem('Enable daily call scan', 'installCallScanTrigger')
    .addSeparator()
    .addItem('Set Anthropic API key', 'promptForApiKey')
    .addItem('Set ClickUp API token', 'promptForClickUpToken')
    .addItem('Set Slack bot token', 'promptForSlackToken')
    .addItem('Set dashboard PIN', 'promptForPin')
    .addItem('Remove dashboard PIN', 'removePin')
    .addItem('Re-run setup / repair tabs', 'setup')
    .addToUi();
}

// ---------------------------------------------------------------- SETUP

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  mkTab_(ss, TABS.CLIENTS, [
    'Client ID', 'Company', 'Primary Contact', 'Contact Email', 'Website',
    'Vertical', 'Status', 'Platforms', 'Contract Start', 'MRR',
    'Onboarding Owner', 'Scope', 'Meeting Cadence', 'Slack Channel', 'Email Alias',
    'Drive Folder', 'Services', 'Approvals Contact', 'Contract Term',
    'Onboarding Call', 'Business Type', 'Fees', 'Onboarding',
    'Progress', 'Plan Status', 'Plan Doc', 'Created', 'Profile', 'Recent'
  ]);

  mkTab_(ss, TABS.INTAKE, [
    'Client ID', 'Company', 'Sales Transcript', 'Contract Text',
    'Context Notes', 'Source Docs', 'Captured'
  ]);

  mkTab_(ss, TABS.ACCESS, [
    'Client ID', 'Company', 'Task', 'Category', 'Method', 'Client Info Needed',
    'Account ID', 'Status', 'Due', 'Requested', 'Completed', 'Owner', 'Notes',
    'Phase', 'Gate', 'Assigned'
  ]);

  mkTab_(ss, TABS.PLANS, [
    'Client ID', 'Company', 'Generated', 'Model', 'Plan Doc', 'Plan JSON'
  ]);

  mkTab_(ss, TABS.PLATFORMS, PLATFORM_HEADERS);

  mkTab_(ss, TABS.SERVICES, [
    'Service', 'Category', 'Platforms Needed', 'Default Monthly Fee', 'Active'
  ]);

  mkTab_(ss, TABS.PHASES, ['Phase', 'Name', 'Client Email', 'What it means']);

  mkTab_(ss, TABS.TEMPLATES, ['Task', 'Subject', 'Body']);

  mkTab_(ss, TABS.DRAFTS, DRAFT_HEADERS);

  mkTab_(ss, TABS.TEAM, TEAM_HEADERS);

  mkTab_(ss, TABS.ACTIONS, ACTION_HEADERS);

  seedPlatforms_(ss);
  repairTaskLibrary_(ss);
  repairConfig_(ss);
  repairTaskPhases_(ss);
  seedServices_(ss);
  repairServices_(ss);
  seedPhases_(ss);
  seedTemplates_(ss);
  seedConfig_(ss);
  // Before applyValidation_, not after: the repair deletes rows, and validation
  // applied first would be applied to rows that are about to go.
  repairClientRows_(ss);
  applyValidation_(ss);

  SpreadsheetApp.getUi().alert('Setup complete. Reload the sheet to load the Onboarding menu.');
}

function mkTab_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setFontFamily('Roboto Mono').setFontSize(9)
    .setBackground(INK).setFontColor('#FFFFFF').setVerticalAlignment('middle');
  sh.setRowHeight(1, 32);
  sh.setFrozenRows(1);
  if (sh.getMaxColumns() > headers.length) {
    sh.deleteColumns(headers.length + 1, sh.getMaxColumns() - headers.length);
  }
  return sh;
}

/**
 * Reference table. `Method` is the switchboard:
 *   API / SEMI-API — a programmatic request flow exists
 *   EMAIL          — client grants or supplies something, we send instructions
 *   INTERNAL       — our own work, no client action
 *
 * `Due Offset` is days from contract start (falls back to intake date).
 * `Default Owner` overrides the client's onboarding owner for that one task —
 * this is how the 30-day check-in lands on a partner rather than the pod.
 */
/**
 * The task library as first written.
 *
 * Hoisted out of seedPlatforms_ for the same reason SERVICE_SEED was: seeds
 * bail once the tab has rows, so a task added in code could never reach an
 * installed sheet. repairTaskLibrary_ appends what is missing by name.
 */
const PLATFORM_SEED = [
    // task, category, method, needs, how, lead, offset, owner, PHASE, GATE,
    // always, active, bizType, requires

    // Phase 1 — internal setup. Alias and Drive gate everything client-facing.
    ['Lockhern email alias', 'Internal', 'INTERNAL', '—',
      'Create the alias first; every platform grant goes to it', 'Same day', 0, '', 1, true, true, true],
    ['Google Drive folder', 'Internal', 'INTERNAL', '—',
      'Client folder with contract, recordings, reports, creative subfolders',
      'Same day', 0, '', 1, true, true, true],
    ['ClickUp space', 'Internal', 'INTERNAL', '—',
      'Create client space from the onboarding template', 'Same day', 1, '', 1, false, true, true],
    ['Client Slack channel', 'Internal', 'INTERNAL', 'Client Slack workspace email',
      'Slack Connect channel, invite client contacts and the pod', '1-2 days', 2, '', 1, false, true, true],
    // Both calls are Phase 1: getting them in the diary is internal setup, and
    // waiting until launch to book a kickoff is how a kickoff ends up three
    // weeks after the contract started.
    //
    // Neither is a gate, deliberately. Phase 1 has to close for the Phase 2
    // access email to send, so a gated call would hold every access request
    // until the meeting happened — which is the wrong way round: the point of
    // the kickoff is to have the accounts by then.
    ['Kickoff call', 'Internal', 'INTERNAL', 'Attendee emails',
      'Agenda comes from the plan open questions', '1 week', 3, '', 1, false, true, true],
    ['Weekly onboarding call', 'Internal', 'INTERNAL', 'Attendee emails',
      'Recurring invite for the onboarding window', 'Same day', 3, '', 1, false, true, true],

    // Phase 2 — everything we need from the client, in one email
    ['Google Ads', 'Paid', 'API', 'Customer ID (xxx-xxx-xxxx)',
      'MCC sends CustomerClientLink invite; client accepts', '1-2 days', 3, '', 2, true, false, true],
    ['Microsoft Ads', 'Paid', 'API', 'Account ID or Customer ID',
      'AddClientLinks; client accepts', '1-3 days', 5, '', 2, true, false, true],
    ['Meta Ads', 'Paid', 'API', 'Business Manager ID + Ad Account ID',
      'BM partner request via client_ad_accounts', '1-3 days', 3, '', 2, true, false, true],
    ['Meta / Instagram Organic', 'Organic', 'API', 'Page ID or URL, IG handle',
      'BM partner request via client_pages; IG follows the Page', '1-3 days', 5, '', 2, false, false, true],
    ['Google Merchant Center', 'Feed', 'API', 'Merchant ID',
      'accounts.link request from agency MCA', '1-2 days', 3, '', 2, true, false, true],
    ['Shopify', 'Platform', 'SEMI-API', 'Store URL + collaborator request code',
      'Collaborator request from Partner account', '1-3 days', 3, '', 2, true, false, true],
    ['Google Analytics (GA4)', 'Measurement', 'EMAIL', 'Property ID',
      'Client adds agency alias as Administrator', '1-2 days', 3, '', 2, true, false, true],
    ['Google Tag Manager', 'Measurement', 'EMAIL', 'Container ID (GTM-XXXXXX)',
      'Client adds agency alias with Publish rights', '1-2 days', 3, '', 2, true, false, true],
    ['Google Search Console', 'Organic', 'EMAIL', 'Verified property URL',
      'Client adds agency alias as Full user', '1-2 days', 5, '', 2, false, false, true],
    ['Google Business Profile', 'Local', 'EMAIL', 'Business name + location count',
      'Client invites agency as Manager', '2-5 days', 7, '', 2, false, false, true],
    ['Reddit Ads', 'Paid', 'EMAIL', 'Business email on the ad account',
      'Client invites agency user in Reddit Ads UI', '2-5 days', 7, '', 2, false, false, true],
    ['Reddit Organic', 'Organic', 'EMAIL', 'Subreddit or brand account',
      'Moderator invite, or credentials via password manager', '2-5 days', 7, '', 2, false, false, true],
    ['WordPress', 'Platform', 'EMAIL', 'Admin URL',
      'Client creates Administrator user for agency alias', '1-3 days', 5, '', 2, false, false, true],
    ['Klaviyo', 'Email', 'EMAIL', 'Account name',
      'Client invites agency alias as Manager', '1-2 days', 7, '', 2, false, false, true],
    ['TikTok Ads', 'Paid', 'EMAIL', 'Advertiser ID',
      'Business Center partner request or user invite', '1-3 days', 7, '', 2, false, false, true],
    ['Media billing setup', 'Commercial', 'EMAIL', 'Payment method on each ad account',
      'Confirm who funds media spend and that a valid card is attached',
      '1-3 days', 5, '', 2, true, true, true],
    ['Brand assets and constraints', 'Creative', 'EMAIL',
      'Logos, fonts, guidelines, imagery, restricted terms, competitors',
      'Client uploads to the shared Drive folder', '3-7 days', 7, '', 2, false, true, true],

    // Phase 3 — capture and verify before anything moves
    ['Baseline performance snapshot', 'Internal', 'INTERNAL', '—',
      'Export 12 months of pre-engagement performance before touching anything. '
      + 'This is the only proof of lift you will ever have.', '1 day', 10, '', 3, true, true, true],
    ['Historical data export', 'Internal', 'INTERNAL', '—',
      'Pull raw history while access is fresh — search terms, creative, audiences, feeds',
      '2 days', 12, '', 3, false, true, true],
    ['Conversion tracking validated', 'Internal', 'INTERNAL', '—',
      'Access is not measurement. Fire a test conversion and confirm it lands in '
      + 'every platform before spend moves.', '2 days', 14, '', 3, true, true, true],

    // Phase 5 — steady state
    ['First report delivered', 'Internal', 'INTERNAL', '—',
      'Sets the reporting rhythm. A late first report resets expectations badly.',
      '1 day', 35, '', 5, false, true, true],
    ['30-day client check-in', 'Internal', 'INTERNAL', '—',
      'Partner-level call, separate from the pod. Are we delivering what was sold?',
      '30 min', 30, 'Justin', 5, false, true, true],

  // Follow-on work, included only when the platform it depends on is.
  // The label is what the manager account's saved views and reporting filter
  // on, so an account without it is invisible to everything downstream — and
  // nobody notices for a month, because the campaigns themselves run fine.
  ['Label the Google Ads account Active', 'Paid', 'INTERNAL',
    '—',
    'In the manager account: Accounts → select the account → Labels → apply '
    + '"Active". Account level, not campaign level.',
    'Same day', 6, '', 2, false, false, true, '', 'Google Ads']
];

function seedPlatforms_(ss) {
  const sh = ss.getSheetByName(TABS.PLATFORMS);
  if (sh.getLastRow() > 1) return;

  const rows = PLATFORM_SEED.map(r => {
    const row = r.slice();
    while (row.length < P.WIDTH) row.push('');
    return row;
  });

  sh.getRange(2, 1, rows.length, P.WIDTH).setValues(rows);
  sh.getRange(2, 1, rows.length, P.WIDTH)
    .setVerticalAlignment('top').setWrap(true).setFontSize(10);
  sh.setColumnWidths(1, 3, 150);
  sh.setColumnWidth(4, 200);
  sh.setColumnWidth(5, 320);
}

/**
 * What we sell, and the access each one implies.
 *
 * Platforms Needed is a comma list of Platforms-tab task names. Selecting a
 * service ticks these automatically; anything marked Always Include on the
 * Platforms tab arrives regardless, which is why measurement is not repeated
 * against every row here.
 *
 * Default Monthly Fee seeds the fee table on intake. It is a starting point,
 * not a price list — the contract wins, and every line stays editable.
 */
/**
 * Appends services that exist in code but not on the tab.
 *
 * seedServices_ bails when row 2 is populated, which protects edits but means a
 * sheet installed before a service existed never gets it — and the tab is what
 * the UI renders, so the model can return a service with no checkbox to land in
 * and the answer vanishes. That is how "Reddit Organic Social" came back from a
 * scope of work, priced at 2000 on the fee table, and showed up nowhere.
 *
 * Append-only: an existing row is never touched, and a service deliberately
 * deleted from the tab stays deleted only until the next setup(). If you do not
 * sell something, set Active to FALSE rather than removing the row.
 */
/**
 * Corrections to seeded task rows that have to reach a sheet already in use.
 *
 * Seeds bail once a tab has rows, so moving a task between phases in
 * PLATFORM_SEED changes nothing for anyone who has already installed. The list
 * below is applied on every setup() instead — by task name, so it survives
 * rows having been reordered.
 *
 * Deliberately narrow: only the fields named here are written, and only for
 * these tasks. It is a migration, not a reset — everything else on the row,
 * including anything edited by hand, is left exactly as it is.
 */
const TASK_PHASE_FIXES = [
  // Booking both calls belongs in internal setup. Waiting until launch to
  // arrange a kickoff is how the kickoff lands three weeks after the contract
  // started. Neither is a gate: Phase 1 must close for the Phase 2 access
  // email to send, so a gated call would hold every access request until the
  // meeting happened — and the point of the kickoff is to have the accounts
  // by then.
  { task: 'Kickoff call', phase: 1, gate: false, offset: 3 },
  { task: 'Weekly onboarding call', phase: 1, gate: false, offset: 3 }
];

function repairTaskPhases_(ss) {
  const sh = ss.getSheetByName(TABS.PLATFORMS);
  if (!sh || sh.getLastRow() < 2) return 0;

  const names = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  let fixed = 0;

  TASK_PHASE_FIXES.forEach(fix => {
    for (let i = 0; i < names.length; i++) {
      if (String(names[i][0]).trim() !== fix.task) continue;
      const row = i + 2;
      sh.getRange(row, P.OFFSET).setValue(fix.offset);
      sh.getRange(row, P.PHASE).setValue(fix.phase);
      sh.getRange(row, P.GATE).setValue(fix.gate);
      fixed++;
      break;
    }
  });
  return fixed;
}

/**
 * Fills in Config values that are known and still blank.
 *
 * seedConfig_ bails once the tab has rows, so a default added in code after
 * installation can never reach a sheet in use — the same trap as the services
 * and the phases. This writes only where the cell is EMPTY, so anything
 * anybody has typed is left exactly as it is.
 *
 * Deliberately narrow. These two are merged into copy that goes to clients,
 * and both read as broken when unset: "[access email]" and "[Business Manager
 * ID]" have both been sent to a client at least once.
 */
const CONFIG_DEFAULTS = [
  ['Agency Access Email', 'marketing@lockherndigital.com'],
  ['Meta Business Manager ID', '1255155904831766']
];

function repairConfig_(ss) {
  const sh = ss.getSheetByName(TABS.CONFIG);
  if (!sh || sh.getLastRow() < 2) return 0;

  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  let filled = 0;

  CONFIG_DEFAULTS.forEach(d => {
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).trim() !== d[0]) continue;
      if (String(rows[i][1]).trim()) return;      // somebody set it — leave it
      sh.getRange(i + 2, 2).setValue(d[1]);
      filled++;
      return;
    }
  });
  return filled;
}

/**
 * Appends task templates the sheet does not have yet.
 *
 * Append-only and matched on name, so anything edited by hand survives and a
 * task deliberately deleted stays deleted only until the next setup() — which
 * is the same trade repairServices_ makes. Deactivate rather than delete if you
 * want one gone for good.
 */
function repairTaskLibrary_(ss) {
  const sh = ss.getSheetByName(TABS.PLATFORMS);
  if (!sh || sh.getLastRow() < 2) return 0;

  const have = {};
  sh.getRange(2, P.TASK, sh.getLastRow() - 1, 1).getValues()
    .forEach(r => { if (r[0]) have[String(r[0]).trim().toLowerCase()] = true; });

  const missing = PLATFORM_SEED
    .filter(r => !have[String(r[0]).trim().toLowerCase()])
    .map(r => {
      const row = r.slice();
      while (row.length < P.WIDTH) row.push('');
      return row;
    });

  if (!missing.length) return 0;
  sh.getRange(sh.getLastRow() + 1, 1, missing.length, P.WIDTH).setValues(missing);
  return missing.length;
}

function repairServices_(ss) {
  const sh = ss.getSheetByName(TABS.SERVICES);
  if (!sh) return;

  const have = sh.getLastRow() < 2 ? []
    : sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
        .map(r => String(r[0]).trim()).filter(Boolean);

  const missing = SERVICE_SEED.filter(r => have.indexOf(r[0]) === -1);
  if (!missing.length) return;

  sh.getRange(sh.getLastRow() + 1, 1, missing.length, missing[0].length)
    .setValues(missing)
    .setVerticalAlignment('top').setWrap(true).setFontSize(10);
}

function seedServices_(ss) {
  const sh = ss.getSheetByName(TABS.SERVICES);
  if (sh.getLastRow() > 1) return;

  const rows = SERVICE_SEED;

  sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  sh.getRange(2, 1, rows.length, rows[0].length)
    .setVerticalAlignment('top').setWrap(true).setFontSize(10);
  sh.setColumnWidth(1, 170);
  sh.setColumnWidth(2, 110);
  sh.setColumnWidth(3, 380);
  sh.setColumnWidth(4, 160);
}

function seedPhases_(ss) {
  const sh = ss.getSheetByName(TABS.PHASES);
  if (sh.getLastRow() > 1) return;
  const rows = [
    [1, 'Internal Setup', '',
      'Alias and Drive folder must exist before anything goes out — the client email '
      + 'contains the alias and points at the folder.'],
    [2, 'Client Requests', '_access',
      'Access, billing, brand assets. One email covering everything we need from them.'],
    [3, 'Data & Validation', '',
      'Baseline captured before optimisation. Tracking verified before spend moves.'],
    [4, 'Launch', '_kickoff', 'Kickoff booked, recurring calls set, build begins.'],
    [5, 'Steady State', '', 'Reporting rhythm established and the 30-day partner check.']
  ];
  sh.getRange(2, 1, rows.length, 4).setValues(rows);
  sh.getRange(2, 1, rows.length, 4).setVerticalAlignment('top').setWrap(true).setFontSize(10);
  sh.setColumnWidth(2, 160);
  sh.setColumnWidth(3, 120);
  sh.setColumnWidth(4, 420);
}

function seedConfig_(ss) {
  let sh = ss.getSheetByName(TABS.CONFIG);
  if (!sh) sh = ss.insertSheet(TABS.CONFIG);
  if (sh.getLastRow() > 1) return;

  const rows = [
    ['Setting', 'Value', 'Notes'],
    ['Agency Name', 'Lockhern Digital', ''],
    ['Onboarding Questionnaire URL', '',
      'Linked from the welcome email. Blank leaves a visible placeholder'],
    ['Agency Access Email', 'marketing@lockherndigital.com',
      'What clients grant access to. Blank uses the per-client alias instead'],
    ['Alias Domain', 'lockherndigital.com', 'Aliases render as client@thisdomain'],
    ['Reply To', '', 'Where client replies land'],
    ['Email Signature', '', 'Appended to every instruction email'],
    ['Drive Root Folder ID', '', 'Parent folder for client folders. Blank = My Drive root.'],
    ['Digest Recipients', '', 'Comma-separated. Daily overdue digest goes here.'],
    ['Model', 'claude-opus-5', 'Anthropic model string'],
    ['Google Ads MCC ID', '', 'Merged into the Google Ads instructions'],
    ['Meta Business Manager ID', '1255155904831766',
      'Merged into the Meta instructions as the partner ID'],
    ['Merchant Center MCA ID', '', 'Merged into the Merchant Center instructions'],
    ['Shopify Partner Name', '', 'Merged into the Shopify instructions'],
    ['Default Onboarding Owner', '', '']
  ];
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold').setFontFamily('Roboto Mono')
    .setFontSize(9).setBackground(INK).setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 230);
  sh.setColumnWidth(2, 280);
  sh.setColumnWidth(3, 340);
}

/**
 * Grows the sheet so a fixed-height range can be addressed.
 *
 * getRange past the last row throws rather than expanding, and repairClientRows_
 * can shrink the Clients tab to a handful of rows — at which point asking for
 * 500 rows of validation fails and takes the whole of setup() with it.
 */
function ensureRows_(sh, n) {
  const have = sh.getMaxRows();
  if (have < n) sh.insertRowsAfter(have, n - have);
}

function applyValidation_(ss) {
  const clients = ss.getSheetByName(TABS.CLIENTS);
  ensureRows_(clients, 501);
  const list = (arr) => SpreadsheetApp.newDataValidation().requireValueInList(arr, true).build();

  clients.getRange(2, C.STATUS, 500).setDataValidation(
    list(['Intake', 'Access Pending', 'Auditing', 'Building', 'Live', 'Paused', 'Churned']));
  clients.getRange(2, C.CADENCE, 500).setDataValidation(list(CADENCES));
  clients.getRange(2, C.TERM, 500).setDataValidation(list(TERMS));
  clients.getRange(2, C.BIZTYPE, 500).setDataValidation(list(BIZ_TYPES));
  clients.getRange(2, C.ONBOARDING, 500).setDataValidation(
    list(['Not started', 'Started', 'Complete']));
  // Completed is on the list because by the time anyone reads a client page the
  // call has usually happened, and a state set that cannot say so leaves every
  // finished onboarding reading "Scheduled".
  clients.getRange(2, C.CALL, 500).setDataValidation(
    list(['Not applicable', 'To schedule', 'Scheduled', 'Running', 'Completed']));
  clients.getRange(2, C.PLAN_STATUS, 500).setDataValidation(
    list(['Not started', 'Generating', 'Ready', 'Approved']));

  const access = ss.getSheetByName(TABS.ACCESS);
  ensureRows_(access, 2001);
  access.getRange(2, A.STATUS, 2000).setDataValidation(list(STATUSES));

  const actions = ss.getSheetByName(TABS.ACTIONS);
  if (actions) {
    ensureRows_(actions, 1001);
    actions.getRange(2, ACT.STATUS, 1000).setDataValidation(list(ACTION_STATUSES));
    actions.getRange(2, ACT.PRIORITY, 1000).setDataValidation(list(ACTION_PRIORITIES));
  }
}

/**
 * Deletes the rows that look empty but are not, and closes the gap.
 *
 * The progress formula used to be pre-filled down 499 rows so a new client got
 * a working cell for free. A formula is content, so getLastRow() on an empty
 * Clients tab reported 501, and everything built off it was wrong in a
 * different way: the Team page announced "500 clients with no owner", and
 * submitIntake wrote each new client to getLastRow() + 1 — five hundred blank
 * rows below anything anyone would scroll to.
 *
 * Clearing one named column is not enough. The live sheet carried its 499 in
 * column U, not column X: they were written when Progress WAS column 21, and
 * the columns added since moved the header without moving the formula. A
 * repair that trusts the current column map misses every one of them.
 *
 * So the test is structural rather than positional — a row with no Client ID
 * whose every cell is either empty or a formula holds no record, whatever
 * column the leftovers landed in. A row with typed text in it is somebody
 * part-way through entering a client by hand and is left alone.
 *
 * Deleting rather than clearing is deliberate: it also closes the gap, so a
 * record stranded at row 501 comes back up to the top where it can be seen.
 */
function repairClientRows_(ss) {
  const sh = ss.getSheetByName(TABS.CLIENTS);
  const last = sh.getLastRow();
  if (last < 2) return 0;

  const width = Math.max(sh.getLastColumn(), C.WIDTH);
  // Two bulk reads rather than a getRange per cell: 500 rows by 28 columns is
  // 14,000 calls the other way, which is minutes of execution time.
  const values = sh.getRange(2, 1, last - 1, width).getValues();
  const formulas = sh.getRange(2, 1, last - 1, width).getFormulas();

  const junk = [];
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][C.ID - 1]).trim()) continue;

    let typed = false;
    for (let c = 0; c < width; c++) {
      if (formulas[i][c]) continue;                       // a leftover formula
      if (String(values[i][c]).trim()) { typed = true; break; }
    }
    if (!typed) junk.push(i + 2);
  }
  if (!junk.length) return 0;

  // Bottom up, in contiguous runs, so the row numbers gathered above stay
  // valid as the sheet shortens under them.
  let n = junk.length - 1;
  while (n >= 0) {
    const end = junk[n];
    let start = end;
    while (n > 0 && junk[n - 1] === start - 1) { n--; start = junk[n]; }
    sh.deleteRows(start, end - start + 1);
    n--;
  }
  return junk.length;
}

/**
 * The first row on the Clients tab with no client on it.
 *
 * Never getLastRow() + 1: that counts formulas and formatting, so on a tab
 * carrying pre-filled cells it points hundreds of rows past the data. Scanning
 * the ID column is the only measure of where the records actually end.
 */
function firstFreeClientRow_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return 2;

  const ids = sh.getRange(2, C.ID, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (!String(ids[i][0]).trim()) return i + 2;
  }
  return last + 1;
}

function progressFormula_(row) {
  return '=IF($A' + row + '="","",COUNTIFS(Access!$A:$A,$A' + row
    + ',Access!$H:$H,"Complete")&" / "&(COUNTIFS(Access!$A:$A,$A' + row
    + ')-COUNTIFS(Access!$A:$A,$A' + row + ',Access!$H:$H,"N/A")))';
}

// ---------------------------------------------------------------- CONFIG

function cfg(key) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.CONFIG);
  if (!sh || sh.getLastRow() < 2) return '';
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  const hit = rows.find(r => String(r[0]).trim() === key);
  return hit ? String(hit[1]).trim() : '';
}

function promptForApiKey() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Anthropic API key',
    'Paste your key. Stored in Script Properties, not in the sheet.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK || !res.getResponseText().trim()) return;
  PropertiesService.getScriptProperties()
    .setProperty('ANTHROPIC_API_KEY', res.getResponseText().trim());
  ui.alert('Key saved.');
}

// ---------------------------------------------------------------- INTAKE

function showIntakeSidebar() {
  SpreadsheetApp.getUi().showSidebar(
    HtmlService.createHtmlOutputFromFile('Intake').setTitle('New client intake'));
}

function getPlatformList() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.PLATFORMS);
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, P.WIDTH).getValues();
  return rows
    .filter(r => r[P.TASK - 1] && r[P.ACTIVE - 1] !== false && r[P.ALWAYS - 1] !== true)
    .map(r => ({ name: r[P.TASK - 1], category: r[P.CATEGORY - 1],
                 method: r[P.METHOD - 1] }));
}

function getIntakeOptions() {
  return {
    cadences: CADENCES, terms: TERMS, bizTypes: BIZ_TYPES,
    services: getServiceList(),
    bizPlatforms: BIZ_TYPE_PLATFORMS
  };
}

/**
 * The service catalogue, with the platforms each one implies. Sheet first so
 * it can be edited without a deploy, falling back to the seed constants when
 * the tab has not been created yet.
 */
/**
 * The team, for owner dropdowns, Slack invites and skill-based assignment.
 *
 * Returns [] when the tab is empty rather than inventing anyone — an empty
 * directory should show as "nobody added yet", not as a silent fallback that
 * makes assignment look like it worked.
 */
function getTeam() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.TEAM);
  if (!sh || sh.getLastRow() < 2) return [];

  return sh.getRange(2, 1, sh.getLastRow() - 1, TEAM_HEADERS.length).getValues()
    // The sheet row travels with the record so the admin screen can write back
    // to the person it read, rather than matching on a name someone is editing.
    .map((r, i) => ({
      row: i + 2,
      name: String(r[0]).trim(),
      email: String(r[1] || '').trim(),
      slackId: String(r[2] || '').trim(),
      skills: String(r[3] || '').split(',').map(x => x.trim()).filter(Boolean),
      role: String(r[4] || '').trim(),
      active: r[5] !== false
    }))
    .filter(t => t.name && t.active);
}

function getServiceList() {
  const row = r => {
    const rules = parsePlatformSpec_(r[2]);
    return {
      name: String(r[0]).trim(),
      category: String(r[1] || '').trim(),
      // Plain names, for anything that just wants the list.
      platforms: rules.map(x => x.name),
      // The same list with its conditions, for anything that has to decide.
      platformRules: rules,
      fee: r[3] === '' || r[3] === null ? '' : Number(r[3])
    };
  };

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.SERVICES);
  const rows = (!sh || sh.getLastRow() < 2) ? []
    : sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().filter(r => r[0]);

  const fromTab = rows.filter(r => r[4] !== false).map(row);

  // A service the tab has never heard of is an absence, not an edit, so the code
  // definition fills it in rather than the name simply not existing. Without
  // this, adding a service required someone to re-run setup() before it could
  // be ticked — and until they did, the model would return it off a signed
  // scope of work and the form had nowhere to put it.
  //
  // The tab still wins wherever it has an opinion: a row present there governs
  // its own fee, platforms and Active flag, and a service switched off stays
  // off. To retire one that only exists in code, run setup() to write the row,
  // then set Active to FALSE.
  const known = rows.map(r => String(r[0]).trim());
  const fromCode = SERVICE_SEED
    .filter(r => known.indexOf(String(r[0]).trim()) === -1)
    .map(row);

  return fromTab.concat(fromCode);
}

function submitIntake(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const clients = ss.getSheetByName(TABS.CLIENTS);
  const clientId = makeClientId_(payload.company);
  const now = new Date();

  const alias = payload.alias ||
    (slugAlias_(payload.company) + '@' + (cfg('Alias Domain') || 'example.com'));

  const row = firstFreeClientRow_(clients);
  const vals = new Array(C.WIDTH).fill('');
  vals[C.ID - 1] = clientId;
  vals[C.COMPANY - 1] = payload.company;
  vals[C.CONTACT - 1] = payload.contact || '';
  vals[C.EMAIL - 1] = payload.email || '';
  vals[C.WEBSITE - 1] = payload.website || '';
  vals[C.VERTICAL - 1] = payload.vertical || '';
  vals[C.STATUS - 1] = 'Intake';
  vals[C.PLATFORMS - 1] = (payload.platforms || []).join(', ');
  vals[C.START - 1] = payload.contractStart || '';
  vals[C.MRR - 1] = payload.mrr || '';
  vals[C.OWNER - 1] = payload.owner || cfg('Default Onboarding Owner');
  vals[C.SCOPE - 1] = payload.scope || '';
  vals[C.CADENCE - 1] = payload.cadence || '';
  vals[C.SLACK - 1] = payload.slack || '';
  vals[C.ALIAS - 1] = alias;
  vals[C.SERVICES - 1] = (payload.services || []).join(', ');
  vals[C.FEES - 1] = payload.fees ? JSON.stringify(payload.fees) : '';
  vals[C.BIZTYPE - 1] = payload.bizType || '';
  vals[C.ONBOARDING - 1] = 'Not started';
  vals[C.APPROVALS - 1] = payload.approvals || '';
  vals[C.TERM - 1] = payload.term || 'Month to month';
  vals[C.CALL - 1] = payload.weeklyCall ? 'To schedule' : 'Not applicable';
  vals[C.PLAN_STATUS - 1] = 'Not started';
  vals[C.CREATED - 1] = now;

  clients.getRange(row, 1, 1, C.WIDTH).setValues([vals]);
  clients.getRange(row, C.PROGRESS).setFormula(progressFormula_(row));

  // The Intake tab is what generatePlan_ reads. When the documents came from a
  // draft, nobody types anything into the Context boxes — so the plan used to
  // be generated with "(none provided)" for both the transcript and the
  // contract, silently, off a deal whose every document was sitting in Drive.
  const carried = draftContext_(payload.draftId);
  const transcript = resolveText_(
    payload.transcript || carried.transcript, clientId, 'transcript');
  const contract = resolveText_(
    payload.contract || carried.contract, clientId, 'contract');

  ss.getSheetByName(TABS.INTAKE).appendRow([
    clientId, payload.company, transcript.stored, contract.stored,
    payload.notes || '', [transcript.docUrl, contract.docUrl].filter(Boolean).join('\n'), now
  ]);

  // The draft is kept, not consumed. Its Drive folder holds the deal documents,
  // and pointing the client at it is what lets someone re-read the scope of work
  // in November — or re-analyse it after a correction — without hunting for the
  // files again.
  let draftFolderUrl = '';
  if (payload.draftId) {
    try {
      saveDraft(payload.draftId, {
        status: 'Submitted', clientId: clientId, form: payload
      });
      const d = openDraft(payload.draftId);
      if (d && d.ok) draftFolderUrl = d.folderUrl || '';
    } catch (e) { /* a client record is worth more than a tidy draft row */ }
  }

  // Creating the client and starting the onboarding are deliberately separate.
  // The record can be corrected freely; the moment tasks exist there are due
  // dates, owners and a queue entry, and undoing that means deleting rows.
  return { clientId: clientId, row: row, alias: alias,
           draftId: payload.draftId || '', draftFolder: draftFolderUrl };
}

/**
 * Turns a client record into an actual onboarding: task rows, Drive folder,
 * and the plan if asked for. Safe to re-run — buildAccessRows_ skips tasks
 * that already exist, and createDriveFolder_ reuses a folder of the same name.
 *
 * @param {Object} opts { generatePlan, makeDrive, weeklyCall }
 */
function startOnboarding(token, clientId, opts) {
  checkToken_(token);
  opts = opts || {};

  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };

  const platforms = platformsForClient_(client);
  const n = buildAccessRows_(clientId, client.company, platforms, !opts.weeklyCall);

  let driveUrl = client.drive || '';
  if (!driveUrl && opts.makeDrive !== false) {
    try { driveUrl = createDriveFolder_(clientId, client.company); } catch (e) { driveUrl = ''; }
  }

  let planResult = { ok: false, message: 'Plan generation skipped.' };
  if (opts.generatePlan) {
    const row = clientRowNumber_(clientId);
    if (row) planResult = generatePlan_(row);
  }

  setClientField_(clientId, C.ONBOARDING, 'Started');
  setClientField_(clientId, C.STATUS, 'Access Pending');

  return { ok: true, tasks: n, drive: driveUrl, plan: planResult, platforms: platforms };
}

/**
 * The platforms a client needs: whatever was ticked explicitly, plus
 * everything implied by the services sold. Union, not replacement — a service
 * mapping is a shortcut for the common case, never a cap on it.
 */
/**
 * "Google Merchant Center [eCommerce]" — a platform this service needs, but
 * only for that kind of client.
 *
 * The qualifier lives in the cell rather than in a new column because the
 * Platforms and Services tabs are read by raw index in three places, and adding
 * a column means changing all of them (see CLAUDE.md rule 2). A bracket after
 * the name costs nothing and reads plainly to whoever edits the tab.
 */
function parsePlatformSpec_(cell) {
  return String(cell || '').split(',').map(part => {
    const t = part.trim();
    if (!t) return null;
    const m = t.match(/^(.*?)\s*\[([^\]]+)\]$/);
    return m
      ? { name: m[1].trim(), onlyFor: m[2].trim() }
      : { name: t, onlyFor: '' };
  }).filter(Boolean);
}

/** Whether a conditional platform applies to this client. */
function platformApplies_(rule, bizType) {
  if (!rule.onlyFor) return true;
  return String(rule.onlyFor).toLowerCase() === String(bizType || '').toLowerCase();
}

function platformsForClient_(client) {
  const explicit = String(client.platformsRaw || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const sold = String(client.servicesRaw || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const map = {};
  getServiceList().forEach(s => { map[s.name] = s.platformRules; });

  const out = explicit.slice();
  sold.forEach(name => {
    (map[name] || [])
      .filter(rule => platformApplies_(rule, client.bizType))
      .forEach(rule => { if (out.indexOf(rule.name) === -1) out.push(rule.name); });
  });

  bizTypePlatforms_(client.bizType).forEach(p => {
    if (out.indexOf(p) === -1) out.push(p);
  });
  return out;
}

function clientRowNumber_(clientId) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.CLIENTS);
  if (sh.getLastRow() < 2) return 0;
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (ids[i][0] === clientId) return i + 2;
  return 0;
}

/**
 * SLUG-YYMM, with a suffix when that is already taken.
 *
 * The bare form is not unique: the same company created twice in one month got
 * the same ID both times. Every lookup is `find(x => x.id === clientId)`, so the
 * second record was permanently unreachable — the page said "not found", and any
 * edit that did resolve landed on the first row instead. Two identical rows is
 * exactly what that produces.
 */
function makeClientId_(company) {
  const slug = String(company).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'CLIENT';
  const base = slug + '-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMM');

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.CLIENTS);
  const taken = {};
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, C.ID, sh.getLastRow() - 1, 1).getValues()
      .forEach(r => { if (r[0]) taken[String(r[0]).trim()] = true; });
  }

  if (!taken[base]) return base;
  for (let n = 2; n < 100; n++) {
    if (!taken[base + '-' + n]) return base + '-' + n;
  }
  return base + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
}

function slugAlias_(company) {
  return String(company).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'client';
}

/** Sheets caps a cell at 50k chars — long text goes to a Doc, the cell holds the pointer. */
function resolveText_(input, clientId, label) {
  const text = String(input || '').trim();
  if (!text) return { stored: '', docUrl: '', full: '' };

  const docMatch = text.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (docMatch && text.length < 200) {
    try {
      DocumentApp.openById(docMatch[1]);
      return { stored: '[Doc] ' + text, docUrl: text, full: '' };
    } catch (e) {
      return { stored: text, docUrl: text, full: '' };
    }
  }
  if (text.length <= 45000) return { stored: text, docUrl: '', full: text };

  const doc = DocumentApp.create(clientId + ' — ' + label);
  doc.getBody().setText(text);
  doc.saveAndClose();
  return {
    stored: '[Doc — ' + text.length + ' chars] ' + doc.getUrl(),
    docUrl: doc.getUrl(), full: text
  };
}

// ---------------------------------------------------------------- DRIVE

const DRIVE_SUBFOLDERS = [
  '01 Contract & SOW',
  '02 Call Recordings & Transcripts',
  '03 Brand & Creative',
  '04 Reports',
  '05 Audits & Strategy',
  '06 Feed & Product Data'
];

/**
 * Deliberately no credentials folder. Shared logins belong in a password
 * manager with an audit trail, not in a Drive folder half the client can see.
 */
function createDriveFolder_(clientId, company) {
  const rootId = cfg('Drive Root Folder ID');
  const parent = rootId ? DriveApp.getFolderById(rootId) : DriveApp.getRootFolder();

  const name = company + ' (' + clientId + ')';
  const existing = parent.getFoldersByName(name);
  const folder = existing.hasNext() ? existing.next() : parent.createFolder(name);

  DRIVE_SUBFOLDERS.forEach(sub => {
    if (!folder.getFoldersByName(sub).hasNext()) folder.createFolder(sub);
  });

  const url = folder.getUrl();
  setClientField_(clientId, C.DRIVE, url);
  setTaskStatus_(clientId, 'Google Drive folder', 'Complete');
  return url;
}

function createDriveFolderForActiveRow() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const ui = SpreadsheetApp.getUi();
  if (sh.getName() !== TABS.CLIENTS) {
    ui.alert('Select a row on the Clients tab first.');
    return;
  }
  const row = sh.getActiveRange().getRow();
  if (row < 2) return;
  const v = sh.getRange(row, 1, 1, 2).getValues()[0];
  if (!v[0]) return;
  try {
    ui.alert('Folder ready:\n' + createDriveFolder_(v[0], v[1]));
  } catch (e) {
    ui.alert('Failed: ' + e.message);
  }
}

// ---------------------------------------------------------------- TASK BOARD

function buildAccessForActiveRow() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sh.getName() !== TABS.CLIENTS) {
    SpreadsheetApp.getUi().alert('Select a row on the Clients tab first.');
    return;
  }
  const row = sh.getActiveRange().getRow();
  if (row < 2) return;
  const v = sh.getRange(row, 1, 1, C.WIDTH).getValues()[0];
  const platforms = String(v[C.PLATFORMS - 1]).split(',').map(s => s.trim()).filter(Boolean);
  const n = buildAccessRows_(v[0], v[1], platforms, v[C.CALL - 1] === 'Not applicable');
  SpreadsheetApp.getUi().alert(n + ' task rows created for ' + v[1] + '.');
}

function buildAccessRows_(clientId, company, platforms, skipWeeklyCall) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const access = ss.getSheetByName(TABS.ACCESS);
  const pSh = ss.getSheetByName(TABS.PLATFORMS);
  const ref = pSh.getRange(2, 1, pSh.getLastRow() - 1, P.WIDTH).getValues();

  const existing = access.getLastRow() > 1
    ? access.getRange(2, 1, access.getLastRow() - 1, 3).getValues()
        .filter(r => r[0] === clientId).map(r => r[2])
    : [];

  const client = getClientRecord_(clientId);
  const anchor = parseDate_(client && client.contractStartRaw) || new Date();
  const defaultOwner = (client && client.owner) || cfg('Default Onboarding Owner');
  const rows = [];

  ref.forEach(r => {
    const name = r[P.TASK - 1];
    if (!name || r[P.ACTIVE - 1] === false) return;
    if (r[P.ALWAYS - 1] !== true && platforms.indexOf(name) === -1
        && !templateRequired_(r, platforms)) return;
    if (existing.indexOf(name) !== -1) return;
    // A template can be scoped to one kind of business — a Merchant Center
    // task on a lead-gen account is a request nobody can action.
    if (!templateApplies_(r[P.BIZTYPE - 1], client && client.bizType)) return;

    const status = (skipWeeklyCall && name === 'Weekly onboarding call') ? 'N/A' : 'Not started';
    const offset = Number(r[P.OFFSET - 1]);
    const due = isNaN(offset) ? '' : addDays_(anchor, offset);

    const row = new Array(A.WIDTH).fill('');
    row[A.ID - 1] = clientId;
    row[A.COMPANY - 1] = company;
    row[A.TASK - 1] = name;
    row[A.CATEGORY - 1] = r[P.CATEGORY - 1];
    row[A.METHOD - 1] = r[P.METHOD - 1];
    row[A.NEEDS - 1] = r[P.NEEDS - 1];
    row[A.STATUS - 1] = status;
    row[A.DUE - 1] = due;
    row[A.OWNER - 1] = String(r[P.OWNER - 1] || '').trim() || defaultOwner;
    // Stamped at build time when the template names an owner, so "assigned N
    // days ago" is measured from the moment the work landed on someone rather
    // than from the first time anyone touched the dropdown.
    if (row[A.OWNER - 1]) row[A.ASSIGNED - 1] = new Date();
    row[A.PHASE - 1] = Number(r[P.PHASE - 1]) || 1;
    row[A.GATE - 1] = r[P.GATE - 1] === true;
    rows.push(row);
  });

  if (rows.length) {
    access.getRange(access.getLastRow() + 1, 1, rows.length, A.WIDTH).setValues(rows);
  }
  return rows.length;
}

function addDays_(d, n) {
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + n);
  return out;
}

function parseDate_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function setClientField_(clientId, col, value) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.CLIENTS);
  if (sh.getLastRow() < 2) return false;
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] !== clientId) continue;
    sh.getRange(i + 2, col).setValue(value);
    return true;
  }
  return false;
}

function setTaskStatus_(clientId, task, status) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.ACCESS);
  if (sh.getLastRow() < 2) return false;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, A.WIDTH).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (vals[i][A.ID - 1] !== clientId || vals[i][A.TASK - 1] !== task) continue;
    sh.getRange(i + 2, A.STATUS).setValue(status);
    if (status === 'Complete' && !vals[i][A.COMPLETED - 1]) {
      sh.getRange(i + 2, A.COMPLETED).setValue(new Date());
    }
    return true;
  }
  return false;
}

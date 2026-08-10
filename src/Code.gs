/**
 * LOCKHERN ONBOARDING CRM — Core
 *
 * Setup: run setup() once from the Apps Script editor.
 */

const TABS = {
  CLIENTS: 'Clients',
  INTAKE: 'Intake',
  ACCESS: 'Access',
  PLANS: 'Plans',
  PLATFORMS: 'Platforms',
  TEMPLATES: 'Templates',
  PHASES: 'Phases',
  CONFIG: 'Config'
};

const STATUSES = ['Not started', 'Info needed', 'Requested', 'Complete', 'Blocked', 'N/A'];
const CADENCES = ['Weekly', 'Biweekly', 'Monthly', 'Quarterly', 'Ad hoc'];
const BILLING = ['Client card on account', 'Agency billed / rebilled', 'Hybrid', 'Not set'];

const INK = '#14181D';

// Clients column map (1-based) — single source of truth for index changes.
const C = {
  ID: 1, COMPANY: 2, CONTACT: 3, EMAIL: 4, WEBSITE: 5, VERTICAL: 6, STATUS: 7,
  PLATFORMS: 8, START: 9, MRR: 10, OWNER: 11, SCOPE: 12, CADENCE: 13, SLACK: 14,
  ALIAS: 15, DRIVE: 16, BILLING: 17, APPROVALS: 18, RENEWAL: 19, CALL: 20,
  PROGRESS: 21, PLAN_STATUS: 22, PLAN_DOC: 23, CREATED: 24, WIDTH: 24
};

// Access column map (1-based)
const A = {
  ID: 1, COMPANY: 2, TASK: 3, CATEGORY: 4, METHOD: 5, NEEDS: 6, ACCOUNT: 7,
  STATUS: 8, DUE: 9, REQUESTED: 10, COMPLETED: 11, OWNER: 12, NOTES: 13,
  PHASE: 14, GATE: 15, WIDTH: 15
};

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
    .addItem('Send digest now', 'sendDigestNow')
    .addItem('Enable daily digest', 'installDigestTrigger')
    .addSeparator()
    .addItem('Set Anthropic API key', 'promptForApiKey')
    .addItem('Set dashboard PIN', 'promptForPin')
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
    'Drive Folder', 'Media Billing', 'Approvals Contact', 'Renewal Date',
    'Onboarding Call', 'Progress', 'Plan Status', 'Plan Doc', 'Created'
  ]);

  mkTab_(ss, TABS.INTAKE, [
    'Client ID', 'Company', 'Sales Transcript', 'Contract Text',
    'Context Notes', 'Source Docs', 'Captured'
  ]);

  mkTab_(ss, TABS.ACCESS, [
    'Client ID', 'Company', 'Task', 'Category', 'Method', 'Client Info Needed',
    'Account ID', 'Status', 'Due', 'Requested', 'Completed', 'Owner', 'Notes',
    'Phase', 'Gate'
  ]);

  mkTab_(ss, TABS.PLANS, [
    'Client ID', 'Company', 'Generated', 'Model', 'Plan Doc', 'Plan JSON'
  ]);

  mkTab_(ss, TABS.PLATFORMS, [
    'Task', 'Category', 'Method', 'Client Info Needed', 'How Access Is Granted',
    'Typical Lead Time', 'Due Offset (days)', 'Default Owner', 'Phase', 'Gate',
    'Always Include', 'Active'
  ]);

  mkTab_(ss, TABS.PHASES, ['Phase', 'Name', 'Client Email', 'What it means']);

  mkTab_(ss, TABS.TEMPLATES, ['Task', 'Subject', 'Body']);

  seedPlatforms_(ss);
  seedPhases_(ss);
  seedTemplates_(ss);
  seedConfig_(ss);
  applyValidation_(ss);
  addProgressFormula_(ss);

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
function seedPlatforms_(ss) {
  const sh = ss.getSheetByName(TABS.PLATFORMS);
  if (sh.getLastRow() > 1) return;

  const rows = [
    // task, category, method, needs, how, lead, offset, owner, PHASE, GATE, always, active

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

    // Phase 4 — launch
    ['Kickoff call', 'Internal', 'INTERNAL', 'Attendee emails',
      'Agenda comes from the plan open questions', '1 week', 16, '', 4, true, true, true],
    ['Weekly onboarding call', 'Internal', 'INTERNAL', 'Attendee emails',
      'Recurring invite for the onboarding window', 'Same day', 16, '', 4, false, true, true],

    // Phase 5 — steady state
    ['First report delivered', 'Internal', 'INTERNAL', '—',
      'Sets the reporting rhythm. A late first report resets expectations badly.',
      '1 day', 35, '', 5, false, true, true],
    ['30-day client check-in', 'Internal', 'INTERNAL', '—',
      'Partner-level call, separate from the pod. Are we delivering what was sold?',
      '30 min', 30, 'Justin', 5, false, true, true]
  ];

  sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  sh.getRange(2, 1, rows.length, rows[0].length)
    .setVerticalAlignment('top').setWrap(true).setFontSize(10);
  sh.setColumnWidths(1, 3, 150);
  sh.setColumnWidth(4, 200);
  sh.setColumnWidth(5, 320);
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
    ['Agency Access Email', '', 'Fallback if a client has no alias'],
    ['Alias Domain', 'lockherndigital.com', 'Aliases render as client@thisdomain'],
    ['Reply To', '', 'Where client replies land'],
    ['Email Signature', '', 'Appended to every instruction email'],
    ['Drive Root Folder ID', '', 'Parent folder for client folders. Blank = My Drive root.'],
    ['Digest Recipients', '', 'Comma-separated. Daily overdue digest goes here.'],
    ['Model', 'claude-sonnet-5', 'Anthropic model string'],
    ['Google Ads MCC ID', '', 'Merged into the Google Ads instructions'],
    ['Meta Business Manager ID', '', 'Merged into the Meta instructions'],
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

function applyValidation_(ss) {
  const clients = ss.getSheetByName(TABS.CLIENTS);
  const list = (arr) => SpreadsheetApp.newDataValidation().requireValueInList(arr, true).build();

  clients.getRange(2, C.STATUS, 500).setDataValidation(
    list(['Intake', 'Access Pending', 'Auditing', 'Building', 'Live', 'Paused', 'Churned']));
  clients.getRange(2, C.CADENCE, 500).setDataValidation(list(CADENCES));
  clients.getRange(2, C.BILLING, 500).setDataValidation(list(BILLING));
  clients.getRange(2, C.CALL, 500).setDataValidation(
    list(['Not applicable', 'To schedule', 'Scheduled', 'Running']));
  clients.getRange(2, C.PLAN_STATUS, 500).setDataValidation(
    list(['Not started', 'Generating', 'Ready', 'Approved']));

  ss.getSheetByName(TABS.ACCESS).getRange(2, A.STATUS, 2000).setDataValidation(list(STATUSES));
}

function addProgressFormula_(ss) {
  const sh = ss.getSheetByName(TABS.CLIENTS);
  sh.getRange(2, C.PROGRESS, 499).setFormula(progressFormula_(2));
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
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 12).getValues();
  return rows.filter(r => r[0] && r[11] !== false && r[10] !== true)
    .map(r => ({ name: r[0], category: r[1], method: r[2] }));
}

function getIntakeOptions() {
  return { cadences: CADENCES, billing: BILLING };
}

function submitIntake(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const clients = ss.getSheetByName(TABS.CLIENTS);
  const clientId = makeClientId_(payload.company);
  const now = new Date();

  const alias = payload.alias ||
    (slugAlias_(payload.company) + '@' + (cfg('Alias Domain') || 'example.com'));

  const row = clients.getLastRow() + 1;
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
  vals[C.BILLING - 1] = payload.billing || 'Not set';
  vals[C.APPROVALS - 1] = payload.approvals || '';
  vals[C.RENEWAL - 1] = payload.renewal || '';
  vals[C.CALL - 1] = payload.weeklyCall ? 'To schedule' : 'Not applicable';
  vals[C.PLAN_STATUS - 1] = 'Not started';
  vals[C.CREATED - 1] = now;

  clients.getRange(row, 1, 1, C.WIDTH).setValues([vals]);
  clients.getRange(row, C.PROGRESS).setFormula(progressFormula_(row));

  const transcript = resolveText_(payload.transcript, clientId, 'transcript');
  const contract = resolveText_(payload.contract, clientId, 'contract');

  ss.getSheetByName(TABS.INTAKE).appendRow([
    clientId, payload.company, transcript.stored, contract.stored,
    payload.notes || '', [transcript.docUrl, contract.docUrl].filter(Boolean).join('\n'), now
  ]);

  buildAccessRows_(clientId, payload.company, payload.platforms || [], !payload.weeklyCall);

  let driveUrl = '';
  if (payload.makeDrive !== false) {
    try {
      driveUrl = createDriveFolder_(clientId, payload.company);
    } catch (e) {
      driveUrl = '';
    }
  }

  let planResult = { ok: false, message: 'Plan generation skipped.' };
  if (payload.generatePlan) planResult = generatePlan_(row);

  return {
    clientId: clientId, row: row, alias: alias, drive: driveUrl, plan: planResult
  };
}

function makeClientId_(company) {
  const slug = String(company).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'CLIENT';
  return slug + '-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMM');
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
  const ref = pSh.getRange(2, 1, pSh.getLastRow() - 1, 12).getValues();

  const existing = access.getLastRow() > 1
    ? access.getRange(2, 1, access.getLastRow() - 1, 3).getValues()
        .filter(r => r[0] === clientId).map(r => r[2])
    : [];

  const client = getClientRecord_(clientId);
  const anchor = parseDate_(client && client.contractStartRaw) || new Date();
  const defaultOwner = (client && client.owner) || cfg('Default Onboarding Owner');
  const rows = [];

  ref.forEach(r => {
    const name = r[0];
    if (!name || r[11] === false) return;
    if (r[10] !== true && platforms.indexOf(name) === -1) return;
    if (existing.indexOf(name) !== -1) return;

    const status = (skipWeeklyCall && name === 'Weekly onboarding call') ? 'N/A' : 'Not started';
    const offset = Number(r[6]);
    const due = isNaN(offset) ? '' : addDays_(anchor, offset);

    const row = new Array(A.WIDTH).fill('');
    row[A.ID - 1] = clientId;
    row[A.COMPANY - 1] = company;
    row[A.TASK - 1] = name;
    row[A.CATEGORY - 1] = r[1];
    row[A.METHOD - 1] = r[2];
    row[A.NEEDS - 1] = r[3];
    row[A.STATUS - 1] = status;
    row[A.DUE - 1] = due;
    row[A.OWNER - 1] = String(r[7] || '').trim() || defaultOwner;
    row[A.PHASE - 1] = Number(r[8]) || 1;
    row[A.GATE - 1] = r[9] === true;
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

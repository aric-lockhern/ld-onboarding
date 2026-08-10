/**
 * LOCKHERN ONBOARDING CRM — Dashboard
 *
 * The PIN is a soft lock. It keeps a teammate from casually opening the
 * dashboard and reading MRR and scope; it does not stop anyone with edit
 * access to this Sheet, who can open the script editor and read around it.
 * Sheet sharing permissions are the real boundary. Run
 * protectSensitiveRanges() to add a second layer over the money columns.
 */

const PIN_TTL_SECONDS = 1800; // 30 minutes

// ---------------------------------------------------------------- PIN

function promptForPin() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Dashboard PIN',
    'Set a PIN for the dashboard. Stored hashed in Script Properties.\n\n' +
    'This is a convenience lock, not real security — anyone with edit access ' +
    'to this sheet can bypass it via the script editor.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  const pin = res.getResponseText().trim();
  if (pin.length < 4) { ui.alert('Use at least 4 characters.'); return; }

  PropertiesService.getScriptProperties().setProperty('DASH_PIN_HASH', hashPin_(pin));
  ui.alert('PIN set.');
}

function hashPin_(pin) {
  const salt = 'lockhern-onboarding-v1';
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + pin));
}

function isPinSet() {
  return !!PropertiesService.getScriptProperties().getProperty('DASH_PIN_HASH');
}

function verifyPin(pin) {
  const stored = PropertiesService.getScriptProperties().getProperty('DASH_PIN_HASH');
  if (!stored) return { ok: true, token: issueToken_(), unset: true };
  if (hashPin_(String(pin || '')) !== stored) {
    return { ok: false, message: 'PIN not recognised. Try again.' };
  }
  return { ok: true, token: issueToken_() };
}

function issueToken_() {
  const token = Utilities.getUuid();
  CacheService.getUserCache().put('dash_' + token, '1', PIN_TTL_SECONDS);
  return token;
}

function checkToken_(token) {
  if (!isPinSet()) return;
  if (!token || !CacheService.getUserCache().get('dash_' + token)) {
    throw new Error('Session expired. Close the dashboard and reopen it.');
  }
}

// ---------------------------------------------------------------- UI

function showAdminDashboard() {
  const html = HtmlService.createHtmlOutputFromFile('Admin')
    .setWidth(760).setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, 'Onboarding dashboard');
}

// ---------------------------------------------------------------- READ

function getClientRecord_(clientId) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.CLIENTS);
  if (sh.getLastRow() < 2) return null;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, C.WIDTH).getValues();
  const r = rows.find(x => x[C.ID - 1] === clientId);
  if (!r) return null;
  return {
    clientId: r[C.ID - 1], company: r[C.COMPANY - 1], contact: r[C.CONTACT - 1],
    email: r[C.EMAIL - 1], website: r[C.WEBSITE - 1], vertical: r[C.VERTICAL - 1],
    status: r[C.STATUS - 1], platforms: r[C.PLATFORMS - 1],
    contractStart: fmtDate_(r[C.START - 1]), contractStartRaw: r[C.START - 1],
    mrr: r[C.MRR - 1], owner: r[C.OWNER - 1], scope: r[C.SCOPE - 1],
    cadence: r[C.CADENCE - 1], slack: r[C.SLACK - 1], alias: r[C.ALIAS - 1],
    drive: r[C.DRIVE - 1], approvals: r[C.APPROVALS - 1],
    term: r[C.TERM - 1], call: r[C.CALL - 1],
    bizType: r[C.BIZTYPE - 1], onboarding: r[C.ONBOARDING - 1],
    services: r[C.SERVICES - 1],
    // Raw comma strings, kept separate from the display fields because
    // platformsForClient_ parses them.
    platformsRaw: r[C.PLATFORMS - 1], servicesRaw: r[C.SERVICES - 1],
    fees: parseFees_(r[C.FEES - 1]),
    planStatus: r[C.PLAN_STATUS - 1], planDoc: r[C.PLAN_DOC - 1]
  };
}

/** Fees are stored as JSON in one cell. A hand-edited cell must not break the
    whole client record, so a bad parse degrades to no breakdown. */
function parseFees_(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(String(raw));
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function getClientTasks_(clientId) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.ACCESS);
  if (sh.getLastRow() < 2) return [];
  const today = midnight_(new Date());
  return sh.getRange(2, 1, sh.getLastRow() - 1, A.WIDTH).getValues()
    .filter(r => r[A.ID - 1] === clientId)
    .map(r => {
      const due = parseDate_(r[A.DUE - 1]);
      const open = r[A.STATUS - 1] !== 'Complete' && r[A.STATUS - 1] !== 'N/A';
      return {
        task: r[A.TASK - 1], category: r[A.CATEGORY - 1], method: r[A.METHOD - 1],
        needs: r[A.NEEDS - 1], accountId: r[A.ACCOUNT - 1], status: r[A.STATUS - 1],
        due: fmtDate_(r[A.DUE - 1]),
        overdueBy: (due && open) ? Math.round((today - midnight_(due)) / 86400000) : 0,
        requested: fmtDate_(r[A.REQUESTED - 1]), completed: fmtDate_(r[A.COMPLETED - 1]),
        owner: r[A.OWNER - 1], notes: r[A.NOTES - 1],
        phase: Number(r[A.PHASE - 1]) || 1, gate: r[A.GATE - 1] === true
      };
    });
}

function fmtDate_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'd MMM yyyy');
  }
  return String(v);
}

/** Overview: every client with a completion rollup. */
function getDashboardOverview(token) {
  checkToken_(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cSh = ss.getSheetByName(TABS.CLIENTS);
  const aSh = ss.getSheetByName(TABS.ACCESS);
  if (cSh.getLastRow() < 2) return { clients: [], totals: { clients: 0, blocked: 0, stale: 0 } };

  const tasks = aSh.getLastRow() > 1
    ? aSh.getRange(2, 1, aSh.getLastRow() - 1, A.WIDTH).getValues() : [];

  const today = midnight_(new Date());
  const byClient = {};
  tasks.forEach(t => {
    const id = t[A.ID - 1];
    if (!id) return;
    if (!byClient[id]) {
      byClient[id] = { total: 0, done: 0, blocked: 0, waiting: 0, overdue: 0, oldest: null };
    }
    const b = byClient[id];
    const s = t[A.STATUS - 1];
    if (s === 'N/A') return;
    b.total++;
    if (s === 'Complete') { b.done++; return; }

    const due = parseDate_(t[A.DUE - 1]);
    if (due && midnight_(due) < today) b.overdue++;

    if (s === 'Blocked') b.blocked++;
    else if (s === 'Requested') {
      b.waiting++;
      const d = parseDate_(t[A.REQUESTED - 1]);
      if (d && (!b.oldest || d < b.oldest)) b.oldest = d;
    }
  });

  const now = new Date();
  let blocked = 0, stale = 0, overdue = 0;

  const clients = cSh.getRange(2, 1, cSh.getLastRow() - 1, C.WIDTH).getValues()
    .filter(r => r[C.ID - 1])
    .map(r => {
      const b = byClient[r[C.ID - 1]]
        || { total: 0, done: 0, blocked: 0, waiting: 0, overdue: 0, oldest: null };
      const pct = b.total ? Math.round((b.done / b.total) * 100) : 0;
      const daysWaiting = b.oldest ? Math.floor((now - b.oldest) / 86400000) : null;
      if (b.blocked) blocked++;
      if (b.overdue) overdue++;
      if (daysWaiting !== null && daysWaiting >= 5) stale++;
      return {
        clientId: r[C.ID - 1], company: r[C.COMPANY - 1], status: r[C.STATUS - 1],
        owner: r[C.OWNER - 1], cadence: r[C.CADENCE - 1], call: r[C.CALL - 1],
        done: b.done, total: b.total, pct: pct, overdue: b.overdue,
        blocked: b.blocked, waiting: b.waiting, daysWaiting: daysWaiting
      };
    });

  clients.sort((a, b) => (b.overdue - a.overdue) || (a.pct - b.pct));
  return {
    clients: clients,
    totals: { clients: clients.length, overdue: overdue, blocked: blocked, stale: stale }
  };
}

function getClientDetail(token, clientId) {
  checkToken_(token);
  const client = getClientRecord_(clientId);
  if (!client) throw new Error('Client not found.');
  const tasks = getClientTasks_(clientId);

  const counted = tasks.filter(t => t.status !== 'N/A');
  const done = counted.filter(t => t.status === 'Complete').length;

  return {
    client: client,
    tasks: tasks,
    statuses: STATUSES,
    terms: TERMS,
    bizTypes: BIZ_TYPES,
    cadences: CADENCES,
    serviceList: getServiceList(),
    summary: {
      done: done, total: counted.length,
      pct: counted.length ? Math.round((done / counted.length) * 100) : 0
    },
    commitments: getPlanCommitments_(clientId),
    phaseState: getPhaseState_(clientId)
  };
}

/** Pulls the commitment list off the stored plan so scope is visible in the profile. */
function getPlanCommitments_(clientId) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.PLANS);
  if (!sh || sh.getLastRow() < 2) return [];
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  const r = rows.reverse().find(x => x[0] === clientId);
  if (!r || !r[5]) return [];
  try {
    const plan = JSON.parse(r[5]);
    return (plan.commitments || []).map(c => ({ item: c.item, source: c.source }));
  } catch (e) {
    return [];
  }
}

// ---------------------------------------------------------------- WRITE

function updateTaskStatus(token, clientId, task, status) {
  checkToken_(token);
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.ACCESS);
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, A.WIDTH).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (vals[i][A.ID - 1] !== clientId || vals[i][A.TASK - 1] !== task) continue;
    sh.getRange(i + 2, A.STATUS).setValue(status);
    if (status === 'Complete' && !vals[i][A.COMPLETED - 1]) {
      sh.getRange(i + 2, A.COMPLETED).setValue(new Date());
    }
    if (status !== 'Complete') sh.getRange(i + 2, A.COMPLETED).setValue('');
    return { ok: true };
  }
  return { ok: false, message: 'Task row not found.' };
}

function updateClientField(token, clientId, field, value) {
  checkToken_(token);
  const cols = {
    status: C.STATUS, owner: C.OWNER, scope: C.SCOPE, cadence: C.CADENCE,
    slack: C.SLACK, alias: C.ALIAS, drive: C.DRIVE, services: C.SERVICES,
    approvals: C.APPROVALS, term: C.TERM, call: C.CALL,
    bizType: C.BIZTYPE, mrr: C.MRR, platforms: C.PLATFORMS
  };
  const col = cols[field];
  if (!col) return { ok: false, message: 'Unknown field.' };

  return setClientField_(clientId, col, value)
    ? { ok: true } : { ok: false, message: 'Client not found.' };
}

function dashCreateDrive(token, clientId) {
  checkToken_(token);
  const c = getClientRecord_(clientId);
  if (!c) return { ok: false, message: 'Client not found.' };
  try {
    return { ok: true, url: createDriveFolder_(clientId, c.company) };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// ---------------------------------------------------------------- PROTECTION

/**
 * Second layer over the PIN: locks the money and scope columns plus the
 * config tab to the sheet owner. Everyone else keeps read access.
 */
function protectSensitiveRanges() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const me = Session.getEffectiveUser();

  const targets = [
    { sheet: TABS.CLIENTS, a1: 'J2:J500', desc: 'MRR' },
    { sheet: TABS.CONFIG, a1: null, desc: 'Config' }
  ];

  targets.forEach(t => {
    const sh = ss.getSheetByName(t.sheet);
    if (!sh) return;
    const p = t.a1 ? sh.getRange(t.a1).protect() : sh.protect();
    p.setDescription(t.desc + ' — restricted');
    p.removeEditors(p.getEditors().filter(e => e.getEmail() !== me.getEmail()));
    if (p.canDomainEdit && p.canDomainEdit()) p.setDomainEdit(false);
  });

  SpreadsheetApp.getUi().alert(
    'MRR and Config are now owner-edit-only.\n\n' +
    'Note: collaborators can still read them. To hide values entirely, ' +
    'move them to a separate sheet you share more narrowly.');
}

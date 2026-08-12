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

/**
 * Every field here is coerced to a string, a number or a plain array.
 *
 * google.script.run returns NULL — not an error, not a rejection — when any
 * part of the response cannot be serialised, and a single cell holding a
 * formula error (#REF!, #N/A, #VALUE!) comes back from getValues() as an Error
 * object that does exactly that. The whole client page then fails with nothing
 * to go on, which is what "Client not found" on a row you can see in the list
 * actually means. Never hand a raw cell value back to the browser.
 */
function safeStr_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return fmtDate_(v);
  if (typeof v === 'object') return '';   // a formula error, and nothing useful
  return String(v);
}

function safeNum_(v) {
  const n = Number(v);
  return isFinite(n) && v !== '' && v !== null ? n : '';
}

function getClientRecord_(clientId) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.CLIENTS);
  if (sh.getLastRow() < 2) return null;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, C.WIDTH).getValues();
  const r = rows.find(x => String(x[C.ID - 1]).trim() === String(clientId).trim());
  if (!r) return null;
  return {
    clientId: safeStr_(r[C.ID - 1]), company: safeStr_(r[C.COMPANY - 1]),
    contact: safeStr_(r[C.CONTACT - 1]), email: safeStr_(r[C.EMAIL - 1]),
    website: safeStr_(r[C.WEBSITE - 1]), vertical: safeStr_(r[C.VERTICAL - 1]),
    status: safeStr_(r[C.STATUS - 1]), platforms: safeStr_(r[C.PLATFORMS - 1]),
    contractStart: fmtDate_(r[C.START - 1]),
    // A string, not the Date. parseDate_ handles it, and a raw cell value is
    // exactly what breaks serialisation when the cell holds a formula error.
    contractStartRaw: safeStr_(r[C.START - 1]),
    mrr: safeNum_(r[C.MRR - 1]), owner: safeStr_(r[C.OWNER - 1]),
    scope: safeStr_(r[C.SCOPE - 1]), cadence: safeStr_(r[C.CADENCE - 1]),
    slack: safeStr_(r[C.SLACK - 1]), alias: safeStr_(r[C.ALIAS - 1]),
    drive: safeStr_(r[C.DRIVE - 1]), approvals: safeStr_(r[C.APPROVALS - 1]),
    term: safeStr_(r[C.TERM - 1]), call: safeStr_(r[C.CALL - 1]),
    bizType: safeStr_(r[C.BIZTYPE - 1]), onboarding: safeStr_(r[C.ONBOARDING - 1]),
    services: safeStr_(r[C.SERVICES - 1]),
    // Raw comma strings, kept separate from the display fields because
    // platformsForClient_ parses them.
    platformsRaw: safeStr_(r[C.PLATFORMS - 1]), servicesRaw: safeStr_(r[C.SERVICES - 1]),
    fees: parseFees_(r[C.FEES - 1]),
    // How to work with them, as opposed to what they bought. Built at creation
    // from the deal documents; see Profile.gs.
    profile: safeStr_(r[C.PROFILE - 1]),
    draftId: draftIdForClient_(safeStr_(r[C.ID - 1])),
    planStatus: safeStr_(r[C.PLAN_STATUS - 1]), planDoc: safeStr_(r[C.PLAN_DOC - 1])
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
    .filter(r => String(r[A.ID - 1]).trim() === String(clientId).trim())
    .map(r => {
      const due = parseDate_(r[A.DUE - 1]);
      const open = r[A.STATUS - 1] !== 'Complete' && r[A.STATUS - 1] !== 'N/A';
      // Coerced for the same reason as the client record: one formula error in
      // any of these cells and the whole response serialises to null.
      return {
        task: safeStr_(r[A.TASK - 1]), category: safeStr_(r[A.CATEGORY - 1]),
        method: safeStr_(r[A.METHOD - 1]), needs: safeStr_(r[A.NEEDS - 1]),
        accountId: safeStr_(r[A.ACCOUNT - 1]), status: safeStr_(r[A.STATUS - 1]),
        due: fmtDate_(r[A.DUE - 1]),
        overdueBy: (due && open) ? Math.round((today - midnight_(due)) / 86400000) : 0,
        requested: fmtDate_(r[A.REQUESTED - 1]), completed: fmtDate_(r[A.COMPLETED - 1]),
        owner: safeStr_(r[A.OWNER - 1]), notes: safeStr_(r[A.NOTES - 1]),
        phase: Number(r[A.PHASE - 1]) || 1, gate: r[A.GATE - 1] === true,
        assigned: fmtDate_(r[A.ASSIGNED - 1]),
        // Days since it changed hands, which is a different question from
        // whether it is overdue: work can be assigned for a fortnight and
        // untouched without its due date having passed.
        assignedDays: assignedDays_(r[A.ASSIGNED - 1], open, today)
      };
    });
}

/** Days a task has been sitting with whoever owns it. 0 once it is closed. */
function assignedDays_(v, open, today) {
  if (!open) return 0;
  const d = parseDate_(v);
  if (!d) return 0;
  return Math.max(0, Math.round((today - midnight_(d)) / 86400000));
}

/**
 * Puts a task on somebody, and records when.
 *
 * The stamp only moves when the owner actually changes. Re-picking the same
 * name — which happens every time someone opens the dropdown and closes it —
 * must not reset the clock, or "assigned 9 days ago" quietly becomes "assigned
 * today" and the one number worth having is destroyed by looking at it.
 */
function assignTask(token, clientId, task, owner) {
  checkToken_(token);

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.ACCESS);
  if (!sh || sh.getLastRow() < 2) return { ok: false, message: 'No tasks yet.' };

  const id = String(clientId).trim();
  const want = String(task).trim();
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, A.WIDTH).getValues();

  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][A.ID - 1]).trim() !== id) continue;
    if (String(rows[i][A.TASK - 1]).trim() !== want) continue;

    const now = String(rows[i][A.OWNER - 1] || '').trim();
    const next = String(owner || '').trim();
    if (now === next) return { ok: true, unchanged: true };

    sh.getRange(i + 2, A.OWNER).setValue(next);
    // Unassigning clears the stamp rather than leaving a date against nobody,
    // which would read as "assigned 9 days ago" on an unowned task.
    sh.getRange(i + 2, A.ASSIGNED).setValue(next ? new Date() : '');
    return { ok: true, owner: next, assigned: next ? fmtDate_(new Date()) : '' };
  }
  return { ok: false, message: 'That task is no longer on this client.' };
}

/**
 * Adds a task to a client's checklist by hand.
 *
 * The seeded checklist covers access and the standard onboarding beats. It
 * cannot cover "chase the Shopify dev for the theme file", and a checklist you
 * cannot add to is one people stop using — the real list moves to somebody's
 * notes app and the tool becomes a report of a report.
 *
 * Written straight to the Access tab so it behaves like every other task:
 * assignable, pingable, and counted in the progress rollup.
 */
function addTask(token, clientId, task) {
  checkToken_(token);
  task = task || {};

  const name = String(task.task || '').trim();
  if (!name) return { ok: false, message: 'The task needs a name.' };

  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TABS.ACCESS);
  if (!sh) return { ok: false, message: 'No Access tab yet — run setup().' };

  // A second row with the same name on the same client would make every
  // status write ambiguous: setTaskStatus_ and assignTask both match on it.
  const clash = getClientTasks_(clientId)
    .some(t => t.task.toLowerCase() === name.toLowerCase());
  if (clash) {
    return { ok: false, message: 'This client already has a task called "'
      + name + '". Task names are how status and assignment find their row, so '
      + 'they have to be unique per client.' };
  }

  const phase = Math.min(5, Math.max(1, Number(task.phase) || 1));
  const owner = String(task.owner || '').trim();

  const row = new Array(A.WIDTH).fill('');
  row[A.ID - 1] = clientId;
  row[A.COMPANY - 1] = client.company;
  row[A.TASK - 1] = name;
  row[A.CATEGORY - 1] = String(task.category || 'Manual');
  row[A.METHOD - 1] = 'INTERNAL';
  row[A.NEEDS - 1] = String(task.needs || '');
  row[A.STATUS - 1] = 'Not started';
  row[A.DUE - 1] = task.due ? parseDate_(task.due) || '' : '';
  row[A.OWNER - 1] = owner;
  if (owner) row[A.ASSIGNED - 1] = new Date();
  row[A.NOTES - 1] = String(task.notes || '');
  row[A.PHASE - 1] = phase;
  // Never a gate. A hand-added task that blocks phase progression would stall
  // the client emails, and nobody adding a to-do expects that.
  row[A.GATE - 1] = false;

  sh.getRange(sh.getLastRow() + 1, 1, 1, A.WIDTH).setValues([row]);
  return { ok: true, task: name, phase: phase };
}

/** Removes a task. Only ever one row, because names are unique per client. */
function deleteTask(token, clientId, task) {
  checkToken_(token);

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.ACCESS);
  if (!sh || sh.getLastRow() < 2) return { ok: false, message: 'No tasks.' };

  const id = String(clientId).trim();
  const want = String(task).trim();
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, A.WIDTH).getValues();

  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][A.ID - 1]).trim() !== id) continue;
    if (String(rows[i][A.TASK - 1]).trim() !== want) continue;
    sh.deleteRow(i + 2);
    return { ok: true };
  }
  return { ok: false, message: 'That task is no longer on this client.' };
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
  // Structured, not thrown. A missing row is an ordinary outcome — the record
  // was deleted from the sheet, or two tabs are open on the same client — and
  // the page should say so rather than surfacing a stack trace.
  if (!client) {
    return { ok: false, notFound: true, clientId: clientId,
             message: 'No row for ' + clientId + ' on the Clients tab. It may '
                    + 'have been deleted from the sheet.' };
  }
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
    phaseState: getPhaseState_(clientId),
    assignees: assigneesFor_(client)
  };
}

/**
 * Everyone a task on this client can be put on.
 *
 * Includes the client. A good third of the onboarding checklist is not our
 * work at all — granting access, confirming billing, approving creative — and
 * an unowned row is indistinguishable from one nobody has picked up yet. Naming
 * the client as the owner is what turns "still Not started" into "waiting on
 * them", which is the difference between chasing internally and chasing out.
 *
 * Skills travel with each person so the browser can rank them against the task
 * without a round trip per row: a checklist is twenty rows and twenty calls to
 * work out who does Google Ads is twenty calls too many.
 */
function assigneesFor_(client) {
  const people = getTeam().map(t => ({
    name: t.name, role: t.role, skills: t.skills || [], kind: 'team'
  }));

  const who = safeStr_(client.contact) || safeStr_(client.company) || 'Client';
  people.push({ name: who, role: 'Client contact', skills: [], kind: 'client' });
  return people;
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

/**
 * Removes a client and everything generated for it.
 *
 * There was no way to undo a Create client except editing the spreadsheet by
 * hand, which is a poor answer for a mistyped company name and a worse one
 * while testing. Deleting the row alone is not enough either — the task rows
 * and the intake row keep the client ID and reattach themselves to the next
 * client that happens to be given the same one.
 *
 * The DRAFT is deliberately kept, along with its Drive folder. The documents
 * are the record of the deal; deleting the client is undoing a data-entry step,
 * not discarding a signed contract. The draft goes back to Analysed so it shows
 * up in the resume list and can produce a client again.
 */
function deleteClient(token, clientId) {
  checkToken_(token);
  if (!clientId) return { ok: false, message: 'No client ID given.' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const id = String(clientId).trim();
  const removed = { tasks: 0, intake: 0, plans: 0 };

  // Bottom-up: deleting a row shifts everything below it up, and a descending
  // walk means the indexes gathered above stay valid.
  const purge = (tabName, col) => {
    const sh = ss.getSheetByName(tabName);
    if (!sh || sh.getLastRow() < 2) return 0;
    const vals = sh.getRange(2, col, sh.getLastRow() - 1, 1).getValues();
    let n = 0;
    for (let i = vals.length - 1; i >= 0; i--) {
      if (String(vals[i][0]).trim() === id) { sh.deleteRow(i + 2); n++; }
    }
    return n;
  };

  const row = clientRowNumber_(id);
  if (!row) return { ok: false, message: 'No row for ' + id + ' on the Clients tab.' };

  removed.tasks = purge(TABS.ACCESS, A.ID);
  removed.intake = purge(TABS.INTAKE, 1);
  removed.plans = purge(TABS.PLANS, 1);
  ss.getSheetByName(TABS.CLIENTS).deleteRow(row);

  // The draft outlives the client it made. Unstamp it so it stops pointing at
  // a record that no longer exists.
  let draftFreed = '';
  try {
    const draftId = draftIdForClient_(id);
    if (draftId) {
      saveDraft(draftId, { clientId: '', status: 'Analysed' });
      draftFreed = draftId;
    }
  } catch (e) { /* the client is gone either way */ }

  return { ok: true, clientId: id, removed: removed, draftFreed: draftFreed };
}

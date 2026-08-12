/**
 * LOCKHERN ONBOARDING CRM — Recent context
 *
 * The last few calls, and anything that has changed since the deal documents
 * were written.
 *
 * The client profile is built once from the sales and kickoff calls and is
 * deliberately stable — it is how to work with someone, and rewriting it every
 * week would make it something nobody trusts. But an account moves: a promo
 * changes, a contact leaves, a target gets revised on a Tuesday call. That
 * belongs somewhere dated and additive, next to the profile rather than inside
 * it.
 *
 * Stored as JSON in one cell (C.RECENT) rather than a tab. It is per-client,
 * read and written whole, and never queried across clients — which is a cell,
 * not a table.
 */

const RECENT_CALL_LIMIT = 4;
const RECENT_NOTE_LIMIT = 12;

// ---------------------------------------------------------------- READ

function getRecentContext(clientId) {
  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };

  const box = readRecent_(clientId);
  return {
    ok: true,
    calls: box.calls || [],
    notes: box.notes || [],
    scanned: box.scanned || '',
    // Whether the daily scan is actually running, because "no calls" and "the
    // scan has never run" look identical and have different fixes.
    scanInstalled: hasCallScanTrigger_()
  };
}

function readRecent_(clientId) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.CLIENTS);
  if (!sh || sh.getLastRow() < 2) return {};

  const ids = sh.getRange(2, C.ID, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() !== String(clientId).trim()) continue;
    const raw = sh.getRange(i + 2, C.RECENT).getValue();
    if (!raw) return {};
    try { return JSON.parse(String(raw)) || {}; } catch (e) { return {}; }
  }
  return {};
}

function writeRecent_(clientId, box) {
  setClientField_(clientId, C.RECENT, JSON.stringify(box));
}

// ---------------------------------------------------------------- NOTES

/**
 * Adds a dated line of context.
 *
 * Append-only and capped. A note that corrects an earlier one sits below it
 * rather than replacing it, because "the promo changed again" is itself the
 * useful signal and an overwritten history hides it.
 */
function addRecentNote(token, clientId, text) {
  checkToken_(token);

  const note = String(text || '').trim();
  if (!note) return { ok: false, message: 'Nothing to add.' };

  const box = readRecent_(clientId);
  box.notes = box.notes || [];
  box.notes.unshift({
    at: fmtDate_(new Date()),
    text: note.length > 600 ? note.slice(0, 599) + '…' : note,
    by: (Session.getActiveUser().getEmail() || '').split('@')[0] || ''
  });
  box.notes = box.notes.slice(0, RECENT_NOTE_LIMIT);

  writeRecent_(clientId, box);
  return { ok: true, notes: box.notes };
}

function deleteRecentNote(token, clientId, index) {
  checkToken_(token);

  const box = readRecent_(clientId);
  const i = Number(index);
  if (!box.notes || !box.notes[i]) {
    return { ok: false, message: 'That note is already gone.' };
  }
  box.notes.splice(i, 1);
  writeRecent_(clientId, box);
  return { ok: true, notes: box.notes };
}

// ---------------------------------------------------------------- SCAN

/**
 * Finds recent ClickUp calls for every live client, in one pass.
 *
 * The per-client scan reads every recent doc to match one client. Running that
 * once per client would read the same forty documents forty times — so the
 * documents are fetched ONCE here and matched against every client in memory.
 * That is the difference between a daily job that finishes and one that burns
 * the URL fetch quota by ten in the morning.
 *
 * Installed on a daily trigger. Also safe to run by hand from the menu.
 */
function scanRecentCalls() {
  const token = PropertiesService.getScriptProperties()
    .getProperty('CLICKUP_API_TOKEN');
  if (!token) return { ok: false, message: 'No ClickUp API token set.' };

  const ws = clickUpWorkspaceId_();
  if (!ws.ok) return ws;

  const list = clickUpRecentDocs_(ws.id);
  if (!list.ok) return list;

  // Read each document once, keeping the text for the matching pass below.
  const docs = [];
  list.docs.slice(0, CLICKUP_SCAN_LIMIT).forEach(d => {
    let text = '';
    try { text = clickUpDocText_(ws.id, d.id); } catch (e) { return; }
    if (text) docs.push({ id: d.id, name: d.name, updated: d.updated,
                          hay: text.toLowerCase() });
  });

  const clients = liveClients_();
  const stamp = fmtDate_(new Date());
  let touched = 0;

  clients.forEach(c => {
    const terms = matchTerms_(c);
    if (!terms.length) return;

    const hits = docs
      .filter(d => terms.some(t => d.hay.indexOf(t) !== -1))
      .sort((a, b) => b.updated - a.updated)
      .slice(0, RECENT_CALL_LIMIT)
      .map(d => ({
        docId: d.id,
        name: d.name || 'Untitled',
        at: d.updated ? fmtDate_(new Date(Number(d.updated))) : '',
        url: 'https://app.clickup.com/' + ws.id + '/docs/' + d.id
      }));

    const box = readRecent_(c.clientId);
    box.scanned = stamp;
    box.calls = hits;
    writeRecent_(c.clientId, box);
    touched++;
  });

  return { ok: true, docsRead: docs.length, clients: touched, scanned: stamp };
}

/** Clients worth scanning: on the books and not finished with. */
function liveClients_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.CLIENTS);
  if (!sh || sh.getLastRow() < 2) return [];

  return sh.getRange(2, 1, sh.getLastRow() - 1, C.WIDTH).getValues()
    .filter(r => r[C.ID - 1])
    .map(r => ({
      clientId: safeStr_(r[C.ID - 1]),
      company: safeStr_(r[C.COMPANY - 1]),
      contact: safeStr_(r[C.CONTACT - 1]),
      status: safeStr_(r[C.STATUS - 1])
    }))
    .filter(c => c.status !== 'Churned' && c.status !== 'Paused');
}

// ---------------------------------------------------------------- TRIGGER

const CALL_SCAN_HANDLER = 'scanRecentCalls';

function hasCallScanTrigger_() {
  return ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === CALL_SCAN_HANDLER);
}

/**
 * Runs the scan every morning.
 *
 * Removes any existing one first: installing twice is easy to do from a menu
 * and doubles the fetch cost for no benefit.
 */
function installCallScanTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === CALL_SCAN_HANDLER) ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger(CALL_SCAN_HANDLER).timeBased().atHour(7).everyDays(1).create();

  const ui = SpreadsheetApp.getUi();
  ui.alert('Daily call scan enabled. It runs each morning around 7am, reads '
    + 'recent ClickUp meeting docs once, and files the latest '
    + RECENT_CALL_LIMIT + ' against every live client.');
}

/** Menu: run it now and say what happened, rather than failing silently. */
function scanRecentCallsNow() {
  const ui = SpreadsheetApp.getUi();
  const r = scanRecentCalls();
  ui.alert(r.ok
    ? 'Read ' + r.docsRead + ' recent docs and updated ' + r.clients + ' clients.'
    : ('Scan failed: ' + r.message));
}

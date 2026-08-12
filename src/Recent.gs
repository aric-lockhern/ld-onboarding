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
    // For the date field on the add-a-call form: a blank box invites a format
    // guess, and every call filed under a different one makes the list unsortable.
    today: fmtDate_(new Date()),
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

// ---------------------------------------------------------------- CALLS

/**
 * A call that did not come from ClickUp.
 *
 * The notetaker covers most of them and the daily scan files those. The rest
 * are real and regular: a call someone recorded to a Google Doc, a transcript
 * mailed over by the client, a summary typed up from notes because nothing
 * recorded it at all. Before this they had nowhere to go — the scan only ever
 * writes what ClickUp knows about, so the only route in was to paste the whole
 * thing into a note, where the profile and the action items never read it.
 *
 * It is stored on the draft as a document like any other, for the reason in
 * ClickUpSync.gs: the draft is the deal's document record, and a call filed
 * anywhere else is a call nobody finds.
 *
 * `raw` takes whatever the intake form takes — pasted text, a Google Doc link,
 * a ClickUp link, an uploaded file — because resolveSource_ already knows how
 * to read all of them and a second, worse reader is not worth having.
 */
function addManualCall(token, clientId, label, raw, when) {
  checkToken_(token);

  const name = String(label || '').trim() || 'Call';
  if (!raw || (typeof raw === 'string' && !raw.trim())) {
    return { ok: false, message: 'Nothing supplied — paste the transcript or '
      + 'give a link to it.' };
  }

  const draftId = draftIdForClient_(clientId);
  if (!draftId) {
    return { ok: false, message: 'This client has no draft, so there is nowhere '
      + 'to file the transcript. The draft it was created from may have been '
      + 'deleted.' };
  }

  let text;
  try {
    text = resolveSource_(raw);
  } catch (e) {
    return { ok: false, message: (e && e.message) || String(e) };
  }

  text = String(text || '').trim();
  if (!text) {
    return { ok: false, message: 'That read as empty. If the content sits on a '
      + 'page the link does not point at, open it, select all, and paste the '
      + 'text in instead.' };
  }

  const at = String(when || '').trim() || fmtDate_(new Date());
  const key = manualCallKey_(name, at);

  let record;
  try {
    record = storeSource_(draftId, key, name, text, {
      via: sourceKindLabel_(raw),
      origin: (typeof raw === 'string') ? raw : '',
      words: text.split(/\s+/).length,
      preview: text.slice(0, 240).replace(/\s+/g, ' ').trim()
    });
  } catch (e) {
    return { ok: false, message: 'Read ' + text.length + ' characters but could '
      + 'not save them: ' + ((e && e.message) || String(e)) };
  }

  const box = readRecent_(clientId);
  box.calls = (box.calls || []).filter(c => c.key !== key);
  box.calls.unshift({
    key: key,
    name: name,
    at: at,
    // A link when there was one to keep; otherwise the Drive copy, which is
    // the only place the pasted version exists.
    url: (typeof raw === 'string' && /^https?:\/\//i.test(raw.trim()))
      ? raw.trim()
      : 'https://drive.google.com/file/d/' + record.fileId + '/view',
    chars: text.length,
    // What stops the daily scan from wiping it — see mergeCalls_.
    source: 'manual'
  });
  box.calls = mergeCalls_(box.calls, []);
  writeRecent_(clientId, box);

  return { ok: true, key: key, label: name, chars: text.length,
           words: text.split(/\s+/).length, calls: box.calls };
}

/**
 * Takes a call off the list.
 *
 * The stored document is left in the draft's Drive folder on purpose. Removing
 * a wrong entry from a list of four is a tidy-up; deleting the transcript
 * somebody pasted in is a different act, and the two should not share a button.
 */
function deleteRecentCall(token, clientId, key) {
  checkToken_(token);

  const box = readRecent_(clientId);
  const before = (box.calls || []).length;
  box.calls = (box.calls || []).filter(c => String(c.key || c.docId) !== String(key));
  if (box.calls.length === before) {
    return { ok: false, message: 'That call is already off the list.' };
  }

  writeRecent_(clientId, box);
  return { ok: true, calls: box.calls };
}

/**
 * A key that is stable for the same call and distinct from another one.
 *
 * Re-pasting a transcript after fixing it should update the stored copy rather
 * than file a second one beside it, so the key comes from what the person
 * typed. Two calls genuinely called "Check-in" a fortnight apart are two calls,
 * which is why the date is in it.
 */
function manualCallKey_(label, at) {
  const slug = (label + '-' + at).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return 'call_' + (slug || 'call');
}

/** Imported calls, whatever filed them. Audit.gs reads both prefixes. */
function isImportedCallKey_(key) {
  const k = String(key || '');
  return k.indexOf('cu_') === 0 || k.indexOf('call_') === 0;
}

/**
 * The call list after a scan.
 *
 * Manually added calls are kept whatever the scan finds. The scan writes what
 * ClickUp happens to know about, and letting it overwrite the list would mean a
 * transcript somebody pasted in on Monday quietly disappearing on Tuesday
 * morning — with the document still on the draft and nothing on screen saying
 * where it went.
 */
function mergeCalls_(existing, scanned) {
  const manual = (existing || []).filter(c => c && c.source === 'manual');
  const seen = {};
  manual.forEach(c => { seen[c.key] = true; });

  const room = Math.max(RECENT_CALL_LIMIT - manual.length, 0);
  const fresh = (scanned || []).filter(c => !seen[c.docId] && !seen[c.key])
                               .slice(0, room);

  return manual.concat(fresh);
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
        url: 'https://app.clickup.com/' + ws.id + '/docs/' + d.id,
        source: 'clickup'
      }));

    const box = readRecent_(c.clientId);
    box.scanned = stamp;
    // Not `= hits`. Anything filed by hand stays — see mergeCalls_.
    box.calls = mergeCalls_(box.calls, hits);
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

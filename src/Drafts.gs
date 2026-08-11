/**
 * LOCKHERN ONBOARDING CRM — Draft clients
 *
 * A draft is everything gathered about a deal before it becomes a client
 * record: the documents, the text pulled out of them, what the model made of
 * that text, and whatever has been typed into the form since.
 *
 * It exists so that reading the documents is done once. Re-running the analysis
 * after tweaking a source, coming back tomorrow, or correcting a fee three
 * weeks after the client was created should never mean re-uploading a scope of
 * work. The documents live in Drive from the first read onward, and the draft
 * row points at them.
 *
 * A draft survives submission. "Submitted" is a status, not a delete — the deal
 * documents stay attached to the client they produced, which is where you want
 * them when someone asks in November what was actually agreed.
 */

/** 1-based columns on the Drafts tab. */
const D = {
  ID: 1, NAME: 2, CREATED: 3, UPDATED: 4, STATUS: 5, CLIENT: 6,
  FOLDER: 7, SOURCES: 8, EXTRACTION: 9, FORM: 10, WIDTH: 10
};

/** Where per-draft folders are created, under the configured Drive root. */
const DRAFTS_FOLDER_NAME = '_Onboarding drafts';

/**
 * A cell holds 50,000 characters. Extraction JSON runs about 8KB because every
 * field drags a quote along, so this is headroom rather than a real ceiling —
 * but silently storing a truncated JSON would produce a draft that reopens with
 * fields missing and no explanation.
 */
const CELL_JSON_LIMIT = 45000;

// ---------------------------------------------------------------- PUBLIC

/**
 * Starts a draft and its Drive folder. Called before the first source is read,
 * so every document has somewhere to land.
 */
function createDraft(name) {
  const sh = draftsTab_();
  const now = new Date();
  const draftId = 'DR-' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyMMdd-HHmmss');
  const label = String(name || '').trim() || 'Untitled draft';

  let folderId = '';
  try {
    folderId = draftFolder_(draftId, label).getId();
  } catch (e) {
    // A draft without a folder still works for pasted text; it is only uploads
    // and re-analysis that need somewhere durable. Say so rather than failing.
    folderId = '';
  }

  const vals = new Array(D.WIDTH).fill('');
  vals[D.ID - 1] = draftId;
  vals[D.NAME - 1] = label;
  vals[D.CREATED - 1] = now;
  vals[D.UPDATED - 1] = now;
  vals[D.STATUS - 1] = 'Draft';
  vals[D.FOLDER - 1] = folderId;
  vals[D.SOURCES - 1] = '[]';

  sh.getRange(sh.getLastRow() + 1, 1, 1, D.WIDTH).setValues([vals]);
  return { ok: true, draftId: draftId, name: label, folderId: folderId,
           folderMissing: !folderId };
}

/** Every draft, newest first, for the resume list. */
function listDrafts() {
  const sh = draftsTab_();
  if (sh.getLastRow() < 2) return { ok: true, drafts: [] };

  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, D.WIDTH).getValues();
  const out = rows.filter(r => r[D.ID - 1]).map(r => {
    const sources = safeParse_(r[D.SOURCES - 1], []);
    return {
      draftId: String(r[D.ID - 1]),
      name: String(r[D.NAME - 1] || 'Untitled draft'),
      created: fmtWhen_(r[D.CREATED - 1]),
      updated: fmtWhen_(r[D.UPDATED - 1]),
      updatedAt: r[D.UPDATED - 1] instanceof Date ? r[D.UPDATED - 1].getTime() : 0,
      status: String(r[D.STATUS - 1] || 'Draft'),
      clientId: String(r[D.CLIENT - 1] || ''),
      sourceCount: sources.filter(s => s && s.fileId).length,
      analysed: !!String(r[D.EXTRACTION - 1] || '')
    };
  });

  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return { ok: true, drafts: out };
}

/**
 * Everything needed to resume: the stored sources with their Drive pointers,
 * the last extraction, and whatever was typed into the form.
 */
function openDraft(draftId) {
  const found = draftRow_(draftId);
  if (!found) return { ok: false, message: 'That draft no longer exists.' };
  const r = found.values;

  const sources = safeParse_(r[D.SOURCES - 1], []);
  const missing = [];
  sources.forEach(s => {
    if (s && s.fileId && !driveFileExists_(s.fileId)) {
      missing.push(s.label || s.key);
      s.gone = true;
    }
  });

  return {
    ok: true,
    draftId: draftId,
    name: String(r[D.NAME - 1] || 'Untitled draft'),
    status: String(r[D.STATUS - 1] || 'Draft'),
    clientId: String(r[D.CLIENT - 1] || ''),
    folderId: String(r[D.FOLDER - 1] || ''),
    folderUrl: r[D.FOLDER - 1] ? 'https://drive.google.com/drive/folders/' + r[D.FOLDER - 1] : '',
    updated: fmtWhen_(r[D.UPDATED - 1]),
    sources: sources,
    extraction: safeParse_(r[D.EXTRACTION - 1], null),
    form: safeParse_(r[D.FORM - 1], null),
    missing: missing
  };
}

/**
 * Patches a draft in place. Only the keys supplied are written, so saving form
 * values does not disturb the sources and vice versa.
 *
 * @param {string} draftId
 * @param {Object} patch  { name, status, clientId, form, extraction, sources }
 */
function saveDraft(draftId, patch) {
  const found = draftRow_(draftId);
  if (!found) return { ok: false, message: 'That draft no longer exists.' };
  patch = patch || {};

  const sh = draftsTab_();
  const row = found.row;

  if (patch.name != null) sh.getRange(row, D.NAME).setValue(String(patch.name));
  if (patch.status != null) sh.getRange(row, D.STATUS).setValue(String(patch.status));
  if (patch.clientId != null) sh.getRange(row, D.CLIENT).setValue(String(patch.clientId));

  const oversized = [];
  [['form', D.FORM], ['extraction', D.EXTRACTION], ['sources', D.SOURCES]].forEach(pair => {
    if (patch[pair[0]] === undefined) return;
    const json = patch[pair[0]] === null ? '' : JSON.stringify(patch[pair[0]]);
    if (json.length > CELL_JSON_LIMIT) { oversized.push(pair[0]); return; }
    sh.getRange(row, pair[1]).setValue(json);
  });

  sh.getRange(row, D.UPDATED).setValue(new Date());

  if (oversized.length) {
    return { ok: false, message: 'Too large to store: ' + oversized.join(', ')
      + '. The rest of the draft was saved.' };
  }
  return { ok: true, saved: fmtWhen_(new Date()) };
}

/** Removes the row. The Drive folder is trashed, not purged, so it is recoverable. */
function deleteDraft(draftId) {
  const found = draftRow_(draftId);
  if (!found) return { ok: true };

  const folderId = String(found.values[D.FOLDER - 1] || '');
  if (folderId) {
    try { DriveApp.getFolderById(folderId).setTrashed(true); } catch (e) { /* already gone */ }
  }
  draftsTab_().deleteRow(found.row);
  return { ok: true };
}

/** Renames the draft and its folder together, so Drive stays navigable. */
function renameDraft(draftId, name) {
  const found = draftRow_(draftId);
  if (!found) return { ok: false, message: 'That draft no longer exists.' };
  const label = String(name || '').trim() || 'Untitled draft';

  const folderId = String(found.values[D.FOLDER - 1] || '');
  if (folderId) {
    try {
      DriveApp.getFolderById(folderId).setName(label + ' (' + draftId + ')');
    } catch (e) { /* the row is the source of truth; the folder name is a convenience */ }
  }
  return saveDraft(draftId, { name: label });
}

// ---------------------------------------------------------------- STORAGE

/**
 * Writes one source's extracted text into the draft folder and records it.
 *
 * Returns the Drive file ID, which is what runExtraction reads from later. The
 * original upload is kept alongside when there is one — the text is what gets
 * analysed, but the PDF is what someone will want to look at in six months.
 */
function storeSource_(draftId, key, label, text, meta) {
  const found = draftRow_(draftId);
  if (!found) throw new Error('That draft no longer exists.');
  meta = meta || {};

  const folderId = String(found.values[D.FOLDER - 1] || '');
  if (!folderId) throw new Error('This draft has no Drive folder, so documents '
    + 'cannot be stored. Check the Drive Root Folder ID on the Config tab.');

  const folder = DriveApp.getFolderById(folderId);

  // Replace rather than accumulate: re-reading a source should leave one file,
  // not a pile of near-identical ones.
  const sources = safeParse_(found.values[D.SOURCES - 1], []);
  const prior = sources.filter(s => s && s.key === key)[0];
  if (prior) {
    [prior.fileId, prior.originalId].forEach(id => {
      if (!id) return;
      try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* already gone */ }
    });
  }

  const textFile = folder.createFile(key + '.txt', text, MimeType.PLAIN_TEXT);

  let originalId = '';
  let originalMime = '';
  if (meta.original && meta.original.data) {
    try {
      originalMime = meta.original.mimeType || 'application/octet-stream';
      const blob = Utilities.newBlob(
        Utilities.base64Decode(meta.original.data), originalMime,
        meta.original.name || key);
      originalId = folder.createFile(blob).getId();
    } catch (e) { originalId = ''; originalMime = ''; }
  }

  const record = {
    key: key, label: label, via: meta.via || '', origin: meta.origin || '',
    fileId: textFile.getId(), originalId: originalId,
    originalName: (meta.original && meta.original.name) || '',
    // Kept because a PDF is re-attached to the model on every analysis, not
    // just converted once — see runExtraction.
    originalMime: originalMime,
    chars: text.length, words: meta.words || 0,
    preview: meta.preview || '', read: fmtWhen_(new Date())
  };

  const next = sources.filter(s => s && s.key !== key);
  next.push(record);
  saveDraft(draftId, { sources: next });
  return record;
}

/** Reads a stored source back. Returns '' when the file has been deleted. */
function readStored_(fileId) {
  if (!fileId) return '';
  try {
    return DriveApp.getFileById(fileId).getBlob().getDataAsString();
  } catch (e) {
    return '';
  }
}

/**
 * The original upload as base64, for attaching to the model.
 *
 * Returns '' rather than throwing when the file is gone: losing the visual
 * layer should degrade the analysis to text-only, not fail it.
 */
function readStoredBytes_(fileId) {
  if (!fileId) return '';
  try {
    return Utilities.base64Encode(DriveApp.getFileById(fileId).getBlob().getBytes());
  } catch (e) {
    return '';
  }
}

function driveFileExists_(fileId) {
  try {
    return !DriveApp.getFileById(fileId).isTrashed();
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------- INTERNALS

function draftsTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(TABS.DRAFTS);
  if (!sh) {
    // setup() creates this, but a sheet installed before drafts existed would
    // otherwise fail on the first new client rather than repairing itself.
    sh = mkTab_(ss, TABS.DRAFTS, DRAFT_HEADERS);
  }
  return sh;
}

/**
 * The draft a client came from, so its documents can be re-read long after.
 *
 * Returns '' when the draft was deleted — the profile can then only be written
 * by hand, which is the cost of deleting the record of a deal.
 */
/**
 * The draft's call transcript and contract text, for the Intake tab.
 *
 * generatePlan_ reads that tab, not the draft, so without this the onboarding
 * plan is written from the client record alone — no transcript, no contract —
 * for a deal whose documents are all sitting in Drive. The kickoff call is
 * preferred over the sales call: it is the one that settled how the work
 * actually runs.
 */
function draftContext_(draftId) {
  const out = { transcript: '', contract: '' };
  if (!draftId) return out;

  const d = openDraft(draftId);
  if (!d || !d.ok) return out;

  const byKey = {};
  (d.sources || []).forEach(s => { if (s && s.fileId) byKey[s.key] = s.fileId; });

  const pick = keys => {
    for (let i = 0; i < keys.length; i++) {
      const text = readStored_(byKey[keys[i]]);
      if (text && text.trim()) return text;
    }
    return '';
  };

  out.transcript = pick(['kickoff', 'sales']);
  out.contract = pick(['sow', 'deck', 'form']);
  return out;
}

function draftIdForClient_(clientId) {
  if (!clientId) return '';
  const sh = draftsTab_();
  if (sh.getLastRow() < 2) return '';

  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, D.WIDTH).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][D.CLIENT - 1]) === String(clientId)) {
      return String(rows[i][D.ID - 1]);
    }
  }
  return '';
}

function draftRow_(draftId) {
  if (!draftId) return null;
  const sh = draftsTab_();
  if (sh.getLastRow() < 2) return null;

  const ids = sh.getRange(2, D.ID, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(draftId)) {
      const row = i + 2;
      return { row: row, values: sh.getRange(row, 1, 1, D.WIDTH).getValues()[0] };
    }
  }
  return null;
}

function draftFolder_(draftId, name) {
  const rootId = cfg('Drive Root Folder ID');
  const root = rootId ? DriveApp.getFolderById(rootId) : DriveApp.getRootFolder();

  let parent = null;
  const existing = root.getFoldersByName(DRAFTS_FOLDER_NAME);
  parent = existing.hasNext() ? existing.next() : root.createFolder(DRAFTS_FOLDER_NAME);

  return parent.createFolder(name + ' (' + draftId + ')');
}

/** JSON in a cell is user-visible and therefore user-editable. Degrade, don't throw. */
function safeParse_(raw, fallback) {
  const s = String(raw || '').trim();
  if (!s) return fallback;
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

function fmtWhen_(d) {
  if (!(d instanceof Date)) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'd MMM, HH:mm');
}

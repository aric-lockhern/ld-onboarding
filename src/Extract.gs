/**
 * LOCKHERN ONBOARDING CRM — Source ingestion and AI extraction
 *
 * Step one of the new-client flow. Takes the documents that already exist by
 * the time a deal closes — sales call, kickoff call, scope of work — and turns
 * them into a pre-filled intake form.
 *
 * Named Extract.gs, not Intake.gs: Intake.html already claims the name "Intake"
 * and Apps Script drops extensions, so an Intake.gs would fail the push. See
 * CLAUDE.md rule 0.
 *
 * Every extracted field carries the sentence it came from. That is the whole
 * point — a value you can check against its own source in one glance is worth
 * more than a value you have to go hunting for, and this thing will sometimes
 * be wrong about money.
 *
 * READING IS SEPARATE FROM ANALYSING. `readSource` fetches exactly one document
 * and reports what it got; `runExtraction` sends the ones that worked to the
 * model. They are split because fetching is the step that fails — a ClickUp
 * permission, a scanned PDF, a deck that was never shared — and a single
 * combined call can only report "it didn't work" for the whole set. Split, a
 * failure is attributable to one document, and that document alone can be
 * retried, replaced or skipped while the others keep their result.
 */

const CLICKUP_API = 'https://api.clickup.com/api/v3';
const CLICKUP_API_V2 = 'https://api.clickup.com/api/v2';

/** Labels for the sources, in the order they get sent to the model. */
const SOURCE_KINDS = [
  { key: 'sales', label: 'Sales call transcript' },
  { key: 'kickoff', label: 'Onboarding / kickoff call transcript' },
  { key: 'sow', label: 'Scope of work' },
  { key: 'form', label: 'ClickUp onboarding form' },
  { key: 'deck', label: 'Pitch deck' }
];

// ---------------------------------------------------------------- READ ONE

/**
 * Fetches a single source, stores it on the draft, and reports what came back.
 * Callable from App.html.
 *
 * Never throws: a failure is a returned object with `ok:false`, because the UI
 * needs the reason next to that document's row, not a rejected promise for the
 * whole batch.
 *
 * The text lands in the draft's Drive folder rather than in a cache, so it is
 * still there tomorrow. Re-analysing after changing one source, or correcting a
 * fee weeks after the client was created, never costs another upload.
 *
 * @param {string} key  one of SOURCE_KINDS
 * @param {string|Object} raw  pasted text, a URL, or { name, mimeType, data }
 * @param {string} draftId  the draft to store it against
 * @return {Object} { ok, key, label, via, chars, words, preview, fileId, warn }
 *                  or { ok:false, error, hint }
 */
function readSource(key, raw, draftId) {
  const kind = SOURCE_KINDS.filter(k => k.key === key)[0];
  const label = kind ? kind.label : String(key);
  const via = sourceKindLabel_(raw);

  if (!raw || (typeof raw === 'string' && !raw.trim())) {
    return { ok: false, key: key, label: label, via: via, empty: true,
             error: 'Nothing supplied for this source.' };
  }

  // Before fetching, not after. A ClickUp doc or a 60,000-character transcript
  // costs real time to pull, and discovering the draft is gone only once there
  // is something to save throws that work away — which is what a deleted draft
  // used to look like: five rows, each reporting how much it had read and then
  // lost. The client starts a fresh draft on this flag and reads again.
  if (!draftId || !draftRow_(draftId)) {
    return { ok: false, draftGone: true, key: key, label: label, via: via,
             error: 'The draft this was being saved to no longer exists.',
             hint: 'Retry — a new draft will be started automatically.' };
  }

  let text;
  try {
    text = resolveSource_(raw);
  } catch (e) {
    const msg = (e && e.message) || String(e);
    return { ok: false, key: key, label: label, via: via,
             error: msg, hint: hintFor_(msg) };
  }

  text = String(text || '').trim();
  if (!text) {
    return { ok: false, key: key, label: label, via: via,
             error: 'Read successfully but the document was empty.',
             hint: 'If the content sits on a page the link does not point at, '
                 + 'open the document, select all, and paste the text in.' };
  }

  // A transcript that reads as three sentences usually means the fetch found a
  // stub — a cover page, an empty doc — rather than the thing itself. Worth
  // saying now, while re-linking is cheap.
  const words = text.split(/\s+/).length;
  let warn = '';
  if (words < 120) {
    warn = 'Only ' + words + ' words. Check this is the full document and not a '
         + 'cover page or a link to it.';
  } else if (looksPriceless_(key, text)) {
    warn = 'No prices in the text — the fee table is probably an image. '
         + (raw && typeof raw === 'object' && isAttachable_(raw.mimeType)
             ? 'The file itself will be sent to Claude so it can read the page.'
             : 'Upload the original PDF instead of pasting the text, so Claude '
               + 'can see the page.');
  }

  let record;
  try {
    record = storeSource_(draftId, key, label, text, {
      via: via,
      origin: (typeof raw === 'string') ? raw : '',
      original: (raw && typeof raw === 'object' && raw.data) ? raw : null,
      words: words,
      preview: text.slice(0, 240).replace(/\s+/g, ' ').trim()
    });
  } catch (e) {
    return { ok: false, key: key, label: label, via: via,
             error: 'Read ' + text.length + ' characters but could not save them '
                  + 'to the draft: ' + ((e && e.message) || String(e)),
             hint: 'Retry. If it keeps failing, check the Drive Root Folder ID '
                 + 'on the Config tab.' };
  }

  return {
    ok: true, key: key, label: label, via: via,
    fileId: record.fileId, originalName: record.originalName,
    // Handed back so the UI can pass them to runExtraction, which re-reads the
    // original from Drive on every analysis rather than holding bytes anywhere.
    originalId: record.originalId, originalMime: record.originalMime,
    chars: record.chars, words: words, preview: record.preview, warn: warn
  };
}

// ---------------------------------------------------------------- ANALYSE

/**
 * Sends the stored sources to the model and saves the result on the draft.
 *
 * Reads straight from Drive rather than from anything the browser is holding,
 * which is what makes "re-analyse" work on a draft opened a week later without
 * a single file being uploaded again.
 *
 * @param {Array} items  [{ key, fileId }] — from readSource or a reopened draft
 * @param {string} draftId  where to save the extraction
 * @return {Object} the extraction, or { ok:false, message }
 */
function runExtraction(items, draftId) {
  items = items || [];
  if (!items.length) return { ok: false, message: 'No sources to analyse.' };

  const docs = [];
  const missing = [];
  const attached = [];
  const notAttached = [];
  let attachedBytes = 0;

  items.forEach(it => {
    const kind = SOURCE_KINDS.filter(k => k.key === it.key)[0];
    const label = kind ? kind.label : String(it.key);
    const text = readStored_(it.fileId);
    if (!text || !text.trim()) { missing.push(label); return; }

    const doc = { key: it.key, label: label, text: text };

    // A PDF goes to the model as a PDF, not only as the text scraped out of it.
    // A fee table exported as an image has no text layer, so extraction returns
    // the sentence introducing it and then stops — and nothing about the result
    // looks wrong, because the other nine pages came through fine. Attaching the
    // file lets the model read the page.
    if (it.originalId && isAttachable_(it.originalMime)
        && attachedBytes < MAX_ATTACH_BYTES) {
      const b64 = readStoredBytes_(it.originalId);
      // base64 inflates by 4/3; this is the wire size, which is what counts.
      if (b64 && (attachedBytes + b64.length) <= MAX_ATTACH_BYTES) {
        doc.attach = { mimeType: it.originalMime, data: b64, label: label };
        attachedBytes += b64.length;
        attached.push(label);
      } else {
        notAttached.push({ label: label, reason: b64
          ? 'too large once the other attachments were counted'
          : 'the stored original could not be read back from Drive' });
      }
    } else if (!it.originalId) {
      // Pasted text and links have no original to send, so a fee table that is
      // an image is simply not there. Worth naming when the fees come back empty.
      notAttached.push({ label: label,
        reason: 'no original file — this source was pasted or linked, so only '
              + 'its text exists' });
    } else {
      notAttached.push({ label: label,
        reason: 'stored as ' + (it.originalMime || 'an unknown type')
              + ', which cannot be sent as a page' });
    }
    docs.push(doc);
  });

  if (!docs.length) {
    return { ok: false, missingAll: true, missing: missing,
             message: 'None of the stored documents could be read back from '
                    + 'Drive. They may have been deleted — read the sources again.' };
  }

  // Character budget, then trim, so the model never silently loses the middle of
  // a transcript without the UI being able to say so.
  const budget = allocateBudget_(docs, PROMPT_CHAR_BUDGET);
  const trimmed = [];
  docs.forEach((d, i) => {
    if (d.text.length > budget[i]) {
      trimmed.push({ label: d.label, from: d.text.length, to: budget[i] });
      d.text = trimForPrompt_(d.text, budget[i]);
    }
  });

  let out;
  try {
    out = callAnthropic_(buildExtractPrompt_(docs), { maxTokens: EXTRACT_MAX_TOKENS });
  } catch (e) {
    return { ok: false, message: (e && e.message) || String(e),
             trimmed: trimmed, missing: missing };
  }

  // The fee table is the one thing that is routinely a picture, and in a prompt
  // asking for fifteen other fields it is easy for the model to answer from the
  // transcription and move on. When the main pass comes back with no fees and
  // there are pages to look at, ask again with nothing else to do.
  let feePass = '';
  if (!hasFees_(out.fees) && docs.some(d => d.attach)) {
    try {
      const again = callAnthropic_(buildFeePrompt_(docs), { maxTokens: 2000 });
      if (hasFees_(again && again.fees)) {
        out.fees = again.fees;
        // The total comes from the same reading as the lines, so take it too
        // rather than leaving MRR blank under a populated fee table.
        out.fields = out.fields || {};
        if (again.mrr && Number(again.mrr.value)) out.fields.mrr = again.mrr;
        feePass = 'second';
      } else {
        feePass = 'second-empty';
      }
    } catch (e) {
      feePass = 'second-failed';
    }
  }

  const result = {
    ok: true,
    feePass: feePass,
    notAttached: notAttached,
    fields: out.fields || {},
    platforms: out.platforms || null,
    services: out.services || null,
    fees: out.fees || null,
    conflicts: out.conflicts || [],
    openQuestions: out.openQuestions || [],
    // Anything sold that has no matching service. Without this the model
    // silently drops it, because the prompt requires an exact match — which is
    // how a whole Reddit workstream can vanish from a scope it is named in.
    unmatchedServices: out.unmatchedServices || [],
    sourcesUsed: docs.map(d => d.label),
    attached: attached,
    trimmed: trimmed,
    missing: missing
  };

  // Saved so reopening the draft shows what the model said last time without
  // paying for the call again. A failed save is not a failed extraction.
  if (draftId) {
    try { saveDraft(draftId, { extraction: result, status: 'Analysed' }); }
    catch (e) { result.saveWarning = (e && e.message) || String(e); }
  }
  return result;
}

/** Whether a ClickUp token is configured, so the UI can say so up front. */
function hasClickUpToken() {
  return !!PropertiesService.getScriptProperties().getProperty('CLICKUP_API_TOKEN');
}

function promptForClickUpToken() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('ClickUp API token',
    'ClickUp → Settings → Apps → API Token. Stored in Script Properties, '
    + 'not in the sheet.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK || !res.getResponseText().trim()) return;
  PropertiesService.getScriptProperties()
    .setProperty('CLICKUP_API_TOKEN', res.getResponseText().trim());
  ui.alert('ClickUp token saved.');
}

// ---------------------------------------------------------------- SOURCES

/** Pasted text passes through; a URL is fetched; a file is converted. */
function resolveSource_(raw) {
  if (raw && typeof raw === 'object' && raw.data) return fileToText_(raw);

  raw = String(raw || '');
  if (!/^https?:\/\//i.test(raw) || /\s/.test(raw.trim())) return raw;

  const url = raw.trim();
  // Two different ClickUp objects behind two different APIs. A form submission
  // is a task (app.clickup.com/t/…) whose answers live in custom fields; a doc
  // is /docs/… and has pages. Guessing wrong returns a 404 that reads like a
  // permissions problem, so the shape of the URL decides.
  if (/clickup\.com\/t\//i.test(url)) return fetchClickUpTask_(url);
  if (url.indexOf('clickup.com') !== -1) return fetchClickUpDoc_(url);

  const gdoc = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (gdoc) {
    try {
      return DocumentApp.openById(gdoc[1]).getBody().getText();
    } catch (e) {
      throw new Error('Could not open that Google Doc. Check it is shared with '
        + this_() + ', or paste the text in instead.');
    }
  }

  const slides = url.match(/docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/);
  if (slides) return slidesToText_(slides[1]);

  if (/docs\.google\.com\/spreadsheets/.test(url)) {
    throw new Error('That is a Google Sheet. Export the relevant tab as text, '
      + 'or paste the content in.');
  }

  throw new Error('Supported links: ClickUp docs and tasks, Google Docs, '
    + 'Google Slides. Otherwise upload the file or paste the text.');
}

/** Whoever the script runs as — the identity a document must be shared with. */
function this_() {
  try { return Session.getEffectiveUser().getEmail() || 'this account'; }
  catch (e) { return 'this account'; }
}

/**
 * ClickUp puts the same doc behind three URL shapes:
 *
 *   https://app.clickup.com/{workspaceId}/docs/{docId}/{pageId}     ← copy-link
 *   https://app.clickup.com/{workspaceId}/v/dc/{docId}/{pageId}     ← older
 *   https://doc.clickup.com/{workspaceId}/d/h/{docId}/{shareHash}   ← share link
 *
 * All three carry the real doc ID, so all three are accepted. The share link is
 * worth calling out though: it opens in a browser for anyone holding it, which
 * makes it look like access, while the API still applies ordinary workspace
 * permissions. A doc published to the web and never shared with you reads fine
 * in Chrome and 403s here.
 *
 * The pageId is a deep link to one page; we pull every page in the doc, since a
 * transcript is routinely split across several and grabbing only the linked one
 * silently truncates the input.
 */
function parseClickUpUrl_(url) {
  const m = url.match(/clickup\.com\/(\d+)\/(?:docs|v\/dc|d\/[a-z]+)\/([a-zA-Z0-9_-]+)/i);
  if (!m) {
    throw new Error('Could not read a workspace and doc ID from that ClickUp link. '
      + 'Expected app.clickup.com/{workspace}/docs/{docId}/{pageId} — use '
      + 'Share → Copy link from inside the doc.');
  }
  return { workspaceId: m[1], docId: m[2], shared: /\/d\/h\//i.test(url) };
}

function fetchClickUpDoc_(url) {
  const token = PropertiesService.getScriptProperties().getProperty('CLICKUP_API_TOKEN');
  if (!token) {
    throw new Error('No ClickUp API token set. Onboarding → Set ClickUp API token.');
  }
  const ids = parseClickUpUrl_(url);

  const res = UrlFetchApp.fetch(
    CLICKUP_API + '/workspaces/' + ids.workspaceId + '/docs/' + ids.docId
      + '/pages?content_format=text%2Fmd',
    { method: 'get', headers: { Authorization: token }, muteHttpExceptions: true });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) throw new Error(clickUpAccessError_(code, body, ids, 'doc'));

  const pages = JSON.parse(body);
  const list = Array.isArray(pages) ? pages : (pages.pages || []);
  if (!list.length) throw new Error('That ClickUp doc has no readable pages.');

  return list.map(p => {
    const title = p.name ? '## ' + p.name + '\n' : '';
    return title + String(p.content || '');
  }).join('\n\n').trim();
}

/**
 * ClickUp returns 403 with ECODE EXTRA_AUTHZ_002 for an object the caller is
 * not authorised for AND for one that does not exist — it declines to confirm
 * which, so the message has to cover both without guessing.
 *
 * The canonical URL is included because opening it while signed in settles the
 * question in one click: if the browser cannot open it either, the token is
 * fine and the doc genuinely sits somewhere this account is not a member of.
 */
function clickUpAccessError_(code, body, ids, what) {
  if (code === 401) {
    return 'ClickUp rejected the API token (401). It may have been revoked — '
      + 'reset it from the sheet: Onboarding → Set ClickUp API token.';
  }
  if (code === 429) {
    return 'ClickUp rate-limited the request (429). Wait a minute and retry.';
  }
  if (code !== 403 && code !== 404) {
    return 'ClickUp API ' + code + ': ' + String(body).slice(0, 200);
  }

  const id = ids.docId || ids.taskId;
  const parts = [];
  parts.push('ClickUp will not open ' + what + ' ' + id + ' for the account that '
    + 'owns the API token (' + code + ').');

  if (ids.shared) {
    parts.push('The link you used is a share link (doc.clickup.com/…/d/h/…). '
      + 'Those open in a browser for anyone holding them, but publishing a doc '
      + 'does not grant API access to it — the API still applies normal '
      + 'workspace permissions.');
  }

  if (what === 'doc' && ids.workspaceId) {
    parts.push('Check by opening https://app.clickup.com/' + ids.workspaceId
      + '/docs/' + ids.docId + ' while signed in. If that will not open either, '
      + 'the doc lives in a private Space or someone else\'s personal folder — '
      + 'ask its owner to share it, or paste the text in instead.');
  } else {
    parts.push('Open it in ClickUp while signed in to confirm the account can '
      + 'reach it. If it cannot, ask the owner to share it, or paste the '
      + 'content in instead.');
  }

  return parts.join(' ');
}

/**
 * A ClickUp task, which is what a submitted ClickUp Form becomes.
 *
 *   https://app.clickup.com/t/{teamId}/{taskId}
 *   https://app.clickup.com/t/{taskId}
 *
 * The form's answers are custom fields, not the description, so they are
 * rendered as question/answer lines. Without that the model sees an empty
 * task and reports the form as blank.
 */
function parseClickUpTaskUrl_(url) {
  const m = url.match(/clickup\.com\/t\/(?:(\d+)\/)?([A-Za-z0-9_-]+)/i);
  if (!m) throw new Error('Could not read a task ID from that ClickUp link.');
  return { teamId: m[1] || '', taskId: m[2] };
}

function fetchClickUpTask_(url) {
  const token = PropertiesService.getScriptProperties().getProperty('CLICKUP_API_TOKEN');
  if (!token) {
    throw new Error('No ClickUp API token set. Onboarding → Set ClickUp API token.');
  }
  const ids = parseClickUpTaskUrl_(url);

  const res = UrlFetchApp.fetch(
    CLICKUP_API_V2 + '/task/' + encodeURIComponent(ids.taskId)
      + (ids.teamId ? '?team_id=' + encodeURIComponent(ids.teamId) : ''),
    { method: 'get', headers: { Authorization: token }, muteHttpExceptions: true });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) throw new Error(clickUpAccessError_(code, body, ids, 'task'));

  const task = JSON.parse(body);
  const out = [];
  if (task.name) out.push('# ' + task.name);
  if (task.status && task.status.status) out.push('Status: ' + task.status.status);

  const desc = task.text_content || task.description || '';
  if (String(desc).trim()) out.push('\n' + String(desc).trim());

  const answers = (task.custom_fields || [])
    .map(f => {
      const v = formatCustomField_(f);
      return v === '' ? null : (f.name || 'Field') + ': ' + v;
    })
    .filter(Boolean);

  if (answers.length) out.push('\n## Form answers\n' + answers.join('\n'));

  const text = out.join('\n').trim();
  if (!text) throw new Error('That ClickUp task has no description and no filled-in fields.');
  return text;
}

/**
 * Custom field values are stored by type, and several are indirections —
 * a dropdown stores an option index, labels store option IDs. Returning those
 * raw would feed the model "Vertical: 2".
 */
function formatCustomField_(f) {
  const v = f.value;
  if (v === null || v === undefined || v === '') return '';
  const cfg = f.type_config || {};
  const opts = cfg.options || [];

  switch (f.type) {
    case 'drop_down': {
      const hit = opts.find(o => o.orderindex === v || o.id === v);
      return hit ? (hit.name || hit.label || '') : String(v);
    }
    case 'labels': {
      const ids = Array.isArray(v) ? v : [v];
      return ids.map(id => {
        const hit = opts.find(o => o.id === id);
        return hit ? (hit.label || hit.name || id) : id;
      }).join(', ');
    }
    case 'users':
      return (Array.isArray(v) ? v : [v])
        .map(u => (u && (u.username || u.email)) || '').filter(Boolean).join(', ');
    case 'date': {
      const n = Number(v);
      if (!n) return String(v);
      return Utilities.formatDate(new Date(n), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    case 'checkbox':
      return (v === true || v === 'true') ? 'Yes' : 'No';
    case 'currency':
      return String(v);
    case 'attachment':
      return (Array.isArray(v) ? v : [v])
        .map(a => (a && (a.title || a.url)) || '').filter(Boolean).join(', ');
    default:
      if (Array.isArray(v)) return v.map(x => (x && x.name) || String(x)).join(', ');
      if (typeof v === 'object') return v.name || v.value || JSON.stringify(v);
      return String(v);
  }
}

/**
 * A pitch deck as text. SlidesApp would need another OAuth scope and walks
 * every shape by hand; Drive's plain-text export gives the same words in one
 * call, and pricing tables survive it well enough for the fee lines to be
 * quotable.
 */
function slidesToText_(id) {
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text/plain',
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true });

  const code = res.getResponseCode();
  if (code === 403 || code === 404) {
    throw new Error('That Slides deck is not readable by ' + this_() + ' (' + code
      + '). Share it with that account, or export the deck to PDF and upload it.');
  }
  if (code !== 200) {
    throw new Error('Could not export that Slides deck (' + code
      + '). Export it to PDF and upload it instead.');
  }
  return res.getContentText();
}

/** A short human label for where a source came from, for the reading checklist. */
function sourceKindLabel_(raw) {
  if (raw && typeof raw === 'object' && raw.data) {
    return 'Upload · ' + (raw.name || 'file');
  }
  const s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s) || /\s/.test(s)) return 'Pasted text';
  if (/clickup\.com\/t\//i.test(s)) return 'ClickUp task';
  if (s.indexOf('clickup.com') !== -1) return 'ClickUp doc';
  if (/docs\.google\.com\/document/.test(s)) return 'Google Doc';
  if (/docs\.google\.com\/presentation/.test(s)) return 'Google Slides';
  return 'Link';
}

/**
 * The one-line "so do this instead" under a failure. The UI shows it beside a
 * Retry button, so it has to name an action rather than restate the problem.
 */
function hintFor_(msg) {
  msg = String(msg || '');
  if (/scanned|almost no text/i.test(msg)) {
    return 'Open the PDF, select all, copy, and paste it into the box.';
  }
  if (/ClickUp/i.test(msg) && /token/i.test(msg)) {
    return 'Set the token in the sheet, then retry — or paste the text in.';
  }
  if (/ClickUp/i.test(msg)) {
    return 'Open the doc in ClickUp, select all, and paste it in — that always works.';
  }
  if (/limit is 12 MB|MB\./i.test(msg)) {
    return 'Split the file, or paste the text.';
  }
  if (/Slides|shared with/i.test(msg)) {
    return 'Share it with this account, or upload a PDF export.';
  }
  return 'Paste the text in instead, or skip this source.';
}

// ---------------------------------------------------------------- FILES

/** Anything bigger than this is a recording or a deck, not a document. */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/**
 * Turns an uploaded file into text.
 *
 * Plain text is decoded directly. Everything else — PDF, DOCX, RTF — goes
 * through Drive: uploading with a Google Doc mimeType makes Drive run its own
 * conversion, including OCR on scanned PDFs, and DocumentApp then reads the
 * result. The temporary Doc is trashed straight after; a scope of work should
 * not be left lying in My Drive as a side effect of reading it.
 *
 * A PDF that is pure scanned images with no OCR layer yields little or
 * nothing. That reads as a bad extraction rather than a bad file, so it is
 * called out explicitly.
 */
function fileToText_(file) {
  const bytes = Utilities.base64Decode(file.data);
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error(file.name + ' is ' + Math.round(bytes.length / 1048576)
      + ' MB. The limit is 12 MB — paste the text instead.');
  }

  const mime = file.mimeType || 'application/octet-stream';
  const blob = Utilities.newBlob(bytes, mime, file.name || 'upload');

  if (mime.indexOf('text/') === 0 && mime.indexOf('text/html') !== 0) {
    return blob.getDataAsString();
  }

  let docId = null;
  try {
    const created = Drive.Files.create(
      { name: '[tmp] ' + (file.name || 'upload'), mimeType: 'application/vnd.google-apps.document' },
      blob);
    docId = created.id;
    const text = DocumentApp.openById(docId).getBody().getText();

    if (!text || text.trim().length < 40) {
      throw new Error(file.name + ' converted to almost no text. If it is a '
        + 'scanned PDF with no text layer, paste the text instead.');
    }
    return text;
  } catch (e) {
    if (String(e.message).indexOf('almost no text') !== -1) throw e;
    throw new Error('Could not read ' + (file.name || 'that file') + ': ' + e.message);
  } finally {
    // Runs even when the conversion threw, so a failed read leaves nothing behind.
    if (docId) {
      try { DriveApp.getFileById(docId).setTrashed(true); } catch (ignore) {}
    }
  }
}

// ---------------------------------------------------------------- PROMPT

function buildExtractPrompt_(docs) {
  const platformNames = getPlatformList().map(p => p.name);
  // The Services TAB, not the SERVICES constant. The tab is what the review
  // screen renders checkboxes from, so offering the model anything else means
  // it can return a service with nowhere to go — which is exactly how "Reddit
  // Organic Social" came back off a signed scope, priced on the fee table, and
  // appeared nowhere on the form.
  const serviceNames = getServiceList().map(s => s.name);

  const system = [
    'You extract structured onboarding data for a paid-search agency from deal documents.',
    '',
    'Rules:',
    '- Extract every field you can support from the documents. Guess where the',
    '  evidence is good; leave a field out entirely when it is not there. Do not',
    '  invent, and do not infer a value from what is typical for this kind of client.',
    '- Every field you return MUST carry a verbatim quote from the documents that',
    '  supports it. If you cannot quote it, do not return it.',
    '- confidence is "high" when a document states it outright, "medium" when it',
    '  follows clearly from what is stated, "low" when you are reading between the',
    '  lines. Money, dates and contractual terms held at "low" are usually better',
    '  omitted.',
    '- When two documents disagree on the same fact, return BOTH readings in',
    '  conflicts and pick the scope-of-work version for the field value. The',
    '  contract governs; the sales call is what was hoped for.',
    '- openQuestions: things the agency must resolve before launch that these',
    '  documents do not answer. Be specific and few. Not "what is the budget"',
    '  when the budget is stated.',
    '- Keep quotes short — one sentence. They are shown under a form field.',
    '- Some documents are attached as PDFs as well as being transcribed. Fee',
    '  tables and pricing slides are routinely images with no text layer, so',
    '  READ THE ATTACHED PAGES for money, not just the transcription. If a',
    '  transcription trails off at "client shall pay:" the figures are in the',
    '  attachment.',
    '- If the documents sell something with no matching service name, put it in',
    '  unmatchedServices rather than dropping it or forcing it into the nearest',
    '  name. Organic social management is not the same product as paid ads on',
    '  the same platform, and guessing either way is worse than reporting it.',
    '',
    'Return ONLY a JSON object, no prose and no code fence.'
  ].join('\n');

  const shape = {
    fields: {
      company: { value: 'string', confidence: 'high|medium|low', quote: 'string', source: 'string' }
    },
    platforms: { value: ['string'], confidence: 'high|medium|low', quote: 'string', source: 'string' },
    services: { value: ['string'], confidence: 'high|medium|low', quote: 'string', source: 'string' },
    fees: { value: [{ label: 'string', amount: 0 }], confidence: 'high|medium|low',
            quote: 'string', source: 'string' },
    conflicts: [{ field: 'string', note: 'string', a: { source: 'string', quote: 'string' },
                  b: { source: 'string', quote: 'string' } }],
    unmatchedServices: [{ name: 'string', quote: 'string', source: 'string' }],
    openQuestions: ['string']
  };

  const user = [
    'Extract into these fields. Omit any you cannot support with a quote.',
    '',
    'company, contact (primary contact name), email, website, vertical,',
    'contractStart (YYYY-MM-DD), mrr (number, no currency symbol — the TOTAL',
    'the client actually pays per month, after any bundle discount),',
    'owner (onboarding owner at the agency), scope (2-4 sentences),',
    'approvals (who signs off on creative), slack (channel name)',
    '',
    'cadence must be exactly one of: ' + CADENCES.join(' | '),
    'term must be exactly one of: ' + TERMS.join(' | ')
      + '. Use "Month to month" unless a fixed term is stated.',
    'bizType must be exactly one of: ' + BIZ_TYPES.join(' | ')
      + '. eCommerce sells products online; Lead Gen collects enquiries.',
    '',
    'services.value must be a subset of exactly these names:',
    serviceNames.join(' | '),
    'These are what the client BOUGHT. Do not confuse them with platforms,',
    'which are what we need access to.',
    '',
    'A service is something sold in its own right — named in the overview or',
    'carrying its own line on the fee table. Something described as a',
    'deliverable INSIDE another service\'s section is not separately sold: a',
    'contract that bundles "one custom landing page at a time" into Google Ads',
    'management has bought Google Ads, not a Landing Page. When the fee table',
    'lists three lines, expect about three services.',
    'Anything sold that is not on that list goes in unmatchedServices with the',
    'quote that names it. Do not force it onto the closest name and do not drop',
    'it — a service the agency has no name for yet is exactly what we need told.',
    '',
    'fees: the fee table, usually a "Fees & Payment" or pricing slide, as',
    'lines: [{ label, amount }]. Use the service name as the label where it',
    'matches one of the services above. Include discounts as their own line',
    'with a NEGATIVE amount. Do NOT include the total as a line — mrr is the',
    'total. Example: a deck listing Google Ads 6000, Reddit 2000, AI Search',
    'SEO 2000, bundle discount -4000, total 6000 becomes four lines and',
    'mrr 6000.',
    '',
    'platforms.value must be a subset of exactly these names:',
    platformNames.join(' | '),
    '',
    'Each field is an object: { value, confidence, quote, source }.',
    'source is the document label the quote came from.',
    '',
    'Shape:',
    JSON.stringify(shape, null, 2),
    '',
    '--- DOCUMENTS ---',
    docs.map(d => '### ' + d.label
      + (d.attach ? '\n(also attached above as a file — read it for anything the '
                  + 'transcription below is missing, especially money)' : '')
      + '\n' + d.text).join('\n\n')
  ].join('\n');

  return {
    system: system,
    user: user,
    documents: docs.filter(d => d.attach).map(d => d.attach)
  };
}

/** Whether an extraction actually produced fee lines worth keeping. */
function hasFees_(fees) {
  const v = fees && fees.value;
  return Array.isArray(v) && v.some(l => l && Number(l.amount));
}

/**
 * A second, narrower request whose only job is the fee table.
 *
 * The main prompt asks for fifteen fields at once, and when the pricing is a
 * picture in the middle of a ten-page contract it is easy for the model to
 * answer from the transcription — which trails off at "client shall pay:" — and
 * move on. With nothing else to do and the pages in front of it, it looks.
 *
 * Only the attachments go in. Sending the transcription again would reintroduce
 * exactly the text that lacks the numbers.
 */
function buildFeePrompt_(docs) {
  const attach = docs.filter(d => d.attach);

  const system = [
    'You read pricing out of agency contracts and pitch decks.',
    '',
    'The fee table is very often an IMAGE with no text layer — a screenshot of a',
    'slide, or a table exported as a picture. Read the attached pages visually.',
    'Do not answer from any text you were given; look at the pages.',
    '',
    'Find the page titled something like "Fees & Payment Terms", "Investment",',
    'or "Pricing". Return every line on it.',
    '',
    'Return ONLY a JSON object, no prose and no code fence.'
  ].join('\n');

  const user = [
    'Attached: ' + attach.map(d => d.label).join(', ') + '.',
    '',
    'Return:',
    JSON.stringify({
      fees: {
        value: [{ label: 'string', amount: 0 }],
        confidence: 'high|medium|low',
        quote: 'string',
        source: 'string'
      },
      mrr: { value: 0, confidence: 'high|medium|low', quote: 'string', source: 'string' }
    }, null, 2),
    '',
    'One line per channel or item, using the service name where it matches:',
    getServiceList().map(s => s.name).join(' | '),
    'Discounts are their own line with a NEGATIVE amount. Do NOT include the',
    'total as a line — mrr is the total the client pays each month, after any',
    'discount. Amounts are plain numbers: no currency symbols, no commas.',
    '',
    'One-off or setup fees belong in the lines too, labelled as such. If a fee',
    'is annual or quarterly, convert it to a monthly figure and say so in the',
    'label.',
    '',
    'quote: what the page actually says — read it off the image if that is where',
    'it is. If there is genuinely no pricing on any attached page, return',
    '{"fees": null}. Do not guess a number.'
  ].join('\n');

  return { system: system, user: user, documents: attach.map(d => d.attach) };
}

/**
 * How much of each document reaches the prompt.
 *
 * The models hold a million tokens, so this is not close to a context limit —
 * it is a cost and latency ceiling. 600K characters is roughly 150K tokens,
 * which comfortably fits five long transcripts and still leaves the request
 * fast enough to sit behind a spinner.
 */
const PROMPT_CHAR_BUDGET = 600000;

/** Room for the JSON, whose size scales with the quote per field. */
const EXTRACT_MAX_TOKENS = 16000;

/**
 * Total base64 across all attached originals, per analysis.
 *
 * A PDF page costs the model far more than the same page as text — it is
 * rendered as an image as well as read — so this is a cost ceiling, not a
 * protocol one. Roughly 8MB of base64 is ~6MB of PDF, which is a long signed
 * contract or three short ones. Past it, the remaining sources go as text only
 * and runExtraction reports which ones were attached.
 */
const MAX_ATTACH_BYTES = 8 * 1024 * 1024;

/** What is worth sending as a file rather than as scraped text. */
function isAttachable_(mime) {
  if (!mime) return false;
  return mime === 'application/pdf' || mime.indexOf('image/') === 0;
}

/**
 * Whether a document that ought to price something actually contains a price.
 *
 * A scope of work whose text layer holds no currency at all is the signature of
 * a fee table exported as an image: extraction succeeds, the character count
 * looks healthy, and the one number that matters is missing. The row says so
 * rather than showing a green tick over a silent hole.
 */
function looksPriceless_(key, text) {
  if (key !== 'sow' && key !== 'deck') return false;
  return !/[$£€]\s?\d|\d[\d,]*\s?(?:USD|GBP|EUR)\b|\b\d{1,3},\d{3}\b/.test(text);
}

/**
 * Fair-share allocation: a short document takes only what it needs and hands
 * the rest back, so one 400K transcript does not squeeze a 6K scope of work
 * down to its own proportional slice.
 */
function allocateBudget_(docs, budget) {
  const order = docs
    .map((d, i) => ({ i: i, len: d.text.length }))
    .sort((a, b) => a.len - b.len);

  const alloc = [];
  let remaining = budget;
  let left = order.length;

  order.forEach(o => {
    const share = Math.floor(remaining / left);
    const give = Math.min(o.len, share);
    alloc[o.i] = give;
    remaining -= give;
    left--;
  });
  return alloc;
}

/**
 * Keep the head and the tail: openings carry the company and the ask, closings
 * carry the commitments and next steps. The middle is usually rapport.
 *
 * Whenever this fires, runExtraction reports it, because a monthly fee agreed
 * forty minutes into a call is exactly the sort of thing that lives in a middle
 * this would drop.
 */
function trimForPrompt_(text, limit) {
  limit = limit || PROMPT_CHAR_BUDGET;
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.65);
  const tail = limit - head;
  return text.slice(0, head)
    + '\n\n[… ' + (text.length - limit) + ' characters omitted from the middle …]\n\n'
    + text.slice(-tail);
}

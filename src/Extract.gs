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
 */

const CLICKUP_API = 'https://api.clickup.com/api/v3';
const CLICKUP_API_V2 = 'https://api.clickup.com/api/v2';

/** Labels for the three sources, in the order they get sent to the model. */
const SOURCE_KINDS = [
  { key: 'sales', label: 'Sales call transcript' },
  { key: 'kickoff', label: 'Onboarding / kickoff call transcript' },
  { key: 'sow', label: 'Scope of work' },
  { key: 'form', label: 'ClickUp onboarding form' }
];

// ---------------------------------------------------------------- PUBLIC

/**
 * Reads whatever sources were supplied and returns a pre-filled intake.
 * Callable from App.html. Every source is optional; with none supplied this
 * returns empty rather than inventing a client out of nothing.
 *
 * @param {Object} sources  { sales, kickoff, sow }
 *   Each value is pasted text, a URL (ClickUp doc or Google Doc), or an
 *   uploaded file as { name, mimeType, data } where data is base64.
 */
function extractIntake(sources) {
  sources = sources || {};

  const docs = [];
  const problems = [];

  SOURCE_KINDS.forEach(kind => {
    const raw = sources[kind.key];
    if (!raw) return;
    if (typeof raw === 'string' && !raw.trim()) return;
    try {
      const text = resolveSource_(raw);
      if (text && text.trim()) docs.push({ label: kind.label, text: text.trim() });
      else problems.push(kind.label + ': resolved to empty content.');
    } catch (e) {
      problems.push(kind.label + ': ' + e.message);
    }
  });

  if (!docs.length) {
    return {
      ok: false,
      message: problems.length ? problems.join('\n') : 'Add at least one source first.',
      problems: problems
    };
  }

  let out;
  try {
    out = callAnthropic_(buildExtractPrompt_(docs));
  } catch (e) {
    return { ok: false, message: 'Extraction failed: ' + e.message, problems: problems };
  }

  return {
    ok: true,
    fields: out.fields || {},
    platforms: out.platforms || null,
    conflicts: out.conflicts || [],
    openQuestions: out.openQuestions || [],
    sourcesUsed: docs.map(d => d.label),
    problems: problems
  };
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
  // is doc.clickup.com/… and has pages. Guessing wrong returns a 404 that reads
  // like a permissions problem, so the shape of the URL decides.
  if (/clickup\.com\/t\//i.test(url)) return fetchClickUpTask_(url);
  if (url.indexOf('clickup.com') !== -1) return fetchClickUpDoc_(url);

  const gdoc = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (gdoc) return DocumentApp.openById(gdoc[1]).getBody().getText();

  throw new Error('Only ClickUp docs and Google Docs links are supported. '
    + 'Paste the text instead.');
}

/**
 * ClickUp doc URLs look like:
 *   https://doc.clickup.com/{workspaceId}/d/h/{docId}/{pageId}
 * The pageId is a deep link to one page; we pull every page in the doc, since
 * a transcript is routinely split across several and grabbing only the linked
 * one silently truncates the input.
 */
function parseClickUpUrl_(url) {
  const m = url.match(/clickup\.com\/(\d+)\/d\/[a-z]+\/([a-zA-Z0-9_-]+)/i);
  if (!m) throw new Error('Could not read the workspace and doc ID from that ClickUp link.');
  return { workspaceId: m[1], docId: m[2] };
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
  if (code === 401) throw new Error('ClickUp rejected the token (401).');
  if (code === 404) throw new Error('ClickUp could not find that doc (404) — check the link.');
  if (code !== 200) throw new Error('ClickUp API ' + code + ': ' + body.slice(0, 200));

  const pages = JSON.parse(body);
  const list = Array.isArray(pages) ? pages : (pages.pages || []);
  if (!list.length) throw new Error('That ClickUp doc has no readable pages.');

  return list.map(p => {
    const title = p.name ? '## ' + p.name + '\n' : '';
    return title + String(p.content || '');
  }).join('\n\n').trim();
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
  if (code === 401) throw new Error('ClickUp rejected the token (401).');
  if (code === 404) throw new Error('ClickUp could not find that task (404) — check the link.');
  if (code !== 200) throw new Error('ClickUp API ' + code + ': ' + body.slice(0, 200));

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
    '',
    'Return ONLY a JSON object, no prose and no code fence.'
  ].join('\n');

  const shape = {
    fields: {
      company: { value: 'string', confidence: 'high|medium|low', quote: 'string', source: 'string' }
    },
    platforms: { value: ['string'], confidence: 'high|medium|low', quote: 'string', source: 'string' },
    conflicts: [{ field: 'string', note: 'string', a: { source: 'string', quote: 'string' },
                  b: { source: 'string', quote: 'string' } }],
    openQuestions: ['string']
  };

  const user = [
    'Extract into these fields. Omit any you cannot support with a quote.',
    '',
    'company, contact (primary contact name), email, website, vertical,',
    'contractStart (YYYY-MM-DD), mrr (number, no currency symbol),',
    'owner (onboarding owner at the agency), scope (2-4 sentences),',
    'approvals (who signs off on creative), slack (channel name),',
    'renewal (YYYY-MM-DD)',
    '',
    'cadence must be exactly one of: ' + CADENCES.join(' | '),
    'billing must be exactly one of: ' + BILLING.join(' | '),
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
    docs.map(d => '### ' + d.label + '\n' + trimForPrompt_(d.text)).join('\n\n')
  ].join('\n');

  return { system: system, user: user };
}

/**
 * Transcripts run long and the model has a context limit. Keep the head and
 * the tail: openings carry the company and the ask, closings carry the
 * commitments and next steps. The middle is usually rapport.
 */
function trimForPrompt_(text, limit) {
  limit = limit || 60000;
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.65);
  const tail = limit - head;
  return text.slice(0, head)
    + '\n\n[… ' + (text.length - limit) + ' characters omitted from the middle …]\n\n'
    + text.slice(-tail);
}

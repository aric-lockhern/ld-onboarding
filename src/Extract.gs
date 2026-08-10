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

/** Labels for the three sources, in the order they get sent to the model. */
const SOURCE_KINDS = [
  { key: 'sales', label: 'Sales call transcript' },
  { key: 'kickoff', label: 'Onboarding / kickoff call transcript' },
  { key: 'sow', label: 'Scope of work' }
];

// ---------------------------------------------------------------- PUBLIC

/**
 * Reads whatever sources were supplied and returns a pre-filled intake.
 * Callable from App.html. Every source is optional; with none supplied this
 * returns empty rather than inventing a client out of nothing.
 *
 * @param {Object} sources  { sales: string, kickoff: string, sow: string }
 *   Each value is either pasted text or a URL (ClickUp doc or Google Doc).
 */
function extractIntake(sources) {
  sources = sources || {};

  const docs = [];
  const problems = [];

  SOURCE_KINDS.forEach(kind => {
    const raw = String(sources[kind.key] || '').trim();
    if (!raw) return;
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

/** Pasted text passes through; a URL is fetched. */
function resolveSource_(raw) {
  if (!/^https?:\/\//i.test(raw) || /\s/.test(raw.trim())) return raw;

  const url = raw.trim();
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

/**
 * LOCKHERN ONBOARDING CRM — Plan generation
 * Reads intake (transcript / contract / notes) and produces a structured
 * onboarding plan: commitments made, risks, access priority, milestones,
 * and the questions kickoff still needs to answer.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function generatePlanForActiveRow() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sh.getName() !== TABS.CLIENTS) {
    SpreadsheetApp.getUi().alert('Select a row on the Clients tab first.');
    return;
  }
  const row = sh.getActiveRange().getRow();
  if (row < 2) return;
  const res = generatePlan_(row);
  SpreadsheetApp.getUi().alert(res.ok ? 'Plan ready:\n' + res.docUrl : 'Failed:\n' + res.message);
}

function generatePlan_(clientRow) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const clients = ss.getSheetByName(TABS.CLIENTS);
  const c = clients.getRange(clientRow, 1, 1, C.WIDTH).getValues()[0];
  const clientId = c[0];
  if (!clientId) return { ok: false, message: 'No client on that row.' };

  clients.getRange(clientRow, C.PLAN_STATUS).setValue('Generating');

  const intake = readIntake_(clientId);
  const platforms = String(c[7]).split(',').map(s => s.trim()).filter(Boolean);

  const meta = {
    company: c[1], contact: c[2], website: c[4], vertical: c[5],
    platforms: platforms, contractStart: c[8], mrr: c[9],
    scope: c[11], cadence: c[12]
  };

  let plan;
  try {
    plan = callAnthropic_(buildPrompt_(meta, intake));
  } catch (e) {
    clients.getRange(clientRow, C.PLAN_STATUS).setValue('Not started');
    return { ok: false, message: e.message };
  }

  const docUrl = writePlanDoc_(clientId, meta, plan);

  ss.getSheetByName(TABS.PLANS).appendRow([
    clientId, meta.company, new Date(), cfg('Model') || 'claude-sonnet-5',
    docUrl, JSON.stringify(plan)
  ]);

  clients.getRange(clientRow, C.PLAN_STATUS).setValue('Ready');
  clients.getRange(clientRow, C.PLAN_DOC).setValue(docUrl);

  applyPlanToAccess_(clientId, plan);

  return { ok: true, docUrl: docUrl, plan: plan };
}

function readIntake_(clientId) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.INTAKE);
  if (sh.getLastRow() < 2) return { transcript: '', contract: '', notes: '' };
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
  const r = rows.reverse().find(x => x[0] === clientId);
  if (!r) return { transcript: '', contract: '', notes: '' };
  return {
    transcript: expand_(r[2]),
    contract: expand_(r[3]),
    notes: String(r[4] || '')
  };
}

/** Cells that point at a Doc get read back out. */
function expand_(cell) {
  const v = String(cell || '');
  const m = v.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) return v;
  try {
    return DocumentApp.openById(m[1]).getBody().getText();
  } catch (e) {
    return v;
  }
}

// ---------------------------------------------------------------- PROMPT

function buildPrompt_(meta, intake) {
  const agency = cfg('Agency Name') || 'the agency';

  const system = [
    'You are an onboarding lead at ' + agency + ', a paid search and feed-driven ecommerce agency.',
    'You read sales call transcripts and signed contracts and turn them into an onboarding plan the delivery team can execute.',
    '',
    'Priorities, in order:',
    '1. Extract every commitment made to the client — anything promised on the call or written into the contract. Quote the source phrasing briefly so it can be verified. This is scope protection; missing one is the worst failure mode.',
    '2. Separate what was contractually agreed from what was said conversationally. Flag mismatches between the two explicitly.',
    '3. Identify risks and blockers that will surface in the first 60 days.',
    '4. Sequence platform access by what unblocks the most work earliest.',
    '',
    'Be specific and concrete. No filler, no generic agency advice. If the inputs do not support a claim, put it in open_questions rather than inventing it. If the transcript or contract is missing or thin, say so plainly in data_gaps instead of padding the plan.',
    '',
    'Respond with a single JSON object and nothing else. No markdown fences, no preamble.',
    'Schema:',
    '{',
    '  "account_summary": string,',
    '  "commitments": [{"item": string, "source": "contract"|"call"|"both", "evidence": string, "confidence": "high"|"medium"|"low"}],',
    '  "scope_mismatches": [{"issue": string, "said_on_call": string, "in_contract": string, "recommendation": string}],',
    '  "risks": [{"risk": string, "severity": "high"|"medium"|"low", "mitigation": string}],',
    '  "access_priority": [{"platform": string, "priority": 1|2|3, "why": string, "blocks": string}],',
    '  "milestones": [{"window": "Week 1"|"Week 2"|"Weeks 3-4"|"Days 30-60"|"Days 60-90", "task": string, "owner_role": string, "output": string}],',
    '  "open_questions": [string],',
    '  "data_gaps": [string]',
    '}'
  ].join('\n');

  const user = [
    '<client>',
    'Company: ' + meta.company,
    'Contact: ' + meta.contact,
    'Website: ' + meta.website,
    'Vertical: ' + meta.vertical,
    'Contracted platforms: ' + (meta.platforms.join(', ') || 'not specified'),
    'Scope as recorded at intake: ' + (meta.scope || 'not recorded'),
    'Meeting cadence: ' + (meta.cadence || 'not set'),
    'Contract start: ' + meta.contractStart,
    'MRR: ' + meta.mrr,
    '</client>',
    '',
    '<contract>',
    intake.contract || '(none provided)',
    '</contract>',
    '',
    '<sales_transcript>',
    intake.transcript || '(none provided)',
    '</sales_transcript>',
    '',
    '<internal_notes>',
    intake.notes || '(none provided)',
    '</internal_notes>',
    '',
    'Produce the onboarding plan JSON.'
  ].join('\n');

  return { system: system, user: user };
}

// ---------------------------------------------------------------- API

/**
 * One request to the Messages API, returning parsed JSON.
 *
 * @param {Object} prompt  { system, user }
 * @param {Object} [opts]  { maxTokens } — extraction needs more room than plan
 *                         generation, since every field it returns drags a
 *                         quote along with it.
 */
function callAnthropic_(prompt, opts) {
  opts = opts || {};
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('No API key set. Onboarding menu → Set Anthropic API key.');

  const res = UrlFetchApp.fetch(ANTHROPIC_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      model: cfg('Model') || 'claude-sonnet-5',
      max_tokens: opts.maxTokens || 8000,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }]
    })
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) throw new Error(anthropicError_(code, body));

  const data = JSON.parse(body);

  // A response cut off at the token ceiling is truncated JSON, which fails in
  // parseJson_ as "could not parse" — a parsing problem for what is really a
  // budget problem. Name it here so the fix is obvious.
  if (data.stop_reason === 'max_tokens') {
    throw new Error('The model hit its output limit of ' + (opts.maxTokens || 8000)
      + ' tokens, so the reply was cut off mid-JSON. Retry with fewer documents, '
      + 'or raise the limit in the code.');
  }

  // Models that think emit a thinking block before the text block; filtering by
  // type rather than taking content[0] keeps this working either way.
  const text = (data.content || [])
    .filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

  if (!text) throw new Error('The model returned no text. Stop reason: '
    + (data.stop_reason || 'unknown') + '.');

  return parseJson_(text);
}

/** API failures the user can act on, separated from the ones they cannot. */
function anthropicError_(code, body) {
  let detail = '';
  try {
    const parsed = JSON.parse(body);
    detail = (parsed.error && parsed.error.message) || '';
  } catch (e) { /* fall through to the raw body */ }

  if (code === 401) {
    return 'Anthropic rejected the API key (401). Onboarding → Set Anthropic API key.';
  }
  if (code === 400 && /model/i.test(detail)) {
    return 'Anthropic does not recognise the model "' + (cfg('Model') || '')
      + '". Fix the Model row on the Config tab. ' + detail;
  }
  if (code === 429) {
    return 'Rate limited by Anthropic (429). Wait a moment and retry.';
  }
  if (code === 529 || code === 503) {
    return 'Anthropic is overloaded (' + code + '). Retry in a minute.';
  }
  return 'Anthropic API ' + code + ': ' + (detail || String(body).slice(0, 300));
}

function parseJson_(text) {
  let t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(t);
  } catch (e) {
    const s = t.indexOf('{'), end = t.lastIndexOf('}');
    if (s !== -1 && end > s) {
      try { return JSON.parse(t.slice(s, end + 1)); } catch (e2) {}
    }
    throw new Error('Could not parse model response as JSON. First 300 chars:\n' + t.slice(0, 300));
  }
}

// ---------------------------------------------------------------- OUTPUT

function writePlanDoc_(clientId, meta, plan) {
  const doc = DocumentApp.create(meta.company + ' — Onboarding Plan (' + clientId + ')');
  const b = doc.getBody();
  b.clear();

  b.appendParagraph(meta.company).setHeading(DocumentApp.ParagraphHeading.TITLE);
  b.appendParagraph('Onboarding plan · generated ' +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d, yyyy'))
    .setForegroundColor('#5A6470');

  h_(b, 'Account summary');
  b.appendParagraph(plan.account_summary || '—');

  h_(b, 'Commitments made');
  tbl_(b, ['Commitment', 'Source', 'Evidence', 'Conf.'],
    (plan.commitments || []).map(x => [x.item, x.source, x.evidence, x.confidence]));

  if ((plan.scope_mismatches || []).length) {
    h_(b, 'Scope mismatches — resolve before kickoff');
    tbl_(b, ['Issue', 'Said on call', 'In contract', 'Recommendation'],
      plan.scope_mismatches.map(x => [x.issue, x.said_on_call, x.in_contract, x.recommendation]));
  }

  h_(b, 'Risks');
  tbl_(b, ['Risk', 'Severity', 'Mitigation'],
    (plan.risks || []).map(x => [x.risk, x.severity, x.mitigation]));

  h_(b, 'Access priority');
  tbl_(b, ['Platform', 'Priority', 'Why', 'Blocks'],
    (plan.access_priority || []).map(x => [x.platform, String(x.priority), x.why, x.blocks]));

  h_(b, 'Milestones');
  tbl_(b, ['Window', 'Task', 'Owner', 'Output'],
    (plan.milestones || []).map(x => [x.window, x.task, x.owner_role, x.output]));

  h_(b, 'Open questions for kickoff');
  (plan.open_questions || []).forEach(q => b.appendListItem(q)
    .setGlyphType(DocumentApp.GlyphType.BULLET));

  if ((plan.data_gaps || []).length) {
    h_(b, 'Data gaps');
    plan.data_gaps.forEach(g => b.appendListItem(g)
      .setGlyphType(DocumentApp.GlyphType.BULLET));
  }

  doc.saveAndClose();
  return doc.getUrl();
}

function h_(body, text) {
  body.appendParagraph(text).setHeading(DocumentApp.ParagraphHeading.HEADING2);
}

function tbl_(body, headers, rows) {
  if (!rows.length) { body.appendParagraph('None identified.'); return; }
  const data = [headers].concat(rows.map(r => r.map(c => String(c == null ? '' : c))));
  const t = body.appendTable(data);
  t.getRow(0).editAsText().setBold(true);
  t.setBorderColor('#D6D9DD');
}

/** Reorders the Access checklist to match the model's recommended priority. */
function applyPlanToAccess_(clientId, plan) {
  const prio = plan.access_priority || [];
  if (!prio.length) return;
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.ACCESS);
  if (sh.getLastRow() < 2) return;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, A.WIDTH).getValues();
  vals.forEach((r, i) => {
    if (r[A.ID - 1] !== clientId) return;
    const hit = prio.find(p =>
      String(p.platform).toLowerCase() === String(r[A.TASK - 1]).toLowerCase());
    if (hit) {
      sh.getRange(i + 2, A.NOTES).setValue('P' + hit.priority + ' — ' + hit.why);
    }
  });
}

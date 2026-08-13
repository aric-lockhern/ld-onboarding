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
    clientId, meta.company, new Date(), cfg('Model') || 'claude-opus-5',
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
 * @param {Object} prompt  { system, user, documents }
 *   documents is an optional array of { mimeType, data (base64), label }.
 *   Attaching a PDF rather than only the text pulled out of it is the
 *   difference between reading a contract and reading the parts of a contract
 *   that happen to be selectable — a fee table exported as an image has no
 *   text layer at all, and text extraction returns the sentence before it and
 *   then nothing. The model sees the page.
 * @param {Object} [opts]  { maxTokens } — extraction needs more room than plan
 *                         generation, since every field it returns drags a
 *                         quote along with it.
 */
function callAnthropic_(prompt, opts) {
  opts = opts || {};
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('No API key set. Onboarding menu → Set Anthropic API key.');

  // Documents lead, instructions follow: the model reads the attachments as
  // context for the question rather than the question as an aside.
  let content = prompt.user;
  const docs = prompt.documents || [];
  if (docs.length) {
    content = [];
    docs.forEach(d => {
      if (d.mimeType === 'application/pdf') {
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: d.data }
        });
      } else if (d.mimeType && d.mimeType.indexOf('image/') === 0) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: d.mimeType, data: d.data }
        });
      }
    });
    content.push({ type: 'text', text: prompt.user });
  }

  const req = {
    // Per call, because the jobs are not alike. Writing an onboarding plan can
    // take its time; listing what was promised on a call runs against the fetch
    // deadline, and how fast the model writes is what decides whether it lands.
    model: opts.model || cfg('Model') || 'claude-opus-5',
    max_tokens: opts.maxTokens || 8000,
    system: prompt.system,
    messages: [{ role: 'user', content: content }]
  };

  /**
   * THINKING TOKENS COME OUT OF max_tokens, AND THIS IS WHY THE CEILING KEPT
   * BEING HIT.
   *
   * Sonnet 5 and Opus 5 think by DEFAULT — omitting the parameter runs adaptive
   * thinking, which is not how the older models behaved. Those thinking tokens
   * are charged against the same max_tokens budget as the answer, and a request
   * that says "read 31,000 tokens of transcript and find every commitment" is
   * exactly the shape that thinks at length before writing a word.
   *
   * So the ceiling was never reached by the ANSWER. It was reached before the
   * answer started: 1,600 gone, then 4,000 gone, with a handful of items
   * arriving each time and the rest cut off. Raising the ceiling would have
   * bought more thinking, not more items, and would have run into the fetch
   * deadline instead — which is precisely the loop this has been stuck in.
   *
   * Extracting commitments from a transcript is a reading task with a
   * well-specified output, not a reasoning problem. It does not need to think
   * first, so it is told not to, and the whole budget goes to the answer.
   *
   * Left ON for plan generation, which is a genuine reasoning task and is not
   * racing a deadline.
   */
  if (opts.noThinking) req.thinking = { type: 'disabled' };

  const payload = JSON.stringify(req);

  /**
   * A running account of what this call did, for whoever is looking at a
   * failure.
   *
   * The caller passes an array in and it gets filled. Returning it instead
   * would change the shape every existing caller reads, and the point of a log
   * is that it survives the failure — a value returned from a function that
   * threw is a value nobody has.
   *
   * usage is the entry that matters. output_tokens counts THINKING as well as
   * the answer, and the gap between "the model wrote 3,900 tokens" and "the
   * answer is four items long" is the single fact that would have ended three
   * rounds of guessing about this.
   */
  const trace = opts.trace || [];
  // The caller's clock when it has one. Its own start time made the middle of
  // a run log read as if time went backwards — "8.1s, 0.0s, 20.1s" — because
  // these entries were counting from the request while the ones around them
  // counted from the beginning of the run.
  const started = opts.traceStart || new Date().getTime();
  const note = (step, detail) => {
    trace.push({ at: new Date().getTime() - started, step: step,
                 detail: detail || '' });
    // Also to the execution log, so it is there in the Apps Script editor for
    // anyone who did not have the browser open when it happened.
    try { console.log('[anthropic] ' + step + ' — ' + (detail || '')); } catch (e) {}
  };

  note('Request', req.model + ' · max ' + req.max_tokens + ' tokens · thinking '
    + (req.thinking && req.thinking.type === 'disabled' ? 'off' : 'on')
    + ' · ' + Math.round(payload.length / 1000) + 'k characters sent');

  // muteHttpExceptions catches HTTP statuses, not connection failures. A
  // request that runs past the fetch deadline THROWS, with "Address
  // unavailable" — which reads as the API being down when it is really this
  // request having been asked for more than it can produce in the time.
  //
  // Retried once, because it is sometimes genuinely transient. Named properly
  // when it is not, since the fix is a smaller request and nobody would guess
  // that from Google's wording.
  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = UrlFetchApp.fetch(ANTHROPIC_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        muteHttpExceptions: true,
        payload: payload
      });
      break;
    } catch (e) {
      const msg = (e && e.message) || String(e);
      note('Fetch failed', msg);
      if (attempt === 0 && /address unavailable|timeout|timed out/i.test(msg)) {
        note('Retrying once', 'after 2 seconds');
        Utilities.sleep(2000);
        continue;
      }
      if (/address unavailable|timeout|timed out/i.test(msg)) {
        throw new Error('The request to Anthropic ran past the fetch deadline '
          + 'and Google cut it off ("' + msg + '"). This is a size problem, not '
          + 'an outage: the model was asked for up to '
          + (opts.maxTokens || 8000) + ' tokens against '
          + Math.round(String(prompt.user || '').length / 1000) + 'k characters '
          + 'of input. Retry with fewer documents, or a smaller answer.');
      }
      throw e;
    }
  }

  const code = res.getResponseCode();
  const body = res.getContentText();
  note('Replied', 'HTTP ' + code + ' · ' + Math.round(body.length / 1000)
    + 'k characters');
  if (code !== 200) throw new Error(anthropicError_(code, body));

  const data = JSON.parse(body);

  const usage = data.usage || {};
  note('Tokens', (usage.input_tokens || '?') + ' in · '
    + (usage.output_tokens || '?') + ' out of ' + req.max_tokens + ' allowed'
    + ' · stopped because: ' + (data.stop_reason || 'unknown'));

  // Models that think emit a thinking block before the text block; filtering by
  // type rather than taking content[0] keeps this working either way.
  const text = (data.content || [])
    .filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

  if (!text) throw new Error('The model returned no text. Stop reason: '
    + (data.stop_reason || 'unknown') + '.');

  // A reply cut off at the ceiling is truncated JSON, and it used to be thrown
  // away whole. That is the wrong trade by a distance: eight items where the
  // ninth was cut off mid-sentence is eight items, and discarding them to
  // report a budget error gives somebody nothing at all for a request that
  // very nearly worked. So the complete part is salvaged and the fact that it
  // was cut short travels with it.
  /**
   * PARSE FIRST, ASK WHY LATER.
   *
   * This used to salvage only when stop_reason was "max_tokens", which is a
   * guess about the cause dressed up as a condition. A reply came back cut off
   * mid-word inside a string, stop_reason said something else, the salvage
   * never ran, and a perfectly good list of action items was thrown away with
   * "Could not parse model response as JSON" — a parser error for a document
   * that was three quarters complete.
   *
   * The only test that matters is whether the text parses. If it does, use it.
   * If it does not, keep whatever part of it is whole. Why it stopped is
   * information for the log, not a condition for keeping the answer.
   */
  try {
    const parsed = parseJson_(text);
    note('Parsed', 'the reply is valid JSON');
    return parsed;
  } catch (e) {
    const partial = salvageJson_(text);
    if (partial) {
      note('Salvaged', 'the reply did not parse whole ('
        + (data.stop_reason || 'unknown') + '); kept the complete part');
      partial._truncated = true;
      return partial;
    }
    note('Unparseable', 'nothing complete in ' + text.length + ' characters');
    throw new Error('The model\'s reply could not be read as JSON and nothing '
      + 'in it was complete enough to keep. It stopped because: '
      + (data.stop_reason || 'unknown') + '. First 200 characters:\n'
      + text.slice(0, 200));
  }
}

/**
 * The complete part of a JSON reply that stops mid-way.
 *
 * Walks the text tracking nesting and string state, remembering the last point
 * at which the document could legally be closed, then closes it there. A reply
 * that stops in the middle of the ninth item comes back as eight whole ones.
 *
 * String state matters: a brace inside a quoted "why" is not nesting, and a
 * naive bracket count truncates at the wrong place and loses good items.
 *
 * Returns null when nothing complete was written.
 */
function salvageJson_(text) {
  const t = String(text).replace(/^```(?:json)?\s*/i, '').trim();
  const stack = [];
  let inStr = false, esc = false, safeAt = -1, safeStack = null;

  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{' || ch === '[') { stack.push(ch); continue; }
    if (ch === '}' || ch === ']') {
      stack.pop();
      // Everything up to here is whole, so this is a point we could close at.
      safeAt = i;
      safeStack = stack.slice();
    }
  }

  if (safeAt === -1 || !safeStack) return null;

  const close = safeStack.slice().reverse()
    .map(open => (open === '{' ? '}' : ']')).join('');

  try {
    return JSON.parse(t.slice(0, safeAt + 1) + close);
  } catch (e) {
    return null;
  }
}

/** API failures the user can act on, separated from the ones they cannot. */
function anthropicError_(code, body) {
  let detail = '';
  try {
    const parsed = JSON.parse(body);
    detail = (parsed.error && parsed.error.message) || '';
  } catch (e) { /* fall through to the raw body */ }

  // A model that will not take the parameter says so in a 400 that mentions
  // it by name. Worth translating: the request looks identical to one that
  // worked yesterday, and nothing else in the message would point at it.
  if (code === 400 && /thinking/i.test(detail)) {
    return 'This model will not accept thinking being switched off ('
      + detail + '). Set "Actions Model" on the Config tab to '
      + 'claude-sonnet-5 or claude-haiku-4-5.';
  }

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

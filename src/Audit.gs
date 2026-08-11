/**
 * LOCKHERN ONBOARDING CRM — Audit action items
 *
 * An audit deck is a list of findings. What the team needs is a list of things
 * to do, in an order, with a name against each one — and the two are not the
 * same document. The gap between them is where audit work goes to die: the deck
 * gets presented, everyone agrees it was good, and three weeks later nobody has
 * rebuilt the campaign structure because it was never anybody's job.
 *
 * This reads the audit that is already stored on the client, reconciles it
 * against what was actually sold and what was said on the calls, and writes
 * action items with an owner picked from the Team tab by skill.
 *
 * THE RECONCILIATION IS THE POINT. A deck written to win the deal proposes more
 * than the contract bought — the Cornhole deck sold a $10K/month Reddit budget
 * against a scope of work covering Reddit organic only. An action item telling
 * someone to launch Reddit paid is worse than no action item: it is billable
 * work nobody agreed to pay for. Those come back flagged as out of scope
 * instead, so they can be sold properly or dropped.
 */

/** Enough for a page of items with reasons. */
const ACTIONS_MAX_TOKENS = 8000;

// ---------------------------------------------------------------- PUBLIC

/**
 * Reads the client's stored documents and writes action items. Callable from
 * App.html.
 *
 * Replaces whatever was generated before, but never touches an item somebody
 * has already moved off "To do" — a half-finished job is a fact about the
 * world, and regenerating should not quietly reopen it.
 */
function buildActionItems(clientId) {
  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };

  const docs = profileSources_(draftIdForClient_(clientId));
  if (!docs.length) {
    return { ok: false, message: 'No stored documents to read an audit from. '
      + 'The draft they came from may have been deleted.' };
  }

  const team = getTeam();

  let out;
  try {
    out = callAnthropic_(buildActionsPrompt_(client, docs, team),
                         { maxTokens: ACTIONS_MAX_TOKENS });
  } catch (e) {
    return { ok: false, message: (e && e.message) || String(e) };
  }

  const items = (out && out.actions) || [];
  if (!items.length) {
    return { ok: false, noAudit: true,
             message: (out && out.note)
               || 'Nothing in these documents reads as an audit finding. If the '
                + 'audit is a separate deck, add it to the draft as the pitch '
                + 'deck and re-analyse first.' };
  }

  const kept = writeActions_(clientId, items);

  return {
    ok: true,
    written: kept.written,
    preserved: kept.preserved,
    outOfScope: (out && out.outOfScope) || [],
    unassigned: items.filter(i => !i.owner).length,
    teamEmpty: !team.length
  };
}

/** The stored action items, newest generation first. */
function getActionItems(clientId) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.ACTIONS);
  if (!sh || sh.getLastRow() < 2) return { ok: true, items: [] };

  const id = String(clientId).trim();
  const items = sh.getRange(2, 1, sh.getLastRow() - 1, ACT.WIDTH).getValues()
    .map((r, i) => ({ r: r, row: i + 2 }))
    .filter(x => String(x.r[ACT.CLIENT - 1]).trim() === id)
    .map(x => ({
      row: x.row,
      action: safeStr_(x.r[ACT.ACTION - 1]),
      why: safeStr_(x.r[ACT.WHY - 1]),
      source: safeStr_(x.r[ACT.SOURCE - 1]),
      priority: safeStr_(x.r[ACT.PRIORITY - 1]) || 'Later',
      effort: safeStr_(x.r[ACT.EFFORT - 1]),
      owner: safeStr_(x.r[ACT.OWNER - 1]),
      status: safeStr_(x.r[ACT.STATUS - 1]) || 'To do'
    }));

  const order = { 'Now': 0, 'Next': 1, 'Later': 2 };
  items.sort((a, b) => (order[a.priority] || 9) - (order[b.priority] || 9));

  return { ok: true, items: items, statuses: ACTION_STATUSES,
           team: getTeam().map(t => t.name) };
}

/** Status or owner change from the client page. */
function updateActionItem(token, row, field, value) {
  checkToken_(token);
  const cols = { status: ACT.STATUS, owner: ACT.OWNER, priority: ACT.PRIORITY };
  const col = cols[field];
  if (!col) return { ok: false, message: 'Unknown field: ' + field };

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.ACTIONS);
  if (!sh || row < 2 || row > sh.getLastRow()) {
    return { ok: false, message: 'That action item no longer exists.' };
  }
  sh.getRange(row, col).setValue(value);
  return { ok: true };
}

// ---------------------------------------------------------------- WRITING

/**
 * Writes the new set, keeping anything already in progress.
 *
 * Matching is on the action text, which is imperfect — a reworded item counts
 * as new. That is the right way round: a duplicate is visible and deletable, a
 * silently reopened task that someone had marked Done is not.
 */
function writeActions_(clientId, items) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TABS.ACTIONS) || mkTab_(ss, TABS.ACTIONS, ACTION_HEADERS);
  const id = String(clientId).trim();

  const started = {};
  let preserved = 0;

  if (sh.getLastRow() > 1) {
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, ACT.WIDTH).getValues();
    // Descending, so the indexes gathered here stay valid as rows are removed.
    for (let i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][ACT.CLIENT - 1]).trim() !== id) continue;
      const status = String(rows[i][ACT.STATUS - 1] || 'To do');
      if (status === 'To do') sh.deleteRow(i + 2);
      else { started[String(rows[i][ACT.ACTION - 1]).trim()] = true; preserved++; }
    }
  }

  const now = new Date();
  const rows = items
    .filter(it => it && it.action && !started[String(it.action).trim()])
    .map(it => {
      const v = new Array(ACT.WIDTH).fill('');
      v[ACT.CLIENT - 1] = id;
      v[ACT.ACTION - 1] = String(it.action || '');
      v[ACT.WHY - 1] = String(it.why || '');
      v[ACT.SOURCE - 1] = String(it.source || '');
      v[ACT.PRIORITY - 1] = ACTION_PRIORITIES.indexOf(it.priority) === -1
        ? 'Later' : it.priority;
      v[ACT.EFFORT - 1] = String(it.effort || '');
      v[ACT.OWNER - 1] = String(it.owner || '');
      v[ACT.STATUS - 1] = 'To do';
      v[ACT.CREATED - 1] = now;
      return v;
    });

  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, ACT.WIDTH).setValues(rows);
  }
  return { written: rows.length, preserved: preserved };
}

// ---------------------------------------------------------------- PROMPT

function buildActionsPrompt_(client, docs, team) {
  const agency = cfg('Agency Name') || 'the agency';

  const system = [
    'You turn account audits into work for ' + agency + ', a paid search and',
    'organic social agency.',
    '',
    'An audit deck is a list of findings. The team needs a list of things to do,',
    'in an order, with a name against each. Your job is that translation.',
    '',
    'The hard part is scope, and it is the part that matters most:',
    '- A deck written to win the deal proposes more than the contract bought.',
    '  An action item for work nobody is paying for is worse than no action',
    '  item — someone does it, or argues about it, and either way it is loss.',
    '- Anything the audit recommends that falls outside the services sold goes',
    '  in outOfScope with what it would need, NOT in actions. Do not quietly',
    '  drop it either: it is often the next thing to sell.',
    '- The calls override the deck where they disagree. A finding the client',
    '  explicitly declined, or that the kickoff superseded, is not work.',
    '',
    'Writing the items:',
    '- Each one must be something a person can pick up and finish. "Improve',
    '  campaign structure" is not an action; "Split the single Shopping',
    '  campaign by margin tier so bidding can differ" is.',
    '- why it matters says what it costs to not do it, in the terms this client',
    '  cares about. No generic best-practice language.',
    '- source names the document and, where you can, the finding it came from.',
    '- priority: Now for anything losing money or blocking other work; Next for',
    '  the following few weeks; Later for real but not urgent. Be sparing with',
    '  Now — everything urgent means nothing is.',
    '- effort: a rough size like "1 hour", "half a day", "2 days".',
    '',
    'Ownership:',
    '- Pick an owner from the team list by skill. Match the work to what they',
    '  actually do, not to who is senior.',
    '- If nobody on the list plausibly fits, leave owner empty rather than',
    '  guessing. An item assigned to the wrong person is ignored twice.',
    '',
    'Return ONLY a JSON object, no prose and no code fence.'
  ].join('\n');

  const shape = {
    actions: [{
      action: 'string — the thing to do, specific enough to finish',
      why: 'string — what not doing it costs',
      source: 'string — document and finding',
      priority: 'Now|Next|Later',
      effort: 'string — rough size',
      owner: 'string — a name from the team list, or empty'
    }],
    outOfScope: [{
      item: 'string — what the audit recommends',
      why: 'string — why it is outside what was sold',
      needed: 'string — what would have to be agreed to do it'
    }],
    note: 'string — only if there is no audit in these documents'
  };

  const user = [
    'Client: ' + client.company,
    'Services sold: ' + (client.servicesRaw || 'not recorded'),
    'Business type: ' + (client.bizType || 'not recorded'),
    'Scope as recorded: ' + (client.scope || 'not recorded'),
    '',
    'Team available, with skills:',
    team.length
      ? team.map(t => '- ' + t.name + (t.role ? ' (' + t.role + ')' : '')
          + ' — ' + (t.skills.join(', ') || 'no skills listed')).join('\n')
      : '(nobody on the Team tab yet — leave every owner empty)',
    '',
    'Return:',
    JSON.stringify(shape, null, 2),
    '',
    'If none of these documents contains an audit or account review, return an',
    'empty actions array and say so in note. Do not invent findings from a',
    'scope of work.',
    '',
    '--- DOCUMENTS ---',
    docs.map(d => '### ' + d.label + '\n'
      + trimForPrompt_(d.text, Math.floor(PROMPT_CHAR_BUDGET / Math.max(docs.length, 1)))
    ).join('\n\n')
  ].join('\n');

  return { system: system, user: user };
}

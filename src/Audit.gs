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

/**
 * WHY THIS KEPT TIMING OUT, AND WHAT ACTUALLY FIXES IT.
 *
 * The obvious theory was the transcript. Cornhole's audit is 108,000
 * characters — the full recording of the call, not a deck — so every attempt
 * went at the input: trim it, budget it, split it. None of that was the
 * problem, and one of them (trimming) quietly threw away the middle of the
 * transcript, which is where half of what was agreed was said.
 *
 * An API request costs reading time plus writing time, and they are not
 * remotely equal. Reading is parallel: 27,000 tokens of transcript is a couple
 * of seconds. Writing is one token after another: asking for up to 6,000
 * tokens of JSON is a minute or two on its own, whatever it was given to read.
 * UrlFetchApp gives up around a minute and throws "Address unavailable", which
 * reads as the API being down.
 *
 * So the length of the answer is the thing to control, and the transcript
 * never was. The entire transcript goes in, untrimmed and unsplit.
 *
 * THE CEILING IS NOT THE LEVER, THOUGH. Setting it to 1,600 cut the reply off
 * inside the fourth item and threw the first three away, which is a worse
 * failure than being slow: the request worked, cost money, and returned
 * nothing. A ceiling is a safety net, and a net set below the floor is a trap.
 *
 * The lever is what each item COSTS to write. Eight items of one short
 * sentence per field is about 800 tokens; the ceiling sits well above that so
 * it is never reached in normal use, and callAnthropic_ salvages the complete
 * items if it ever is.
 *
 * If this is ever slow again: fewer items, or a faster model in Config. Never
 * a longer wait, and never less transcript.
 */
const ACTIONS_MAX_TOKENS = 4000;

/** A list nobody will read is the same as no list — and a long one is slow. */
const ACTIONS_MAX_ITEMS = 8;

/**
 * A ceiling on reading, set where prefill is still seconds rather than tens of
 * them. Four hundred thousand characters is three audits and both calls; the
 * documents that actually get picked are nowhere near it, and anything that is
 * gets trimmed with the trimming reported rather than done quietly.
 */
const ACTIONS_CHAR_BUDGET = 400000;

/**
 * The model that writes the items.
 *
 * Its own setting, because this job is the one that runs closest to the fetch
 * deadline and writing speed is what decides whether it finishes. The plan
 * generator can stay on the most capable model; this reads a transcript and
 * lists what was promised, which a faster model does well.
 *
 * Config first so it can be changed in the sheet, without a deploy, on the
 * morning it matters.
 */
function actionsModel_() {
  return cfg('Actions Model') || 'claude-sonnet-5';
}

/**
 * The documents a commitment is ever found in.
 *
 * The audit deck first: every slide on it is a finding with a recommendation
 * beside it, and a recommendation shown to a client is a thing they now expect.
 * The pitch deck is where the promises are made, the two calls are where they
 * are made verbally and sometimes revised, and the scope of work is what
 * decides whether a promise is inside the contract or a sales lead. The ClickUp
 * intake form is deliberately absent: it is the client answering questions, not
 * us committing to anything, and it only crowds the prompt.
 */
const ACTION_SOURCE_KEYS = ['audit', 'deck', 'sales', 'kickoff', 'sow'];

/**
 * What is ticked when the picker opens.
 *
 * The audit deck when there is one, because that is the document this feature
 * exists for — and the scope of work beside it, since half the value is
 * separating what we are contracted to do from what somebody would have to buy.
 * With no audit on file the pitch deck stands in: it is the next densest source
 * of promises. Ticking both when both exist is how a request gets big enough to
 * time out, so the audit displaces the pitch deck rather than joining it.
 */
function preferredActionSources_(keys) {
  const has = {};
  (keys || []).forEach(k => { has[k] = true; });

  const want = { sow: 1 };
  if (has.audit) want.audit = 1; else want.deck = 1;
  return want;
}

// ---------------------------------------------------------------- PUBLIC

/**
 * Reads the client's stored documents and writes action items. Callable from
 * App.html.
 *
 * Replaces whatever was generated before, but never touches an item somebody
 * has already moved off "To do" — a half-finished job is a fact about the
 * world, and regenerating should not quietly reopen it.
 */
/**
 * @param {Array<string>} keys optional — the documents to read. Omitted means
 *   everything that could hold a commitment.
 */
function buildActionItems(clientId, keys) {
  /**
   * Every step, whether it worked or not.
   *
   * This has failed four different ways — a fetch deadline, a token ceiling
   * twice, and a document that was never picked — and each time the only thing
   * on screen was a sentence guessing at the cause. The log is what turns
   * "it doesn't work" into a fact, and it is returned on the failure paths as
   * well as the good one, which is the whole point of having it.
   */
  const log = [];
  const t0 = new Date().getTime();
  // Shared with callAnthropic_ so every line in the log counts from the same
  // moment. See the note there.
  const clock = t0;
  const step = (name, detail) => {
    log.push({ at: new Date().getTime() - t0, step: name, detail: detail || '' });
    try { console.log('[actions] ' + name + ' — ' + (detail || '')); } catch (e) {}
  };
  const fail = (message, extra) =>
    Object.assign({ ok: false, message: message, log: log }, extra || {});

  const client = getClientRecord_(clientId);
  if (!client) return fail('Client not found.');
  step('Client', client.company);

  const draftId = draftIdForClient_(clientId);
  if (!draftId) {
    return fail('This client has no draft, so there are no stored documents to '
      + 'read. The draft it was created from may have been deleted.');
  }

  const all = profileSources_(draftId);
  step('Documents on file', all.length
    ? all.map(d => d.label + ' (' + Math.round((d.text || '').length / 1000)
        + 'k)').join(', ')
    : 'none');

  // Picking the documents is the difference between a request that finishes and
  // one that runs past the fetch deadline. Four transcripts is 120,000
  // characters; the deck alone is 19,000, and the deck is where the promises
  // are. So the caller chooses, and the default is only a default.
  let docs;
  if (keys && keys.length) {
    const want = {};
    keys.forEach(k => { want[k] = true; });
    docs = all.filter(d => want[d.key]);
    if (!docs.length) {
      return fail('None of the documents you picked are stored against this '
        + 'client any more.');
    }
  } else {
    // Imported calls carry a cu_ or call_ key rather than one of the fixed
    // names, and a promise made on last week's call counts exactly as much as
    // one made on the kickoff.
    docs = all.filter(d => ACTION_SOURCE_KEYS.indexOf(d.key) !== -1
      || isImportedCallKey_(d.key));
  }

  if (!docs.length) {
    return fail(all.length
               ? 'The stored documents are ' + all.map(d => d.label).join(', ')
                 + ' — none of them is a deck, a call transcript or a scope of '
                 + 'work, so there is nothing to read commitments from.'
               : 'No stored documents. The draft they came from may have been '
                 + 'deleted, or nothing was ever uploaded to it.');
  }

  const team = getTeam();
  const chars = docs.reduce((n, d) => n + d.text.length, 0);

  // Trimming is reported, never silent — the same rule the extraction follows.
  // A commitment made forty minutes into a call is exactly what a dropped
  // middle costs you, and a list that looks complete is worse than a warning.
  const share = Math.floor(ACTIONS_CHAR_BUDGET / Math.max(docs.length, 1));
  const trimmed = docs.filter(d => d.text.length > share).map(d => d.label);
  // Named on every outcome, good or bad. "It failed" with no list of what it
  // read is a bug report nobody can act on — including the deck being absent,
  // which is the single most common reason for a thin result.
  const read = docs.map(d => d.label);

  step('Reading', read.join(', ') + ' — ' + Math.round(chars / 1000)
    + 'k characters' + (trimmed.length ? ' (trimming ' + trimmed.join(', ') + ')' : ''));
  step('Team available', team.length ? team.length + ' people' : 'nobody on the Team tab');

  let out;
  try {
    out = callAnthropic_(buildActionsPrompt_(client, docs, team),
                         { maxTokens: ACTIONS_MAX_TOKENS,
                           model: actionsModel_(),
                           // The whole budget goes to the answer. See the note
                           // in callAnthropic_ — this is what was eating it.
                           noThinking: true,
                           trace: log, traceStart: clock });
  } catch (e) {
    // Naming the real knob. Unticking documents was the old advice and it was
    // wrong: reading is cheap and the length of the answer is what runs out of
    // time. Nobody would guess that, so it says so.
    const why = (e && e.message) || String(e);
    step('Failed', why);

    // Advice only where it applies. The deadline note was being appended to
    // every failure, including ones with nothing to do with a deadline, which
    // sends somebody to change a model setting that was never the problem.
    const slow = /deadline|address unavailable|timeout|timed out/i.test(why);
    return { ok: false, read: read, chars: chars, log: log,
             message: why + ' — reading ' + read.join(', ') + ' ('
               + Math.round(chars / 1000) + 'k characters) on '
               + actionsModel_() + '.'
               + (slow ? ' The length of the ANSWER is what runs past the '
                   + 'deadline, not the length of the documents: set "Actions '
                   + 'Model" on the Config tab to claude-haiku-4-5, which '
                   + 'writes several times faster.'
                       : ' The run log below has each step and what it did.') };
  }

  let items = (out && out.actions) || [];
  let outOfScope = (out && out.outOfScope) || [];
  let cutShort = !!(out && out._truncated);

  /**
   * A short answer fixes itself.
   *
   * Telling somebody "the answer ran out of room, rebuild to try again" is
   * handing them my problem. They asked for a list; a second request is
   * something the machine can make on its own, and it takes seconds.
   *
   * The retry asks for the same work in the plainest possible form — half the
   * items, nothing but the essentials — because the first attempt ran long by
   * being expansive, and asking for the same thing again would run long again.
   * Whichever attempt produced more complete items wins.
   */
  if (cutShort) {
    step('Retrying', 'the first answer was cut off after ' + items.length
      + ' items — asking again, shorter');
    try {
      const terse = callAnthropic_(
        buildActionsPrompt_(client, docs, team, true),
        { maxTokens: ACTIONS_MAX_TOKENS, model: actionsModel_(),
          noThinking: true, trace: log, traceStart: clock });
      const retryItems = (terse && terse.actions) || [];
      if (retryItems.length > items.length) {
        step('Retry was better', retryItems.length + ' items against '
          + items.length);
        items = retryItems;
        outOfScope = (terse && terse.outOfScope) || outOfScope;
        cutShort = !!(terse && terse._truncated);
      } else {
        step('Kept the first answer', items.length + ' items against '
          + retryItems.length);
      }
    } catch (e) {
      // The first answer is still an answer. A failed retry must not lose it.
      step('Retry failed', (e && e.message) || String(e));
    }
  }
  step('Items returned', items.length + (cutShort ? ' (the reply was cut short)' : '')
    + (outOfScope.length ? ' · ' + outOfScope.length + ' out of scope' : ''));

  // An empty result is an answer, not a failure. It used to come back as
  // ok:false, so "we did not promise anything specific" and "the API call
  // broke" arrived on screen as the same red toast.
  if (!items.length) {
    return { ok: true, written: 0, preserved: 0, read: read, log: log,
             outOfScope: outOfScope, unassigned: 0, teamEmpty: !team.length,
             nothing: true,
             message: (out && out.note)
               || 'Nothing in ' + read.join(', ') + ' reads as a specific '
                + 'commitment. If the deck is missing from the draft, add it '
                + 'and re-analyse first.' };
  }

  const kept = writeActions_(clientId, items);
  step('Written', kept.written + ' written · ' + kept.fresh.length + ' new · '
    + kept.preserved + ' already started, left alone');

  return {
    ok: true,
    log: log,
    written: kept.written,
    preserved: kept.preserved,
    // Which of them had never been on this client before. After adding a
    // document this is the answer to "so what did that give me" — and an empty
    // list is a real answer too: the call restated what was already known.
    fresh: kept.fresh,
    read: read,
    outOfScope: outOfScope,
    unassigned: items.filter(i => !i.owner).length,
    teamEmpty: !team.length,
    trimmed: trimmed,
    cutShort: cutShort,
    chars: chars,
    model: actionsModel_()
  };
}

/** The stored action items, newest generation first. */
function getActionItems(clientId) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.ACTIONS);

  // The empty case returns the SAME shape as the populated one. It used to
  // return { ok, items } alone, which dropped the document picker on the one
  // screen that cannot work without it: no items yet is exactly when somebody
  // is trying to build them, and the button answered "tick at least one
  // document" with nothing to tick.
  if (!sh || sh.getLastRow() < 2) {
    const empty = actionSources_(clientId);
    return { ok: true, items: [], statuses: ACTION_STATUSES,
             team: getTeam().map(t => t.name),
             sources: empty.rows, sourcesNote: empty.note };
  }

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

  const picker = actionSources_(clientId);
  return { ok: true, items: items, statuses: ACTION_STATUSES,
           team: getTeam().map(t => t.name),
           sources: picker.rows, sourcesNote: picker.note };
}

/**
 * The documents that could be read, with their sizes and a default tick.
 *
 * Size is shown because it is the thing that decides whether the request
 * finishes. A 62,000-character kickoff transcript and a 19,000-character deck
 * are not comparable choices, and nobody can tell them apart from two labels.
 *
 * The audit deck and the scope of work are ticked by default — the pitch deck
 * standing in when there is no audit — for the reasons in
 * preferredActionSources_. Transcripts are offered but left off, because they
 * are long and they are the reason the whole thing used to time out.
 */
function actionSources_(clientId) {
  const draftId = draftIdForClient_(clientId);
  if (!draftId) {
    return { rows: [], note: 'No draft is linked to this client, so there is '
      + 'nothing to read. Drafts hold the extracted text; a client created '
      + 'before drafts existed, or by hand, has none.' };
  }

  const d = openDraft(draftId);
  if (!d || !d.ok) {
    return { rows: [], note: 'The draft for this client could not be opened'
      + (d && d.message ? ' — ' + d.message : '') + '.' };
  }

  const all = (d.sources || []).filter(s => s && s.key !== 'form');
  const preferred = preferredActionSources_(all.map(s => s.key));
  const rows = all
    .filter(s => s.fileId)
    .map(s => ({
      key: s.key,
      label: s.label,
      chars: s.chars || 0,
      isCall: isImportedCallKey_(s.key)
        || s.key === 'sales' || s.key === 'kickoff',
      suggested: !!preferred[s.key]
    }));

  // The distinction that matters. "No documents" and "documents whose text was
  // never extracted" look identical on the page and have completely different
  // fixes — and the second is the common one, because the Deal documents card
  // below lists the ORIGINALS from Drive whether or not anything ever read
  // them. A page saying "5 documents" above a picker with nothing to tick is
  // the bug this sentence exists to prevent.
  let note = '';
  if (!rows.length) {
    note = all.length
      ? all.length + ' document' + (all.length === 1 ? ' is' : 's are')
        + ' on the draft but none has extracted text yet, so there is nothing '
        + 'to read. Re-analyse the draft to pull the text out.'
      : 'The draft has no documents on it.';
  }
  return { rows: rows, note: note };
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
  // Every item that was on this client before, at any status. A rebuild
  // deletes and rewrites the To-do rows, so without this "written: 6" cannot
  // tell you whether the document you just added produced anything — which is
  // the only question anybody asks after adding one.
  const before = {};
  let preserved = 0;

  if (sh.getLastRow() > 1) {
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, ACT.WIDTH).getValues();
    // Descending, so the indexes gathered here stay valid as rows are removed.
    for (let i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][ACT.CLIENT - 1]).trim() !== id) continue;
      const status = String(rows[i][ACT.STATUS - 1] || 'To do');
      before[String(rows[i][ACT.ACTION - 1]).trim()] = true;
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

  const fresh = rows.map(v => String(v[ACT.ACTION - 1]))
    .filter(a => !before[a.trim()]);

  return { written: rows.length, preserved: preserved, fresh: fresh };
}

// ---------------------------------------------------------------- PROMPT

/**
 * @param {boolean} [terse] second attempt after a reply ran out of room. The
 *   first attempt ran long by being expansive, so this one is told to strip
 *   the answer to its bones rather than being asked the same thing again.
 */
function buildActionsPrompt_(client, docs, team, terse) {
  const agency = cfg('Agency Name') || 'the agency';

  const system = [
    'You turn what ' + agency + ' promised a client into work. ' + agency + ' is',
    'a paid search and organic social agency.',
    '',
    // Named from what was actually picked rather than assumed. Telling the
    // model it is reading a deck it was not given is how a thin answer gets
    // blamed on the client having promised nothing.
    'You are reading: ' + docs.map(d => d.label).join(', ') + '. Find',
    'everything specific that was said would be done, and write each one as a',
    'task somebody can pick up.',
    '',
    'Commitments come in three shapes and all three count:',
    '- An audit finding with a fix attached. "60% impression share lost to ad',
    '  rank" is a finding; the commitment is the restructure proposed beside',
    '  it. An audit presentation is wall-to-wall these — it was written to show',
    '  the client what is wrong and what we would do about it, and every one of',
    '  those slides is a thing they now expect.',
    '- Something said out loud on a call. "We will rebuild the feed in month',
    '  two", "we will get that Reddit thread sorted" — spoken promises are the',
    '  ones that get forgotten, because they are not written anywhere.',
    '- A deliverable named in the scope of work that needs doing rather than',
    '  simply being ongoing management. "One custom landing page at a time" is',
    '  a commitment; "campaign management" is the retainer.',
    '',
    'Do not pad. Ongoing management, meetings and reporting cadence are the',
    'contract, not action items — a list padded with "attend the weekly call"',
    'is a list nobody reads. If something was discussed but explicitly not',
    'agreed, leave it out of actions.',
    '',
    terse
      ? 'Return at most ' + Math.ceil(ACTIONS_MAX_ITEMS / 2) + ' actions — the '
        + 'ones that cost the most to miss. THE LAST ATTEMPT RAN OUT OF ROOM '
        + 'AND WAS CUT OFF. Keep every field to a handful of words: why is at '
        + 'most eight words, source is the document name alone, and there are '
        + 'no quotations anywhere. A complete short answer beats a long one '
        + 'that never arrives.'
      : 'Return at most ' + ACTIONS_MAX_ITEMS + ' actions: the ones that cost '
        + 'the most to miss. A longer list is not a better one, and the tail '
        + 'is where padding hides.',
    '',
    // Length is the whole constraint here. A generous answer is one that never
    // arrives — see the note on ACTIONS_MAX_TOKENS.
    'BREVITY IS A HARD REQUIREMENT, not a style note. Every field is ONE short',
    'sentence — under 20 words. No preamble, no restating the question, no',
    'closing summary, no markdown. A long answer takes so long to write that',
    'the request is abandoned before it finishes and you produce nothing.',
    '',
    'NO QUOTATIONS ANYWHERE IN THE ANSWER. Not in source, not in why, not in',
    'action. source is the document name and at most four words locating the',
    'passage: "Audit presentation, impression share slide". Nothing after a',
    'dash, no quoted sentence from the transcript, no ellipsis. Quotes are the',
    'longest thing in the answer and the least load-bearing, and an answer that',
    'runs out of room loses whole items to make space for them.',
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
    '- source names the document and, where you can, quotes the promise. Being',
    '  able to see where a commitment came from is what settles the argument',
    '  about whether it was one.',
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
      source: 'string — document name and a few identifying words, no long quote',
      priority: 'Now|Next|Later',
      effort: 'string — rough size',
      owner: 'string — a name from the team list, or empty'
    }],
    outOfScope: [{
      item: 'string — what was proposed',
      why: 'string — why it is outside what was sold',
      needed: 'string — what would have to be agreed to do it'
    }],
    note: 'string — only if these documents contain no commitments at all'
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
    'Only return an empty actions array if these documents genuinely contain no',
    'specific promise of anything — say so in note if that happens. A pitch',
    'deck almost always contains commitments; if you find none, say what the',
    'documents did contain instead.',
    '',
    '--- DOCUMENTS ---',
    docs.map(d => '### ' + d.label + '\n'
      + trimForPrompt_(d.text, Math.floor(ACTIONS_CHAR_BUDGET / Math.max(docs.length, 1)))
    ).join('\n\n')
  ].join('\n');

  return { system: system, user: user };
}

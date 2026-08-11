/**
 * LOCKHERN ONBOARDING CRM — Client profile
 *
 * What the contract cannot tell you. The Clients row records what was bought;
 * this records who you bought it from — how they talk, what they care about,
 * what will annoy them, and who actually decides.
 *
 * It exists because that knowledge normally lives in the head of whoever ran
 * the sales call, and the people who need it most are the ones who were not on
 * it: the strategist writing the first report, whoever covers the account in
 * August, the person who inherits it next year.
 *
 * Generated from the draft's documents at the moment the client is created,
 * because that is the last point at which every source is still to hand.
 * Regenerable from the client page afterwards, since a kickoff call usually
 * changes the picture.
 */

/** Room for a page of prose plus quotes. Cells cap at 50,000 characters. */
const PROFILE_MAX_TOKENS = 4000;

// ---------------------------------------------------------------- PUBLIC

/**
 * Builds the profile for a client from the documents on its draft and stores
 * it on the Clients row. Callable from App.html.
 *
 * Never throws: a client record is worth more than a profile, so a failure here
 * is reported and nothing else is disturbed.
 */
function buildClientProfile(clientId, draftId) {
  const row = clientRowNumber_(clientId);
  if (!row) return { ok: false, message: 'Client not found.' };

  const docs = profileSources_(draftId);
  if (!docs.length) {
    return { ok: false, message: 'No stored documents to build a profile from. '
      + 'The draft they came from may have been deleted.' };
  }

  let out;
  try {
    out = callAnthropic_(buildProfilePrompt_(docs), { maxTokens: PROFILE_MAX_TOKENS });
  } catch (e) {
    return { ok: false, message: (e && e.message) || String(e) };
  }

  const text = renderProfile_(out);
  if (!text) return { ok: false, message: 'The model returned an empty profile.' };

  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.CLIENTS)
    .getRange(row, C.PROFILE).setValue(text.slice(0, 45000));

  return { ok: true, profile: text, sources: docs.map(d => d.label) };
}

/** The stored profile, for the client page. */
function getClientProfile(clientId) {
  const row = clientRowNumber_(clientId);
  if (!row) return { ok: false, message: 'Client not found.' };
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.CLIENTS);
  return { ok: true, profile: String(sh.getRange(row, C.PROFILE).getValue() || '') };
}

// ---------------------------------------------------------------- SOURCES

/**
 * The draft's documents, read back from Drive.
 *
 * Transcripts first and weighted heaviest: how someone talks on a call is the
 * whole point here, and a contract tells you nothing about it. The scope of
 * work is included for what was actually promised, since half of servicing
 * someone well is knowing what they are already expecting.
 */
function profileSources_(draftId) {
  if (!draftId) return [];
  const d = openDraft(draftId);
  if (!d || !d.ok) return [];

  const order = ['sales', 'kickoff', 'form', 'sow', 'deck'];
  const docs = [];

  order.forEach(key => {
    (d.sources || []).forEach(s => {
      if (s.key !== key || !s.fileId) return;
      const text = readStored_(s.fileId);
      if (text && text.trim()) {
        docs.push({ key: key, label: s.label, text: text });
      }
    });
  });
  return docs;
}

// ---------------------------------------------------------------- PROMPT

function buildProfilePrompt_(docs) {
  const agency = cfg('Agency Name') || 'the agency';

  const system = [
    'You write client profiles for ' + agency + ', a paid search and organic',
    'social agency. The profile is read by whoever picks this account up — a',
    'strategist writing the first report, someone covering in August, whoever',
    'inherits it next year. None of them were on the call.',
    '',
    'You are reading for the things a contract cannot record:',
    '- How they communicate. Long emails or one-liners. Formal or blunt. Do they',
    '  want detail or the headline. Do they reply fast.',
    '- What they actually care about, which is often not what they said first.',
    '- What will annoy them. Past agencies, broken promises, pet hates, jargon.',
    '- How decisions get made, and by whom. Who can say yes to spend.',
    '- What they know. Do they read a search terms report, or do they need',
    '  "clicks" explained. Pitching over or under their level both lose trust.',
    '- Constraints that are cultural rather than contractual — family business,',
    '  founder-led, seasonal, risk-averse about brand.',
    '',
    'Rules:',
    '- Write for someone who has ten minutes before their first call with this',
    '  client. Specific and useful beats complete.',
    '- Ground it. Quote them where a quote makes the point better than a summary.',
    '  Their own words carry the tone; your paraphrase does not.',
    '- Omit anything you cannot support. An empty section is fine, invented',
    '  personality is not — someone will act on this.',
    '- No flattery and no hedging. If they were difficult about something, say',
    '  so plainly and say what triggered it.',
    '- Do not restate the contract. Fees, dates and deliverables are already on',
    '  the record; they belong here only where they reveal something about the',
    '  person, like haggling hard or waving the detail away.',
    '',
    'Return ONLY a JSON object, no prose and no code fence.'
  ].join('\n');

  const shape = {
    summary: 'string — 2-3 sentences. Who they are and what servicing them well looks like.',
    communication: 'string — how they talk and how to talk back to them',
    priorities: ['string — what they actually care about, most important first'],
    frictions: ['string — what will annoy them, and what caused it before'],
    decisions: 'string — who decides what, and how',
    expertise: 'string — how much they know, and where to pitch the detail',
    context: ['string — anything else that changes how you handle them'],
    quotes: [{ text: 'string — their own words', why: 'string — what it tells you' }]
  };

  const user = [
    'Build the profile from these documents.',
    '',
    'Shape:',
    JSON.stringify(shape, null, 2),
    '',
    'Leave out any key you cannot support from the documents. Prefer the call',
    'transcripts for tone and temperament — they are the only place it shows.',
    '',
    '--- DOCUMENTS ---',
    docs.map(d => '### ' + d.label + '\n'
      + trimForPrompt_(d.text, Math.floor(PROMPT_CHAR_BUDGET / Math.max(docs.length, 1)))
    ).join('\n\n')
  ].join('\n');

  return { system: system, user: user };
}

/**
 * Markdown, not JSON, in the cell.
 *
 * The Clients tab is read by people, and the client page renders this straight.
 * Storing JSON would mean nobody could read it in the sheet, which is where
 * half the team actually works.
 */
function renderProfile_(p) {
  if (!p || typeof p !== 'object') return '';
  const out = [];

  if (p.summary) out.push(String(p.summary).trim());

  const para = (heading, val) => {
    if (!val) return;
    out.push('', '## ' + heading, String(val).trim());
  };
  const list = (heading, arr) => {
    if (!arr || !arr.length) return;
    out.push('', '## ' + heading);
    arr.forEach(x => { if (x) out.push('- ' + String(x).trim()); });
  };

  para('Communication', p.communication);
  list('What they care about', p.priorities);
  list('What will annoy them', p.frictions);
  para('Decisions', p.decisions);
  para('Where to pitch it', p.expertise);
  list('Context', p.context);

  if (p.quotes && p.quotes.length) {
    out.push('', '## In their words');
    p.quotes.forEach(q => {
      if (!q || !q.text) return;
      out.push('- "' + String(q.text).trim() + '"'
        + (q.why ? ' — ' + String(q.why).trim() : ''));
    });
  }

  return out.join('\n').trim();
}

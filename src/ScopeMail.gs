/**
 * LOCKHERN ONBOARDING CRM — Scope confirmation
 *
 * The email that says, in writing, what was bought.
 *
 * This one cannot be a shared template. A welcome email is the same for every
 * client because it asks for the same three things; a scope confirmation is a
 * restatement of one specific contract, and a template version of it is either
 * so vague it confirms nothing or a set of blanks somebody fills in by copying
 * out of the SOW by hand. Which is how a fee gets transcribed wrong, and a fee
 * transcribed wrong in writing is a fee you have agreed to.
 *
 * So it is drafted from the signed scope of work itself, and returned for
 * review rather than sent. Nobody should send a restatement of a contract they
 * have not read.
 */

/** Room for a page of scope, and no more — see the note in Audit.gs. */
const SCOPE_MAX_TOKENS = 3000;

/** The signed contract, and what the review screen recorded from it. */
const SCOPE_SOURCE_KEYS = ['sow', 'deck'];

/**
 * Drafts the scope confirmation for one client.
 *
 * Returns subject and body for editing. It never writes to the Templates tab:
 * that copy is shared across every client, and one client's fees landing in it
 * would be sent to the next.
 */
function draftScopeEmail(token, clientId) {
  checkToken_(token);

  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };

  const all = profileSources_(draftIdForClient_(clientId));
  const docs = all.filter(d => SCOPE_SOURCE_KEYS.indexOf(d.key) !== -1);

  if (!docs.length) {
    return { ok: false,
             message: all.length
               ? 'No scope of work is stored against this client. The documents '
                 + 'on file are ' + all.map(d => d.label).join(', ')
                 + ' — a scope confirmation has to come from the signed '
                 + 'contract, not from the record of what someone typed.'
               : 'No stored documents, so there is no contract to read. Upload '
                 + 'the signed scope of work to the draft first.' };
  }

  let out;
  try {
    out = callAnthropic_(buildScopePrompt_(client, docs),
                         { maxTokens: SCOPE_MAX_TOKENS, noThinking: true });
  } catch (e) {
    return { ok: false, message: (e && e.message) || String(e) };
  }

  if (!out || !out.body) {
    return { ok: false, message: 'The model returned no email body.' };
  }

  return {
    ok: true,
    subject: String(out.subject || 'Scope confirmation — ' + client.company),
    body: String(out.body),
    read: docs.map(d => d.label),
    // Anything it could not find in the contract, named rather than invented.
    // A confirmation with a plausible guess in it is worse than one with a gap,
    // because the gap gets filled before sending and the guess does not.
    gaps: out.gaps || []
  };
}

function buildScopePrompt_(client, docs) {
  const agency = cfg('Agency Name') || 'Lockhern Digital';

  const system = [
    'You draft scope confirmation emails for ' + agency + ', a paid search and',
    'organic social agency. The email restates what a client has just signed,',
    'in plain words, so both sides are working from the same understanding',
    'before anything starts.',
    '',
    'This is a restatement, not a sales document and not a summary. Rules:',
    '',
    '- Every fact comes from the contract. If the contract does not say it, it',
    '  does not go in the email — it goes in gaps.',
    '- Never round, adjust or tidy a number. A fee restated wrong in writing is',
    '  a fee that has been agreed wrong.',
    '- Say what is NOT included where the contract is explicit about it. That',
    '  paragraph is the entire reason this email exists: it is far cheaper to',
    '  have the awkward conversation now than in month three.',
    '- Keep it short enough to read on a phone. Deliverables as a list, fees as',
    '  a list, everything else in a sentence or two.',
    '- No jargon and no enthusiasm. Warm, brief and precise. They have already',
    '  bought — this is the email that stops them regretting it.',
    '- Do not invent a start date, a notice period or a payment term. Those are',
    '  the three most commonly disputed items and the three most commonly',
    '  assumed.',
    '',
    'Return ONLY a JSON object, no prose and no code fence.'
  ].join('\n');

  const shape = {
    subject: 'string — includes the company name',
    body: 'string — the email, plain text, line breaks as \\n',
    gaps: ['string — something a scope confirmation should state that this '
           + 'contract does not, named plainly']
  };

  const user = [
    'Client: ' + client.company,
    'Contact: ' + (client.contact || 'not recorded'),
    'Services recorded on the client record: ' + (client.servicesRaw || 'none'),
    'Contract start recorded: ' + (client.contractStart || 'not recorded'),
    'Term recorded: ' + (client.term || 'not recorded'),
    'Fees recorded: ' + (client.fees && client.fees.length
      ? JSON.stringify(client.fees) : 'none'),
    '',
    'The recorded values above came from an earlier extraction and may be',
    'wrong. Where they disagree with the contract, the contract wins and the',
    'disagreement goes in gaps.',
    '',
    'Sign off as ' + (client.owner || agency) + '.',
    '',
    'Return:',
    JSON.stringify(shape, null, 2),
    '',
    '--- DOCUMENTS ---',
    docs.map(d => '### ' + d.label + '\n'
      + trimForPrompt_(d.text, Math.floor(60000 / Math.max(docs.length, 1)))
    ).join('\n\n')
  ].join('\n');

  return { system: system, user: user };
}

/**
 * LOCKHERN ONBOARDING CRM — What a new document changed
 *
 * You file a call from last Tuesday. Then what?
 *
 * Two questions follow, and until now the tool answered neither. What work
 * does this create — answered by rebuilding the action items, which now says
 * which of them had never been there before. And what does it change about
 * what we know about this client, which is this file.
 *
 * WHY IT DOES NOT REWRITE THE PROFILE. The profile is written once from the
 * deal documents and is deliberately stable: a document that rewrites itself
 * weekly is one nobody trusts, and nobody can tell what changed in it either.
 * So this reads the new document AGAINST the profile and reports the
 * differences — the section each one belongs to, and what it now says — as
 * dated notes in recent context. The profile keeps saying what it said in
 * February; the note below it says what changed in August, with the date on it.
 *
 * That is also the honest shape. "The promo changed again" is only visible if
 * the first change is still there.
 */

const REREAD_MAX_TOKENS = 2000;

/** The profile's own headings, so a change lands somewhere findable. */
const PROFILE_SECTIONS = [
  'Communication', 'What they care about', 'What will annoy them',
  'Decisions', 'Constraints', 'History', 'Watch out for'
];

/**
 * Reads one newly filed document against what we already believed.
 *
 * Returns the changes for review and writes them as dated notes. It never
 * touches C.PROFILE.
 */
function reviewNewDocument(token, clientId, key) {
  checkToken_(token);

  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };

  const draftId = draftIdForClient_(clientId);
  const doc = draftId ? storedSource_(draftId, key) : null;
  if (!doc || !doc.text) {
    return { ok: false, message: 'That document is not stored against this '
      + 'client any more.' };
  }

  const profile = String(client.profile || '');

  let out;
  try {
    out = callAnthropic_(buildRereadPrompt_(client, doc, profile),
                         { maxTokens: REREAD_MAX_TOKENS, noThinking: true });
  } catch (e) {
    return { ok: false, message: (e && e.message) || String(e) };
  }

  const changes = (out && out.changes) || [];

  // Nothing new is a real answer and a common one — most calls restate what
  // is already known, and saying so is more useful than inventing a change.
  if (!changes.length) {
    return { ok: true, changes: [], written: 0, read: doc.label,
             message: 'Nothing in ' + doc.label + ' changes what the profile '
               + 'already says.' };
  }

  const box = readRecent_(clientId);
  box.notes = box.notes || [];
  const stamp = fmtDate_(new Date());

  // Newest first, and the order within one batch preserved by unshifting in
  // reverse — a list of four changes reads top to bottom the way the model
  // wrote it, not backwards.
  changes.slice().reverse().forEach(c => {
    box.notes.unshift({
      at: stamp,
      text: (c.section ? c.section + ': ' : '') + String(c.now || '')
        + (c.was ? ' (profile says: ' + c.was + ')' : ''),
      by: doc.label
    });
  });
  box.notes = box.notes.slice(0, RECENT_NOTE_LIMIT);
  writeRecent_(clientId, box);

  return { ok: true, changes: changes, written: changes.length,
           read: doc.label, notes: box.notes };
}

/** One stored source, with its text. */
function storedSource_(draftId, key) {
  const d = openDraft(draftId);
  if (!d || !d.ok) return null;
  const hit = (d.sources || []).filter(s => s && s.key === key)[0];
  if (!hit) return null;
  return { key: hit.key, label: hit.label || hit.key,
           text: readStored_(hit.fileId) };
}

function buildRereadPrompt_(client, doc, profile) {
  const system = [
    'You are keeping an agency\'s knowledge of a client current.',
    '',
    'You are given a client profile written some time ago, and ONE document',
    'filed since. Report only what the document changes or adds. Everything',
    'else — however interesting — is already known and is noise here.',
    '',
    'A change is worth reporting when acting on the old belief would now be',
    'wrong: a budget that moved, a contact who left, a target that was revised,',
    'a preference stated for the first time, a decision reversed. A change of',
    'wording is not a change. A restatement is not a change.',
    '',
    'section must be one of: ' + PROFILE_SECTIONS.join(' | ') + '. Pick the one',
    'somebody would look under. If the profile has no section that fits, use',
    'the closest.',
    '',
    'was: what the profile currently implies, quoted or closely paraphrased.',
    'Leave it empty when this is new rather than changed — do not invent a',
    'previous belief to contrast with.',
    'now: what the document says, in one sentence, specific and with the',
    'numbers in it.',
    'quote: the line from the document that says so.',
    '',
    'Be sparing. Four real changes beat twelve restatements, and a list padded',
    'with "the client is engaged" is one nobody reads twice.',
    '',
    'Return ONLY a JSON object, no prose and no code fence.'
  ].join('\n');

  const shape = {
    changes: [{ section: 'string', was: 'string', now: 'string', quote: 'string' }]
  };

  const user = [
    'Client: ' + client.company,
    '',
    'Return:',
    JSON.stringify(shape, null, 2),
    '',
    '--- CURRENT PROFILE ---',
    profile || '(no profile has been written for this client)',
    '',
    '--- NEW DOCUMENT: ' + doc.label + ' ---',
    trimForPrompt_(doc.text, 60000)
  ].join('\n');

  return { system: system, user: user };
}

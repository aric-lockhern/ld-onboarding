/**
 * LOCKHERN ONBOARDING CRM — Who is looking, and what they may see
 *
 * The tool is meant to be opened by everyone who touches an account —
 * strategists, freelancers, the person chasing access. What they pay us is not
 * part of that. MRR and the fee lines are the one thing on the client record
 * that is nobody's business but the partners'.
 *
 * HOW IT KNOWS WHO YOU ARE. The web app is deployed "execute as me, access
 * within the domain", so Google authenticates the visitor against the Workspace
 * before the page loads and `Session.getActiveUser().getEmail()` is their
 * address. Nothing is typed, nothing is stored, and there is no password to
 * share around. `getEffectiveUser()` is the account that deployed it — the
 * owner — which is why they are always allowed: they own the script and the
 * spreadsheet, and denying them would be theatre.
 *
 * WHY BLANK MEANS HIDDEN. Every other column added to a populated tab reads as
 * empty and has to mean "as before", or a new column silently changes
 * behaviour. This one is the exception and it is deliberate: a secret whose
 * default is open leaks on exactly the day somebody new is imported off the
 * Slack roster, which is the case this exists for. So the day the column
 * appears, everyone loses the number until a partner ticks them back on — an
 * inconvenience that announces itself, rather than a leak that does not.
 *
 * WHAT THIS IS NOT. It is not a wall around the money. Two holes stay open and
 * no amount of code here closes either:
 *
 *   1. THE SPREADSHEET. Anyone the Sheet is shared with reads MRR in column J,
 *      and can read around any of this from the script editor. The fix is not
 *      to share the Sheet — the web app runs as the deploying account, so
 *      nobody needs it to use the tool. That is the actual control; this file
 *      is what makes the tool usable once you stop sharing it.
 *   2. THE SOURCE DOCUMENTS. The signed scope of work states the fee, and it
 *      lives in Drive. Whoever can open the deal folder can read the number
 *      off page four.
 *
 * Say both out loud rather than describing this as access control.
 */

/** The fields on a client record that only a finance viewer gets. */
const FINANCE_FIELDS = ['mrr', 'fees'];

// ---------------------------------------------------------------- WHO

/**
 * The signed-in visitor, lowercased.
 *
 * Empty when Google will not say — an anonymous deployment, or a context with
 * no user at all. Empty is treated as "not allowed" everywhere below, because
 * the alternative is a misconfiguration that opens the number to the internet.
 */
function viewerEmail_() {
  try {
    return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  } catch (e) {
    return '';
  }
}

/** The account the web app runs as — the owner. */
function ownerEmail_() {
  try {
    return String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  } catch (e) {
    return '';
  }
}

/**
 * May this visitor see what clients pay?
 *
 * Deliberately not cached across calls. It is two cheap reads, and a stale
 * "yes" held in a script property is exactly the failure nobody would notice.
 */
function viewerSeesFinance_() {
  const me = viewerEmail_();
  if (!me) return false;
  if (me === ownerEmail_()) return true;

  return getTeam().some(t =>
    t.finance && String(t.email || '').trim().toLowerCase() === me);
}

/**
 * Who is looking, for the browser.
 *
 * Public so the page can render the difference rather than silently dropping a
 * row: a blank where MRR used to be reads as missing data, and somebody then
 * goes and types the number back in from the contract.
 */
function whoAmI() {
  const me = viewerEmail_();
  const owner = me && me === ownerEmail_();
  const person = me
    ? getTeam().filter(t =>
        String(t.email || '').trim().toLowerCase() === me)[0]
    : null;

  return {
    email: me,
    name: (person && person.name) || '',
    owner: !!owner,
    finance: viewerSeesFinance_(),
    // The three reasons the answer is no, which are three different fixes.
    reason: me
      ? (viewerSeesFinance_() ? ''
         : (person ? 'notFinance' : 'notOnTeam'))
      : 'unknown'
  };
}

// ---------------------------------------------------------------- REDACT

/**
 * Strips the money off a client record on its way to the browser.
 *
 * Server-side, and on the record rather than in CSS. A hidden field that was
 * still in the payload would be one View Source away, which is not a gate —
 * it is a note asking people not to look.
 *
 * Returns a copy. `getClientRecord_` is used internally by the mailer, the
 * plan generator and the scope drafter, all of which legitimately need the
 * number; redacting at the source would break them.
 */
function redactFinance_(client, allowed) {
  if (!client) return client;
  if (allowed === undefined) allowed = viewerSeesFinance_();
  if (allowed) return client;

  const out = {};
  Object.keys(client).forEach(k => { out[k] = client[k]; });
  FINANCE_FIELDS.forEach(k => { delete out[k]; });
  out.financeHidden = true;
  return out;
}

/**
 * The same, for the intake screens.
 *
 * The extraction reads the signed contract, so its fee table and its MRR are
 * the number itself rather than a copy of it. Redacted on the way out of
 * `runExtraction` and again on the way out of `openDraft`, because the result
 * is stored on the draft and reopened days later by whoever picks it up.
 *
 * Everything else survives — services, dates, business type, the conflicts and
 * the open questions. Someone can still do the intake; they finish it without
 * the fee, and a partner fills that in on the client page.
 */
function redactExtractionFinance_(ex, allowed) {
  if (!ex) return ex;
  if (allowed === undefined) allowed = viewerSeesFinance_();
  if (allowed) return ex;

  const out = {};
  Object.keys(ex).forEach(k => { out[k] = ex[k]; });
  out.fees = null;

  if (out.fields) {
    const f = {};
    Object.keys(out.fields).forEach(k => {
      if (k !== 'mrr') f[k] = out.fields[k];
    });
    out.fields = f;
  }
  out.financeHidden = true;
  return out;
}

/** A saved intake form, which can hold an MRR somebody typed. */
function redactFormFinance_(form, allowed) {
  if (!form) return form;
  if (allowed === undefined) allowed = viewerSeesFinance_();
  if (allowed) return form;

  const out = {};
  Object.keys(form).forEach(k => {
    if (FINANCE_FIELDS.indexOf(k) === -1) out[k] = form[k];
  });
  return out;
}

/**
 * The MRR and fee lines to write when a client is created.
 *
 * A finance viewer's form carries both and they are used as sent. Anyone
 * else's form has neither, because they were never shown either — so the
 * numbers are read back off the draft the intake came from, which still holds
 * the extraction whole. Nothing reaches the browser; this runs on the way in.
 *
 * Falls back to blank when there is no draft, which is the hand-typed case: a
 * client created by somebody who cannot see fees genuinely has no fee to
 * record, and a partner types it on the client page.
 */
function intakeFinance_(payload) {
  payload = payload || {};

  if (viewerSeesFinance_()) {
    return {
      mrr: payload.mrr || '',
      fees: payload.fees ? JSON.stringify(payload.fees) : ''
    };
  }

  let mrr = '';
  let fees = '';
  try {
    const draft = payload.draftId ? draftRow_(payload.draftId) : null;
    if (draft) {
      const form = safeParse_(draft.values[D.FORM - 1], null) || {};
      const ex = safeParse_(draft.values[D.EXTRACTION - 1], null) || {};
      // The typed form beats the extraction, the same order exVal reads them
      // in on the review screen — a corrected fee is the later and more
      // deliberate act.
      mrr = form.mrr
        || (ex.fields && ex.fields.mrr && ex.fields.mrr.value) || '';
      const lines = form.fees || (ex.fees && ex.fees.value);
      fees = lines && lines.length ? JSON.stringify(lines) : '';
    }
  } catch (e) {
    // A draft that cannot be read is not a reason to refuse to create the
    // client. It costs the fee line, which the client page can fix.
  }
  return { mrr: mrr, fees: fees };
}

/**
 * Refuses a write to a finance field.
 *
 * Hiding a value without refusing the write leaves a field somebody can
 * overwrite with a number they cannot read, which is worse than showing it.
 */
function financeWritable_(field) {
  return FINANCE_FIELDS.indexOf(String(field || '')) === -1
    || viewerSeesFinance_();
}

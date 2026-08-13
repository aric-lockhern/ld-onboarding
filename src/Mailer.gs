/**
 * LOCKHERN ONBOARDING CRM — Every email this client is owed, in one place
 *
 * The emails all existed. They were scattered: the access email behind a phase
 * preview on the queue screen, the kickoff invite behind a different phase, the
 * welcome email nowhere at all, and the nudge on its own button. Sending a new
 * client everything they are due meant knowing which screen each one lived on.
 *
 * HOW IT SENDS. MailApp, as the Google account that deployed the web app —
 * which is the Gmail integration; there is nothing to connect. Replies go to
 * Config "Reply To" when it is set, and the sender name is the agency name.
 * Nothing here talks to an API or stores a credential.
 *
 * WHY IT IS NOT ONE BUTTON WITH NO LIST. Client email cannot be recalled. The
 * card shows what would go, to whom, and what each one says, with anything not
 * sendable saying why — then one button sends the ticked ones. That is one
 * click after a glance rather than one click into the dark, and the glance is
 * the part that stops a half-configured template reaching a client.
 *
 * WHAT IS NOT HERE. The scope confirmation is drafted per client from the
 * signed contract and has to be read before it goes — a restatement of a
 * contract is not something to blast. It stays on its own card with its own
 * review step, which is the point of it.
 */

/**
 * The emails that are not tied to a phase.
 *
 * A phase email is discovered from the Phases tab, which is where that mapping
 * belongs. These two are moments rather than phases and would otherwise have
 * nowhere to be listed.
 */
const STANDALONE_MAIL = [
  { key: '_welcome', label: 'Welcome email',
    when: 'Sent once, after the client record exists.' }
];

// ---------------------------------------------------------------- READ

/**
 * Everything sendable for one client, with its state.
 *
 * Never sends and never marks anything Requested — the same rule the phase
 * preview follows, for the same reason: a screen that mutates by being looked
 * at cannot be trusted to be looked at.
 */
function getMailPlan(clientId) {
  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };

  const sent = sentIndex_(clientId);
  const items = [];

  STANDALONE_MAIL.forEach(m => {
    const built = buildStandaloneEmail_(clientId, m.key);
    items.push(mailRow_(m.key, m.label, m.when, built, sent));
  });

  // Phase emails, in phase order. A phase with no template in its Client Email
  // column has no client email — that is a fact about the process, not a gap.
  getPhases_().forEach(p => {
    if (!p.email) return;
    const built = buildPhaseEmail_(clientId, p.phase);
    items.push(mailRow_('phase' + p.phase, 'Phase ' + p.phase + ' — ' + p.name,
      built.taskCount ? built.taskCount + ' things to ask them for' : '',
      built, sent, p.phase));
  });

  // The nudge is listed either way, because "nothing is waiting on them" is a
  // useful thing to be told when you were about to chase somebody.
  const nudge = buildNudgeEmail_(clientId);
  items.push(mailRow_('_nudge', 'Nudge — outstanding requests',
    'Only sendable while something is waiting on them.', nudge, sent));

  return {
    ok: true,
    to: client.email,
    items: items,
    ready: items.filter(i => i.can).length,
    // Where replies land and who it comes from, because both are wrong often
    // enough to be worth seeing before a first send rather than after.
    from: cfg('Agency Name') || 'Lockhern Digital',
    replyTo: cfg('Reply To') || ''
  };
}

/**
 * One row of the plan.
 *
 * `can` and `why` come straight from the same builder the send path uses, so
 * the card can never show something as ready that the send would refuse.
 */
function mailRow_(key, label, when, built, sent, phase) {
  const why = []
    .concat(built.reasons || [])
    .concat(built.problems || [])
    .filter(Boolean);

  return {
    key: key,
    label: label,
    when: when,
    phase: phase || 0,
    can: !!built.ok,
    why: why,
    gated: !!built.gated,
    to: built.to || '',
    subject: built.subject || '',
    body: built.body || '',
    taskCount: built.taskCount || 0,
    // The answer to "did this go out" — a date, or nothing. It reads the Sent
    // Log, which has been written on every send since the beginning and never
    // once read back.
    sentAt: sent[key] || '',
    sentCount: sentCount_(sent, key)
  };
}

/** A standalone template, merged and preflighted like a phase email. */
function buildStandaloneEmail_(clientId, key) {
  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, reasons: ['Client not found.'] };

  const tpl = getTemplate_(key);
  if (!tpl || !tpl.body) {
    return { ok: false, reasons: ['No copy for ' + key + ' — write it on the '
      + 'Settings page.'] };
  }

  const sig = cfg('Email Signature');
  const composed = {
    ok: true,
    subject: mergeTags_(tpl.subject, client),
    body: mergeTags_(tpl.body, client) + (sig ? '\n\n' + sig : ''),
    to: client.email, taskCount: 0, tasks: []
  };

  const pre = preflight_(clientId, composed);
  return {
    ok: pre.ok, blocked: !pre.ok, problems: pre.problems,
    to: composed.to, subject: composed.subject, body: composed.body,
    taskCount: 0, tasks: []
  };
}

/**
 * What has already gone to this client, by email.
 *
 * The Sent Log has recorded every send since the first one and nothing has
 * ever read it — so "have we sent the welcome email?" was a question you
 * answered by opening a tab and scrolling. Matched on the Type column, which
 * is what logSend_ writes.
 */
function sentIndex_(clientId) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sent Log');
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;

  const id = String(clientId).trim();
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();

  // The Type column as logSend_ writes it: "Phase 2 — Client Requests",
  // "Nudge", or a standalone label. Derived rather than stored, so the log
  // written before this file existed still reads correctly.
  const keyFor = type => {
    const t = String(type || '').trim();
    const phase = t.match(/^Phase\s+(\d+)/i);
    if (phase) return 'phase' + phase[1];
    if (/^nudge/i.test(t)) return '_nudge';
    const hit = STANDALONE_MAIL.filter(m => m.label === t)[0];
    return hit ? hit.key : '';
  };

  rows.forEach(r => {
    if (String(r[1]).trim() !== id) return;
    const key = keyFor(r[2]);
    if (!key) return;

    const when = r[0] instanceof Date ? r[0] : parseDate_(r[0]);
    // Latest wins: "when did this last go" is the question, and a first send
    // three months ago is not the answer after a resend on Tuesday.
    if (when && (!out[key] || when > out['@' + key])) {
      out['@' + key] = when;
      out[key] = fmtDate_(when);
    }
    out['#' + key] = (out['#' + key] || 0) + 1;
  });
  return out;
}

/** How many times one email has gone to this client. */
function sentCount_(sent, key) {
  return sent['#' + key] || 0;
}

// ---------------------------------------------------------------- SEND

/**
 * Sends the picked emails, one at a time, and reports each outcome.
 *
 * Rebuilt from scratch here rather than trusting what the browser was shown:
 * the page may have been open for an hour, a gate may have closed since, and
 * an email that was sendable when the card rendered is not necessarily
 * sendable now. Same builders, same order — so this can refuse something the
 * card offered, and says so per email rather than failing the batch.
 */
function sendMailPlan(token, clientId, keys) {
  checkToken_(token);

  const want = (keys || []).map(k => String(k));
  if (!want.length) return { ok: false, message: 'Nothing ticked.' };

  const results = [];
  let sent = 0;

  want.forEach(key => {
    let built;
    let kind;

    const phase = key.match(/^phase(\d+)$/);
    if (phase) {
      const n = Number(phase[1]);
      built = buildPhaseEmail_(clientId, n);
      kind = 'Phase ' + n + ' — ' + (built.phaseName || '');
    } else if (key === '_nudge') {
      built = buildNudgeEmail_(clientId);
      kind = 'Nudge';
    } else {
      const m = STANDALONE_MAIL.filter(x => x.key === key)[0];
      if (!m) {
        results.push({ key: key, ok: false, why: 'Unknown email.' });
        return;
      }
      built = buildStandaloneEmail_(clientId, key);
      kind = m.label;
    }

    if (!built.ok) {
      results.push({ key: key, ok: false,
        why: [].concat(built.reasons || [], built.problems || [])
               .filter(Boolean).join(' ') || 'Not sendable.' });
      return;
    }

    try {
      deliver_(built.to, built.subject, built.body);
    } catch (e) {
      // One failure is not the batch failing. Gmail's daily quota is the
      // usual cause and it stops the rest too, but naming which one died is
      // what tells you where to pick up.
      results.push({ key: key, ok: false,
                     why: (e && e.message) || String(e) });
      return;
    }

    // Only after it actually went. Marking tasks Requested for an email that
    // threw would leave the client waiting on a request they never received.
    if (built.tasks && built.tasks.length) markRequested_(clientId, built.tasks);
    logSend_(clientId, kind, built.taskCount || 1, built.to);

    sent++;
    results.push({ key: key, ok: true, to: built.to,
                   taskCount: built.taskCount || 0 });
  });

  return { ok: sent > 0, sent: sent, results: results,
           message: sent ? '' : 'Nothing could be sent.' };
}

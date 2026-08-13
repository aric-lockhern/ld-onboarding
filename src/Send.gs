/**
 * LOCKHERN ONBOARDING CRM — Preview & send
 *
 * Nothing sends without being looked at. dashPreview returns the exact bytes
 * that will go out; dashSend delivers them. Both run the same two checks —
 * phase gates, then preflight — so the preview cannot show something the send
 * would refuse, or vice versa.
 */

const PLACEHOLDERS = [
  '[MCC ID]', '[Business Manager ID]', '[Merchant Center ID]',
  '[access email]', '[Shopify partner]'
];

// ---------------------------------------------------------------- CHECKS

function preflight_(clientId, composed) {
  const problems = [];
  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, problems: ['Client record not found.'] };

  if (!client.email || String(client.email).indexOf('@') === -1) {
    problems.push('No contact email on the client record.');
  }
  if (!client.alias || String(client.alias).indexOf('@') === -1) {
    problems.push('No access alias set.');
  }
  if (composed && composed.body) {
    const unresolved = composed.body.match(/\{\{(\w+)\}\}/g);
    if (unresolved) {
      problems.push('Unfilled merge tags: ' + [...new Set(unresolved)].join(', '));
    }
    PLACEHOLDERS.forEach(p => {
      if (composed.body.indexOf(p) !== -1) {
        problems.push('Config missing — email would say ' + p);
      }
    });
  }
  return { ok: !problems.length, problems: problems };
}

// ---------------------------------------------------------------- COMPOSE

/** Builds the message for a phase without sending or logging anything. */
function buildPhaseEmail_(clientId, phaseNum) {
  const gate = phaseSendCheck_(clientId, phaseNum);
  if (!gate.ok) {
    return { ok: false, gated: true, reasons: gate.reasons, phaseName: gate.phaseName };
  }

  const phase = getPhases_().find(p => p.phase === phaseNum);
  const client = getClientRecord_(clientId);

  let composed;
  if (phase.email === '_access') {
    composed = composeAccessEmail(clientId);
    if (!composed.ok) return { ok: false, reasons: [composed.message] };
  } else {
    const tpl = getTemplate_(phase.email);
    if (!tpl) return { ok: false, reasons: ['No template named ' + phase.email + '.'] };
    const sig = cfg('Email Signature');
    composed = {
      ok: true,
      subject: mergeTags_(tpl.subject, client),
      body: mergeTags_(tpl.body, client) + (sig ? '\n\n' + sig : ''),
      to: client.email, taskCount: 0, tasks: []
    };
  }

  const pre = preflight_(clientId, composed);
  return {
    ok: pre.ok, blocked: !pre.ok, problems: pre.problems,
    phase: phaseNum, phaseName: phase.name, template: phase.email,
    to: composed.to, subject: composed.subject, body: composed.body,
    taskCount: composed.taskCount, tasks: composed.tasks
  };
}

/** Preview. Reads only — never sends, never marks anything Requested. */
function dashPreview(token, clientId, phaseNum) {
  checkToken_(token);
  return buildPhaseEmail_(clientId, phaseNum);
}

function dashPreviewNudge(token, clientId) {
  checkToken_(token);
  return buildNudgeEmail_(clientId);
}

/**
 * The nudge, built without a token.
 *
 * Split out so the mail plan can include it. A read that needs a token cannot
 * be reused by another read that does not have one, and passing an empty
 * string through checkToken_ is a bug waiting for the day somebody sets a PIN.
 */
function buildNudgeEmail_(clientId) {
  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, reasons: ['Client not found.'] };

  const pending = getClientTasks_(clientId).filter(t =>
    t.method !== 'INTERNAL' && t.status === 'Requested');
  if (!pending.length) {
    return { ok: false, reasons: ['Nothing is currently waiting on the client.'] };
  }

  const tpl = getTemplate_('_nudge');
  const body = mergeTags_(tpl.body, client)
    .replace('{{list}}', pending.map(t => '· ' + t.task).join('\n'));
  const composed = { body: body };
  const pre = preflight_(clientId, composed);

  return {
    ok: pre.ok, blocked: !pre.ok, problems: pre.problems, kind: 'nudge',
    to: client.email, subject: mergeTags_(tpl.subject, client),
    body: body, taskCount: pending.length
  };
}

// ---------------------------------------------------------------- SEND

function dashSend(token, clientId, phaseNum) {
  checkToken_(token);
  const built = buildPhaseEmail_(clientId, phaseNum);
  if (!built.ok) return built;

  deliver_(built.to, built.subject, built.body);
  if (built.tasks && built.tasks.length) markRequested_(clientId, built.tasks);
  logSend_(clientId, 'Phase ' + phaseNum + ' — ' + built.phaseName,
    built.taskCount || 1, built.to);

  return { ok: true, sent: built.taskCount, to: built.to };
}

function dashSendNudge(token, clientId) {
  checkToken_(token);
  const built = dashPreviewNudge(token, clientId);
  if (!built.ok) return built;

  deliver_(built.to, built.subject, built.body);
  logSend_(clientId, 'Nudge', built.taskCount, built.to);
  return { ok: true, sent: built.taskCount, to: built.to };
}

function deliver_(to, subject, body) {
  const opts = { name: cfg('Agency Name') || 'Lockhern Digital' };
  const replyTo = cfg('Reply To');
  if (replyTo) opts.replyTo = replyTo;
  MailApp.sendEmail(to, subject, body, opts);
}

function logSend_(clientId, kind, count, to) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Sent Log');
  if (!sh) {
    sh = ss.insertSheet('Sent Log');
    sh.getRange(1, 1, 1, 6).setValues([['When', 'Client ID', 'Type', 'Items', 'To', 'By']])
      .setFontWeight('bold').setFontFamily('Roboto Mono').setFontSize(9)
      .setBackground(INK).setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  sh.appendRow([new Date(), clientId, kind, count, to, Session.getActiveUser().getEmail()]);
}

// ---------------------------------------------------------------- QUEUE

/**
 * The default screen. Phase-aware: a client only appears under "Ready to
 * preview" when its phase has a client email and every earlier gate is closed.
 * Otherwise it sits under "Blocked by internal setup" with the specific task
 * and owner named.
 */
function getSendQueue(token) {
  checkToken_(token);
  return buildQueue_();
}

function buildQueue_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cSh = ss.getSheetByName(TABS.CLIENTS);
  const out = { ready: [], gated: [], waiting: [], blocked: [] };
  if (!cSh || cSh.getLastRow() < 2) return out;

  const today = midnight_(new Date());
  const clients = cSh.getRange(2, 1, cSh.getLastRow() - 1, C.WIDTH).getValues();

  clients.forEach(r => {
    const id = r[C.ID - 1];
    if (!id) return;
    const stage = r[C.STATUS - 1];
    if (stage === 'Churned' || stage === 'Paused') return;

    const st = getPhaseState_(id);
    if (st.complete) return;

    const base = {
      clientId: id, company: r[C.COMPANY - 1], contact: r[C.CONTACT - 1],
      owner: r[C.OWNER - 1], phase: st.current
    };

    const cur = st.phases.find(p => p.phase === st.current);
    if (!cur) return;
    base.phaseName = cur.name;

    const tasks = getClientTasks_(id);
    const waitingTasks = tasks.filter(t =>
      t.method !== 'INTERNAL' && t.status === 'Requested');

    // Phase has a client email — is it sendable?
    if (cur.email) {
      const unsent = tasks.filter(t => t.phase === cur.phase
        && t.method !== 'INTERNAL'
        && t.status !== 'Complete' && t.status !== 'N/A' && t.status !== 'Requested');

      if (unsent.length) {
        const gate = phaseSendCheck_(id, cur.phase);
        if (!gate.ok) {
          out.gated.push({ ...base, count: unsent.length, reasons: gate.reasons });
          return;
        }
        const pre = preflight_(id, null);
        if (!pre.ok) {
          out.blocked.push({ ...base, count: unsent.length, problems: pre.problems });
          return;
        }
        out.ready.push({ ...base, count: unsent.length });
        return;
      }
    }

    if (waitingTasks.length) {
      let oldest = null;
      waitingTasks.forEach(t => {
        const d = parseDate_(t.requested);
        if (d && (!oldest || d < oldest)) oldest = d;
      });
      out.waiting.push({
        ...base, count: waitingTasks.length,
        days: oldest ? Math.round((today - midnight_(oldest)) / 86400000) : 0
      });
      return;
    }

    // No client email due — surface whose internal work is holding the phase
    if (cur.openGates.length) {
      out.gated.push({
        ...base, count: cur.openGates.length, internal: true,
        reasons: cur.openGates.map(g => g.task + (g.owner ? ' (' + g.owner + ')' : ''))
      });
    }
  });

  out.ready.sort((a, b) => b.count - a.count);
  out.waiting.sort((a, b) => b.days - a.days);
  return out;
}

// ---------------------------------------------------------------- MENU

function sendAccessEmailForActiveRow() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const ui = SpreadsheetApp.getUi();
  if (sh.getName() !== TABS.CLIENTS) {
    ui.alert('Select a row on the Clients tab first.');
    return;
  }
  const row = sh.getActiveRange().getRow();
  if (row < 2) return;
  const clientId = sh.getRange(row, C.ID).getValue();
  if (!clientId) return;

  const st = getPhaseState_(clientId);
  const built = buildPhaseEmail_(clientId, st.current);

  if (!built.ok) {
    ui.alert('Not sent:\n\n' + (built.reasons || built.problems || []).join('\n'));
    return;
  }

  const res = ui.alert('Send this?',
    'To: ' + built.to + '\nSubject: ' + built.subject + '\n\n'
    + built.body.slice(0, 1200) + (built.body.length > 1200 ? '\n\n…' : ''),
    ui.ButtonSet.OK_CANCEL);
  if (res !== ui.Button.OK) return;

  const r = dashSend(issueToken_(), clientId, st.current);
  ui.alert(r.ok ? 'Sent to ' + r.to + '.' : 'Not sent:\n\n'
    + (r.reasons || r.problems || []).join('\n'));
}

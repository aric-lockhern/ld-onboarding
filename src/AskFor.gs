/**
 * LOCKHERN ONBOARDING CRM — Asking somebody for a document you do not have
 *
 * The first row of the intake screen is the sales call transcript, and the
 * person doing the intake is almost never the person who ran that call. So the
 * row that matters most is the one they cannot fill in, and what happens next
 * is a Slack message typed from memory — or, more often, nothing, and the
 * client gets onboarded off the contract alone by somebody who never heard the
 * conversation that sold it.
 *
 * This is the ask, sent from the row that needs it. It names the document, it
 * names the client, and it says what it is for, because "can you send me the
 * discovery call" with no context arrives in a DM at 4pm and is read as
 * admin rather than as something blocking a new account.
 *
 * WHY IT IS NOT A TASK. There is a checklist in this tool and a to-do in
 * ClickUp and both are the wrong shape for this: the thing needed is one link,
 * from one person, usually within the hour, and a task costs more to file and
 * to close than the ask is worth. It is a message because that is what somebody
 * would have sent anyway.
 *
 * WHO IT GOES TO is remembered. The discovery calls are run by the same
 * one or two people every time, and picking from a list of eleven on every
 * intake is the friction that turns this back into "I'll ask them later".
 */

/** Where the last-picked recipient is remembered, per document kind. */
const ASK_CFG = 'Document Request Owners';

/**
 * The documents it makes sense to ask somebody else for.
 *
 * Both are recordings of a call held by whoever ran it. Everything else on the
 * intake screen is a file the person doing the intake either has or does not,
 * and a request button on the scope of work would be a button that asks a
 * colleague to go and find something in the same Drive folder you are in.
 */
const ASKABLE = {
  sales: {
    what: 'the recording or transcript of the discovery call',
    why: 'It is the first document on the onboarding and the only record of '
       + 'what was actually promised on the call that won the deal.'
  },
  auditcall: {
    what: 'the recording or transcript of the audit presentation',
    why: 'The deck holds the findings; the call holds what was said about '
       + 'them and what got agreed in the room.'
  }
};

// ---------------------------------------------------------------- READ

/**
 * Who can be asked, and who was asked last time.
 *
 * Only people on the Team tab, for the reason everything else here resolves
 * through it: an email needs an address and a Slack DM needs a member ID, and
 * a name typed into a box has neither. Somebody with neither is still listed,
 * marked, rather than silently dropped — "why is Justin not in this list" is a
 * question with an answer, and it is usually a missing row on the Team page.
 *
 * Callable from App.html.
 */
function getAskTargets(kind) {
  const k = String(kind || 'sales');
  const spec = ASKABLE[k];
  if (!spec) return { ok: false, message: 'That document cannot be requested.' };

  // getTeam() already drops inactive rows — somebody who left should not be
  // in a list of people to chase a document from.
  const people = getTeam().map(t => ({
    name: t.name,
    email: String(t.email || '').trim(),
    slackId: String(t.slackId || '').trim(),
    role: t.role || ''
  }));

  return {
    ok: true,
    kind: k,
    what: spec.what,
    people: people,
    // Remembered per kind: the person who runs discovery calls and the person
    // who presents audits are often not the same person.
    last: askOwner_(k),
    slack: hasSlackToken(),
    teamEmpty: !people.length
  };
}

function askOwner_(kind) {
  try {
    const map = JSON.parse(cfg(ASK_CFG) || '{}') || {};
    return String(map[String(kind)] || '');
  } catch (e) {
    return '';
  }
}

function rememberAskOwner_(kind, name) {
  try {
    const map = JSON.parse(cfg(ASK_CFG) || '{}') || {};
    map[String(kind)] = String(name || '');
    setConfig_(ASK_CFG, JSON.stringify(map));
  } catch (e) {
    // A remembered choice is a convenience. Failing to store it must not fail
    // a message that has already been sent.
  }
}

// ---------------------------------------------------------------- SEND

/**
 * Sends the request, by Slack or by email.
 *
 * Returns what actually happened rather than ok:true. "Sent to Justin on
 * Slack" and "Sent to justin@… by email" are different facts, and somebody
 * who thinks they sent a Slack message that went to an inbox will wait for a
 * reply in the wrong place.
 *
 * Callable from App.html.
 *
 * @param {Object} payload { kind, who, how: 'slack'|'email', company, note }
 */
function askForSource(token, payload) {
  checkToken_(token);
  payload = payload || {};

  const kind = String(payload.kind || 'sales');
  const spec = ASKABLE[kind];
  if (!spec) return { ok: false, message: 'That document cannot be requested.' };

  const who = String(payload.who || '').trim();
  if (!who) return { ok: false, message: 'Nobody picked.' };

  const person = getTeam().filter(t =>
    t.name.toLowerCase() === who.toLowerCase())[0];
  if (!person) {
    return { ok: false, message: who + ' is not on the Team tab, so there is '
      + 'no address or Slack ID to send to. Add them on the Team page.' };
  }

  // Blank at intake is normal and not an error: a draft is often named before
  // anybody has typed the company. The message says so rather than carrying an
  // empty space where a client name should be.
  const company = String(payload.company || '').trim();
  const note = String(payload.note || '').trim();
  const how = String(payload.how || '').toLowerCase() === 'email'
    ? 'email' : 'slack';

  const out = how === 'email'
    ? askByEmail_(person, spec, company, note)
    : askBySlack_(person, spec, company, note);

  if (out.ok) rememberAskOwner_(kind, person.name);
  return out;
}

function askBySlack_(person, spec, company, note) {
  if (!person.slackId) {
    return { ok: false, message: person.name + ' has no Slack member ID on the '
      + 'Team tab, so there is nowhere to send it. Sync the IDs on the Team '
      + 'page, or send this by email instead.' };
  }

  // conversations.open first. Posting straight to a user id works most of the
  // time and fails with channel_not_found when no DM has ever been opened,
  // which is exactly the case of messaging somebody for the first time.
  const im = slackCall_('conversations.open', { users: person.slackId });
  if (!im.ok || !im.channel || !im.channel.id) {
    return { ok: false, message: slackError_(im, 'open a DM with ' + person.name) };
  }

  const r = slackCall_('chat.postMessage', {
    channel: im.channel.id,
    text: askLines_(spec, company, note).join('\n')
  });
  if (!r.ok) return { ok: false, message: slackError_(r, 'send the message') };

  return { ok: true, how: 'slack', who: person.name,
           message: 'Asked ' + person.name + ' on Slack.' };
}

function askByEmail_(person, spec, company, note) {
  if (!person.email) {
    return { ok: false, message: person.name + ' has no email on the Team tab. '
      + 'Add one on the Team page, or send this on Slack instead.' };
  }

  const subject = company
    ? 'Onboarding ' + company + ' — need ' + spec.what
    : 'Onboarding — need ' + spec.what;

  try {
    MailApp.sendEmail(person.email, subject,
                      askLines_(spec, company, note).join('\n'));
  } catch (e) {
    return { ok: false, message: 'Could not send it: '
      + ((e && e.message) || String(e)) };
  }

  return { ok: true, how: 'email', who: person.name, to: person.email,
           message: 'Emailed ' + person.name + ' at ' + person.email + '.' };
}

/**
 * The message itself, built once for both channels.
 *
 * One place, for the reason taskLines_ is one place: two copies drift, and
 * then the same request reads differently depending on which button was
 * pressed. Plain text, because it is going to an inbox as well as to Slack and
 * Slack's bold markers are literal asterisks in an email.
 *
 * It asks for a link rather than a file. The recording lives in a notetaker
 * somebody already has open; attaching it is a download and an upload, and the
 * answer that takes thirty seconds is the one that comes back.
 */
function askLines_(spec, company, note) {
  const lines = [];
  const name = company || 'a new client';

  lines.push('Onboarding ' + name + ' — could you send me ' + spec.what + '?');
  lines.push('');
  lines.push('A link is fine, I do not need the file.');
  lines.push('');
  lines.push(spec.why);

  if (note) {
    lines.push('');
    lines.push(note);
  }

  return lines;
}

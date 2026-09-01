/**
 * LOCKHERN ONBOARDING CRM — How we run a call
 *
 * Three things went wrong on one kickoff call with one new person, and all
 * three are optics rather than competence: they talked over the client, they
 * volunteered that they were new, and they took the call into the weeds until
 * it ran out of time with the actual agenda unfinished.
 *
 * None of that is a training problem you fix by hoping. It is a briefing
 * somebody reads in the two minutes before they join, which is exactly the
 * moment this tool already has their attention: the client page, with the
 * onboarding call status on it.
 *
 * WHY THE RULES ARE HOUSE RULES AND NOT PER CLIENT. `C.PROFILE` is how to work
 * with this particular client — their tone, what annoys them, who decides.
 * These are how Lockhern behaves on any call at all. Storing them per client
 * would mean the answer to "do we interrupt people" could differ by account,
 * which is not a thing that should be true.
 *
 * WHY THE AGENDA IS TIMED. "Keep to time" is not a value, it is minutes. An
 * agenda with a number beside each item is a thing you can be behind on with
 * ten minutes left; an agenda without one is a list you discover you have not
 * finished as the client leaves. The minutes scale to the length of the call
 * because a 30-minute kickoff is not a 60-minute one with less talking.
 *
 * EDITABLE, WITH THE SHIPPED COPY AS THE FLOOR. Same shape as the email
 * templates: the Config value wins if somebody has written one, and the
 * constants below are what a sheet that has never been edited gets. Seeds bail
 * on a populated tab (rule 3), so a rule written only into seed data could
 * never reach an installed sheet — which is why the fallback lives in code.
 */

/**
 * The three things that cost us on a call, and why each one costs.
 *
 * The reason is not decoration. "Do not talk over the client" read on its own
 * sounds like manners; read with what it costs, it is the thing somebody
 * actually remembers at minute fourteen when they have a point to make.
 */
const CALL_RULES = [
  {
    rule: 'Do not talk over the client.',
    why: 'Let them finish, even when you already know where the sentence is '
       + 'going. If two people start at once, stop and hand it back — "sorry, '
       + 'go ahead". On a call where we are being judged on how we listen, an '
       + 'interruption is the part they remember, not the point you made.'
  },
  {
    rule: 'Do not volunteer that you are new.',
    why: 'Not a secret and not a lie: if you are asked directly, answer '
       + 'honestly. But "I have only just started" offered unprompted tells a '
       + 'client their account has been handed to somebody still learning it, '
       + 'which is not what is happening and not ours to imply. Introducing a '
       + 'new person is a deliberate thing WE do, by whoever owns the '
       + 'relationship, at a moment we choose.'
  },
  {
    rule: 'Do not get into the weeds on a kickoff call.',
    why: 'A kickoff settles scope, access, timelines and who does what. Match '
       + 'types, bid strategy, feed attributes and negative lists are a '
       + 'working session with the people who own them — book it, do not hold '
       + 'it now. A kickoff that runs long on detail ends with the three '
       + 'things it existed for still unresolved.'
  }
];

/**
 * The default kickoff agenda, in proportions rather than minutes.
 *
 * Proportions, because the same call is booked for 30, 45 or 60 minutes and
 * the shape should not change with the length — introductions do not become
 * four times as long in an hour. `share` is a weight; the minutes are worked
 * out against whatever length the call actually is.
 */
const CALL_AGENDA = [
  { item: 'Introductions',
    share: 1,
    note: 'Names and what each person owns. Whoever leads introduces the team '
        + '— nobody introduces themselves as new.' },
  { item: 'What we understand you bought',
    share: 2,
    note: 'Restate the scope back to them and get it confirmed out loud. This '
        + 'is where a misread contract surfaces, and it is cheap here.' },
  { item: 'What we need from you, and by when',
    share: 3,
    note: 'The access list, dated. Name the person on their side for each one '
        + '— an unowned request is one nobody sends.' },
  { item: 'How we will work together',
    share: 2,
    note: 'Reporting cadence, the channel, who to contact for what, and when '
        + 'the first work lands.' },
  { item: 'Their questions',
    share: 2,
    note: 'Leave real room. If a question needs the weeds, book the session '
        + 'rather than holding it here.' },
  { item: 'Next steps, said out loud',
    share: 1,
    note: 'Who does what by when. End on this even if you are behind — it is '
        + 'the only part of the call that survives the call.' }
];

// ---------------------------------------------------------------- READ

/**
 * The brief for one call: the rules, the agenda in real minutes, and who is on
 * it. Read-only; nothing here writes.
 */
function getCallBrief(clientId, minutes) {
  const length = callLength_(minutes);
  const client = clientId ? getClientRecord_(clientId) : null;

  return {
    ok: true,
    minutes: length,
    lengths: [30, 45, 60],
    rules: storedRules_(),
    agenda: timedAgenda_(storedAgenda_(), length),
    company: client ? client.company : '',
    // Who the client will see. Rule two is about how a new person is
    // introduced, so the list of who is on the call belongs beside it.
    team: client ? briefTeam_(client) : [],
    // The one line of client-specific steer worth carrying here. The full
    // profile is on the page already; repeating it would be a second copy
    // that can disagree with the first.
    lead: client ? profileLead_(client.profile) : ''
  };
}

/** 30, 45 or 60. Anything else is somebody's typo, not a call length. */
function callLength_(minutes) {
  const n = Number(minutes);
  return (n === 30 || n === 45 || n === 60) ? n : 30;
}

/**
 * Turns the agenda's weights into minutes that add up to the call.
 *
 * The rounding is absorbed by the largest item rather than spread, so the
 * numbers on screen sum to the length of the call. An agenda that adds up to
 * 31 minutes is one nobody trusts to keep them to 30.
 */
function timedAgenda_(items, length) {
  const total = items.reduce((n, i) => n + (Number(i.share) || 1), 0);
  if (!total) return [];

  const out = items.map(i => ({
    item: i.item,
    note: i.note || '',
    mins: Math.max(1, Math.round((length * (Number(i.share) || 1)) / total))
  }));

  const drift = length - out.reduce((n, i) => n + i.mins, 0);
  if (drift) {
    let big = 0;
    out.forEach((i, idx) => { if (i.mins > out[big].mins) big = idx; });
    out[big].mins = Math.max(1, out[big].mins + drift);
  }

  // A running clock, so being behind is visible during the call rather than
  // at the end of it.
  let at = 0;
  out.forEach(i => { i.from = at; at += i.mins; i.to = at; });
  return out;
}

/** The rules as edited, falling back to the shipped set. */
function storedRules_() {
  const raw = cfg('Call Rules');
  if (!raw) return CALL_RULES.map(r => ({ rule: r.rule, why: r.why,
                                          source: 'shipped' }));
  const parsed = parseRules_(raw);
  return parsed.length
    ? parsed
    : CALL_RULES.map(r => ({ rule: r.rule, why: r.why, source: 'shipped' }));
}

/**
 * One rule per line, an optional reason after a pipe.
 *
 * A line format rather than JSON because the Config tab is read and edited by
 * people in a spreadsheet, and a cell holding JSON is one nobody will correct
 * a typo in.
 */
function parseRules_(raw) {
  return String(raw || '').split('\n')
    .map(l => l.trim()).filter(Boolean)
    .map(l => {
      const bar = l.indexOf('|');
      return bar === -1
        ? { rule: l, why: '', source: 'edited' }
        : { rule: l.slice(0, bar).trim(), why: l.slice(bar + 1).trim(),
            source: 'edited' };
    })
    .filter(r => r.rule);
}

/** The agenda as edited, falling back to the shipped one. */
function storedAgenda_() {
  const raw = cfg('Call Agenda');
  if (!raw) return CALL_AGENDA;

  const rows = String(raw).split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => {
      // "Item | weight | note", where the weight is optional.
      const bits = l.split('|').map(x => x.trim());
      const share = Number(bits[1]);
      return { item: bits[0], share: isNaN(share) ? 1 : share,
               note: bits[2] || '' };
    })
    .filter(r => r.item);
  return rows.length ? rows : CALL_AGENDA;
}

/**
 * Who is on the account, for the introductions line.
 *
 * Read through readClientTeam_ rather than off the record, because the account
 * team is JSON in C.TEAM and getClientRecord_ does not decode it — parsing it
 * a second time here is the kind of duplicate that drifts.
 *
 * The owner is first and marked, because somebody has to do the introducing
 * and "whoever speaks first" is how a new person ends up introducing
 * themselves.
 */
function briefTeam_(client) {
  const owner = String(client.owner || '').trim();
  let named = [];
  try {
    named = readClientTeam_(client.clientId) || [];
  } catch (e) {
    named = [];
  }
  if (owner && named.indexOf(owner) === -1) named = [owner].concat(named);

  const known = {};
  getTeam().forEach(t => { known[String(t.name).toLowerCase()] = t; });

  return named.map(n => {
    const hit = known[String(n).toLowerCase()];
    return { name: n, role: (hit && hit.role) || '',
             lead: !!owner && n === owner,
             // Named on the client but not on the Team tab. Worth saying on a
             // briefing screen: it is usually somebody who left.
             unknown: !hit };
  });
}

/**
 * The opening line of the client profile, which is the one paragraph worth
 * having in front of you on a call.
 *
 * Never the whole profile: it is ten thousand characters, and a briefing
 * nobody can read in two minutes is one nobody reads at all.
 */
function profileLead_(profile) {
  const text = String(profile || '').trim();
  if (!text) return '';
  const first = text.split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p && p.charAt(0) !== '#')[0] || '';
  return first.length > 700 ? first.slice(0, 700).trim() + '…' : first;
}

// ---------------------------------------------------------------- SETTINGS

/** The rules and agenda as text, for the Settings editor. */
function getCallRules(token) {
  checkToken_(token);
  const rules = cfg('Call Rules');
  const agenda = cfg('Call Agenda');
  return {
    ok: true,
    rules: rules || CALL_RULES.map(r => r.rule + ' | ' + r.why).join('\n'),
    agenda: agenda
      || CALL_AGENDA.map(a => a.item + ' | ' + a.share + ' | ' + a.note)
           .join('\n'),
    // Which of the two the screen is showing, so "I edited this and it did not
    // change" has an answer on the page rather than in somebody's head.
    rulesSource: rules ? 'edited' : 'shipped',
    agendaSource: agenda ? 'edited' : 'shipped',
    shippedRules: CALL_RULES.map(r => r.rule + ' | ' + r.why).join('\n'),
    shippedAgenda: CALL_AGENDA.map(a => a.item + ' | ' + a.share + ' | ' + a.note)
      .join('\n')
  };
}

function saveCallRules(token, rules, agenda) {
  checkToken_(token);

  // Blank means "go back to the shipped copy", not "we have no rules". An
  // empty rules list on a briefing screen reads as the feature being broken.
  setConfig_('Call Rules', String(rules == null ? '' : rules).trim());
  setConfig_('Call Agenda', String(agenda == null ? '' : agenda).trim());
  return { ok: true };
}

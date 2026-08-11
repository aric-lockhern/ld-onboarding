/**
 * LOCKHERN ONBOARDING CRM — Slack
 *
 * Creating the channel, putting the right people in it, and chasing the
 * outstanding items without leaving the tool.
 *
 * The bot token lives in Script Properties as SLACK_BOT_TOKEN, set from the
 * sheet menu. It never goes in a cell and never in the repo.
 *
 * SCOPES ARE NOT HARDCODED HERE. Slack's own error response names the scope it
 * wanted (`needed`) and what the token has (`provided`), which is more reliable
 * than a list in a comment that goes stale — and far more useful than
 * "invalid_auth" when someone is staring at the scope picker. slackError_
 * surfaces it verbatim.
 */

const SLACK_API = 'https://slack.com/api/';

// ---------------------------------------------------------------- TOKEN

function promptForSlackToken() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Slack bot token',
    'api.slack.com/apps → your app → OAuth & Permissions → Bot User OAuth Token. '
    + 'Starts xoxb-. Stored in Script Properties, not in the sheet.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  const t = res.getResponseText().trim();
  if (!t) return;
  if (t.indexOf('xoxb-') !== 0) {
    ui.alert('That does not look like a bot token. A bot token starts with '
      + '"xoxb-". A user token (xoxp-) or a signing secret will not work here.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('SLACK_BOT_TOKEN', t);
  ui.alert('Slack token saved. Use "Test Slack connection" to check the scopes.');
}

function hasSlackToken() {
  return !!PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
}

/**
 * Confirms the token works and reports which scopes it actually carries.
 *
 * Slack returns the granted scopes in a response header, which is the only way
 * to see them without opening the app config — and the difference between "I
 * ticked it" and "it is installed" is where this kind of setup usually stalls.
 */
function slackTest() {
  const token = slackToken_();
  if (!token) return { ok: false, message: 'No Slack token set. In the sheet: '
    + 'Onboarding → Set Slack bot token.' };

  const res = UrlFetchApp.fetch(SLACK_API + 'auth.test', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });

  let body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) { /* below */ }

  if (!body.ok) {
    return { ok: false, message: slackError_(body, 'check the token') };
  }

  const headers = res.getAllHeaders() || {};
  const granted = String(headers['x-oauth-scopes'] || headers['X-OAuth-Scopes'] || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const wanted = ['channels:manage', 'groups:write', 'users:read',
                  'users:read.email', 'chat:write'];
  const missing = granted.length ? wanted.filter(s => granted.indexOf(s) === -1) : [];

  return {
    ok: true,
    team: body.team || '',
    botUser: body.user || '',
    granted: granted,
    missing: missing,
    // An empty header is not the same as no scopes; say so rather than
    // reporting everything as missing.
    scopesUnknown: !granted.length
  };
}

// ---------------------------------------------------------------- CHANNELS

/**
 * Creates the client's channel and invites the people chosen for it.
 *
 * Private by default. A client channel usually carries spend, fees and account
 * credentials-adjacent chatter, and a public channel in a workspace with
 * contractors in it is a decision nobody consciously made.
 *
 * @param {string} clientId
 * @param {Object} opts { name, isPrivate, memberIds: [slack user ids] }
 */
function slackCreateChannel(token, clientId, opts) {
  checkToken_(token);
  opts = opts || {};

  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };

  const name = slackChannelName_(opts.name || client.company);
  if (!name) return { ok: false, message: 'Could not build a channel name.' };

  const created = slackCall_('conversations.create', {
    name: name,
    is_private: opts.isPrivate === false ? false : true
  });
  if (!created.ok) {
    return { ok: false, message: created.error === 'name_taken'
      ? 'A channel called #' + name + ' already exists. Rename it, or set the '
        + 'Slack channel field on this client by hand.'
      : slackError_(created, 'create the channel') };
  }

  const channelId = created.channel && created.channel.id;
  const invited = [];
  const failed = [];

  const ids = (opts.memberIds || []).filter(Boolean);
  if (ids.length) {
    // One call for everyone: Slack takes a comma list, and inviting one at a
    // time turns a partial failure into an unknown number of successes.
    const inv = slackCall_('conversations.invite', {
      channel: channelId, users: ids.join(',')
    });
    if (inv.ok) {
      ids.forEach(i => invited.push(i));
    } else {
      // already_in_channel and cannot_invite_self are not failures worth
      // reporting — the person is in the channel either way.
      if (inv.error === 'already_in_channel') ids.forEach(i => invited.push(i));
      else failed.push(slackError_(inv, 'invite people'));
    }
  }

  try {
    slackCall_('conversations.setPurpose', {
      channel: channelId,
      purpose: client.company + ' — onboarding and day to day. '
             + (client.services || '')
    });
  } catch (e) { /* a channel without a purpose still works */ }

  const url = 'https://slack.com/app_redirect?channel=' + channelId;
  setClientField_(clientId, C.SLACK, '#' + name);

  return { ok: true, name: '#' + name, channelId: channelId, url: url,
           invited: invited.length, failed: failed };
}

/**
 * Everyone on the Team tab, matched to a Slack account.
 *
 * A row with a Slack ID already filled in is taken at face value. Everything
 * else is looked up by email, which is what users:read.email is for — without
 * that scope this returns the row unmatched rather than failing, so the picker
 * still works for anyone whose ID was pasted in by hand.
 */
function slackPeople() {
  const team = getTeam();
  if (!team.length) return { ok: true, people: [], teamEmpty: true };

  const row = (t, extra) => Object.assign({
    name: t.name, email: t.email, slackId: t.slackId,
    role: t.role, skills: t.skills || [], matched: false
  }, extra);

  // With no token there is nothing to look anyone up against. Say that once,
  // rather than returning every person "unmatched — no_token" and letting the
  // reader work out that the problem is the same one nine times.
  if (!slackToken_()) {
    return { ok: true, noToken: true,
             people: team.map(t => row(t, { matched: !!t.slackId,
                                            why: 'no Slack token set' })) };
  }

  let scopeProblem = '';
  const people = team.map(t => {
    if (t.slackId) return row(t, { matched: true });
    if (!t.email) return row(t, { why: 'no email on the Team tab' });

    const r = slackCall_('users.lookupByEmail', { email: t.email });
    if (r.ok && r.user) return row(t, { slackId: r.user.id, matched: true, lookedUp: true });

    if (r.error === 'missing_scope') scopeProblem = slackError_(r, 'look people up by email');
    return row(t, {
      why: r.error === 'users_not_found' ? 'no Slack account with that email'
         : (r.error || 'lookup failed')
    });
  });

  return { ok: true, people: people, scopeProblem: scopeProblem };
}

/**
 * Adds people to a client's existing channel.
 *
 * Separate from slackCreateChannel because the common case is a channel that
 * already exists — someone joins the account three months in — and re-running
 * creation for that would fail on name_taken and read like a bug.
 */
function slackInvite(token, clientId, memberIds) {
  checkToken_(token);

  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };

  const channel = String(client.slack || '').replace(/^#/, '');
  if (!channel) return { ok: false, message: 'No Slack channel on this client yet.' };

  const ids = (memberIds || []).filter(Boolean);
  if (!ids.length) return { ok: false, message: 'Nobody selected.' };

  const r = slackCall_('conversations.invite', {
    channel: channel.indexOf('C') === 0 ? channel : '#' + channel,
    users: ids.join(',')
  });
  // Everyone already being in the channel is the desired end state, not a
  // failure — reporting it as one teaches people to ignore the message.
  if (!r.ok && r.error !== 'already_in_channel') {
    return { ok: false, message: slackError_(r, 'invite people') };
  }
  return { ok: true, invited: ids.length, channel: '#' + channel,
           already: r.error === 'already_in_channel' };
}

// ---------------------------------------------------------------- PINGS

/**
 * Posts the outstanding onboarding items to the client's channel, grouped by
 * who owns them.
 *
 * In the channel with @mentions rather than as DMs: a chase-up the rest of the
 * team can see is the point, and it needs no further scope. Nothing is sent
 * when there is nothing outstanding — a nudge that says "all clear" trains
 * people to ignore the next one.
 */
function slackPingOutstanding(token, clientId, channelOverride) {
  checkToken_(token);

  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };

  const channel = channelOverride || String(client.slack || '').replace(/^#/, '');
  if (!channel) {
    return { ok: false, message: 'No Slack channel on this client. Create one '
      + 'first, or set the Slack channel field.' };
  }

  const open = getClientTasks_(clientId).filter(t =>
    t.status !== 'Complete' && t.status !== 'N/A');
  if (!open.length) {
    return { ok: false, nothing: true,
             message: 'Nothing outstanding — no message sent.' };
  }

  const byOwner = {};
  open.forEach(t => {
    const who = t.owner || 'Unassigned';
    (byOwner[who] = byOwner[who] || []).push(t);
  });

  const team = {};
  getTeam().forEach(t => { if (t.slackId) team[t.name] = t.slackId; });

  const lines = ['*' + client.company + ' — outstanding onboarding items*'];
  Object.keys(byOwner).forEach(who => {
    const tag = team[who] ? '<@' + team[who] + '>' : who;
    lines.push('', tag + ' — ' + byOwner[who].length + ':');
    byOwner[who].forEach(t => {
      lines.push('• ' + t.task + ' _(' + t.status
        + (t.overdueBy > 0 ? ', ' + t.overdueBy + ' days overdue' : '')
        + ')_');
    });
  });

  const r = slackCall_('chat.postMessage', {
    channel: channel.indexOf('C') === 0 ? channel : '#' + channel,
    text: lines.join('\n')
  });
  if (!r.ok) return { ok: false, message: slackError_(r, 'post the message') };

  return { ok: true, posted: open.length, channel: '#' + channel };
}

// ---------------------------------------------------------------- INTERNALS

function slackToken_() {
  return PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN') || '';
}

function slackCall_(method, payload) {
  const token = slackToken_();
  if (!token) return { ok: false, error: 'no_token' };

  const res = UrlFetchApp.fetch(SLACK_API + method, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded; charset=utf-8',
    headers: { Authorization: 'Bearer ' + token },
    payload: payload || {},
    muteHttpExceptions: true
  });
  try {
    return JSON.parse(res.getContentText());
  } catch (e) {
    return { ok: false, error: 'bad_response' };
  }
}

/**
 * Slack's error, in words.
 *
 * missing_scope is the one worth translating carefully: the response names the
 * scope it wanted, and reading that back is faster than anyone guessing from
 * the scope picker. Reinstalling matters too — ticking a scope does nothing
 * until the app is reinstalled to the workspace, which is where this usually
 * goes wrong.
 */
function slackError_(body, what) {
  const err = (body && body.error) || 'unknown';
  if (err === 'no_token') {
    return 'No Slack token set. In the sheet: Onboarding → Set Slack bot token.';
  }
  if (err === 'missing_scope') {
    return 'The Slack app cannot ' + what + ': it needs the "'
      + (body.needed || 'required') + '" scope and has "'
      + (body.provided || 'none') + '". Add it under OAuth & Permissions, then '
      + 'REINSTALL the app to the workspace — ticking a scope does nothing until '
      + 'you reinstall.';
  }
  if (err === 'invalid_auth' || err === 'not_authed' || err === 'token_revoked') {
    return 'Slack rejected the token (' + err + '). Re-copy the Bot User OAuth '
      + 'Token and set it again.';
  }
  if (err === 'not_in_channel') {
    return 'The bot is not in that channel. Invite it there, or let the tool '
      + 'create the channel so it is a member from the start.';
  }
  return 'Slack could not ' + what + ': ' + err;
}

/**
 * Slack channel names: lowercase, no spaces, 80 chars, and a limited character
 * set. Handing Slack an invalid name returns invalid_name_specials, which reads
 * like a bug rather than "your client has an ampersand in their name".
 */
function slackChannelName_(company) {
  return String(company || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

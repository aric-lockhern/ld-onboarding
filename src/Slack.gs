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

  // channels:join is what lets the bot add itself to a public channel rather
  // than failing every post with not_in_channel. There is no private equivalent
  // — Slack requires a human to invite it — so nothing here covers that.
  // bookmarks:write puts the link back to the client in the channel's tab bar.
  // bookmarks:read is what stops a second one appearing beside the first every
  // time the channel is relinked — without it the link still gets added, it
  // just cannot be checked for first.
  const wanted = ['channels:manage', 'channels:join', 'groups:write',
                  'channels:read', 'groups:read', 'users:read',
                  'users:read.email', 'chat:write',
                  'bookmarks:write', 'bookmarks:read'];
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

// ---------------------------------------------------------------- BOOKMARK

/**
 * The label on the channel's tab bar. Not the client's name — the channel is
 * already named after them, and "Harbor & Sons" sitting next to Messages and
 * Pins says nothing about what clicking it does.
 */
const SLACK_BOOKMARK_TITLE = 'Onboarding';
const SLACK_BOOKMARK_EMOJI = 'clipboard';

/**
 * Puts a link to the client's page in the channel's tab bar.
 *
 * Slack calls these bookmarks; they sit beside Messages, Files and Pins at the
 * top of a channel. It is the right home for this because it is the one place
 * in Slack that is per-channel and permanent — a pinned message scrolls out of
 * relevance and a link in the purpose is three clicks deep.
 *
 * The direction that matters is Slack → tool. The tool already links out to
 * the channel from the client page, and every nudge carries a link back; what
 * was missing is the way in from the conversation, which is where people
 * actually are when they think "what is outstanding on this account".
 *
 * NEVER THROWS, AND NEVER FAILS THE LINKING. Connecting the channel is the act
 * somebody asked for; the bookmark is a convenience on top of it. A workspace
 * that has not granted bookmarks:write must still be able to link a channel,
 * and be told why the tab did not appear rather than told the link failed.
 */
function slackBookmarkClient_(client, channelId) {
  const url = clientUrl_(client);
  if (!url) {
    return { ok: false, reason: 'noUrl',
             message: 'No web app URL, so there is nowhere for the Slack link '
               + 'to point. Deploy the web app, or set Config "App URL".' };
  }
  if (!channelId) return { ok: false, reason: 'noChannel' };

  // Look before adding, or relinking a channel leaves two identical tabs and
  // no clue which is current. A failure here is not fatal — see below.
  let existing = null;
  let couldNotCheck = false;
  try {
    const list = slackCall_('bookmarks.list', { channel_id: channelId });
    if (list.ok) {
      existing = (list.bookmarks || []).filter(b =>
        b && b.title === SLACK_BOOKMARK_TITLE)[0] || null;
    } else {
      couldNotCheck = true;
    }
  } catch (e) {
    couldNotCheck = true;
  }

  // The URL carries the client ID, so a bookmark pointing at the wrong client
  // — a channel relinked to a different account — is corrected rather than
  // duplicated.
  if (existing && existing.link === url) {
    return { ok: true, already: true, url: url };
  }

  try {
    const res = existing
      ? slackCall_('bookmarks.edit', {
          channel_id: channelId, bookmark_id: existing.id, link: url,
          title: SLACK_BOOKMARK_TITLE })
      : slackCall_('bookmarks.add', {
          channel_id: channelId, title: SLACK_BOOKMARK_TITLE, type: 'link',
          link: url, emoji: ':' + SLACK_BOOKMARK_EMOJI + ':' });

    if (!res.ok) {
      return { ok: false, reason: 'slack', url: url,
               message: slackError_(res, 'add the link to the channel') };
    }
    return { ok: true, url: url, updated: !!existing,
             couldNotCheck: couldNotCheck };
  } catch (e) {
    return { ok: false, reason: 'threw', url: url,
             message: (e && e.message) || String(e) };
  }
}

/**
 * Adds the link by hand, for a channel connected before this existed.
 *
 * Every client already linked has a channel with no tab on it, and the only
 * way to get one otherwise would be to unlink and relink — which is a
 * destructive-looking action to ask somebody to perform for a cosmetic reason.
 */
function slackAddBookmark(token, clientId) {
  checkToken_(token);

  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };
  if (!client.slack) {
    return { ok: false, message: 'No Slack channel on this client yet.' };
  }

  // findChannel_ takes the name with or without the hash and reports its own
  // reason for failing, which is usually "it is private and I am not in it".
  const found = findChannel_(String(client.slack).replace(/^#/, ''));
  if (!found.ok) return { ok: false, message: found.message };

  const res = slackBookmarkClient_(client, found.channel.id);
  if (!res.ok) return { ok: false, message: res.message || 'Could not add it.' };
  return { ok: true, already: !!res.already, updated: !!res.updated,
           url: res.url, channel: client.slack,
           couldNotCheck: !!res.couldNotCheck };
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

  // The way back. Everything else here points out of the tool and into Slack;
  // this is the one link that goes the other way, and it belongs in the
  // channel's tab bar rather than in a message that scrolls away.
  const mark = slackBookmarkClient_(client, channelId);

  return { ok: true, name: '#' + name, channelId: channelId, url: url,
           invited: invited.length, failed: failed, bookmark: mark };
}

/**
 * The channels already in the workspace, so an existing one can be picked
 * rather than a second one created next to it.
 *
 * Most accounts that have been running a while already have a channel — it was
 * made the day the deal closed, months before anyone opened this tool. Creating
 * "#harbor-and-sons" alongside "#harbor-sons" splits the history in two and
 * nobody notices until someone asks where a thread went.
 *
 * A bot can only see private channels it has been invited to. That is Slack's
 * rule, not a scope that can fix it, so the count of what is hidden is returned
 * and the UI says so — "my private channel is not in the list" is exactly the
 * confusion this would otherwise cause.
 */
function slackChannels() {
  if (!slackToken_()) {
    return { ok: false, noToken: true, message: 'No Slack token set. In the '
      + 'sheet: Onboarding → Set Slack bot token.' };
  }

  const out = [];
  let cursor = '';
  for (let page = 0; page < 20; page++) {
    const r = slackCall_('conversations.list', Object.assign({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200
    }, cursor ? { cursor: cursor } : {}));
    if (!r.ok) return { ok: false, message: slackError_(r, 'list the channels') };

    (r.channels || []).forEach(c => out.push({
      id: c.id,
      name: c.name,
      isPrivate: !!c.is_private,
      // Whether the bot is in it decides whether posting will work at all, so
      // it travels with the row rather than being discovered on first ping.
      isMember: !!c.is_member,
      members: c.num_members || 0,
      purpose: String((c.purpose && c.purpose.value) || '')
    }));

    cursor = (r.response_metadata && r.response_metadata.next_cursor) || '';
    if (!cursor) break;
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, channels: out };
}

/**
 * Points a client at a channel that already exists.
 *
 * Joins it when it is public, because a bot that is not a member cannot post
 * and the ping would fail later with not_in_channel — long after the moment
 * anyone would connect the two. A private channel cannot be self-joined, so
 * that case is reported as something to do rather than silently linked and
 * left broken.
 */
function slackLinkChannel(token, clientId, channelId) {
  checkToken_(token);

  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };
  if (!channelId) return { ok: false, message: 'No channel picked.' };

  const info = slackCall_('conversations.info', { channel: channelId });
  if (!info.ok || !info.channel) {
    return { ok: false, message: slackError_(info, 'read that channel') };
  }

  const ch = info.channel;
  let joined = false;
  let warn = '';

  if (!ch.is_member) {
    if (ch.is_private) {
      warn = 'The bot is not in #' + ch.name + ' and cannot add itself to a '
        + 'private channel. Invite it there — /invite @your-bot — or pings will '
        + 'fail.';
    } else {
      const j = slackCall_('conversations.join', { channel: channelId });
      if (j.ok) joined = true;
      else warn = slackError_(j, 'join #' + ch.name);
    }
  }

  setClientField_(clientId, C.SLACK, '#' + ch.name);

  // Linking an existing channel is the commoner path — most accounts already
  // have one — so it is the one that most needs the tab.
  const mark = slackBookmarkClient_(client, ch.id);

  return { ok: true, name: '#' + ch.name, channelId: ch.id,
           url: 'https://slack.com/app_redirect?channel=' + ch.id,
           joined: joined, warn: warn, bookmark: mark };
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

/**
 * Everyone in the Slack workspace, so the team can be built from the roster
 * rather than typed out.
 *
 * users.list is the only call that gets names, emails and member IDs in one
 * pass. Looking people up one at a time by email is backwards for setup: it
 * requires already knowing every address, which is the thing being collected.
 *
 * Bots, apps, Slackbot and deactivated accounts are dropped. They are members
 * of the workspace and never members of the team, and leaving them in means
 * scrolling past a dozen integrations to find a colleague.
 *
 * Email needs users:read.email. Without it Slack returns the roster with the
 * email field simply absent — no error, no warning — so the absence is
 * detected and reported rather than presented as "nobody has an email".
 */
function slackRoster() {
  if (!slackToken_()) {
    return { ok: false, noToken: true, message: 'No Slack token set. In the '
      + 'sheet: Onboarding → Set Slack bot token.' };
  }

  const members = [];
  let cursor = '';
  // Paged rather than one big call: Slack caps the page, and a workspace with
  // 400 people would silently return the first 200 and look complete.
  for (let page = 0; page < 25; page++) {
    const r = slackCall_('users.list', cursor
      ? { limit: 200, cursor: cursor } : { limit: 200 });
    if (!r.ok) return { ok: false, message: slackError_(r, 'list the workspace') };

    (r.members || []).forEach(m => members.push(m));
    cursor = (r.response_metadata && r.response_metadata.next_cursor) || '';
    if (!cursor) break;
  }

  const onTeam = {};
  getTeam().forEach(t => {
    if (t.slackId) onTeam[t.slackId] = true;
    if (t.email) onTeam[t.email.toLowerCase()] = true;
  });

  const people = members
    .filter(m => m && !m.is_bot && !m.deleted && m.id !== 'USLACKBOT')
    .map(m => {
      const p = m.profile || {};
      const email = String(p.email || '').trim();
      return {
        slackId: m.id,
        // real_name is what people set; display_name is often blank and the
        // handle is not a name. Fall back down the chain rather than showing
        // an ID to somebody picking colleagues out of a list.
        name: String(p.real_name_normalized || p.real_name || m.real_name
                     || p.display_name || m.name || '').trim(),
        email: email,
        title: String(p.title || '').trim(),
        guest: !!(m.is_restricted || m.is_ultra_restricted),
        admin: !!(m.is_admin || m.is_owner),
        // Already on the Team tab by ID or by email — ticking them again
        // would create a second row answering to the same name.
        onTeam: !!(onTeam[m.id] || (email && onTeam[email.toLowerCase()]))
      };
    })
    .filter(p => p.name);

  people.sort((a, b) => a.name.localeCompare(b.name));

  const withEmail = people.filter(p => p.email).length;
  return {
    ok: true,
    people: people,
    // No email on anyone at all is the signature of the missing scope, not of
    // a workspace where nobody filled their profile in.
    emailScopeMissing: people.length > 0 && withEmail === 0
  };
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
/**
 * Makes sure the bot is in the channel before anything tries to post to it.
 *
 * A bot cannot post where it is not a member, and the failure arrives as
 * `not_in_channel` at the moment somebody presses send — which is both the
 * least useful time to learn it and a thing the tool can usually just fix. A
 * public channel can be self-joined; that happens here, silently, and the ping
 * goes out as if nothing was wrong.
 *
 * A private channel cannot be. Slack does not allow a bot to add itself to a
 * private conversation it was never invited to, and no scope changes that — so
 * that case comes back with the exact command to run, naming the bot.
 *
 * @param {string} channel a name, with or without the leading #, or a channel ID
 */
function ensureBotInChannel_(channel) {
  const raw = String(channel || '').replace(/^#/, '').trim();
  if (!raw) return { ok: false, message: 'No channel set on this client.' };

  const found = findChannel_(raw);
  if (!found.ok) return found;

  const ch = found.channel;
  if (ch.is_member) return { ok: true, channelId: ch.id, name: ch.name };

  if (ch.is_private) {
    return { ok: false, needsInvite: true, channelId: ch.id, name: ch.name,
             message: 'The bot is not in #' + ch.name + ', and Slack does not '
               + 'let a bot add itself to a private channel. In #' + ch.name
               + ', run:  /invite ' + botHandle_() };
  }

  const j = slackCall_('conversations.join', { channel: ch.id });
  if (!j.ok) {
    return { ok: false, channelId: ch.id, name: ch.name,
             message: slackError_(j, 'join #' + ch.name) };
  }
  return { ok: true, joined: true, channelId: ch.id, name: ch.name };
}

/**
 * A channel by name or ID.
 *
 * conversations.info takes an ID, and what is stored on the client is usually
 * a name, so a name has to be resolved against the list first. Private channels
 * the bot has never been invited to do not appear in that list at all — which
 * is Slack's rule, and is reported as such rather than as "no such channel".
 */
function findChannel_(raw) {
  if (/^[CG][A-Z0-9]{6,}$/.test(raw)) {
    const info = slackCall_('conversations.info', { channel: raw });
    if (!info.ok || !info.channel) {
      return { ok: false, message: slackError_(info, 'read that channel') };
    }
    return { ok: true, channel: info.channel };
  }

  const want = raw.toLowerCase();
  let cursor = '';
  for (let page = 0; page < 20; page++) {
    const r = slackCall_('conversations.list', Object.assign({
      types: 'public_channel,private_channel', exclude_archived: true, limit: 200
    }, cursor ? { cursor: cursor } : {}));
    if (!r.ok) return { ok: false, message: slackError_(r, 'find that channel') };

    const hit = (r.channels || []).find(c => String(c.name).toLowerCase() === want);
    if (hit) return { ok: true, channel: hit };

    cursor = (r.response_metadata && r.response_metadata.next_cursor) || '';
    if (!cursor) break;
  }

  return { ok: false, notFound: true,
           message: 'No channel called #' + raw + ' that this bot can see. If it '
             + 'is private, the bot has to be invited to it before it can be '
             + 'found at all — Slack does not list private channels to apps that '
             + 'are not in them.' };
}

/** The bot's own @handle, for telling someone exactly what to type. */
function botHandle_() {
  const r = slackCall_('auth.test', {});
  return (r && r.ok && r.user) ? '@' + r.user : '@your-bot';
}

/**
 * Adds the bot to a client's channel on demand, from the Slack card.
 *
 * The pings self-heal, so this exists for the case where somebody wants to fix
 * it deliberately rather than discover it mid-nudge — and to give the private
 * channel instruction a place to appear before anything fails.
 */
function slackJoinChannel(token, clientId) {
  checkToken_(token);

  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };
  if (!client.slack) {
    return { ok: false, message: 'No Slack channel on this client yet.' };
  }

  const r = ensureBotInChannel_(client.slack);
  if (!r.ok) return r;
  return { ok: true, joined: !!r.joined, name: '#' + r.name,
           message: r.joined ? 'Joined #' + r.name + '.'
                             : 'Already in #' + r.name + '.' };
}

/**
 * Posts a named set of tasks to the client's channel, grouped by who owns them.
 *
 * One function for both the single-task nudge and the whole-phase one: they
 * differ only in how many names go in, and splitting them would give two
 * message formats that drift apart. A one-task ping is a list of one.
 *
 * Tasks already Complete or N/A are dropped rather than posted as done — a
 * nudge that includes finished work reads as not having looked.
 *
 * @param {Array<string>} tasks task names, as they appear on the Access tab
 * @param {string} [about] what the set IS — a channel, a phase. See taskLines_:
 *   a ping of everything open on Reddit that never says "Reddit" is a list of
 *   tasks with the reason for grouping them thrown away.
 */
function slackPingTasks(token, clientId, tasks, about) {
  checkToken_(token);

  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };

  const channel = String(client.slack || '').replace(/^#/, '');
  if (!channel) {
    return { ok: false, message: 'No Slack channel on this client. Create one '
      + 'or link an existing one first.' };
  }

  const want = {};
  (tasks || []).forEach(t => { want[String(t).trim()] = true; });

  const open = getClientTasks_(clientId).filter(t =>
    want[t.task] && t.status !== 'Complete' && t.status !== 'N/A');

  if (!open.length) {
    return { ok: false, nothing: true,
             message: (tasks || []).length === 1
               ? 'That task is already done — nothing sent.'
               : 'Nothing outstanding there — nothing sent.' };
  }

  // Join before posting rather than reporting not_in_channel afterwards. For a
  // public channel this is invisible; for a private one it is the only moment
  // the instruction is any use, because the message has not been lost yet.
  const member = ensureBotInChannel_(channel);
  if (!member.ok) return member;

  const r = slackCall_('chat.postMessage', {
    channel: member.channelId,
    text: taskLines_(client, open, about).join('\n')
  });
  if (!r.ok) return { ok: false, message: slackError_(r, 'post the message') };

  return { ok: true, posted: open.length, channel: '#' + member.name,
           joined: !!member.joined,
           owners: Object.keys(byOwner_(open)).length };
}

function byOwner_(tasks) {
  const out = {};
  tasks.forEach(t => {
    const who = t.owner || 'Unassigned';
    (out[who] = out[who] || []).push(t);
  });
  return out;
}

/**
 * `&`, `<` and `>` have meaning in Slack message text.
 *
 * A company called "Smith & Sons" is harmless, but an unescaped `<` starts a
 * link and swallows everything to the next `>` — so a task or a client name
 * with an angle bracket in it silently eats the rest of the line.
 */
function slackEscape_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The web app, opened straight onto this client.
 *
 * The `App URL` config row is there so this can be the short Netlify address
 * rather than the 70-character /exec one; blank falls back to the deployment's
 * own URL, which is what an existing sheet has, because a seed row cannot
 * reach a Config tab that already has rows (rule 3). Blank BOTH ways means no
 * link, and the message simply does not carry one — better than a dead link.
 */
function clientUrl_(client) {
  const base = cfg('App URL') || getWebAppUrl();
  if (!base) return '';
  const id = String(client.clientId || '');
  if (!id) return base;
  return base + (base.indexOf('?') === -1 ? '?' : '&')
    + 'client=' + encodeURIComponent(id);
}

/** The client's name, bold. Never a link — see clientCta_. */
function clientName_(client) {
  return '*' + slackEscape_(client.company) + '*';
}

/**
 * The one link in the message, as the thing you would click rather than as the
 * client's name repeated.
 *
 * There is exactly one because the first draft had two — the name in the
 * greeting and the name again at the foot, both pointing at the same record.
 * In a four-line nudge that reads as clutter, and neither one looks like the
 * action. A single line that says what clicking it does is the call to action.
 *
 * Returns '' when there is nowhere to point, and the message then carries no
 * footer at all — better than "update it here" beside nothing.
 */
function clientCta_(client, count) {
  const url = clientUrl_(client);
  if (!url) return '';
  // A pipe or an angle bracket inside the label would end the link early.
  const label = (count === 1 ? 'Update it' : 'Update them')
    + ' on the onboarding board →';
  return '<' + url + '|' + label + '>';
}

/**
 * One task, as a sentence rather than a parenthesis.
 *
 * Overdue beats assigned-days when both are true. They are different facts —
 * one is about the deadline, the other about whether anybody has picked the
 * work up — but printing both makes a bullet that wraps on a phone, and the
 * deadline is the one that decides what happens today.
 */
function taskLine_(t) {
  const status = String(t.status || '').toLowerCase();
  let tail = '';
  if (t.overdueBy > 0) {
    tail = ' · ' + t.overdueBy + (t.overdueBy === 1 ? ' day overdue' : ' days overdue');
  } else if (t.assignedDays > 0) {
    tail = ' · assigned ' + t.assignedDays
      + (t.assignedDays === 1 ? ' day ago' : ' days ago');
  }
  return '• *' + slackEscape_(t.task) + '* — ' + status + tail;
}

/**
 * The message.
 *
 * ---------------------------------------------------------------------------
 * IT IS A NOTE FROM A COLLEAGUE, NOT A REPORT FILED BY A ROBOT.
 *
 * The old format opened with a bold title and a count — "Left Main REI —
 * outstanding onboarding items", then "@Cory — 1:". That is a machine
 * announcing a record, and it reads as one: the person's name arrives second,
 * the count duplicates the bullets underneath it, and there is nothing to
 * click, so acting on it means going and finding the client yourself.
 *
 * So the name and the ask come first, the count is dropped because the bullets
 * are the count, and the last line is a link that opens the client's record
 * directly. A nudge you cannot act on from where you read it is a nudge that
 * gets read and left.
 * ---------------------------------------------------------------------------
 *
 * @-mentions where a Slack ID is stored and the plain name where it is not, so
 * a directory that is only half matched still produces a readable nudge rather
 * than a wall of raw user IDs or nothing at all.
 */
function taskLines_(client, tasks, about) {
  const team = {};
  getTeam().forEach(t => { if (t.slackId) team[t.name] = t.slackId; });

  const groups = byOwner_(tasks);
  const owners = Object.keys(groups).sort((a, b) => {
    // Unassigned last. It is a different ask — nobody has picked these up —
    // and it reads badly standing above somebody's name.
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    return a.localeCompare(b);
  });

  const name = clientName_(client);
  const many = owners.length > 1;
  const lines = [];

  /*
   * What this set IS, when it is a set rather than everything.
   *
   * The channel and phase buttons send a filtered list — "everything still
   * open on Reddit", "everything outstanding in Phase 2" — and without this
   * the message is those task names with the reason for grouping them thrown
   * away. The reader gets four bullets and no idea why these four.
   *
   * Trimmed and escaped because it comes from the browser. Nothing else here
   * takes a caller-supplied string.
   */
  const subject = slackEscape_(String(about || '').trim()).slice(0, 60);
  const topic = subject ? '*' + subject + '* for ' + name : '';

  // With one owner the client belongs in their sentence. With several it needs
  // its own line, or every greeting has to repeat it.
  if (many) lines.push('Checking in on ' + (topic || 'onboarding for ' + name) + ' 👋');

  owners.forEach((who, i) => {
    if (i || many) lines.push('');

    if (who === 'Unassigned') {
      lines.push(many
        ? 'Still unassigned — these need an owner:'
        : 'These are still open on ' + (topic || name) + ' and nobody is assigned yet:');
    } else {
      const tag = team[who] ? '<@' + team[who] + '>' : '*' + slackEscape_(who) + '*';
      lines.push(many
        ? 'Hi ' + tag + ' — these are with you:'
        : 'Hi ' + tag + ' — checking in on '
          + (topic || 'the following for ' + name) + ' 👋');
    }

    groups[who].forEach(t => lines.push(taskLine_(t)));
  });

  const cta = clientCta_(client, tasks.length);
  if (cta) lines.push('', cta);
  return lines;
}

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

  const member = ensureBotInChannel_(channel);
  if (!member.ok) return member;

  // Through taskLines_, not a second copy of it. This function used to build
  // the same message with its own inline loop, and the two had already drifted
  // — one printed "assigned Nd ago" and the other did not, so the same client
  // read differently depending on which button was pressed.
  const r = slackCall_('chat.postMessage', {
    channel: member.channelId,
    text: taskLines_(client, open).join('\n')
  });
  if (!r.ok) return { ok: false, message: slackError_(r, 'post the message') };

  return { ok: true, posted: open.length, channel: '#' + member.name,
           joined: !!member.joined };
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
    // Reached only when the pre-flight join could not run or was raced. The
    // normal path now joins public channels before posting.
    return 'The bot is not in that channel. Use "Add bot to channel" on the '
      + 'client, or if the channel is private, run  /invite ' + botHandle_()
      + '  in it — Slack does not let a bot add itself to a private channel.';
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

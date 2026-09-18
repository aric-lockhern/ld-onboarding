/**
 * LOCKHERN ONBOARDING CRM — More than one Slack channel per client
 *
 * Most accounts have two. There is the channel the pod works in, where
 * somebody says the tracking is still broken and the media billing card
 * bounced; and there is the Slack Connect channel the client is in, where
 * nobody says either of those things. They are different rooms with different
 * audiences and the tool only had one field for them.
 *
 * WHY THIS IS A SAFETY FEATURE, NOT A CONVENIENCE. The nudges name a colleague
 * and list what they have not done yet. Posted into the internal channel that
 * is a normal Tuesday. Posted into the channel the client reads it is a
 * different thing entirely, and the button that does it looks identical either
 * way. One field meant one channel meant whichever one somebody happened to
 * paste in — and the failure is silent, immediate and in front of the client.
 *
 * So a channel carries what it IS. `internal` is ours. `client` is shared with
 * them. Everything that posts resolves to an internal channel and refuses
 * rather than guessing; `clientFacing_` is the one line that decides it.
 *
 * WHY C.SLACK STAYS. Every existing client has its channel in that cell, every
 * existing reader takes `client.slack`, and the Clients tab is read directly by
 * half the team. So C.SLACK keeps holding the internal channel's name — derived
 * from the list on every write, never a second place to edit — and the full
 * list lives beside it. A client with nothing in the list reads as "the one
 * channel in C.SLACK, internal", which is every client onboarded before today.
 *
 * WHY THE LIST IS IN CONFIG AND NOT A COLUMN. mkTab_ deletes any column past
 * the header array, so an installed Clients tab has EXACTLY as many columns as
 * the map says. Widening the map to 32 makes every `getRange(2, 1, n, C.WIDTH)`
 * — twelve of them, including the one behind the overview — read past the grid
 * and throw, from the moment the push lands until somebody re-runs setup(). A
 * migration whose failure mode is "the whole tool is down until you find the
 * menu item" is not one to ship for a feature nobody is waiting on.
 *
 * Config holds it instead, keyed by client id, which is the shape `ClickUp
 * Lists` already uses for per-client state that nothing queries across
 * clients. It costs one extra read per client page and breaks nothing on the
 * day it ships.
 */

/** The Config row the per-client channel lists live in. */
const CHANNELS_CFG = 'Slack Channels';

/** What a channel is for. The value is stored, so it is not re-derivable. */
const CHANNEL_KINDS = [
  { key: 'internal', label: 'Internal',
    hint: 'Ours. Nudges and outstanding-item pings go here.' },
  { key: 'client', label: 'Shared with the client',
    hint: 'A Slack Connect or shared channel the client is in. Nothing is '
        + 'ever posted here automatically.' }
];

/** A channel the client can read. The single line every posting path checks. */
function clientFacing_(ch) {
  return !!ch && String(ch.kind || 'internal') === 'client';
}

// ---------------------------------------------------------------- READ

/**
 * Every Slack channel linked to one client.
 *
 * Falls back to C.SLACK, marked internal, for every client linked before this
 * existed — which is all of them. That fallback is not a migration step to be
 * cleaned up later: somebody editing the Slack Channel cell by hand in the
 * sheet is a reasonable thing to do and has to keep working.
 */
function clientChannels_(client) {
  if (!client) return [];

  let list = storedChannels_()[String(client.clientId || '')] || [];
  if (!Array.isArray(list)) list = [];

  if (!list.length && client.slack) {
    list = [{ name: String(client.slack).replace(/^#/, ''), kind: 'internal' }];
  }

  return list.map(c => ({
    id: String(c.id || ''),
    name: String(c.name || '').replace(/^#/, ''),
    kind: String(c.kind || 'internal') === 'client' ? 'client' : 'internal'
  })).filter(c => c.name || c.id);
}

/** Every client's channel list, as one parsed map. */
function storedChannels_() {
  try {
    return JSON.parse(cfg(CHANNELS_CFG) || '{}') || {};
  } catch (e) {
    // Hand-edited into something unparseable. Reading it as empty falls back
    // to C.SLACK, which is the safe answer: one internal channel.
    return {};
  }
}

/**
 * The channel a message goes to.
 *
 * Internal only, and it returns a reason rather than a channel when there
 * isn't one. A ping with nowhere safe to go is not a ping that should fall
 * back to whatever else is linked.
 */
function postableChannel_(client) {
  const all = clientChannels_(client);
  const internal = all.filter(c => !clientFacing_(c));

  if (internal.length) return { ok: true, channel: internal[0] };

  if (all.length) {
    return { ok: false, message: 'The only Slack channel on this client is '
      + '#' + all[0].name + ', which is marked as shared with the client. '
      + 'Nudges name a colleague and list what they have not done, so they are '
      + 'never posted to a channel the client reads. Link an internal channel '
      + 'and this works.' };
  }

  return { ok: false, message: 'No Slack channel on this client. Create one '
    + 'first, or link an existing one.' };
}

/** The list for the browser, with what each one is. */
function getClientChannels(clientId) {
  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };

  const list = clientChannels_(client);
  return {
    ok: true,
    channels: list,
    kinds: CHANNEL_KINDS,
    // Said on screen rather than left to be discovered by a ping landing in
    // front of a client.
    postsTo: (list.filter(c => !clientFacing_(c))[0] || {}).name || ''
  };
}

// ---------------------------------------------------------------- WRITE

/**
 * Stores the list, and keeps C.SLACK pointing at the internal one.
 *
 * C.SLACK is derived here and nowhere else. Two cells holding a channel name
 * is two cells that can disagree, and the one every existing reader takes is
 * the one that would be stale.
 */
function writeClientChannels_(clientId, list) {
  const clean = (list || []).filter(c => c && (c.name || c.id)).map(c => ({
    id: String(c.id || ''),
    name: String(c.name || '').replace(/^#/, ''),
    kind: clientFacing_(c) ? 'client' : 'internal'
  }));

  const map = storedChannels_();
  if (clean.length) map[String(clientId)] = clean;
  else delete map[String(clientId)];
  setConfig_(CHANNELS_CFG, JSON.stringify(map));

  const internal = clean.filter(c => !clientFacing_(c))[0];
  // Blank rather than the client-facing channel when there is no internal one.
  // C.SLACK is what the older readers post to, and filling it with a shared
  // channel would reintroduce exactly the accident this file prevents.
  setClientField_(clientId, C.SLACK, internal ? '#' + internal.name : '');

  return clean;
}

/**
 * Adds a channel to a client, or changes what an existing one is for.
 *
 * Matched on Slack's channel id where there is one, because a channel can be
 * renamed and #acme-internal becoming #acme-pod should not file it twice.
 */
function linkClientChannel(token, clientId, channel, kind) {
  checkToken_(token);

  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };

  const name = String((channel && channel.name) || channel || '')
    .trim().replace(/^#/, '');
  const id = String((channel && channel.id) || '').trim();
  if (!name && !id) return { ok: false, message: 'No channel given.' };

  const want = clientFacing_({ kind: kind }) ? 'client' : 'internal';
  const list = clientChannels_(client);

  const same = c => (id && c.id === id)
    || (!!name && c.name.toLowerCase() === name.toLowerCase());
  const prior = list.filter(same)[0];

  if (prior) {
    if (prior.kind === want) {
      return { ok: false, message: '#' + prior.name + ' is already linked as '
        + kindLabel_(want).toLowerCase() + '.' };
    }
    prior.kind = want;
    prior.id = id || prior.id;
    writeClientChannels_(clientId, list);
    return Object.assign(getClientChannels(clientId),
      { changed: prior.name, kind: want });
  }

  list.push({ id: id, name: name, kind: want });
  writeClientChannels_(clientId, list);
  return Object.assign(getClientChannels(clientId), { added: name, kind: want });
}

/**
 * Takes a channel off the client.
 *
 * The Slack channel itself is untouched — unlinking is a record-keeping act and
 * archiving a channel is not, and the two must not share a button.
 */
function unlinkClientChannel(token, clientId, channel) {
  checkToken_(token);

  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };

  const key = String(channel || '').trim().replace(/^#/, '').toLowerCase();
  const list = clientChannels_(client);
  const next = list.filter(c =>
    c.name.toLowerCase() !== key && String(c.id).toLowerCase() !== key);

  if (next.length === list.length) {
    return { ok: false, message: 'That channel is not linked to this client.' };
  }

  writeClientChannels_(clientId, next);
  return Object.assign(getClientChannels(clientId), { removed: key });
}

function kindLabel_(key) {
  const hit = CHANNEL_KINDS.filter(k => k.key === key)[0];
  return hit ? hit.label : 'Internal';
}

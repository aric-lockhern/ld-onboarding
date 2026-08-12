/**
 * LOCKHERN ONBOARDING CRM — Who is on this account
 *
 * The people working on one client, at the top of their page.
 *
 * It was already knowable and never in one place. The onboarding owner is a
 * cell on the Clients tab; whoever is actually doing the work is spread across
 * twenty Owner cells on the Access tab; and the strategist who sits on every
 * call but owns no checklist row appears nowhere at all. "Who is on Harbor?"
 * was a question you answered by scrolling a task list and adding names up.
 *
 * TWO KINDS OF MEMBERSHIP, AND THEY ARE NOT THE SAME.
 *
 * Derived membership is a consequence: you own this client, or you own a task
 * on it, so you are on it. It cannot be removed here, because the way to stop
 * owning a task is to hand the task over — and a Remove button that silently
 * left someone holding six rows would be a lie about what it did.
 *
 * Pinned membership is a statement: this person is on the account whether or
 * not a row has their name on it. That is the strategist, the account lead, the
 * person covering a fortnight of leave. It is stored on the client record and
 * is the only kind this screen can add or take away.
 *
 * Stored as JSON in C.TEAM rather than a tab, for the reason in Recent.gs: it
 * is per-client, read and written whole, and never queried across clients.
 */

// ---------------------------------------------------------------- READ

/**
 * Everyone on this client, and where their membership comes from.
 *
 * Also returns who else could be added, because a picker that lists people
 * already on the account is how somebody gets added twice under two spellings.
 */
function getClientTeam(clientId) {
  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };

  const team = getTeam();
  const byName = {};
  team.forEach(t => { byName[t.name.toLowerCase()] = t; });

  const members = {};
  const add = (name, why, extra) => {
    const key = String(name || '').trim();
    if (!key) return;
    const k = key.toLowerCase();
    if (!members[k]) {
      const known = byName[k];
      members[k] = {
        name: known ? known.name : key,
        // A name on a client row that matches nobody on the Team tab is worth
        // showing rather than hiding: it is usually somebody who left, and an
        // owner who cannot be notified with no hint why is the bug this
        // replaces.
        known: !!known,
        email: known ? known.email : '',
        role: known ? known.role : '',
        skills: known ? known.skills : [],
        slackId: known ? known.slackId : '',
        why: [], tasks: 0, pinned: false
      };
    }
    if (members[k].why.indexOf(why) === -1) members[k].why.push(why);
    if (extra) Object.keys(extra).forEach(f => { members[k][f] = extra[f]; });
  };

  if (client.owner) add(client.owner, 'Onboarding owner');

  // Task owners, with how much they are holding. A count is what turns "on the
  // account" into something you can act on — three names against eighteen rows
  // is a different picture from three names against three.
  const counts = taskCounts_(clientId, client);
  Object.keys(counts).forEach(name => {
    add(name, 'Owns tasks', { tasks: counts[name] });
  });

  readClientTeam_(clientId).forEach(name => add(name, 'Added to the account',
    { pinned: true }));

  const list = Object.keys(members).map(k => members[k]);
  // Owner first, then whoever holds the most work. Alphabetical would put the
  // person with one task above the person running the account.
  list.sort((a, b) => {
    const ao = a.why.indexOf('Onboarding owner') !== -1 ? 0 : 1;
    const bo = b.why.indexOf('Onboarding owner') !== -1 ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return (b.tasks || 0) - (a.tasks || 0);
  });

  const on = {};
  list.forEach(m => { on[m.name.toLowerCase()] = true; });

  return {
    ok: true,
    members: list,
    // Everyone else, for the picker.
    available: team.filter(t => !on[t.name.toLowerCase()])
      .map(t => ({ name: t.name, role: t.role, skills: t.skills })),
    teamEmpty: !team.length
  };
}

/**
 * How many tasks each person holds on this client.
 *
 * The client is an assignee too — a third of the checklist is their work — and
 * they are excluded here by name, because assigneesFor_ files them under their
 * contact or company rather than a marker value. Counting them would put the
 * client on their own account team, which is a different thing entirely.
 */
function taskCounts_(clientId, client) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.ACCESS);
  if (!sh || sh.getLastRow() < 2) return {};

  const theirs = {};
  [client && client.contact, client && client.company, 'Client'].forEach(n => {
    if (n) theirs[String(n).trim().toLowerCase()] = true;
  });

  const out = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, A.WIDTH).getValues()
    .filter(r => String(r[A.ID - 1]).trim() === String(clientId).trim())
    .forEach(r => {
      const owner = safeStr_(r[A.OWNER - 1]).trim();
      if (!owner || theirs[owner.toLowerCase()]) return;
      out[owner] = (out[owner] || 0) + 1;
    });
  return out;
}

function readClientTeam_(clientId) {
  const row = clientRowNumber_(clientId);
  if (!row) return [];
  const raw = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(TABS.CLIENTS).getRange(row, C.TEAM).getValue();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch (e) {
    // Written by hand in the sheet, which is a fair thing to do to a column
    // called Team. Commas are what a person types.
    return String(raw).split(',').map(s => s.trim()).filter(Boolean);
  }
}

function writeClientTeam_(clientId, names) {
  setClientField_(clientId, C.TEAM, JSON.stringify(names));
}

// ---------------------------------------------------------------- WRITE

/**
 * Puts somebody on the account.
 *
 * Only names on the Team tab, because everything downstream resolves through
 * it — a Slack ping needs a member ID, and a typed name has none.
 */
function addClientTeamMember(token, clientId, name) {
  checkToken_(token);

  const who = String(name || '').trim();
  if (!who) return { ok: false, message: 'Nobody picked.' };

  const known = getTeam().filter(t => t.name.toLowerCase() === who.toLowerCase())[0];
  if (!known) {
    return { ok: false, message: who + ' is not on the Team tab. Add them on '
      + 'the Team page first — a name typed here has no email and no Slack ID, '
      + 'so nothing could notify them.' };
  }

  const names = readClientTeam_(clientId);
  if (names.some(n => n.toLowerCase() === known.name.toLowerCase())) {
    return { ok: false, message: known.name + ' is already on this account.' };
  }

  names.push(known.name);
  writeClientTeam_(clientId, names);
  return getClientTeam(clientId);
}

/**
 * Takes somebody off.
 *
 * Only the pinned kind. Somebody who is on the account because they own eight
 * tasks stays on it until those tasks move, and the message says so rather
 * than the button doing nothing.
 */
function removeClientTeamMember(token, clientId, name) {
  checkToken_(token);

  const who = String(name || '').trim().toLowerCase();
  const names = readClientTeam_(clientId);
  const next = names.filter(n => n.toLowerCase() !== who);

  if (next.length === names.length) {
    const counts = taskCounts_(clientId, getClientRecord_(clientId));
    const holding = Object.keys(counts)
      .filter(n => n.toLowerCase() === who)[0];
    if (holding) {
      return { ok: false, message: holding + ' is on this account because they '
        + 'own ' + counts[holding] + ' task'
        + (counts[holding] === 1 ? '' : 's') + ' on it. Reassign those and they '
        + 'come off by themselves.' };
    }
    const client = getClientRecord_(clientId);
    if (client && String(client.owner || '').toLowerCase() === who) {
      return { ok: false, message: client.owner + ' is the onboarding owner. '
        + 'Change the owner on the Team page or in the client details.' };
    }
    return { ok: false, message: 'They are already off this account.' };
  }

  writeClientTeam_(clientId, next);
  return getClientTeam(clientId);
}

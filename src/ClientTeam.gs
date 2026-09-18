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

  const all = Object.keys(members).map(k => members[k]);

  // Somebody on a client row who matches nobody on the Team tab is not a team
  // member — they are a stale cell. Showing them as one puts a person on the
  // account who cannot be pinged, assigned to or emailed, and who leaves when
  // the cell is corrected. They are reported separately instead, with what
  // they are holding, because deleting the fact is worse than showing it in
  // the wrong place: somebody owns those tasks and nobody can reach them.
  const list = all.filter(m => m.known);
  const unknown = all.filter(m => !m.known).map(m => ({
    name: m.name, tasks: m.tasks, why: m.why
  }));
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
    unknown: unknown,
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
 * Takes somebody off the account.
 *
 * Membership is derived from two different things and only one of them is
 * stored here, so "remove" means two different acts. Pinning comes off by
 * itself. Owning eight checklist rows does not: those rows keep their name in
 * the Owner cell, and a × that quietly left them there would be a lie about
 * what it did — the person is gone from the strip and still holds the work.
 *
 * The first version refused that case outright and said to reassign first.
 * That was right about the danger and wrong about the answer: somebody leaving
 * an account is exactly when their rows need releasing, and sending the person
 * to go and do it by hand twenty times is how eight tasks stay assigned to
 * somebody who left.
 *
 * So it is asked rather than refused. `release` unassigns those rows in the
 * same press and says how many — an unassigned row is visibly nobody's, which
 * is the true state, where a row owned by someone off the account is not.
 *
 * @param {boolean} [release] also clear their name off the tasks they hold.
 */
function removeClientTeamMember(token, clientId, name, release) {
  checkToken_(token);

  const raw = String(name || '').trim();
  const who = raw.toLowerCase();
  const client = getClientRecord_(clientId);

  // The owner is a field, not a chip. Blanking C.OWNER from a × on a strip is
  // a bigger act than it looks — it is the name on the client record, it picks
  // the digest recipient, and it is editable three rows above. Say where.
  if (client && String(client.owner || '').toLowerCase() === who) {
    return { ok: false, message: raw + ' is the onboarding owner, which is the '
      + 'Owner field on this client rather than a team chip. Change it there '
      + 'and they come off the account with it.' };
  }

  const counts = taskCounts_(clientId, client);
  const holding = Object.keys(counts).filter(n => n.toLowerCase() === who)[0];

  // Asked once, with the number in it. "Remove them?" against eight tasks and
  // against none are different decisions.
  if (holding && !release) {
    return { ok: false, holds: counts[holding], name: holding,
             message: holding + ' owns ' + counts[holding] + ' task'
               + (counts[holding] === 1 ? '' : 's') + ' on this client. '
               + 'Removing them leaves those unassigned.' };
  }

  const names = readClientTeam_(clientId);
  const next = names.filter(n => n.toLowerCase() !== who);
  const wasPinned = next.length !== names.length;

  let freed = 0;
  if (holding && release) freed = releaseTasks_(clientId, holding);

  if (!wasPinned && !freed) {
    return { ok: false, message: 'They are already off this account.' };
  }

  if (wasPinned) writeClientTeam_(clientId, next);

  const out = getClientTeam(clientId);
  out.freed = freed;
  out.removed = raw;
  return out;
}

/**
 * Clears one person's name off every task they own on one client.
 *
 * The assigned stamp goes with it. A.ASSIGNED records the moment work changed
 * hands, and a date left against nobody says a task was picked up when it is
 * sitting unowned — the same reason assignTask clears it when unassigning.
 */
function releaseTasks_(clientId, name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.ACCESS);
  if (!sh || sh.getLastRow() < 2) return 0;

  const want = String(clientId).trim();
  const who = String(name).trim().toLowerCase();
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, A.WIDTH).getValues();

  let n = 0;
  vals.forEach((r, i) => {
    if (String(r[A.ID - 1]).trim() !== want) return;
    if (safeStr_(r[A.OWNER - 1]).trim().toLowerCase() !== who) return;
    sh.getRange(i + 2, A.OWNER).setValue('');
    sh.getRange(i + 2, A.ASSIGNED).setValue('');
    n++;
  });
  return n;
}

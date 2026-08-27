/**
 * LOCKHERN ONBOARDING CRM — Team admin
 *
 * Who works here, what they are good at, and which client channels they are
 * on. Everything else in the tool that says "owner" resolves through here.
 *
 * The Team tab has always existed; until now the only way to populate it was
 * to open the spreadsheet and type. That is fine for the person who built the
 * sheet and useless for everyone else, and it is the reason skill-based
 * assignment kept coming back unassigned — an empty directory assigns nothing
 * and says nothing about why.
 *
 * Named Team.gs, not TeamAdmin.gs, because there is no Team.html to collide
 * with — see rule 0 in CLAUDE.md.
 */

/**
 * Specialties the tool knows how to match against.
 *
 * Deliberately a code constant, not a seeded tab. Seeds bail once a tab has
 * rows (rule 3), so a list written into seed data can never reach a sheet that
 * already exists — the same trap that swallowed the Merchant Center rule
 * twice. This one has to be readable from a fresh install and from a sheet
 * that has been in use for a year, so it lives here.
 *
 * The services and platforms are unioned in at read time, so a service added
 * to the Services tab becomes a selectable specialty without a deploy.
 */
const TEAM_DISCIPLINES = [
  'Paid search', 'Paid social', 'Organic social', 'Shopping and feeds',
  'Analytics and tracking', 'Landing pages', 'Creative', 'Copywriting',
  'Reporting', 'Account management', 'Billing'
];

const TEAM_ROLES = [
  'Account manager', 'Strategist', 'Specialist', 'Analyst',
  'Designer', 'Owner', 'Contractor'
];

// ---------------------------------------------------------------- READ

/**
 * The directory, plus everything the admin screen needs to render it.
 *
 * Returns the tab-missing case as data rather than an empty list. "Nobody
 * added yet" and "the Team tab does not exist because setup() has not been
 * re-run" look identical on screen and have completely different fixes.
 */
function getTeamAdmin(token) {
  checkToken_(token);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TABS.TEAM);
  if (!sh) {
    return { ok: true, tabMissing: true, people: [],
             skillOptions: skillOptions_(), roles: TEAM_ROLES,
             message: 'The Team tab does not exist yet. In the sheet: '
               + 'Onboarding → Set up / repair sheet.' };
  }

  const people = readTeamRows_(sh).map(t => Object.assign({}, t, {
    channels: [], clients: []
  }));

  // Which client channels each person is named on. Owner is a name on the
  // Clients tab, which is exactly why the directory has to hold names people
  // actually use — a person filed as "Drake" and typed as "drake" is two
  // people to a spreadsheet and one to everyone reading it.
  const byName = {};
  people.forEach(p => { byName[p.name.toLowerCase()] = p; });

  const cl = ss.getSheetByName(TABS.CLIENTS);
  if (cl && cl.getLastRow() > 1) {
    cl.getRange(2, 1, cl.getLastRow() - 1, C.WIDTH).getValues().forEach(r => {
      if (!r[C.ID - 1]) return;
      const owner = String(r[C.OWNER - 1] || '').trim().toLowerCase();
      const p = byName[owner];
      if (!p) return;
      p.clients.push(safeStr_(r[C.COMPANY - 1]) || safeStr_(r[C.ID - 1]));
      const ch = safeStr_(r[C.SLACK - 1]);
      if (ch) p.channels.push(ch);
    });
  }

  return {
    ok: true,
    people: people,
    skillOptions: skillOptions_(),
    roles: TEAM_ROLES,
    slackReady: hasSlackToken(),
    unassignedClients: unassignedClients_(ss, byName),
    // Who is asking, so the page can render the finance tick as a control or
    // as a read-only mark. Showing an editable checkbox that the server then
    // refuses is worse than not offering it.
    viewer: whoAmI()
  };
}

/**
 * Live clients whose owner is not in the directory — the gap worth showing.
 *
 * getLastRow() on the Clients tab counts formatting and validation, not
 * records, so a sheet with 500 styled empty rows reports 501. Every list built
 * off this tab filters on the ID for that reason; this one did not, and the
 * page said "500 clients with no owner" with 500 blank names underneath.
 */
function unassignedClients_(ss, byName) {
  const cl = ss.getSheetByName(TABS.CLIENTS);
  if (!cl || cl.getLastRow() < 2) return [];

  return cl.getRange(2, 1, cl.getLastRow() - 1, C.WIDTH).getValues()
    .filter(r => {
      if (!r[C.ID - 1]) return false;
      const status = safeStr_(r[C.STATUS - 1]);
      if (status === 'Churned' || status === 'Paused') return false;
      const owner = String(r[C.OWNER - 1] || '').trim().toLowerCase();
      return !owner || !byName[owner];
    })
    .map(r => ({
      clientId: safeStr_(r[C.ID - 1]),
      company: safeStr_(r[C.COMPANY - 1]),
      owner: safeStr_(r[C.OWNER - 1])
    }));
}

/**
 * Everything a person can be a specialist in.
 *
 * Disciplines first because they are what someone actually is; services and
 * platforms after, because they are what the audit and the access checklist
 * name. The audit matches loosely against both, so offering both is what
 * makes assignment land.
 */
function skillOptions_() {
  const seen = {};
  const out = [];
  const add = (v, group) => {
    const s = String(v || '').trim();
    if (!s || seen[s.toLowerCase()]) return;
    seen[s.toLowerCase()] = true;
    out.push({ name: s, group: group });
  };

  TEAM_DISCIPLINES.forEach(d => add(d, 'Discipline'));
  try { getServiceList().forEach(s => add(s.name || s, 'Service')); } catch (e) { /* tab may be absent */ }
  try { getPlatformList().forEach(p => add(p.name || p, 'Platform')); } catch (e) { /* tab may be absent */ }
  return out;
}

/** The raw tab, including people marked inactive — the admin has to see them. */
function readTeamRows_(sh) {
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, TM.WIDTH).getValues()
    .map((r, i) => ({
      row: i + 2,
      name: String(r[TM.NAME - 1] || '').trim(),
      email: String(r[TM.EMAIL - 1] || '').trim(),
      slackId: String(r[TM.SLACKID - 1] || '').trim(),
      skills: String(r[TM.SKILLS - 1] || '').split(',')
        .map(x => x.trim()).filter(Boolean),
      role: String(r[TM.ROLE - 1] || '').trim(),
      active: r[TM.ACTIVE - 1] !== false,
      finance: r[TM.FINANCE - 1] === true
    }))
    .filter(t => t.name);
}

// ---------------------------------------------------------------- WRITE

/**
 * Adds or updates one person.
 *
 * Upsert by row, not by name: the admin screen is where names get corrected,
 * and matching on the field being edited renames nobody and duplicates
 * everybody.
 *
 * @param {Object} p { row, name, email, slackId, skills:[], role, active }
 */
function saveTeamMember(token, p) {
  checkToken_(token);
  p = p || {};

  const name = String(p.name || '').trim();
  if (!name) return { ok: false, message: 'A name is required.' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TABS.TEAM) || mkTab_(ss, TABS.TEAM, TEAM_HEADERS);

  // Only a finance viewer can move the finance tick, and only ever on somebody
  // else's row as much as their own. Without this the gate is a suggestion:
  // the Team page is open to everyone, so anyone could tick themselves in.
  const row = Number(p.row) || 0;
  const before = row >= 2
    ? readTeamRows_(sh).filter(t => t.row === row)[0] : null;
  const mayGrant = viewerSeesFinance_();
  const finance = mayGrant ? !!p.finance : !!(before && before.finance);

  const values = [
    name,
    String(p.email || '').trim(),
    String(p.slackId || '').trim(),
    (p.skills || []).map(s => String(s).trim()).filter(Boolean).join(', '),
    String(p.role || '').trim(),
    p.active === false ? false : true,
    finance
  ];

  if (row >= 2 && row <= sh.getLastRow()) {
    sh.getRange(row, 1, 1, TM.WIDTH).setValues([values]);
    return { ok: true, row: row, created: false,
             financeIgnored: !mayGrant && !!p.finance !== finance };
  }

  // A second person with the same name breaks owner lookup silently — the
  // Clients tab holds a name, and two rows answering to it means assignment
  // picks whichever the sheet reached first.
  const existing = readTeamRows_(sh)
    .find(t => t.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    return { ok: false, message: name + ' is already on the team. Edit that '
      + 'row rather than adding a second one.' };
  }

  sh.appendRow(values);
  return { ok: true, row: sh.getLastRow(), created: true };
}

/**
 * Adds a batch of people straight off the Slack roster.
 *
 * One call rather than one per person: importing eleven colleagues through
 * eleven round trips means eleven chances to half-finish, and no way to say
 * what landed. Specialties are left empty deliberately — nothing in Slack
 * knows who does paid search, and guessing from a job title would assign real
 * work off a string somebody typed into their profile.
 *
 * @param {Array} people [{ name, email, slackId, role }]
 */
function importTeamMembers(token, people) {
  checkToken_(token);
  people = people || [];
  if (!people.length) return { ok: false, message: 'Nobody selected.' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TABS.TEAM) || mkTab_(ss, TABS.TEAM, TEAM_HEADERS);

  // Matched on both keys, because someone typed into the tab by hand has a
  // name and an email but no ID, and re-importing them would duplicate them.
  const taken = {};
  readTeamRows_(sh).forEach(t => {
    if (t.slackId) taken['id:' + t.slackId] = true;
    if (t.email) taken['em:' + t.email.toLowerCase()] = true;
    taken['nm:' + t.name.toLowerCase()] = true;
  });

  const rows = [];
  const skipped = [];

  people.forEach(p => {
    const name = String((p && p.name) || '').trim();
    if (!name) return;
    const email = String((p && p.email) || '').trim();
    const slackId = String((p && p.slackId) || '').trim();

    if (taken['nm:' + name.toLowerCase()]
        || (slackId && taken['id:' + slackId])
        || (email && taken['em:' + email.toLowerCase()])) {
      skipped.push(name);
      return;
    }
    taken['nm:' + name.toLowerCase()] = true;
    if (slackId) taken['id:' + slackId] = true;
    if (email) taken['em:' + email.toLowerCase()] = true;

    // Never with finance access. Somebody imported off the Slack roster is
    // a colleague, not a partner, and the whole point of the column is that
    // it is granted deliberately rather than inherited from a bulk import.
    rows.push([name, email, slackId, '',
               String((p && p.role) || '').trim(), true, false]);
  });

  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, TM.WIDTH)
      .setValues(rows);
  }

  return { ok: true, added: rows.length, skipped: skipped,
           noEmail: rows.filter(r => !r[1]).length };
}

/**
 * Takes someone off the team.
 *
 * Deactivates rather than deletes when they own anything. Removing the row
 * would leave an owner name on the Clients tab pointing at nobody, and the
 * client page would show a person who cannot be notified with no hint why.
 */
function deleteTeamMember(token, row) {
  checkToken_(token);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TABS.TEAM);
  row = Number(row) || 0;
  if (!sh || row < 2 || row > sh.getLastRow()) {
    return { ok: false, message: 'That person is no longer on the tab.' };
  }

  const name = String(sh.getRange(row, 1).getValue() || '').trim();
  const owns = clientsOwnedBy_(ss, name);

  if (owns.length) {
    sh.getRange(row, TM.ACTIVE).setValue(false);
    return { ok: true, deactivated: true, owns: owns.length,
             message: name + ' owns ' + owns.length + ' client'
               + (owns.length === 1 ? '' : 's')
               + ', so they were marked inactive rather than removed. '
               + 'Reassign those clients first to delete the row.' };
  }

  sh.deleteRow(row);
  return { ok: true, deactivated: false };
}

function clientsOwnedBy_(ss, name) {
  const cl = ss.getSheetByName(TABS.CLIENTS);
  if (!cl || cl.getLastRow() < 2 || !name) return [];
  const want = name.toLowerCase();
  return cl.getRange(2, 1, cl.getLastRow() - 1, C.WIDTH).getValues()
    .filter(r => String(r[C.OWNER - 1] || '').trim().toLowerCase() === want)
    .map(r => safeStr_(r[C.ID - 1]));
}

/** Reassigns a client to someone on the team, from the admin screen. */
function assignClientOwner(token, clientId, name) {
  checkToken_(token);
  const ok = setClientField_(clientId, C.OWNER, String(name || '').trim());
  return ok ? { ok: true } : { ok: false, message: 'Client not found.' };
}

// ---------------------------------------------------------------- SLACK IDS

/**
 * Fills in the Slack member IDs by email and writes them back to the tab.
 *
 * Persisting them is the point. Looking people up on every render costs a
 * round trip per person and breaks entirely the moment users:read.email is
 * missing; a stored ID keeps working either way, and an ID is stable where a
 * handle is not.
 */
function syncTeamSlackIds(token) {
  checkToken_(token);

  if (!hasSlackToken()) {
    return { ok: false, message: 'No Slack token set. In the sheet: '
      + 'Onboarding → Set Slack bot token.' };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TABS.TEAM);
  if (!sh) return { ok: false, message: 'No Team tab yet.' };

  const people = readTeamRows_(sh);
  let matched = 0;
  const unmatched = [];
  let scopeProblem = '';

  people.forEach(p => {
    if (p.slackId) return;
    if (!p.email) { unmatched.push(p.name + ' — no email'); return; }

    const r = slackCall_('users.lookupByEmail', { email: p.email });
    if (r.ok && r.user) {
      sh.getRange(p.row, 3).setValue(r.user.id);
      matched++;
      return;
    }
    if (r.error === 'missing_scope' && !scopeProblem) {
      scopeProblem = slackError_(r, 'look people up by email');
    }
    unmatched.push(p.name + ' — ' + (r.error === 'users_not_found'
      ? 'no Slack account for ' + p.email : (r.error || 'lookup failed')));
  });

  return { ok: true, matched: matched, unmatched: unmatched,
           scopeProblem: scopeProblem };
}

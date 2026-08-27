/**
 * LOCKHERN ONBOARDING CRM — Sending the checklist into ClickUp
 *
 * The audit produces twenty owned, dated items on the client page. The work
 * itself then happens in ClickUp, which means somebody retypes twenty tasks,
 * picks twenty assignees off a dropdown, and gets bored around item nine. What
 * arrives is a partial list with the boring half missing, and nothing on
 * either side knows which half.
 *
 * This sends them. Pick a workspace and a list, press the button once.
 *
 * WHY IT IS NOT ONE BUTTON WITH NO PICKER. There is no right list to guess at.
 * ClickUp's hierarchy is workspace → space → folder → list, agencies keep one
 * list per client or one per channel or one per month, and a task in the wrong
 * list is worse than no task because nobody finds it to delete it. The picker
 * remembers what you chose on this client, so it is a decision made once.
 *
 * WHAT STOPS IT SENDING TWICE. The created task's ID is written back onto the
 * checklist row, in A.CLICKUP. A row that already carries one is skipped, so
 * pressing the button again sends only what is new — which is the normal case,
 * because rebuilding the action items after a second call adds four items to
 * sixteen that are already over there. That column is also the link back: the
 * client page shows which rows exist in ClickUp and opens them.
 *
 * ASSIGNEES ARE MATCHED ON EMAIL. The Team tab holds one, ClickUp's members
 * carry one, and a name is not a key — "Drake King" and "drake king" are two
 * people to a string comparison and one to everybody else. Anyone unmatched
 * lands unassigned WITH THEIR NAME REPORTED, rather than silently belonging to
 * nobody: an unassigned task in a shared list is invisible in a way that a
 * named one is not.
 */

const CLICKUP_PUSH_MAX = 60;   // runaway guard, not a policy

// ---------------------------------------------------------------- PICKER

/**
 * The workspaces this token can see.
 *
 * Deliberately not `clickUpWorkspaceId_`, which refuses when there is more
 * than one because the doc scan has to pick without asking. Here somebody IS
 * being asked, so several is the normal answer rather than an error.
 */
function clickupWorkspaces() {
  if (!clickUpToken_()) {
    return { ok: false, noToken: true,
             message: 'No ClickUp token set. In the sheet: Onboarding → Set '
               + 'ClickUp API token.' };
  }

  const r = clickUpGet_('/team');
  if (!r.ok) return r;

  return { ok: true, workspaces: ((r.data && r.data.teams) || []).map(t => ({
    id: String(t.id), name: String(t.name || t.id)
  })) };
}

/**
 * Every list in a workspace, flattened, with the path that says which is which.
 *
 * Flattened because the shape of the tree is not the question — "which list
 * does this go in" is — and a three-level picker to answer it is three clicks
 * where one would do. The path is carried on the label instead: two lists both
 * called "Tasks" are told apart by the space above them, and without that the
 * picker offers the same word twice.
 *
 * Costs one call per folder, which is why the answer is handed back whole for
 * the browser to filter rather than re-fetched per keystroke.
 */
function clickupLists(workspaceId) {
  if (!clickUpToken_()) return { ok: false, noToken: true };
  if (!workspaceId) return { ok: false, message: 'No workspace picked.' };

  const spaces = clickUpGet_('/team/' + workspaceId + '/space?archived=false');
  if (!spaces.ok) return spaces;

  const lists = [];
  const problems = [];

  ((spaces.data && spaces.data.spaces) || []).forEach(sp => {
    // Lists that sit directly in the space, with no folder around them.
    const loose = clickUpGet_('/space/' + sp.id + '/list?archived=false');
    if (loose.ok) {
      ((loose.data && loose.data.lists) || []).forEach(l => {
        lists.push({ id: String(l.id), name: String(l.name),
                     path: String(sp.name) });
      });
    } else {
      problems.push(sp.name);
    }

    const folders = clickUpGet_('/space/' + sp.id + '/folder?archived=false');
    if (!folders.ok) { problems.push(sp.name); return; }

    ((folders.data && folders.data.folders) || []).forEach(f => {
      // The folder response already carries its lists, so this is not a
      // further call per folder.
      (f.lists || []).forEach(l => {
        lists.push({ id: String(l.id), name: String(l.name),
                     path: String(sp.name) + ' / ' + String(f.name) });
      });
    });
  });

  lists.sort((a, b) => (a.path + a.name).localeCompare(b.path + b.name));

  return { ok: true, lists: lists,
           // Named rather than swallowed. A space the token cannot read is a
           // permissions answer, and "my list is not in the dropdown" is
           // otherwise unanswerable from this screen.
           unreadable: problems.filter((v, i) => problems.indexOf(v) === i) };
}

// ---------------------------------------------------------------- PLAN

/**
 * What would be sent, before anything is.
 *
 * Same shape as the send, so the screen cannot offer something the send would
 * skip. Shows who each task would land on and, more usefully, who it would
 * NOT: an unmatched owner is a task about to arrive in a shared list belonging
 * to nobody, and that is worth knowing before rather than after.
 */
function clickupPlan(token, clientId, opts) {
  checkToken_(token);
  opts = opts || {};

  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };

  const rows = pushableRows_(clientId, opts.everything === true);
  const people = opts.workspaceId
    ? clickUpMembers_(opts.workspaceId) : { ok: true, byEmail: {} };

  const items = rows.map(r => {
    const who = matchAssignee_(r.owner, people.byEmail || {});
    return {
      task: r.task, area: r.category, owner: r.owner,
      due: fmtDate_(r.due), phase: r.phase, origin: r.origin,
      assignee: who ? who.name : '',
      // Named, not just absent. "3 will be unassigned" is a number; "Sasha Roe
      // is not in this ClickUp workspace" is a thing somebody can fix.
      unmatched: r.owner && !who ? r.owner : ''
    };
  });

  return {
    ok: true,
    items: items,
    sent: sentRows_(clientId).length,
    // Whether the workspace could be read at all. Without it every row shows
    // as unassigned, which would be a lie about what the send would do.
    peopleOk: people.ok !== false,
    peopleNote: people.message || '',
    listId: cfgClientList_(clientId).listId,
    workspaceId: cfgClientList_(clientId).workspaceId
  };
}

// ---------------------------------------------------------------- SEND

/**
 * Creates a ClickUp task for every checklist row not already over there.
 *
 * One row at a time, because ClickUp has no bulk create and a partial failure
 * has to be attributable: "14 of 20 went, these 6 did not and here is why" is
 * actionable, and "the request failed" after fourteen tasks were created is
 * the worst possible answer.
 *
 * The task ID goes back on the row as each one succeeds rather than in one
 * write at the end. If the script is killed halfway — six minutes is the
 * ceiling and twenty tasks is twenty round trips — what was created is still
 * recorded, and the next press picks up where it stopped instead of making
 * duplicates of everything.
 */
function clickupPush(token, clientId, opts) {
  checkToken_(token);
  opts = opts || {};

  if (!clickUpToken_()) {
    return { ok: false, message: 'No ClickUp token set. In the sheet: '
      + 'Onboarding → Set ClickUp API token.' };
  }

  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };

  const listId = String(opts.listId || '').trim();
  if (!listId) return { ok: false, message: 'Pick a ClickUp list first.' };

  const rows = pushableRows_(clientId, opts.everything === true);
  if (!rows.length) {
    return { ok: true, sent: 0, nothing: true,
             message: 'Everything on this checklist is already in ClickUp, or '
               + 'is complete. Rebuild the action items and press this again '
               + 'to send what is new.' };
  }
  if (rows.length > CLICKUP_PUSH_MAX) rows.length = CLICKUP_PUSH_MAX;

  const people = clickUpMembers_(opts.workspaceId);
  const url = clientUrl_(client);

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.ACCESS);
  const done = [];
  const failed = [];
  const unassigned = [];

  rows.forEach(r => {
    const who = matchAssignee_(r.owner, people.byEmail || {});
    if (r.owner && !who && unassigned.indexOf(r.owner) === -1) {
      unassigned.push(r.owner);
    }

    const body = {
      name: r.task,
      description: taskDescription_(client, r, url),
      assignees: who ? [who.id] : []
    };
    // ClickUp wants epoch milliseconds. A row with no due date gets none,
    // rather than today — a made-up deadline is worse than an absent one.
    const due = parseDate_(r.due);
    if (due) { body.due_date = due.getTime(); body.due_date_time = false; }

    const res = clickUpPost_('/list/' + listId + '/task', body);
    if (!res.ok) {
      failed.push({ task: r.task, why: res.message });
      return;
    }

    const id = String((res.data && res.data.id) || '');
    // Written per row, not batched. See the note above about being killed
    // halfway through twenty round trips.
    if (id) sh.getRange(r.row, A.CLICKUP).setValue(id);
    done.push({ task: r.task, id: id,
                url: (res.data && res.data.url) || '',
                assignee: who ? who.name : '' });
  });

  // Remembered per client, so the picker is a decision made once rather than
  // twice a week.
  if (done.length) rememberClientList_(clientId, opts.workspaceId, listId);

  return {
    ok: done.length > 0,
    sent: done.length,
    created: done,
    failed: failed,
    unassignedOwners: unassigned,
    peopleNote: people.message || '',
    message: done.length ? '' : 'Nothing could be created. '
      + (failed.length ? failed[0].why : '')
  };
}

// ---------------------------------------------------------------- ROWS

/**
 * The checklist rows that would go.
 *
 * Audit follow-ups by default, because that is what somebody asked for and
 * because the rest of the checklist is access chasing that lives here rather
 * than in a delivery tool. `everything` widens it to the whole open checklist
 * for teams that run all of it out of ClickUp.
 *
 * Never anything Complete or N/A — sending a finished task creates work that
 * has to be closed again — and never a row already carrying a task ID.
 */
function pushableRows_(clientId, everything) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.ACCESS);
  if (!sh || sh.getLastRow() < 2) return [];

  const id = String(clientId).trim();
  const out = [];

  sh.getRange(2, 1, sh.getLastRow() - 1, A.WIDTH).getValues().forEach((r, i) => {
    if (String(r[A.ID - 1]).trim() !== id) return;
    if (String(r[A.CLICKUP - 1] || '').trim()) return;

    const status = String(r[A.STATUS - 1] || '');
    if (status === 'Complete' || status === 'N/A') return;

    const origin = String(r[A.ORIGIN - 1] || '').trim();
    if (!everything && origin !== ORIGIN_AUDIT) return;

    out.push({
      row: i + 2,
      task: safeStr_(r[A.TASK - 1]),
      category: safeStr_(r[A.CATEGORY - 1]),
      owner: safeStr_(r[A.OWNER - 1]),
      notes: safeStr_(r[A.NOTES - 1]),
      due: r[A.DUE - 1],
      phase: Number(r[A.PHASE - 1]) || 0,
      origin: origin
    });
  });
  return out.filter(r => r.task);
}

/** Rows already over there, so the card can say how many and link to them. */
function sentRows_(clientId) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.ACCESS);
  if (!sh || sh.getLastRow() < 2) return [];

  const id = String(clientId).trim();
  return sh.getRange(2, 1, sh.getLastRow() - 1, A.WIDTH).getValues()
    .filter(r => String(r[A.ID - 1]).trim() === id
              && String(r[A.CLICKUP - 1] || '').trim())
    .map(r => ({ task: safeStr_(r[A.TASK - 1]),
                 id: safeStr_(r[A.CLICKUP - 1]) }));
}

/**
 * The task body.
 *
 * Carries why it matters and where it came from, because a bare task name in
 * ClickUp three weeks later is a sentence nobody can act on — "Add H1 tags to
 * all product pages" without "the audit found 40 pages with none" is a chore
 * rather than a reason. The link back to the client page is the rest of the
 * context, one click away.
 */
function taskDescription_(client, row, url) {
  const bits = [];
  if (row.notes) bits.push(row.notes);
  if (row.category) bits.push('Channel: ' + row.category);
  bits.push('Client: ' + client.company);
  if (url) bits.push(url);
  return bits.join('\n\n');
}

// ---------------------------------------------------------------- PEOPLE

/**
 * The workspace's members, keyed by lowercased email.
 *
 * Email is the only key both sides genuinely share. The Team tab has one on
 * every row imported off the Slack roster, ClickUp carries one per member, and
 * matching on names would put work on the wrong person the first time somebody
 * is filed as "Alex" in one system and "Alexandra" in the other.
 */
function clickUpMembers_(workspaceId) {
  if (!workspaceId) {
    return { ok: false, byEmail: {},
             message: 'No workspace picked, so nothing could be assigned.' };
  }

  const r = clickUpGet_('/team');
  if (!r.ok) return { ok: false, byEmail: {}, message: r.message };

  const team = ((r.data && r.data.teams) || [])
    .filter(t => String(t.id) === String(workspaceId))[0];
  if (!team) {
    return { ok: false, byEmail: {},
             message: 'That workspace is not visible to this token any more.' };
  }

  const byEmail = {};
  (team.members || []).forEach(m => {
    const u = m.user || m;
    const email = String(u.email || '').trim().toLowerCase();
    if (!email || !u.id) return;
    byEmail[email] = { id: u.id, name: String(u.username || u.email) };
  });
  return { ok: true, byEmail: byEmail };
}

/**
 * The ClickUp member for a name on the Access tab.
 *
 * Goes name → Team tab → email → ClickUp, because the checklist stores a name
 * and ClickUp knows an address. A person on neither side of that chain comes
 * back null and the caller reports them; guessing would assign real work off a
 * near-match.
 */
function matchAssignee_(owner, byEmail) {
  const name = String(owner || '').trim().toLowerCase();
  if (!name) return null;

  const person = getTeam().filter(t =>
    String(t.name || '').trim().toLowerCase() === name)[0];
  if (!person || !person.email) return null;

  return byEmail[String(person.email).trim().toLowerCase()] || null;
}

// ---------------------------------------------------------------- MEMORY

/**
 * Which list this client's tasks go in, remembered on the Config tab.
 *
 * Per client, keyed by ID, because one list per client is the common shape and
 * re-picking it every time is the thing that stops people using this. A shared
 * list is the same answer written against several clients, which costs nothing.
 */
function cfgClientList_(clientId) {
  const raw = cfg('ClickUp Lists') || '';
  let map = {};
  try { map = JSON.parse(raw) || {}; } catch (e) { map = {}; }
  const hit = map[String(clientId)] || {};
  return { workspaceId: String(hit.w || ''), listId: String(hit.l || '') };
}

function rememberClientList_(clientId, workspaceId, listId) {
  const raw = cfg('ClickUp Lists') || '';
  let map = {};
  try { map = JSON.parse(raw) || {}; } catch (e) { map = {}; }
  map[String(clientId)] = { w: String(workspaceId || ''), l: String(listId) };
  try { setConfig_('ClickUp Lists', JSON.stringify(map)); } catch (e) {
    // A remembered choice is a convenience. Failing to store it must not fail
    // a send that has already created twenty tasks.
  }
}

// ---------------------------------------------------------------- HTTP

/**
 * One GET against the v2 API.
 *
 * Structured rather than thrown for the same reason readSource is: the caller
 * is building a picker out of several of these, and one unreadable space
 * should narrow the list rather than blank the screen.
 */
function clickUpGet_(path) {
  try {
    const res = UrlFetchApp.fetch(CLICKUP_API_V2 + path, {
      method: 'get',
      headers: { Authorization: clickUpToken_() },
      muteHttpExceptions: true
    });
    return clickUpResult_(res);
  } catch (e) {
    return { ok: false, message: (e && e.message) || String(e) };
  }
}

function clickUpPost_(path, body) {
  try {
    const res = UrlFetchApp.fetch(CLICKUP_API_V2 + path, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: clickUpToken_() },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    return clickUpResult_(res);
  } catch (e) {
    return { ok: false, message: (e && e.message) || String(e) };
  }
}

/**
 * ClickUp's answer, or its error in words.
 *
 * ClickUp returns its own `err` string with an `ECODE`, which is far more
 * useful than the status — "OAUTH_027" against a 401 is "this token cannot see
 * that team", and nobody would guess that from "Unauthorized".
 */
function clickUpResult_(res) {
  const code = res.getResponseCode();
  let data = {};
  try { data = JSON.parse(res.getContentText()); } catch (e) { /* below */ }

  if (code >= 200 && code < 300) return { ok: true, data: data };

  const err = (data && (data.err || data.error)) || '';
  const ecode = (data && data.ECODE) || '';
  return { ok: false, code: code,
           message: 'ClickUp said ' + code
             + (err ? ': ' + err : '')
             + (ecode ? ' (' + ecode + ')' : '')
             + (code === 401 ? '. Check the API token.' : '') };
}

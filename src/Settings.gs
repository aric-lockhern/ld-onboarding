/**
 * LOCKHERN ONBOARDING CRM — Settings
 *
 * The task library and the email copy, editable without opening the sheet.
 *
 * Both already lived on tabs and both were already editable — by whoever knew
 * which tab, which column, and that Gate is a checkbox rather than the word
 * "yes". That is the same reason the Team tab sat empty for a month: a thing
 * only one person can safely change is a thing that stops getting changed.
 *
 * WHAT EDITING HERE ACTUALLY AFFECTS. The task library is a template, read at
 * the moment startOnboarding builds a checklist. Editing it changes what the
 * NEXT client gets and leaves every existing checklist alone — which is the
 * right way round (nobody wants a task appearing mid-onboarding on an account
 * that already went live) and is worth saying on screen, because "I removed it
 * and it is still there" is otherwise a bug report.
 */

/** Method is how access is granted, and it decides what the email asks for. */
const TASK_METHODS = ['INTERNAL', 'API', 'SEMI-API', 'EMAIL', 'MANUAL'];

/**
 * Email templates that are not tied to a task.
 *
 * The Templates tab keys every row to a task name, because the access emails
 * are generated per task. A welcome email is not a task — it is a moment — and
 * before this it had nowhere to live but somebody's drafts folder.
 */
const STANDALONE_TEMPLATES = [
  { key: '_welcome', label: 'Welcome email',
    when: 'Sent once the client record exists, before anything is asked for.' },
  { key: '_scope', label: 'Scope confirmation',
    when: 'Confirms in writing what was bought, before work starts.' },
  { key: '_instructions', label: 'Access instructions',
    when: 'The how-to that goes with an access request.' },
  { key: '_kickoff', label: 'Kickoff invite',
    when: 'Agenda and attendees for the kickoff call.' },
  { key: '_handover', label: 'Handover to steady state',
    when: 'Sent when onboarding closes and the account moves to BAU.' }
];

// ---------------------------------------------------------------- TASKS

/**
 * The whole task library, plus everything the editor needs to render it.
 */
function getTaskLibrary(token) {
  checkToken_(token);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TABS.PLATFORMS);
  if (!sh) {
    return { ok: false, message: 'No Platforms tab yet — run setup() first.' };
  }

  const tasks = sh.getLastRow() < 2 ? []
    : sh.getRange(2, 1, sh.getLastRow() - 1, P.WIDTH).getValues()
        .map((r, i) => ({
          row: i + 2,
          task: safeStr_(r[P.TASK - 1]),
          category: safeStr_(r[P.CATEGORY - 1]),
          method: safeStr_(r[P.METHOD - 1]),
          needs: safeStr_(r[P.NEEDS - 1]),
          how: safeStr_(r[P.HOW - 1]),
          lead: safeStr_(r[P.LEAD - 1]),
          offset: safeNum_(r[P.OFFSET - 1]),
          owner: safeStr_(r[P.OWNER - 1]),
          phase: Number(r[P.PHASE - 1]) || 1,
          gate: r[P.GATE - 1] === true,
          always: r[P.ALWAYS - 1] === true,
          active: r[P.ACTIVE - 1] !== false,
          bizType: safeStr_(r[P.BIZTYPE - 1])
        }))
        .filter(t => t.task);

  const cats = {};
  tasks.forEach(t => { if (t.category) cats[t.category] = true; });

  return {
    ok: true,
    tasks: tasks,
    methods: TASK_METHODS,
    categories: Object.keys(cats).sort(),
    bizTypes: BIZ_TYPES,
    team: getTeam().map(t => t.name),
    phases: [1, 2, 3, 4, 5]
  };
}

/**
 * Adds or updates one task template.
 *
 * Upsert by row, not by name — this screen is where a task gets renamed, and
 * matching on the field being edited renames nothing and duplicates everything.
 */
function saveTaskTemplate(token, t) {
  checkToken_(token);
  t = t || {};

  const name = String(t.task || '').trim();
  if (!name) return { ok: false, message: 'The task needs a name.' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TABS.PLATFORMS);
  if (!sh) return { ok: false, message: 'No Platforms tab yet — run setup().' };

  const values = new Array(P.WIDTH).fill('');
  values[P.TASK - 1] = name;
  values[P.CATEGORY - 1] = String(t.category || '').trim();
  values[P.METHOD - 1] = TASK_METHODS.indexOf(t.method) === -1
    ? 'INTERNAL' : t.method;
  values[P.NEEDS - 1] = String(t.needs || '');
  values[P.HOW - 1] = String(t.how || '');
  values[P.LEAD - 1] = String(t.lead || '');
  values[P.OFFSET - 1] = t.offset === '' || t.offset === null ? ''
    : (Number(t.offset) || 0);
  values[P.OWNER - 1] = String(t.owner || '').trim();
  values[P.PHASE - 1] = Math.min(5, Math.max(1, Number(t.phase) || 1));
  values[P.GATE - 1] = t.gate === true;
  values[P.ALWAYS - 1] = t.always === true;
  values[P.ACTIVE - 1] = t.active !== false;
  values[P.BIZTYPE - 1] = BIZ_TYPES.indexOf(t.bizType) === -1 ? '' : t.bizType;

  const row = Number(t.row) || 0;
  if (row >= 2 && row <= sh.getLastRow()) {
    sh.getRange(row, 1, 1, P.WIDTH).setValues([values]);
    return { ok: true, row: row, created: false, task: name };
  }

  // The task name is the key everywhere downstream — buildAccessRows_ skips a
  // name a client already has, and setTaskStatus_ finds its row by it. Two
  // templates with one name is two rows on every checklist and one of them
  // unreachable.
  const clash = sh.getLastRow() > 1 && sh.getRange(2, P.TASK, sh.getLastRow() - 1, 1)
    .getValues().some(r => String(r[0]).trim().toLowerCase() === name.toLowerCase());
  if (clash) {
    return { ok: false, message: 'A task called "' + name + '" already exists. '
      + 'Edit that one rather than adding a second — the name is what every '
      + 'checklist matches on.' };
  }

  sh.getRange(sh.getLastRow() + 1, 1, 1, P.WIDTH).setValues([values]);
  return { ok: true, row: sh.getLastRow(), created: true, task: name };
}

/**
 * Removes a task template.
 *
 * Deactivating is usually what someone means: existing checklists keep the
 * task either way, and a deleted row cannot be brought back without retyping
 * it. Delete is offered because a genuinely wrong row should not sit there
 * forever, but the UI leads with Active.
 */
function deleteTaskTemplate(token, row) {
  checkToken_(token);

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.PLATFORMS);
  row = Number(row) || 0;
  if (!sh || row < 2 || row > sh.getLastRow()) {
    return { ok: false, message: 'That template is already gone.' };
  }

  const name = safeStr_(sh.getRange(row, P.TASK).getValue());
  sh.deleteRow(row);
  return { ok: true, task: name };
}

// ---------------------------------------------------------------- EMAILS

/**
 * Every email template: the per-task ones and the standalone moments.
 *
 * A task with no row on the Templates tab still appears, empty, because the
 * useful question is "which of these has copy" and a list of only the filled
 * ones cannot answer it.
 */
function getEmailTemplates(token) {
  checkToken_(token);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TABS.TEMPLATES);
  if (!sh) return { ok: false, message: 'No Templates tab yet — run setup().' };

  const stored = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach((r, i) => {
      const key = safeStr_(r[0]).trim();
      if (key) stored[key] = { row: i + 2, subject: safeStr_(r[1]),
                               body: safeStr_(r[2]) };
    });
  }

  const standalone = STANDALONE_TEMPLATES.map(t => Object.assign({
    key: t.key, label: t.label, when: t.when, kind: 'moment'
  }, stored[t.key] || { row: 0, subject: '', body: '' }));

  const taskNames = [];
  const pSh = ss.getSheetByName(TABS.PLATFORMS);
  if (pSh && pSh.getLastRow() > 1) {
    pSh.getRange(2, P.TASK, pSh.getLastRow() - 1, 1).getValues()
      .forEach(r => { if (r[0]) taskNames.push(String(r[0]).trim()); });
  }

  const perTask = taskNames.map(n => Object.assign({
    key: n, label: n, when: '', kind: 'task'
  }, stored[n] || { row: 0, subject: '', body: '' }));

  // Anything on the tab that matches neither — a task since renamed, or copy
  // written for something that no longer exists. Shown rather than hidden:
  // silently orphaned copy is how people conclude their edit did not save.
  const known = {};
  standalone.concat(perTask).forEach(t => { known[t.key] = true; });
  const orphans = Object.keys(stored).filter(k => !known[k]).map(k => ({
    key: k, label: k, kind: 'orphan',
    when: 'No task or moment of this name — probably renamed.',
    row: stored[k].row, subject: stored[k].subject, body: stored[k].body
  }));

  return { ok: true, moments: standalone, tasks: perTask, orphans: orphans,
           merge: TEMPLATE_MERGE_FIELDS };
}

/** Writes one template. Creates the row when there is not one yet. */
function saveEmailTemplate(token, key, subject, body) {
  checkToken_(token);

  const name = String(key || '').trim();
  if (!name) return { ok: false, message: 'No template picked.' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TABS.TEMPLATES);
  if (!sh) return { ok: false, message: 'No Templates tab yet — run setup().' };

  const values = [name, String(subject || ''), String(body || '')];

  if (sh.getLastRow() > 1) {
    const keys = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() !== name) continue;
      sh.getRange(i + 2, 1, 1, 3).setValues([values]);
      return { ok: true, row: i + 2, created: false };
    }
  }

  sh.appendRow(values);
  return { ok: true, row: sh.getLastRow(), created: true };
}

/**
 * Clears a template back to the copy in the code.
 *
 * Deleting the row is what "reset" means here: getTemplate_ reads the tab first
 * and falls back to the constants in Templates.gs, so removing the row restores
 * the shipped wording rather than leaving the email blank.
 */
function resetEmailTemplate(token, key) {
  checkToken_(token);

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.TEMPLATES);
  if (!sh || sh.getLastRow() < 2) return { ok: false, message: 'Nothing stored.' };

  const name = String(key || '').trim();
  const keys = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).trim() !== name) continue;
    sh.deleteRow(i + 2);
    return { ok: true };
  }
  return { ok: false, message: 'That template was not overridden anyway.' };
}

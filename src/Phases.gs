/**
 * LOCKHERN ONBOARDING CRM — Phases
 *
 * Onboarding runs in order. A phase advances only when its gate tasks are
 * Complete; non-gate tasks in the same phase can trail without blocking.
 *
 * The point of the gates isn't process for its own sake. Phase 1 holds the
 * alias and the Drive folder, and the Phase 2 client email contains the alias
 * and points at the folder — so sending before Phase 1 closes produces a
 * broken email. Internal work genuinely gates the client-facing work.
 */

function getPhases_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.PHASES);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .filter(r => r[0])
    .map(r => ({
      phase: Number(r[0]), name: String(r[1]),
      email: String(r[2] || '').trim(), meaning: String(r[3] || '')
    }))
    .sort((a, b) => a.phase - b.phase);
}

/**
 * Returns per-phase state for one client plus the current phase.
 * A phase is 'done' when every gate in it is Complete, 'open' when it's the
 * lowest phase with an outstanding gate, and 'locked' after that.
 */
function getPhaseState_(clientId) {
  const phases = getPhases_();
  const tasks = getClientTasks_(clientId);

  const byPhase = {};
  tasks.forEach(t => {
    const p = Number(t.phase) || 1;
    if (!byPhase[p]) byPhase[p] = { gates: [], all: [] };
    byPhase[p].all.push(t);
    if (t.gate && t.status !== 'N/A') byPhase[p].gates.push(t);
  });

  let current = null;
  const out = phases.map(ph => {
    const b = byPhase[ph.phase] || { gates: [], all: [] };
    const openGates = b.gates.filter(t => t.status !== 'Complete');
    const counted = b.all.filter(t => t.status !== 'N/A');
    const done = counted.filter(t => t.status === 'Complete').length;

    const state = openGates.length ? (current === null ? 'open' : 'locked') : 'done';
    if (state === 'open') current = ph.phase;

    return {
      phase: ph.phase, name: ph.name, email: ph.email, meaning: ph.meaning,
      state: state, done: done, total: counted.length,
      openGates: openGates.map(t => ({ task: t.task, owner: t.owner, method: t.method }))
    };
  });

  return {
    phases: out,
    current: current === null ? (phases.length ? phases[phases.length - 1].phase + 1 : 1) : current,
    complete: current === null
  };
}

function getPhaseStateFor(token, clientId) {
  checkToken_(token);
  return getPhaseState_(clientId);
}

/**
 * Can we send this phase's client email yet?
 * Blocked if any earlier phase still has an open gate — and we say which,
 * so the fix is obvious rather than a vague "not ready".
 */
function phaseSendCheck_(clientId, phaseNum) {
  const st = getPhaseState_(clientId);
  const target = st.phases.find(p => p.phase === phaseNum);
  if (!target) return { ok: false, reasons: ['Phase ' + phaseNum + ' is not configured.'] };
  if (!target.email) return { ok: false, reasons: ['No client email set for this phase.'] };

  const blocking = st.phases
    .filter(p => p.phase < phaseNum && p.state !== 'done')
    .reduce((acc, p) => acc.concat(
      p.openGates.map(g => 'Phase ' + p.phase + ' — ' + g.task
        + (g.owner ? ' (' + g.owner + ')' : ''))), []);

  return { ok: !blocking.length, reasons: blocking, phaseName: target.name };
}

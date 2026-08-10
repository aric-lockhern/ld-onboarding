/**
 * LOCKHERN ONBOARDING CRM — Digest
 *
 * A dashboard only works if someone opens it. This is the nudge: a daily
 * email of anything overdue or due today, grouped by owner, so a stalled
 * onboarding surfaces without anyone going looking for it.
 */

function installDigestTrigger() {
  const ui = SpreadsheetApp.getUi();
  if (!cfg('Digest Recipients')) {
    ui.alert('Set "Digest Recipients" on the Config tab first.');
    return;
  }
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sendDigest')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('sendDigest').timeBased().atHour(8).everyDays(1).create();
  ui.alert('Daily digest enabled — sends around 8am to ' + cfg('Digest Recipients') + '.');
}

function sendDigestNow() {
  const res = sendDigest();
  SpreadsheetApp.getUi().alert(res.message);
}

function sendDigest() {
  const to = cfg('Digest Recipients');
  if (!to) return { ok: false, message: 'No digest recipients set on Config.' };

  const d = collectDigest_();
  if (!d.overdue.length && !d.dueToday.length && !d.blocked.length) {
    return { ok: true, message: 'Nothing overdue, due today, or blocked. No email sent.' };
  }

  const agency = cfg('Agency Name') || 'Lockhern';
  const subject = agency + ' onboarding — ' + d.overdue.length + ' overdue, '
    + d.dueToday.length + ' due today';

  const lines = [];
  if (d.overdue.length) {
    lines.push('OVERDUE');
    lines.push('');
    byOwner_(d.overdue).forEach(g => {
      lines.push(g.owner);
      g.items.forEach(t => lines.push('  ' + t.days + 'd  ' + t.company + ' — ' + t.task));
      lines.push('');
    });
  }
  if (d.dueToday.length) {
    lines.push('DUE TODAY');
    lines.push('');
    byOwner_(d.dueToday).forEach(g => {
      lines.push(g.owner);
      g.items.forEach(t => lines.push('  ' + t.company + ' — ' + t.task));
      lines.push('');
    });
  }
  if (d.blocked.length) {
    lines.push('BLOCKED');
    lines.push('');
    d.blocked.forEach(t => lines.push('  ' + t.company + ' — ' + t.task
      + (t.notes ? '  (' + t.notes + ')' : '')));
    lines.push('');
  }
  if (d.waitingLong.length) {
    lines.push('WAITING ON CLIENT 7+ DAYS');
    lines.push('');
    d.waitingLong.forEach(t => lines.push('  ' + t.days + 'd  ' + t.company + ' — ' + t.task));
    lines.push('');
  }

  lines.push('— — —');
  lines.push('Open the dashboard: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl());

  MailApp.sendEmail(to, subject, lines.join('\n'));
  return { ok: true, message: 'Digest sent to ' + to + '.' };
}

function collectDigest_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.ACCESS);
  const out = { overdue: [], dueToday: [], blocked: [], waitingLong: [] };
  if (!sh || sh.getLastRow() < 2) return out;

  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, A.WIDTH).getValues();
  const today = midnight_(new Date());

  rows.forEach(r => {
    const status = r[A.STATUS - 1];
    if (!r[A.ID - 1] || status === 'Complete' || status === 'N/A') return;

    const item = {
      company: r[A.COMPANY - 1], task: r[A.TASK - 1],
      owner: r[A.OWNER - 1] || 'Unassigned', notes: r[A.NOTES - 1]
    };

    if (status === 'Blocked') { out.blocked.push(item); return; }

    const due = parseDate_(r[A.DUE - 1]);
    if (due) {
      const diff = Math.round((midnight_(due) - today) / 86400000);
      if (diff < 0) { item.days = Math.abs(diff); out.overdue.push(item); }
      else if (diff === 0) out.dueToday.push(item);
    }

    const req = parseDate_(r[A.REQUESTED - 1]);
    if (status === 'Requested' && req) {
      const waiting = Math.round((today - midnight_(req)) / 86400000);
      if (waiting >= 7) out.waitingLong.push({ ...item, days: waiting });
    }
  });

  out.overdue.sort((a, b) => b.days - a.days);
  out.waitingLong.sort((a, b) => b.days - a.days);
  return out;
}

function midnight_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function byOwner_(items) {
  const map = {};
  items.forEach(t => { (map[t.owner] = map[t.owner] || []).push(t); });
  return Object.keys(map).sort().map(o => ({ owner: o, items: map[o] }));
}

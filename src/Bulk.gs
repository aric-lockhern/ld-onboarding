/**
 * LOCKHERN ONBOARDING CRM — Bringing the clients you already have into the tool
 *
 * Everything else here is built for a deal signed last week: upload the scope
 * of work, let the model read it, check the form, create the client, send them
 * the emails asking for access. That is the right shape for a new client and
 * completely wrong for fifty existing ones. They granted access in March.
 * Nobody is going to upload fifty contracts. And an email asking a two-year
 * client for their Google Ads ID is not a step in a process, it is an
 * embarrassment.
 *
 * WHAT AN EXISTING CLIENT ACTUALLY NEEDS is to be in the tool at all — a
 * record with an owner, the services they bought, their Slack channel and what
 * they pay. From that moment everything that matters for a live account works
 * on them: the audit action items, the ClickUp push, the profile, the call
 * scan, the nudges. None of that needs an onboarding checklist.
 *
 * So this is a paste box. Copy the columns out of whatever spreadsheet the
 * client list already lives in, check what it read, press import. One write.
 *
 * IT NEVER STARTS AN ONBOARDING. `startOnboarding` stays a per-client,
 * deliberate act, for the reason it always was: the moment tasks exist there
 * are due dates, owners and a queue entry, and undoing that is deleting rows.
 * Doing it fifty times in one press would put a thousand tasks on the board in
 * an afternoon, and the overview — the one screen anybody actually looks at —
 * would be unreadable the next morning. Imported clients land at Live, which
 * is what they are.
 *
 * PARSING AND WRITING ARE SEPARATE CALLS, for the reason readSource and
 * runExtraction are: the parse is where it goes wrong — a column in a
 * different order, a service spelled differently, three clients already in the
 * sheet — and a combined call could only report failure for the whole paste.
 * Split, every row carries its own verdict and the good ones still go.
 */

const BULK_MAX_ROWS = 300;

/**
 * The columns the paste can carry, and what they are called in the wild.
 *
 * Matched loosely on purpose. Nobody is going to rename the headings in their
 * own spreadsheet to suit this, and "Account Manager", "Owner" and "AM" are
 * the same column in three agencies. Anything unrecognised is reported rather
 * than silently dropped — a Vertical column that did not match is a field
 * somebody will assume made it in.
 */
const BULK_FIELDS = [
  { key: 'company',  label: 'Company',
    names: ['company', 'client', 'clientname', 'account', 'name', 'business'] },
  { key: 'contact',  label: 'Contact',
    names: ['contact', 'contactname', 'primarycontact', 'poc', 'clientcontact'] },
  { key: 'email',    label: 'Email',
    names: ['email', 'contactemail', 'clientemail', 'emailaddress'] },
  { key: 'website',  label: 'Website',
    names: ['website', 'url', 'domain', 'site', 'web'] },
  { key: 'owner',    label: 'Owner',
    names: ['owner', 'accountmanager', 'am', 'lead', 'accountlead', 'strategist'] },
  { key: 'services', label: 'Services',
    names: ['services', 'service', 'channels', 'channel', 'scopeofwork', 'products'] },
  { key: 'mrr',      label: 'MRR',
    names: ['mrr', 'monthlyfee', 'fee', 'retainer', 'monthlyretainer', 'revenue'] },
  { key: 'slack',    label: 'Slack',
    names: ['slack', 'slackchannel', 'channelname'] },
  { key: 'vertical', label: 'Vertical',
    names: ['vertical', 'industry', 'category', 'sector'] },
  { key: 'bizType',  label: 'Business type',
    names: ['businesstype', 'biztype', 'type', 'model'] },
  { key: 'contractStart', label: 'Contract start',
    names: ['contractstart', 'start', 'startdate', 'since', 'signed', 'live'] },
  { key: 'cadence',  label: 'Cadence',
    names: ['cadence', 'reporting', 'reportingcadence', 'frequency'] },
  { key: 'term',     label: 'Term',
    names: ['term', 'contractterm', 'commitment'] }
];

// ---------------------------------------------------------------- PARSE

/**
 * Reads the paste and says what it found. Writes nothing, ever.
 *
 * Every row comes back with its own problems rather than the whole paste
 * failing on one bad line: fifty rows where three are duplicates should import
 * forty-seven, not none.
 */
function bulkParse(token, text) {
  checkToken_(token);

  const raw = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!raw) return { ok: false, message: 'Nothing pasted.' };

  const lines = raw.split('\n').filter(l => l.trim());
  if (!lines.length) return { ok: false, message: 'Nothing pasted.' };

  // Tab first: a paste out of Sheets or Excel is tab-separated, and guessing
  // comma on it would split "Smith, Jones & Co" into two columns.
  const delim = lines[0].indexOf('\t') !== -1 ? '\t' : ',';
  const table = lines.map(l => splitRow_(l, delim));

  const head = mapHeader_(table[0]);
  const body = head.isHeader ? table.slice(1) : table;

  if (!head.isHeader && table[0].length > 1) {
    // No recognisable heading. Assuming an order would put the website in the
    // contact column on somebody's fifty-client list, so it says so instead.
    return { ok: false, needsHeader: true,
             message: 'No heading row recognised. Put a heading on each column '
               + '— Company, Contact, Email, Owner, Services, MRR — and paste '
               + 'again. Order does not matter; the names do.' };
  }

  // One column with no heading is the simplest paste there is: a list of
  // company names. Worth accepting, because it is what somebody tries first.
  const cols = head.isHeader ? head.cols : { company: 0 };

  if (cols.company === undefined) {
    return { ok: false,
             message: 'No Company column found. Every other column is '
               + 'optional; that one is the client.' };
  }

  const services = getServiceList().map(s => s.name || s);
  const team = getTeam().map(t => t.name);
  const taken = existingCompanies_();
  const seen = {};

  const rows = body.slice(0, BULK_MAX_ROWS).map(cells => {
    const val = key => cols[key] === undefined
      ? '' : String(cells[cols[key]] || '').trim();

    const company = val('company');
    const problems = [];
    const notes = [];

    if (!company) problems.push('No company name.');

    const lower = company.toLowerCase();
    if (company && taken[lower]) problems.push('Already in the tool.');
    if (company && seen[lower]) problems.push('Listed twice in this paste.');
    seen[lower] = true;

    // Services are matched against the Services tab, because that tab is what
    // decides which platforms a client needs and what the checklist would
    // hold. An unmatched one is reported: the fix is a row on that tab, and
    // quietly dropping it would leave a client short a workstream.
    const svc = matchList_(val('services'), services);
    if (svc.missed.length) {
      notes.push('Not on the Services tab: ' + svc.missed.join(', '));
    }

    // Same for the owner. A name that is not on the Team tab cannot be
    // notified, assigned to, or matched into Slack or ClickUp — the client
    // page already says so per client, and saying it here is cheaper.
    const owner = val('owner');
    const ownerOk = !owner || team.some(n =>
      n.toLowerCase() === owner.toLowerCase());
    if (owner && !ownerOk) notes.push(owner + ' is not on the Team tab.');

    const mrr = parseMoney_(val('mrr'));
    if (val('mrr') && mrr === '') notes.push('Could not read the MRR.');

    return {
      ok: !problems.length,
      problems: problems,
      notes: notes,
      company: company,
      contact: val('contact'),
      email: val('email'),
      website: val('website'),
      owner: owner,
      services: svc.matched,
      mrr: mrr,
      slack: normalChannel_(val('slack')),
      vertical: val('vertical'),
      bizType: val('bizType'),
      contractStart: val('contractStart'),
      cadence: val('cadence'),
      term: val('term')
    };
  });

  return {
    ok: true,
    rows: rows,
    ready: rows.filter(r => r.ok).length,
    // Which columns were understood and which were ignored, because a heading
    // this does not know is a column somebody will assume made it in.
    matched: head.matchedLabels || [],
    ignored: head.ignored || [],
    truncated: body.length > BULK_MAX_ROWS ? body.length - BULK_MAX_ROWS : 0
  };
}

/** Splits one line, honouring quotes so a comma inside a name survives. */
function splitRow_(line, delim) {
  if (delim === '\t') return line.split('\t');

  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // A doubled quote inside a quoted field is one literal quote.
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** Which column is which, matched loosely against BULK_FIELDS. */
function mapHeader_(cells) {
  const cols = {};
  const matchedLabels = [];
  const ignored = [];
  let hits = 0;

  cells.forEach((cell, i) => {
    const norm = String(cell || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!norm) return;
    const field = BULK_FIELDS.filter(f => f.names.indexOf(norm) !== -1)[0];
    if (field && cols[field.key] === undefined) {
      cols[field.key] = i;
      matchedLabels.push(field.label);
      hits++;
    } else {
      ignored.push(String(cell || '').trim());
    }
  });

  // A heading row is one where something was recognised. A first line of real
  // data almost never is — "Harbor & Sons" matches no field name.
  return { isHeader: hits > 0, cols: cols,
           matchedLabels: matchedLabels, ignored: ignored };
}

/**
 * Splits a services cell and matches each against the Services tab.
 *
 * Case and spacing are forgiven; spelling is not. "Google Ads Management" is
 * matched to "Google Ads" only if the tab says so — forcing a near-match is
 * how "Reddit Organic Social" becomes "Reddit Ads" and puts a paid-media
 * access request in front of an organic-only client.
 */
function matchList_(raw, known) {
  const wanted = String(raw || '').split(/[,;/|]+/)
    .map(s => s.trim()).filter(Boolean);
  const matched = [];
  const missed = [];

  wanted.forEach(w => {
    const hit = known.filter(k =>
      String(k).toLowerCase() === w.toLowerCase())[0];
    if (hit) { if (matched.indexOf(hit) === -1) matched.push(hit); }
    else missed.push(w);
  });
  return { matched: matched, missed: missed };
}

/** "$6,000/mo" → 6000. Returns '' when there is no number in it at all. */
function parseMoney_(raw) {
  const s = String(raw || '').replace(/[^0-9.\-]/g, '');
  if (!s || s === '-' || s === '.') return '';
  const n = Number(s);
  return isNaN(n) ? '' : n;
}

/** A Slack channel, with exactly one hash on the front. */
function normalChannel_(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return '#' + s.replace(/^#+/, '');
}

/** Company names already in the tool, lowercased, for the duplicate check. */
function existingCompanies_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.CLIENTS);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;

  sh.getRange(2, 1, sh.getLastRow() - 1, C.COMPANY).getValues().forEach(r => {
    if (!String(r[C.ID - 1]).trim()) return;
    const name = String(r[C.COMPANY - 1] || '').trim().toLowerCase();
    if (name) out[name] = true;
  });
  return out;
}

// ---------------------------------------------------------------- IMPORT

/**
 * Creates the rows that came back clean, in one write.
 *
 * ONE write, not fifty calls to submitIntake. That function does eight sheet
 * operations per client — a free-row scan, a formula, an Intake append, a
 * draft lookup — and fifty of those is four hundred operations against a
 * six-minute ceiling, for a job that is a single block of values. The row
 * itself is still built by clientRowValues_, so the two paths cannot drift.
 *
 * Everything lands at Live with onboarding Not started: these are running
 * accounts, and putting fifty of them into a queue meant for deals being set
 * up would bury the three that actually need attention.
 */
function bulkImport(token, rows) {
  checkToken_(token);

  const wanted = (rows || []).filter(r => r && r.company);
  if (!wanted.length) return { ok: false, message: 'Nothing to import.' };
  if (wanted.length > BULK_MAX_ROWS) wanted.length = BULK_MAX_ROWS;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const clients = ss.getSheetByName(TABS.CLIENTS);
  if (!clients) return { ok: false, message: 'No Clients tab.' };

  // Re-checked here, not trusted from the browser. The paste may have been
  // sitting on screen while somebody else imported half of it.
  const taken = existingCompanies_();
  const now = new Date();
  const aliasDomain = cfg('Alias Domain') || 'example.com';
  const canSeeMoney = viewerSeesFinance_();

  const values = [];
  const made = [];
  const skipped = [];

  wanted.forEach(r => {
    const company = String(r.company).trim();
    const lower = company.toLowerCase();
    if (taken[lower]) { skipped.push(company); return; }
    taken[lower] = true;

    const clientId = makeClientId_(company);
    const payload = {
      company: company,
      contact: r.contact || '',
      email: r.email || '',
      website: r.website || '',
      vertical: r.vertical || '',
      owner: r.owner || '',
      services: r.services || [],
      // Platforms are derived from the services rather than pasted. They are a
      // different list — what we need access to, not what was bought — and
      // typing them into a client list is not something anybody does.
      platforms: platformsForRow_(r),
      slack: r.slack || '',
      bizType: r.bizType || '',
      contractStart: r.contractStart || '',
      cadence: r.cadence || '',
      term: r.term || '',
      // A running account, not a deal being set up.
      status: 'Live',
      weeklyCall: false
    };

    // The finance gate applies here as everywhere: somebody who cannot see MRR
    // cannot set it either, or the gate is a suggestion. Their paste imports
    // without the money and a partner fills it in.
    const money = canSeeMoney
      ? { mrr: r.mrr === '' || r.mrr == null ? '' : r.mrr, fees: '' }
      : { mrr: '', fees: '' };

    const alias = slugAlias_(company) + '@' + aliasDomain;
    values.push(clientRowValues_(payload, clientId, alias, money, now));
    made.push({ clientId: clientId, company: company });
  });

  if (!values.length) {
    return { ok: false, skipped: skipped,
             message: 'Every one of those is already in the tool.' };
  }

  // Appended after the last row carrying an ID, never at the first gap: a hole
  // in the middle of the tab is one free row, and a block of fifty written
  // from there would overwrite everything below it.
  const start = lastUsedClientRow_(clients) + 1;
  clients.getRange(start, 1, values.length, C.WIDTH).setValues(values);

  // Per row as it is written, never pre-filled down the sheet — a formula is
  // content, and getLastRow() counts it.
  const formulas = values.map((v, i) => [progressFormula_(start + i)]);
  clients.getRange(start, C.PROGRESS, formulas.length, 1).setFormulas(formulas);

  return {
    ok: true,
    imported: made.length,
    clients: made,
    skipped: skipped,
    financeSkipped: !canSeeMoney,
    firstRow: start
  };
}

/**
 * The platforms implied by the services on a pasted row.
 *
 * Reuses whatever the intake form uses, so an imported client and a typed one
 * end up with the same platform list for the same services. Falls back to
 * nothing rather than guessing — a client with no platforms is visibly
 * incomplete, and a client with the wrong ones is not.
 */
function platformsForRow_(r) {
  try {
    // It takes a client-shaped object reading the raw comma strings, which is
    // what a Clients row holds — not two arguments.
    return platformsForClient_({
      servicesRaw: (r.services || []).join(', '),
      platformsRaw: '',
      bizType: r.bizType || ''
    }) || [];
  } catch (e) {
    return [];
  }
}

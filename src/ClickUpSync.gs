/**
 * LOCKHERN ONBOARDING CRM — ClickUp call sync
 *
 * Pulling the meeting notes in rather than pasting a link every time.
 *
 * WHY THIS WORKS WHEN THE EARLIER ATTEMPT DID NOT. Fetching a ClickUp doc by
 * share link (doc.clickup.com/…/d/h/…) returns 403 EXTRA_AUTHZ_002 — a share
 * link grants a browser access, not the API. Fetching the same doc by its
 * workspace and doc ID through /v3/workspaces/{id}/docs/{docId}/pages works
 * fine. The failure was never the token, and no amount of re-issuing one would
 * have fixed it.
 *
 * DISCOVERY IS THE HARD PART, not reading. The meeting docs this agency's
 * notetaker produces are named "Meeting - 08/06/2026" — the client's name
 * appears in the attendee list and the body, never in the title. Matching on
 * the title finds nothing. So candidates are listed by recency and matched on
 * their content, which costs one fetch per doc and is why the scan is bounded.
 */

const CLICKUP_SCAN_LIMIT = 40;      // docs fetched in one scan
const CLICKUP_SCAN_DAYS = 45;       // how far back a "recent call" reaches

// ---------------------------------------------------------------- PUBLIC

/**
 * Meeting docs in ClickUp that mention this client.
 *
 * Returns candidates rather than importing them. A notetaker names a doc after
 * the date, so two clients discussed in one internal meeting both match it —
 * and deciding which of those is "their call" is a judgement, not a rule.
 */
function clickupFindCalls(clientId) {
  const token = clickUpToken_();
  if (!token) {
    return { ok: false, message: 'No ClickUp API token set. In the sheet: '
      + 'Onboarding → Set ClickUp API token.' };
  }

  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };

  const ws = clickUpWorkspaceId_();
  if (!ws.ok) return ws;

  const docs = clickUpRecentDocs_(ws.id);
  if (!docs.ok) return docs;

  const already = importedDocIds_(clientId);
  const terms = matchTerms_(client);
  if (!terms.length) {
    return { ok: false, message: 'This client has no company name or contact to '
      + 'match against.' };
  }

  const hits = [];
  let scanned = 0;

  for (let i = 0; i < docs.docs.length && scanned < CLICKUP_SCAN_LIMIT; i++) {
    const d = docs.docs[i];
    scanned++;

    // Read never throws here: one unreadable doc in a workspace of hundreds
    // must not end the scan, and "we could not open that one" is a fact worth
    // keeping rather than an exception worth propagating.
    let text = '';
    try { text = clickUpDocText_(ws.id, d.id); } catch (e) { continue; }
    if (!text) continue;

    const hay = text.toLowerCase();
    const matched = terms.filter(t => hay.indexOf(t) !== -1);
    if (!matched.length) continue;

    hits.push({
      docId: d.id,
      name: d.name || 'Untitled',
      updated: d.updated ? fmtDate_(new Date(Number(d.updated))) : '',
      updatedMs: Number(d.updated) || 0,
      url: 'https://app.clickup.com/' + ws.id + '/docs/' + d.id,
      chars: text.length,
      matchedOn: matched,
      // A one-line reason it matched, so a wrong hit is obvious before import
      // rather than after it has been written into the client's documents.
      preview: firstLine_(text),
      imported: !!already[d.id]
    });
  }

  hits.sort((a, b) => b.updatedMs - a.updatedMs);

  return { ok: true, calls: hits, scanned: scanned, workspaceId: ws.id,
           terms: terms };
}

/**
 * Stores a ClickUp doc against the client, as a document like any other.
 *
 * It goes into the draft's Drive folder rather than a new place of its own.
 * The draft is already the deal's document record — the thing you open in
 * November when somebody asks what was agreed — and a call recorded in a
 * second location is a call nobody finds.
 */
function clickupImportCall(token, clientId, docId, label) {
  checkToken_(token);

  const draftId = draftIdForClient_(clientId);
  if (!draftId) {
    return { ok: false, message: 'This client has no draft, so there is nowhere '
      + 'to file the transcript. The draft it was created from may have been '
      + 'deleted.' };
  }

  const ws = clickUpWorkspaceId_();
  if (!ws.ok) return ws;

  let text;
  try {
    text = clickUpDocText_(ws.id, docId);
  } catch (e) {
    return { ok: false, message: (e && e.message) || String(e) };
  }
  if (!text) return { ok: false, message: 'That doc came back empty.' };

  // A stable key per doc, so re-importing the same call updates its stored
  // copy instead of filing a second one beside it.
  const key = 'cu_' + String(docId).replace(/[^a-zA-Z0-9_-]/g, '');
  const name = label || 'ClickUp call';

  const record = storeSource_(draftId, key, name, text, {
    via: 'ClickUp · ' + docId,
    clickupDocId: docId
  });

  return { ok: true, key: key, label: name, chars: text.length,
           fileId: record && record.fileId };
}

// ---------------------------------------------------------------- INTERNALS

function clickUpToken_() {
  return PropertiesService.getScriptProperties()
    .getProperty('CLICKUP_API_TOKEN') || '';
}

/**
 * The workspace to search.
 *
 * Config first so a multi-workspace account can pin one, falling back to the
 * only team the token can see. Two teams and no Config value is ambiguous and
 * says so rather than picking the first and being quietly wrong.
 */
function clickUpWorkspaceId_() {
  const pinned = cfg('ClickUp Workspace ID');
  if (pinned) return { ok: true, id: String(pinned).trim() };

  const res = UrlFetchApp.fetch(CLICKUP_API_V2 + '/team', {
    method: 'get',
    headers: { Authorization: clickUpToken_() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    return { ok: false, message: 'ClickUp refused to list your workspaces ('
      + res.getResponseCode() + '). Check the API token.' };
  }

  const teams = (JSON.parse(res.getContentText()).teams) || [];
  if (!teams.length) {
    return { ok: false, message: 'That ClickUp token can see no workspaces.' };
  }
  if (teams.length > 1) {
    return { ok: false, message: 'That token can see ' + teams.length
      + ' workspaces (' + teams.map(t => t.name).join(', ') + '). Put the one '
      + 'to use in the Config tab as "ClickUp Workspace ID".' };
  }
  return { ok: true, id: String(teams[0].id) };
}

/** Docs in the workspace, newest first, back as far as the scan window. */
function clickUpRecentDocs_(workspaceId) {
  const since = Date.now() - (CLICKUP_SCAN_DAYS * 86400000);
  const out = [];
  let cursor = '';

  for (let page = 0; page < 5; page++) {
    const url = CLICKUP_API + '/workspaces/' + workspaceId + '/docs'
      + '?limit=50&deleted=false&archived=false'
      + (cursor ? '&next_cursor=' + encodeURIComponent(cursor) : '');

    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: clickUpToken_() },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      return { ok: false, message: 'ClickUp refused to list docs ('
        + res.getResponseCode() + '). The token needs to be able to see the '
        + 'Space the meeting notes live in.' };
    }

    const body = JSON.parse(res.getContentText());
    const docs = body.docs || [];
    docs.forEach(d => {
      const updated = Number(d.date_updated || d.date_created || 0);
      if (updated && updated < since) return;
      out.push({ id: d.id, name: d.name, updated: updated });
    });

    cursor = body.next_cursor || '';
    if (!cursor || !docs.length) break;
  }

  out.sort((a, b) => b.updated - a.updated);
  return { ok: true, docs: out };
}

/** Every page of a doc, joined. Empty rather than throwing on an empty doc. */
function clickUpDocText_(workspaceId, docId) {
  const res = UrlFetchApp.fetch(
    CLICKUP_API + '/workspaces/' + workspaceId + '/docs/' + docId
      + '/pages?content_format=text%2Fmd',
    { method: 'get', headers: { Authorization: clickUpToken_() },
      muteHttpExceptions: true });

  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('ClickUp returned ' + code + ' for doc ' + docId + '.');
  }

  const body = JSON.parse(res.getContentText());
  const pages = Array.isArray(body) ? body : (body.pages || []);
  return pages.map(p => (p.name ? '## ' + p.name + '\n' : '')
    + String(p.content || '')).join('\n\n').trim();
}

/**
 * What counts as this client appearing in a document.
 *
 * The company name and the contact's name, both lowercased. Short tokens are
 * dropped — a two-letter company would match half the workspace — and the
 * whole name is used rather than its words, because "Games" on its own is in
 * every second meeting note.
 */
function matchTerms_(client) {
  const out = [];
  const add = v => {
    const s = String(v || '').trim().toLowerCase();
    if (s.length >= 4 && out.indexOf(s) === -1) out.push(s);
  };
  add(client.company);
  add(client.contact);
  return out;
}

/** ClickUp docs already filed against this client, by doc ID. */
function importedDocIds_(clientId) {
  const out = {};
  const draftId = draftIdForClient_(clientId);
  if (!draftId) return out;

  const d = openDraft(draftId);
  if (!d || !d.ok) return out;

  (d.sources || []).forEach(s => {
    if (s.clickupDocId) out[s.clickupDocId] = true;
    else if (String(s.key || '').indexOf('cu_') === 0) {
      out[String(s.key).slice(3)] = true;
    }
  });
  return out;
}

function firstLine_(text) {
  const line = String(text).split('\n').map(s => s.trim())
    .find(s => s && s.indexOf('!(') !== 0 && s.indexOf('[http') !== 0);
  if (!line) return '';
  const clean = line.replace(/[*#>_`]/g, '').trim();
  return clean.length > 140 ? clean.slice(0, 139) + '…' : clean;
}

/**
 * LOCKHERN ONBOARDING CRM — Contact photo
 *
 * A face against the name of the person we talk to.
 *
 * WHY THIS IS NOT AUTOMATIC, WHICH IS THE FIRST QUESTION.
 *
 * LinkedIn has no way to look somebody up by name or by profile URL and hand
 * back their photograph. Its API only ever returns the profile of a member who
 * has personally authorised your application through their own sign-in, which
 * a client is never going to do, and there is no directory endpoint behind any
 * amount of API access. Reading the page instead is not an alternative: profile
 * pages sit behind an authentication wall for anyone not signed in, and doing
 * it with a signed-in session is against LinkedIn's terms and gets the account
 * restricted. No key, no partner tier and no scope changes that.
 *
 * What DOES work, and is what this file does, is the one manual step: open the
 * profile, right-click the photo, copy the image address, paste it here. Those
 * media.licdn.com URLs are ordinary public files, so we can fetch one and keep
 * a copy. Uploading a file works the same way, for the client who sent a
 * headshot over email.
 *
 * THE COPY IS THE POINT. A pasted URL is stored as bytes in the client's Drive
 * folder, not as a link. LinkedIn's media URLs carry an expiry, so a stored
 * link is a picture that works this month and is a broken box by Christmas —
 * and the failure would arrive silently, on the one page you built to make the
 * account feel like a person.
 */

/** Bigger than a headshot needs to be, and small enough to hand to a browser. */
const PHOTO_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Which of the client's subfolders a photo belongs in.
 *
 * Brand & Creative, because that is what it is — and because inventing a
 * seventh subfolder for one JPEG would put an empty folder in every client's
 * Drive forever. Falls back to the folder root when the subfolder is missing.
 */
const PHOTO_FOLDER = '03 Brand & Creative';

// ---------------------------------------------------------------- READ

/**
 * The photo as a data URI, or nothing.
 *
 * Handed over as bytes rather than a Drive link on purpose. A Drive thumbnail
 * URL is an authenticated request made by the browser, so it works for whoever
 * uploaded it and shows a broken image to the next person — which is the worst
 * kind of bug, because the person who can see it is the person who would have
 * fixed it.
 *
 * Its own call rather than part of the client payload: a photo is a hundred
 * kilobytes and the page should paint before it arrives.
 */
function getContactPhoto(clientId) {
  const id = photoFileId_(clientId);
  if (!id) return { ok: true, photo: '' };

  try {
    const blob = DriveApp.getFileById(id).getBlob();
    return {
      ok: true,
      photo: 'data:' + blob.getContentType() + ';base64,'
        + Utilities.base64Encode(blob.getBytes())
    };
  } catch (e) {
    // Deleted from Drive by hand. Not an error worth showing — the page simply
    // has no photo — but the stale ID goes so the next upload is clean.
    return { ok: true, photo: '', message: 'The stored photo is no longer in '
      + 'Drive.' };
  }
}

function photoFileId_(clientId) {
  const row = clientRowNumber_(clientId);
  if (!row) return '';
  return String(SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(TABS.CLIENTS).getRange(row, C.PHOTO).getValue() || '').trim();
}

// ---------------------------------------------------------------- WRITE

/**
 * Stores a photo for the primary contact.
 *
 * @param {string|Object} raw  an image URL, or { name, mimeType, data }
 */
function setContactPhoto(token, clientId, raw) {
  checkToken_(token);

  const client = getClientRecord_(clientId);
  if (!client) return { ok: false, message: 'Client not found.' };

  let blob;
  try {
    blob = photoBlob_(raw, client);
  } catch (e) {
    return { ok: false, message: (e && e.message) || String(e) };
  }

  const bytes = blob.getBytes().length;
  if (bytes > PHOTO_MAX_BYTES) {
    return { ok: false, message: 'That image is '
      + Math.round(bytes / 1024 / 1024 * 10) / 10 + 'MB. Anything over '
      + Math.round(PHOTO_MAX_BYTES / 1024 / 1024) + 'MB is a photograph doing '
      + 'a job a thumbnail does — crop it or save it smaller.' };
  }

  const type = String(blob.getContentType() || '');
  if (type.indexOf('image/') !== 0) {
    return { ok: false, message: 'That came back as ' + (type || 'no file type')
      + ' rather than an image. If you copied a LinkedIn link, make sure it is '
      + 'the image address (right-click the photo → Copy image address) and '
      + 'not the profile URL.' };
  }

  let folder;
  try {
    folder = photoFolder_(client);
  } catch (e) {
    return { ok: false, message: (e && e.message) || String(e) };
  }

  // One photo per client, replaced rather than accumulated.
  const old = photoFileId_(clientId);
  if (old) {
    try { DriveApp.getFileById(old).setTrashed(true); } catch (e) { /* gone */ }
  }

  blob.setName('contact-photo-' + clientId
    + (type === 'image/png' ? '.png' : '.jpg'));
  const file = folder.createFile(blob);
  setClientField_(clientId, C.PHOTO, file.getId());

  return getContactPhoto(clientId);
}

function clearContactPhoto(token, clientId) {
  checkToken_(token);

  const id = photoFileId_(clientId);
  if (id) {
    try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* gone */ }
  }
  setClientField_(clientId, C.PHOTO, '');
  return { ok: true, photo: '' };
}

// ---------------------------------------------------------------- INTERNALS

function photoBlob_(raw, client) {
  if (raw && typeof raw === 'object' && raw.data) {
    return Utilities.newBlob(Utilities.base64Decode(raw.data),
      raw.mimeType || 'image/jpeg', raw.name || 'photo');
  }

  const url = String(raw || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('Paste an image address or upload a file.');
  }

  // The mistake worth catching by name, because it is the one everybody makes
  // and the error Google gives for it says nothing useful.
  if (/linkedin\.com\/in\//i.test(url)) {
    throw new Error('That is the profile URL, not the photo. LinkedIn will not '
      + 'serve a profile page to this tool — open ' + (client.contact || 'their')
      + ' profile in your browser, right-click the photograph itself, and '
      + 'choose Copy image address. It will start media.licdn.com.');
  }

  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true,
                                       followRedirects: true });
  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('That address returned ' + code + '. A LinkedIn image '
      + 'address expires after a while — open the profile again and copy a '
      + 'fresh one.');
  }
  return res.getBlob();
}

/**
 * The client's own Drive folder where there is one.
 *
 * Falls back to the root rather than failing: a photo is not worth blocking on
 * a folder that has not been created yet, and the file carries the client ID in
 * its name so it is findable either way.
 */
function photoFolder_(client) {
  const url = String(client.drive || '');
  const m = url.match(/[-\w]{25,}/);
  if (m) {
    try {
      const folder = DriveApp.getFolderById(m[0]);
      const admin = folder.getFoldersByName(PHOTO_FOLDER);
      return admin.hasNext() ? admin.next() : folder;
    } catch (e) { /* fall through */ }
  }

  const rootId = cfg('Drive Root Folder ID');
  return rootId ? DriveApp.getFolderById(rootId) : DriveApp.getRootFolder();
}

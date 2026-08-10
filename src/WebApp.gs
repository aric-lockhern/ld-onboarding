/**
 * LOCKHERN ONBOARDING CRM — Web app entry point
 *
 * Serves the same two UIs as the Onboarding menu, but at a URL instead of
 * inside the sheet. Nothing is duplicated: this hands back the identical
 * Admin.html and Intake.html, and they call the identical server functions
 * over google.script.run, which works the same in a web app as in a modal.
 *
 *   <url>/exec              dashboard
 *   <url>/exec?page=intake  new client intake
 *
 * Why this works without touching the rest of the code: every function the
 * two HTML files call (dashPreview, dashSend, getDashboardOverview, verifyPin,
 * submitIntake, …) reads the spreadsheet and never touches SpreadsheetApp.getUi().
 * getUi() is only reachable from the menu wrappers — showAdminDashboard,
 * promptForPin, protectSensitiveRanges — which the web app never calls.
 * Adding a getUi() call to a function the HTML reaches would break this URL
 * while leaving the in-sheet menu working, so the failure would look like a
 * web-app-only bug. It isn't; it's a context rule.
 *
 * Deployment settings live in appsscript.json under "webapp". Changing them
 * requires a NEW deployment version — editing the manifest alone does nothing
 * to a deployment that already exists.
 */

const WEBAPP_PAGES = {
  dashboard: { file: 'Admin', title: 'Onboarding dashboard' },
  intake: { file: 'Intake', title: 'New client intake' }
};

function doGet(e) {
  const requested = (e && e.parameter && e.parameter.page) || 'dashboard';
  const page = WEBAPP_PAGES[requested] || WEBAPP_PAGES.dashboard;

  return HtmlService.createHtmlOutputFromFile(page.file)
    .setTitle(page.title + ' · Lockhern')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * The deployed URL, for pasting into Slack or a bookmark.
 *
 * Returns '' until the script has been deployed as a web app at least once —
 * a saved manifest is not a deployment. Run this from the editor after
 * deploying, or call it from the menu.
 */
function getWebAppUrl() {
  const url = ScriptApp.getService().getUrl();
  return url || '';
}

function showWebAppUrl() {
  const url = getWebAppUrl();
  SpreadsheetApp.getUi().alert(url
    ? 'Web app URL:\n\n' + url + '\n\nIntake page:\n' + url + '?page=intake'
    : 'Not deployed yet.\n\nIn the script editor: Deploy → New deployment → '
      + 'Web app. Then run this again.');
}

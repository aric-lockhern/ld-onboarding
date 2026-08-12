/**
 * LOCKHERN ONBOARDING CRM — Instruction emails
 *
 * Each template is an instruction block, not a whole email. The composer
 * wraps the blocks a client actually needs into one message so we send
 * one email instead of nine.
 *
 * Merge tags: {{company}} {{contact}} {{agency}} {{alias}} {{access_email}}
 *             {{owner}} {{mcc_id}} {{bm_id}} {{mca_id}} {{shopify_partner}}
 *
 * {{alias}} vs {{access_email}}. The alias is per client and is the better
 * shape: it survives staffing changes and offboarding is one clean revoke.
 * {{access_email}} reads Config "Agency Access Email" first, so a single shared
 * inbox can be used instead — fewer addresses to create, at the cost of a
 * revoke that has to be done account by account. Setting that Config value
 * switches every template below; leaving it blank keeps the alias behaviour.
 */

/**
 * The merge tags a template can use, for the settings editor to list.
 *
 * Kept beside the copy it documents. A merge field list in a comment is one
 * nobody editing through the web app will ever see, and a typo'd tag renders
 * as literal braces in a client's inbox.
 */
const TEMPLATE_MERGE_FIELDS = [
  { tag: '{{company}}', means: 'Client company name' },
  { tag: '{{contact}}', means: 'Primary contact name' },
  { tag: '{{agency}}', means: 'Your agency name, from Config' },
  { tag: '{{alias}}', means: 'The per-client email alias' },
  { tag: '{{access_email}}', means:
    'What to grant access to — Config "Agency Access Email", else the alias' },
  { tag: '{{owner}}', means: 'Onboarding owner' },
  { tag: '{{mcc_id}}', means: 'Google Ads manager ID, from Config' },
  { tag: '{{bm_id}}', means: 'Meta Business Manager ID, from Config' },
  { tag: '{{mca_id}}', means: 'Merchant Center advisor ID, from Config' },
  { tag: '{{shopify_partner}}', means: 'Shopify partner name, from Config' }
];


const TEMPLATES = {

  'Media billing setup': {
    subject: 'Media billing setup — {{company}}',
    body:
`Campaigns pause the moment a payment method fails, so this is worth nailing down before launch rather than after.

Confirm for each platform we're running:

1. Who funds media spend — your card directly on the ad account, or we invoice and rebill?
2. If it's your card: add it now, before we build. Google Ads → Billing → Payment methods. Meta → Business settings → Payments.
3. Set the billing threshold as high as your account allows. Low thresholds mean frequent charges and a higher chance of a decline pausing delivery.
4. Send us the name and email of whoever should get billing alerts — usually finance, not marketing.

Also worth knowing now: is there a monthly spend cap we shouldn't cross without written approval, and who gives that approval?`
  },

  'Brand assets and constraints': {
    subject: 'Brand assets and creative constraints — {{company}}',
    body:
`Please drop these into the shared Drive folder we've set up for you:

Assets
· Logo files — SVG or transparent PNG, light and dark versions
· Brand fonts, or the names if they're licensed
· Brand guidelines, if you have them
· Product and lifestyle imagery we're cleared to use
· Any existing video, even rough cuts

Constraints — these matter more than the assets
· Claims we can and cannot make, especially anything legal or regulatory has reviewed
· Words, phrases, or topics you never want to appear next to your brand
· Competitors you actively want to bid against, and any you'd rather leave alone
· Trademark restrictions from partners or retailers

The constraints list is the one people skip. It's also the one that turns into a phone call at 9pm when an ad goes live, so if there's a rule that lives only in someone's head, this is the moment to write it down.`
  },

  'Google Ads': {
    subject: 'Google Ads access — {{company}}',
    body:
`We manage Google Ads through our manager account, which means you keep ownership throughout and removing us later is one click.

We need your Customer ID first.

Finding it: sign in at ads.google.com and look at the top right of the screen, next to your account name. It is ten digits formatted xxx-xxx-xxxx. If you manage several accounts, send the ID of the one you want us on — not the manager account above it.

Reply to this email with that number and we will send the invitation from {{agency}} (manager ID {{mcc_id}}).

Accepting it, once it arrives:

1. Tools → Setup → Account access, or Admin → Access and security on newer accounts.
2. Open the Managers tab.
3. Accept the request from {{mcc_id}}.

We ask for Admin so we can manage conversion tracking and billing-adjacent settings. Standard works for everything except billing if Admin is a problem.`
  },

  'Microsoft Ads': {
    subject: 'Microsoft Advertising access — {{company}}',
    body:
`Same shape as Google Ads: we link through our manager account, you keep ownership.

We need your Account Number first.

Finding it: sign in at ads.microsoft.com, then Settings → Accounts. The Account Number is an alphanumeric code next to the account name — usually eight characters. It is not the Customer ID, which is the number above it; if you are unsure, send both.

Reply with that, and either:

· We send a link request from {{agency}} and you accept it under Settings → Accounts → Manage access, or
· You add {{access_email}} directly under Settings → Account access → Users → Invite, with the Standard role.

Either works. The link is tidier if Microsoft Ads was set up by a previous agency, because it does not depend on anyone still having the old sign-in.`
  },

  'Meta Ads': {
    subject: 'Meta access — {{company}}',
    body:
`Please grant {{agency}} access to your Meta assets through Business Settings, rather than adding anyone as an individual user. Partner access survives staffing changes on both sides and is revoked in one action.

1. Go to Meta Business Settings.
2. Select Partners from the left-hand menu.
3. Click Add, then "Give a partner access to your assets".
4. Enter our Business ID: {{bm_id}}
5. Select the assets — Facebook Page, Instagram account, ad account, Pixel/Dataset, and product catalog if you have one.
6. Enable the permissions needed to manage campaigns and the associated assets.
7. Save changes.

If any of those assets do not exist yet — commonly the catalog, or a Pixel that was never installed — tell us rather than creating them. Getting the structure right first time is much easier than merging duplicates later.`
  },

  'Meta / Instagram Organic': {
    subject: 'Facebook Page and Instagram access — {{company}}',
    body:
`This comes through the same partner grant as the ad account, so if you have already done that step you can ignore this.

1. Meta Business Settings → Partners → Add → "Give a partner access to your assets".
2. Enter our Business ID: {{bm_id}}
3. Under assets, select the Facebook Page and the Instagram account.
4. Give content and community permissions — creating posts and replying to comments and messages.

Two things worth checking while you are in there:

· The Instagram account should be a Professional account and connected to the Page. If it is a personal account, converting it takes a minute and does not lose anything.
· If the Page is still owned by a personal profile rather than a Business Portfolio, moving it into one is worth doing now. It is the single most common reason an agency handover turns into a two-week support ticket.`
  },

  'Google Merchant Center': {
    subject: 'Google Merchant Center access — {{company}}',
    body:
`Merchant Center is where your product feed lives, and feed problems are the most common reason Shopping spend quietly underdelivers.

We need your Merchant Center ID first: sign in at merchants.google.com and look at the top right, under the account name. It is a number, usually eight or nine digits.

Reply with it and then add us either way:

· As a user — Settings (the gear) → People and access → Add person → {{access_email}} → Admin. Simplest, and enough for everything.
· Or by accepting our advisor link from {{mca_id}}, under the same screen, if you would rather we came in through our manager account.

If the feed is fed from Shopify through the Google & YouTube app rather than a standalone feed, mention that — it changes where we fix things and we would rather know before we start moving anything.`
  },

  'Shopify': {
    subject: 'Shopify access — {{company}}',
    body:
`Shopify collaborator access rather than a staff account. It does not use a seat on your plan, it is scoped to only what we need, and you can revoke it without touching anyone else's login.

Two things to send us:

1. Your myshopify URL — the permanent one, not your custom domain. It looks like your-store.myshopify.com. Find it in Shopify admin under Settings → Domains; it is listed as the store's primary .myshopify.com address, or just read it out of the browser address bar while you are in the admin.

2. Your collaborator request code. Shopify admin → Settings → Users → Security, under "Collaborator request". If it says "Only collaborators with a request code can send a request", the four-digit code is right there — send it. If it says anyone can request, no code is needed and you can tell us that instead.

With those two we send the request, and it appears for you to approve under Settings → Users → Collaborators. We will ask for Orders, Products, and Themes at minimum; the exact list is on the request so you can see it before approving.`
  },

  'Google Analytics (GA4)': {
    subject: 'Google Analytics access — {{company}}',
    body:
`We need GA4 to see what happens after the click. Without it we are optimising to platform-reported conversions, which are consistently generous.

1. Open analytics.google.com and check you are in the right property — the name is top left.
2. Admin (bottom left) → Property access management.
3. The + in the top right → Add users.
4. Enter {{access_email}}, tick "Administrator", and leave "Notify by email" ticked.

Administrator lets us fix tracking rather than only look at it — creating conversion events, linking Google Ads, correcting attribution settings. If that is too much, Editor covers most of it but not the account links.

While you are there: if there is an old Universal Analytics property still listed, tell us. The historical data in it stops being reachable at some point and it is worth exporting before that happens.`
  },

  'Google Tag Manager': {
    subject: 'Google Tag Manager access — {{company}}',
    body:
`1. Open tagmanager.google.com and select the {{company}} container.
2. Admin → User management → the + button → Add users.
3. Add {{alias}}. Set Account permission to User and Container permission to Publish.

Publish rights matter — without them we can build tags but can't push them live, which turns every tracking change into a scheduling exercise.

Send us the container ID as well (GTM-XXXXXX).`
  },

  'Google Search Console': {
    subject: 'Google Search Console access — {{company}}',
    body:
`Search Console is how we see what people actually search before they land on you, and which pages Google is having trouble with. Read access is enough for most of it; we ask for Full so we can submit sitemaps and request indexing when pages change.

1. Open search.google.com/search-console and pick the property.
2. Settings → Users and permissions.
3. Add user → {{access_email}} → permission Full.

If you see more than one property listed — one for the domain and one for the URL prefix, or an http and an https version — add us to the domain property if there is one. It covers the others.

If nobody has ever set Search Console up, say so and we will verify the domain ourselves; it needs one DNS record and we will send you the exact value.`
  },

  'Google Business Profile': {
    subject: 'Google Business Profile access — {{company}}',
    body:
`1. Go to business.google.com and sign in with the account that owns the listings.
2. Select the business (or the location group, if you have several).
3. Open Managers → Add → enter {{alias}} → set the role to Manager.

Manager lets us edit business info, post updates, and respond to reviews. It cannot delete the listing or remove owners, so ownership stays entirely with you.

If you have more than a handful of locations, tell us the count — there's a location group setup that's worth doing before we start rather than after.`
  },

  'Reddit Ads': {
    subject: 'Reddit Ads access — {{company}}',
    body:
`1. Go to ads.reddit.com and open the account menu → Settings → Members.
2. Invite {{alias}} with the Admin role.
3. Send us the ad account name so we can confirm we're in the right place.

Reddit has no partner-account structure like Google or Meta, so this is a direct user invite. If your ad account was created under a personal Reddit login, it's worth moving it to a business account first — tell us and we'll walk you through it.`
  },

  'Reddit Organic': {
    subject: 'Reddit account setup — {{company}}',
    body:
`Reddit does not have partner access the way Meta does, so this one needs a brand account that we work in together.

Please create a standalone Reddit account for {{company}}, if one does not exist already:

· Use a company-controlled email address, not an employee's.
· Sign up with email and a unique password — not Google or Apple sign-in. Those tie the account to a personal login and cannot be handed over.
· Choose a username closely tied to the brand.
· Verify the email address.
· Turn on two-factor authentication if you are able to share the backup codes.

Then send us, securely:

· The Reddit username
· The email address on the account
· The password
· How two-factor is set up, and the backup codes if it is on

Please share the password through your password manager or another secure channel rather than in an email. If you do not have one, say so and we will send you a one-time secure link instead.

We will finish the profile — image, description, brand presentation — and send the first batch of posts for your review before anything goes live.`
  },

  'WordPress': {
    subject: 'WordPress access — {{company}}',
    body:
`1. Log into your WordPress admin (usually yoursite.com/wp-admin).
2. Users → Add New.
3. Email: {{alias}}. Role: Administrator.
4. Check "Send the new user an email about their account."

Administrator is what we need for plugin and tracking work. If you'd rather limit us to content, Editor works but we won't be able to install or configure anything.

Send us the admin URL if it's been moved off the default path. If the site runs through a host with its own panel — WP Engine, Kinsta, Flywheel — we'll likely need a seat there too.`
  },

  'Klaviyo': {
    subject: 'Klaviyo access — {{company}}',
    body:
`1. Open Klaviyo → Settings → Account → Users.
2. Add user → {{alias}} → role Manager.

Manager covers campaigns, flows, and segments without touching billing or account settings. Send us the account name so we can confirm the right instance.`
  },

  'TikTok Ads': {
    subject: 'TikTok Ads access — {{company}}',
    body:
`If you use TikTok Business Center:
1. Business Center → Members → Invite.
2. Add {{alias}} as an Admin, or assign us the advertiser account with Operator access.

If you don't use Business Center:
1. TikTok Ads Manager → Account setup → User management.
2. Invite {{alias}} as an Admin.

Either way, send us the Advertiser ID so we can confirm the account.`
  }
};

const EMAIL_INTRO =
`Hi {{contact}},

Ahead of kickoff we need access to the platforms below. Each one takes a couple of minutes and can be done in any order.

Everything goes to {{alias}} — a dedicated address for your account. Granting access there rather than to an individual means your access list doesn't need updating when our team changes, and revoking us later is a single action per platform.

We never need your personal passwords. Every platform below supports delegated access.

If we've shared a Drive folder with you, anything we ask you to send can go straight in there.`;

const EMAIL_KICKOFF_SUBJECT = 'Kickoff — {{company}}';
const EMAIL_KICKOFF =
`Hi {{contact}},

Access is in and we've captured a baseline, so we're ready to kick off.

Before the call, two things worth having ready:

1. What "working" looks like to you in 90 days — a number if you have one.
2. Anything in-flight on your side that could move the ground under us: a replatform, a pricing change, a big promo, inventory constraints.

We'll come with what we found in the account and the questions the audit raised. The call is mostly us asking, not presenting.

Send over a couple of windows that work and we'll get it booked.`;

const EMAIL_NUDGE_SUBJECT = 'Still need access — {{company}}';
const EMAIL_NUDGE =
`Hi {{contact}},

Quick nudge — we're still waiting on these:

{{list}}

Instructions were in the earlier thread, but happy to resend or jump on a screenshare if any of them are being awkward. A couple of these interfaces have moved recently.

Everything goes to {{alias}}.`;

const EMAIL_OUTRO =
`If anything above doesn't match what you see on screen, send a screenshot and we'll sort it out — these interfaces change often.

Reply here with the account IDs listed above and we'll confirm once each grant lands.`;

// ---------------------------------------------------------------- SEED

function seedTemplates_(ss) {
  const sh = ss.getSheetByName(TABS.TEMPLATES);
  if (sh.getLastRow() > 1) return;

  const rows = Object.keys(TEMPLATES).map(k => [k, TEMPLATES[k].subject, TEMPLATES[k].body]);
  rows.push(['_intro', 'Access request — {{company}} onboarding', EMAIL_INTRO]);
  rows.push(['_nudge', EMAIL_NUDGE_SUBJECT, EMAIL_NUDGE]);
  rows.push(['_kickoff', EMAIL_KICKOFF_SUBJECT, EMAIL_KICKOFF]);
  rows.push(['_outro', '', EMAIL_OUTRO]);

  sh.getRange(2, 1, rows.length, 3).setValues(rows);
  sh.getRange(2, 1, rows.length, 3).setVerticalAlignment('top').setWrap(true).setFontSize(10);
  sh.setColumnWidth(1, 180);
  sh.setColumnWidth(2, 260);
  sh.setColumnWidth(3, 620);
}

/** Sheet copy wins over the constant, so edits in Templates take effect. */
function getTemplate_(task) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.TEMPLATES);
  if (sh && sh.getLastRow() > 1) {
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
    const hit = rows.find(r => String(r[0]).trim() === task);
    if (hit && hit[2]) return { subject: hit[1], body: hit[2] };
  }
  if (TEMPLATES[task]) return TEMPLATES[task];
  if (task === '_intro') return { subject: 'Access request — {{company}}', body: EMAIL_INTRO };
  if (task === '_nudge') return { subject: EMAIL_NUDGE_SUBJECT, body: EMAIL_NUDGE };
  if (task === '_kickoff') return { subject: EMAIL_KICKOFF_SUBJECT, body: EMAIL_KICKOFF };
  if (task === '_outro') return { subject: '', body: EMAIL_OUTRO };
  return null;
}

// ---------------------------------------------------------------- MERGE

function mergeTags_(text, client) {
  const map = {
    company: client.company,
    contact: client.contact || 'there',
    agency: cfg('Agency Name') || 'Lockhern Digital',
    alias: client.alias || cfg('Agency Access Email') || '[access email]',
    // The address we ask the client to grant. Config first, so one shared
    // inbox can be used across every account; the per-client alias is the
    // fallback and is still the better shape — see the note in the header.
    access_email: cfg('Agency Access Email') || client.alias || '[access email]',
    owner: client.owner || '',
    mcc_id: cfg('Google Ads MCC ID') || '[MCC ID]',
    bm_id: cfg('Meta Business Manager ID') || '[Business Manager ID]',
    mca_id: cfg('Merchant Center MCA ID') || '[Merchant Center ID]',
    shopify_partner: cfg('Shopify Partner Name') || (cfg('Agency Name') || 'our Partner account')
  };
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (m, k) =>
    map[k] !== undefined ? map[k] : m);
}

// ---------------------------------------------------------------- COMPOSE

/**
 * Builds one email covering every outstanding client-action task.
 * INTERNAL tasks are ours and never appear. API tasks appear because the
 * client still has to accept the invite and hand over an account ID.
 */
function composeAccessEmail(clientId) {
  const client = getClientRecord_(clientId);
  if (!client) throw new Error('Client not found: ' + clientId);

  const tasks = getClientTasks_(clientId).filter(t =>
    t.method !== 'INTERNAL' && t.status !== 'Complete' && t.status !== 'N/A');

  if (!tasks.length) {
    return { ok: false, message: 'No outstanding client-action tasks for ' + client.company + '.' };
  }

  const parts = [mergeTags_(getTemplate_('_intro').body, client), ''];

  tasks.forEach(t => {
    const tpl = getTemplate_(t.task);
    if (!tpl) return;
    parts.push('— — —');
    parts.push(t.task.toUpperCase());
    parts.push('');
    parts.push(mergeTags_(tpl.body, client));
    parts.push('');
  });

  parts.push('— — —');
  parts.push('');
  parts.push(mergeTags_(getTemplate_('_outro').body, client));

  const sig = cfg('Email Signature');
  if (sig) { parts.push(''); parts.push(sig); }

  const subject = mergeTags_(getTemplate_('_intro').subject, client);
  return {
    ok: true, subject: subject, body: parts.join('\n'),
    to: client.email, taskCount: tasks.length,
    tasks: tasks.map(t => t.task)
  };
}

/** Single-platform version, for chasing one straggler. */

// ---------------------------------------------------------------- SEND

/** Always a draft, never a send. Someone reads it before the client does. */

/** Moves touched tasks to Requested and stamps the date. */
function markRequested_(clientId, taskNames) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.ACCESS);
  if (sh.getLastRow() < 2) return;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, A.WIDTH).getValues();
  const today = new Date();
  vals.forEach((r, i) => {
    if (r[A.ID - 1] !== clientId || taskNames.indexOf(r[A.TASK - 1]) === -1) return;
    const st = r[A.STATUS - 1];
    if (st === 'Complete' || st === 'N/A') return;
    sh.getRange(i + 2, A.STATUS).setValue('Requested');
    if (!r[A.REQUESTED - 1]) sh.getRange(i + 2, A.REQUESTED).setValue(today);
  });
}

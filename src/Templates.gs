/**
 * LOCKHERN ONBOARDING CRM — Instruction emails
 *
 * Each template is an instruction block, not a whole email. The composer
 * wraps the blocks a client actually needs into one message so we send
 * one email instead of nine.
 *
 * Merge tags: {{company}} {{contact}} {{agency}} {{alias}} {{owner}}
 *             {{mcc_id}} {{bm_id}} {{mca_id}} {{shopify_partner}}
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
  { tag: '{{alias}}', means: 'The client email alias we ask them to grant' },
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
`We'll send a manager account invitation from {{agency}} (manager ID {{mcc_id}}).

1. Send us your Google Ads Customer ID — top right of the account, formatted xxx-xxx-xxxx.
2. Watch for the invitation, then go to Admin → Access and security → Managers.
3. Accept the request from {{mcc_id}}.

We ask for Admin so we can manage billing-adjacent settings and conversion tracking. If that's a problem, Standard works for everything except billing.

You keep ownership of the account throughout. Removing us later is one click from the same screen.`
  },

  'Microsoft Ads': {
    subject: 'Microsoft Advertising access — {{company}}',
    body:
`1. Send us your Microsoft Advertising Account ID or Customer ID — Settings → Accounts.
2. We'll send a link request from our agency account.
3. Approve it under Settings → Account access → Requests.

If you don't have a Microsoft Ads account yet, tell us and we'll create one under our agency and transfer ownership to you.`
  },

  'Meta Ads': {
    subject: 'Meta ad account access — {{company}}',
    body:
`This runs through Business Manager, so we never need your personal login.

1. Send us your Business Manager ID — business.facebook.com → Business settings → Business info.
2. We'll send a partner request from {{agency}} (partner ID {{bm_id}}).
3. Go to Business settings → Partners → and approve the request.
4. Assign us the ad account with Manage campaigns, plus the pixel and catalog if you have them.

If your ad account isn't inside a Business Manager yet, that's the first step — you'll want it there regardless of who runs the account.`
  },

  'Meta / Instagram Organic': {
    subject: 'Facebook Page and Instagram access — {{company}}',
    body:
`Same partner request as the ad account, so if you've already approved us there, this is just an asset assignment.

1. Business settings → Partners → {{agency}}.
2. Assign the Facebook Page with Content and Community activity access.
3. Instagram access follows the Page — confirm the IG account is connected under Business settings → Accounts → Instagram accounts.

Send us the Instagram handle so we can verify we're pointed at the right profile. We don't need the Instagram password.`
  },

  'Google Merchant Center': {
    subject: 'Merchant Center access — {{company}}',
    body:
`1. Send us your Merchant ID — top right of Merchant Center.
2. We'll send a link request from our multi-client account ({{mca_id}}).
3. Approve it under Settings → Account access, or Settings → Multi-client account.

If you'd rather add us as a user instead of linking accounts, add {{alias}} as Admin under Settings → People and access. Linking is cleaner but either works.`
  },

  'Shopify': {
    subject: 'Shopify collaborator access — {{company}}',
    body:
`We request access as a collaborator, which doesn't use one of your staff seats.

1. Go to Settings → Users → Security and find your collaborator request code (4 digits). Send it to us along with your store URL.
2. We'll send the request from {{shopify_partner}}.
3. Approve it under Settings → Users → Collaborators.

Permissions we need: Products, Orders, Online Store, Apps, and Settings. If you'd rather start narrower, Products and Online Store unblock the feed work and we can ask for the rest later.

If you have collaborator requests locked to a code you'd rather not share, you can disable the code requirement temporarily instead.`
  },

  'Google Analytics (GA4)': {
    subject: 'Google Analytics access — {{company}}',
    body:
`1. Open analytics.google.com and select the {{company}} property.
2. Admin → Property access management → the + button, top right.
3. Add {{alias}} with the Administrator role.
4. Leave "Notify new users by email" checked.

Administrator lets us create conversions, audiences, and the Google Ads link. If your policy caps us at Editor, everything works except managing other users.

Also send us the Property ID (Admin → Property details, a 9-digit number).`
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
    subject: 'Search Console access — {{company}}',
    body:
`1. Open search.google.com/search-console and select the {{company}} property.
2. Settings → Users and permissions → Add user.
3. Add {{alias}} as a Full user.

Full covers everything we need day to day. If we need to submit a change of address or manage other users later, we'll ask for Owner then.

If the property is a URL-prefix property rather than a domain property, let us know — we may recommend adding the domain property so we see all subdomains and protocols.`
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
    subject: 'Reddit brand account access — {{company}}',
    body:
`Reddit doesn't support delegated access for regular accounts, so this depends on what you're running:

If you have a brand account: share the credentials through a password manager — 1Password, Bitwarden, or LastPass all have a secure share link. Please don't email or Slack them.

If you moderate a subreddit: add {{alias}}'s Reddit username as a moderator under Mod Tools → User Management → Moderators. Send us the subreddit and we'll send the username.

Either way, turn on two-factor and give us a recovery path that doesn't run through one person's phone.`
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

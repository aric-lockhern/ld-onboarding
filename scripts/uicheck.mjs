/**
 * Renders src/App.html in a real browser with google.script.run stubbed out,
 * so the layout can actually be looked at. Apps Script has no local runtime;
 * this exercises the client half only — every server function is faked.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const SRC = 'src/App.html';
const OUT = process.env.UICHECK_OUT || '.uicheck';
mkdirSync(OUT, { recursive: true });

const FAKE = {
  verifyPin: { ok: true, token: 'fake-token' },
  getDashboardOverview: {
    totals: { clients: 6, overdue: 2, blocked: 1, stale: 2 },
    clients: [
      { clientId:'HARBOR-2608', company:'Harbor & Sons', status:'Access Pending', owner:'Drake',
        done:4, total:14, pct:29, overdue:3, blocked:0, waiting:2, daysWaiting:9 },
      { clientId:'NOVAPE-2608', company:'Nova Pet Co', status:'Auditing', owner:'Priya',
        done:9, total:16, pct:56, overdue:1, blocked:1, waiting:1, daysWaiting:3 },
      { clientId:'VERITY-2607', company:'Verity Outdoors', status:'Building', owner:'Drake',
        done:13, total:15, pct:87, overdue:0, blocked:0, waiting:1, daysWaiting:6 },
      { clientId:'ALDER-2607', company:'Alderwood Interiors', status:'Intake', owner:'Priya',
        done:1, total:12, pct:8, overdue:0, blocked:0, waiting:0, daysWaiting:null },
      { clientId:'KESTRL-2606', company:'Kestrel Cycles', status:'Live', owner:'Justin',
        done:15, total:15, pct:100, overdue:0, blocked:0, waiting:0, daysWaiting:null },
      { clientId:'OLDCO-2601', company:'Oldco Retail', status:'Churned', owner:'Drake',
        done:12, total:12, pct:100, overdue:0, blocked:0, waiting:0, daysWaiting:null }
    ]
  },
  getSendQueue: {
    ready: [
      { clientId:'NOVAPE-2608', company:'Nova Pet Co', owner:'Priya', phase:2,
        phaseName:'Client Requests', count:7 }
    ],
    waiting: [
      { clientId:'HARBOR-2608', company:'Harbor & Sons', owner:'Drake', phase:2,
        phaseName:'Client Requests', count:5, days:9 },
      { clientId:'VERITY-2607', company:'Verity Outdoors', owner:'Drake', phase:3,
        phaseName:'Data & Validation', count:1, days:6 }
    ],
    gated: [
      { clientId:'ALDER-2607', company:'Alderwood Interiors', owner:'Priya', phase:1,
        phaseName:'Internal Setup', count:9,
        reasons:['Lockhern email alias not complete','Google Drive folder not complete'] }
    ],
    blocked: [
      { clientId:'KESTRL-2606', company:'Kestrel Cycles', owner:'Justin', phase:2,
        phaseName:'Client Requests', count:3,
        problems:['No contact email on the client record','Config: Google Ads MCC ID is empty'] }
    ]
  },
  getClientDetail: {
    client: { clientId:'HARBOR-2608', company:'Harbor & Sons', status:'Access Pending',
      owner:'Drake', cadence:'Weekly', billing:'Client card on account', call:'Scheduled',
      slack:'#harbor-sons', alias:'harborandsons@lockherndigital.com',
      approvals:'dana@harborandsons.com', term:'Month to month',
      bizType:'eCommerce', onboarding:'Not started', draftId:'DR-260810-1612',
      profile:'Family business, second generation, and they say so within the first minute — it is how they want to be seen and it shapes what they will sign off.\n\n## Communication\nShort replies, often from a phone, usually within the hour. Dana asks one question at a time and expects one answer. Long strategy emails go unread; a two-line summary with the number in it gets a response.\n\n## What they care about\n- Margin over revenue. They stopped the last agency for "buying sales we lost money on"\n- Being able to explain the spend to their father, who still signs the cheques\n- Lead times on custom pieces — a spike they cannot fulfil is worse than no spike\n\n## What will annoy them\n- Jargon. Dana asked twice what ROAS meant and then stopped asking\n- Being sold something mid-contract. The previous agency upsold in month two\n- Reporting that leads with impressions\n\n## Decisions\nDana decides day to day up to about £2k. Anything above that waits for her father, which usually means a week.\n\n## Where to pitch it\nCommercially sharp, technically light. They understand margin and stock better than anyone on our side; they do not know what a negative keyword is and do not need to.\n\n## In their words\n- "We are not trying to be the cheapest, we are trying to be the one people trust" — brand safety matters more than volume here\n- "Just tell me what it made us" — lead every report with revenue and margin',
      services:'Google Ads, Reddit Ads, AI Search SEO',
      scope:'Google Ads, Meta, GA4 and Merchant Center. Feed rebuild in month two.',
      drive:'https://drive.google.com/drive/folders/fake',
      fees:[{label:'Google Ads',amount:6000},{label:'Reddit Ads',amount:2000},
            {label:'AI Search SEO',amount:2000},{label:'Bundle discount',amount:-4000}] },
    statuses:['Not started','Info needed','Requested','Complete','Blocked','N/A'],
    terms:['Month to month','3 months','6 months','12 months','Custom'],
    bizTypes:['Lead Gen','eCommerce'],
    cadences:['Weekly','Biweekly','Monthly','Quarterly','Ad hoc'],
    serviceList:[],
    summary:{ done:4, total:14, pct:29 },
    commitments:[],
    phaseState:{ current:2, complete:false, phases:[
      {phase:1,name:'Internal Setup'},{phase:2,name:'Client Requests'},
      {phase:3,name:'Data & Validation'},{phase:4,name:'Launch'},{phase:5,name:'Steady State'}]},
    tasks:[
      {task:'Lockhern email alias',phase:1,gate:true,status:'Complete',method:'INTERNAL'},
      {task:'Google Drive folder',phase:1,gate:true,status:'Complete',method:'INTERNAL'},
      {task:'ClickUp space',phase:1,gate:false,status:'Complete',method:'INTERNAL'},
      {task:'Client Slack channel',phase:1,gate:false,status:'Complete',method:'INTERNAL'},
      {task:'Google Ads',phase:2,gate:true,status:'Requested',method:'API'},
      {task:'Meta Ads',phase:2,gate:true,status:'Requested',method:'API'},
      {task:'Google Analytics (GA4)',phase:2,gate:true,status:'Not started',method:'EMAIL'},
      {task:'Media billing setup',phase:2,gate:true,status:'Blocked',method:'EMAIL'},
      {task:'Brand assets and constraints',phase:2,gate:false,status:'Not started',method:'EMAIL'},
      {task:'Baseline performance snapshot',phase:3,gate:true,status:'Not started',method:'INTERNAL'},
      {task:'Conversion tracking validated',phase:3,gate:true,status:'Not started',method:'INTERNAL'},
      {task:'Kickoff call',phase:4,gate:true,status:'Not started',method:'INTERNAL'},
      {task:'First report delivered',phase:5,gate:false,status:'Not started',method:'INTERNAL'},
      {task:'30-day client check-in',phase:5,gate:false,status:'Not started',method:'INTERNAL'}
    ]
  },
  hasClickUpToken: true,
  buildClientProfile: { ok:true, sources:['Sales call transcript','Onboarding / kickoff call transcript'],
    profile:'Family business, second generation. Short replies, expects the number first.' },
  getClientProfile: { ok:true, profile:'' },
  getTeam: [],
  getClientDocs: { ok:true, folderUrl:'https://drive.google.com/drive/folders/fake',
    docs:[
      { key:'sales', label:'Sales call transcript', name:'sales-call-07-16.html',
        words:3075, read:'11 Aug, 10:07', url:'https://drive.google.com/file/d/x/view' },
      { key:'sow', label:'Scope of work', name:'Signed SOW 8.3.26.pdf',
        words:2518, read:'11 Aug, 10:54', url:'https://drive.google.com/file/d/y/view' },
      { key:'deck', label:'Pitch deck', name:'Strategy deck.pdf', words:2979,
        read:'11 Aug, 10:08', gone:true, url:'' }
    ] },
  deleteClient: { ok:true, clientId:'HARBOR-2608', draftFreed:'DR-260810-1612',
    removed:{ tasks:14, intake:1, plans:0 } },
  createDraft: { ok:true, draftId:'DR-260811-0930', name:'Harbor & Sons SOW', folderId:'fake-folder' },
  saveDraft: { ok:true, saved:'11 Aug, 09:41' },
  deleteDraft: { ok:true },
  renameDraft: { ok:true },
  openDraft: { ok:true, draftId:'DR-260810-1612', name:'Harbor & Sons',
    status:'Analysed', clientId:'', folderId:'fake-folder',
    folderUrl:'https://drive.google.com/drive/folders/fake', updated:'10 Aug, 16:12',
    missing:['Pitch deck'],
    // A form saved before the fee table could be read. This blank row must NOT
    // mask the extraction's fees — both [] and [{label:'',amount:0}] are truthy,
    // which is how a saved blank used to hide every later reading permanently.
    form:{ company:'Harbor & Sons', fees:[{label:'',amount:0}], services:[], platforms:[] },
    sources:[
      { key:'sales', label:'Sales call transcript', via:'ClickUp doc', origin:'https://doc.clickup.com/x',
        fileId:'file_stub_sales', chars:48210, words:8609, read:'10 Aug, 16:04',
        preview:'Aric: Great, so Harbor and Sons — you are the family furniture business out of Leeds' },
      { key:'sow', label:'Scope of work', via:'Upload · harbor-sow.pdf', originalName:'harbor-sow.pdf',
        originalId:'orig_stub_sow', originalMime:'application/pdf',
        fileId:'file_stub_sow', chars:9140, words:1602, read:'10 Aug, 16:06',
        preview:'SCOPE OF WORK — Harbor & Sons Ltd and Lockhern Digital. Term commences 1 September 2026' },
      { key:'deck', label:'Pitch deck', via:'Google Slides', fileId:'file_stub_deck',
        chars:3100, words:520, gone:true, preview:'' }
    ] },
  listDrafts: { ok:true, drafts:[
    { draftId:'DR-260810-1612', name:'Harbor & Sons', updated:'10 Aug, 16:12',
      updatedAt:2, status:'Analysed', clientId:'', sourceCount:3, analysed:true },
    { draftId:'DR-260807-0904', name:'Verity Outdoors', updated:'7 Aug, 09:04',
      updatedAt:1, status:'Submitted', clientId:'VERITY-2607', sourceCount:2, analysed:true }
  ] },
  runExtraction: {
    ok:true,
    sourcesUsed:['Sales call transcript','Scope of work','ClickUp onboarding form'],
    problems:[],
    fields:{
      company:{value:'Harbor & Sons',confidence:'high',quote:'Great, so Harbor and Sons — we are the family furniture business out of Leeds.',source:'Sales call transcript'},
      contact:{value:'Dana Whitfield',confidence:'high',quote:'Dana will be your day to day.',source:'Sales call transcript'},
      email:{value:'dana@harborandsons.com',confidence:'medium',quote:'best email is dana@harborandsons.com',source:'Sales call transcript'},
      website:{value:'https://harborandsons.com',confidence:'high',quote:'the site is harborandsons.com',source:'Scope of work'},
      vertical:{value:'Home & furniture retail',confidence:'medium',quote:'family furniture business',source:'Sales call transcript'},
      mrr:{value:8000,confidence:'high',quote:'Management fee of £8,000 per calendar month.',source:'Scope of work'},
      contractStart:{value:'2026-09-01',confidence:'high',quote:'Term commences 1 September 2026.',source:'Scope of work'},
      cadence:{value:'Weekly',confidence:'high',quote:'weekly check-in on Tuesdays',source:'Onboarding / kickoff call transcript'},
      term:{value:'Month to month',confidence:'high',quote:'This agreement runs month to month.',source:'Scope of work'},
      bizType:{value:'eCommerce',confidence:'medium',quote:'they sell direct from the site',source:'Sales call transcript'},
      approvals:{value:'Dana Whitfield',confidence:'medium',quote:'Dana signs off creative',source:'Onboarding / kickoff call transcript'},
      scope:{value:'Paid search and paid social management across Google Ads and Meta, plus Merchant Center feed management. Includes GA4 and GTM measurement setup and a monthly performance report.',confidence:'high',quote:'Services: management of Google Ads, Meta Ads and Google Merchant Center.',source:'Scope of work'}
    },
    // Deliberately NO Google Merchant Center: an eCommerce client must get one
    // from the business-type rule, not because a document happened to name it.
    platforms:{value:['Google Ads','Meta Ads','Google Analytics (GA4)','Google Tag Manager'],confidence:'high',quote:'Services: management of Google Ads, Meta Ads and Google Merchant Center.',source:'Scope of work'},
    services:{value:['Google Ads','Reddit Ads','AI Search SEO','Reddit Organic Social'],confidence:'high',quote:'SERVICE / MONTHLY INVESTMENT — Google Ads, Reddit, AI Search SEO',source:'Pitch deck'},
    fees:{value:[{label:'Google Ads',amount:6000},{label:'Reddit Ads',amount:2000},{label:'AI Search SEO',amount:2000},{label:'Bundle discount',amount:-4000}],confidence:'high',quote:'TOTAL $10,000.00 · BUNDLE DISCOUNT -$4,000.00 · TOTAL AFTER BUNDLE DISCOUNT $6,000.00',source:'Pitch deck'},
    attached:['Scope of work'],
    unmatchedServices:[{name:'Podcast sponsorship placement',source:'Scope of work',
      quote:'Agency will negotiate and place two podcast sponsorship reads per month.'}],
    conflicts:[{field:'mrr',note:'The sales call promised a lower rate than the signed scope of work.',
      a:{source:'Sales call transcript',quote:'we can do it for about six and a half'},
      b:{source:'Scope of work',quote:'Management fee of £8,000 per calendar month.'}}],
    openQuestions:['Who owns the Merchant Center account today — the client or their previous agency?','Is there an existing GA4 property, or does one need creating?','What is the restricted-claims list for furniture safety wording?']
  },
  getIntakeOptions: {
    cadences:['Weekly','Biweekly','Monthly','Quarterly','Ad hoc'],
    terms:['Month to month','3 months','6 months','12 months','Custom'],
    bizTypes:['Lead Gen','eCommerce'],
    bizPlatforms:{ 'ecommerce':['Google Merchant Center'] },
    services:[
      {name:'Google Ads',category:'Paid',platforms:['Google Ads','Google Analytics (GA4)','Google Tag Manager'],fee:6000},
      {name:'Microsoft Ads',category:'Paid',platforms:['Microsoft Ads'],fee:1500},
      {name:'Meta Ads',category:'Paid',platforms:['Meta Ads','Meta / Instagram Organic'],fee:3000},
      {name:'Meta Organic Social',category:'Organic',platforms:['Meta / Instagram Organic'],fee:2000},
      {name:'Reddit Organic Social',category:'Organic',platforms:['Reddit Organic'],fee:2000},
      {name:'Reddit Ads',category:'Paid',platforms:['Reddit Ads','Reddit Organic'],fee:2000},
      {name:'AI Search SEO',category:'Organic',platforms:['Google Search Console','WordPress'],fee:2000},
      {name:'Google Business Profile',category:'Local',platforms:['Google Business Profile'],fee:750},
      {name:'Landing Page',category:'Build',platforms:['WordPress','Google Tag Manager'],fee:1500},
      {name:'Web Design',category:'Build',platforms:['WordPress'],fee:2500}
    ] },
  getPlatformList: [
    {name:'Google Ads',category:'Paid',method:'API'},
    {name:'Microsoft Ads',category:'Paid',method:'API'},
    {name:'Meta Ads',category:'Paid',method:'API'},
    {name:'Meta / Instagram Organic',category:'Organic',method:'API'},
    {name:'Google Merchant Center',category:'Feed',method:'API'},
    {name:'Shopify',category:'Platform',method:'SEMI-API'},
    {name:'Google Analytics (GA4)',category:'Measurement',method:'EMAIL'},
    {name:'Google Tag Manager',category:'Measurement',method:'EMAIL'},
    {name:'Google Search Console',category:'Organic',method:'EMAIL'},
    {name:'Klaviyo',category:'Email',method:'EMAIL'},
    {name:'TikTok Ads',category:'Paid',method:'EMAIL'},
    {name:'WordPress',category:'Platform',method:'EMAIL'}
  ],
  dashPreview: { ok:true, to:'dana@harborandsons.com',
    subject:'Harbor & Sons — access we need to get started',
    body:'Hi Dana,\n\nTo get started we need access to a few platforms. Please grant access to harborandsons@lockherndigital.com — an alias, not a person, so this survives staffing changes.\n\nGOOGLE ADS\nAdd harborandsons@lockherndigital.com...' }
};

// A reopened draft carries the last extraction, which is what puts "Use the
// last analysis" beside "Re-analyse" instead of a bare Analyse button.
FAKE.openDraft.extraction = FAKE.runExtraction;

// Each withXHandler must return an INDEPENDENT runner, the way Apps Script
// does — a single shared handler slot breaks any two concurrent calls, which
// is exactly what Promise.all does.
//
// Some responses depend on their arguments, and functions do not survive
// JSON.stringify, so they are injected as source afterwards. readSource is the
// one that matters: it has to be able to fail, or the failure row — the whole
// reason the reading step exists — never gets rendered.
const stub = `<script>
(function(){
  var FAKE = ${JSON.stringify(FAKE)};
  var DELAY = { runExtraction: 900 };

  // The server refuses to save against a draft that no longer exists, and the
  // client is supposed to start a fresh one and read again. Modelling the draft
  // lifecycle here is what makes that recovery testable — deleting the draft you
  // are inside used to leave every subsequent source failing on save.
  var LIVE = null, SEQ = 0;
  var STATIC_OPEN = FAKE.openDraft;
  FAKE.createDraft = function(name){
    LIVE = 'DR-stub-' + (++SEQ);
    return { ok:true, draftId:LIVE, name:name || 'Untitled draft', folderId:'fake-folder' };
  };
  FAKE.deleteDraft = function(id){ if (id === LIVE) LIVE = null; return { ok:true }; };
  FAKE.openDraft = function(id){ LIVE = id; return STATIC_OPEN; };

  // A ClickUp link fails the way the real one does; pasted text succeeds. That
  // is the actual recovery path, so the harness walks it.
  FAKE.readSource = function(key, raw, draftId){
    if (!draftId || draftId !== LIVE){
      return { ok:false, draftGone:true, key:key, via:'',
               error:'The draft this was being saved to no longer exists.',
               hint:'Retry — a new draft will be started automatically.' };
    }
    var isLink = typeof raw === 'string' && /^https?:/.test(raw);
    var label = { sales:'Sales call transcript', kickoff:'Onboarding / kickoff call transcript',
                  sow:'Scope of work', form:'ClickUp onboarding form', deck:'Pitch deck' }[key] || key;
    if (isLink && key === 'kickoff'){
      return { ok:false, key:key, label:label, via:'ClickUp doc',
        error:'ClickUp will not open doc h6apc-44034 for the account that owns the API '
            + 'token (403). The link you used is a share link (doc.clickup.com/…/d/h/…). '
            + 'Those open in a browser for anyone holding them, but publishing a doc does '
            + 'not grant API access to it. Check by opening '
            + 'https://app.clickup.com/18033356/docs/h6apc-44034 while signed in.',
        hint:'Open the doc in ClickUp, select all, and paste it in — that always works.' };
    }
    var chars = isLink ? 48210 : String(raw && raw.data ? 'x' : raw || '').length * 40 + 9100;
    return { ok:true, key:key, label:label, fileId:'file_stub_' + key,
      originalId: raw && raw.data ? 'orig_stub_' + key : '',
      originalMime: raw && raw.data ? (raw.mimeType || 'application/pdf') : '',
      via: raw && raw.data ? 'Upload · ' + raw.name : (isLink ? 'ClickUp doc' : 'Pasted text'),
      chars:chars, words:Math.round(chars / 5.6), warn:'',
      preview:'Aric: Great, so Harbor and Sons — you are the family furniture business out '
            + 'of Leeds, and you want to be running by the start of September' };
  };

  function runner(ok, no){
    return new Proxy({}, {
      get: function(_, prop){
        if (prop === 'withSuccessHandler') return function(f){ return runner(f, no); };
        if (prop === 'withFailureHandler') return function(f){ return runner(ok, f); };
        return function(){
          var data = FAKE[prop];
          if (typeof data === 'function') data = data.apply(null, arguments);
          setTimeout(function(){ ok && ok(data === undefined ? {ok:true} : data); },
                     DELAY[prop] || 30);
        };
      }
    });
  }
  window.google = { script: { get run(){ return runner(null, null); } } };
})();
</script>`;

let html = readFileSync(SRC, 'utf8');
html = html.replace('</head>', stub + '</head>');
const page_path = resolve(`${OUT}/app.rendered.html`);
writeFileSync(page_path, html);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const shots = [];

for (const [name, w, h] of [['desktop', 1280, 900], ['mobile', 430, 900]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('file://' + page_path);
  await page.fill('#pin', '1234');
  await page.press('#pin', 'Enter');
  await page.waitForSelector('#app.on', { timeout: 5000 });

  for (const view of ['overview', 'queue', 'clients', 'new']) {
    // "New client" is the header CTA, not a sidebar item.
    await page.click(view === 'new' ? '#newBtn' : `nav button[data-v="${view}"]`);
    await page.waitForTimeout(250);
    const f = `${OUT}/${name}-${view}.png`;
    await page.screenshot({ path: f, fullPage: name === 'desktop' });
    shots.push(f);

    // The new-client flow is two screens; step 2 is where the extraction lands.
    if (view === 'new') {
      // Two ClickUp links: one resolves, one 403s. The failure row is the point.
      await page.fill('#src_sales', 'https://doc.clickup.com/18033356/d/h/h6apc-42354/f4aa');
      await page.fill('#src_kickoff', 'https://doc.clickup.com/18033356/d/h/h6apc-44034/b21c');
      await page.click('#analyse');
      await page.waitForSelector('#rrow_kickoff.fail', { timeout: 5000 });
      await page.waitForTimeout(200);
      const fRead = `${OUT}/${name}-new-reading.png`;
      await page.screenshot({ path: fRead, fullPage: name === 'desktop' });
      shots.push(fRead);

      // Recover the failed one by pasting the transcript in, as the hint says.
      await page.click('[data-fix="kickoff"]');
      await page.fill('#fixtx_kickoff', 'Dana: right, so weekly on Tuesdays works for us. '.repeat(60));
      await page.click('[data-fixgo="kickoff"]');
      await page.waitForSelector('#rrow_kickoff.ok', { timeout: 5000 });
      await page.waitForTimeout(200);
      const fFixed = `${OUT}/${name}-new-recovered.png`;
      await page.screenshot({ path: fFixed, fullPage: name === 'desktop' });
      shots.push(fFixed);

      // The analysing state, caught mid-flight via the stub's deliberate delay.
      await page.click('#goAnalyse');
      await page.waitForSelector('.thinking', { timeout: 3000 });
      await page.waitForTimeout(150);
      const fThink = `${OUT}/${name}-new-analysing.png`;
      await page.screenshot({ path: fThink, fullPage: name === 'desktop' });
      shots.push(fThink);

      await page.waitForSelector('#submit', { timeout: 8000 });
      await page.waitForTimeout(250);
      const f2 = `${OUT}/${name}-new-review.png`;
      await page.screenshot({ path: f2, fullPage: name === 'desktop' });
      shots.push(f2);

      // An eCommerce client needs a Merchant Center for Shopping and PMax. No
      // document named one here, so this tick can only come from bizType.
      const mcTicked = await page.$eval(
        '.checks .chk input[value="Google Merchant Center"]:not([data-service])',
        function(i){ return i.checked; });
      if (!mcTicked) {
        throw new Error('eCommerce did not pull in Google Merchant Center');
      }

      // Reopening a stored draft: sources come back already read, one of them
      // with its Drive copy deleted, so the failure row renders from storage.
      // The header CTA is hidden while the intake view is open, so leave first.
      await page.click('nav button[data-v="clients"]');
      await page.waitForTimeout(200);
      await page.click('#newBtn');
      await page.waitForSelector('[data-open]', { timeout: 5000 });
      const fDrafts = `${OUT}/${name}-new-drafts.png`;
      await page.screenshot({ path: fDrafts, fullPage: name === 'desktop' });
      shots.push(fDrafts);

      await page.click('[data-open="DR-260810-1612"]');
      await page.waitForSelector('#rrow_sales.ok', { timeout: 5000 });
      await page.waitForTimeout(250);
      const fResume = `${OUT}/${name}-new-resumed.png`;
      await page.screenshot({ path: fResume, fullPage: name === 'desktop' });
      shots.push(fResume);

      // Regression: the resumed draft carries a saved form whose fees are one
      // blank row. Taking the stored analysis must still show the extraction's
      // four fee lines — a truthy empty array used to hide them for good.
      await page.click('#useLast');
      await page.waitForSelector('#feeRows', { timeout: 5000 });
      const feeLabels = await page.$$eval('#feeRows .fl', function(els){
        return els.map(function(e){ return e.value; }).filter(Boolean);
      });
      if (feeLabels.length < 4) {
        throw new Error('Saved blank fees masked the extraction: got '
          + JSON.stringify(feeLabels));
      }
      const fUnmasked = `${OUT}/${name}-new-fees-unmasked.png`;
      await page.screenshot({ path: fUnmasked, fullPage: name === 'desktop' });
      shots.push(fUnmasked);
      await page.click('#backSrc');
      await page.waitForSelector('#rlist', { timeout: 5000 });

      // Regression: delete the draft you are currently inside, then start over.
      // The open handle used to survive the delete, so every source afterwards
      // was fetched in full and then failed on save with "That draft no longer
      // exists". A fresh draft must be started instead.
      await page.click('#backSrc');
      await page.waitForSelector('[data-del="DR-260810-1612"]', { timeout: 5000 });
      await page.click('[data-del="DR-260810-1612"]');   // arms
      await page.click('[data-del="DR-260810-1612"]');   // confirms
      await page.waitForTimeout(300);
      await page.fill('#src_sales', 'Aric: right, let us get started. '.repeat(40));
      await page.click('#analyse');
      await page.waitForSelector('#rrow_sales.ok', { timeout: 6000 });
      await page.waitForTimeout(200);
      const fAfterDel = `${OUT}/${name}-new-after-delete.png`;
      await page.screenshot({ path: fAfterDel, fullPage: name === 'desktop' });
      shots.push(fAfterDel);
    }
  }

  // Client detail, reached by clicking a row on the clients list
  await page.click('nav button[data-v="clients"]');
  await page.waitForTimeout(250);
  await page.click('.row.clickable');
  await page.waitForTimeout(350);
  const f = `${OUT}/${name}-detail.png`;
  await page.screenshot({ path: f, fullPage: name === 'desktop' });
  shots.push(f);

  console.log(`${name}: ${errors.length ? errors.join('\n  ') : 'no JS errors'}`);
  await page.close();
}

await browser.close();
console.log('\nScreenshots:\n' + shots.join('\n'));

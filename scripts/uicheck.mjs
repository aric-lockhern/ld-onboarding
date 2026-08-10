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
      bizType:'eCommerce', onboarding:'Not started',
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
  extractIntake: {
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
    platforms:{value:['Google Ads','Meta Ads','Google Merchant Center','Google Analytics (GA4)','Google Tag Manager'],confidence:'high',quote:'Services: management of Google Ads, Meta Ads and Google Merchant Center.',source:'Scope of work'},
    services:{value:['Google Ads','Reddit Ads','AI Search SEO'],confidence:'high',quote:'SERVICE / MONTHLY INVESTMENT — Google Ads, Reddit, AI Search SEO',source:'Pitch deck'},
    fees:{value:[{label:'Google Ads',amount:6000},{label:'Reddit Ads',amount:2000},{label:'AI Search SEO',amount:2000},{label:'Bundle discount',amount:-4000}],confidence:'high',quote:'TOTAL $10,000.00 · BUNDLE DISCOUNT -$4,000.00 · TOTAL AFTER BUNDLE DISCOUNT $6,000.00',source:'Pitch deck'},
    conflicts:[{field:'mrr',note:'The sales call promised a lower rate than the signed scope of work.',
      a:{source:'Sales call transcript',quote:'we can do it for about six and a half'},
      b:{source:'Scope of work',quote:'Management fee of £8,000 per calendar month.'}}],
    openQuestions:['Who owns the Merchant Center account today — the client or their previous agency?','Is there an existing GA4 property, or does one need creating?','What is the restricted-claims list for furniture safety wording?']
  },
  getIntakeOptions: {
    cadences:['Weekly','Biweekly','Monthly','Quarterly','Ad hoc'],
    terms:['Month to month','3 months','6 months','12 months','Custom'],
    bizTypes:['Lead Gen','eCommerce'],
    services:[
      {name:'Google Ads',category:'Paid',platforms:['Google Ads','Google Analytics (GA4)','Google Tag Manager'],fee:6000},
      {name:'Microsoft Ads',category:'Paid',platforms:['Microsoft Ads'],fee:1500},
      {name:'Meta Ads',category:'Paid',platforms:['Meta Ads','Meta / Instagram Organic'],fee:3000},
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

// Each withXHandler must return an INDEPENDENT runner, the way Apps Script
// does — a single shared handler slot breaks any two concurrent calls, which
// is exactly what Promise.all does.
const stub = `<script>
(function(){
  var FAKE = ${JSON.stringify(FAKE)};
  function runner(ok, no){
    return new Proxy({}, {
      get: function(_, prop){
        if (prop === 'withSuccessHandler') return function(f){ return runner(f, no); };
        if (prop === 'withFailureHandler') return function(f){ return runner(ok, f); };
        return function(){
          var data = FAKE[prop];
          setTimeout(function(){ ok && ok(data === undefined ? {ok:true} : data); }, 30);
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
      await page.fill('#src_sales', 'https://doc.clickup.com/18033356/d/h/h6apc-42354/f4aa');
      await page.click('#analyse');
      await page.waitForSelector('#submit', { timeout: 5000 });
      await page.waitForTimeout(250);
      const f2 = `${OUT}/${name}-new-review.png`;
      await page.screenshot({ path: f2, fullPage: name === 'desktop' });
      shots.push(f2);
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

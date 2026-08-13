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
      contact:'Dana Whitlock', email:'dana@harborandsons.com',
      website:'harborandsons.com', vertical:'Bespoke joinery, trade and D2C',
      contractStart:'1 Aug 2026', mrr:6000,
      owner:'Drake', cadence:'Weekly', billing:'Client card on account', call:'Scheduled',
      slack:'#harbor-sons', alias:'harborandsons@lockherndigital.com',
      approvals:'dana@harborandsons.com', term:'Month to month',
      bizType:'eCommerce', onboarding:'Not started', draftId:'DR-260810-1612',
      profile:'Dana Whitlock is the second-generation owner of Harbor & Sons, a 40-year-old joinery outside Bristol that moved into direct online sales four years ago. She runs about \u00a318k/month of paid media, wants to be told what it made rather than how it works, and left the last agency for buying revenue at a loss. Servicing her well means margin-first reporting, short written answers, and never surprising her father.\n\n## Communication\nShort replies, often from a phone, usually within the hour. Dana asks one question at a time and expects one answer. Long strategy emails go unread \u2014 a two-line summary with the number in it gets a response the same day. She is warm on calls and will happily talk about the workshop, but read brevity as her working style rather than displeasure. She has said twice she would rather have a five-minute call than a written update.\n\n## What they care about\n- Margin over revenue. They stopped the last agency for "buying sales we lost money on" and she repeats the phrase unprompted. Every recommendation needs a margin line, not a ROAS line.\n- Being able to explain the spend to her father, who still signs the cheques. He is not on any call and has never seen a dashboard, so whatever we send has to survive being read aloud.\n- Lead times on custom pieces. A spike they cannot fulfil is worse than no spike \u2014 the workshop runs six weeks out in spring and she will pull budget rather than sell a date she cannot hit.\n- Made-in-Britain as the actual differentiator, not a tagline. Two competitors moved production abroad and she tracks their pricing weekly.\n- Repeat trade customers over one-off consumer sales, because the trade side pays on time.\n\n## What will annoy them\n- Jargon. Dana asked twice what ROAS meant and then stopped asking, which is the signal \u2014 she does not ask a third time, she just disengages.\n- Being sold something mid-contract. The previous agency upsold in month two and she has mentioned it on both calls since.\n- Reporting that leads with impressions. She has said "that is not money" about a slide.\n- Anything that costs her time she has already spent. She filled in the brief twice for the last agency and will not do it again.\n\n## Decisions\nDana decides day to day up to about \u00a32k. Anything above that waits for her father, which usually means a week \u2014 so bring the big asks early and never as a deadline. She is the only contact and the only person on any call. There is no marketing team behind her.\n\n## Where to pitch it\nCommercially sharp, technically light. She understands margin, stock and lead time better than anyone on our side; she does not know what a negative keyword is and does not need to. Explain tactics as outcome and cost. She is fluent on her own market \u2014 she knew which competitor had moved production and what it did to their pricing.\n\n## Context\n- Severely seasonal: spring is the peak and the workshop is capacity-bound through it.\n- Four-year-old D2C arm on top of a 40-year trade business; the trade side still pays the bills.\n- Referred in by an existing client, so a bad outcome here travels further than usual.\n\n## In their words\n- "We are not trying to be the cheapest, we are trying to be the one people trust" \u2014 brand safety matters more than volume here, and discount-led angles will be refused.\n- "Just tell me what it made us" \u2014 lead every report with revenue and margin, in that order.\n- "I have to be able to explain this to my dad" \u2014 the real audience for every number we send is someone who has never seen the account.\n- "That is not money" \u2014 said about an impressions slide. Vanity metrics actively cost credibility here.',
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
    // Skills are what rank people against a task. Drake covers the paid-search
    // rows, Jamie the measurement ones, and Dana is the client — a third of the
    // checklist is access we are waiting on THEM for, which is a different
    // state from nobody having picked it up.
    assignees:[
      { name:'Drake King', role:'Specialist', kind:'team',
        skills:['Paid search','Google Ads','Google Merchant Center'] },
      { name:'Alexandra McCurdy', role:'Strategist', kind:'team',
        skills:['Organic social','Reddit Organic Social'] },
      { name:'Jamie Okonkwo', role:'Analyst', kind:'team',
        skills:['Analytics and tracking','Google Analytics 4'] },
      { name:'Dana Whitlock', role:'Client contact', kind:'client', skills:[] }
    ],
    phaseState:{ current:2, complete:false, phases:[
      {phase:1,name:'Internal Setup'},{phase:2,name:'Client Requests'},
      {phase:3,name:'Data & Validation'},{phase:4,name:'Launch'},{phase:5,name:'Steady State'}]},
    tasks:[
      {task:'Lockhern email alias',phase:1,gate:true,status:'Complete',method:'INTERNAL'},
      {task:'Google Drive folder',phase:1,gate:true,status:'Complete',method:'INTERNAL'},
      {task:'ClickUp space',phase:1,gate:false,status:'Complete',method:'INTERNAL'},
      {task:'Client Slack channel',phase:1,gate:false,status:'Complete',method:'INTERNAL'},
      {task:'Google Ads',phase:2,gate:true,status:'Requested',method:'API',
       category:'Paid search',owner:'Drake King',assigned:'2 Aug 2026',assignedDays:9},
      {task:'Meta Ads',phase:2,gate:true,status:'Requested',method:'API',
       category:'Paid social',owner:'',assigned:'',assignedDays:0},
      {task:'Google Analytics (GA4)',phase:2,gate:true,status:'Not started',method:'EMAIL',
       category:'Analytics',owner:'',assigned:'',assignedDays:0},
      // Owned by someone no longer on the team: the option has to survive, or
      // opening the dropdown silently reassigns the row to nobody.
      {task:'Media billing setup',phase:2,gate:true,status:'Blocked',method:'EMAIL',
       category:'Billing',owner:'Sasha Roe',assigned:'28 Jul 2026',assignedDays:14},
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
  hasSlackToken: true,
  slackTest: { ok:true, team:'Lockhern Digital', botUser:'onboarding-bot',
    granted:['channels:manage','groups:write','users:read','users:read.email','chat:write'],
    missing:[], scopesUnknown:false },
  slackPeople: { ok:true, people:[
    { name:'Drake King', email:'drake@lockherndigital.com', slackId:'U01DRAKE',
      role:'Paid lead', matched:true },
    { name:'Alexandra McCurdy', email:'alex@lockherndigital.com', slackId:'U01ALEX',
      role:'Social', matched:true, lookedUp:true },
    { name:'Cory Botti', email:'cory@lockherndigital.com', slackId:'',
      role:'Founder', matched:false, why:'no Slack account with that email' }
  ] },
  slackCreateChannel: { ok:true, name:'#harbor-and-sons', channelId:'C01ABC',
    invited:2, failed:[] },
  slackPingOutstanding: { ok:true, posted:7, channel:'#harbor-sons' },
  slackInvite: { ok:true, invited:2, channel:'#harbor-sons', already:false },
  slackChannels: { ok:true, channels:[
    { id:'C01GEN', name:'general', isPrivate:false, isMember:true, members:15, purpose:'' },
    { id:'C01HARB', name:'harbor-sons', isPrivate:true, isMember:true, members:6, purpose:'Harbor & Sons' },
    // Private and not joined: linkable, but the bot cannot post until invited,
    // which is a state the card has to name rather than discover on first ping.
    { id:'C01CORN', name:'cornhole-co', isPrivate:true, isMember:false, members:4, purpose:'' },
    { id:'C01PAID', name:'paid-search', isPrivate:false, isMember:false, members:11, purpose:'' }
  ] },
  slackLinkChannel: { ok:true, name:'#harbor-sons', channelId:'C01HARB',
    url:'https://slack.com/app_redirect?channel=C01HARB', joined:false, warn:'' },
  getTeamAdmin: { ok:true, slackReady:true,
    roles:['Account manager','Strategist','Specialist','Analyst','Designer','Owner','Contractor'],
    skillOptions:[
      { name:'Paid search', group:'Discipline' },
      { name:'Paid social', group:'Discipline' },
      { name:'Organic social', group:'Discipline' },
      { name:'Analytics and tracking', group:'Discipline' },
      { name:'Google Ads', group:'Service' },
      { name:'Reddit Organic Social', group:'Service' },
      { name:'Google Merchant Center', group:'Platform' },
      { name:'Google Analytics 4', group:'Platform' }
    ],
    people:[
      { row:2, name:'Drake King', email:'drake@lockherndigital.com', slackId:'U01DRAKE',
        skills:['Paid search','Google Ads','Google Merchant Center'], role:'Specialist',
        active:true, clients:['Harbor & Sons'], channels:['#harbor-sons'] },
      { row:3, name:'Alexandra McCurdy', email:'alex@lockherndigital.com', slackId:'U01ALEX',
        skills:['Organic social','Reddit Organic Social'], role:'Strategist',
        active:true, clients:[], channels:[] },
      // No specialties and no Slack ID: the two states the page exists to make
      // visible, because both silently exclude someone from being assigned.
      { row:4, name:'Cory Botti', email:'cory@lockherndigital.com', slackId:'',
        skills:[], role:'Owner', active:true, clients:[], channels:[] }
    ],
    unassignedClients:[
      { clientId:'CORNHOLE-2608', company:'Cornhole Co', owner:'' }
    ] },
  slackRoster: { ok:true, emailScopeMissing:false, people:[
    { slackId:'U01ARIC', name:'Aric Lockhern', email:'aric@lockherndigital.com',
      title:'Founder', guest:false, admin:true, onTeam:false },
    { slackId:'U01DRAKE', name:'Drake King', email:'drake@lockherndigital.com',
      title:'Paid search', guest:false, admin:false, onTeam:true },
    { slackId:'U01ALEX', name:'Alexandra McCurdy', email:'alex@lockherndigital.com',
      title:'Social', guest:false, admin:false, onTeam:true },
    { slackId:'U01JAMIE', name:'Jamie Okonkwo', email:'jamie@lockherndigital.com',
      title:'Analytics', guest:false, admin:false, onTeam:false },
    // A contractor with no email on their profile: importable by member ID,
    // and the row has to say why they cannot be matched by address.
    { slackId:'U01SAM', name:'Sam Petrov', email:'', title:'Design',
      guest:true, admin:false, onTeam:false }
  ] },
  importTeamMembers: { ok:true, added:3, skipped:[], noEmail:1 },
  saveTeamMember: { ok:true, row:5, created:true },
  deleteTeamMember: { ok:true, deactivated:false },
  assignClientOwner: { ok:true },
  syncTeamSlackIds: { ok:true, matched:1, unmatched:['Cory Botti — no Slack account for cory@lockherndigital.com'],
    scopeProblem:'' },
  getTeam: [
    { name:'Drake King', email:'drake@lockherndigital.com', slackId:'U01DRAKE',
      skills:['Google Ads','Shopping','Merchant Center'], role:'Paid lead' },
    { name:'Alexandra McCurdy', email:'alex@lockherndigital.com', slackId:'U01ALEX',
      skills:['Reddit Organic','Content','Community'], role:'Social' }
  ],
  // A reply that ran out of room is salvaged rather than thrown away — the
  // items are real, the list is short, and the card has to say which.
  buildActionItems: { ok:true, written:6, preserved:1, unassigned:1, teamEmpty:false,
    cutShort:true, trimmed:[],
    read:['Pitch deck','Sales call transcript','Onboarding / kickoff call transcript','Scope of work'],
    outOfScope:[{ item:'Launch Reddit paid amplification at $10K/month',
      why:'The deck sold it; the signed SOW covers Reddit organic only.',
      needed:'A separate Reddit Ads line and an agreed monthly budget.' }] },
  updateActionItem: { ok:true },
  assignTask: { ok:true, owner:'Jamie Okonkwo', assigned:'11 Aug 2026' },
  addTask: { ok:true, task:'Chase the dev for the theme file', phase:2 },
  getTaskLibrary: { ok:true, methods:['INTERNAL','API','SEMI-API','EMAIL','MANUAL'],
    categories:['Internal','Paid','Measurement'], bizTypes:['Lead Gen','eCommerce'],
    team:['Drake King','Alexandra McCurdy'], phases:[1,2,3,4,5],
    taskNames:['Lockhern email alias','Google Ads','Google Merchant Center',
               'Legacy Bing import','Label the Google Ads account Active'],
    tasks:[
      { row:2, task:'Lockhern email alias', category:'Internal', method:'INTERNAL',
        needs:'', how:'', lead:'Same day', offset:0, owner:'', phase:1,
        gate:true, always:true, active:true, bizType:'' },
      { row:6, task:'Google Ads', category:'Paid', method:'API',
        needs:'Customer ID', how:'AddClientLinks', lead:'1-3 days', offset:5,
        owner:'Drake King', phase:2, gate:true, always:false, active:true, bizType:'' },
      // Scoped to one business type, and switched off — the two states the
      // library exists to make editable.
      { row:9, task:'Google Merchant Center', category:'Feed', method:'API',
        needs:'Merchant ID', how:'accounts.link', lead:'1-2 days', offset:3,
        owner:'', phase:2, gate:true, always:false, active:true, bizType:'eCommerce' },
      { row:14, task:'Legacy Bing import', category:'Paid', method:'MANUAL',
        needs:'', how:'', lead:'', offset:'', owner:'', phase:2,
        gate:false, always:false, active:false, bizType:'', requires:'' },
      // Follow-on work: real, ours, and only for clients who have Google Ads.
      { row:20, task:'Label the Google Ads account Active', category:'Paid',
        method:'INTERNAL', needs:'—', how:'Manager account → Labels',
        lead:'Same day', offset:6, owner:'', phase:2, gate:false, always:false,
        active:true, bizType:'', requires:'Google Ads' }
    ] },
  saveTaskTemplate: { ok:true, row:15, created:true, task:'Shopify theme access' },
  deleteTaskTemplate: { ok:true, task:'Legacy Bing import' },
  getEmailTemplates: { ok:true,
    merge:[{ tag:'{{company}}', means:'Client company name' },
           { tag:'{{contact}}', means:'Primary contact name' },
           { tag:'{{alias}}', means:'The client email alias' }],
    moments:[
      // A template seeded before the moment existed: no row on the tab, and
      // the copy comes from the code. This is the shape the welcome email is
      // in on every installed sheet, and it used to render as an empty box.
      { key:'_welcome', label:'Welcome email', kind:'moment', row:0,
        source:'shipped',
        when:'Sent once the client record exists.', subject:'Welcome to {{agency}}!',
        body:'Hi {{contact}},\n\nThank you for choosing {{agency}}.' },
      { key:'_scope', label:'Scope confirmation', kind:'moment', row:2,
        source:'edited',
        when:'Confirms in writing what was bought.', subject:'Your scope — {{company}}',
        body:'Edited copy.' },
      { key:'_handover', label:'Handover to steady state', kind:'moment', row:0,
        source:'none', when:'Sent when onboarding closes.', subject:'', body:'' }
    ],
    tasks:[
      { key:'Google Ads', label:'Google Ads', kind:'task', row:3, source:'edited',
        when:'', subject:'Google Ads access — {{company}}', body:'Steps…' },
      { key:'Meta Ads', label:'Meta Ads', kind:'task', row:0, source:'shipped',
        when:'', subject:'Meta access — {{company}}', body:'Shipped steps…' }
    ],
    orphans:[
      { key:'Bing Ads', label:'Bing Ads', kind:'orphan', row:8, source:'edited',
        when:'No task or moment of this name — probably renamed.',
        subject:'Bing access', body:'Old copy' }
    ] },
  saveEmailTemplate: { ok:true, row:2, created:false },
  resetEmailTemplate: { ok:true },
  deleteTask: { ok:true },
  getRecentContext: { ok:true, scanned:'12 Aug 2026', scanInstalled:true,
    today:'12 Aug 2026',
    // Served by the server so the picker can never offer a kind it would
    // quietly file as something else.
    kinds:[
      { key:'call', label:'Call transcript', hint:'Listed under recent calls.' },
      { key:'audit', label:'Audit presentation',
        hint:'The default document the action items are built from.' },
      { key:'deck', label:'Pitch deck', hint:'' },
      { key:'sow', label:'Scope of work', hint:'Replaces the stored contract.' }
    ],
    calls:[
      // One filed by hand, one found by the scan. They render differently and
      // the daily scan must not evict the first.
      { key:'call_q3-planning-call-8-aug-2026', name:'Q3 planning call',
        at:'8 Aug 2026', chars:41200, source:'manual',
        url:'https://docs.google.com/document/d/1AbCdEf/view' },
      { docId:'h6apc-44014', name:'Meeting - 08/06/2026', at:'6 Aug 2026',
        source:'clickup',
        url:'https://app.clickup.com/18033356/docs/h6apc-44014' },
      { docId:'h6apc-41002', name:'Meeting - 07/16/2026', at:'16 Jul 2026',
        source:'clickup',
        url:'https://app.clickup.com/18033356/docs/h6apc-41002' }
    ],
    notes:[
      { at:'11 Aug 2026', by:'aric',
        text:'Bonus bundle dropping from $300 to $250 — check landing pages against the site.' }
    ] },
  // A 1x1 transparent GIF is a real image the browser will actually paint,
  // which is what makes "did the photo replace the initials" testable.
  getContactPhoto: { ok:true, photo:'data:image/gif;base64,'
    + 'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==' },
  setContactPhoto: { ok:true, photo:'data:image/gif;base64,'
    + 'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==' },
  clearContactPhoto: { ok:true, photo:'' },
  getClientTeam: { ok:true,
    members:[
      // Three ways onto an account, and only the third can be removed here.
      { name:'Drake King', known:true, role:'Paid lead', tasks:6,
        why:['Onboarding owner','Owns tasks'], pinned:false },
      { name:'Priya Raman', known:true, role:'Analytics', tasks:3,
        why:['Owns tasks'], pinned:false },
      { name:'Alexandra McCurdy', known:true, role:'Strategy', tasks:0,
        why:['Added to the account'], pinned:true }
    ],
    available:[{ name:'Sam Okafor', role:'Organic social', skills:['Reddit'] }],
    // A name typed on a task row that matches nobody on the Team tab. It used
    // to render as a chip reading "Justin · not on the team", which is a
    // person on the account who cannot be pinged, assigned to or emailed.
    unknown:[{ name:'Justin', tasks:2, why:['Owns tasks'] }],
    teamEmpty:false },
  addClientTeamMember: { ok:true, members:[], available:[], teamEmpty:false },
  removeClientTeamMember: { ok:true, members:[], available:[], teamEmpty:false },
  addRecentNote: { ok:true, notes:[] },
  addManualCall: { ok:true, key:'call_q3-planning-call-8-aug-2026',
                   label:'Q3 planning call', kind:'call', replaced:false,
                   chars:41200, words:7300, calls:[] },
  // What the new call changes about what we believed, by profile section.
  // A change with no `was` is new rather than revised, and the two read
  // differently on screen.
  reviewNewDocument: { ok:true, written:2, read:'Q3 planning call',
    changes:[
      { section:'Communication', was:'Extremely terse',
        now:'Now wants a short written recap after every call, from 12 Aug',
        quote:'just send me the three lines afterwards' },
      { section:'What they care about', was:'',
        now:'Blended CPA target moved from $100 to $85 for Q4',
        quote:'we need to be at eighty-five by November' }
    ] },
  deleteRecentCall: { ok:true, calls:[] },
  draftScopeEmail: { ok:true,
    read:['Scope of work','Pitch deck'],
    subject:'Scope confirmation — Harbor & Sons',
    body:'Hi Dana,\n\nPutting what we agreed in writing so we are both working '
      + 'from the same understanding.\n\nWhat we are doing\n· Google Ads '
      + 'management\n· AI Search SEO, up to 2 blogs a month\n\nWhat this does '
      + 'not include\n· Paid social of any kind\n· Website development beyond '
      + 'landing pages\n\nFees\n· Google Ads management — £6,000/month\n\n'
      + 'Drake',
    // Named gaps rather than invented answers: the whole point is that a
    // plausible guess in a contract restatement never gets caught.
    gaps:['The contract does not state a notice period',
          'No payment terms are given — net 30 was assumed on the call but is '
          + 'not written down'] },
  deleteRecentNote: { ok:true, notes:[] },
  slackPingTasks: { ok:true, posted:3, channel:'#harbor-sons', owners:2, joined:false },
  clickupFindCalls: { ok:true, scanned:38, workspaceId:'18033356',
    terms:['harbor & sons','dana whitlock'], calls:[
      { docId:'h6apc-44014', name:'Meeting - 08/06/2026', updated:'6 Aug 2026',
        updatedMs:1786039001377, url:'https://app.clickup.com/18033356/docs/h6apc-44014',
        chars:55300, matchedOn:['harbor & sons','dana whitlock'],
        preview:'Attendees: Drake King, Dana Whitlock, Alexandra McCurdy',
        imported:false },
      // Already filed: the button has to say Re-import, not offer a duplicate.
      { docId:'h6apc-41002', name:'Meeting - 07/16/2026', updated:'16 Jul 2026',
        updatedMs:1784000000000, url:'https://app.clickup.com/18033356/docs/h6apc-41002',
        chars:18039, matchedOn:['harbor & sons'],
        preview:'Attendees: Dana Whitlock, Aric Whiteley', imported:true }
    ] },
  clickupImportCall: { ok:true, key:'cu_h6apc-44014', label:'Meeting - 08/06/2026',
    chars:55300, fileId:'fake-file' },
  slackJoinChannel: { ok:true, joined:true, name:'#harbor-sons',
    message:'Joined #harbor-sons.' },
  getActionItems: { ok:true, statuses:['To do','In progress','Done','Not doing'],
    // Sizes are the point of the picker: the transcripts are what pushed the
    // request past the fetch deadline, and two labels alone hide that.
    sources:[
      // With an audit on file it is the default and the pitch deck is not:
      // ticking both is how the request gets big enough to time out again.
      { key:'audit', label:'Audit presentation', chars:21400, isCall:false, suggested:true },
      { key:'deck', label:'Pitch deck', chars:19068, isCall:false, suggested:false },
      { key:'sow', label:'Scope of work', chars:17335, isCall:false, suggested:true },
      { key:'sales', label:'Sales call transcript', chars:18039, isCall:true, suggested:false },
      { key:'kickoff', label:'Onboarding / kickoff call transcript', chars:62476, isCall:true, suggested:false },
      { key:'cu_h6apc-44014', label:'Meeting - 08/06/2026', chars:55300, isCall:true, suggested:false }
    ],
    team:['Drake King','Alexandra McCurdy'],
    items:[
      { row:2, priority:'Now', status:'To do', owner:'Drake King', effort:'half a day',
        action:'Split the single Shopping campaign by margin tier so bidding can differ',
        why:'One campaign bids the same on 60%-margin boards and 8%-margin bags, so spend follows volume rather than profit.',
        source:'Pitch deck — "Shopping structure" finding' },
      { row:3, priority:'Now', status:'In progress', owner:'Drake King', effort:'1 hour',
        action:'Add the 40 highest-spend zero-conversion search terms as negatives',
        why:'$3,100 of last month\'s spend went to terms that have never converted.',
        source:'Pitch deck — wasted spend table' },
      { row:4, priority:'Next', status:'To do', owner:'Alexandra McCurdy', effort:'2 days',
        action:'Draft the first month of Reddit posts against the content calendar',
        why:'The SOW commits to four organic posts a month starting at contract start.',
        source:'Scope of work — Reddit Organic Social Management' },
      { row:5, priority:'Later', status:'To do', owner:'', effort:'half a day',
        action:'Add FAQ and Product schema to the top 20 landing pages',
        why:'AI answers cite structured pages; without schema the site is invisible to them.',
        source:'Pitch deck — AI Search readiness' }
    ] },
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

  for (const view of ['overview', 'queue', 'clients', 'team', 'settings', 'new']) {
    // "New client" is the header CTA, not a sidebar item.
    await page.click(view === 'new' ? '#newBtn' : `nav button[data-v="${view}"]`);
    await page.waitForTimeout(250);
    const f = `${OUT}/${name}-${view}.png`;
    await page.screenshot({ path: f, fullPage: name === 'desktop' });
    shots.push(f);

    // The team page is where owners and specialties come from, and the editor
    // is a second render — a form that never opens leaves the sheet as the
    // only way to add anyone, which is the thing this page replaced.
    if (view === 'team') {
      await page.click('[data-edit-row="4"]');
      await page.waitForSelector('#tmName', { timeout: 5000 });
      const skillCount = await page.$$eval('[data-skill]', els => els.length);
      if (skillCount < 4) {
        throw new Error('The specialty picker rendered ' + skillCount + ' options');
      }
      await page.waitForTimeout(200);
      const fTeamEdit = `${OUT}/${name}-team-editor.png`;
      await page.screenshot({ path: fTeamEdit, fullPage: name === 'desktop' });
      shots.push(fTeamEdit);
      await page.click('#tmCancel');
      await page.waitForTimeout(250);

      // Building the directory by typing eleven names is the setup people
      // abandon halfway, so the roster import is the primary path and gets
      // walked: read the workspace, filter it, pick somebody, add them.
      await page.click('#importSlack');
      await page.waitForSelector('#rosterList', { timeout: 5000 });

      // Anyone already on the team must come back ticked off and disabled —
      // importing them again is how one person becomes two rows answering to
      // the same name, and owner lookup then picks whichever it reached first.
      const already = await page.$$eval('[data-pick]', els =>
        els.filter(e => e.disabled).length);
      if (already !== 2) {
        throw new Error('Expected 2 roster entries already on the team, got ' + already);
      }

      await page.fill('#rosterFind', 'jamie');
      await page.waitForTimeout(150);
      const shown = await page.$$eval('[data-roster]', els =>
        els.filter(e => e.style.display !== 'none').length);
      if (shown !== 1) {
        throw new Error('The roster filter showed ' + shown + ' people for "jamie"');
      }

      await page.fill('#rosterFind', '');
      await page.waitForTimeout(150);
      const fRoster = `${OUT}/${name}-team-roster.png`;
      await page.screenshot({ path: fRoster, fullPage: name === 'desktop' });
      shots.push(fRoster);

      await page.click('#rosterAll');
      const picked = await page.$$eval('[data-pick]:checked', els => els.length);
      if (picked !== 3) {
        throw new Error('Select all ticked ' + picked + ', expected the 3 addable');
      }
      await page.click('#rosterAdd');
      await page.waitForTimeout(400);
    }

    // Settings is where the task library and the email copy become editable by
    // someone who does not know which tab Gate lives on.
    if (view === 'settings') {
      await page.waitForSelector('[data-edit-task]', { timeout: 5000 });
      // An inactive template must still be listed — it is the row somebody
      // needs to find in order to switch it back on.
      const off = await page.$$eval('.crow.off .nm', els => els.map(e => e.textContent));
      if (!off.some(t => /Legacy Bing import/.test(t))) {
        throw new Error('Inactive task templates are not listed: ' + JSON.stringify(off));
      }
      // Follow-on tasks say what they depend on, or the library reads as if
      // the row applies to everybody.
      const dep = await page.$$eval('.crow .meta', els =>
        els.map(e => e.textContent).filter(t => /needs Google Ads/.test(t)));
      if (!dep.length) {
        throw new Error('A Requires dependency was not shown in the library');
      }
      await page.click('[data-edit-task="20"]');
      await page.waitForSelector('#tpReq', { timeout: 5000 });
      const req = await page.$eval('#tpReq', s => s.value);
      if (req !== 'Google Ads') {
        throw new Error('Requires did not load into the form: ' + req);
      }
      // A task must never be able to require itself — that is a row that can
      // never be included, and nothing would say why.
      const selfRef = await page.$$eval('#tpReq option', els =>
        els.map(e => e.textContent));
      if (selfRef.includes('Label the Google Ads account Active')) {
        throw new Error('A task was offered itself as a dependency');
      }

      await page.click('[data-edit-task="9"]');
      await page.waitForSelector('#tpTask', { timeout: 5000 });
      const biz = await page.$eval('#tpBiz', s => s.value);
      if (biz !== 'eCommerce') {
        throw new Error('The business-type scope did not load into the form: ' + biz);
      }
      await page.waitForTimeout(200);
      const fSet = `${OUT}/${name}-settings-tasks.png`;
      await page.screenshot({ path: fSet, fullPage: name === 'desktop' });
      shots.push(fSet);

      await page.click('#stMail');
      await page.waitForSelector('[data-edit-mail]', { timeout: 5000 });
      // A template with no copy has to be offered to WRITE, not to edit — the
      // useful question is which ones are still empty.
      const mailBtns = await page.$$eval('[data-edit-mail]', els =>
        els.map(e => e.textContent.trim()));
      if (!mailBtns.includes('Write') || !mailBtns.includes('Edit')) {
        throw new Error('Email template buttons do not distinguish empty from written: '
          + JSON.stringify(mailBtns));
      }
      await page.click('[data-edit-mail="_welcome"]');
      await page.waitForSelector('#mlBody', { timeout: 5000 });

      // The welcome email has no row on any sheet installed before it was
      // written — rule 3, seeds bail on a populated tab — so it arrives as
      // shipped copy. Opening it used to show an empty box, which reads as
      // "this email does not exist" while it is being sent every week.
      const welcome = await page.evaluate(() => ({
        subject: document.getElementById('mlSubject').value,
        body: document.getElementById('mlBody').value,
        reset: !!document.getElementById('mlReset')
      }));
      if (!welcome.subject || !welcome.body) {
        throw new Error('Shipped welcome copy did not reach the editor: '
          + JSON.stringify(welcome));
      }
      // Nothing has been overridden, so there is nothing to reset TO.
      if (welcome.reset) {
        throw new Error('Reset offered on a template that was never overridden');
      }
      await page.waitForTimeout(200);
      const fMail = `${OUT}/${name}-settings-email.png`;
      await page.screenshot({ path: fMail, fullPage: name === 'desktop' });
      shots.push(fMail);
      SETTINGS_DONE: ;
    }

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

  // Assignment. The point of ranking is that the right specialist is reachable
  // without scrolling fourteen names on every one of twenty rows — so the
  // Google Ads row must offer the paid-search person first, and the GA4 row
  // must not offer the same person first.
  const asg = await page.$eval('select[data-assign="Google Ads"]', function(s){
    return { groups: [].map.call(s.querySelectorAll('optgroup'), function(g){
               return g.label + ':' + [].map.call(g.querySelectorAll('option'),
                 function(o){ return o.textContent; }).join('|'); }),
             value: s.value };
  });
  if (!/^Covers this:Drake King/.test(asg.groups[0] || '')) {
    throw new Error('Google Ads did not suggest the paid-search person first: '
      + JSON.stringify(asg));
  }
  if (!asg.groups.some(g => /^Client:/.test(g))) {
    throw new Error('The client was not offered as an assignee: ' + JSON.stringify(asg));
  }
  if (asg.value !== 'Drake King') {
    throw new Error('The existing owner was not preselected: ' + asg.value);
  }

  const ga4 = await page.$eval('select[data-assign="Google Analytics (GA4)"]',
    s => (s.querySelector('optgroup') || {}).label + ':'
       + ((s.querySelector('optgroup') || s).querySelector('option') || {}).textContent);
  if (!/^Covers this:Jamie Okonkwo/.test(ga4)) {
    throw new Error('GA4 did not suggest the analytics person first: ' + ga4);
  }

  // An owner who has left the team still has work against their name. Losing
  // the option means opening the dropdown reassigns the row to nobody.
  const gone = await page.$eval('select[data-assign="Media billing setup"]', s => s.value);
  if (gone !== 'Sasha Roe') {
    throw new Error('An off-team owner was dropped from the list: ' + gone);
  }

  const ages = await page.$$eval('[data-age]', els =>
    els.map(e => e.textContent).filter(Boolean));
  if (!ages.includes('assigned 9d ago')) {
    throw new Error('The assignment age was not shown: ' + JSON.stringify(ages));
  }

  // The two dropdowns on a row must share a top edge. They did not: the age
  // line under the assignee is a span, min-height does nothing to an inline
  // span, so a row with an owner grew taller than one without and centring
  // knocked the pair out of line.
  const rowAlign = await page.$$eval('.task', function(rows){
    return rows.map(function(r){
      var a = r.querySelector('select.asg'), s = r.querySelector('select[data-task]');
      if (!a || !s) return 0;
      return Math.round(Math.abs(a.getBoundingClientRect().top
                               - s.getBoundingClientRect().top));
    });
  });
  const worst = Math.max.apply(null, rowAlign);
  if (worst > 1) {
    throw new Error('Assignee and status selects are out of line by up to '
      + worst + 'px: ' + JSON.stringify(rowAlign));
  }

  // Facts above everything else: answering "what is their website" must not
  // mean scrolling past ten thousand characters of profile.
  const facts = await page.$$eval('.facts .fact .k', els => els.map(e => e.textContent));
  ['Contact', 'Email', 'Website', 'Contract start'].forEach(function(k){
    if (facts.indexOf(k) === -1) {
      throw new Error('The facts card is missing ' + k + ': ' + JSON.stringify(facts));
    }
  });

  // A finished phase and one that has not begun are folded; the current one is
  // open. Five expanded phases is most of the page and only one is this week.
  const phases = await page.$$eval('[data-phbody]', els => els.map(function(e){
    return e.getAttribute('data-phbody') + ':' + (e.style.display === 'none' ? 'shut' : 'open');
  }));
  if (phases.indexOf('1:shut') === -1 || phases.indexOf('2:open') === -1) {
    throw new Error('Phase folding is wrong: ' + JSON.stringify(phases));
  }
  await page.click('[data-ph="1"]');
  await page.waitForTimeout(120);
  const reopened = await page.$eval('[data-phbody="1"]', e => e.style.display);
  if (reopened === 'none') throw new Error('A folded phase would not reopen');

  // A mark in front of every task name. Twenty rows of plain text is a list
  // you read; twenty marked rows is a list you glance at. The Google Merchant
  // Center row must NOT take the Google mark — longest keyword wins, and
  // getting that backwards is the whole reason the table is ordered.
  const marks = await page.evaluate(() => ({
    onTasks: document.querySelectorAll('.task .n .mk').length,
    tasks: document.querySelectorAll('.task').length,
    merchant: (function(){
      var m = brandFor('Google Merchant Center');
      return m && m[2];
    })(),
    ads: (function(){ var m = brandFor('Google Ads'); return m && m[2]; })(),
    ga: (function(){ var m = brandFor('Google Analytics (GA4)'); return m && m[2]; })(),
    unknown: brandFor('Chase the dev for the theme file')
  }));
  if (!marks.tasks || marks.onTasks !== marks.tasks) {
    throw new Error('Task rows are missing marks: ' + JSON.stringify(marks));
  }
  if (marks.merchant !== 'MC' || marks.ads !== 'G' || marks.ga !== 'GA') {
    throw new Error('Brand matching picked the wrong mark: ' + JSON.stringify(marks));
  }
  if (marks.unknown) {
    throw new Error('A hand-added task matched a brand it has nothing to do with');
  }

  // The contact's photo. It arrives after the page paints, so the card has to
  // render with initials first and swap — a card that only appears once the
  // photo lands is a card that never appears for the clients without one.
  const photo = await page.evaluate(() => {
    const wrap = document.getElementById('photoWrap');
    return {
      img: document.querySelectorAll('#photoWrap .ph').length,
      fallback: document.querySelectorAll('#photoWrap .av').length,
      canEdit: !!document.getElementById('phEdit'),
      // It belongs beside the profile — that is the card that spends four
      // hundred words on how to talk to this person.
      byProfile: !!(wrap && wrap.parentElement
        && wrap.parentElement.querySelector('#profWrap'))
    };
  });
  if (photo.img !== 1 || photo.fallback !== 0 || !photo.canEdit) {
    throw new Error('The contact photo did not render: ' + JSON.stringify(photo));
  }
  if (!photo.byProfile) {
    throw new Error('The contact photo is not beside the client profile');
  }
  // The form is the whole feature — LinkedIn cannot be read automatically, so
  // the one manual step has to be reachable and has to explain itself.
  await page.click('#phEdit');
  const form = await page.evaluate(() => ({
    open: document.getElementById('phForm').style.display,
    saysWhy: /media\.licdn\.com/.test(document.getElementById('phForm').innerHTML),
    upload: !!document.getElementById('phFile')
  }));
  if (form.open === 'none' || !form.saysWhy || !form.upload) {
    throw new Error('The photo form is wrong: ' + JSON.stringify(form));
  }
  await page.click('#phCancel');

  // Who is on the account: one line inside the facts card, not a section of
  // its own. The × is the assertion that matters — offering it against
  // somebody who holds six tasks promises something the server refuses to do,
  // and a button that reliably fails is worse than no button.
  const teamStrip = await page.evaluate(() => {
    const wrap = document.getElementById('teamStrip');
    if (!wrap) return { missing: true };
    return {
      people: wrap.querySelectorAll('.tm').length,
      avatars: wrap.querySelectorAll('.tm .av').length,
      names: [].map.call(wrap.querySelectorAll('.tm .nm'), e => e.textContent),
      removable: [].map.call(wrap.querySelectorAll('[data-rmteam]'),
        e => e.getAttribute('data-rmteam')),
      canAdd: !!document.getElementById('teamAdd'),
      // Somebody named on a client row who is not on the Team tab is a stale
      // cell, not a team member. They belong in the note, never as a chip —
      // a chip says "on the account" about a person nothing can notify.
      strays: /not on the Team tab/.test(wrap.innerHTML),
      strayAsChip: /Justin/.test(wrap.querySelector('.tstrip').innerHTML),
      // It has to live inside the facts card, or it is a section again.
      inFacts: !!wrap.closest('.facts')
    };
  });
  if (teamStrip.missing || teamStrip.people !== 3 || teamStrip.avatars !== 3) {
    throw new Error('The client team did not render: ' + JSON.stringify(teamStrip));
  }
  if (!teamStrip.inFacts) {
    throw new Error('The team strip is not in the facts card');
  }
  if (teamStrip.removable.join(',') !== 'Alexandra McCurdy') {
    throw new Error('Remove is offered against derived membership: '
      + JSON.stringify(teamStrip.removable));
  }
  if (!teamStrip.canAdd) throw new Error('No way to add somebody to the account');
  if (!teamStrip.strays || teamStrip.strayAsChip) {
    throw new Error('A name that is not on the Team tab is being shown as a '
      + 'team member: ' + JSON.stringify(teamStrip));
  }
  // "Justin" wrapped to "Justi / n" inside its chip. A name is one word.
  const chipWrap = await page.evaluate(() =>
    getComputedStyle(document.querySelector('#teamStrip .tm')).whiteSpace);
  if (chipWrap !== 'nowrap') {
    throw new Error('Team chips can break a name across lines: ' + chipWrap);
  }

  // The add menu opens on click, and its entries add directly.
  await page.click('#teamAdd');
  const menu = await page.evaluate(() => ({
    open: document.getElementById('teamMenu').classList.contains('on'),
    entries: document.querySelectorAll('[data-addteam]').length
  }));
  if (!menu.open || !menu.entries) {
    throw new Error('The add-to-team menu did not open: ' + JSON.stringify(menu));
  }
  await page.click('#teamAdd');

  // Recent context: the calls are links, not imports.
  const recentLinks = await page.$$eval('#recentWrap .line > a', els =>
    els.map(e => e.getAttribute('href')));
  if (recentLinks.length !== 3) {
    throw new Error('Recent calls did not render as links: '
      + JSON.stringify(recentLinks));
  }

  // Not every call comes from the notetaker. The way in for a Google Doc or a
  // pasted transcript has to be on this card, next to the calls it joins —
  // filing one through the intake form means creating a second draft.
  // Folded by default — five fields for a fortnightly job should not be the
  // tallest thing on the page. It still has to be one click away.
  await page.click('#mcTog');
  await page.waitForTimeout(120);
  const addCall = await page.evaluate(() => ({
    box: !!document.getElementById('mcText'),
    button: !!document.getElementById('addCall'),
    // The intake form closes behind you. An audit presented in week three has
    // to be fileable from here or it can never reach the action items.
    kinds: [].map.call(document.querySelectorAll('#mcKind option'),
      e => e.value),
    upload: !!document.getElementById('mcFile'),
    // A call added by hand is the one the daily scan could silently replace,
    // so the list has to say which is which.
    handMarked: /by hand/.test(document.getElementById('recentWrap').innerHTML),
    removable: document.querySelectorAll('[data-delcall]').length,
    // Compact lines, not two-line cards: this card ran taller than the profile
    // it sits under, for what are one-line facts.
    compact: !document.querySelectorAll('#recentWrap .crow').length
  }));
  if (!addCall.box || !addCall.button || !addCall.upload) {
    throw new Error('No way to add a non-ClickUp document: '
      + JSON.stringify(addCall));
  }
  if (addCall.kinds.indexOf('audit') === -1 || addCall.kinds.indexOf('call') === -1) {
    throw new Error('The document kinds do not include the audit: '
      + JSON.stringify(addCall.kinds));
  }
  if (!addCall.compact) {
    throw new Error('Recent context is still rendering two-line cards');
  }
  if (!addCall.handMarked || addCall.removable !== 3) {
    throw new Error('Manual calls are not distinguishable or removable: '
      + JSON.stringify(addCall));
  }
  await page.fill('#mcText', 'https://docs.google.com/document/d/1AbCdEf/edit');
  await page.fill('#mcName', 'Q3 planning call');
  await page.click('#addCall');
  await page.waitForTimeout(300);

  // Having filed something, the two questions it raises are offered rather
  // than run — both cost a model call. "I added a transcript, now what?" was
  // the gap: the document landed and the page said nothing more about it.
  const offer = await page.evaluate(() => ({
    shown: (document.getElementById('rrOffer') || {}).style
      ? document.getElementById('rrOffer').style.display : 'missing',
    what: !!document.getElementById('rrWhat'),
    actions: !!document.getElementById('rrActions')
  }));
  if (offer.shown === 'none' || offer.shown === 'missing'
      || !offer.what || !offer.actions) {
    throw new Error('Nothing offered after filing a document: '
      + JSON.stringify(offer));
  }

  // What it changes, reported against the profile section it belongs to and
  // written as dated notes — the profile itself is never rewritten.
  await page.click('#rrWhat');
  await page.waitForTimeout(250);
  const reread = await page.$eval('#rrOut', e => e.textContent);
  if (!/Communication/.test(reread) || !/was:/.test(reread)) {
    throw new Error('The change report did not name the section or the old '
      + 'belief: ' + reread.slice(0, 200));
  }
  // Building must report a short answer. A salvaged list presented as the
  // whole answer is a quiet lie, and this one is only reachable by a toast.
  await page.click('#mkActions');
  await page.waitForTimeout(400);
  const built = await page.$$eval('.toast', els => els.map(e => e.textContent).join(' || '));
  if (!/ran out of room/.test(built)) {
    throw new Error('A cut-short list was reported as complete: ' + built);
  }

  const shotReread = `${OUT}/${name}-detail-reread.png`;
  await page.screenshot({ path: shotReread, fullPage: name === 'desktop' });
  shots.push(shotReread);

  // Deal documents fold away — a long list nobody opened the page to find.
  const docsShut = await page.$eval('#docsBody', e => e.style.display);
  if (docsShut !== 'none') throw new Error('Deal documents did not start folded');

  // The picker must render on the EMPTY state too. It used to be dropped there
  // by an early return in getActionItems, which is the one screen that cannot
  // work without it: no items yet is exactly when somebody is building them,
  // and the button answered "tick at least one document" with nothing to tick.
  const emptyPicker = await page.evaluate(function(){
    var card = actionsCard({ ok:true, items:[], statuses:['To do'], team:[],
      sources:[{ key:'deck', label:'Pitch deck', chars:19068, isCall:false,
                 suggested:true }] });
    return /data-src="deck"/.test(card) && /id="mkActions"/.test(card);
  });
  if (!emptyPicker) {
    throw new Error('The empty action-items card renders no document picker');
  }

  // The document picker is the fix for the timeout, so it has to default to
  // the short high-signal documents rather than everything — ticking all five
  // is 172k characters and is exactly what failed.
  const picked = await page.$$eval('[data-src]', els =>
    els.filter(e => e.checked).map(e => e.getAttribute('data-src')));
  if (picked.join(',') !== 'audit,sow') {
    throw new Error('Action item sources did not default to the audit + SOW: '
      + JSON.stringify(picked));
  }
  const sum = await page.$eval('#srcSum', e => e.textContent);
  if (sum !== '39k characters') {
    throw new Error('The character total did not reflect the default: ' + sum);
  }
  // Ticking a transcript has to move the number, or the size is decoration.
  await page.click('[data-src="kickoff"]');
  await page.waitForTimeout(120);
  const sum2 = await page.$eval('#srcSum', e => e.textContent);
  if (sum2 !== '101k characters') {
    throw new Error('The total did not update when a transcript was added: ' + sum2);
  }
  await page.click('[data-src="kickoff"]');

  // Importing a call is the whole point of the scan, so the scan has to render
  // its results and mark what is already filed — offering "Import" on a doc
  // that is already in the folder is how a transcript ends up there twice.
  await page.click('#findCalls');
  await page.waitForSelector('[data-import]', { timeout: 5000 });
  const callBtns = await page.$$eval('[data-import]', els =>
    els.map(e => e.textContent.trim()));
  if (callBtns.join('|') !== 'Import|Re-import') {
    throw new Error('Call import buttons did not reflect what is already filed: '
      + JSON.stringify(callBtns));
  }
  await page.waitForTimeout(200);
  const fCalls = `${OUT}/${name}-detail-clickup-calls.png`;
  await page.screenshot({ path: fCalls, fullPage: name === 'desktop' });
  shots.push(fCalls);

  // A bot that is not in the channel cannot post, and the fix differs by
  // channel type — so the button has to exist rather than the failure being
  // discovered mid-nudge.
  if (!(await page.$('#slackJoin'))) {
    throw new Error('No "Add bot to channel" control on a client with a channel');
  }

  // Ping, individually and by phase. Both need a channel on the client.
  const pings = await page.$$eval('[data-ping]', els => els.length);
  const phasePings = await page.$$eval('[data-pingphase]', els =>
    els.map(e => e.textContent));
  if (!pings) throw new Error('No per-task ping buttons rendered');
  if (!phasePings.length || !/^Ping \d+ outstanding$/.test(phasePings[0])) {
    throw new Error('No phase ping button: ' + JSON.stringify(phasePings));
  }
  // Complete and N/A rows are not naggable, so they must not offer the button.
  const openRows = await page.$$eval('.task', rows => rows.filter(function(r){
    var s = r.querySelector('select[data-task]');
    return s && s.value !== 'Complete' && s.value !== 'N/A';
  }).length);
  if (pings !== openRows) {
    throw new Error('Ping buttons (' + pings + ') do not match open rows ('
      + openRows + ')');
  }

  // The profile is ~4,000 characters of prose across seven sections. Collapsed
  // it has to be readable at a glance, and every section has to open — a
  // profile that renders but cannot be expanded is worse than the wall it
  // replaced, because the content is hidden rather than merely long.
  const proShut = await page.$eval('.pro-secs', function(w){
    return { secs: w.querySelectorAll('.pro-sec').length,
             open: w.querySelectorAll('.pro-sec.on').length,
             teasers: [].filter.call(w.querySelectorAll('.pro-head .te'),
               function(t){ return t.textContent.trim(); }).length };
  });
  if (proShut.secs < 6 || proShut.open !== 0 || proShut.teasers !== proShut.secs) {
    throw new Error('Profile did not render collapsed with a teaser per section: '
      + JSON.stringify(proShut));
  }
  const fProfShut = `${OUT}/${name}-detail-profile-collapsed.png`;
  await page.screenshot({ path: fProfShut, fullPage: name === 'desktop' });
  shots.push(fProfShut);

  await page.click('#proAll');
  await page.waitForTimeout(200);
  const proOpen = await page.$eval('.pro-secs', function(w){
    return { open: w.querySelectorAll('.pro-sec.on').length,
             claims: w.querySelectorAll('.pro-pt .cl').length,
             quotes: w.querySelectorAll('.pro-q .qt').length };
  });
  if (proOpen.open !== proShut.secs || !proOpen.claims || !proOpen.quotes) {
    throw new Error('Expand all did not open every section with its parts: '
      + JSON.stringify(proOpen));
  }
  const fProfOpen = `${OUT}/${name}-detail-profile-expanded.png`;
  await page.screenshot({ path: fProfOpen, fullPage: name === 'desktop' });
  shots.push(fProfOpen);
  await page.click('#proAll');
  await page.waitForTimeout(150);

  // The scope confirmation is drafted from the contract, not from a template,
  // and it must come back for review rather than sending. Gaps are the part
  // that matters: a plausible guess in a restatement of a contract is never
  // caught, so anything the contract does not say has to be shown, not filled.
  const scopeShut = await page.$eval('#scopeCard', e => e.style.display);
  if (scopeShut !== 'none') throw new Error('The scope card did not start folded');
  await page.click('#scopeTog');
  await page.waitForTimeout(120);
  await page.click('#mkScope');
  await page.waitForSelector('#scBody', { timeout: 5000 });
  const scope = await page.evaluate(function(){
    return { subject: document.getElementById('scSubject').value,
             body: document.getElementById('scBody').value.length,
             gaps: document.querySelectorAll('#scopeWrap .okbox').length };
  });
  if (!/Harbor & Sons/.test(scope.subject) || scope.body < 100 || !scope.gaps) {
    throw new Error('The scope draft did not render for review: '
      + JSON.stringify(scope));
  }
  await page.waitForTimeout(150);
  const fScope = `${OUT}/${name}-detail-scope.png`;
  await page.screenshot({ path: fScope, fullPage: name === 'desktop' });
  shots.push(fScope);

  // Slack folds away now — it is a people picker, a channel picker and five
  // buttons, and on a client whose channel is set nobody needs any of it. Open
  // it before anything below tries to click into it.
  const slackShut = await page.$eval('#slackCard', e => e.style.display);
  if (slackShut !== 'none') throw new Error('The Slack card did not start folded');
  await page.click('#slackTog');
  await page.waitForTimeout(150);

  // Regression: the Slack card painted "Loading the team…" and stayed there
  // forever. wireSlack had been dropped into the action-items click handler,
  // so nothing on the card was ever wired — no picker, no working buttons, and
  // no error either, because the request that would have failed never ran.
  const slackBox = await page.$eval('#slackPeople',
    e => ({ text: e.textContent.trim(), boxes: e.querySelectorAll('input').length }));
  if (/^Loading the team/.test(slackBox.text) || !slackBox.boxes) {
    throw new Error('The Slack people picker never resolved: '
      + JSON.stringify(slackBox));
  }

  // An account that has been running a while already has a channel, made long
  // before anyone opened this tool. Picking it must be possible, and the one
  // the client already points at has to come back selected rather than
  // defaulting to whatever sorts first.
  await page.click('#slackPickBtn');
  await page.waitForSelector('#slackChanSel', { timeout: 5000 });
  const sel = await page.$eval('#slackChanSel', function(s){
    return { value: s.value, count: s.options.length,
             text: s.options[s.selectedIndex].textContent };
  });
  if (sel.value !== 'C01HARB') {
    throw new Error('The channel picker did not preselect the linked channel: '
      + JSON.stringify(sel));
  }
  if (!/bot not in it/.test(await page.$eval('#slackChanSel', s => s.textContent))) {
    throw new Error('The picker did not flag a channel the bot is not in');
  }
  await page.waitForTimeout(200);
  const fPick = `${OUT}/${name}-detail-channel-picker.png`;
  await page.screenshot({ path: fPick, fullPage: name === 'desktop' });
  shots.push(fPick);

  const f = `${OUT}/${name}-detail.png`;
  await page.screenshot({ path: f, fullPage: name === 'desktop' });
  shots.push(f);

  console.log(`${name}: ${errors.length ? errors.join('\n  ') : 'no JS errors'}`);
  await page.close();
}

await browser.close();
console.log('\nScreenshots:\n' + shots.join('\n'));

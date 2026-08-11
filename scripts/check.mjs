#!/usr/bin/env node
/**
 * Static checks for an Apps Script project.
 *
 * There is no local runtime, so this is the only automated safety net:
 *   1. Every .gs file parses
 *   2. Inline <script> in every .html file parses
 *   3. Every function invoked via google.script.run exists server-side
 *   4. None of them ends in "_" (Apps Script won't expose those to the client)
 *   5. Column map widths match the setup() headers
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const SRC = 'src';
const tmp = mkdtempSync(join(tmpdir(), 'gascheck-'));
let failures = 0;

const fail = (msg) => { console.error('  FAIL  ' + msg); failures++; };
const pass = (msg) => console.log('  ok    ' + msg);

const files = readdirSync(SRC);
const gs = files.filter(f => extname(f) === '.gs');
const html = files.filter(f => extname(f) === '.html');

function parses(label, code) {
  const p = join(tmp, label.replace(/[^\w.]/g, '_') + '.js');
  writeFileSync(p, code);
  try {
    execFileSync('node', ['--check', p], { stdio: 'pipe' });
    return null;
  } catch (e) {
    return (e.stderr?.toString() || e.message).split('\n').slice(0, 4).join('\n');
  }
}

// ---- 1. server files parse
console.log('\nParsing server files');
const serverSrc = gs.map(f => readFileSync(join(SRC, f), 'utf8')).join('\n');
for (const f of gs) {
  const err = parses(f, readFileSync(join(SRC, f), 'utf8'));
  err ? fail(f + '\n' + err) : pass(f);
}

// ---- 2. inline html scripts parse
console.log('\nParsing inline HTML scripts');
const htmlSrc = {};
for (const f of html) {
  const src = readFileSync(join(SRC, f), 'utf8');
  htmlSrc[f] = src;
  const blocks = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!blocks.length) { pass(f + ' (no inline script)'); continue; }
  let bad = false;
  blocks.forEach((b, i) => {
    const err = parses(f + '.' + i, 'var google={script:{run:{}}};\n' + b);
    if (err) { fail(f + ' block ' + i + '\n' + err); bad = true; }
  });
  if (!bad) pass(f);
}

// ---- 3 & 4. google.script.run targets resolve and are public
console.log('\nResolving google.script.run targets');
const defined = new Set(
  [...serverSrc.matchAll(/^\s*function\s+([A-Za-z0-9_]+)\s*\(/gm)].map(m => m[1])
);

const called = new Map(); // name -> file
for (const [f, src] of Object.entries(htmlSrc)) {
  let idx = src.indexOf('google.script.run');
  while (idx !== -1) {
    // Walk the chain tracking paren depth so handler bodies don't leak in.
    let i = idx + 'google.script.run'.length, depth = 0, last = null;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '(') { depth++; i++; continue; }
      if (ch === ')') { depth--; i++; continue; }
      if (depth === 0 && ch === '.') {
        const m = /^\.([A-Za-z0-9_]+)\s*\(/.exec(src.slice(i));
        if (!m) break;
        if (!m[1].startsWith('with')) last = m[1];
        i += m[1].length + 1;
        continue;
      }
      if (depth === 0 && !/\s/.test(ch)) break;
      i++;
    }
    if (last) called.set(last, f);
    idx = src.indexOf('google.script.run', idx + 1);
  }

  // Chains stored in a variable: `var run = google.script.run...; run.foo(...)`
  for (const m of src.matchAll(/(?:var|let|const)\s+([A-Za-z0-9_$]+)\s*=\s*google\.script\.run/g)) {
    const v = m[1];
    for (const c of src.matchAll(new RegExp('\\b' + v + '\\.([A-Za-z0-9_]+)\\s*\\(', 'g'))) {
      if (!c[1].startsWith('with')) called.set(c[1], f);
    }
  }

  // A page that dispatches dynamically (`run[fn](...)`) is invisible to the
  // scans above, so it declares its targets in a SERVER_FNS array instead.
  const decl = src.match(/SERVER_FNS\s*=\s*\[([\s\S]*?)\]/);
  if (decl) {
    for (const m of decl[1].matchAll(/'([A-Za-z0-9_]+)'|"([A-Za-z0-9_]+)"/g)) {
      called.set(m[1] || m[2], f + ' (SERVER_FNS)');
    }
  }
}

if (!called.size) fail('no google.script.run calls found — regex may be stale');
for (const [name, file] of [...called].sort()) {
  if (name.endsWith('_')) {
    fail(`${name} (${file}) ends in "_" — Apps Script will not expose it to the client`);
  } else if (!defined.has(name)) {
    fail(`${name} (${file}) is not defined in any .gs file`);
  } else {
    pass(`${name}  ←  ${file}`);
  }
}

// ---- 5. column map widths agree with setup() headers
console.log('\nChecking column maps against setup() headers');
function headerCount(tabConst) {
  const re = new RegExp('mkTab_\\(ss,\\s*TABS\\.' + tabConst + ',\\s*\\[([\\s\\S]*?)\\]\\s*\\)', 'm');
  const m = serverSrc.match(re);
  if (!m) return null;
  return (m[1].match(/'/g) || []).length / 2;
}
for (const [mapName, tabConst] of [['C', 'CLIENTS'], ['A', 'ACCESS']]) {
  const declared = serverSrc.match(new RegExp('const ' + mapName + ' = \\{[\\s\\S]*?WIDTH:\\s*(\\d+)'));
  const headers = headerCount(tabConst);
  if (!declared || headers === null) { fail(`could not read ${mapName} / ${tabConst}`); continue; }
  const w = Number(declared[1]);
  w === headers
    ? pass(`${mapName}.WIDTH ${w} matches ${headers} ${tabConst} headers`)
    : fail(`${mapName}.WIDTH is ${w} but ${tabConst} has ${headers} headers`);
}

// Drafts passes its headers as a named constant rather than a literal, because
// Drafts.gs recreates the tab on a sheet installed before drafts existed. Same
// drift risk as above: D.WIDTH and the array have to agree.
{
  const declared = serverSrc.match(/const D = \{[\s\S]*?WIDTH:\s*(\d+)/);
  const arr = serverSrc.match(/const DRAFT_HEADERS = \[([\s\S]*?)\]/);
  if (!declared || !arr) {
    fail('could not read D / DRAFT_HEADERS');
  } else {
    const w = Number(declared[1]);
    const headers = (arr[1].match(/'/g) || []).length / 2;
    w === headers
      ? pass(`D.WIDTH ${w} matches ${headers} DRAFT_HEADERS entries`)
      : fail(`D.WIDTH is ${w} but DRAFT_HEADERS has ${headers} entries`);
  }
}

// Two lists of the same thing, in two places. SERVICES drives validation and
// the intake prompt; SERVICE_SEED writes the tab the UI renders checkboxes
// from. A name in one and not the other means the model can return a service
// with no box to tick, and the answer disappears without a word.
console.log('\nChecking the service lists agree');
{
  const names = src => {
    const m = serverSrc.match(src);
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : null;
  };
  const flat = names(/const SERVICES = \[([\s\S]*?)\];/);
  const seed = (() => {
    const m = serverSrc.match(/const SERVICE_SEED = \[([\s\S]*?)\n\];/);
    if (!m) return null;
    // First string on each row is the service name.
    return [...m[1].matchAll(/^\s*\['([^']+)'/gm)].map(x => x[1]);
  })();

  if (!flat || !seed) {
    fail('could not read SERVICES / SERVICE_SEED');
  } else {
    const onlyFlat = flat.filter(n => !seed.includes(n));
    const onlySeed = seed.filter(n => !flat.includes(n));
    if (onlyFlat.length) fail(`in SERVICES but not SERVICE_SEED: ${onlyFlat.join(', ')}`);
    if (onlySeed.length) fail(`in SERVICE_SEED but not SERVICES: ${onlySeed.join(', ')}`);
    if (!onlyFlat.length && !onlySeed.length) {
      pass(`${flat.length} services match across both lists`);
    }
  }
}

// ---- 6. no two src files share a basename
// Apps Script drops the extension: Admin.gs and Admin.html both want to be
// "Admin", and names are unique across types. clasp fails the push with
// "A file with this name already exists in the current project: Admin" —
// after some files have already uploaded, so the project is left half-written.
console.log('\nChecking for filename collisions');
const byBase = new Map();
for (const f of files) {
  if (f === 'appsscript.json') continue;
  const base = f.replace(/\.[^.]*$/, '');
  if (!byBase.has(base)) byBase.set(base, []);
  byBase.get(base).push(f);
}
let collisions = 0;
for (const [base, group] of byBase) {
  if (group.length > 1) {
    fail(`${group.join(' and ')} both become "${base}" in Apps Script — rename one`);
    collisions++;
  }
}
if (!collisions) pass(`${byBase.size} file names are unique once extensions are dropped`);

console.log(failures ? `\n${failures} problem(s)\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);

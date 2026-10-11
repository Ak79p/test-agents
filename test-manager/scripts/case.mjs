#!/usr/bin/env node
// Command-line access to the test catalogue (data/catalogue.json), used by the Claude Code
// agents and handy for humans. Works whether or not the web server is running.
//
//   node test-manager/scripts/case.mjs show AUTH-API-001          full case as JSON
//   node test-manager/scripts/case.mjs placement AUTH-API-001     the required file, project, tags and run command
//   node test-manager/scripts/case.mjs list [--layer API] [--status planned] [--result "not run"]
//   node test-manager/scripts/case.mjs update AUTH-API-001 \
//        --automation-status automated \
//        --script-path tests/playwright/api/auth-api.spec.ts \
//        --result passed --executed today \
//        --note "npx playwright test --grep AUTH-API-001 → 1 passed"
//
// Exit codes: 0 ok · 1 usage/validation error · 2 id not found · 3 id duplicated

import { ID_PATTERN, placementFor, validateTest } from '../lib/catalogue.mjs';
import { mutateCatalogue, readCatalogue } from '../lib/store.mjs';

const UPDATE_FLAGS = {
  '--automation-status': 'automationStatus',
  '--script-path': 'scriptPath',
  '--result': 'latestResult',
  '--executed': 'lastExecuted',
  '--notes': 'notes',
};

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTimestamp(d = new Date()) {
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const mm = String(Math.abs(offset) % 60).padStart(2, '0');
  return `${localDate(d)} ${d.toTimeString().slice(0, 5)} UTC${sign}${hh}:${mm}`;
}

/** Exact, case-sensitive lookup. Never falls back to a "close enough" ID. */
function resolveCase(doc, id) {
  const hits = doc.tests.filter((t) => t.id === id);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) fail(`Test case ${id} is duplicated (${hits.length} entries). Fix the catalogue before continuing.`, 3);

  const upper = id.toUpperCase();
  const prefix = upper.split('-').slice(0, 2).join('-');
  const similar = doc.tests.map((t) => t.id).filter((x) => x.toUpperCase() === upper || x.startsWith(`${prefix}-`));
  const hint = similar.length ? `\nIDs with the same prefix: ${similar.join(', ')}` : '';
  const format = ID_PATTERN.test(id) ? '' : `\n"${id}" does not match the ID format ${ID_PATTERN}.`;
  fail(`Test case ${id} was not found in test-manager/data/catalogue.json.${format}${hint}\nNo case was assumed or created.`, 2);
}

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (value === undefined) fail(`Missing value for ${flag}`);
    out[flag] = value;
  }
  return out;
}

async function show(id) {
  const doc = await readCatalogue();
  console.log(JSON.stringify(resolveCase(doc, id), null, 2));
}

// The only source for where a case's automation lives; never choose a path by judgment.
async function placement(id) {
  const t = resolveCase(await readCatalogue(), id);
  const p = placementFor(t.id);
  if (t.layer === 'Performance') {
    console.log(JSON.stringify({ id: t.id, layer: t.layer, ...p, command: `cd tests/k6 && k6 run --vus 1 --iterations 1 scripts/${t.id}.js` }, null, 2));
    return;
  }
  const project = t.layer === 'API' ? 'api' : /@mobile/.test(t.title) ? 'ui-mobile' : 'ui-chromium';
  const file = p.scriptPath.replace('tests/playwright/', '');
  console.log(JSON.stringify({ id: t.id, layer: t.layer, ...p, project, command: `cd tests/playwright && npx playwright test ${file} --project=${project} --grep ${t.id} --reporter=list` }, null, 2));
}

async function list(args) {
  const flags = parseFlags(args);
  const doc = await readCatalogue();
  const rows = doc.tests.filter(
    (t) =>
      (!flags['--layer'] || t.layer === flags['--layer']) &&
      (!flags['--status'] || t.automationStatus === flags['--status']) &&
      (!flags['--result'] || t.latestResult === flags['--result']),
  );
  for (const t of rows) {
    console.log([t.id.padEnd(14), t.layer.padEnd(12), t.priority, t.automationStatus.padEnd(12), t.latestResult.padEnd(8), t.title].join('  '));
  }
  console.log(`${rows.length} of ${doc.tests.length} test cases`);
}

async function update(id, args) {
  const flags = parseFlags(args);
  const allowed = new Set([...Object.keys(UPDATE_FLAGS), '--note']);
  const unknown = Object.keys(flags).filter((f) => !allowed.has(f));
  if (unknown.length) fail(`Unknown flag(s): ${unknown.join(', ')}. Allowed: ${[...allowed].join(', ')}`);
  if (!Object.keys(flags).length) fail('Nothing to update.');

  const changes = {};
  for (const [flag, field] of Object.entries(UPDATE_FLAGS)) if (flag in flags) changes[field] = flags[flag];
  if (changes.lastExecuted === 'today') changes.lastExecuted = localDate();
  if (changes.lastExecuted === 'none') changes.lastExecuted = null;

  const updated = await mutateCatalogue((doc) => {
    const current = resolveCase(doc, id);
    const next = { ...current, ...changes, updatedAt: new Date().toISOString() };
    // --note appends a timestamped line and preserves existing notes (including the user's).
    if (flags['--note']) next.notes = [next.notes, `[${localTimestamp()}] ${flags['--note']}`].filter(Boolean).join('\n');
    const errors = validateTest(next);
    if (errors.length) fail(`Update rejected; catalogue unchanged:\n  - ${errors.join('\n  - ')}`);
    doc.tests[doc.tests.indexOf(current)] = next;
    return next;
  });
  const { id: savedId, automationStatus, scriptPath, latestResult, lastExecuted, notes } = updated;
  console.log(JSON.stringify({ id: savedId, automationStatus, scriptPath, latestResult, lastExecuted, notes }, null, 2));
}

const [command, id, ...rest] = process.argv.slice(2);
if (command === 'show' && id) await show(id);
else if (command === 'placement' && id) await placement(id);
else if (command === 'list') await list([id, ...rest].filter((x) => x !== undefined));
else if (command === 'update' && id) await update(id, rest);
else fail('Usage: case.mjs show <ID> | placement <ID> | list [--layer L] [--status S] [--result R] | update <ID> [--automation-status S] [--script-path P] [--result R] [--executed YYYY-MM-DD|today|none] [--notes TEXT] [--note TEXT]');

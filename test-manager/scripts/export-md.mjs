// Exports data/catalogue.json to a single Markdown file that is easy for people and LLMs
// (ChatGPT, Claude) to read. The JSON catalogue stays the source of truth.
//
//   node test-manager/scripts/export-md.mjs            → <repo>/test-catalog.md
//   node test-manager/scripts/export-md.mjs out.md     → custom path

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCatalogue } from '../lib/store.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = resolve(process.argv[2] || resolve(REPO_ROOT, 'test-catalog.md'));

const AREAS = {
  AUTH: 'Authentication & access control',
  FEE: 'Fees (lookup & balances)',
  PAY: 'Payments (create, confirm, cancel, idempotency)',
  TXN: 'Transaction history',
};
const LAYER_ORDER = ['API', 'UI', 'Performance'];
const PRIORITY_MEANING = { P0: 'critical', P1: 'high', P2: 'medium' };

const area = (t) => t.id.split('-')[0];
const numbered = (items) => items.map((x, i) => `${i + 1}. ${x}`).join('\n');
const bullets = (items) => (items.length ? items.map((x) => `- ${x}`).join('\n') : '- None');
const cell = (s) => String(s).replace(/\|/g, '\\|');

function renderCase(t) {
  return `### ${t.id}: ${t.title}

- **Category:** ${t.layer} test · ${AREAS[area(t)] ?? area(t)}
- **Priority:** ${t.priority} (${PRIORITY_MEANING[t.priority]})
- **Automation target:** ${t.automationTarget}
- **Status:** automation ${t.automationStatus} · latest result ${t.latestResult}${t.lastExecuted ? ` (${t.lastExecuted})` : ''}${t.scriptPath ? ` · script \`${t.scriptPath}\`` : ''}

**Objective:** ${t.objective}

**Risk addressed:** ${t.risk}

**Preconditions:**
${bullets(t.preconditions)}

**Test data:**
${bullets(t.testData)}

**Procedure:**
${numbered(t.steps)}

**Expected results:**
${numbered(t.expectedResults)}

**References:** ${t.references.length ? t.references.map((r) => `\`${r}\``).join(', ') : 'none'}
`;
}

const doc = await readCatalogue();
const tests = [...doc.tests].sort(
  (a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer) || a.id.localeCompare(b.id),
);
const count = (layer) => tests.filter((t) => t.layer === layer).length;

const index = tests
  .map((t) => `| ${t.id} | ${t.layer} | ${AREAS[area(t)] ? area(t) : ''} | ${t.priority} | ${cell(t.title)} | ${t.automationStatus} / ${t.latestResult} |`)
  .join('\n');

const sections = LAYER_ORDER.map((layer) => {
  const group = tests.filter((t) => t.layer === layer);
  const title = layer === 'Performance' ? 'Performance tests (k6)' : `${layer} tests (Playwright)`;
  return `## ${title}\n\n${group.map(renderCase).join('\n---\n\n')}`;
}).join('\n\n');

const md = `# FeeFlow test catalogue

Generated ${new Date().toISOString()} from \`test-manager/data/catalogue.json\` (the source of truth; edit cases there or in the catalogue UI at http://127.0.0.1:5180). Regenerate with \`node test-manager/scripts/export-md.mjs\`.

## How to read this file

- **System under test:** FeeFlow, a local demo school-fee payment app. API at \`http://127.0.0.1:8000/api/v1\` (FastAPI, SQLite), web UI at \`http://localhost:5173\` (React). All payments are simulated.
- **Test case ID** \`<AREA>-<LAYER>-<NNN>\` is permanent. AREA: ${Object.entries(AREAS).map(([k, v]) => `\`${k}\` = ${v}`).join('; ')}. LAYER: \`API\`, \`UI\`, \`PERF\`.
- **Category** = test layer (API / UI / Performance) + functional area.
- **Priority:** P0 = critical (core money/auth flows), P1 = high, P2 = medium.
- **Procedure** steps are executed in order. Each **expected result** must be true for the test to pass; values (status codes, error codes, messages, amounts) are exact.
- API paths in steps are relative to the API base (e.g. \`POST auth/login\` = \`POST http://127.0.0.1:8000/api/v1/auth/login\`). Amounts are in cents unless shown as rand (e.g. \`R 450,00\`). UI element names like \`login-button\` are \`data-testid\` values.
- Seeded accounts share one demo password (see \`docs/APPLICATION.md\` §6). \`POST /api/v1/dev/reset\` re-seeds the database and invalidates all tokens.

**Totals:** ${tests.length} test cases: ${count('API')} API, ${count('UI')} UI, ${count('Performance')} performance.

## Index

| ID | Layer | Area | Priority | Title | Automation / result |
|---|---|---|---|---|---|
${index}

${sections}
`;

await writeFile(OUT, md, 'utf8');
console.log(`Wrote ${OUT} (${tests.length} test cases)`);

// Validates data/catalogue.json against the catalogue schema (useful after hand edits).
import { readFile } from 'node:fs/promises';
import { validateCatalogue } from '../lib/catalogue.mjs';

const file = new URL('../data/catalogue.json', import.meta.url);
const doc = JSON.parse(await readFile(file, 'utf8'));
const errors = validateCatalogue(doc);
if (errors.length) {
  console.error(`catalogue.json has ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
const byLayer = doc.tests.reduce((acc, t) => ({ ...acc, [t.layer]: (acc[t.layer] || 0) + 1 }), {});
console.log(`catalogue.json is valid: ${doc.tests.length} test cases`, byLayer);

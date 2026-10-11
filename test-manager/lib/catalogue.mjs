// Catalogue schema: validation and normalisation shared by the server (authoritative)
// and mirrored in the browser for instant feedback.

export const ENUMS = {
  layer: ['API', 'UI', 'Performance'],
  priority: ['P0', 'P1', 'P2'],
  automationStatus: ['planned', 'in progress', 'automated'],
  automationTarget: ['Playwright', 'k6'],
  latestResult: ['not run', 'passed', 'failed', 'blocked'],
};

export const ID_PATTERN = /^[A-Z]+-(API|UI|PERF)-\d{3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const STRING_FIELDS = ['title', 'objective', 'risk'];
const LIST_FIELDS = ['preconditions', 'testData', 'steps', 'expectedResults', 'references'];
const REQUIRED_NON_EMPTY_LISTS = ['steps', 'expectedResults'];

/** Fields a PATCH may change. `id` is deliberately absent: IDs are permanent. */
export const EDITABLE_FIELDS = [
  ...STRING_FIELDS,
  ...LIST_FIELDS,
  ...Object.keys(ENUMS),
  'scriptPath',
  'lastExecuted',
  'notes',
];

/** Returns a list of human-readable problems for one test case (empty = valid). */
export function validateTest(test) {
  const errors = [];
  const where = test && typeof test.id === 'string' ? test.id : '(unknown id)';
  if (!test || typeof test !== 'object' || Array.isArray(test)) return [`${where}: test case must be an object`];

  if (typeof test.id !== 'string' || !ID_PATTERN.test(test.id)) {
    errors.push(`${where}: id must match ${ID_PATTERN} (e.g. PAY-API-003)`);
  }
  for (const f of STRING_FIELDS) {
    if (typeof test[f] !== 'string' || !test[f].trim()) errors.push(`${where}: ${f} must be a non-empty string`);
  }
  for (const f of LIST_FIELDS) {
    if (!Array.isArray(test[f]) || test[f].some((x) => typeof x !== 'string')) {
      errors.push(`${where}: ${f} must be an array of strings`);
    } else if (REQUIRED_NON_EMPTY_LISTS.includes(f) && test[f].length === 0) {
      errors.push(`${where}: ${f} must contain at least one item`);
    }
  }
  for (const [f, allowed] of Object.entries(ENUMS)) {
    if (!allowed.includes(test[f])) errors.push(`${where}: ${f} must be one of ${allowed.join(', ')}`);
  }
  if (typeof test.scriptPath !== 'string') errors.push(`${where}: scriptPath must be a string (may be empty)`);
  if (typeof test.notes !== 'string') errors.push(`${where}: notes must be a string (may be empty)`);
  if (test.lastExecuted !== null && !(typeof test.lastExecuted === 'string' && DATE_PATTERN.test(test.lastExecuted))) {
    errors.push(`${where}: lastExecuted must be null or YYYY-MM-DD`);
  }
  if (test.layer === 'Performance' && test.automationTarget !== 'k6') {
    errors.push(`${where}: Performance tests must target k6`);
  }
  if ((test.layer === 'API' || test.layer === 'UI') && test.automationTarget !== 'Playwright') {
    errors.push(`${where}: API and UI tests must target Playwright`);
  }
  if (test.automationStatus === 'automated' && !test.scriptPath) {
    errors.push(`${where}: an automated test needs a scriptPath`);
  }
  return errors;
}

/** Validates a whole catalogue document. */
export function validateCatalogue(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.tests)) {
    return ['catalogue must be an object with a "tests" array'];
  }
  const errors = [];
  const seen = new Set();
  for (const t of doc.tests) {
    errors.push(...validateTest(t));
    if (t && typeof t.id === 'string') {
      if (seen.has(t.id)) errors.push(`${t.id}: duplicate id`);
      seen.add(t.id);
    }
  }
  return errors;
}

/** Keeps only known fields so imports cannot smuggle arbitrary data into the file. */
export function normaliseTest(t) {
  const out = { id: t.id };
  for (const f of EDITABLE_FIELDS) out[f] = t[f];
  out.updatedAt = typeof t.updatedAt === 'string' ? t.updatedAt : new Date().toISOString();
  return out;
}

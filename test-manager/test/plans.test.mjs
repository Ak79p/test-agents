// Plan staleness depends only on requirement fields. Run: cd test-manager && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REQUIREMENT_FIELDS, parsePlan, planFreshness, requirementFingerprint } from '../lib/plans.mjs';

const baseCase = {
  id: 'PAY-API-001',
  title: 'Create payment returns a PENDING payment without moving money',
  layer: 'API',
  priority: 'P0',
  preconditions: ['Backend running.', 'Simulation settings at .env defaults.'],
  testData: ['loadtest050@example.com', 'Amount: 10 000 cents'],
  steps: ['Log in and GET fees/outstanding.', 'POST payments.'],
  expectedResults: ['Step 2: HTTP 201.', 'Step 3: HTTP 200 and identical payment.'],
  automationStatus: 'planned',
  scriptPath: '',
  latestResult: 'not run',
  lastExecuted: null,
  notes: '',
  updatedAt: '2026-10-11T14:46:17Z',
};

const planFor = (fingerprint, status = 'APPROVED') =>
  `# Plan: PAY-API-001\n\n| Field | Value |\n|---|---|\n| Plan status | ${status} |\n| Requirement fingerprint | \`${fingerprint}\` |\n`;

test('fingerprint is deterministic and covers exactly the requirement fields', () => {
  assert.deepEqual(REQUIREMENT_FIELDS, ['title', 'preconditions', 'testData', 'steps', 'expectedResults']);
  assert.equal(requirementFingerprint(baseCase), requirementFingerprint({ ...baseCase }));
  assert.match(requirementFingerprint(baseCase), /^sha256:[0-9a-f]{16}$/);
});

test('tracking-only changes keep the plan fresh', () => {
  const plan = parsePlan(planFor(requirementFingerprint(baseCase)));
  const tracked = {
    ...baseCase,
    automationStatus: 'automated',
    scriptPath: 'tests/playwright/api/pay-api.spec.ts',
    latestResult: 'passed',
    lastExecuted: '2026-10-12',
    notes: '[2026-10-12 10:31] PASSED via: …',
    updatedAt: '2026-10-12T05:00:00.000Z',
  };
  const result = planFreshness(plan, tracked);
  assert.equal(result.fresh, true, result.reason);
});

for (const field of REQUIREMENT_FIELDS) {
  test(`a change to ${field} makes the plan stale`, () => {
    const plan = parsePlan(planFor(requirementFingerprint(baseCase)));
    const value = baseCase[field];
    const changed = { ...baseCase, [field]: Array.isArray(value) ? [...value, 'one more line'] : `${value} (edited)` };
    const result = planFreshness(plan, changed);
    assert.equal(result.fresh, false);
    assert.match(result.reason, /Requirement fields changed/);
  });
}

test('reordering steps or expected results makes the plan stale', () => {
  const plan = parsePlan(planFor(requirementFingerprint(baseCase)));
  assert.equal(planFreshness(plan, { ...baseCase, steps: [...baseCase.steps].reverse() }).fresh, false);
  assert.equal(planFreshness(plan, { ...baseCase, expectedResults: [...baseCase.expectedResults].reverse() }).fresh, false);
});

test('a plan without a fingerprint is stale (never silently trusted)', () => {
  const legacy = '| Field | Value |\n|---|---|\n| Plan status | APPROVED |\n| Catalogue updatedAt | 2026-10-11T14:46:17Z |\n';
  const result = planFreshness(parsePlan(legacy), baseCase);
  assert.equal(result.fresh, false);
  assert.equal(result.recorded, null);
});

test('freshness never changes the plan status (approval gates stay with the user)', () => {
  for (const status of ['DRAFT', 'APPROVED', 'IMPLEMENTED']) {
    const parsed = parsePlan(planFor(requirementFingerprint(baseCase), status));
    assert.equal(parsed.status, status);
    planFreshness(parsed, baseCase);
    assert.equal(parsed.status, status);
  }
});

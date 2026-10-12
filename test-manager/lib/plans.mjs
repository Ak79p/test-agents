// Plan freshness for tests/plans/<ID>.md. A plan is tied to the case's *requirements*, not to its
// tracking fields: it records a fingerprint of the requirement-bearing fields, and it is stale only
// when that fingerprint no longer matches the catalogue. Freshness never changes a plan's status;
// approval (DRAFT → APPROVED) stays with the user.
import { createHash } from 'node:crypto';

/** The fields that define what a case tests. Tracking fields (automationStatus, scriptPath,
 *  latestResult, lastExecuted, notes, updatedAt) are deliberately excluded. */
export const REQUIREMENT_FIELDS = ['title', 'preconditions', 'testData', 'steps', 'expectedResults'];

export const PLAN_STATUSES = ['DRAFT', 'APPROVED', 'IMPLEMENTED'];

/** Deterministic `sha256:<16 hex>` over the requirement fields, in fixed order. */
export function requirementFingerprint(test) {
  const canonical = JSON.stringify(REQUIREMENT_FIELDS.map((field) => [field, test[field] ?? null]));
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16)}`;
}

/** Reads `| Plan status | … |` and `| Requirement fingerprint | … |` from a plan's header table. */
export function parsePlan(markdown) {
  const cell = (label) => {
    const match = markdown.match(new RegExp(`^\\|\\s*${label}\\s*\\|\\s*\`?([^|\`]+?)\`?\\s*\\|`, 'm'));
    return match ? match[1].trim() : null;
  };
  return { status: cell('Plan status'), fingerprint: cell('Requirement fingerprint') };
}

/** Compares a parsed plan with the current catalogue case. A plan without a fingerprint is stale. */
export function planFreshness(plan, test) {
  const current = requirementFingerprint(test);
  if (!plan.fingerprint) {
    return { fresh: false, current, recorded: null, reason: 'The plan records no requirement fingerprint; refresh it before use.' };
  }
  if (plan.fingerprint !== current) {
    return { fresh: false, current, recorded: plan.fingerprint, reason: 'Requirement fields changed since the plan was written; re-plan.' };
  }
  return { fresh: true, current, recorded: plan.fingerprint, reason: 'Requirement fields match the plan.' };
}

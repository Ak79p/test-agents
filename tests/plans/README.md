# Test implementation plans

One file per catalogue case: `tests/plans/<ID>.md`, written by the `test-planner` agent when you ask Claude **`Plan <ID>`**.

A plan describes **how** a case will be automated:
* the framework changes needed (fixtures, helpers, config, env variable names);
* how each step and expected result maps to code;
* test data and isolation;
* risks.

It is **not** a requirements document. *What* is tested stays in the catalogue (`test-manager/data/catalogue.json`), and the plan quotes it verbatim.

Lifecycle:
1. `Plan AUTH-API-001` creates the plan with status `DRAFT`. No code or catalogue changes.
2. You review and edit the plan, then set `Plan status` to `APPROVED` (or tell Claude "approve the plan for AUTH-API-001").
3. `Automate AUTH-API-001` (or `Automate thorough AUTH-API-001`): a `DRAFT` or `APPROVED` plan always routes to thorough mode. The engineer implements exactly the approved plan, and the validator checks the code against both the plan and the catalogue.
4. Once the validator reports PASSED with every expected result covered, and the test is at the catalogue `scriptPath`, the orchestrator sets `Plan status` to `IMPLEMENTED` and adds a dated Revision-history line. An `IMPLEMENTED` plan no longer forces thorough mode; later changes must stay consistent with it.
5. Every plan records a `Requirement fingerprint`: a SHA-256 of the case's title, preconditions, test data, steps and expected results (`node test-manager/scripts/case.mjs fingerprint <ID>`). `node test-manager/scripts/case.mjs plan <ID>` compares it with the catalogue: exit 0 = fresh, exit 4 = stale. If a requirement field changes, the plan is stale whatever its status: re-plan before automating. Tracking-only updates (automation status, script path, result, dates, notes, `updatedAt`) never make a plan stale. A plan without a fingerprint counts as stale until refreshed. Staleness never changes a plan's status.

Statuses: `DRAFT` (written by test-planner) → `APPROVED` (only you set this) → `IMPLEMENTED` (set by the orchestrator only after validation confirms full coverage).

Plans are optional: `Automate <ID>` without a plan still works and plans inline.

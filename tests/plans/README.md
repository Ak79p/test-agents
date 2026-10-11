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
3. `Automate thorough AUTH-API-001` (fast mode stops when a plan file exists): the engineer implements exactly the approved plan, and the validator checks the code against both the plan and the catalogue.
4. If the catalogue case changes later (its `updatedAt` no longer matches the plan), the plan is stale. Re-plan before automating.

Plans are optional: `Automate <ID>` without a plan still works and plans inline.

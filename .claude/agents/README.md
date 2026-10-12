# Agents

Each agent has one job, a fixed input, a fixed output and hard boundaries. The orchestrator is the main Claude session following [CLAUDE.md](../../CLAUDE.md); setup and troubleshooting are in [../README.md](../README.md). The agents run only in **thorough mode** (`Automate thorough <ID>`, Plan, Review, Debug, Update, k6). Plain `Automate <ID>` uses fast mode in the main session without subagents.

## test-case-reader
* **Purpose:** turn an ID into the authoritative requirement.
* **Input:** one ID, exactly as given.
* **Does:** `node test-manager/scripts/case.mjs show <ID>` (exact, case-sensitive); classifies TYPE (API / UI / HYBRID / PERFORMANCE) from the case's layer and steps; maps acceptance criteria 1:1 to `expectedResults`.
* **Output:** `STATUS`, ID, TITLE, TYPE + reason, TARGET project/folder, PRIORITY, current tracking fields, **verbatim SPEC JSON**, AC list, open questions.
* **Boundaries:** read-only; stops on NOT_FOUND / DUPLICATED / ERROR; never suggests a substitute ID or edits requirements.

## test-planner
* **Purpose:** decide *how* to automate a case before any code is written, including framework changes.
* **Input:** reader block (verbatim), explorer findings, optional user guidance ("extend the framework with an auth fixture").
* **Does:** reads the current framework (page objects, components, clients, fixtures, test data) and lists what the case reuses; proposes new accessors on existing classes before new abstractions, and justifies any new page object, component, client or helper by naming the cases that will reuse it; keeps the test locator-free; maps each step to actions and each expected result to exact assertions; identifies dependencies, risks, side effects, cleanup and flakiness controls; writes `tests/plans/<ID>.md` (status DRAFT, template in the agent file).
* **Output:** `STATUS`, plan path, framework-change summary, open questions, next step.
* **Boundaries:** writes only the plan file; never changes requirements, code, config or the catalogue; never marks a plan APPROVED.

## playwright-mcp-explorer
* **Purpose:** ground the spec in the real running app before code is written.
* **Input:** the reader block (verbatim) and TYPE.
* **Does:** preflight (API health, UI reachable, MCP tools present). Explores only what existing page objects, clients and tests don't already settle; source-only by default when a walk-through would need credentials; never changes data other cases depend on. For UI/hybrid it walks those steps with Playwright MCP (`browser_navigate`, `browser_snapshot`, `browser_click`, …) and records URLs, `data-testid`s, roles, exact messages and network calls, mapping each locator to an existing or proposed page-object accessor. For API it reads routers/schemas or OpenAPI and confirms with `curl`.
* **Output:** step-by-step observations, verified locators, an AC observed/not-observed check, spec mismatches, side effects created.
* **Boundaries:** no test code; local URLs only; no `dev/reset` or simulation changes without permission; avoids creating payments unless a step needs it; read-only `browser_evaluate`; secrets redacted.

## test-automation-engineer
* **Purpose:** write exactly one permanent test.
* **Input:** reader block (verbatim), explorer findings, TYPE/TARGET.
* **Does:** adds the test to the file given by `case.mjs placement <ID>` (`tests/playwright/{api|ui}/<area>-<kind>.spec.ts`, or `tests/k6/scripts/<ID>.js` when k6 is explicitly requested, built on `tests/k6/config` and `lib`, safe by default, validated with `npm run perf:check`). Title starts with the ID and carries the native tags (`@ui`/`@api` + area); one `test.step` per catalogue step; searches for and reuses existing page objects, components, clients, fixtures and test data before creating anything; keeps the spec locator-free (page-object accessors and actions for UI, `api-clients/` over `apiAs` for API); config via `config/env.ts`; spec-exact assertions visible in the test; `dev` fixture for reset/simulation; no sleeps. Self-checks with `--list`, `npm run typecheck` and `npm run check:locators`.
* **Output:** `STATUS`, files, project, exact run command, AC → assertion mapping, assumptions, blockers.
* **Boundaries:** no other cases, no app changes, no unrelated refactors, no hard-coded secrets; a new abstraction only when nothing existing covers the need, with its reuse named and documented in FRAMEWORK.md.

## test-validator
* **Purpose:** independent check plus the real execution result.
* **Input:** reader block, engineer report (or a file path for Review/Debug).
* **Does:** static review (an expected-result coverage table, where any missing part means CHANGES_REQUIRED; steps and ACs covered with exact values and visible in the test, no loosened assertions, locator-free via `npm run check:locators`, reuse of existing abstractions, isolation and cleanup, conventions, no secrets); `npm run typecheck`; preflight; runs `npx playwright test <file> --project=<p> --reporter=list` (plus `--repeat-each=3` for UI/async cases, and the full suite when shared framework code changed); for k6, only a 1-VU/1-iteration smoke; classifies failures (TEST DEFECT / APP DEFECT / SPEC ISSUE / ENVIRONMENT / FLAKY) with evidence.
* **Output:** `REVIEW` checklist, `RESULT` (PASSED / FAILED / BLOCKED / NOT_RUN), exact command, timestamp, evidence (reporter summary, trace/screenshot paths), recommendation.
* **Boundaries:** no file-editing tools; never changes assertions; never reports a run that didn't happen.

## test-catalogue-updater
* **Purpose:** persist evidence-based tracking data.
* **Input:** ID, engineer report, validator report.
* **Does:** chooses values from the evidence table in its file, runs `node test-manager/scripts/case.mjs update <ID> …` with `--note` (appends a timestamped line), then reads the case back to confirm.
* **Output:** `STATUS` (UPDATED / NOT_UPDATED / SKIPPED), old→new for each field, the note added, the verification command.
* **Boundaries:** tracking fields only (`automationStatus`, `scriptPath`, `latestResult`, `lastExecuted`, `notes`); never hand-edits JSON; never `passed` without a successful run; never `automated` without an existing script; preserves user notes and all other cases.

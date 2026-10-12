# CLAUDE.md – FeeFlow SDET workspace

Local practice app: FastAPI + SQLite backend (`backend/`, :8000), React + Vite frontend (`frontend/`, :5173). Testing workspace: Playwright Test (`tests/playwright/`), k6 (`tests/k6/`), test catalogue (`test-manager/`), Claude agents (`.claude/agents/`). Overview: [README.md](README.md).

## Start of every automation session (mandatory)
Before writing test code in a session, do these once, then reuse what you learned:
1. Read [tests/playwright/FRAMEWORK.md](tests/playwright/FRAMEWORK.md), the framework guide.
2. Inspect the current implementation it names: `tests/playwright/fixtures/index.ts`, `tests/playwright/pages/` (and `pages/components/`), `tests/playwright/api-clients/`, `tests/playwright/test-data/`, and the placement file for the case.
3. Run `git status --short tests/playwright test-manager` so you build on uncommitted changes rather than overwriting them.

If the guide and the code disagree, the code is the current behaviour: follow it and update the guide in the same change. Never invent a new pattern silently. Search for an existing page object, component, client, fixture or test-data entry before creating one; prefer adding an accessor or method to an existing class. Add a new abstraction only when the case needs a screen or resource nothing covers, or it removes real duplication or manages a lifecycle, and name the catalogue cases that will reuse it.

## ID-Driven Test Automation Workflow

Applies whenever the user refers to a catalogue test case ID, for example:

| Request | Mode / agents (in order) | Writes code? | Updates catalogue? |
|---|---|---|---|
| `Automate AUTH-UI-002` (also `… and run it`) | **Fast mode** (default) when the routing gate below passes: main session only, no subagents. Otherwise stop and recommend `Automate thorough <ID>` with the reason | yes | yes |
| `Automate thorough AUTH-API-001` (explicit override: always thorough) | reader → explorer (if relevant) → engineer → validator (runs it) → updater | yes | yes |
| `Plan AUTH-API-001` (optionally with guidance, e.g. "…by extending the framework with an auth fixture") | reader → explorer (if relevant) → **test-planner** → stop for user review | plan file only (`tests/plans/<ID>.md`) | **no** |
| `Review AUTH-API-001 without implementing it` | reader → explorer (optional) → validator (static review of an existing script, if any; run only if asked) | **no** | **no** |
| `Debug AUTH-API-001` | reader → validator (run + classify) → engineer (fix **test defects only**) → validator → updater | test code only | yes |
| `Update AUTH-API-001: I ran it manually today, it failed – <reason>` | reader → updater (tracking fields only, from the evidence the user states; the note records "reported by user") | no | yes |
| `Implement the k6 test for <ID>` (usually after `Plan <ID>`) | reader (must be a Performance case) → explorer (API source/OpenAPI, when needed) → engineer (k6, per the APPROVED plan) → validator (`npm run perf:check` + 1-iteration smoke only) → updater (records a **smoke** result) | yes | yes |
| `Run the load profile for <ID>` | only with the user's explicit approval for that run (case, profile, target); APPROVED plan required; sets `PERF_ALLOW_LOAD=yes` for that run only; report metrics and thresholds without changing acceptance criteria | no | yes (load result) |

Agents live in `.claude/agents/`: `test-case-reader`, `test-planner`, `playwright-mcp-explorer`, `test-automation-engineer`, `test-validator`, `test-catalogue-updater`. Details: [.claude/README.md](.claude/README.md).

### Choosing the mode
`Automate thorough <ID>` always runs thorough mode (explicit override). `Automate <ID>` runs fast mode **when existing abstractions cover the case and its behaviour is understood**. A reset handled by the `dev` fixture (`dev.reset()` before login) or a restore to defaults (`dev.restoreSimulation()`) does **not** by itself require thorough mode, and neither does simple missing/malformed-header validation. Thorough mode is required when any of these is true:
* a plan file exists with status `DRAFT` or `APPROVED`, or it is stale (`node test-manager/scripts/case.mjs plan <ID>` exits 4: its `Requirement fingerprint` no longer matches the case's title, preconditions, test data, steps and expected results; tracking-only updates never make a plan stale): the thorough flow applies the approval workflow (`Plan <ID>` → you approve → `Automate <ID>`). An `IMPLEMENTED` plan whose script matches the catalogue `scriptPath` doesn't force thorough mode;
* the case is Performance/k6 (k6 scripts only on an explicit k6 request; load runs only with explicit permission);
* it changes simulation settings (`dev.setSimulation`), or tests idempotent **replay** or **conflict** semantics, or sends **concurrent** requests;
* it needs more than one user identity;
* it needs a new page object, component, fixture or workflow helper (a missing abstraction). Exception: a new **thin API client** is allowed in fast mode: a stateless class that wraps an existing request context (`request`, `api` or `apiAs(…)`), whose methods only build a request and return the raw Playwright `APIResponse`, with no lifecycle, state, retries, polling or assertions (FRAMEWORK.md §5);
* an expected result needs an observation window (proving something does **not** happen or **stops** happening over time), or a wait longer than the default 10 s expect timeout;
* the case is already automated and its existing test doesn't assert every expected result (a coverage gap; see fast step 2);
* the spec is ambiguous or contradicts itself, or the behaviour can't be settled from existing tests plus one targeted source lookup;
* fast mode hit an unexplained failure (after its one fix).

When fast mode stops, say which condition triggered it. Thorough mode is for better reasoning and validation, not more code.

### Fast mode (default for `Automate <ID>`)
One context, no subagents, minimal reads. Aim for about 6–12 tool calls on a straightforward case.

1. **Resolve:** `node test-manager/scripts/case.mjs show <ID>` is the only requirement source, and `node test-manager/scripts/case.mjs placement <ID>` (same batch) is the only source for the file, project, tags and run command. Don't open `catalogue.json` or other cases. A non-zero exit (not found or duplicated) means stop and ask the user.
2. **Gate:** in the same batch, check whether `tests/plans/<ID>.md` exists (and its status) and grep `tests/playwright` (and `tests/k6`) for the ID (an existing test means edit it in place, never duplicate it). **If a test already exists, compare every catalogue expected result with its assertions first** and list each as covered or missing; any missing check is a coverage gap. Apply "Choosing the mode" above; if any thorough condition holds, stop and recommend `Automate thorough <ID>` with the reason (or ask).
3. **Context:** use the framework facts below and the session-start reads instead of re-reading the README, config or `env.ts`. Read the placement file (if it exists), the closest existing test, and the page objects/clients the case will use. Look at app source only for what those don't already expose.
4. **Explore only when unknown:** settle it from source first (page objects, existing tests, app source). Use Playwright MCP only if source can't settle a locator, flow or message **and** the walk-through needs no credentials in context; otherwise rely on source plus the live test run. Use the fewest steps that settle it. No `dev/reset`, simulation calls or data-changing actions (see Guardrails).
5. **Implement** following the test-file rules below: append the test to the placement file (create it at that exact path if missing), keeping every existing test intact. A small accessor or method added to an existing page object or client is fine in fast mode, and so is a new **thin API client** is allowed in fast mode: a stateless class that wraps an existing request context (`request`, `api` or `apiAs(…)`), whose methods only build a request and return the raw Playwright `APIResponse`, with no lifecycle, state, retries, polling or assertions (FRAMEWORK.md §5). A new page object, component, fixture or workflow helper is not (missing abstraction → thorough).
6. **Run once:** the placement `command` (`cd tests/playwright && npx playwright test <file> --project=<project> --grep <ID> --reporter=list`), then `npm run typecheck` and `npm run check:locators` (both from `tests/playwright`). Don't add `--repeat-each` or the full suite.
7. **One fix at most:** on failure, classify it as a test defect, app defect or environment problem.
   * Test defect: make one targeted fix and one re-run. If it still fails, stop and report.
   * App defect: keep the assertion and report expected vs actual plus the trace path.
   * Environment (app down, missing `.env` value): report the blocker with the startup commands.
8. **Record:** run one `node test-manager/scripts/case.mjs update <ID> …`. The CLI validates and prints the saved fields, so don't do a `show` read-back or run `npm run validate`. Values come from evidence only:
   * passed → `--automation-status automated --result passed --executed today`
   * failed with a complete, correct script → `automated` / `failed` / today
   * blocked → `in progress` / `blocked` / today
   * not run → `in progress`, with result and date unchanged

   Always pass `--script-path <placement scriptPath>` (the CLI rejects any other path) and `--note "<RESULT> via: <command> | <reporter summary>"`. Never use `--notes`.
9. **Report in 10 lines or fewer:**
   * the file changed;
   * assertions covered (one short line per expected result);
   * the command and its working directory;
   * the real result (reporter summary);
   * catalogue fields changed;
   * any blocker.

   No plans, checklists or repeated spec text.

### Framework facts (fast mode; no need to re-read)
* **Deterministic placement (never choose a path by judgment).** The file is derived from the ID `<AREA>-<KIND>-<NNN>` by `placementFor()` in `test-manager/lib/catalogue.mjs`; print it with `case.mjs placement <ID>`. All cases of one `<AREA>-<KIND>` share one file; the validator rejects any other `scriptPath`.
  * `*-UI-*` → `tests/playwright/ui/<area>-ui.spec.ts` (e.g. `AUTH-UI-001`, `AUTH-UI-003` → `ui/auth-ui.spec.ts`), project `ui-chromium` (`ui-mobile` when the title has `@mobile`). Start with `loginPage.loginAs(env.testUser)` (or `loginPage.goto()` when the login form is under test).
  * `*-API-*` → `tests/playwright/api/<area>-api.spec.ts` (e.g. `PAY-API-003` → `api/pay-api.spec.ts`), project `api`. Paths are relative with no leading slash (`request.post('auth/login')`).
  * `*-PERF-*` → `tests/k6/scripts/<ID>.js` (k6 only, on explicit request).
  * A UI case that also checks an API response or localStorage stays in `ui/` and uses the `api` fixture. `hybrid/` is used only if the catalogue defines a Hybrid layer (it currently doesn't).
* **Tags (native Playwright `tag` option):** `test('<ID> <title>', { tag: ['@ui', '@auth'] }, async …)`. Layer tag `@ui`/`@api` (`@hybrid` for hybrid) plus the area tag from `placement` (`@auth`, `@payments`, `@fees`, `@transactions`). k6 scripts use `options.tags = { category: 'performance', case_id: '<ID>' }` instead.
* Config: `import { env } from '../config/env'`. It provides `env.baseUrl`, `env.apiBaseUrl` (with a trailing `/`), `env.testUser.{email,password}`, `env.secondaryUser.{email,password}` and `env.loadtestUser` (loadtest050, the payment-writing account), read lazily from `tests/playwright/.env`.
* Imports: `import { test, expect } from '../fixtures'`. Page-object fixtures (`pages/`, not navigated): `loginPage` (`loginAs(user)`, `login()`, form locators, `storedSession()`, `sessionToken()`), `dashboardPage` (stats, student cards, `feeRow(id)`/`feeRowAt(i)`/`feeStatusBadge(id)`, `payFee(id)`, `payFirstFee()`, `filterByStudent(label)`, `waitForFees()`), `checkoutPage` (`goto(feeId)`, `amountError`, `chooseCustomAmount()`, `continueToPayment()`, `readSummary()`, `fillCard(card)`, `submitPayment()` → `{ confirmed }`, `pay()`), `paymentPage` (status `root`, success/failure panels, `statusBadge`, details, timeline, `backToDashboard()`, `tryAgain()`), `feeDetailPage` (`goto(feeId)`, `amountPaid`, `balance`, `statusBadge`), `transactionsPage` (`rowAt(i)` → reference/fee/student/method/status/amount, `open()`), `appNav` (`openTransactions()`, `logout()`). API: `api` (unauthenticated, auto-disposed), `apiAs(user)` (Bearer context, auto-disposed) wrapped in clients from `api-clients/` (`PaymentsApi`: `create(body, key?)`, `get(id)`; `FeesApi`: `outstanding()`, `get(id)`). `dev`: `reset()`, `setSimulation(changes)`, `restoreSimulation()` (restored in teardown even on failure; `reset()` refuses more than one worker). The automatic `appHealth` fixture fails tests at once with the startup command if the app is down. Cards: `import { testCards } from '../test-data/cards'`. No authenticated-page fixture: `await dev.reset()` (when freshly seeded) then `await loginPage.loginAs(env.testUser)`. Full table: FRAMEWORK.md §3–5.
* The session is stored in `localStorage` under `feeflow.session`, and the login API is `POST /api/v1/auth/login`. Test IDs for new accessors: `docs/APPLICATION.md` §13, or grep `frontend/src`.
* Timeouts: expect 10 s, action 10 s, 1 worker (shared SQLite). Traces and screenshots are kept on failure in `tests/playwright/test-results/`.

### Test-file rules (both modes; full list in FRAMEWORK.md §2)
* One test per ID with the title `'<ID> <catalogue title>'` and the placement tags, and one `test.step('S<n> …')` per catalogue step.
* Every expected result becomes visible web-first assertions in the test with the spec's exact values. Never drop, merge or loosen one. Don't add assertions the spec doesn't ask for (sync points and pre-capture guards are fine).
* **Locator-free tests:** no `getBy*`, `locator(`, `.nth/.first/.last/.filter/.and/.or` on a locator, `$`/`$$` or `waitForSelector` in spec files. Use page-object/component accessors and actions; if one is missing, add a named accessor to the right page object (locator priority there: `getByTestId`, then `getByRole`, then `getByLabel`). API requests go through `api-clients/` when a client exists for the resource. `npm run check:locators` enforces this.
* Page objects, components and clients never assert; assertions stay in the test.
* No single-use helpers, constants or comments; no base classes, factories or singletons.
* "No request sent" checks: one `page.on('request')` listener that collects matching URLs, asserted with `expect(urls).toEqual([])`.
* No fixed sleeps, no try/catch around `expect`, no `skip`/`fixme`, no hard-coded secrets or base URLs, no logging of credentials.

### Thorough mode (`Automate thorough <ID>`, Plan, Review, Debug, Update, k6)
The main session is the orchestrator.
1. **Resolve the exact ID first** with `test-case-reader` (`node test-manager/scripts/case.mjs show <ID>`). Not found, duplicated or ambiguous → **stop and ask the user**. Never create, rename or substitute a case. Never infer behaviour from the ID alone.
2. **Pass the reader's output verbatim** (STATUS…OPEN QUESTIONS block, including the SPEC JSON) to the agents that need the requirement: explorer, planner, engineer and validator. Pass later findings as short summaries, not full reports. The updater gets only the ID, script path, command, result and evidence line. Agents must not re-read or reinterpret requirements independently.
3. **Explore only what's unknown.** Call `playwright-mcp-explorer` when the case touches a screen, flow, message or endpoint that existing page objects, clients and tests don't already settle; tell it what's already covered so it checks only the gaps. **Source-only exploration is the default** whenever a browser walk-through would need credentials in the agent's context (logging in); the validator's live run is then the first browser check. Use MCP where it is safe (no credentials needed) and necessary. Ask the user only when source and safe live validation can't resolve an ambiguity that matters to the assertions. Exploration must not change data other cases depend on (see Guardrails).
4. **Use an approved plan if one exists.** Before implementing, check `tests/plans/<ID>.md`.
   * If it's `APPROVED`, pass it to the engineer and validator alongside the reader block. The engineer implements exactly that plan, including its framework changes.
   * If it's `DRAFT`, ask the user whether to approve it, re-plan, or ignore it.
   * If it's `IMPLEMENTED`, pass it along as the design the existing test follows; changes must stay consistent with it.
   * Run `node test-manager/scripts/case.mjs plan <ID>`. Exit 4 (stale) means the requirement fields changed since the plan, or the plan records no fingerprint: say so and re-plan (or, when only the fingerprint row is missing and the requirements are verified unchanged, refresh that row with the user's agreement). Staleness never changes a plan's status, and a stale plan is never implemented or marked IMPLEMENTED.
   * With no plan, the engineer plans inline.
   * After the validator reports PASSED **and** full acceptance-criteria coverage, and the test is at the catalogue `scriptPath`, the orchestrator sets the plan's `Plan status` to `IMPLEMENTED` and adds a dated Revision-history line. Never mark a plan implemented otherwise, and never skip `DRAFT` → `APPROVED` (only the user approves).
4a. **Already-automated case:** the engineer first compares every catalogue expected result with the existing assertions, adds only the missing checks, and never weakens, removes or rewrites existing assertions or acceptance criteria.
5. **Implement only the requested case** with `test-automation-engineer`, unless the user explicitly asks for a batch. k6 scripts are written only on an explicit k6 request.
6. **Validate with `test-validator`**, which reviews the code (including the locator-free rule, cleanup and an expected-result-by-expected-result coverage check), runs `npm run typecheck` and `npm run check:locators`, and runs the test with the real command (plus the full suite when shared framework code changed). Run whenever practical; it is mandatory when the user says "run".
7. **Record evidence with `test-catalogue-updater`** (CLI `update`). Never mark `automated` or `passed` without the evidence the updater's rules require.
8. **Report to the user:** files changed, the exact command(s) run and their working directory, the real result, the catalogue fields changed, and open issues.

Subagents cannot launch other subagents, so the main session calls each one in turn (Agent tool, `subagent_type` = agent name). If agent delegation is unavailable, perform the same steps directly, following each agent file as a checklist.

### Failure handling
* **App down** (the `appHealth` fixture's `… is not reachable …` error): report it with the startup commands (`scripts\start-backend.ps1`, `scripts\start-frontend.ps1`). Don't fake results.
* **Missing credentials or data** (e.g. `tests/playwright/.env` lacks `TEST_USER_PASSWORD`): report the blocker. Never invent or hard-code values.
* **Assertion failure:** keep the assertion and report expected vs actual with trace/screenshot paths. An app defect is a finding, not something to "fix" in the test or the app.
* **Flaky test:** investigate the cause (timing, shared data, async settlement) before touching timeouts or retries.
* **Time windows:** use condition-based waits. When an expected result needs an observation window ("no further requests", "stays PENDING"), derive its length from the app's documented interval (e.g. one full `retry_after_ms`), express it as a wait for the unwanted event that must time out, and name it in the test. Never add arbitrary fixed sleeps.
* **Fix loop:** fast mode allows one targeted fix and one re-run. Thorough mode allows at most 2 engineer→validator rounds after a TEST DEFECT. Then report.
* **Catalogue update rejected:** report the CLI error. Don't claim it was updated.

### Guardrails
* Local targets only (`localhost:5173`, `127.0.0.1:8000`). No real payment providers or external services.
* No load profiles during functional validation (k6 validation = `npm run perf:check` plus a 1 VU / 1 iteration smoke). k6 implementation is opt-in, and never start a significant load run without the user's explicit permission. Never set `PERF_ALLOW_LOAD=yes` or `PERF_ALLOWED_HOST` on your own; both need the user's explicit approval for that run (tests/k6/README.md §7).
* `POST /api/v1/dev/reset` and `/dev/simulation` are allowed only inside tests whose preconditions require them, never during exploration without permission.
* **Exploration must not change shared data** used by other cases (their named accounts, fees and seeded records). Prefer read-only checks. If a step must create data, use a dedicated scratch account that no catalogue case references, or restore the affected state and verify the restoration. Today every seeded `loadtestNNN` account (001–050) is referenced by the catalogue, so no scratch account exists: data-changing exploration needs the user's permission and a verified restore (e.g. `dev/reset` afterwards, with permission).
* Don't modify application code, other test cases, catalogue requirements (title/steps/expected results) or unrelated files. (One-off exception the user authorised: the 2026-10-12 locator-free refactor of the eight tests that existed then.)
* Never log or echo passwords and tokens.

### Commands
* Read a case: `node test-manager/scripts/case.mjs show <ID>`
* Plan status and freshness: `node test-manager/scripts/case.mjs plan <ID>` (exit 0 fresh or no plan, 4 stale); requirement fingerprint: `node test-manager/scripts/case.mjs fingerprint <ID>`
* Where a case lives (file, project, tags, run command): `node test-manager/scripts/case.mjs placement <ID>`
* Run one Playwright case: `cd tests/playwright && npx playwright test --grep <ID>` (or `npx playwright test <file> --project=<api|ui-chromium|ui-mobile> --grep <ID>`)
* Run by category/tag: `npm run test:ui` · `npm run test:api` · `npm run test:hybrid` · `npx playwright test --grep "@auth"`
* Typecheck and locator check: `cd tests/playwright && npm run typecheck && npm run check:locators`
* Validate the catalogue: `cd test-manager && npm run validate`
* k6 (from `tests/k6`): `npm run perf:check` (static, no load) · `npm run perf:smoke` · `npm run perf:read` (smoke profile by default) · `npm run perf:baseline` (opt-in, approval required)

Detailed docs: [tests/playwright/README.md](tests/playwright/README.md) · [tests/k6/README.md](tests/k6/README.md) · [test-manager/README.md](test-manager/README.md) · [.claude/agents/README.md](.claude/agents/README.md)

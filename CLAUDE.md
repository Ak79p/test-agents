# CLAUDE.md – FeeFlow SDET workspace

Local practice app: FastAPI + SQLite backend (`backend/`, :8000), React + Vite frontend (`frontend/`, :5173). Testing workspace: Playwright Test (`tests/playwright/`), k6 (`tests/k6/`), test catalogue (`test-manager/`), Claude agents (`.claude/agents/`). Overview: [README.md](README.md).

## Start of every automation session (mandatory)
Before writing test code in a session, do these once, then reuse what you learned:
1. Read [tests/playwright/FRAMEWORK.md](tests/playwright/FRAMEWORK.md), the framework guide.
2. Inspect the current implementation it names: `tests/playwright/fixtures/index.ts`, `tests/playwright/pages/`, and the placement file for the case.
3. Run `git status --short tests/playwright test-manager` so you build on uncommitted changes rather than overwriting them.

If the guide and the code disagree, the code is the current behaviour: follow it and update the guide in the same change. Never invent a new pattern silently. Reuse existing fixtures and page objects, and add a new one only when two or more tests need it.

## ID-Driven Test Automation Workflow

Applies whenever the user refers to a catalogue test case ID, for example:

| Request | Mode / agents (in order) | Writes code? | Updates catalogue? |
|---|---|---|---|
| `Automate AUTH-UI-002` (also `… and run it`) | **Fast mode** (default): main session only, no subagents (see below) | yes | yes |
| `Automate thorough AUTH-API-001` | reader → explorer (if relevant) → engineer → validator (runs it) → updater | yes | yes |
| `Plan AUTH-API-001` (optionally with guidance, e.g. "…by extending the framework with an auth fixture") | reader → explorer (if relevant) → **test-planner** → stop for user review | plan file only (`tests/plans/<ID>.md`) | **no** |
| `Review AUTH-API-001 without implementing it` | reader → explorer (optional) → validator (static review of an existing script, if any; run only if asked) | **no** | **no** |
| `Debug AUTH-API-001` | reader → validator (run + classify) → engineer (fix **test defects only**) → validator → updater | test code only | yes |
| `Update AUTH-API-001: I ran it manually today, it failed – <reason>` | reader → updater (tracking fields only, from the evidence the user states; the note records "reported by user") | no | yes |
| `Implement the k6 test for <ID>` | reader (must be a Performance case) → engineer (k6) → validator (1-VU smoke only) → updater | yes | yes |

Agents live in `.claude/agents/`: `test-case-reader`, `test-planner`, `playwright-mcp-explorer`, `test-automation-engineer`, `test-validator`, `test-catalogue-updater`. Details: [.claude/README.md](.claude/README.md).

### Fast mode (default for `Automate <ID>`)
One context, no subagents, minimal reads. Aim for about 6–10 tool calls on a straightforward case.

1. **Resolve:** `node test-manager/scripts/case.mjs show <ID>` is the only requirement source, and `node test-manager/scripts/case.mjs placement <ID>` (same batch) is the only source for the file, project, tags and run command. Don't open `catalogue.json` or other cases. A non-zero exit (not found or duplicated) means stop and ask the user.
2. **Gate:** in the same batch, check whether `tests/plans/<ID>.md` exists and grep `tests/playwright` (and `tests/k6`) for the ID (an existing test means edit it in place, never duplicate it). Stop and recommend `Automate thorough <ID>` (or ask) if any of these is true:
   * a plan file exists;
   * the case is Performance/k6;
   * it needs `dev/reset`, simulation changes or shared-data setup;
   * the spec is ambiguous or contradicts itself;
   * the behaviour can't be settled from existing tests plus one targeted source lookup.
3. **Context:** use the framework facts below and the session-start reads instead of re-reading the README, config or `env.ts`. Read the placement file (if it exists) and the one relevant page/router source (grep for the step's `data-testid`s and messages).
4. **Explore only when unknown:** use Playwright MCP only if a locator, flow or message can't be confirmed from existing tests or source. Use the fewest steps that settle it. No `dev/reset` or simulation calls.
5. **Implement** following the lean code rules below: append the test to the placement file (create it at that exact path if missing), keeping every existing test intact.
6. **Run once:** the placement `command` (`cd tests/playwright && npx playwright test <file> --project=<project> --grep <ID> --reporter=list`). Don't add `--repeat-each`, `--list` or git checks. Run `npm run typecheck` only if you changed shared code (`config/`, `fixtures/`, `playwright.config.ts`).
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
  * `*-UI-*` → `tests/playwright/ui/<area>-ui.spec.ts` (e.g. `AUTH-UI-001`, `AUTH-UI-003` → `ui/auth-ui.spec.ts`), project `ui-chromium` (`ui-mobile` when the title has `@mobile`). Use `page.goto('/login')`.
  * `*-API-*` → `tests/playwright/api/<area>-api.spec.ts` (e.g. `PAY-API-003` → `api/pay-api.spec.ts`), project `api`. Paths are relative with no leading slash (`request.post('auth/login')`).
  * `*-PERF-*` → `tests/k6/scripts/<ID>.js` (k6 only, on explicit request).
  * A UI case that also checks an API response or localStorage stays in `ui/`; get an API context there with `playwright.request.newContext({ baseURL: env.apiBaseUrl })` and dispose it. `hybrid/` is used only if the catalogue defines a Hybrid layer (it currently doesn't).
* **Tags (native Playwright `tag` option):** `test('<ID> <title>', { tag: ['@ui', '@auth'] }, async …)`. Layer tag `@ui`/`@api` (`@hybrid` for hybrid) plus the area tag from `placement` (`@auth`, `@payments`, `@fees`, `@transactions`). k6 scripts use `options.tags = { category: 'performance', case_id: '<ID>' }` instead.
* Config: `import { env } from '../config/env'`. It provides `env.baseUrl`, `env.apiBaseUrl` (with a trailing `/`), `env.testUser.{email,password}` and `env.secondaryUser.{email,password}`, read lazily from `tests/playwright/.env`.
* Imports: `import { test, expect } from '../fixtures'`. Fixtures: `loginPage` (`pages/login-page.ts`: `goto()`, `login(email, password)`, form locators) and `api` (an `APIRequestContext` at `env.apiBaseUrl`, auto-disposed). There is no authenticated-page fixture. Details: FRAMEWORK.md §3–4.
* Login page test IDs (verified): `email-input`, `password-input`, `login-button`, `email-error`, `password-error`, `login-error` (role=alert). The session is stored in `localStorage` under `feeflow.session`, and the login API is `POST /api/v1/auth/login`. Other test IDs: `docs/APPLICATION.md` §13, or grep `frontend/src`.
* Timeouts: expect 10 s, action 10 s, 1 worker (shared SQLite). Traces and screenshots are kept on failure in `tests/playwright/test-results/`.

### Lean code rules (both modes)
* One test per ID with the title `'<ID> <catalogue title>'` and the placement tags, and one `test.step('S<n> …')` per catalogue step.
* Every expected result becomes direct web-first assertions with the spec's exact values. Never drop, merge or loosen one. Don't add assertions the spec doesn't ask for, except a `waitForResponse` used as a sync point.
* Locators: `getByTestId`, then `getByRole`, then `getByLabel`. No CSS or XPath unless nothing else exists.
* Inline code by default: no helpers, constants, page objects, fixtures or comments for single-use logic.
* "No request sent" checks: one `page.on('request')` listener that collects matching URLs, asserted with `expect(urls).toEqual([])`.
* No fixed sleeps, no try/catch around `expect`, no `skip`/`fixme`, no hard-coded secrets or base URLs, no logging of credentials.

### Thorough mode (`Automate thorough <ID>`, Plan, Review, Debug, Update, k6)
The main session is the orchestrator.
1. **Resolve the exact ID first** with `test-case-reader` (`node test-manager/scripts/case.mjs show <ID>`). Not found, duplicated or ambiguous → **stop and ask the user**. Never create, rename or substitute a case. Never infer behaviour from the ID alone.
2. **Pass the reader's output verbatim** (STATUS…OPEN QUESTIONS block, including the SPEC JSON) to the agents that need the requirement: explorer, planner, engineer and validator. Pass later findings as short summaries, not full reports. The updater gets only the ID, script path, command, result and evidence line. Agents must not re-read or reinterpret requirements independently.
3. **Explore when relevant.** UI cases go to `playwright-mcp-explorer` using the Playwright MCP tools. API cases go to it when endpoints, schemas or messages need confirming (source/OpenAPI/curl). If MCP is unavailable for a UI case, report it (setup in `.claude/README.md`) and ask whether to continue with source-only exploration.
4. **Use an approved plan if one exists.** Before implementing, check `tests/plans/<ID>.md`.
   * If it's `APPROVED`, pass it to the engineer and validator alongside the reader block. The engineer implements exactly that plan, including its framework changes.
   * If it's `DRAFT`, ask the user whether to approve it, re-plan, or ignore it.
   * If its `Catalogue updatedAt` differs from the case's current `updatedAt`, it is stale: say so and re-plan.
   * With no plan, the engineer plans inline.
5. **Implement only the requested case** with `test-automation-engineer`, unless the user explicitly asks for a batch. k6 scripts are written only on an explicit k6 request.
6. **Validate with `test-validator`**, which reviews the code and runs it with the real command. Run whenever practical; it is mandatory when the user says "run".
7. **Record evidence with `test-catalogue-updater`** (CLI `update`). Never mark `automated` or `passed` without the evidence the updater's rules require.
8. **Report to the user:** files changed, the exact command(s) run and their working directory, the real result, the catalogue fields changed, and open issues.

Subagents cannot launch other subagents, so the main session calls each one in turn (Agent tool, `subagent_type` = agent name). If agent delegation is unavailable, perform the same steps directly, following each agent file as a checklist.

### Failure handling
* **App down:** report it with the startup commands (`scripts\start-backend.ps1`, `scripts\start-frontend.ps1`). Don't fake results.
* **Missing credentials or data** (e.g. `tests/playwright/.env` lacks `TEST_USER_PASSWORD`): report the blocker. Never invent or hard-code values.
* **Assertion failure:** keep the assertion and report expected vs actual with trace/screenshot paths. An app defect is a finding, not something to "fix" in the test or the app.
* **Flaky test:** investigate the cause (timing, shared data, async settlement) before touching timeouts or retries.
* **Fix loop:** fast mode allows one targeted fix and one re-run. Thorough mode allows at most 2 engineer→validator rounds after a TEST DEFECT. Then report.
* **Catalogue update rejected:** report the CLI error. Don't claim it was updated.

### Guardrails
* Local targets only (`localhost:5173`, `127.0.0.1:8000`). No real payment providers or external services.
* No load profiles during functional validation (k6 validation = 1 VU, 1 iteration) unless the user asks for a load run.
* `POST /api/v1/dev/reset` and `/dev/simulation` are allowed only inside tests whose preconditions require them, never during exploration without permission.
* Don't modify application code, other test cases, catalogue requirements (title/steps/expected results) or unrelated files.
* Never log or echo passwords and tokens.

### Commands
* Read a case: `node test-manager/scripts/case.mjs show <ID>`
* Where a case lives (file, project, tags, run command): `node test-manager/scripts/case.mjs placement <ID>`
* Run one Playwright case: `cd tests/playwright && npx playwright test --grep <ID>` (or `npx playwright test <file> --project=<api|ui-chromium|ui-mobile> --grep <ID>`)
* Run by category/tag: `npm run test:ui` · `npm run test:api` · `npm run test:hybrid` · `npx playwright test --grep "@auth"`
* Validate the catalogue: `cd test-manager && npm run validate`

Detailed docs: [tests/playwright/README.md](tests/playwright/README.md) · [tests/k6/README.md](tests/k6/README.md) · [test-manager/README.md](test-manager/README.md) · [.claude/agents/README.md](.claude/agents/README.md)

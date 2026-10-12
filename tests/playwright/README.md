# Playwright workspace (TypeScript)

UI, API and hybrid automation for the FeeFlow school-fee app. Tests are added one at a time, by catalogue ID, from [`test-manager/data/catalogue.json`](../../test-manager/data/catalogue.json) through the ID-driven workflow in [CLAUDE.md](../../CLAUDE.md).

**Conventions, fixtures and page objects: [FRAMEWORK.md](FRAMEWORK.md)** (read it before writing a test).

## Layout

```
tests/playwright/
├── playwright.config.ts   projects, reporters, baseURLs, optional webServer
├── config/env.ts          the only place that reads environment variables
├── api/<area>-api.spec.ts       API tests, one file per area (e.g. api/pay-api.spec.ts)  → project "api"
├── ui/<area>-ui.spec.ts         UI tests, one file per area (e.g. ui/auth-ui.spec.ts)    → "ui-chromium", "ui-mobile" (@mobile)
├── hybrid/                      reserved for a catalogue Hybrid layer (none today)        → project "hybrid"
├── fixtures/index.ts            custom test/expect and every fixture (see FRAMEWORK.md §3)
├── pages/                       page objects: login, dashboard, checkout, payment, fee detail, transactions
│   └── components/              shared UI components (app-nav.ts)
├── api-clients/                 thin API clients (payments-api.ts, fees-api.ts)
├── test-data/                   shared test data (cards.ts)
├── scripts/check-locators.mjs   fails if a spec file creates or selects a locator directly
├── .env.example           copy to .env (git-ignored)
├── package.json           Playwright deps, kept separate from the frontend
└── tsconfig.json
```

Generated output is git-ignored: `test-results/` (traces, screenshots, videos, `results.json`) and `playwright-report/` (HTML report).

## Setup

Prerequisites: Node.js 18+ (verified with 22.x), and the app running (see the [main README](../../README.md#spin-up-the-demo-app)).

```bash
cd tests/playwright
npm install
cp .env.example .env            # PowerShell: Copy-Item .env.example .env
# edit .env → set TEST_USER_PASSWORD (and SECONDARY_USER_PASSWORD) from docs/APPLICATION.md §6
npm run install:browsers        # downloads Chromium for @playwright/test 1.63.0 (skipped if already present)
```

To use an installed browser instead of the downloaded Chromium, set `PW_BROWSER_CHANNEL=msedge` (or `chrome`) in `.env`.

## Configuration

| Variable | Default | Used for |
|---|---|---|
| `BASE_URL` | `http://localhost:5173` | `baseURL` for UI projects (`page.goto('/transactions')`) |
| `API_BASE_URL` | `http://127.0.0.1:8000/api/v1` | `baseURL` for the `api` project (a trailing `/` is added automatically) |
| `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` | Thandi / *(empty)* | Primary seeded parent |
| `SECONDARY_USER_EMAIL` / `SECONDARY_USER_PASSWORD` | John / *(empty)* | Cross-parent isolation tests |
| `LOADTEST_USER_EMAIL` / `LOADTEST_USER_PASSWORD` | `loadtest050@example.com` / *(empty → falls back to `TEST_USER_PASSWORD`)* | Payment API tests (`env.loadtestUser`) |
| `PW_WORKERS` | `1` | Parallel workers (the app shares one SQLite DB) |
| `PW_BROWSER_CHANNEL` | *(bundled Chromium)* | `msedge` / `chrome` |
| `PW_START_SERVERS` | `false` | `true` = Playwright starts backend + frontend if not already running |
| `CI` | `false` | Enables retries and `forbidOnly` |

Read configuration only through `config/env.ts`, e.g. `import { env } from '../config/env'`, then `env.testUser.email`. Credentials are read lazily: a missing value throws a clear error when a test uses it, and listing tests still works.

## Commands

| Command | What it does |
|---|---|
| `npm test` | All projects |
| `npm run test:api` | `@api` tests in the `api` project |
| `npm run test:ui` | `@ui` tests in `ui-chromium` + `ui-mobile` (each test runs once: `@mobile` tests only on mobile, the rest only on desktop) |
| `npm run test:mobile` | Mobile UI project (tests tagged `@mobile`) |
| `npm run test:hybrid` | `@hybrid` tests in the `hybrid` project |
| `npm run test:headed` | Desktop UI, visible browser |
| `npm run test:debug` | Playwright Inspector |
| `npm run pw:ui` | Playwright UI mode (watch, time-travel) |
| `npm run test:list` | List discovered tests (also proves the config loads) |
| `npm run report` | Open the last HTML report |
| `npm run codegen` | Record interactions against the running UI |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check:locators` | Fails on any locator call (`getBy*`, `locator(`, `.nth/.first/…`) in a spec file; see FRAMEWORK.md §6 |

`test:api` and `test:hybrid` pass `--pass-with-no-tests`, so an empty category (currently hybrid) exits 0 with "Total: 0 tests".

Before the first test in each worker, the automatic `appHealth` fixture checks `API_BASE_URL/health` (and `BASE_URL` for browser projects). If the app is down, tests fail at once with the command to start it (`scripts\start-backend.ps1` / `scripts\start-frontend.ps1`).

### Running one test
| By | Command (from `tests/playwright/`) |
|---|---|
| Catalogue ID / title | `npx playwright test --grep AUTH-API-001` |
| Tag | `npx playwright test --grep "@ui"` · `--grep "@api"` · `--grep "@auth"` · combine: `--grep "(?=.*@ui)(?=.*@auth)"` · exclude: `--grep-invert "@payments"` |
| File + ID (the placement command) | `npx playwright test api/auth-api.spec.ts --project=api --grep AUTH-API-001` |
| File + line | `npx playwright test ui/auth-ui.spec.ts:12` |
| Repeat to detect flakiness | `npx playwright test --grep AUTH-UI-001 --repeat-each=3` |
| Headed / debug | add `--headed` or `--debug` |

## Deterministic placement and tags

The file is derived from the ID, never chosen by judgment. `placementFor()` in [`test-manager/lib/catalogue.mjs`](../../test-manager/lib/catalogue.mjs) is the single rule, `node test-manager/scripts/case.mjs placement <ID>` prints it, and the catalogue validator rejects any other `scriptPath`.

| ID | File | Project | Tags |
|---|---|---|---|
| `<AREA>-UI-NNN` (e.g. `AUTH-UI-001`, `AUTH-UI-003`) | `ui/<area>-ui.spec.ts` (`ui/auth-ui.spec.ts`) | `ui-chromium` (`ui-mobile` if the title has `@mobile`) | `@ui` + area |
| `<AREA>-API-NNN` (e.g. `PAY-API-003`) | `api/<area>-api.spec.ts` (`api/pay-api.spec.ts`) | `api` | `@api` + area |
| `<AREA>-PERF-NNN` | `../k6/scripts/<ID>.js` | k6 | k6 `options.tags` |

Area tags: `AUTH` → `@auth`, `PAY` → `@payments`, `FEE` → `@fees`, `TXN` → `@transactions`. Tags use Playwright's native `tag` option, so `--grep` matches them:
```ts
test('AUTH-UI-003 <catalogue title>', { tag: ['@ui', '@auth'] }, async ({ page }) => { … });
```
* Add a new case to its file and keep the existing tests. Create the file at the exact path only if it's missing. Grep for the ID first: an existing test is edited in place, never duplicated.
* A UI case that also checks an API response or localStorage stays in `ui/` and uses the `api` fixture (an unauthenticated API context, disposed automatically). `hybrid/` (tag `@hybrid`) is only for a catalogue-defined Hybrid layer, which doesn't exist today.

Don't repeat API checks in UI tests. The catalogue already splits coverage along the test pyramid.

## Conventions for new tests

1. **One catalogue ID per test.** The test title starts with the ID, e.g. `test('PAY-API-003 reusing an idempotency key with a different body returns 422', …)`. It goes in the file and carries the tags given by `case.mjs placement <ID>` (see above). Use one `test.step('S<n> …')` per catalogue step.
2. **API paths are relative** to the API base, without a leading slash: `request.post('payments', …)`. A leading `/` would drop `/api/v1`.
3. **Locator-free tests:** spec files use page-object fixtures (`loginPage`, `dashboardPage`, `checkoutPage`, `paymentPage`, `feeDetailPage`, `transactionsPage`, `appNav`) and API clients (`api-clients/`) instead of locators or hand-built requests; acceptance assertions stay in the test (`await expect(dashboardPage.outstandingTotal).toHaveText('R 24 200,00')`). Locators live in `pages/`: prefer `getByTestId(...)` (listed in [docs/APPLICATION.md §13](../../docs/APPLICATION.md#13-frontend-notes-for-ui-automation)), then role and label queries. `npm run check:locators` enforces this; full standards in [FRAMEWORK.md §2](FRAMEWORK.md#2-test-file-standards-mandatory).
4. **Money formatting:** the UI formats with `en-ZA` and uses non-breaking spaces (e.g. `R 24 200,00`). Normalise whitespace before comparing text.
5. **Test data isolation:**
   * Read-only checks on the seeded parents (Thandi, John, …) assume a **freshly seeded** database. Call `await dev.reset()` (the `dev` fixture, `POST /api/v1/dev/reset`) as the first line of the login step. It **invalidates every access token**, so call it before logging in, never mid-test, and it refuses to run with more than one worker.
   * Tests that create or confirm payments should prefer a dedicated `loadtestNNN@example.com` account (large balances), or reset first.
   * Simulation settings: `dev.restoreSimulation()` for "at .env defaults", `dev.setSimulation({…})` to change them. The fixture restores the defaults in teardown even when the test fails, so no `afterEach` is needed.
6. **Fixtures, page objects and clients** are documented in [FRAMEWORK.md §3–5](FRAMEWORK.md#3-fixtures). Search them before adding anything; prefer a new accessor or method on an existing class, and add a new page object, component or client only when nothing covers the screen or resource (FRAMEWORK.md §4 lists the deferred ones). Only a thin API client (§5) may be added in fast mode; anything else new goes through `Automate thorough <ID>` (routing rules in [CLAUDE.md](../../CLAUDE.md#choosing-the-mode)). Import `test`/`expect` from `../fixtures`.
7. **Catalogue linkage:** recorded with `node test-manager/scripts/case.mjs update <ID> …` (the `test-catalogue-updater` agent does this). Set `latestResult`/`lastExecuted` only after an actual run.

## Reports and debugging

* HTML report: `npm run report` (or `npx playwright show-report playwright-report`).
* Failures keep a trace, screenshot and video in `test-results/`. Open a trace with `npx playwright show-trace test-results/<test>/trace.zip`.
* `test-results/results.json` is a machine-readable summary that is useful when updating catalogue results.

## From MCP exploration to permanent test code

Playwright **MCP** lets Claude drive a real browser interactively. In thorough mode (`Automate thorough <ID>`) the `playwright-mcp-explorer` agent uses it to confirm routes, `data-testid`s, accessible names and exact messages in the running app. Fast-mode `Automate <ID>` uses MCP only when existing tests and the source can't settle a locator or behaviour. Nothing MCP does is saved as a test.

The `test-automation-engineer` agent then writes a normal Playwright Test spec in this folder, using only locators and values the explorer verified and assertions taken verbatim from the catalogue's expected results. That spec is what runs from then on (`npx playwright test …`), in the IDE or in CI, without MCP or Claude. MCP is set up in Claude Code (see [.claude/README.md](../../.claude/README.md)); this framework does not depend on it.

To decide the design first (for example, introducing a shared fixture), ask `Plan AUTH-API-001`. The plan lands in [`tests/plans/`](../plans/README.md) for review. Then ask `Automate AUTH-API-001` (see [CLAUDE.md](../../CLAUDE.md)).

# Playwright workspace (TypeScript)

UI, API and hybrid automation for the FeeFlow school-fee app. Tests are added one at a time, by catalogue ID, from [`test-manager/data/catalogue.json`](../../test-manager/data/catalogue.json) through the ID-driven workflow in [CLAUDE.md](../../CLAUDE.md).

## Layout

```
tests/playwright/
├── playwright.config.ts   projects, reporters, baseURLs, optional webServer
├── config/env.ts          the only place that reads environment variables
├── api/<area>/<ID>.spec.ts      API tests     → project "api"
├── ui/<area>/<ID>.spec.ts       UI tests      → projects "ui-chromium", "ui-mobile" (@mobile tag)
├── hybrid/<area>/<ID>.spec.ts   UI + API      → project "hybrid"
├── fixtures/                    (created when a helper is first reused)
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
| `PW_WORKERS` | `1` | Parallel workers (the app shares one SQLite DB) |
| `PW_BROWSER_CHANNEL` | *(bundled Chromium)* | `msedge` / `chrome` |
| `PW_START_SERVERS` | `false` | `true` = Playwright starts backend + frontend if not already running |
| `CI` | `false` | Enables retries and `forbidOnly` |

Read configuration only through `config/env.ts`, e.g. `import { env } from '../config/env'`, then `env.testUser.email`. Credentials are read lazily: a missing value throws a clear error when a test uses it, and listing tests still works.

## Commands

| Command | What it does |
|---|---|
| `npm test` | All projects |
| `npm run test:api` | API project only |
| `npm run test:ui` | Desktop UI project only |
| `npm run test:mobile` | Mobile UI project (tests tagged `@mobile`) |
| `npm run test:hybrid` | Hybrid project |
| `npm run test:headed` | Desktop UI, visible browser |
| `npm run test:debug` | Playwright Inspector |
| `npm run pw:ui` | Playwright UI mode (watch, time-travel) |
| `npm run test:list` | List discovered tests (also proves the config loads) |
| `npm run report` | Open the last HTML report |
| `npm run codegen` | Record interactions against the running UI |
| `npm run typecheck` | `tsc --noEmit` |

### Running one test
| By | Command (from `tests/playwright/`) |
|---|---|
| Catalogue ID / title | `npx playwright test --grep AUTH-API-001` |
| File | `npx playwright test api/auth/AUTH-API-001.spec.ts --project=api` |
| File + line | `npx playwright test api/auth/AUTH-API-001.spec.ts:12` |
| Repeat to detect flakiness | `npx playwright test --grep AUTH-UI-001 --repeat-each=3` |
| Headed / debug | add `--headed` or `--debug` |

## UI vs API vs hybrid placement

| Put it in | When the catalogue case… | Use |
|---|---|---|
| `api/` (project `api`) | has only HTTP steps (layer `API`) | `request` fixture, paths relative to `API_BASE_URL` |
| `ui/` (`ui-chromium`; `ui-mobile` for `@mobile`) | is driven entirely through the browser (layer `UI`) | `page`, `getByTestId` / `getByRole` |
| `hybrid/` (project `hybrid`) | is a UI case whose steps *require* API calls for setup or out-of-band checks (e.g. revoke a token via the API, then reload the page) | `page` for the UI, plus `playwright.request.newContext({ baseURL: env.apiBaseUrl })` for the API (dispose it afterwards) |

Don't repeat API checks in UI tests. The catalogue already splits coverage along the test pyramid.

## Conventions for new tests

1. **One catalogue ID per test.** The test title starts with the ID, e.g. `test('PAY-API-003 reusing an idempotency key with a different body returns 422', …)`. File names follow the ID inside an area folder (lower-case first ID segment): `api/pay/PAY-API-003.spec.ts`, `ui/auth/AUTH-UI-001.spec.ts`. Use one `test.step('S<n> …')` per catalogue step.
2. **API paths are relative** to the API base, without a leading slash: `request.post('payments', …)`. A leading `/` would drop `/api/v1`.
3. **Selectors:** prefer `getByTestId(...)` (the app has stable `data-testid` attributes, listed in [docs/APPLICATION.md §13](../../docs/APPLICATION.md#13-frontend-notes-for-ui-automation)), then role and label queries.
4. **Money formatting:** the UI formats with `en-ZA` and uses non-breaking spaces (e.g. `R 24 200,00`). Normalise whitespace before comparing text.
5. **Test data isolation:**
   * Read-only checks on the seeded parents (Thandi, John, …) assume a **freshly seeded** database. `POST /api/v1/dev/reset` re-seeds it, but it **invalidates every access token**, so call it before logging in, never mid-run while other workers are active.
   * Tests that create or confirm payments should prefer a dedicated `loadtestNNN@example.com` account (large balances), or reset first.
   * Tests that change simulation settings (`PUT /api/v1/dev/simulation`) must restore them (`DELETE /api/v1/dev/simulation`) in `afterEach`/`afterAll`.
6. **Shared helpers and fixtures** go in `fixtures/` only when a second test needs them.
7. **Catalogue linkage:** recorded with `node test-manager/scripts/case.mjs update <ID> …` (the `test-catalogue-updater` agent does this). Set `latestResult`/`lastExecuted` only after an actual run.

## Reports and debugging

* HTML report: `npm run report` (or `npx playwright show-report playwright-report`).
* Failures keep a trace, screenshot and video in `test-results/`. Open a trace with `npx playwright show-trace test-results/<test>/trace.zip`.
* `test-results/results.json` is a machine-readable summary that is useful when updating catalogue results.

## From MCP exploration to permanent test code

Playwright **MCP** lets Claude drive a real browser interactively. It is used by the `playwright-mcp-explorer` agent to confirm routes, `data-testid`s, accessible names and exact messages in the running app. Nothing it does is saved as a test.

The `test-automation-engineer` agent then writes a normal Playwright Test spec in this folder, using only locators and values the explorer verified and assertions taken verbatim from the catalogue's expected results. That spec is what runs from then on (`npx playwright test …`), in the IDE or in CI, without MCP or Claude. MCP is set up in Claude Code (see [.claude/README.md](../../.claude/README.md)); this framework does not depend on it.

To decide the design first (for example, introducing a shared fixture), ask `Plan AUTH-API-001`. The plan lands in [`tests/plans/`](../plans/README.md) for review. Then ask `Automate AUTH-API-001` (see [CLAUDE.md](../../CLAUDE.md)).

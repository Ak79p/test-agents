# FeeFlow – SDET Test Automation Workspace

A practice workspace for Playwright (TypeScript) and k6, built around a small demo school-fee payment app. Test cases live in one catalogue with stable IDs, and Claude Code agents plan, automate, review, debug and record them by ID.

> All payments in the demo app are simulated. Nothing calls a real payment provider.

## What's here

| Part | Path | Purpose |
|---|---|---|
| Test catalogue | `test-manager/` | 44 test cases (API 22 · UI 14 · performance 8): steps, expected results, status |
| Claude agents | `.claude/agents/`, rules in `CLAUDE.md` | ID-driven planning and automation workflow |
| Playwright Test | `tests/playwright/` | UI, API and hybrid tests (projects `api`, `ui-chromium`, `ui-mobile`, `hybrid`) |
| k6 | `tests/k6/` | Performance tests |
| Test plans | `tests/plans/` | Implementation plans written by `Plan <ID>` |
| Demo app | `backend/` (FastAPI + SQLite), `frontend/` (React + Vite) | System under test |

```
catalogue (requirements + status) ──► Claude agents ──► Playwright / k6 code ──► demo app
        ▲                                   │ Playwright MCP explores the UI
        └────────── results recorded ◄──────┘
```

## Spin up the demo app

Prerequisites: Python 3.11+, Node.js 18+ (22 used here), Google Chrome or Edge, Claude Code, and k6 (for performance tests).

```powershell
# Windows (PowerShell), from the repo root
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1          # once: venv, npm install, .env files
powershell -ExecutionPolicy Bypass -File scripts\start-backend.ps1  # terminal 1 – API
powershell -ExecutionPolicy Bypass -File scripts\start-frontend.ps1 # terminal 2 – UI
cd test-manager; npm start                                          # terminal 3 – test catalogue
```
```bash
# macOS / Linux
bash scripts/setup.sh
bash scripts/start-backend.sh      # terminal 1
bash scripts/start-frontend.sh     # terminal 2
cd test-manager && npm start       # terminal 3
```

| What | URL |
|---|---|
| Web UI | http://localhost:5173 |
| API | http://127.0.0.1:8000/api/v1 (health: `/api/v1/health`) |
| Swagger / OpenAPI | http://127.0.0.1:8000/docs · http://127.0.0.1:8000/openapi.json |
| Test catalogue | http://127.0.0.1:5180 |

**Demo login:** `thandi.mokoena@example.com` / `Password123!`. Every seeded account uses this password.

## Where things live

| Item | Location |
|---|---|
| UI source | `frontend/src/` (pages in `frontend/src/pages/`, stable `data-testid`s on every interactive element) |
| API source | `backend/app/` (routers in `backend/app/routers/`, payment logic in `backend/app/services/`) |
| API collection | `postman/SchoolFees.postman_collection.json` + `postman/SchoolFees.local.postman_environment.json` |
| Seed data | `backend/app/seed.py`: 5 demo parents + 50 `loadtestNNN@example.com` accounts; due dates are relative to the seed day |
| Database | `backend/data/app.db` (SQLite, created and seeded on first start) |
| Reset data | `POST http://127.0.0.1:8000/api/v1/dev/reset`, or `scripts\reset-db.ps1` / `bash scripts/reset-db.sh` |
| Test catalogue data | `test-manager/data/catalogue.json` (CLI: `node test-manager/scripts/case.mjs show <ID>`) |
| Simulated test cards | `GET /api/v1/dev/test-cards` (e.g. `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` is declined) |

Full app reference (endpoints, payment lifecycle, delay and failure simulation, all seeded accounts): [docs/APPLICATION.md](docs/APPLICATION.md).

## Set up the test tooling

```powershell
cd tests\playwright
npm install
Copy-Item .env.example .env      # set TEST_USER_PASSWORD and SECONDARY_USER_PASSWORD (Password123!)
npm run test:list                # confirms the Playwright config loads

claude mcp get playwright        # should say "Connected". If missing (PowerShell, not Git Bash):
claude mcp add playwright -- cmd /c npx -y @playwright/mcp@0.0.82 --isolated
k6 version                       # performance tests only
```
macOS: `cp .env.example .env` and `claude mcp add playwright -- npx -y @playwright/mcp@0.0.82 --isolated`.

Start Claude Code in the repo root (`claude`). `/mcp` should list `playwright` as connected.

## The agents

| Agent | Does |
|---|---|
| `test-case-reader` | Finds the exact ID in the catalogue and returns its spec word for word |
| `test-planner` | Writes an implementation plan (framework changes, steps → code) to `tests/plans/<ID>.md` |
| `playwright-mcp-explorer` | Checks the real app: the browser via Playwright MCP, or API source and Swagger |
| `test-automation-engineer` | Writes the one requested test in the existing framework |
| `test-validator` | Reviews the test against the spec and runs it; reports the real result |
| `test-catalogue-updater` | Records status, script path, result and notes in the catalogue |

You don't call them individually. Type a request and Claude runs them in order (rules in [CLAUDE.md](CLAUDE.md)). Unknown IDs are never guessed: Claude stops and asks.

## Using the agents – example prompts

| Goal | Prompt |
|---|---|
| **Plan** | `Plan AUTH-API-001 by extending the framework with a reusable API login fixture` |
| **Automate** | `Automate AUTH-API-001` |
| **Automate and run** | `Automate PAY-API-003 and run it` |
| **Review** | `Review AUTH-API-001 without implementing it` |
| **Debug** | `Debug PAY-UI-001 – it fails on the payment result page` |
| **Update** | `Update AUTH-UI-002: I ran it manually today and it failed – the email error message did not appear` |
| **Performance (k6)** | `Implement the k6 test for FEE-PERF-001` |

What each one does:
- **Plan** writes `tests/plans/<ID>.md` as DRAFT and changes no code. Approve it by setting the status to `APPROVED`, or tell Claude "approve the plan for AUTH-API-001". `Automate` then follows the approved plan.
- **Automate** creates `tests/playwright/<api|ui|hybrid>/<area>/<ID>.spec.ts`, runs it and records the result in the catalogue.
- **Review** and **Debug** keep the catalogue's expected results. Failures caused by the app are reported, never "fixed" by weakening the test.
- **Update** changes only status, result, date and notes. Edit test steps or expected results yourself in the catalogue UI.
- **Performance (k6)** validation is a 1-user smoke run. Ask explicitly for a full load run.

## Run tests without Claude

```bash
cd tests/playwright
npx playwright test --grep AUTH-API-001           # one case by ID
npx playwright test --project=api                 # api | ui-chromium | ui-mobile | hybrid
npm run pw:ui                                     # Playwright UI mode
npm run report                                    # last HTML report (traces/screenshots on failure)

cd tests/k6 && k6 run scripts/FEE-PERF-001.js     # once the script exists
```

## More documentation

[CLAUDE.md](CLAUDE.md) (workflow rules) · [.claude/README.md](.claude/README.md) (agents, MCP setup, troubleshooting) · [tests/playwright/README.md](tests/playwright/README.md) · [tests/k6/README.md](tests/k6/README.md) · [test-manager/README.md](test-manager/README.md) · [tests/plans/README.md](tests/plans/README.md) · [docs/APPLICATION.md](docs/APPLICATION.md)

# FeeFlow application reference

A complete, local, full-stack practice application in which parents log in, see their children's school fees and pay them through a **simulated** card gateway. The app is a target for practising UI automation (Playwright) and load testing (k6). It is inspired by the education-fintech domain; it is not affiliated with any real product.

> **No real payments.** No payment provider, external API or cloud service is contacted at runtime. Every outcome is simulated and deterministic.

Testing workspace (catalogue, agents, Playwright, k6): see the [main README](../README.md).

---|---|---|---|
| Test catalogue | Requirements + tracking (44 cases: API 22, UI 14, performance 8) | `test-manager/` (web UI + `scripts/case.mjs` CLI) | [test-manager/README.md](../test-manager/README.md) |
| Claude agents | Six single-purpose agents (incl. `test-planner`) run in sequence by the main session | `.claude/agents/`, rules in `CLAUDE.md` | [.claude/README.md](../.claude/README.md), [agents](../.claude/agents/README.md) |
| Playwright MCP | Lets agents drive a real browser to verify UI behaviour before coding | Claude Code local config (`claude mcp get playwright`) | [.claude/README.md#playwright-mcp](../.claude/README.md#playwright-mcp) |
| Playwright Test | Repeatable UI / API / hybrid tests | `tests/playwright/` (own `package.json`, `playwright.config.ts`) | [tests/playwright/README.md](../tests/playwright/README.md) |
| k6 | Load and performance tests | `tests/k6/` (`lib/config.js`, `scripts/`) | [tests/k6/README.md](../tests/k6/README.md) |

### Prerequisites
* Everything in [§2](#2-prerequisites) (Python 3.11+, Node.js 18+; Node 22 is used here).
* Claude Code with the Playwright MCP server (registered on this machine; see [.claude/README.md](../.claude/README.md#playwright-mcp)) and Google Chrome (or Edge) for MCP exploration.
* k6 for performance cases (v2.2.0 installed here).

### Setup (once)
```powershell
# app (see §3)
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

# Playwright Test
cd tests\playwright
npm install
Copy-Item .env.example .env        # then set TEST_USER_PASSWORD / SECONDARY_USER_PASSWORD (seeded password: §6)
npm run install:browsers           # skipped if the browser is already present
npm run test:list                  # confirms the config loads

# MCP (only if `claude mcp get playwright` reports no such server). PowerShell, not Git Bash:
claude mcp add playwright -- cmd /c npx -y @playwright/mcp@0.0.82 --isolated
```
macOS: `bash scripts/setup.sh`, `cp .env.example .env`, and `claude mcp add playwright -- npx -y @playwright/mcp@0.0.82 --isolated`.

### Daily startup
```powershell
scripts\start-backend.ps1      # API  → http://127.0.0.1:8000  (Swagger /docs)
scripts\start-frontend.ps1     # UI   → http://localhost:5173
cd test-manager; npm start     # catalogue → http://127.0.0.1:5180
claude                         # in the repo root; /mcp should show playwright connected
```

### The ID-driven workflow
1. Pick a case in the catalogue UI (or `node test-manager/scripts/case.mjs list --status planned`).
2. Optionally plan first: **`Plan AUTH-API-001`** writes `tests/plans/AUTH-API-001.md` (framework changes, step→code, assertions). Review it and mark it APPROVED.
3. In Claude Code, type **`Automate AUTH-API-001`** (also: `Automate PAY-API-003 and run it`, `Review AUTH-API-001 without implementing it`, `Debug AUTH-API-001`, `Implement the k6 test for FEE-PERF-001`).
4. Claude reads the exact case (and the approved plan, if any), explores the app (MCP for UI), adds the test to the file derived from its ID (`case.mjs placement <ID>`, e.g. `tests/playwright/ui/auth-ui.spec.ts`), runs it, records status, path, result and notes in the catalogue, and reports the files and the exact command.
5. Re-run any time without Claude: `cd tests/playwright && npx playwright test --grep AUTH-API-001`.

Unknown IDs are never guessed: Claude stops and asks. Rules: [CLAUDE.md](../CLAUDE.md). Performance dashboards and CI workflows are out of scope.

---|---|---|
| `tests/playwright/` | Playwright Test (TypeScript) with `api` and `ui-chromium` / `ui-mobile` projects; its own `package.json` | [tests/playwright/README.md](../tests/playwright/README.md) |
| `tests/k6/` | k6 workspace with centralised `lib/config.js` (k6 v2.2.0 verified locally) | [tests/k6/README.md](../tests/k6/README.md) |
| `test-manager/` | Local web catalogue of 44 test cases (API 22 / UI 14 / performance 8), persisted to `data/catalogue.json` | [test-manager/README.md](../test-manager/README.md) |
| `CLAUDE.md` | Workflow for "Automate `<ID>`" requests | |

```bash
# Catalogue UI → http://127.0.0.1:5180
cd test-manager && npm start

# Playwright (after: npm install; cp .env.example .env; set passwords)
cd tests/playwright && npm run test:list
npx playwright test --grep PAY-API-003      # once a case is automated

# k6 (once a script exists)
cd tests/k6 && k6 run scripts/<CASE-ID>.js
```

No business tests or k6 scripts are implemented yet. Every catalogue case starts as `planned` / `not run`. Performance dashboards and CI workflows remain out of scope.

---

## Contents

1. [Architecture overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Quick start](#3-quick-start)
4. [Manual installation and startup](#4-manual-installation-and-startup)
5. [URLs](#5-urls)
6. [Seeded credentials and data](#6-seeded-credentials-and-data)
7. [Configuration](#7-configuration)
8. [API reference](#8-api-reference)
9. [Payment lifecycle](#9-payment-lifecycle)
10. [Simulating delays and failures](#10-simulating-delays-and-failures)
11. [Resetting the database](#11-resetting-the-database)
12. [Postman collection](#12-postman-collection)
13. [Frontend notes for UI automation](#13-frontend-notes-for-ui-automation)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Architecture overview

```
┌────────────────────────────┐   fetch + JSON    ┌──────────────────────────────────────────────┐
│  React 18 + TypeScript SPA │  Bearer token     │  FastAPI (uvicorn, single process)           │
│  Vite dev server :5173     │ ────────────────▶ │  /api/v1/*                                   │
│                            │  Idempotency-Key  │                                              │
│  pages → api client →      │ ◀──────────────── │  middleware: request-id, access log,         │
│  fetch (CORS)              │  JSON / errors    │              simulated delay, crash guard    │
└────────────────────────────┘                   │  routers → services (payment state machine)  │
                                                 │          → simulated gateway (in-process)    │
                                                 │  SQLAlchemy 2 ─▶ SQLite (WAL) data/app.db    │
                                                 └──────────────────────────────────────────────┘
```

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | React 18, TypeScript, Vite 5, React Router 6 | Login, dashboard, fee details, checkout, payment result with polling, transaction history |
| API | FastAPI, Pydantic v2 | Validation, auth, consistent errors, OpenAPI/Swagger |
| Domain | `app/services/payments.py` | Payment state machine, idempotency, fee crediting, asynchronous settlement |
| Gateway | `app/services/gateway.py` | Deterministic simulated card processor (latency, declines, errors, timeouts) |
| Persistence | SQLAlchemy 2 + SQLite | Single file DB in `backend/data/`, WAL mode, created and seeded automatically |

### Directory structure

```
zenda-clone/
├── README.md
├── CLAUDE.md                    Claude Code entry point: ID-driven test automation workflow
├── .claude/                     agents/ (5 test-workflow agents) + README (MCP setup, troubleshooting)
├── tests/
│   ├── plans/                   implementation plans per case ID (Plan <ID>)
│   ├── playwright/              Playwright Test: api/ ui/ hybrid/ config/ playwright.config.ts
│   └── k6/                      k6: lib/config.js scripts/ results/
├── test-manager/                test catalogue: web UI, CLI (scripts/case.mjs), data/catalogue.json
├── scripts/                     setup / start / reset scripts (.ps1 for Windows, .sh for macOS/Linux)
├── postman/
│   ├── SchoolFees.postman_collection.json
│   ├── SchoolFees.local.postman_environment.json
│   └── generate_collection.py   regenerates both files
├── backend/
│   ├── .env.example             all settings, no secrets
│   ├── requirements.txt
│   ├── run.py                   `python run.py` starts uvicorn with .env settings
│   ├── data/                    SQLite database (git-ignored)
│   └── app/
│       ├── main.py              app factory: CORS, middleware, routers, OpenAPI
│       ├── config.py            pydantic-settings (env + .env)
│       ├── database.py          engine, SQLite pragmas, session dependency
│       ├── models.py            Parent, AuthToken, Student, Fee, Payment, PaymentEvent
│       ├── schemas.py           request/response models + builders
│       ├── errors.py            ApiError + JSON error handlers
│       ├── middleware.py        request id, access log, simulated delay, 500 guard
│       ├── simulation.py        runtime-mutable simulation settings
│       ├── security.py          PBKDF2 password hashing, opaque tokens
│       ├── deps.py              bearer-token authentication dependency
│       ├── seed.py              deterministic demo data + CLI (`python -m app.seed --reset`)
│       ├── services/
│       │   ├── payments.py      payment lifecycle / state machine
│       │   └── gateway.py       simulated gateway + test cards
│       └── routers/             health, auth, students, fees, payments, transactions, dashboard, dev
└── frontend/
    ├── .env.example
    ├── package.json, vite.config.ts, tsconfig.json, index.html
    └── src/
        ├── main.tsx, App.tsx, config.ts, styles.css
        ├── api/                 typed fetch client, endpoint functions, types
        ├── auth/                AuthContext (localStorage session), RequireAuth guard
        ├── components/          Layout, alerts, badges, loading/empty/error states
        ├── hooks/useApi.ts      loading/error/data hook with abort support
        ├── lib/                 money/date formatting, card validation, idempotency keys
        └── pages/               Login, Dashboard, FeeDetail, Checkout, Payment, Transactions, NotFound
```

### Key design decisions

* **Money is integer cents** (`amount_cents`) everywhere in the API; currency is `ZAR`.
* **Opaque bearer tokens** are stored hashed (SHA-256) in the `auth_tokens` table, so logout can revoke them server-side. Tokens expire after `TOKEN_TTL_MINUTES`.
* **Ownership checks return 404**, not 403. Requesting another parent's student, fee or payment looks like it doesn't exist, so nothing leaks.
* **No background workers.** Asynchronous gateway outcomes (pending/timeout) are settled lazily: the first read after the settle time applies them (`GET /payments/{id}`, `/status`, `/transactions`, `/fees/...`, `/dashboard`).
* **Concurrency safety** comes from the database, not from in-memory locks (details in [§9](#9-payment-lifecycle)).
* **Simulation settings** live in process memory, so run **one** uvicorn worker (the default).

---

## 2. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Python | 3.11 or newer | `python --version` (Windows: `py -3 --version`) |
| Node.js | 18.18+ (20 or 22 LTS recommended) | `node --version` |
| npm | 9+ (bundled with Node) | `npm --version` |
| Git | optional | |

No database server, Docker or internet connection is needed at runtime. Package installation needs internet once.

---

## 3. Quick start

### Windows (PowerShell)

```powershell
# from the repository root
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1          # one time
powershell -ExecutionPolicy Bypass -File scripts\start-backend.ps1  # terminal 1
powershell -ExecutionPolicy Bypass -File scripts\start-frontend.ps1 # terminal 2
```

### macOS / Linux

```bash
bash scripts/setup.sh            # one time
bash scripts/start-backend.sh    # terminal 1
bash scripts/start-frontend.sh   # terminal 2
```

Open **http://localhost:5173** and sign in as `thandi.mokoena@example.com` / `Password123!`.

The backend creates `backend/data/app.db` and seeds it on first start.

---

## 4. Manual installation and startup

### Backend

```bash
cd backend
python -m venv .venv                       # Windows: py -3 -m venv .venv
# activate
source .venv/bin/activate                  # macOS/Linux
.venv\Scripts\Activate.ps1                 # Windows PowerShell
.venv\Scripts\activate.bat                 # Windows cmd

pip install -r requirements.txt
cp .env.example .env                       # Windows: copy .env.example .env

python run.py                              # reads APP_HOST/APP_PORT, auto-reload in development
# or, equivalently:
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --no-access-log
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env                       # Windows: copy .env.example .env
npm run dev                                # http://localhost:5173
```

Other scripts: `npm run build` (type-check + production build into `dist/`), `npm run preview` (serves `dist/` on :4173; add `http://localhost:4173` to `CORS_ORIGINS` if you use it), `npm run typecheck`.

---

## 5. URLs

| What | URL |
|---|---|
| Web UI | http://localhost:5173 |
| API base | http://127.0.0.1:8000/api/v1 |
| Swagger UI | http://127.0.0.1:8000/docs |
| ReDoc | http://127.0.0.1:8000/redoc |
| OpenAPI JSON | http://127.0.0.1:8000/openapi.json |
| Health | http://127.0.0.1:8000/api/v1/health |

In Swagger, call `POST /api/v1/auth/login`, copy `access_token`, click **Authorize** and paste it.

---

## 6. Seeded credentials and data

Every account uses the password **`Password123!`**.

| Email | Scenario |
|---|---|
| `thandi.mokoena@example.com` | 2 children (Lerato `stu_1001`, Kabelo `stu_1002`); overdue, upcoming, partially paid and paid fees; history with a declined, a cancelled and several successful payments |
| `john.smith@example.com` | 1 child (Emma `stu_1003`), upcoming fees |
| `priya.naidoo@example.com` | 3 children, 9 fees (good for longer lists) |
| `sipho.dlamini@example.com` | Everything paid (empty outstanding state) |
| `ayesha.patel@example.com` | No linked students (empty dashboard) |
| `loadtest001@example.com` … `loadtest050@example.com` | Load-test accounts: one student each with very large balances (R 500 000, R 100 000, R 50 000), so many small payments are possible |

Useful seeded IDs (Thandi):

| Fee | Student | Amount | State |
|---|---|---|---|
| `fee_1001` Term 2 Tuition | Lerato | R 8 450.00 | Paid |
| `fee_1002` Term 3 Transport | Lerato | R 1 200.00 | Overdue (5 days) |
| `fee_1003` Term 3 Tuition | Lerato | R 8 450.00 | Due in 10 days |
| `fee_1004` Science Centre Excursion | Lerato | R 650.00 | Partially paid (R 300) |
| `fee_1006` Grade 9 Exam Fee | Kabelo | R 450.00 | Overdue (12 days) |
| `fee_1007` Term 3 Tuition | Kabelo | R 12 800.00 | Due in 10 days |

Due dates are **relative to the day the database was seeded**, so overdue and upcoming fees stay meaningful after every reset. The number of load-test accounts is set by `SEED_LOAD_TEST_USERS`. Look up their fee IDs with `GET /api/v1/fees/outstanding` after logging in as that user.

---

## 7. Configuration

All configuration comes from environment variables or the `.env` files. Copy the `.env.example` files; neither contains secrets.

### Backend (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `APP_ENV` | `development` | `development` / `test` / `production`. Dev endpoints are never mounted in `production`. Auto-reload only in `development`. |
| `APP_HOST` / `APP_PORT` | `127.0.0.1` / `8000` | Bind address used by `run.py` |
| `LOG_LEVEL` | `INFO` | Python log level |
| `DATABASE_URL` | `sqlite:///./data/app.db` | Relative paths resolve from `backend/` |
| `SEED_ON_STARTUP` | `true` | Create tables and seed if the DB is empty |
| `SEED_LOAD_TEST_USERS` | `50` | Number of `loadtestNNN@example.com` accounts |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated allowed origins |
| `TOKEN_TTL_MINUTES` | `120` | Access-token lifetime |
| `ENABLE_DEV_ENDPOINTS` | `true` | Mount `/api/v1/dev/*` (ignored when `APP_ENV=production`) |
| `THREADPOOL_SIZE` | `100` | Worker threads for synchronous handlers (raise for heavy load tests) |
| `SIM_*` | see [§10](#10-simulating-delays-and-failures) | Delay and gateway simulation defaults |

### Frontend (`frontend/.env`)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | `http://127.0.0.1:8000/api/v1` | API base URL (include `/api/v1`) |
| `VITE_DEV_HOST` / `VITE_DEV_PORT` | `localhost` / `5173` | Dev server bind (keep the origin in `CORS_ORIGINS`) |
| `VITE_PAYMENT_POLL_INTERVAL_MS` | `1500` | Poll interval on the payment page while `PROCESSING` |
| `VITE_PAYMENT_POLL_TIMEOUT_MS` | `120000` | Stop polling and show a "taking longer than usual" message |
| `VITE_SHOW_TEST_CARDS` | `true` | Show the test-card helper on checkout |

Restart `npm run dev` after changing `frontend/.env`.

---

## 8. API reference

Base URL: `http://127.0.0.1:8000/api/v1`. Swagger (`/docs`) is the authoritative, always-current schema.

### Conventions

* **Auth:** `Authorization: Bearer <access_token>` on everything except `/health`, `/auth/login` and `/dev/*`.
* **Content type:** JSON request and response bodies. Unknown fields in request bodies are rejected (422).
* **Money:** integer cents (`amount_cents: 845000` = R 8 450.00).
* **Timestamps:** ISO-8601 UTC (`2026-10-11T13:49:28Z`); dates are `YYYY-MM-DD`.
* **Response headers:** `X-Request-ID` (echoes yours or generates one), `X-Response-Time-Ms`, `X-Simulated-Delay-Ms` (when a delay was applied). All are exposed to browsers via CORS.

### Error format

Every error, including 404 for unknown routes, 405, 422 and 500, has this shape:

```json
{
  "error": {
    "code": "AMOUNT_EXCEEDS_BALANCE",
    "message": "The payment amount exceeds the outstanding balance.",
    "details": { "balance_cents": 845000, "amount_cents": 99999999 },
    "request_id": "8f2c1d0a4b6e4f1a"
  }
}
```

Validation errors (`422 VALIDATION_ERROR`) list every problem:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid data.",
    "details": [
      { "location": "body", "field": "card.number", "message": "Card number is invalid.", "type": "value_error" },
      { "location": "body", "field": "card.cvc", "message": "CVC must be 3 or 4 digits.", "type": "value_error" }
    ],
    "request_id": "..."
  }
}
```

| HTTP | Error codes |
|---|---|
| 400 | `IDEMPOTENCY_KEY_MISSING`, `IDEMPOTENCY_KEY_INVALID` |
| 401 | `UNAUTHORIZED` (no token), `INVALID_TOKEN` (unknown/revoked), `TOKEN_EXPIRED`, `INVALID_CREDENTIALS` (login) |
| 404 | `NOT_FOUND`, `STUDENT_NOT_FOUND`, `FEE_NOT_FOUND`, `PAYMENT_NOT_FOUND` |
| 405 | `METHOD_NOT_ALLOWED` |
| 409 | `FEE_ALREADY_PAID`, `PAYMENT_IN_PROGRESS`, `INVALID_PAYMENT_STATE`, `PAYMENT_NOT_CANCELLABLE`, `AMOUNT_EXCEEDS_BALANCE` (on confirm, balance changed since creation) |
| 422 | `VALIDATION_ERROR`, `AMOUNT_EXCEEDS_BALANCE`, `AMOUNT_TOO_SMALL`, `IDEMPOTENCY_KEY_REUSED` |
| 500 | `INTERNAL_ERROR` |
| 502 | `GATEWAY_ERROR` (simulated) |
| 503 | Health check when the DB is unavailable |
| 504 | `GATEWAY_TIMEOUT` (simulated) |

### Endpoints

| Method | Path | Auth | Success | Description |
|---|---|---|---|---|
| GET | `/health` | – | 200 | Liveness/readiness; checks DB. 503 if DB unavailable. Never delayed. |
| POST | `/auth/login` | – | 200 | `{email, password}` → `access_token`, `expires_at`, `parent` |
| POST | `/auth/logout` | ✓ | 204 | Revokes the current token |
| GET | `/auth/me` | ✓ | 200 | Current parent profile |
| GET | `/dashboard` | ✓ | 200 | Summary totals, students with balances, next 6 unpaid fees, 5 latest payments |
| GET | `/students` | ✓ | 200 | Parent's students with outstanding/overdue totals |
| GET | `/students/{student_id}` | ✓ | 200 | One student |
| GET | `/students/{student_id}/fees` | ✓ | 200 | Student's fees; `?status=OUTSTANDING\|PARTIALLY_PAID\|PAID\|UNPAID` |
| GET | `/fees/outstanding` | ✓ | 200 | All unpaid fees across students, by due date; `?student_id=`, `?overdue_only=true` |
| GET | `/fees/{fee_id}` | ✓ | 200 | Fee with its payments and `has_payment_in_progress` |
| POST | `/payments` | ✓ | 201 / 200 replay | Create a PENDING payment. **Requires `Idempotency-Key`.** |
| GET | `/payments/{payment_id}` | ✓ | 200 | Full payment incl. event timeline |
| GET | `/payments/{payment_id}/status` | ✓ | 200 | Lightweight status for polling (`retry_after_ms` while PROCESSING) |
| POST | `/payments/{payment_id}/confirm` | ✓ | 200 / 202 | Submit card to the simulated gateway (see [§9](#9-payment-lifecycle)) |
| POST | `/payments/{payment_id}/cancel` | ✓ | 200 | Cancel a PENDING payment |
| GET | `/transactions` | ✓ | 200 | Paginated history, newest first. `status` (repeatable), `student_id`, `fee_id`, `date_from`, `date_to`, `page` (≥1), `page_size` (1–100) |
| POST | `/dev/reset` | – | 200 | Drop + re-seed DB (dev only) |
| GET | `/dev/simulation` | – | 200 | Current simulation settings (dev only) |
| PUT | `/dev/simulation` | – | 200 | Partial update of simulation settings (dev only) |
| DELETE | `/dev/simulation` | – | 200 | Restore simulation settings from `.env` (dev only) |
| GET | `/dev/test-cards` | – | 200 | Test card numbers and outcomes (dev only) |

### Sample requests

The examples use bash `curl` (macOS, Linux, Git Bash on Windows). In Windows PowerShell, call `curl.exe` instead of `curl`, or see the PowerShell example at the end of this section.

```bash
API=http://127.0.0.1:8000/api/v1

# Health
curl -s $API/health
# {"status":"ok","version":"1.0.0","environment":"development","database":"ok","timestamp":"..."}

# Login
TOKEN=$(curl -s -X POST $API/auth/login -H "Content-Type: application/json" \
  -d '{"email":"thandi.mokoena@example.com","password":"Password123!"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
AUTH="Authorization: Bearer $TOKEN"

# Students, outstanding fees, one fee
curl -s -H "$AUTH" $API/students
curl -s -H "$AUTH" "$API/fees/outstanding?overdue_only=true"
curl -s -H "$AUTH" $API/fees/fee_1003

# Create a payment of R 1 500.00 (201 Created)
KEY=$(python -c "import uuid;print(uuid.uuid4())")
curl -s -i -X POST $API/payments -H "$AUTH" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY" -d '{"fee_id":"fee_1003","amount_cents":150000,"payment_method":"CARD"}'

# Same key + same body again → 200 OK, header "Idempotent-Replayed: true", same payment id
curl -s -i -X POST $API/payments -H "$AUTH" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY" -d '{"fee_id":"fee_1003","amount_cents":150000,"payment_method":"CARD"}'

PAYMENT_ID=pay_xxxxxxxxxxxxxxxxxxxxxxxx   # from the response

# Confirm with a test card (200, status SUCCEEDED)
curl -s -X POST $API/payments/$PAYMENT_ID/confirm -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"card":{"number":"4242424242424242","expiry_month":12,"expiry_year":2030,"cvc":"123","holder_name":"Thandi Mokoena"}}'

# Poll status / full details
curl -s -H "$AUTH" $API/payments/$PAYMENT_ID/status
curl -s -H "$AUTH" $API/payments/$PAYMENT_ID

# Cancel (only while PENDING)
curl -s -X POST -H "$AUTH" $API/payments/$PAYMENT_ID/cancel

# History: failed or succeeded payments for one student, page 1 of 5
curl -s -H "$AUTH" "$API/transactions?status=FAILED&status=SUCCEEDED&student_id=stu_1001&page=1&page_size=5"

# Logout (204); the token is now rejected with 401 INVALID_TOKEN
curl -s -i -X POST -H "$AUTH" $API/auth/logout
```

Sample `POST /payments` response (abridged):

```json
{
  "id": "pay_5f0a3c1e9b7d4a2c8e6f1b3d",
  "reference": "SF-20261011-A1B2C3",
  "status": "PENDING",
  "amount_cents": 150000,
  "currency": "ZAR",
  "fee_id": "fee_1003",
  "fee_description": "Term 3 Tuition",
  "student_id": "stu_1001",
  "student_name": "Lerato Mokoena",
  "payment_method": "CARD",
  "card_brand": null,
  "card_last4": null,
  "failure_code": null,
  "failure_message": null,
  "idempotency_key": "6c0e...",
  "gateway_reference": null,
  "confirm_attempts": 0,
  "is_final": false,
  "is_cancellable": true,
  "events": [{ "type": "PAYMENT_CREATED", "from_status": null, "to_status": "PENDING", "message": "Payment created.", "created_at": "..." }],
  "created_at": "...", "updated_at": "...", "completed_at": null
}
```

PowerShell equivalent of login + create:

```powershell
$api = 'http://127.0.0.1:8000/api/v1'
$login = Invoke-RestMethod -Method Post -Uri "$api/auth/login" -ContentType 'application/json' `
  -Body '{"email":"thandi.mokoena@example.com","password":"Password123!"}'
$h = @{ Authorization = "Bearer $($login.access_token)"; 'Idempotency-Key' = [guid]::NewGuid().ToString() }
Invoke-RestMethod -Method Post -Uri "$api/payments" -Headers $h -ContentType 'application/json' `
  -Body '{"fee_id":"fee_1003","amount_cents":150000,"payment_method":"CARD"}'
```

---

## 9. Payment lifecycle

```
                    POST /payments (Idempotency-Key)
                                 │
                                 ▼
          POST /cancel     ┌───────────┐    gateway error (502) – card not charged, retry allowed
  CANCELLED ◀───────────── │  PENDING  │ ◀─────────────────────────────────────────────┐
                           └─────┬─────┘                                               │
                                 │ POST /confirm                                       │
                                 ▼                                                     │
                           ┌────────────┐ ─────────────────────────────────────────────┘
                           │ PROCESSING │
                           └─────┬──────┘
          approved (200)         │        declined (200)          timeout (504) / async (202):
     ┌───────────────────────────┼─────────────────────────┐      stays PROCESSING until
     ▼                                                     ▼      SIM_PENDING_RESOLUTION_SECONDS
┌───────────┐                                         ┌────────┐  elapse, then settles to
│ SUCCEEDED │  fee.amount_paid += amount              │ FAILED │  SUCCEEDED or FAILED on the
└───────────┘                                         └────────┘  next read
```

| Status | Meaning | Final? |
|---|---|---|
| `PENDING` | Created; awaiting card confirmation. Cancellable. Also the state after a gateway error. | no |
| `PROCESSING` | Submitted to the gateway; outcome unknown. Cannot be cancelled. Blocks new payments for the same fee (`409 PAYMENT_IN_PROGRESS`). | no |
| `SUCCEEDED` | Approved; the fee balance has been reduced. | yes |
| `FAILED` | Declined, or settled as failed after a timeout. Create a new payment to retry. | yes |
| `CANCELLED` | Cancelled by the parent before confirmation. | yes |

### Step by step

1. **Create:** `POST /payments` with `{fee_id, amount_cents}` and an `Idempotency-Key` header.
   * Partial payments are allowed: `0 < amount ≤ balance`, and partial amounts must be at least R 1.00.
   * No money moves at this point. The payment is `PENDING`.
2. **Confirm:** `POST /payments/{id}/confirm` with card details.
   * The payment moves atomically `PENDING → PROCESSING`; a concurrent second confirm gets `409 INVALID_PAYMENT_STATE`.
   * The simulated gateway waits `gateway_latency_ms`, then returns an outcome:

| Outcome | HTTP | Resulting status |
|---|---|---|
| Approved | **200** | `SUCCEEDED`, fee credited |
| Declined / insufficient funds / expired card | **200** | `FAILED` with `failure_code` (`CARD_DECLINED`, `INSUFFICIENT_FUNDS`, `EXPIRED_CARD`) |
| Async processing | **202** | `PROCESSING`; settles after `pending_resolution_seconds` |
| Gateway error | **502** `GATEWAY_ERROR` | back to `PENDING` (`details.retryable: true`); confirm again |
| Gateway timeout | **504** `GATEWAY_TIMEOUT` | `PROCESSING` (outcome unknown); settles as `FAILED / GATEWAY_TIMEOUT` |

   A decline is a *successful API call* whose payment failed, so it returns 200 and the outcome is in the body. 5xx responses mean the gateway itself misbehaved.
3. **Poll:** while `PROCESSING`, poll `GET /payments/{id}/status` every `retry_after_ms`. The UI does this automatically.
4. **Cancel:** `POST /payments/{id}/cancel` is allowed only from `PENDING`; anything else returns `409 PAYMENT_NOT_CANCELLABLE`.

Every transition is appended to the payment's `events` timeline: `PAYMENT_CREATED`, `CONFIRMATION_SUBMITTED`, `PAYMENT_SUCCEEDED`, `PAYMENT_FAILED`, `GATEWAY_ERROR`, `GATEWAY_TIMEOUT`, `PROCESSING_ASYNC`, `PAYMENT_CANCELLED`.

### Idempotency

* `Idempotency-Key` is **required** on `POST /payments`: 8–255 characters from `A-Z a-z 0-9 - _ : .`. Keys are scoped per parent.
* First request with a key → **201 Created**.
* Same key + identical body → **200 OK** with `Idempotent-Replayed: true` and the *current* state of the original payment. No duplicate is created.
* Same key + different body → **422 IDEMPOTENCY_KEY_REUSED**.
* The UI generates one key per attempted amount (`crypto.randomUUID()`), so double-clicks and retries after network errors never duplicate a payment.

### Concurrency guarantees

* **Duplicate creates:** a unique constraint on `(parent_id, idempotency_key)` makes the database the final arbiter. When N identical requests race, exactly one insert wins (201). The others hit the constraint, read the winner and return it (200 replay). This was verified with 20 parallel requests sharing one key.
* **State transitions** are single conditional updates (`UPDATE payments SET status='PROCESSING' WHERE id=? AND status='PENDING'`). The affected-row count decides who won, so double confirms, confirm-vs-cancel races and double settlement cannot happen.
* **No overpayment:** the fee is credited with `UPDATE fees SET amount_paid_cents = amount_paid_cents + :x WHERE id=? AND amount_cents - amount_paid_cents >= :x`. If two payments race for the last balance, one succeeds and the other ends `FAILED / BALANCE_CHANGED`.
* **SQLite tuning:** WAL journal mode and `busy_timeout=30000` let writers queue instead of failing with "database is locked". SQLite allows one writer at a time, so write throughput is bounded; that is a realistic bottleneck to observe with k6.
* **Disconnect safety:** the gateway call and settlement are shielded from client disconnects, so a dropped connection cannot leave a payment stuck mid-flight.

---

## 10. Simulating delays and failures

### Deterministic test cards

Use any future expiry date (e.g. `12/30`), any 3-digit CVC and any name. Card numbers must pass the Luhn check.

| Card number | Outcome |
|---|---|
| `4242 4242 4242 4242` | Success (Visa) |
| `5555 5555 5555 4444` | Success (Mastercard) |
| `4000 0000 0000 0002` | Declined: `CARD_DECLINED` (200, FAILED) |
| `4000 0000 0000 9995` | Declined: `INSUFFICIENT_FUNDS` (200, FAILED) |
| `4000 0000 0000 0069` | Declined: `EXPIRED_CARD` (200, FAILED) |
| `4000 0000 0000 0119` | Gateway error (502), payment back to PENDING, retryable |
| `4000 0000 0000 1018` | Gateway timeout: waits `gateway_timeout_ms`, 504, later settles FAILED (`GATEWAY_TIMEOUT`) |
| `4000 0000 0000 2024` | Async: 202 PROCESSING, later settles SUCCEEDED |
| `4000 0000 0000 3030` | Async: 202 PROCESSING, later settles FAILED (`CARD_DECLINED`) |
| any other valid number | Success |

The same list is available from `GET /api/v1/dev/test-cards` and in the checkout page's **Test cards** panel.

### Outcome precedence

1. `gateway_error_every_n = N > 0`: every Nth confirmation (counting since the last settings change) is a gateway error.
2. `payment_outcome_override` ≠ `none`: forces `success | decline | insufficient_funds | expired_card | gateway_error | timeout | pending` for every confirmation.
3. Otherwise the card number decides.

### Delays

| Setting (`.env` / runtime field) | Effect |
|---|---|
| `SIM_RESPONSE_DELAY_MS` / `response_delay_ms` | Fixed delay added to every `/api/v1` request (not `/health`, not `/dev/*`) |
| `SIM_RESPONSE_JITTER_MS` / `response_jitter_ms` | Extra 0..N ms from a seeded RNG (`SIM_RANDOM_SEED`), so sequences are repeatable after a restart or settings change |
| `SIM_ENDPOINT_DELAYS_MS` / `endpoint_delays_ms` | JSON map `"METHOD /path-prefix"` or `"/path-prefix"` → ms, e.g. `{"GET /api/v1/transactions": 750}` |
| `X-Simulate-Delay-Ms: <ms>` request header | Per-request extra delay (when `SIM_ALLOW_DELAY_HEADER=true`) |
| `SIM_MAX_DELAY_MS` / `max_delay_ms` | Cap on the total simulated delay per request |
| `SIM_GATEWAY_LATENCY_MS` / `gateway_latency_ms` | Gateway processing time inside `/confirm` |
| `SIM_GATEWAY_TIMEOUT_MS` / `gateway_timeout_ms` | How long the timeout scenario waits before 504 |
| `SIM_PENDING_RESOLUTION_SECONDS` / `pending_resolution_seconds` | Time until PROCESSING payments settle |

Delays use `asyncio.sleep`, so they don't block worker threads. Responses that were delayed carry `X-Simulated-Delay-Ms`.

### Changing settings at runtime (no restart)

```bash
# Slow every API call by 300 ms, transactions by a further 700 ms
curl -s -X PUT $API/dev/simulation -H "Content-Type: application/json" \
  -d '{"response_delay_ms":300,"endpoint_delays_ms":{"GET /api/v1/transactions":700}}'

# Force every confirmation to time out
curl -s -X PUT $API/dev/simulation -H "Content-Type: application/json" \
  -d '{"payment_outcome_override":"timeout","gateway_timeout_ms":3000}'

# Every 5th confirmation fails with 502
curl -s -X PUT $API/dev/simulation -H "Content-Type: application/json" -d '{"gateway_error_every_n":5}'

curl -s $API/dev/simulation              # inspect
curl -s -X DELETE $API/dev/simulation    # restore .env defaults
```

Runtime settings are held in memory, so they are lost on restart and reset by `POST /dev/reset` (unless `?reset_simulation=false`).

---

## 11. Resetting the database

| Method | When |
|---|---|
| `POST http://127.0.0.1:8000/api/v1/dev/reset` | API running. Optional `?load_test_users=200` and `?reset_simulation=false` |
| `scripts\reset-db.ps1` / `bash scripts/reset-db.sh` | Any time (runs `python -m app.seed --reset`) |
| Delete `backend/data/app.db*` and restart the API | Nuclear option |

A reset drops all tables, recreates them and re-seeds. **All access tokens become invalid**, so log in again. Avoid resetting while a load test is running.

The dev endpoints are not mounted when `APP_ENV=production` or `ENABLE_DEV_ENDPOINTS=false`; they then return 404.

---

## 12. Postman collection

Import both files from `postman/`:

* `SchoolFees.postman_collection.json` (Postman v2.1)
* `SchoolFees.local.postman_environment.json`, then select **School Fees - Local**

Suggested order: **Auth / Login** (stores `accessToken`), **Students & Fees / Outstanding fees** (stores `feeId`), **Payments / Create payment (new key)** (stores `paymentId` and `idempotencyKey`), then one of the **Confirm – …** requests. The collection's scripts only chain variables; it contains no assertions. Regenerate the files with `python postman/generate_collection.py`.

---

## 13. Frontend notes for UI automation

### Routes

| Route | Page |
|---|---|
| `/login?next=/path` | Login (redirects to `next` after success) |
| `/` | Dashboard |
| `/fees/:feeId` | Fee details |
| `/fees/:feeId/pay` | Checkout (step 1: amount, step 2: card) |
| `/fees/:feeId/pay?payment=:paymentId` | Resume checkout for a PENDING payment |
| `/payments/:paymentId` | Payment result and details (polls while PROCESSING) |
| `/transactions?status=&student=&from=&to=&page=&size=` | History; filters live in the URL |

### Selectors and states

* Interactive and stateful elements have stable `data-testid` attributes, e.g. `email-input`, `login-button`, `fee-row-<feeId>`, `pay-fee-button`, `card-number-input`, `pay-button`, `processing-overlay`, `payment-success`, `payment-failure`, `payment-pending`, `payment-awaiting`, `payment-cancelled`, `transactions-table`, `next-page`.
* Status badges expose `data-status` (e.g. `SUCCEEDED`, `OVERDUE`), and the payment page root exposes `data-payment-status`.
* Loading states render `role="status"` with `data-testid="loading"` (or a more specific id such as `fees-loading`). Errors use `role="alert"` (`error-state`, `login-error`, `confirm-error`). Field errors are `*-error` (e.g. `card-number-error`).
* The session is stored in `localStorage` under `feeflow.session` (token, expiry, parent), which works with Playwright `storageState`. A 401 from the API clears it and shows `session-expired` on the login page.
* The layout is responsive: below 640 px, tables render as stacked cards and the navigation wraps.

---

## 14. Troubleshooting

| Problem | Fix |
|---|---|
| UI shows "Unable to reach the server" | Is the backend running? Open http://127.0.0.1:8000/api/v1/health. Does `VITE_API_BASE_URL` match it? Restart `npm run dev` after editing `frontend/.env`. |
| Browser console shows a CORS error | Add the exact UI origin (scheme + host + port) to `CORS_ORIGINS` in `backend/.env` and restart the API. `localhost` and `127.0.0.1` are different origins. |
| `Port 8000/5173 is already in use` | Windows: `netstat -ano \| findstr :8000`, then `taskkill /PID <pid> /F`. macOS: `lsof -i :8000`, then `kill <pid>`. Or change `APP_PORT` / `VITE_DEV_PORT` (and `VITE_API_BASE_URL` / `CORS_ORIGINS`). |
| PowerShell: "running scripts is disabled" | Use `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1`, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once. |
| `py` / `python` not found on Windows | Install Python from python.org with "Add to PATH" checked, or disable the Microsoft Store alias (Settings → Apps → Advanced app settings → App execution aliases). |
| macOS: `python` not found | Use `python3`. The scripts already do. |
| `localhost` doesn't resolve to the API | Use `127.0.0.1` (the default) instead of `localhost` in `VITE_API_BASE_URL`. |
| Everything returns 401 after a reset | Resets invalidate tokens. Log in again (the UI redirects automatically). |
| `database is locked` | Close tools holding the DB (e.g. a DB browser with an open write transaction). Don't run more than one API process against the same file. |
| Settings changed via `/dev/simulation` don't apply | Make sure only one uvicorn worker is running (no `--workers N`). Runtime settings are per-process. |
| Code change not picked up by the backend | Auto-reload only runs with `APP_ENV=development`. On some Windows setups the file watcher misses changes, so restart `python run.py`. |
| Overdue / upcoming dates look stale | Due dates are relative to the last seed; reset the database. |
| Payment stuck in "Payment pending" | Settlement happens on the next read after `SIM_PENDING_RESOLUTION_SECONDS`. The UI polls automatically; if the API was restarted, just reload the page. |
| Swagger "Try it out" returns 401 | Click **Authorize** and paste only the token (no `Bearer ` prefix). |
| Load test plateaus | Raise `THREADPOOL_SIZE`, set `LOG_LEVEL=WARNING`, and remember SQLite serialises writes (by design, so there is something to measure). |

---

### Out of scope (by design)

Performance dashboards and CI workflows are intentionally **not** included. Playwright and k6 tests are added incrementally from the catalogue (see the [main README](../README.md)).

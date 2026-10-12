# Plan: AUTH-PERF-001 – Login throughput at a morning peak

| Field | Value |
|---|---|
| Plan status | APPROVED |
| Requirement fingerprint | `sha256:a23c16a04a586490` |
| Catalogue updatedAt | 2026-10-11T14:46:17Z (informational; staleness uses the fingerprint) |
| Type / target | PERFORMANCE → k6 → `tests/k6/scripts/AUTH-PERF-001.js` (k6 tags `{"category":"performance","case_id":"AUTH-PERF-001"}`) |
| Priority | P1 |

## Requirement (from catalogue – do not edit here)
AC1: Thresholds: http_req_failed < 1%; p(95) < 1000 ms for name:POST /auth/login; checks > 99%.
AC2: Record the max sustainable rate in notes if thresholds fail (step the rate down 10 → 5/s).

Objective: Login (PBKDF2-hashed) sustains a realistic burst of parents signing in.
Risk: CPU-bound password hashing becomes the bottleneck and blocks access at peak.

Preconditions:
- Backend running at API_BASE_URL (default http://127.0.0.1:8000/api/v1) with dev endpoints enabled (APP_ENV=development).
- LOG_LEVEL=WARNING in backend/.env for load runs (restart backend).
- Fresh seed (POST /api/v1/dev/reset) before the run; SEED_LOAD_TEST_USERS ≥ number of VUs.

Test data: Accounts loadtest001…loadtest050 cycled per iteration.

Steps:
1. Scenario: constant-arrival-rate 10 logins/s for 2 min (preAllocatedVUs 20, maxVUs 60).
2. Iteration: POST auth/login for loadTestEmail(((iter) % 50) + 1); check 200 and access_token present.
3. Tag requests name:POST /auth/login.

Source: `node test-manager/scripts/case.mjs show AUTH-PERF-001`

## Observed application facts
Source: backend source as summarised by the explorer (nothing was run), plus `backend/app/routers/dev.py` and `backend/app/simulation.py` read by the planner.
- `POST /api/v1/auth/login {email, password}`: sync handler in the threadpool (THREADPOOL_SIZE 100), PBKDF2-SHA256 with 120,000 iterations (same hash cost for every seeded account), single uvicorn worker (reload in development), SQLite in WAL mode. Each successful login INSERTs one `auth_tokens` row (TTL 120 min). Rows are removed only by `dev/reset`.
- Responses: 200 `{access_token, token_type, expires_at, parent}`; 401 `INVALID_CREDENTIALS`; 422 `VALIDATION_ERROR`. Headers `X-Request-ID`, `X-Response-Time-Ms`. No rate limiting or lockout (no 429).
- Logins carry no per-account state; concurrent logins for one account are safe. 50 accounts are enough for any VU count.
- `GET /api/v1/dev/simulation` returns `SimulationConfig` (`response_delay_ms`, `response_jitter_ms`, `endpoint_delays_ms`, …). `/auth/login` is **not** exempt from response delay, jitter or endpoint delays (only `/health` and `/dev` are). The defaults are 0 / 0 / `{}`.
- `POST /api/v1/dev/reset` drops all data, including every token, and by default restores the simulation settings. It logs out any concurrent Playwright or UI session.
- Seeding: `SEED_LOAD_TEST_USERS` defaults to 50 (`backend/.env` = 50). k6 `config.loadTestUsers` defaults to 50 (`LOAD_TEST_USERS`).
- LOG_LEVEL: no endpoint or header exposes it (`backend/.env` currently `LOG_LEVEL=INFO`).
- k6 framework (read by the planner):
  - `config/env.js`: `config`, `url()`, `loadTestEmail()`, `requirePassword()`, local-host guard.
  - `config/profiles.js`: `resolveProfile()` for smoke, baseline and load. Opt-in via `PERF_ALLOW_LOAD=yes`. `load` is capped at 50 VUs. The internal `num()` env parser is not exported.
  - `lib/auth.js`: `login()` throws on failure, which suits setup() only.
  - `lib/summary.js`: `summaryHandler(name, profile, scenario)`. The headline falls back to unscoped metrics when `{scenario:…}` sub-metrics are absent, and doesn't report `dropped_iterations`.
  - `run.mjs`: check, smoke, read and baseline only. There is no catalogue-case runner. `check` runs `k6 inspect` on every top-level `scripts/*.js` with `PERF_PROFILE=smoke`.
- k6 CLI `--vus 1 --iterations 1` (the placement command) replaces `options.scenarios` with a `default` shared-iterations scenario that runs the exported `default` function. So the workload must use the default export (no `exec`), and the thresholds must not be scoped by `{scenario:…}`.

## Framework changes
| Change | File | Kind (new/modify) | Why | Reused by |
|---|---|---|---|---|
| `resolveCaseProfile(buildWorkload)`: `PERF_PROFILE` unset or `smoke` → the existing smoke profile; `PERF_PROFILE=case` → requires `PERF_ALLOW_LOAD=yes` (same error text style as `resolveProfile`), then returns `{ name: 'case', ...buildWorkload() }`. Any other value throws "catalogue cases support smoke or case". `buildWorkload` is a function, so case-specific env values are parsed only when opted in. | `tests/k6/config/profiles.js` | modify | Every catalogue PERF case needs "smoke by default, its own catalogue workload only on opt-in". The generic `load` profile (ramping-vus, cap 50) doesn't match. Keeps the opt-in guard in one place. | FEE-PERF-001, FEE-PERF-002, PAY-PERF-001…005 |
| Export the existing `num(name, fallback)` env parser as `envNumber` (no behaviour change) | `tests/k6/config/profiles.js` | modify | Scripts must not read `__ENV` directly. AC2 needs an overridable rate (`PERF_RATE`) with the same positive-number validation. | FEE-PERF-002, PAY-PERF-001, PAY-PERF-003 (rate step-downs) |
| Add `droppedIterations` (`dropped_iterations` count, 0 when absent) to the headline, the Markdown table and the console line | `tests/k6/lib/summary.js` | modify | AC2's "max sustainable rate" has to show whether the arrival rate was reached. Today that is only buried in the raw JSON. | FEE-PERF-002, PAY-PERF-001, PAY-PERF-003 (each asserts or records dropped_iterations) |
| `node run.mjs case <ID>` (npm `perf:case`, used as `npm run perf:case -- AUTH-PERF-001`). Validates the ID against `^[A-Z]+-PERF-\d{3}$` and that `scripts/<ID>.js` exists. Profile from `PERF_PROFILE` (default smoke). Needs the password. Same `.env` loading, host guard, banner, API check and `mkdir` of `PERF_RESULTS_DIR` as `run`. | `tests/k6/run.mjs`, `tests/k6/package.json` | modify | Lets an operator run the case with the password loaded from the git-ignored `.env` instead of typed with `-e` on the command line. It also shows the resolved scenario before an approved load run. Optional: see Open question 3. | All 8 `*-PERF-*` cases |
| The case script | `tests/k6/scripts/AUTH-PERF-001.js` | new | Placement path | n/a |

Not changed: `lib/auth.js login()` stays setup-only (it throws, which is wrong per iteration under load). The per-iteration login is inline in the script, using the same name tag and check names. A shared non-throwing login helper is deferred until a second case (e.g. PAY-PERF-003) needs per-iteration logins.

Config / env changes:
- `tests/k6/env.example`: add a commented `# PERF_RATE=` (arrival-rate override for catalogue cases; AUTH-PERF-001 default 10). Document `PERF_PROFILE=case` in the PERF_PROFILE comment.
- `tests/k6/README.md`: §2 table (`PERF_RATE`, `PERF_PROFILE=case`), §3 (`perf:case`), §5 (dropped iterations in the report), §7 (catalogue full workloads use `PERF_PROFILE=case` + `PERF_ALLOW_LOAD=yes`).
- No Playwright or backend config changes. Operator-only: `LOG_LEVEL=WARNING` in `backend/.env` for the full run (see Approval required).

## Test design
**Workload** (`options.scenarios.login_peak`):
- Smoke (default; `perf:check`, validation): the smoke profile from `resolveCaseProfile`, i.e. shared-iterations, 1 VU × `PERF_ITERATIONS` (default 1), maxDuration 1m. With the placement command, k6's CLI `--vus 1 --iterations 1` replaces it with the `default` scenario. Both paths run the same default function.
- Full (only with `PERF_PROFILE=case` + `PERF_ALLOW_LOAD=yes`, approved per run): `{ executor: 'constant-arrival-rate', rate: envNumber('PERF_RATE', 10), timeUnit: '1s', duration: '2m', preAllocatedVUs: 20, maxVUs: 60 }`. The description is `constant-arrival-rate <rate>/s for 2m (preAllocatedVUs 20, maxVUs 60)`.

**Options**: `thresholds` (below), `summaryTrendStats: SUMMARY_TREND_STATS`, `tags: { category: 'performance', case_id: 'AUTH-PERF-001' }`. An init banner (`__VU === 0`) prints the host, profile and description, with no secrets.

**Thresholds (AC1, one-to-one; the case's own, not `thresholds()` from profiles.js, whose p95 < 500 ms doesn't match)**:
| AC1 clause | k6 threshold |
|---|---|
| http_req_failed < 1% | `'http_req_failed{name:POST /auth/login}': ['rate<0.01']` (see Open question 4 on scope) |
| p(95) < 1000 ms for name:POST /auth/login | `'http_req_duration{name:POST /auth/login}': ['p(95)<1000']` |
| checks > 99% | `checks: ['rate>0.99']` |
| (framework convention, not an AC) records the login request count and achieved rate for AC2; fails only if no login ran | `'http_reqs{name:POST /auth/login}': ['count>0']` (see Open question 5) |

Not `{scenario:…}`-scoped, because the CLI override would rename the scenario to `default` and leave those sub-metrics empty.

**Setup**: `setup()`
- S0a Simulation guard (read-only): `GET url('/dev/simulation')` with tag `name: 'GET /dev/simulation (guard)'` and no `check()`. Throw (aborting the run, exit 107) unless the status is 200 and `response_delay_ms === 0`, `response_jitter_ms === 0` and `endpoint_delays_ms` is empty. Otherwise the measured latency would be simulated rather than real. This doesn't change settings, so there is no teardown.
- S0b Password: `requirePassword()` is called once and returned as `{ password }`. `summaryHandler` already redacts `setup_data`. The password is never logged.
- No `dev/reset` and no login in setup(). The fresh seed is an operator precondition (see Test data & isolation).

**Iteration** (`export default function ({ password })`):
- S1 Scenario (catalogue step 1): provided by `options.scenarios.login_peak` as above. Covers the workload shape: constant-arrival-rate 10/s, 2 min, preAllocatedVUs 20, maxVUs 60.
- S2 Login (catalogue step 2):
  - `i = exec.scenario.iterationInTest` (`import exec from 'k6/execution'`). This is unique across VUs within the scenario. `__ITER` is per-VU and would skew towards loadtest001.
  - `email = loadTestEmail((i % 50) + 1)`. The modulus is the spec's literal 50, matching `SEED_LOAD_TEST_USERS=50`.
  - `http.post(url('/auth/login'), JSON.stringify({ email, password }), { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, tags: { name: 'POST /auth/login' }, timeout: config.requestTimeout })`.
  - `check(res, { 'login: status 200': r => r.status === 200, 'login: access_token present': () => typeof body?.access_token === 'string' && body.access_token.length > 0 })`, where `body` is parsed only when the status is 200.
  - Nothing thrown or logged on failure. A failed check feeds the `checks` and `http_req_failed` thresholds. No sleep, because the arrival rate paces iterations.
- S3 Tagging (catalogue step 3): the `name: 'POST /auth/login'` tag on every measured request, as in S2. The setup guard uses a different name, so it is outside every name-scoped threshold.

**Summary**: `export const handleSummary = summaryHandler('AUTH-PERF-001', profile, 'login_peak')` writes `<PERF_RESULTS_DIR>/AUTH-PERF-001-summary.json` and `-report.md`. AC1 pass/fail is read from the threshold rows (name-scoped). The headline (unscoped fallback) includes the one setup guard request.

**AC2 (process, not script logic)**: k6 can't decide on a step-down itself. After an approved 10/s run:
- If every AC1 threshold passes: record "sustained 10/s" (p95, error rate, checks, achieved rate, dropped_iterations) in the catalogue note.
- If any AC1 threshold fails (exit 99): with separate approval (Open question 6), re-run with `PERF_RATE=5`.
  - The **max sustainable rate** = the highest tested rate at which all AC1 thresholds passed.
  - If 5/s also fails, record "< 5/s (10/s and 5/s failed)". No further step-down without the user's decision.
  - The note lists, per rate: thresholds pass/fail, p95, error rate, check rate, achieved login rate (`http_reqs{name:POST /auth/login}` rate), dropped_iterations, LOG_LEVEL and seed state.
- Each run uses its own results dir (`PERF_RESULTS_DIR=results/AUTH-PERF-001-rate10`, `…-rate5`), so the 5/s run doesn't overwrite the 10/s evidence.

## Test data & isolation
- Accounts loadtest001…loadtest050@example.com, shared seeded password from `TEST_USER_PASSWORD` (k6 `.env` or the Playwright `.env` fallback; env var name only). Login only reads the account and writes a token row, so there are no per-VU account conflicts. The smoke iteration uses loadtest001 (iterationInTest 0).
- Fresh seed: an **operator step immediately before each approved full run**, not in `setup()`. The command is `POST /api/v1/dev/reset` (default `reset_simulation=true`, which also guarantees simulation defaults). A reset inside setup() would run on every smoke, revoke concurrent Playwright/UI sessions, and break the read-only smoke guarantee. The smoke/validation path never resets.
- Before the full run, the operator also confirms `SEED_LOAD_TEST_USERS=50` (or more) in `backend/.env`.
- Side effects: one `auth_tokens` row per login. That is about 1,200 rows for a 10/s × 2 min run (about 600 at 5/s) and 1 row per smoke. The rows expire after 120 min and are removed only by the next `dev/reset`. There are no other writes and no simulation changes.
- Cleanup: none required (tokens are inert). Optionally reset after the full run (Open question 7).
- Isolation: don't run alongside the Playwright suite (its `dev/reset` calls would revoke tokens and the shared SQLite would add CPU contention) or other k6 runs. Use a quiet machine for the full run.

## Risks & flakiness controls
- **Simulated latency inflating p95:** setup guard S0a aborts if response delay, jitter or endpoint delays are non-zero.
- **INFO logging cost distorting latency:** operator sets `LOG_LEVEL=WARNING` and restarts the backend (`scripts\start-backend.ps1`) before the full run. This can't be verified by the script, so the value is recorded in the run note.
- **Development `--reload` worker / single process:** results are only valid for this local setup. The note records the machine and backend mode. This is a known limitation, not something to fix in the test.
- **CPU-bound PBKDF2 saturation** (the case's own risk): may show as p95 growth, timeouts (`PERF_REQUEST_TIMEOUT` 10 s) and `dropped_iterations` once maxVUs 60 is exhausted. These are findings, not test defects. Never raise the thresholds, maxVUs or timeout to make a run pass.
- **k6 generator competing for CPU with the backend on the same host:** noted as an environmental factor in the run note. The thresholds are unchanged.
- **Account skew:** `iterationInTest` gives an even round-robin across the 50 accounts. Concurrent logins for one account are safe anyway.
- **Smoke override:** the placement command's `--vus 1 --iterations 1` replaces the scenario. Thresholds aren't scenario-scoped, so they still evaluate (1 login: p95 = its own latency; failed rate 0/1; checks 2/2).
- **perf:check:** the script must pass `k6 inspect` with `PERF_PROFILE=smoke` and no password. So the password is read only in setup(), and `PERF_RATE` is parsed only inside `buildWorkload` (the case profile).
- **Secrets:** no `--http-debug=full`. The password lives only in `setup_data` (redacted). No logging of email+password pairs. The email alone is fine but not needed in logs.
- **No arbitrary waits:** arrival-rate pacing only. The script has no `sleep()` and no observation windows.
- **Summary headline:** `requests` in the headline is logins + 1 setup guard request. The AC1 verdict and AC2 achieved rate come from the `{name:POST /auth/login}` sub-metrics.

## Execution
Validation (engineer/validator; no load, no reset, no approval needed):
1. `cd tests/k6 && npm run perf:check` (static: k6 inspect of every script, API health).
2. `cd tests/k6 && k6 run --no-usage-report --vus 1 --iterations 1 scripts/AUTH-PERF-001.js` (the placement command; 1 login + 1 guard GET). `TEST_USER_PASSWORD` must be present in the process environment, exported from `tests/k6/.env` / `tests/playwright/.env` without echoing it, never typed with `-e`. Equivalent, if the runner change is accepted: `cd tests/k6 && npm run perf:case -- AUTH-PERF-001` (smoke by default).

   Expected: exit 0, thresholds PASSED, 1 login request, checks 2/2. The updater records a **smoke** result only.

Full workload (only when the user explicitly asks and approves the run; never part of validation):
- Operator checklist first: `LOG_LEVEL=WARNING` + restart, `SEED_LOAD_TEST_USERS=50`, Playwright suite not running, `POST /api/v1/dev/reset`.
- Then `cd tests/k6 && PERF_PROFILE=case PERF_ALLOW_LOAD=yes PERF_RESULTS_DIR=results/AUTH-PERF-001-rate10 npm run perf:case -- AUTH-PERF-001`.
- Without the runner: the same env vars plus `TEST_USER_PASSWORD` in the environment, then `k6 run --no-usage-report scripts/AUTH-PERF-001.js`.

Step-down (separately approved): the same with `PERF_RATE=5` and `PERF_RESULTS_DIR=results/AUTH-PERF-001-rate5`, preceded by a fresh `dev/reset`.

### Approval required
Each item needs the user's explicit, per-run approval naming AUTH-PERF-001, the rate and the target (127.0.0.1:8000):
1. **Full run at 10 logins/s**: `PERF_PROFILE=case`, `PERF_ALLOW_LOAD=yes`, constant-arrival-rate 10/s for 2 min, up to **60 VUs** (above the framework's 50-VU load cap, so this approved plan is required). About 1,200 logins and token rows.
2. **Step-down run at 5 logins/s** (`PERF_RATE=5`), only if run 1 fails an AC1 threshold. About 600 logins and token rows.
3. **`POST /api/v1/dev/reset` before each full run**: destroys all data and sessions (logs out any open Playwright/UI session) and restores the simulation defaults.
4. **Backend config change for the load runs**: `LOG_LEVEL=WARNING` in `backend/.env` plus a backend restart (and restoring INFO afterwards, if wanted).
5. Any repeat run, a different rate, duration or VU limits, or a non-local target (`PERF_ALLOWED_HOST`). These are outside this plan and need a plan revision.

Not requiring approval: `npm run perf:check` and the 1-iteration placement smoke (no reset, no config change).

## Open questions / spec mismatches
1. **Fresh seed: operator step vs `setup()`.** Recommend an operator step before each approved full run (Approval item 3). A `dev/reset` in setup() would also run on every smoke and revoke other sessions.
2. **"SEED_LOAD_TEST_USERS ≥ number of VUs" vs maxVUs 60 vs 50 accounts.** Read literally, 60 VUs would need 60 or more accounts, but the iteration cycles `% 50` and logins are stateless. Recommend keeping 50 accounts and `% 50` as written (no catalogue change by the planner), and asking the catalogue owner to reword the precondition to "≥ 50 (the accounts cycled)".
3. **Is a `run.mjs case <ID>` runner wanted?** Recommend yes: it keeps the password out of command lines, shows the resolved scenario, and is reused by all 8 PERF cases. If declined, validation uses the raw placement command with the password exported from `.env`.
4. **Scope of "http_req_failed < 1%".** Is it global or only `name:POST /auth/login`? Recommend name-scoped. All measured traffic is login, and it excludes the one setup guard GET. A global threshold would also be acceptable and practically identical.
5. **The `http_reqs{name:POST /auth/login}: count>0` recorder** isn't an AC. It follows the framework convention (prevents a vacuous pass) and supplies the achieved rate for AC2. Keep it, or drop it?
6. **Step-down timing.** Should a failing 10/s run be followed immediately by the 5/s run (pre-approved together), or wait for a separate approval? Recommend separate approval after reviewing the 10/s report. Also: should `dropped_iterations > 0` count against "sustainable"? The spec only defines failure by the AC1 thresholds. Recommend recording it, not using it as a criterion.
7. **After the run:** restore `LOG_LEVEL=INFO`, and do a `dev/reset` to clear about 1,200 token rows? Recommend restoring INFO and no post-run reset (the tokens are harmless and expire in 120 min).
8. **Simulation guard (S0a)** adds a read-only precondition check, not an assertion. Recommend keeping it, since a non-zero simulated delay would make the AC1 latency result meaningless.

## Approval
- [x] Approved by user on 2026-10-12 ("Approve as recommended"). The open questions are settled by the plan's recommendations:
  1. Fresh seed is an operator step before each approved full run (not in setup()).
  2. Keep 50 accounts and `% 50` as written; the precondition wording is for the catalogue owner.
  3. Add the `run.mjs case <ID>` / `npm run perf:case` runner.
  4. `http_req_failed` is scoped to `name:POST /auth/login`.
  5. Keep the `http_reqs{name:POST /auth/login}` count>0 recorder.
  6. The 5/s step-down needs a separate approval after the 10/s report; `dropped_iterations` is recorded, not a criterion.
  7. Restore `LOG_LEVEL=INFO` after load runs; no post-run reset.
  8. Keep the setup() simulation guard.
  Approval covers implementation and validation (perf:check + 1-iteration smoke) only. Every item in "Approval required" still needs explicit approval per run.

## Revision history
- 2026-10-12 DRAFT created by test-planner
- 2026-10-12 APPROVED by user; open questions resolved per the recommendations

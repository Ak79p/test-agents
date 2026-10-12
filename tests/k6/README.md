# k6 workspace

Performance tests for the FeeFlow API with [Grafana k6](https://grafana.com/docs/k6/latest/). The framework is ready: shared configuration, safety guards, two low-impact **starter** scripts and a report writer. Catalogue performance cases (`*-PERF-*`) are added one at a time through the agent workflow (§8); implemented so far: `scripts/AUTH-PERF-001.js`.

```
tests/k6/
├── config/env.js        target URL, accounts, request timeout, results dir + the local-host guard
├── config/profiles.js   load profiles (smoke default; baseline/load opt-in) + provisional thresholds
├── lib/auth.js          login in setup() + authenticated request params (never logs secrets)
├── lib/summary.js       handleSummary: JSON summary + Markdown report + short console summary
├── scripts/starter/     framework starters (not catalogue cases): api-smoke.js, read-journey.js
├── scripts/<ID>.js      one script per catalogue case (placement from case.mjs)
├── results/             <script>-summary.json and <script>-report.md (git-ignored except .gitkeep)
├── run.mjs              safe runner behind the npm scripts (prereqs, guards, banner)
├── package.json         perf:* scripts (no npm dependencies)
└── env.example          every variable, with defaults; copy to .env (git-ignored)
```

k6 tests are independent of Playwright: no browser, no Playwright fixtures, no shared npm dependencies. They share only the environment-variable names (`API_BASE_URL`, `TEST_USER_PASSWORD`). Functional correctness stays in [tests/playwright](../playwright/FRAMEWORK.md); k6 answers "how does the API behave under concurrent traffic?", with pass/fail decided by **thresholds** on latency percentiles and error rates.

## 1. Install or verify k6

Checked on this machine: `k6 v2.2.0 (go1.26.5, windows/amd64)`. `npm run perf:check` verifies it on any machine and prints install instructions if it's missing:

| OS | Command |
|---|---|
| Windows | `winget install k6 --source winget`, or `choco install k6`, or the MSI from https://github.com/grafana/k6/releases |
| macOS | `brew install k6` |

Open a new terminal afterwards and run `k6 version`. k6 is a single Go binary; scripts run in k6's own JavaScript runtime, so npm packages can't be imported (only `k6/*` modules and relative files).

## 2. Configure

```powershell
cd tests/k6
Copy-Item env.example .env      # then set TEST_USER_PASSWORD (docs/APPLICATION.md §6)
```

`npm run perf:*` loads `tests/k6/.env`. If `TEST_USER_PASSWORD` or `API_BASE_URL` are still unset, it falls back to `tests/playwright/.env`. Both files are git-ignored. Plain `k6 run` never reads `.env` files: set real environment variables or pass `-e NAME=value`. Every variable and its default is listed in [env.example](env.example). The key ones:

| Variable | Default | Meaning |
|---|---|---|
| `API_BASE_URL` | `http://127.0.0.1:8000/api/v1` | Target. Non-local hosts are refused unless `PERF_ALLOWED_HOST` equals that host |
| `TEST_USER_PASSWORD` | *(required by the read journey)* | Seeded password. Read only in `setup()`; never printed |
| `PERF_USER_EMAIL` | `loadtest001@example.com` | Account for the read journey (read-only use) |
| `PERF_PROFILE` | `smoke` | `smoke`, `baseline` or `load` (starters); `smoke` or `case` (catalogue `scripts/<ID>.js`: the case's own workload) |
| `PERF_ALLOW_LOAD` | *(unset)* | Must be `yes` for any profile other than smoke. Set it only after approval |
| `PERF_ITERATIONS` / `PERF_VUS` / `PERF_DURATION` / `PERF_RAMP_UP` / `PERF_RAMP_DOWN` / `PERF_THINK_TIME` | see env.example | Profile parameters |
| `PERF_REQUEST_TIMEOUT` | `10s` | Per-request timeout |
| `PERF_RATE` | per case (AUTH-PERF-001: `10`) | Arrival-rate override for catalogue cases with `PERF_PROFILE=case` (e.g. an approved step-down to `5`) |
| `PERF_P95_MS` / `PERF_P99_MS` / `PERF_MAX_ERROR_RATE` / `PERF_MIN_CHECK_RATE` | `500` / `1000` / `0.01` / `0.99` | Provisional thresholds (§5) |
| `PERF_RESULTS_DIR` | `results` | Output folder, relative to `tests/k6` |

## 3. Run

Start FeeFlow first (`scripts\start-backend.ps1`; see the [main README](../../README.md#spin-up-the-demo-app)). Then, from `tests/k6`:

| Command | What it runs | Load | Risk |
|---|---|---|---|
| `npm run perf:check` | k6 version, `k6 inspect` of every script, env presence (values hidden), API health | none | none |
| `npm run perf:smoke` | `starter/api-smoke.js`: `GET /health` | 1 VU × 1 iteration | negligible; no login, no writes |
| `npm run perf:read` | `starter/read-journey.js`: login once, then dashboard → outstanding fees → fee detail → transactions | `PERF_PROFILE`, default smoke = 1 VU × 1 iteration | low; one auth-token row written by the login |
| `npm run perf:baseline` | read journey, `baseline` profile | 1 VU constant for 1 min (≈4 req/s with 1 s think time) | needs `PERF_ALLOW_LOAD=yes` and approval |
| `npm run perf:read` with `PERF_PROFILE=load` | read journey, `load` profile | ramp to `PERF_VUS` (default 5, max 50), hold 2 min | needs `PERF_ALLOW_LOAD=yes` and approval |
| `npm run perf:case -- <ID>` | catalogue case `scripts/<ID>.js` (e.g. `AUTH-PERF-001`), `PERF_PROFILE` default smoke | smoke = 1 VU × 1 iteration | low (smoke); the password comes from `.env`, never the command line |
| `npm run perf:case -- <ID>` with `PERF_PROFILE=case` | the case's own workload from its approved plan | as the plan defines (AUTH-PERF-001: 10 logins/s for 2 min, up to 60 VUs) | needs `PERF_ALLOW_LOAD=yes` and per-run approval |

Before any run, the runner prints the k6 version, script, target host, profile and the exact scenario **as k6 resolved it from the script** (`k6 inspect`). It then checks the API is reachable and runs `k6 run --no-usage-report`. Exit codes: `0` = thresholds passed; `99` = a threshold failed; `107` = the script refused to start (guard or exception); `1` = the runner refused (missing k6, password, host or API).

Stress, spike and soak profiles are deliberately not provided. They belong to specific catalogue cases, with an approved plan.

## 4. Safety rules

* **Default is smoke.** Every profile other than `smoke` refuses to start without `PERF_ALLOW_LOAD=yes`. Both the runner and the scripts enforce this, so plain `k6 run` is guarded too. Smoke is capped at 1 VU and 10 iterations; `load` is capped at 50 VUs.
* **Approval:** set `PERF_ALLOW_LOAD=yes` only for a run the user has explicitly approved (CLAUDE.md → Guardrails). Agents never set it on their own.
* **Local only:** non-local hosts are refused unless `PERF_ALLOWED_HOST` names that exact host. Never point these scripts at production.
* **No secrets in output:** passwords and tokens are never logged. `setup_data` (tokens) is redacted from the JSON summary. Never run with `--http-debug=full`, which prints headers.
* **No real money:** FeeFlow's gateway is simulated. The starters make no payments at all.
* **Data isolation:**
  * The starters are read-only apart from one login per run.
  * Read endpoints may settle that parent's own *due* PROCESSING payments, but a seeded loadtest account has none.
  * Never call `dev/reset` during a run: it revokes every token.
  * Don't run k6 alongside the Playwright suite, whose tests reset the database and revoke k6's token mid-run.
* **Cleanup limits:** the API has no delete endpoints. Writing scenarios (payments) leave records behind; only `POST /api/v1/dev/reset` removes them, and it affects everyone. Such cases need a plan stating which accounts they use and when a reset is acceptable.

## 5. Metrics, thresholds and reports

Each run writes `results/<script>-summary.json` (machine-readable: `meta`, `headline`, `thresholds`, `passed` and the full k6 data) and `results/<script>-report.md` (human-readable). It also prints a short summary:

| Measure | Source metric |
|---|---|
| Throughput / request count | `http_reqs{scenario:…}` rate / count |
| Error rate | `http_req_failed{scenario:…}` |
| Latency avg, median, p90, p95, p99, max | `http_req_duration{scenario:…}` (`summaryTrendStats` adds p99) |
| Checks passed / failed | `checks` |
| Iterations, max VUs | `iterations`, `vus_max` |
| Dropped iterations | `dropped_iterations` (0 when absent; arrival-rate executors only) |
| Threshold pass/fail | every threshold, as k6 evaluated it |

HTTP numbers and thresholds are scoped to the workload scenario (`{scenario:<name>}`), so the deliberately slow `setup()` login doesn't distort them. All-request totals stay in the JSON's `k6.metrics`.

**The default thresholds are provisional.** They are p95 < 500 ms, p99 < 1000 ms, errors < 1% and checks > 99%. Calibrate them from a repeatable baseline (same machine, same data, backend `LOG_LEVEL=WARNING`, several runs) and from realistic service expectations. Never loosen a threshold to make a run pass. Catalogue cases set their own thresholds from their expected results.

**Reading the numbers:**
* Look at the percentiles, not the average. A large median-to-p95 gap means queueing: SQLite allows one writer at a time, and the thread pool has a fixed size.
* `http_req_failed` counts 4xx and 5xx responses. If a scenario expects some (409s, simulated 502s), declare them with `http.setResponseCallback(http.expectedStatuses(…))`.
* Checks gate a run only through the `checks` threshold.
* With arrival-rate executors, `dropped_iterations > 0` means the target rate wasn't reached.
* Server-side clues: the `X-Response-Time-Ms` header and the backend access log (request IDs).

## 6. Writing a script

Copy the shape of `scripts/starter/read-journey.js`:

```js
import { config, url } from '../config/env.js';                      // never read __ENV directly
import { resolveProfile, thresholds, SUMMARY_TREND_STATS } from '../config/profiles.js';
import { authed, login } from '../lib/auth.js';
import { summaryHandler } from '../lib/summary.js';
const profile = resolveProfile();                                     // smoke unless opted in
export const options = {
  scenarios: { browse_fees: profile.scenario },                       // a catalogue case defines its own scenarios
  thresholds: thresholds('browse_fees'),                              // or the case's thresholds, scoped by scenario/name
  summaryTrendStats: SUMMARY_TREND_STATS,
  tags: { category: 'performance', case_id: 'FEE-PERF-002' },
};
export function setup() { return { token: login(config.perfUserEmail) }; }   // log in once, not per iteration
export const handleSummary = summaryHandler('FEE-PERF-002', profile, 'browse_fees');
```

* **Name tags:** give every request a stable `name` tag (`'GET /fees/{id}'`), so IDs don't create one metric series each.
* **Checks:** check status codes and the documented response shape (OpenAPI at `http://127.0.0.1:8000/openapi.json`). Never invent endpoints or fields.
* **Executors:** use open-model executors (`constant-arrival-rate`, `ramping-arrival-rate`) for capacity questions, and `per-vu-iterations` for concurrency cases such as idempotency storms.
* **Catalogue workloads:** a catalogue case's workload replaces the generic profile. Keep the smoke path working, so `k6 run --vus 1 --iterations 1 scripts/<ID>.js` (the placement command) stays a 1-iteration functional check. Use `resolveCaseProfile(() => ({ description, scenario }))` from `config/profiles.js`: smoke by default, the case workload only with `PERF_PROFILE=case` + `PERF_ALLOW_LOAD=yes`; read case overrides inside the builder with `envNumber('PERF_RATE', 10)`. Scope the case thresholds by `name` (not `scenario`) so the CLI `--vus/--iterations` override still evaluates them (see `scripts/AUTH-PERF-001.js`).

**App-specific rules** (from the real API):
* Login is CPU-heavy (PBKDF2), so log in in `setup()`.
* Map each VU to its own `loadtestNNN` account and fee. A fee with a PROCESSING payment rejects new payments with `409 PAYMENT_IN_PROGRESS`.
* Use small amounts and a new `crypto.randomUUID()` key per payment.
* Simulation changes go in `setup()` (`PUT /dev/simulation`) and are restored in `teardown()` (`DELETE /dev/simulation`).
* Gateway latency defaults to 800 ms.

## 7. Approval: what needs your explicit permission

| Action | Needs approval? |
|---|---|
| `perf:check`, `perf:smoke`, `perf:read` (smoke), and the 1-iteration placement command for a catalogue case | No (low impact) |
| Any run with `PERF_ALLOW_LOAD=yes` (`baseline`, `load`, or a catalogue case's full workload via `PERF_PROFILE=case`, e.g. `PERF_PROFILE=case PERF_ALLOW_LOAD=yes npm run perf:case -- AUTH-PERF-001`) | **Yes**: explicit, per run, naming the case or script, profile and target |
| Stress, spike or soak runs; more than 50 VUs; non-local targets (`PERF_ALLOWED_HOST`) | **Yes**, plus an approved plan |
| Scenarios that write data (payments) or change simulation settings | **Yes**: the plan must say which accounts, how state is restored, and whether a reset is acceptable |

## 8. Adding a catalogue performance test

Ask `Plan FEE-PERF-002` first, then `Implement the k6 test for FEE-PERF-002`. Routing and the agent sequence are in [CLAUDE.md](../../CLAUDE.md); the plan lifecycle (DRAFT → APPROVED → IMPLEMENTED) is in [tests/plans/README.md](../plans/README.md). In short:
1. The reader resolves the exact Performance case. The plan records its workload (executor, rate or VUs, duration), accounts and data, thresholds mapped to expected results, cleanup, and what needs approval.
2. You approve the plan.
3. The engineer writes `scripts/<ID>.js` with the shared config, profiles and report.
4. The validator runs `npm run perf:check` and the 1-iteration smoke only.
5. The updater records a **smoke** result.

The full workload runs only when you ask, e.g. "run the load profile for FEE-PERF-002". It's never part of `perf:check`, validation or any default command.

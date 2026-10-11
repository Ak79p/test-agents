# k6 workspace

Performance and load tests for the FeeFlow API. The workspace is initialised only: there are **no executable test scripts yet**. Scripts are added one at a time, by catalogue ID (`*-PERF-*` cases in [`test-manager/data/catalogue.json`](../../test-manager/data/catalogue.json)), via the workflow below.

```
tests/k6/
├── lib/config.js     the single source of configuration (API base URL, accounts)
├── scripts/          one script per catalogue case, e.g. scripts/PAY-PERF-001.js
├── results/          --summary-export output (git-ignored except .gitkeep)
└── env.example       variables and how to set them
```

## 0. ID-driven k6 workflow

**Identify a performance case.** Performance cases have `layer: "Performance"` and `automationTarget: "k6"`, and their IDs follow `<AREA>-PERF-<NNN>`. List them with:
```
node test-manager/scripts/case.mjs list --layer Performance
```
Currently: `FEE-PERF-001`, `FEE-PERF-002`, `AUTH-PERF-001`, `PAY-PERF-001` … `PAY-PERF-005`. An ID that isn't in the catalogue (e.g. `PERF-API-001`) is reported as not found. Nothing is created or substituted for it.

**Request it explicitly:** `Implement the k6 test for FEE-PERF-001`. The workflow in [CLAUDE.md](../../CLAUDE.md) then:
1. reads the case verbatim (`test-case-reader`; it must be a Performance case);
2. implements `tests/k6/scripts/<ID>.js` (`test-automation-engineer`), mapping the case's workload to scenarios, its expected results to thresholds and checks, and tagging requests with `name`;
3. validates it with a **functional smoke only** (`test-validator`): `k6 run --vus 1 --iterations 1 scripts/<ID>.js`, which proves the script works but is not a load result;
4. records it (`test-catalogue-updater`):
   ```
   node test-manager/scripts/case.mjs update <ID> --automation-status automated      --script-path tests/k6/scripts/<ID>.js --result <passed|failed> --executed today      --note "<smoke|load> run: k6 run … → thresholds ✓/✗, p95=…, http_req_failed=…"
   ```
   A 1-VU smoke may set the status to `automated`. The note must say it was a smoke run. Treat `latestResult` as the *load* verdict only after the full profile has run, which happens only when you ask, e.g. "run the load profile for FEE-PERF-002". Keep the summary with `--summary-export results/<ID>.json`.

**Load testing vs browser functional testing.** Playwright tests (`tests/playwright/`) answer "does this behaviour work correctly for one user?" with exact assertions, a real browser and sequential steps. k6 answers "how does the API behave under concurrent traffic?" with protocol-level HTTP only (no browser, no rendering), many virtual users, and pass/fail decided by **thresholds** on latency percentiles and error rates. Checks verify correctness under load but don't gate the run on their own. Don't port UI journeys to k6 or use Playwright to generate load.

## 1. Install k6

**Checked on this machine:** `k6 v2.2.0 (go1.26.5, windows/amd64)` at `C:\Program Files\k6\k6.exe`. It is already installed, so no action is needed here.

Other machines:

| OS | Command |
|---|---|
| Windows (winget, available here: v1.29) | `winget install k6 --source winget` |
| Windows (Chocolatey, not installed here) | `choco install k6` |
| Windows (manual) | MSI installer from https://github.com/grafana/k6/releases |
| macOS (Homebrew) | `brew install k6` |

Verify with `k6 version`. Open a **new** terminal after installing so `k6` is on `PATH`. k6 is a single Go binary and doesn't need Node.js. Scripts are JavaScript modules run by k6's own runtime, so **npm packages cannot be imported** (only `k6/*` modules, relative files and remote URLs).

## 2. Configuration

All scripts import configuration from `lib/config.js`:

```js
import { config, url, loadTestEmail } from '../lib/config.js';
// url('/fees/outstanding') -> http://127.0.0.1:8000/api/v1/fees/outstanding
```

| Variable | Default | Meaning |
|---|---|---|
| `API_BASE_URL` | `http://127.0.0.1:8000/api/v1` | Backend base URL including `/api/v1` |
| `TEST_USER_PASSWORD` | *(empty)* | Password of the seeded accounts ([docs/APPLICATION.md §6](../../docs/APPLICATION.md#6-seeded-credentials-and-data)) |
| `LOAD_TEST_USERS` | `50` | Must match backend `SEED_LOAD_TEST_USERS` |

k6 doesn't read `.env` files. Set variables like this:

```powershell
# Windows PowerShell (current session)
$env:API_BASE_URL = "http://127.0.0.1:8000/api/v1"
$env:TEST_USER_PASSWORD = "<seeded password>"
k6 run scripts\<CASE-ID>.js
```

```bash
# macOS / Linux
export API_BASE_URL=http://127.0.0.1:8000/api/v1
export TEST_USER_PASSWORD='<seeded password>'
k6 run scripts/<CASE-ID>.js
```

Per run, on either OS: `k6 run -e API_BASE_URL=http://127.0.0.1:8000/api/v1 -e TEST_USER_PASSWORD=... scripts/<CASE-ID>.js`. A value passed with `-e` overrides one from the real environment.

## 3. Running locally

1. Start the backend ([main README](../../README.md#spin-up-the-demo-app)). For load runs, consider these settings in `backend/.env`, then restart:
   * `LOG_LEVEL=WARNING`, because per-request access logs cost CPU.
   * `THREADPOOL_SIZE`: default 100; raise it for high concurrency.
   * `SEED_LOAD_TEST_USERS`: default 50; raise it when you need more distinct accounts, then reset the DB.
2. Optionally reset data first with `POST /api/v1/dev/reset`. This invalidates all tokens, so never call it during a run.
3. Run from `tests/k6/`:

```bash
k6 run scripts/<CASE-ID>.js                                            # full run
k6 run --vus 1 --iterations 1 scripts/<CASE-ID>.js                     # smoke: one iteration
k6 run --summary-export results/<CASE-ID>.json scripts/<CASE-ID>.js    # keep a JSON summary
k6 run --summary-mode full scripts/<CASE-ID>.js                        # include per-group/scenario detail
k6 inspect scripts/<CASE-ID>.js                                        # show resolved options without running
```

Exit codes: `0` = all thresholds passed; `99` = at least one threshold failed (verified locally); other non-zero values = script or runtime error.

## 4. Reading the end-of-test summary (k6 v2 format)

Abridged; the numbers are illustrative.

```
  █ THRESHOLDS
    http_req_duration
    ✗ 'p(95)<500' p(95)=812.4ms          ← ✓ passed / ✗ failed (decides the exit code)

  █ TOTAL RESULTS
    checks_succeeded...: 99.80% 998 out of 1000
    ✓ status is 200                      ← one line per check name (✗ when any evaluation failed)

    HTTP
    http_req_duration..............: avg=… med=… p(90)=… p(95)=…
      { expected_response:true }...: latency of non-error responses only
    http_req_failed................: share of responses counted as failures
    http_reqs......................: total requests and throughput (req/s)

    EXECUTION
    iteration_duration / iterations / vus / vus_max
    dropped_iterations   (arrival-rate executors: k6 couldn't start iterations on time → system saturated or too few VUs)
```

How to interpret it:

* **Look at the percentiles, not `avg`.** Use p(95) and p(99). Compare `med` with p(95): a large gap means queueing, e.g. SQLite write serialisation or a full thread pool.
* **`http_req_failed` counts 4xx and 5xx by default.** If a scenario expects some (409 conflicts, simulated 502s), declare them with `http.setResponseCallback(http.expectedStatuses(200, 201, 409))`. Otherwise the error rate is meaningless.
* **Checks don't fail a run on their own.** Add a `checks: ['rate>0.99']` threshold if correctness should gate the result.
* **`dropped_iterations > 0`** or rising `vus` with an arrival-rate executor means the target rate was not achieved, so the measured latency understates the real problem.
* Server-side clues are in the backend's `X-Response-Time-Ms` header and its access log, which includes request IDs.

## 5. Guidance for future scripts

**Structure.** One file per catalogue case: `scripts/<CASE-ID>.js`. The first line is a comment with the ID and title. Import config from `../lib/config.js`; put shared helpers (login, payment creation) in `lib/` only once a second script needs them.

**Workload model (scenarios).**
* Prefer open-model executors for API capacity questions. `constant-arrival-rate` and `ramping-arrival-rate` hold a request rate regardless of how slow the system gets, which is how real parents arrive.
* Use `ramping-vus` or `per-vu-iterations` for journeys and for concurrency tests (e.g. N VUs firing the same idempotency key at once).
* Name scenarios after behaviour (`browse_fees`, `pay_fee`, `poll_status`) and mix them with separate `exec` functions to model peak traffic.
* Always run a smoke version (1 VU, 1 iteration) before a load profile.

**Thresholds** are pass/fail criteria tied to the catalogue's expected results. Scope them by tag:
```js
thresholds: {
  'http_req_duration{name:GET /fees/outstanding}': ['p(95)<500'],
  'http_req_failed{scenario:pay_fee}': ['rate<0.01'],
  checks: ['rate>0.99'],
}
```
Use `abortOnFail` only for safety stops, not for normal assertions.

**Tags.**
* Give every request a stable `name` tag, especially URLs with IDs: `http.get(url(`/payments/${id}`), { tags: { name: 'GET /payments/{id}' } })`. This prevents one metric series per payment ID.
* Add a run-level tag for comparisons: `k6 run --tag testid=PAY-PERF-001 …`.

**Checks** verify correctness under load: status code, response shape, business state (`status === 'SUCCEEDED'`), and the replay header `Idempotent-Replayed`. Keep them cheap; parse JSON once per response.

**App-specific rules** (from the real API):
* **Log in during `setup()`.** Login is deliberately CPU-heavy (PBKDF2), so log in once per account in `setup()` and pass the tokens to VUs. Don't log in every iteration unless the case is about login throughput.
* **Map each VU to its own account and fee.** Use the `loadtestNNN@example.com` accounts (balances of R 500 000 / R 100 000 / R 50 000). A fee with a payment in `PROCESSING` rejects new payments (`409 PAYMENT_IN_PROGRESS`). Use small amounts (e.g. `amount_cents: 100`).
* **Idempotency keys:** `crypto.randomUUID()` is available globally (verified). Use a new key per logical payment and reuse it only to test replays.
* **Simulation:** delays and failures are configured through `PUT /api/v1/dev/simulation`. Change them in `setup()` and restore them with `DELETE /api/v1/dev/simulation` in `teardown()`. Gateway latency defaults to 800 ms, so confirm-latency thresholds must allow for it.
* **SQLite capacity:** SQLite allows one writer at a time, so write-heavy scenarios will saturate earlier than reads. That is expected behaviour to measure, not a test bug.
* **Local only:** run these tests only against your own local instance.

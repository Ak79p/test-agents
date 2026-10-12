// AUTH-PERF-001 Login throughput at a morning peak
// Catalogue case (approved plan: tests/plans/AUTH-PERF-001.md). Login is PBKDF2-hashed and CPU-bound; this case
// measures whether it sustains a burst of parents signing in.
//
// Workload:
//   * default / PERF_PROFILE=smoke: shared smoke profile (1 VU × PERF_ITERATIONS, default 1). The placement command
//     `k6 run --vus 1 --iterations 1 scripts/AUTH-PERF-001.js` replaces the scenario with k6's `default` one; both
//     run the same default function, and the thresholds are name-scoped (not scenario-scoped) so they still apply.
//   * PERF_PROFILE=case + PERF_ALLOW_LOAD=yes (explicit per-run approval only): constant-arrival-rate PERF_RATE
//     (default 10) logins/s for 2m, preAllocatedVUs 20, maxVUs 60.
// Operator preconditions for the full run (not done here): POST /api/v1/dev/reset immediately before, LOG_LEVEL=WARNING
// in backend/.env (restart), SEED_LOAD_TEST_USERS ≥ 50, Playwright suite not running.
// Side effects: one auth_tokens row per login. No resets, no simulation changes. Never logs the password or tokens.
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { config, loadTestEmail, requirePassword, url } from '../config/env.js';
import { envNumber, resolveCaseProfile, SUMMARY_TREND_STATS } from '../config/profiles.js';
import { summaryHandler } from '../lib/summary.js';

const LOGIN = 'POST /auth/login';

// S1 Scenario: constant-arrival-rate 10 logins/s for 2 min (preAllocatedVUs 20, maxVUs 60).
// PERF_RATE is parsed only when the full workload is requested (AC2 step-down: PERF_RATE=5).
const profile = resolveCaseProfile(() => {
  const rate = envNumber('PERF_RATE', 10);
  return {
    description: `constant-arrival-rate ${rate}/s for 2m (preAllocatedVUs 20, maxVUs 60)`,
    scenario: { executor: 'constant-arrival-rate', rate, timeUnit: '1s', duration: '2m', preAllocatedVUs: 20, maxVUs: 60 },
  };
});

export const options = {
  scenarios: { login_peak: profile.scenario },
  // AC1, one-to-one. Name-scoped (not {scenario:…}) so the CLI --vus/--iterations override still evaluates them and
  // the setup() simulation guard request is excluded.
  thresholds: {
    [`http_req_failed{name:${LOGIN}}`]: ['rate<0.01'], // AC1: http_req_failed < 1%
    [`http_req_duration{name:${LOGIN}}`]: ['p(95)<1000'], // AC1: p(95) < 1000 ms for name:POST /auth/login
    checks: ['rate>0.99'], // AC1: checks > 99%
    [`http_reqs{name:${LOGIN}}`]: ['count>0'], // not an AC: records login count and achieved rate (AC2); fails only if no login ran
  },
  summaryTrendStats: SUMMARY_TREND_STATS,
  tags: { category: 'performance', case_id: 'AUTH-PERF-001' },
};

if (__VU === 0) {
  console.log(`[AUTH-PERF-001] target ${config.host} · profile ${profile.name}: ${profile.description}`);
}

export function setup() {
  // S0a Simulation guard (read-only): simulated delay/jitter would make the AC1 latency result meaningless.
  const res = http.get(url('/dev/simulation'), {
    headers: { Accept: 'application/json' },
    tags: { name: 'GET /dev/simulation (guard)' },
    timeout: config.requestTimeout,
  });
  const sim = res.status === 200 ? res.json() : null;
  const delays = sim?.endpoint_delays_ms;
  const clean =
    sim !== null &&
    sim.response_delay_ms === 0 &&
    sim.response_jitter_ms === 0 &&
    delays !== null &&
    typeof delays === 'object' &&
    Object.keys(delays).length === 0;
  if (!clean) {
    throw new Error(
      `Simulation guard: GET /dev/simulation returned HTTP ${res.status}` +
        (sim ? ` with response_delay_ms=${sim.response_delay_ms}, response_jitter_ms=${sim.response_jitter_ms}, endpoint_delays_ms=${JSON.stringify(delays)}` : '') +
        '. Login latency must be measured with simulation defaults (0 / 0 / {}) and dev endpoints enabled. Not changing it from here.',
    );
  }
  // S0b Password: read once, shared with the VUs via setup data (redacted by summaryHandler). Never logged.
  return { password: requirePassword() };
}

export default function ({ password }) {
  // S2 Login: loadTestEmail(((iter) % 50) + 1); iterationInTest is unique across VUs (even round-robin over 50 accounts).
  const email = loadTestEmail((exec.scenario.iterationInTest % 50) + 1);
  const res = http.post(url('/auth/login'), JSON.stringify({ email, password }), {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    tags: { name: LOGIN }, // S3 Tagging: name:POST /auth/login on every measured request
    timeout: config.requestTimeout,
  });
  const body = res.status === 200 ? res.json() : null;
  check(res, {
    'login: status 200': (r) => r.status === 200,
    'login: access_token present': () => typeof body?.access_token === 'string' && body.access_token.length > 0,
  });
}

// AC2 (process): after a failing 10/s run, a separately approved re-run with PERF_RATE=5 (own PERF_RESULTS_DIR);
// the max sustainable rate (highest rate with all AC1 thresholds passing) plus dropped_iterations go in the catalogue note.
export const handleSummary = summaryHandler('AUTH-PERF-001', profile, 'login_peak');

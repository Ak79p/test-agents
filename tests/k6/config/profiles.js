// Load profiles and thresholds shared by the k6 scripts.
//
// SAFETY: the default profile is `smoke` (1 VU, a handful of iterations). Any other profile runs only when
// PERF_ALLOW_LOAD=yes is set explicitly; otherwise the script refuses to start. Stress, spike and soak
// profiles are deliberately not provided: catalogue cases define their own workloads (tests/plans/<ID>.md),
// and running them needs the user's explicit approval (CLAUDE.md).
//
// THRESHOLDS ARE PROVISIONAL. The defaults below are starting points, not service-level objectives.
// Calibrate them from a repeatable baseline on a known machine and from realistic expectations;
// never loosen a threshold just to make a run pass.

const SMOKE_MAX_ITERATIONS = 10;
const LOAD_MAX_VUS = 50; // = seeded loadtest accounts; beyond this is stress testing, which needs its own plan

/**
 * Positive-number environment parser (throws on anything else). Exported as envNumber so catalogue scripts
 * can read case-specific overrides (e.g. PERF_RATE) without touching __ENV directly.
 */
function num(name, fallback) {
  const raw = __ENV[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number, got "${raw}".`);
  return value;
}

export { num as envNumber };

/** The low-impact default: 1 VU, PERF_ITERATIONS iterations (default 1, max 10). */
function smoke() {
  const iterations = num('PERF_ITERATIONS', 1);
  if (iterations > SMOKE_MAX_ITERATIONS) {
    throw new Error(`The smoke profile allows at most ${SMOKE_MAX_ITERATIONS} iterations (PERF_ITERATIONS=${iterations}). Use another profile with PERF_ALLOW_LOAD=yes.`);
  }
  return {
    description: `1 VU × ${iterations} iteration(s), max 1m`,
    scenario: { executor: 'shared-iterations', vus: 1, iterations, maxDuration: '1m' },
  };
}

/** Steady single-user traffic for measuring a baseline: 1 VU for PERF_DURATION (default 1m). Opt-in. */
function baseline() {
  const duration = __ENV.PERF_DURATION || '1m';
  return {
    description: `1 VU constant for ${duration}`,
    scenario: { executor: 'constant-vus', vus: 1, duration },
  };
}

/** Moderate concurrent load: ramp to PERF_VUS (default 5, max 50), hold, ramp down. Opt-in. */
function load() {
  const vus = num('PERF_VUS', 5);
  if (vus > LOAD_MAX_VUS) throw new Error(`PERF_VUS=${vus} exceeds ${LOAD_MAX_VUS}; that is a stress test and needs its own approved plan.`);
  const rampUp = __ENV.PERF_RAMP_UP || '30s';
  const duration = __ENV.PERF_DURATION || '2m';
  const rampDown = __ENV.PERF_RAMP_DOWN || '30s';
  return {
    description: `ramp 0→${vus} VUs over ${rampUp}, hold ${duration}, ramp down over ${rampDown}`,
    scenario: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: rampUp, target: vus },
        { duration, target: vus },
        { duration: rampDown, target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  };
}

const PROFILES = { smoke, baseline, load };

/** Resolves PERF_PROFILE (default smoke) and enforces the opt-in for anything heavier. */
export function resolveProfile() {
  const name = (__ENV.PERF_PROFILE || 'smoke').toLowerCase();
  if (!PROFILES[name]) throw new Error(`Unknown PERF_PROFILE "${name}". Available: ${Object.keys(PROFILES).join(', ')}.`);
  if (name !== 'smoke' && (__ENV.PERF_ALLOW_LOAD || '').toLowerCase() !== 'yes') {
    throw new Error(
      `PERF_PROFILE=${name} is beyond smoke and needs explicit opt-in: set PERF_ALLOW_LOAD=yes (only after approval; see tests/k6/README.md §Safety).`,
    );
  }
  return { name, ...PROFILES[name]() };
}

/**
 * Profile resolver for catalogue performance cases (scripts/<ID>.js): PERF_PROFILE unset or `smoke` → the shared
 * smoke profile; PERF_PROFILE=case → the case's own workload from its approved plan, only with PERF_ALLOW_LOAD=yes.
 * `buildWorkload()` returns `{ description, scenario }` and is called only after the opt-in check, so case-specific
 * env values (e.g. PERF_RATE) are parsed only when the full workload is requested.
 * Used by AUTH-PERF-001; intended for FEE-PERF-001/002 and PAY-PERF-001…005.
 */
export function resolveCaseProfile(buildWorkload) {
  const name = (__ENV.PERF_PROFILE || 'smoke').toLowerCase();
  if (name === 'smoke') return { name, ...smoke() };
  if (name !== 'case') throw new Error(`Unknown PERF_PROFILE "${name}" for a catalogue case: catalogue cases support smoke or case.`);
  if ((__ENV.PERF_ALLOW_LOAD || '').toLowerCase() !== 'yes') {
    throw new Error(
      `PERF_PROFILE=${name} is beyond smoke and needs explicit opt-in: set PERF_ALLOW_LOAD=yes (only after approval; see tests/k6/README.md §Safety).`,
    );
  }
  return { name, ...buildWorkload() };
}

/**
 * Provisional thresholds, each overridable by environment variable. See the header note.
 * Scoped to the workload scenario, so requests made in setup() (e.g. the deliberately slow login) and
 * teardown() don't distort the measured latency or error rate. The same sub-metrics feed the report.
 */
export function thresholds(scenario) {
  return {
    [`http_req_failed{scenario:${scenario}}`]: [`rate<${num('PERF_MAX_ERROR_RATE', 0.01)}`],
    [`http_req_duration{scenario:${scenario}}`]: [`p(95)<${num('PERF_P95_MS', 500)}`, `p(99)<${num('PERF_P99_MS', 1000)}`],
    [`http_reqs{scenario:${scenario}}`]: ['count>0'], // records the workload's own request count and rate; fails only if nothing ran
    checks: [`rate>${num('PERF_MIN_CHECK_RATE', 0.99)}`],
  };
}

/** Pacing between iterations for non-smoke profiles (seconds); smoke runs back to back. */
export function thinkTime(profileName) {
  return profileName === 'smoke' ? 0 : num('PERF_THINK_TIME', 1);
}

/** Trend statistics reported in the summary (adds p(99) to k6's defaults). */
export const SUMMARY_TREND_STATS = ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'];

// Environment configuration and safety guards for every k6 script in tests/k6/scripts/.
// Scripts import from here (never read __ENV directly), so the target, accounts and guards live in one place.
//
// Values come from k6 environment variables (`-e NAME=value`, or real environment variables; the npm
// runner `run.mjs` also loads the git-ignored tests/k6/.env). Don't use the K6_ prefix: k6 reserves it.
// Secrets (TEST_USER_PASSWORD) are read but never printed; never run these scripts with --http-debug=full.

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8000/api/v1';
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

function hostOf(baseUrl) {
  const match = baseUrl.match(/^https?:\/\/([^/:]+|\[[^\]]+\])(:\d+)?(\/|$)/i);
  if (!match) throw new Error(`API_BASE_URL must be an http(s) URL, got "${baseUrl}".`);
  return match[1].toLowerCase();
}

const apiBaseUrl = (__ENV.API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
const host = hostOf(apiBaseUrl);

// Local targets only, unless the exact host is approved with PERF_ALLOWED_HOST=<host>.
if (!LOCAL_HOSTS.includes(host) && (__ENV.PERF_ALLOWED_HOST || '').toLowerCase() !== host) {
  throw new Error(
    `Refusing to target "${host}": only local hosts (${LOCAL_HOSTS.join(', ')}) are allowed. ` +
      `To target another host you own and have approved, set PERF_ALLOWED_HOST=${host}. Never target production.`,
  );
}

export const config = {
  /** Backend API base including /api/v1, without a trailing slash. */
  apiBaseUrl,
  /** Host part of apiBaseUrl (shown in banners; never contains credentials). */
  host,
  /** Per-request timeout (k6 duration string). */
  requestTimeout: __ENV.PERF_REQUEST_TIMEOUT || '10s',
  /** Dedicated read-only account for the starter read journey (any seeded account works; it is not modified). */
  perfUserEmail: __ENV.PERF_USER_EMAIL || 'loadtest001@example.com',
  /** Number of seeded loadtestNNN@example.com accounts (backend SEED_LOAD_TEST_USERS). */
  loadTestUsers: Number(__ENV.LOAD_TEST_USERS || 50),
  /** Directory for summary files (relative to where k6 runs; run.mjs runs from tests/k6). */
  resultsDir: (__ENV.PERF_RESULTS_DIR || 'results').replace(/\/+$/, ''),
};

/** The shared seeded password. Call it only from setup(): it throws a clear error when the variable is missing. */
export function requirePassword() {
  const password = __ENV.TEST_USER_PASSWORD;
  if (!password) {
    throw new Error(
      'TEST_USER_PASSWORD is not set. Put it in tests/k6/.env (git-ignored; see env.example) or pass -e TEST_USER_PASSWORD=…. ' +
        'Seeded accounts are listed in docs/APPLICATION.md §6.',
    );
  }
  return password;
}

/** Absolute URL for an API path, e.g. url('/fees/outstanding'). */
export function url(path) {
  return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Seeded load-test account email for a 1-based index: loadTestEmail(7) -> loadtest007@example.com. */
export function loadTestEmail(index) {
  return `loadtest${String(index).padStart(3, '0')}@example.com`;
}

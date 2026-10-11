// Central configuration for every k6 script in tests/k6/scripts/.
// Scripts import from here instead of reading __ENV directly, so the API location
// and test accounts are defined in exactly one place.
//
// Values come from k6 environment variables: `-e NAME=value` on the command line,
// or real environment variables (k6 passes system env vars by default).
// Do not use the K6_ prefix for these names; k6 reserves it for its own options.

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8000/api/v1';

export const config = {
  /** Backend API base including /api/v1, without a trailing slash. */
  apiBaseUrl: (__ENV.API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, ''),

  /** Password shared by the seeded accounts (see docs/APPLICATION.md §6). Required by scripts that log in. */
  testPassword: __ENV.TEST_USER_PASSWORD || '',

  /** Number of seeded loadtestNNN@example.com accounts (backend SEED_LOAD_TEST_USERS). */
  loadTestUsers: Number(__ENV.LOAD_TEST_USERS || 50),
};

/** Absolute URL for an API path, e.g. url('/fees/outstanding'). */
export function url(path) {
  return `${config.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Seeded load-test account email for a 1-based index: loadTestEmail(7) -> loadtest007@example.com. */
export function loadTestEmail(index) {
  return `loadtest${String(index).padStart(3, '0')}@example.com`;
}

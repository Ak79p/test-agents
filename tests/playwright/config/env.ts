/**
 * Central, typed access to environment configuration for all Playwright tests.
 *
 * Values come from tests/playwright/.env (git-ignored) or the process environment.
 * Credentials are read lazily, so the config loads (e.g. `--list`) without them and
 * a test that needs them fails with a clear message instead of an undefined value.
 */
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy tests/playwright/.env.example to .env and set it ` +
        `(seeded accounts are listed in docs/APPLICATION.md, section 6).`,
    );
  }
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : ['1', 'true', 'yes'].includes(value.toLowerCase());
}

/** Ensures a trailing slash so relative request paths ("fees/outstanding") resolve under /api/v1/. */
function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

export const env = {
  baseUrl: optional('BASE_URL', 'http://localhost:5173'),
  apiBaseUrl: withTrailingSlash(optional('API_BASE_URL', 'http://127.0.0.1:8000/api/v1')),
  workers: Number(optional('PW_WORKERS', '1')),
  browserChannel: optional('PW_BROWSER_CHANNEL', '') || undefined,
  startServers: bool('PW_START_SERVERS', false),
  isCI: bool('CI', false),

  testUser: {
    get email(): string {
      return required('TEST_USER_EMAIL');
    },
    get password(): string {
      return required('TEST_USER_PASSWORD');
    },
  },
  secondaryUser: {
    get email(): string {
      return required('SECONDARY_USER_EMAIL');
    },
    get password(): string {
      return required('SECONDARY_USER_PASSWORD');
    },
  },
};

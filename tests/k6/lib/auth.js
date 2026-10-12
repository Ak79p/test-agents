// Login helper for k6 setup(). Login is deliberately CPU-heavy (PBKDF2) and writes one auth-token row,
// so log in once in setup() and share the token with the VUs; never log in every iteration unless the
// case is about login throughput. Never log the password, the token or Authorization headers.
import http from 'k6/http';
import { check } from 'k6';
import { config, requirePassword, url } from '../config/env.js';

/** POST /auth/login for `email`; returns the bearer token. Throws (aborting setup) on any failure. */
export function login(email) {
  const res = http.post(url('/auth/login'), JSON.stringify({ email, password: requirePassword() }), {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    tags: { name: 'POST /auth/login' },
    timeout: config.requestTimeout,
  });
  const body = res.status === 200 ? res.json() : null;
  const ok = check(res, {
    'login: status 200': (r) => r.status === 200,
    'login: access_token present': () => typeof body?.access_token === 'string' && body.access_token.length > 0,
  });
  if (!ok) throw new Error(`Login as ${email} failed: HTTP ${res.status}. Check TEST_USER_PASSWORD and that the account is seeded.`);
  return body.access_token;
}

/** Request params for an authenticated GET with a stable `name` tag. */
export function authed(token, name) {
  return {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    tags: { name },
    timeout: config.requestTimeout,
  };
}

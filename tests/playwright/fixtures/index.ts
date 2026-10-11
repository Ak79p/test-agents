import { test as base, expect, type APIRequestContext } from '@playwright/test';
import { env } from '../config/env';
import { LoginPage } from '../pages/login-page';

type Fixtures = {
  /** LoginPage bound to this test's `page`. Not navigated; call `goto()` when the test starts at /login. */
  loginPage: LoginPage;
  /** Unauthenticated API context at API_BASE_URL for out-of-band calls from browser tests; disposed after the test. */
  api: APIRequestContext;
  /** Factory: logs in via POST auth/login and returns a Bearer-authenticated API context at API_BASE_URL. Call it after any dev/reset; every context it creates is disposed after the test. */
  apiAs: (user: { email: string; password: string }) => Promise<APIRequestContext>;
};

export const test = base.extend<Fixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  api: async ({ playwright }, use) => {
    const api = await playwright.request.newContext({ baseURL: env.apiBaseUrl, extraHTTPHeaders: { Accept: 'application/json' } });
    try {
      await use(api);
    } finally {
      await api.dispose();
    }
  },
  apiAs: async ({ playwright }, use) => {
    const contexts: APIRequestContext[] = [];
    try {
      await use(async ({ email, password }) => {
        const login = await playwright.request.newContext({ baseURL: env.apiBaseUrl, extraHTTPHeaders: { Accept: 'application/json' } });
        contexts.push(login);
        const res = await login.post('auth/login', { data: { email, password } });
        if (res.status() !== 200) {
          throw new Error(`Login as ${email} failed: HTTP ${res.status()}`);
        }
        const { access_token } = await res.json();
        const authed = await playwright.request.newContext({
          baseURL: env.apiBaseUrl,
          extraHTTPHeaders: { Accept: 'application/json', Authorization: `Bearer ${access_token}` },
        });
        contexts.push(authed);
        return authed;
      });
    } finally {
      await Promise.all(contexts.map((c) => c.dispose()));
    }
  },
});

export { expect };

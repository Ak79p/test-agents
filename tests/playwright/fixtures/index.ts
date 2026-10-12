import { test as base, expect, type APIRequestContext } from '@playwright/test';
import { env } from '../config/env';
import { LoginPage } from '../pages/login-page';
import { CheckoutPage } from '../pages/checkout-page';
import { DashboardPage } from '../pages/dashboard-page';
import { FeeDetailPage } from '../pages/fee-detail-page';
import { PaymentPage } from '../pages/payment-page';
import { TransactionsPage } from '../pages/transactions-page';
import { AppNav } from '../pages/components/app-nav';

/** Fields accepted by PUT dev/simulation (backend SimulationUpdate); send only the ones a case changes. */
export type SimulationChanges = Partial<{
  response_delay_ms: number;
  response_jitter_ms: number;
  endpoint_delays_ms: Record<string, number>;
  allow_delay_header: boolean;
  max_delay_ms: number;
  gateway_latency_ms: number;
  gateway_timeout_ms: number;
  pending_resolution_seconds: number;
  payment_outcome_override: string;
  gateway_error_every_n: number;
  random_seed: number;
}>;

/** Dev-only controls (backend /dev router). Call them explicitly in the test, where the case's preconditions say so. */
export type DevControls = {
  /** POST dev/reset: re-seeds the DB, revokes every token and restores simulation defaults. Call before logging in. Refuses to run with more than one worker. */
  reset: () => Promise<void>;
  /** PUT dev/simulation (partial update). The fixture restores the defaults in teardown, even if the test fails. Returns the new settings. */
  setSimulation: (changes: SimulationChanges) => Promise<Record<string, unknown>>;
  /** DELETE dev/simulation: restores the backend's .env defaults now. Returns the restored settings. */
  restoreSimulation: () => Promise<Record<string, unknown>>;
};

type Fixtures = {
  /** LoginPage bound to this test's `page`. Not navigated; call `goto()` when the test starts at /login. */
  loginPage: LoginPage;
  /** CheckoutPage bound to this test's `page`. Not navigated; reach /fees/:feeId/pay through the app (pay-fee-button) or with `goto(feeId)`. */
  checkoutPage: CheckoutPage;
  /** DashboardPage (/) bound to this test's `page`. Not navigated; login lands on it. */
  dashboardPage: DashboardPage;
  /** FeeDetailPage (/fees/:feeId) bound to this test's `page`. Not navigated; open it with `goto(feeId)`. */
  feeDetailPage: FeeDetailPage;
  /** PaymentPage (/payments/:paymentId, result and details) bound to this test's `page`. Not navigated. */
  paymentPage: PaymentPage;
  /** TransactionsPage (/transactions) bound to this test's `page`. Not navigated; open it with `appNav.openTransactions()`. */
  transactionsPage: TransactionsPage;
  /** AppNav: the signed-in header (dashboard/transactions links, logout) on this test's `page`. */
  appNav: AppNav;
  /** Unauthenticated API context at API_BASE_URL for out-of-band calls from browser tests; disposed after the test. */
  api: APIRequestContext;
  /** Factory: logs in via POST auth/login and returns a Bearer-authenticated API context at API_BASE_URL. Call it after any dev/reset; every context it creates is disposed after the test. */
  apiAs: (user: { email: string; password: string }) => Promise<APIRequestContext>;
  /** Database reset and simulation controls; simulation changes are always restored in teardown. */
  dev: DevControls;
};

type WorkerFixtures = {
  /** Automatic: once per worker, checks the backend (and the frontend for browser projects) is up, failing with the startup commands if not. */
  appHealth: void;
};

export const test = base.extend<Fixtures, WorkerFixtures>({
  appHealth: [
    async ({}, use, workerInfo) => {
      const targets = [{ name: 'Backend API', url: `${env.apiBaseUrl}health`, start: 'scripts\\start-backend.ps1' }];
      const baseURL = workerInfo.project.use.baseURL;
      if (baseURL && baseURL !== env.apiBaseUrl) {
        targets.push({ name: 'Frontend', url: baseURL, start: 'scripts\\start-frontend.ps1' });
      }
      for (const { name, url, start } of targets) {
        let problem = '';
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
          if (!res.ok) problem = `HTTP ${res.status}`;
        } catch (error) {
          problem = (error as { cause?: { code?: string } }).cause?.code ?? (error as Error).name;
        }
        if (problem) {
          throw new Error(
            `${name} is not reachable at ${url} (${problem}). Start it from the repo root with ${start} ` +
              `(or set PW_START_SERVERS=true in tests/playwright/.env), then re-run.`,
          );
        }
      }
      await use();
    },
    { scope: 'worker', auto: true },
  ],
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  checkoutPage: async ({ page }, use) => {
    await use(new CheckoutPage(page));
  },
  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },
  feeDetailPage: async ({ page }, use) => {
    await use(new FeeDetailPage(page));
  },
  paymentPage: async ({ page }, use) => {
    await use(new PaymentPage(page));
  },
  transactionsPage: async ({ page }, use) => {
    await use(new TransactionsPage(page));
  },
  appNav: async ({ page }, use) => {
    await use(new AppNav(page));
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
  dev: async ({ playwright }, use, testInfo) => {
    const ctx = await playwright.request.newContext({ baseURL: env.apiBaseUrl, extraHTTPHeaders: { Accept: 'application/json' } });
    // Set before the PUT is sent, so a request that fails mid-way is still restored.
    let simulationChanged = false;
    const restore = async () => {
      const res = await ctx.delete('dev/simulation');
      if (res.status() !== 200) {
        throw new Error(`DELETE dev/simulation failed: HTTP ${res.status()}`);
      }
      return res.json();
    };
    try {
      await use({
        reset: async () => {
          if (testInfo.config.workers > 1) {
            throw new Error(`dev.reset() revokes every token in the shared SQLite DB; run with 1 worker (PW_WORKERS=1), not ${testInfo.config.workers}.`);
          }
          // The response body includes the demo password, so only the status is used.
          const res = await ctx.post('dev/reset');
          if (res.status() !== 200) {
            throw new Error(`POST dev/reset failed: HTTP ${res.status()}`);
          }
        },
        setSimulation: async (changes) => {
          simulationChanged = true;
          const res = await ctx.put('dev/simulation', { data: changes });
          if (res.status() !== 200) {
            throw new Error(`PUT dev/simulation failed: HTTP ${res.status()}`);
          }
          return res.json();
        },
        restoreSimulation: async () => {
          const settings = await restore();
          simulationChanged = false;
          return settings;
        },
      });
    } finally {
      try {
        if (simulationChanged) await restore();
      } finally {
        await ctx.dispose();
      }
    }
  },
});

export { expect };

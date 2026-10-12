import { test, type Locator, type Page, type Route } from '@playwright/test';

/** The /login form. Holds locators and actions only; assertions stay in the tests. */
export class LoginPage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly emailError: Locator;
  readonly passwordError: Locator;
  readonly formError: Locator;
  readonly sessionExpired: Locator;

  constructor(readonly page: Page) {
    this.emailInput = page.getByTestId('email-input');
    this.passwordInput = page.getByTestId('password-input');
    this.submitButton = page.getByTestId('login-button');
    this.emailError = page.getByTestId('email-error');
    this.passwordError = page.getByTestId('password-error');
    this.formError = page.getByRole('alert').and(page.getByTestId('login-error'));
    this.sessionExpired = page.getByTestId('session-expired');
  }

  async goto() {
    await this.page.goto('/login');
  }

  /** Fills and submits the form on the current page (works on /login?next=… redirects too). */
  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  /**
   * Opens /login and logs in as `user` (e.g. `env.testUser`). Call `dev.reset()` before this when the case needs a fresh seed.
   * Waits for the `POST …/auth/login` response (throws on a non-2xx status) and then for the app to leave /login,
   * which happens only after `feeflow.session` is stored, so a direct `page.goto` afterwards is authenticated.
   */
  async loginAs(user: { email: string; password: string }) {
    await this.goto();
    const response = this.page.waitForResponse(
      (res) => res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith('/auth/login'),
    );
    await this.login(user.email, user.password);
    const status = (await response).status();
    if (status < 200 || status >= 300) throw new Error(`Login as ${user.email} failed: HTTP ${status}`);
    await this.page.waitForURL((url) => !url.pathname.startsWith('/login'));
  }

  /**
   * Fills and submits the form while holding the `POST …/api/v1/auth/login` request in the browser, so the
   * in-flight UI state (button text, disabled state) can be asserted deterministically. Other methods on that
   * URL continue immediately. Resolves once the POST has been intercepted. The request is continued unchanged
   * (only its timing changes). The test must call the returned `release()`, which lets the held request through,
   * waits until the handler's own `route.continue()` has completed, and only then removes the route (so the
   * unroute never handles the request first and the handler never hits "Route is already handled").
   * If the form sends no login POST within the configured action timeout (e.g. client-side validation blocked
   * it), the route is removed and a descriptive error is thrown instead of waiting for the test timeout.
   */
  async loginHoldingRequest(email: string, password: string): Promise<{ release: () => Promise<void> }> {
    const url = '**/api/v1/auth/login';
    let arrived!: () => void;
    const requestArrived = new Promise<void>((resolve) => (arrived = resolve));
    let unblock!: () => void;
    const released = new Promise<void>((resolve) => (unblock = resolve));
    let continued!: () => void;
    const handlerDone = new Promise<void>((resolve) => (continued = resolve));
    const handler = async (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue();
      arrived();
      await released;
      try {
        await route.continue();
      } finally {
        continued();
      }
    };
    // Bounded by the configured actionTimeout (falls back to the test timeout when none is set).
    const timeout = test.info().project.use.actionTimeout || test.info().timeout;
    // Registered before submitting; settles to null on success or the error, so it never rejects unhandled.
    const sent = this.page
      .waitForRequest((req) => req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/auth/login'), { timeout })
      .then(() => null, (error: Error) => error);
    await this.page.route(url, handler);
    await this.login(email, password);
    const notSent = await sent;
    if (notSent) {
      await this.page.unroute(url, handler);
      if (notSent.name !== 'TimeoutError') throw notSent;
      throw new Error(
        `loginHoldingRequest: the login form sent no POST …/auth/login within ${timeout} ms of submitting ` +
          '(client-side validation may have blocked it, or the form did not submit). Check emailError/passwordError.',
      );
    }
    await requestArrived;
    return {
      release: async () => {
        unblock();
        await handlerDone;
        await this.page.unroute(url, handler);
      },
    };
  }

  /** The raw `feeflow.session` value in localStorage, or null when logged out. */
  async storedSession(): Promise<string | null> {
    return this.page.evaluate(() => localStorage.getItem('feeflow.session'));
  }

  /** The access token from the stored session (undefined when there is none). Never log it. */
  async sessionToken(): Promise<string | undefined> {
    const raw = await this.storedSession();
    return raw ? JSON.parse(raw).token : undefined;
  }
}

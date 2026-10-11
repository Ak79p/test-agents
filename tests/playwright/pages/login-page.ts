import type { Locator, Page } from '@playwright/test';

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
}

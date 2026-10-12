import type { Locator, Page } from '@playwright/test';

/** The signed-in header (frontend/src/components/Layout.tsx): main navigation and logout. Locators and actions only. */
export class AppNav {
  readonly dashboardLink: Locator;
  readonly transactionsLink: Locator;
  readonly logoutButton: Locator;
  /** The signed-in parent's full name in the header (`user-name`). */
  readonly userName: Locator;

  constructor(readonly page: Page) {
    this.userName = page.getByTestId('user-name');
    this.dashboardLink = page.getByTestId('nav-dashboard');
    this.transactionsLink = page.getByTestId('nav-transactions');
    this.logoutButton = page.getByTestId('logout-button');
  }

  async openTransactions() {
    await this.transactionsLink.click();
  }

  async logout() {
    await this.logoutButton.click();
  }
}

import type { Locator, Page } from '@playwright/test';

/**
 * The fee details page at /fees/:feeId (frontend/src/pages/FeeDetailPage.tsx): status, amounts paid and
 * outstanding. Locators and actions only; assertions stay in the tests. Used by PAY-UI-002 (planned: PAY-UI-003).
 */
export class FeeDetailPage {
  /** Rendered once the fee has loaded (a loading or error state is shown before/instead). */
  readonly root: Locator;
  readonly amountPaid: Locator;
  /** Scoped to the page: the dashboard table also uses `fee-balance`. */
  readonly balance: Locator;
  /** Text label (e.g. "Partially Paid") and `data-status` (e.g. PARTIALLY_PAID, OVERDUE when unpaid and overdue). */
  readonly statusBadge: Locator;

  constructor(readonly page: Page) {
    this.root = page.getByTestId('fee-detail-page');
    this.amountPaid = this.root.getByTestId('fee-amount-paid');
    this.balance = this.root.getByTestId('fee-balance');
    this.statusBadge = this.root.getByTestId('fee-status-badge');
  }

  /** Opens /fees/<feeId> directly and waits until the fee has loaded (`fee-detail-page` rendered). */
  async goto(feeId: string) {
    await this.page.goto(`/fees/${feeId}`);
    await this.root.waitFor();
  }
}

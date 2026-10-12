import type { Locator, Page } from '@playwright/test';

/**
 * /payments/:paymentId (frontend/src/pages/PaymentPage.tsx). The same screen is the checkout result
 * ("Payment result") and, from history, the payment details page. Locators and actions only.
 */
export class PaymentPage {
  /** Carries `data-payment-status` (PENDING, PROCESSING, SUCCEEDED, FAILED, CANCELLED). */
  readonly root: Locator;
  readonly successPanel: Locator;
  /** Shown for FAILED payments; holds `failureMessage` and the try-again link. */
  readonly failurePanel: Locator;
  readonly failureMessage: Locator;
  /** The status badge in the Details list: text is the label (e.g. "Failed"), `data-status` the raw status. */
  readonly statusBadge: Locator;
  /** "<failure message> (<FAILURE_CODE>)"; only rendered when the payment has a failure code. */
  readonly detailFailure: Locator;
  readonly detailAmount: Locator;
  readonly detailMethod: Locator;
  readonly detailReference: Locator;
  /** Timeline items, oldest first; each has `data-event-type` (e.g. PAYMENT_CREATED). */
  readonly timelineEvents: Locator;
  readonly backToDashboardLink: Locator;

  constructor(readonly page: Page) {
    this.root = page.getByTestId('payment-page');
    this.successPanel = page.getByTestId('payment-success');
    this.failurePanel = page.getByTestId('payment-failure');
    this.failureMessage = page.getByTestId('failure-message');
    this.statusBadge = page.getByTestId('payment-details').getByTestId('payment-status-badge');
    this.detailFailure = page.getByTestId('detail-failure');
    this.detailAmount = page.getByTestId('detail-amount');
    this.detailMethod = page.getByTestId('detail-method');
    this.detailReference = page.getByTestId('detail-reference');
    this.timelineEvents = page.getByTestId('payment-timeline').getByTestId('timeline-event');
    this.backToDashboardLink = page.getByTestId('back-to-dashboard');
  }

  /** The timeline event at a position (0 = oldest). */
  timelineEventAt(index: number): Locator {
    return this.timelineEvents.nth(index);
  }

  /** Clicks try-again-button on a failed payment, which opens /fees/<feeId>/pay with a fresh amount step. */
  async tryAgain() {
    await this.page.getByTestId('try-again-button').click();
  }

  /** Clicks back-to-dashboard (shown after a successful payment). Follow with `dashboardPage.waitForFees()` before checking the fee table. */
  async backToDashboard() {
    await this.backToDashboardLink.click();
  }
}

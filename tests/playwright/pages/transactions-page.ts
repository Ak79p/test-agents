import type { Locator, Page } from '@playwright/test';

/** One row of the transactions table. The cells have no test IDs, so they are addressed by column position. */
export class TransactionRow {
  /** The reference link (text = payment reference); opens /payments/<id>. */
  readonly referenceLink: Locator;
  readonly fee: Locator;
  readonly student: Locator;
  /** "<BRAND> •••• <last4>", or "—" when no card was used. */
  readonly method: Locator;
  /** Text is the label (e.g. "Successful"); `data-status` is the raw status (e.g. SUCCEEDED). */
  readonly statusBadge: Locator;
  readonly amount: Locator;

  constructor(readonly row: Locator) {
    // Column order in frontend/src/pages/TransactionsPage.tsx: Date, Reference, Fee, Student, Method, Status, Amount.
    const cells = row.getByRole('cell');
    this.referenceLink = row.getByTestId('transaction-link');
    this.fee = cells.nth(2);
    this.student = cells.nth(3);
    this.method = cells.nth(4);
    this.statusBadge = row.getByTestId('payment-status-badge');
    this.amount = cells.nth(6);
  }

  async open() {
    await this.referenceLink.click();
  }
}

/** /transactions (frontend/src/pages/TransactionsPage.tsx): payment history, newest first. Locators and actions only. */
export class TransactionsPage {
  readonly root: Locator;
  readonly table: Locator;
  /** Rows (`transaction-row-<paymentId>`), newest first. */
  readonly rows: Locator;

  constructor(readonly page: Page) {
    this.root = page.getByTestId('transactions-page');
    this.table = page.getByTestId('transactions-table');
    this.rows = this.table.getByTestId(/^transaction-row-/);
  }

  /** The row at a position (0 = newest). */
  rowAt(index: number): TransactionRow {
    return new TransactionRow(this.rows.nth(index));
  }
}

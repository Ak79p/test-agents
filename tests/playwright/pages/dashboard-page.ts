import type { Locator, Page, Response } from '@playwright/test';

/** The parent dashboard at / (frontend/src/pages/DashboardPage.tsx): summary stats, student cards, outstanding fees table. Locators and actions only. */
export class DashboardPage {
  readonly root: Locator;
  /** The page heading (`page-title`, e.g. "Hello, Thandi"), scoped to the dashboard. */
  readonly pageTitle: Locator;
  /** Stat card text is "<label> <amount> <sub-label>", so assert values with toContainText. */
  readonly totalOutstandingStat: Locator;
  readonly overdueStat: Locator;
  /** Every student card (`student-card-<studentId>`). */
  readonly studentCards: Locator;
  readonly feesTable: Locator;
  /** Rows of the outstanding fees table (`fee-row-<feeId>`), in display order (due date, then id). */
  readonly feeRows: Locator;
  readonly outstandingTotal: Locator;
  readonly studentFilter: Locator;

  constructor(readonly page: Page) {
    this.root = page.getByTestId('dashboard-page');
    this.pageTitle = this.root.getByTestId('page-title');
    this.totalOutstandingStat = page.getByTestId('stat-total-outstanding');
    this.overdueStat = page.getByTestId('stat-overdue');
    this.studentCards = page.locator('[data-testid^="student-card-"]');
    this.feesTable = page.getByTestId('outstanding-fees-table');
    this.feeRows = this.feesTable.getByTestId(/^fee-row-/);
    this.outstandingTotal = page.getByTestId('outstanding-total');
    this.studentFilter = page.getByTestId('outstanding-student-filter');
  }

  studentCard(studentId: string): Locator {
    return this.page.getByTestId(`student-card-${studentId}`);
  }

  studentName(studentId: string): Locator {
    return this.studentCard(studentId).getByTestId('student-name');
  }

  studentOutstanding(studentId: string): Locator {
    return this.studentCard(studentId).getByTestId('student-outstanding');
  }

  /** The fee row at a display position (0 = earliest due); its `data-testid` is `fee-row-<feeId>`. */
  feeRowAt(index: number): Locator {
    return this.feeRows.nth(index);
  }

  /** The fee's row; use toHaveCount(0) to check it is gone. */
  feeRow(feeId: string): Locator {
    return this.page.getByTestId(`fee-row-${feeId}`);
  }

  /** The row's status badge; its `data-status` is OVERDUE, OUTSTANDING, PARTIALLY_PAID or PAID. */
  feeStatusBadge(feeId: string): Locator {
    return this.feeRow(feeId).getByTestId('fee-status-badge');
  }

  /** Waits until the outstanding fees table has rendered (it replaces the loading state). Hangs if the parent has no unpaid fees. */
  async waitForFees() {
    await this.feesTable.waitFor();
  }

  /** Clicks the row's pay-fee-button, which opens /fees/<feeId>/pay. */
  async payFee(feeId: string) {
    await this.feeRow(feeId).getByTestId('pay-fee-button').click();
  }

  /** Pays the first row (the earliest-due unpaid fee). */
  async payFirstFee() {
    await this.feeRows.first().getByTestId('pay-fee-button').click();
  }

  /**
   * Selects a student (by option label, e.g. "Lerato Mokoena") in the fees filter and waits for the
   * refetch: the first GET fees/outstanding?student_id=… response. Throws if it isn't 2xx.
   */
  async filterByStudent(label: string): Promise<Response> {
    const refetched = this.page.waitForResponse(
      (r) => r.request().method() === 'GET' && r.url().includes('/fees/outstanding?student_id='),
    );
    await this.studentFilter.selectOption({ label });
    const res = await refetched;
    if (!res.ok()) throw new Error(`GET fees/outstanding (filter "${label}") returned HTTP ${res.status()}`);
    return res;
  }
}

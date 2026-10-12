import { test, expect } from '../fixtures';
import { env } from '../config/env';

test('FEE-UI-001 Dashboard shows correct outstanding fees, overdue status and totals', { tag: ['@ui', '@fees'] }, async ({ loginPage, dashboardPage, dev }) => {
  await test.step('S1 Log in as Thandi', async () => {
    await dev.reset();
    await loginPage.loginAs(env.testUser);
  });

  await test.step('S2 Read stat-total-outstanding, stat-overdue and the outstanding-fees-table', async () => {
    await expect(dashboardPage.totalOutstandingStat).toContainText('R 24 200,00');
    await expect(dashboardPage.totalOutstandingStat).toContainText('6 unpaid fee(s)');
    await expect(dashboardPage.overdueStat).toContainText('R 1 650,00');
    await expect(dashboardPage.overdueStat).toContainText('2 overdue fee(s)');

    await expect(dashboardPage.studentCards).toHaveCount(2);
    await expect(dashboardPage.studentName('stu_1001')).toContainText('Lerato');
    await expect(dashboardPage.studentName('stu_1002')).toContainText('Kabelo');
    await expect(dashboardPage.studentOutstanding('stu_1002')).toHaveText('R 14 200,00');
    await expect(dashboardPage.studentOutstanding('stu_1001')).toHaveText('R 10 000,00');

    await expect(dashboardPage.feeRows).toHaveCount(6);
    await expect(dashboardPage.feeRowAt(0)).toHaveAttribute('data-testid', 'fee-row-fee_1006');
    await expect(dashboardPage.feeRowAt(1)).toHaveAttribute('data-testid', 'fee-row-fee_1002');
    await expect(dashboardPage.feeStatusBadge('fee_1006')).toHaveAttribute('data-status', 'OVERDUE');
    await expect(dashboardPage.feeStatusBadge('fee_1002')).toHaveAttribute('data-status', 'OVERDUE');
    await expect(dashboardPage.feeStatusBadge('fee_1004')).toHaveAttribute('data-status', 'PARTIALLY_PAID');
    await expect(dashboardPage.outstandingTotal).toHaveText('R 24 200,00');
  });

  await test.step('S3 Select "Lerato Mokoena" in outstanding-student-filter', async () => {
    await dashboardPage.filterByStudent('Lerato Mokoena');

    await expect(dashboardPage.feeRows).toHaveCount(3);
    await expect(dashboardPage.feeRowAt(0)).toHaveAttribute('data-testid', 'fee-row-fee_1002');
    await expect(dashboardPage.feeRowAt(1)).toHaveAttribute('data-testid', 'fee-row-fee_1003');
    await expect(dashboardPage.feeRowAt(2)).toHaveAttribute('data-testid', 'fee-row-fee_1004');
    await expect(dashboardPage.outstandingTotal).toHaveText('R 10 000,00');
  });
});

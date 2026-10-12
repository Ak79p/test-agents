import { test, expect } from '../fixtures';
import { env } from '../config/env';
import { testCards } from '../test-data/cards';

test('TXN-UI-001 A completed payment appears in transaction history with matching details', { tag: ['@ui', '@transactions'] }, async ({ loginPage, dashboardPage, checkoutPage, paymentPage, transactionsPage, appNav, dev }) => {
  let summary: { fee: string; student: string; reference: string };

  await test.step('Precondition: restore simulation defaults', async () => {
    await dev.restoreSimulation();
  });

  await test.step('S1 Complete a payment and note the reference', async () => {
    await loginPage.loginAs(env.testUser);
    await dashboardPage.payFirstFee();

    await checkoutPage.chooseCustomAmount('10');
    await checkoutPage.continueToPayment();
    await expect(checkoutPage.paymentAmount).toHaveText('R 10,00');
    await expect(checkoutPage.paymentReference).toHaveText(/^SF-/);
    summary = await checkoutPage.readSummary();

    await checkoutPage.fillCard(testCards.success);
    await checkoutPage.pay();
    await expect(paymentPage.root).toHaveAttribute('data-payment-status', 'SUCCEEDED');
  });

  await test.step('S2 Open nav-transactions', async () => {
    await appNav.openTransactions();

    const newest = transactionsPage.rowAt(0);
    await expect(newest.referenceLink).toHaveText(summary.reference);
    await expect(newest.fee).toHaveText(summary.fee);
    await expect(newest.student).toHaveText(summary.student);
    await expect(newest.method).toHaveText('VISA •••• 4242');
    await expect(newest.statusBadge).toHaveText('Successful');
    await expect(newest.amount).toHaveText('R 10,00');
  });

  await test.step('S3 Click transaction-link in the first row', async () => {
    await transactionsPage.rowAt(0).open();

    await expect(paymentPage.detailReference).toHaveText(summary.reference);
    await expect(paymentPage.timelineEvents).toHaveCount(3);
    await expect(paymentPage.timelineEventAt(0)).toHaveAttribute('data-event-type', 'PAYMENT_CREATED');
    await expect(paymentPage.timelineEventAt(1)).toHaveAttribute('data-event-type', 'CONFIRMATION_SUBMITTED');
    await expect(paymentPage.timelineEventAt(2)).toHaveAttribute('data-event-type', 'PAYMENT_SUCCEEDED');
  });
});

import { test, expect } from '../fixtures';
import { env } from '../config/env';
import { testCards } from '../test-data/cards';

test('PAY-UI-001 Pay an outstanding fee in full with a successful card', { tag: ['@ui', '@payments'] }, async ({ loginPage, dashboardPage, checkoutPage, paymentPage, dev }) => {
  await test.step('S1 Log in; click pay-fee-button in fee-row-fee_1006', async () => {
    await dev.reset();
    await dev.restoreSimulation();
    await loginPage.loginAs(env.testUser);
    await dashboardPage.payFee('fee_1006');
  });

  await test.step('S2 Keep amount-full-radio selected; click continue-button', async () => {
    await checkoutPage.continueToPayment();
    await expect(checkoutPage.stepCard).toHaveClass(/active/);
    await expect(checkoutPage.paymentAmount).toHaveText('R 450,00');
    await expect(checkoutPage.paymentReference).toHaveText(/^SF-/);
  });

  await test.step('S3 Fill the card fields; click pay-button', async () => {
    await checkoutPage.fillCard(testCards.success);
    await expect(checkoutPage.cardNumberInput).toHaveValue('4242 4242 4242 4242');
    const { confirmed } = await checkoutPage.submitPayment();
    await expect(checkoutPage.processingOverlay).toBeVisible();
    await expect(checkoutPage.payButton).toBeDisabled();
    await confirmed;
  });

  await test.step('S4 Wait for the result; click back-to-dashboard', async () => {
    await expect(paymentPage.root).toHaveAttribute('data-payment-status', 'SUCCEEDED');
    await expect(paymentPage.successPanel).toBeVisible();
    await expect(paymentPage.detailAmount).toHaveText('R 450,00');
    await expect(paymentPage.detailMethod).toHaveText('VISA •••• 4242');

    await paymentPage.backToDashboard();
    await dashboardPage.waitForFees();
    await expect(dashboardPage.feeRow('fee_1006')).toHaveCount(0);
    await expect(dashboardPage.totalOutstandingStat).toContainText('R 23 750,00');
    await expect(dashboardPage.overdueStat).toContainText('R 1 200,00');
    await expect(dashboardPage.overdueStat).toContainText('1 overdue fee(s)');
  });
});

test('PAY-UI-002 Partial payment with amount validation updates the fee balance', { tag: ['@ui', '@payments'] }, async ({ page, loginPage, checkoutPage, paymentPage, feeDetailPage, dev }) => {
  const createRequests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/v1\/payments$/.test(request.url())) createRequests.push(request.url());
  });

  await test.step('S1 Open /fees/fee_1003/pay; choose amount-custom-radio', async () => {
    await dev.reset();
    await dev.restoreSimulation();
    await loginPage.loginAs(env.testUser);
    await checkoutPage.goto('fee_1003');
    await checkoutPage.amountCustomRadio.check();
  });

  await test.step('S2 Enter "9000" and continue; then "abc"; then "0.50"', async () => {
    await checkoutPage.customAmountInput.fill('9000');
    await checkoutPage.continueButton.click();
    await expect(checkoutPage.amountError).toHaveText('Amount cannot exceed the balance of R 8 450,00.');

    await checkoutPage.customAmountInput.fill('abc');
    await checkoutPage.continueButton.click();
    await expect(checkoutPage.amountError).toHaveText('Enter a valid amount, e.g. 1500.00');

    await checkoutPage.customAmountInput.fill('0.50');
    await checkoutPage.continueButton.click();
    await expect(checkoutPage.amountError).toHaveText('Minimum partial payment is R 1,00.');

    expect(createRequests).toEqual([]);
  });

  await test.step('S3 Enter "1500.50" and continue; pay with the success card', async () => {
    await checkoutPage.customAmountInput.fill('1500.50');
    await checkoutPage.continueToPayment();
    await expect(checkoutPage.paymentAmount).toHaveText('R 1 500,50');
    await expect(checkoutPage.payButton).toHaveText('Pay R 1 500,50');
    await checkoutPage.fillCard(testCards.success);
    await checkoutPage.pay();
    await expect(paymentPage.successPanel).toBeVisible();
  });

  await test.step('S4 Open /fees/fee_1003', async () => {
    await feeDetailPage.goto('fee_1003');
    await expect(feeDetailPage.amountPaid).toHaveText('R 1 500,50');
    await expect(feeDetailPage.balance).toHaveText('R 6 949,50');
    await expect(feeDetailPage.statusBadge).toHaveText('Partially Paid');
  });
});

test('PAY-UI-003 Declined card shows the failure state and allows a fresh attempt', { tag: ['@ui', '@payments'] }, async ({ page, loginPage, feeDetailPage, checkoutPage, paymentPage, dev }) => {
  let balanceBefore = '';

  await test.step('Precondition: restore simulation defaults', async () => {
    await dev.restoreSimulation();
  });

  await test.step('S1 Note the fee balance on /fees/fee_1008', async () => {
    await loginPage.loginAs(env.testUser);
    await feeDetailPage.goto('fee_1008');
    balanceBefore = await feeDetailPage.balance.innerText();
  });

  await test.step('S2 Pay with the declined card', async () => {
    await checkoutPage.goto('fee_1008');
    await checkoutPage.chooseCustomAmount('10');
    await checkoutPage.continueToPayment();
    await checkoutPage.fillCard(testCards.decline);
    await checkoutPage.pay();

    await expect(paymentPage.failurePanel).toBeVisible();
    await expect(paymentPage.failureMessage).toHaveText('The card was declined by the issuing bank.');
    await expect(paymentPage.statusBadge).toHaveAttribute('data-status', 'FAILED');
    await expect(paymentPage.detailFailure).toContainText('CARD_DECLINED');
  });

  await test.step('S3 Click try-again-button', async () => {
    await paymentPage.tryAgain();
    await expect(page).toHaveURL(/\/fees\/fee_1008\/pay$/);
    await expect(checkoutPage.stepAmount).toHaveClass(/active/);
    await expect(checkoutPage.amountForm).toBeVisible();

    await feeDetailPage.goto('fee_1008');
    await expect(feeDetailPage.balance).toHaveText(balanceBefore);
  });
});

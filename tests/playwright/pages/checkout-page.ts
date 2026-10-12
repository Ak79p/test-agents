import type { Locator, Page, Response } from '@playwright/test';
import type { CardDetails } from '../test-data/cards';

/** The /fees/:feeId/pay checkout (amount step, card step, processing overlay). Holds locators and actions only; assertions stay in the tests. */
export class CheckoutPage {
  /** The amount step form; replaced by a `fee-paid` alert when the fee is already paid. */
  readonly amountForm: Locator;
  readonly amountFullRadio: Locator;
  readonly amountCustomRadio: Locator;
  readonly customAmountInput: Locator;
  readonly continueButton: Locator;
  /** One element for every amount validation message; rendered only after a submit with an invalid amount. */
  readonly amountError: Locator;
  readonly stepAmount: Locator;
  /** Has the CSS class `active` while the card step is current (no ARIA state). */
  readonly stepCard: Locator;
  readonly orderSummary: Locator;
  /** Order-summary values without test IDs, in display order: Fee, Student (then Reference, Amount). */
  readonly summaryFee: Locator;
  readonly summaryStudent: Locator;
  readonly paymentAmount: Locator;
  readonly paymentReference: Locator;
  readonly cardNameInput: Locator;
  readonly cardNumberInput: Locator;
  readonly cardExpiryInput: Locator;
  readonly cardCvcInput: Locator;
  /** Native `disabled` while the confirmation is in flight. */
  readonly payButton: Locator;
  /** role=status; shown only while the confirmation is in flight (about gateway_latency_ms). */
  readonly processingOverlay: Locator;
  readonly cancelPaymentButton: Locator;

  constructor(readonly page: Page) {
    this.amountForm = page.getByTestId('amount-form');
    this.amountFullRadio = page.getByTestId('amount-full-radio');
    this.amountCustomRadio = page.getByTestId('amount-custom-radio');
    this.customAmountInput = page.getByTestId('custom-amount-input');
    this.continueButton = page.getByTestId('continue-button');
    this.amountError = page.getByTestId('amount-error');
    this.stepAmount = page.getByTestId('step-amount');
    this.stepCard = page.getByTestId('step-card');
    this.orderSummary = page.getByTestId('order-summary');
    this.summaryFee = this.orderSummary.getByRole('definition').nth(0);
    this.summaryStudent = this.orderSummary.getByRole('definition').nth(1);
    this.paymentAmount = this.orderSummary.getByTestId('payment-amount');
    this.paymentReference = this.orderSummary.getByTestId('payment-reference');
    this.cardNameInput = page.getByTestId('card-name-input');
    this.cardNumberInput = page.getByTestId('card-number-input');
    this.cardExpiryInput = page.getByTestId('card-expiry-input');
    this.cardCvcInput = page.getByTestId('card-cvc-input');
    this.payButton = page.getByTestId('pay-button');
    this.processingOverlay = page.getByTestId('processing-overlay');
    this.cancelPaymentButton = page.getByTestId('cancel-payment-button');
  }

  /**
   * Opens /fees/<feeId>/pay directly and waits until the amount step is ready (`amount-form` rendered).
   * Hangs until timeout if the fee is already paid (the form is replaced by a `fee-paid` alert).
   */
  async goto(feeId: string) {
    await this.page.goto(`/fees/${feeId}/pay`);
    await this.amountForm.waitFor();
  }

  /** Selects "Custom amount" and types the amount as a parent would (e.g. "10", "1500.50"). */
  async chooseCustomAmount(amount: string) {
    await this.amountCustomRadio.check();
    await this.customAmountInput.fill(amount);
  }

  /**
   * Clicks continue-button for a valid amount and waits for the POST payments response that creates the
   * payment (the card step then renders in place). Throws with the HTTP status if creation isn't 2xx.
   * Not for client-side validation cases: they send no request, so click `continueButton` instead.
   */
  async continueToPayment(): Promise<Response> {
    const created = this.page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/v1\/payments$/.test(r.url()));
    await this.continueButton.click();
    const res = await created;
    if (!res.ok()) throw new Error(`POST payments returned HTTP ${res.status()}`);
    return res;
  }

  /** The order summary as plain text, once the payment reference has rendered. */
  async readSummary(): Promise<{ fee: string; student: string; reference: string }> {
    await this.paymentReference.waitFor();
    return {
      fee: (await this.summaryFee.innerText()).trim(),
      student: (await this.summaryStudent.innerText()).trim(),
      reference: (await this.paymentReference.innerText()).trim(),
    };
  }

  /** Fills the four card inputs. Does not click pay-button. */
  async fillCard({ name, number, expiry, cvc }: CardDetails) {
    await this.cardNameInput.fill(name);
    await this.cardNumberInput.fill(number);
    await this.cardExpiryInput.fill(expiry);
    await this.cardCvcInput.fill(cvc);
  }

  /**
   * Clicks pay-button and returns at once, so the test can observe the in-flight state (overlay, disabled
   * button). `confirmed` resolves with the POST payments/<id>/confirm response whatever its status
   * (declines and gateway errors are legitimate outcomes the test asserts on). The app then navigates to
   * /payments/<id>.
   */
  async submitPayment(): Promise<{ confirmed: Promise<Response> }> {
    const confirmed = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/api\/v1\/payments\/[^/]+\/confirm$/.test(r.url()),
    );
    await this.payButton.click();
    return { confirmed };
  }

  /** Clicks pay-button and waits for the confirm response (any status); see `submitPayment()`. */
  async pay(): Promise<Response> {
    const { confirmed } = await this.submitPayment();
    return confirmed;
  }
}

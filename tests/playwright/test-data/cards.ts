/**
 * Simulated gateway cards. Numbers and outcomes mirror TEST_CARDS in backend/app/services/gateway.py
 * (any other valid card succeeds). Holder, expiry and CVC are the catalogue's standard card details.
 */
export type CardDetails = { name: string; number: string; expiry: string; cvc: string };

const card = (number: string): CardDetails => ({ name: 'Thandi Mokoena', number, expiry: '12/30', cvc: '123' });

export const testCards = {
  /** VISA 4242 → SUCCESS (confirm returns 200, SUCCEEDED). */
  success: card('4242424242424242'),
  /** Mastercard 4444 → SUCCESS. */
  successMastercard: card('5555555555554444'),
  decline: card('4000000000000002'),
  insufficientFunds: card('4000000000009995'),
  expiredCard: card('4000000000000069'),
  /** → 502 GATEWAY_ERROR; the payment stays retryable. */
  gatewayError: card('4000000000000119'),
  /** → 504 after gateway_timeout_ms. */
  timeout: card('4000000000001018'),
  /** → 202, then SUCCEEDED after pending_resolution_seconds. */
  pendingSuccess: card('4000000000002024'),
  /** → 202, then FAILED after pending_resolution_seconds. */
  pendingFailure: card('4000000000003030'),
} satisfies Record<string, CardDetails>;

import type { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * Thin client for /payments. Methods build the request and return the raw APIResponse, so status,
 * header and body assertions stay in the test. Wrap an authenticated context: `new PaymentsApi(await apiAs(user))`.
 */
export class PaymentsApi {
  constructor(private readonly request: APIRequestContext) {}

  /**
   * POST payments. Sends `Idempotency-Key` only when a key is given, so missing-key cases can omit it.
   * `body` is sent as-is (strict-validation cases may add or omit fields).
   */
  create(body: Record<string, unknown>, idempotencyKey?: string): Promise<APIResponse> {
    return this.request.post('payments', {
      headers: idempotencyKey === undefined ? {} : { 'Idempotency-Key': idempotencyKey },
      data: body,
    });
  }

  /** GET payments/{id}. */
  get(paymentId: string): Promise<APIResponse> {
    return this.request.get(`payments/${encodeURIComponent(paymentId)}`);
  }
}

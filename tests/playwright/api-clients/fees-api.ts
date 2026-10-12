import type { APIRequestContext, APIResponse } from '@playwright/test';

/** Thin client for /fees. Returns the raw APIResponse; assertions stay in the test. Wrap an authenticated context. */
export class FeesApi {
  constructor(private readonly request: APIRequestContext) {}

  /** GET fees/outstanding (optionally for one student). */
  outstanding(params: { studentId?: string } = {}): Promise<APIResponse> {
    return this.request.get('fees/outstanding', {
      params: params.studentId === undefined ? undefined : { student_id: params.studentId },
    });
  }

  /** GET fees/{id}. */
  get(feeId: string): Promise<APIResponse> {
    return this.request.get(`fees/${encodeURIComponent(feeId)}`);
  }
}

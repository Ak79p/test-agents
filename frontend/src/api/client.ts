import { config } from '../config';
import type { ValidationIssue } from './types';

/** Error thrown for every non-2xx response, carrying the backend's error envelope. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: unknown = null,
    public requestId: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level validation messages keyed by field path (e.g. "card.number"). */
  get fieldErrors(): Record<string, string> {
    if (this.code !== 'VALIDATION_ERROR' || !Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const issue of this.details as ValidationIssue[]) {
      if (!out[issue.field]) out[issue.field] = issue.message;
    }
    return out;
  }
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Skip the global "session expired" handling (used by login). */
  skipAuthRedirect?: boolean;
}

let tokenGetter: () => string | null = () => null;
let unauthorizedHandler: () => void = () => {};

export function configureClient(getToken: () => string | null, onUnauthorized: () => void) {
  tokenGetter = getToken;
  unauthorizedHandler = onUnauthorized;
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = tokenGetter();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the server. Check that the API is running and try again.');
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown; request_id?: string } })
      ?.error;
    const apiError = new ApiError(
      response.status,
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? `Request failed with status ${response.status}.`,
      err?.details ?? null,
      err?.request_id ?? response.headers.get('X-Request-ID'),
    );
    if (response.status === 401 && token && !opts.skipAuthRedirect) unauthorizedHandler();
    throw apiError;
  }

  return { data: payload as T, status: response.status, headers: response.headers };
}

export function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

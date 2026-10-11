import { request } from './client';
import type {
  CardDetails,
  Dashboard,
  FeeDetail,
  LoginResponse,
  OutstandingFees,
  Parent,
  Payment,
  PaymentStatus,
  PaymentStatusResponse,
  StudentSummary,
  TransactionList,
} from './types';

export const api = {
  login: async (email: string, password: string) =>
    (await request<LoginResponse>('POST', '/auth/login', { body: { email, password }, skipAuthRedirect: true })).data,

  logout: async () => {
    await request<void>('POST', '/auth/logout', { skipAuthRedirect: true });
  },

  me: async () => (await request<Parent>('GET', '/auth/me')).data,

  dashboard: async (signal?: AbortSignal) => (await request<Dashboard>('GET', '/dashboard', { signal })).data,

  students: async (signal?: AbortSignal) => (await request<StudentSummary[]>('GET', '/students', { signal })).data,

  outstandingFees: async (studentId?: string, signal?: AbortSignal) => {
    const qs = studentId ? `?student_id=${encodeURIComponent(studentId)}` : '';
    return (await request<OutstandingFees>('GET', `/fees/outstanding${qs}`, { signal })).data;
  },

  fee: async (feeId: string, signal?: AbortSignal) =>
    (await request<FeeDetail>('GET', `/fees/${encodeURIComponent(feeId)}`, { signal })).data,

  createPayment: async (feeId: string, amountCents: number, idempotencyKey: string) => {
    const res = await request<Payment>('POST', '/payments', {
      body: { fee_id: feeId, amount_cents: amountCents, payment_method: 'CARD' },
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return { payment: res.data, replayed: res.headers.get('Idempotent-Replayed') === 'true' };
  },

  payment: async (paymentId: string, signal?: AbortSignal) =>
    (await request<Payment>('GET', `/payments/${encodeURIComponent(paymentId)}`, { signal })).data,

  paymentStatus: async (paymentId: string, signal?: AbortSignal) =>
    (await request<PaymentStatusResponse>('GET', `/payments/${encodeURIComponent(paymentId)}/status`, { signal })).data,

  /** 200 = final outcome, 202 = still processing. 502/504 are thrown as ApiError. */
  confirmPayment: async (paymentId: string, card: CardDetails) => {
    const res = await request<Payment>('POST', `/payments/${encodeURIComponent(paymentId)}/confirm`, {
      body: { card },
    });
    return { payment: res.data, httpStatus: res.status };
  },

  cancelPayment: async (paymentId: string) =>
    (await request<Payment>('POST', `/payments/${encodeURIComponent(paymentId)}/cancel`)).data,

  transactions: async (
    params: {
      status?: PaymentStatus | '';
      studentId?: string;
      dateFrom?: string;
      dateTo?: string;
      page: number;
      pageSize: number;
    },
    signal?: AbortSignal,
  ) => {
    const qs = new URLSearchParams({ page: String(params.page), page_size: String(params.pageSize) });
    if (params.status) qs.append('status', params.status);
    if (params.studentId) qs.set('student_id', params.studentId);
    if (params.dateFrom) qs.set('date_from', params.dateFrom);
    if (params.dateTo) qs.set('date_to', params.dateTo);
    return (await request<TransactionList>('GET', `/transactions?${qs}`, { signal })).data;
  },
};

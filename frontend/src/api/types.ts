// Mirrors the backend Pydantic schemas (see http://127.0.0.1:8000/docs).

export type PaymentStatus = 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type FeeStatus = 'OUTSTANDING' | 'PARTIALLY_PAID' | 'PAID';

export interface Parent {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
}

export interface LoginResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_at: string;
  parent: Parent;
}

export interface Student {
  id: string;
  student_number: string;
  first_name: string;
  last_name: string;
  full_name: string;
  grade: string;
  school_name: string;
}

export interface StudentSummary extends Student {
  currency: string;
  outstanding_cents: number;
  overdue_cents: number;
  outstanding_fee_count: number;
  next_due_date: string | null;
}

export interface Fee {
  id: string;
  student_id: string;
  student_name: string;
  description: string;
  category: string;
  term: string;
  amount_cents: number;
  amount_paid_cents: number;
  balance_cents: number;
  currency: string;
  due_date: string;
  status: FeeStatus;
  is_overdue: boolean;
  days_until_due: number;
}

export interface OutstandingFees {
  items: Fee[];
  count: number;
  total_outstanding_cents: number;
  overdue_cents: number;
  currency: string;
}

export interface PaymentSummary {
  id: string;
  reference: string;
  status: PaymentStatus;
  amount_cents: number;
  currency: string;
  fee_id: string;
  fee_description: string;
  student_id: string;
  student_name: string;
  payment_method: string;
  card_brand: string | null;
  card_last4: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface PaymentEvent {
  type: string;
  from_status: string | null;
  to_status: string | null;
  message: string | null;
  created_at: string;
}

export interface Payment extends PaymentSummary {
  idempotency_key: string;
  gateway_reference: string | null;
  confirm_attempts: number;
  is_final: boolean;
  is_cancellable: boolean;
  events: PaymentEvent[];
}

export interface PaymentStatusResponse {
  id: string;
  reference: string;
  status: PaymentStatus;
  is_final: boolean;
  failure_code: string | null;
  failure_message: string | null;
  updated_at: string;
  retry_after_ms: number | null;
}

export interface FeeDetail extends Fee {
  payments: PaymentSummary[];
  has_payment_in_progress: boolean;
}

export interface TransactionList {
  items: PaymentSummary[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface Dashboard {
  parent: Parent;
  summary: {
    currency: string;
    total_outstanding_cents: number;
    overdue_cents: number;
    overdue_count: number;
    outstanding_count: number;
    next_due_date: string | null;
    paid_last_90_days_cents: number;
  };
  students: StudentSummary[];
  upcoming_fees: Fee[];
  recent_transactions: PaymentSummary[];
}

export interface CardDetails {
  number: string;
  expiry_month: number;
  expiry_year: number;
  cvc: string;
  holder_name: string;
}

export interface ValidationIssue {
  location: string;
  field: string;
  message: string;
  type?: string;
}

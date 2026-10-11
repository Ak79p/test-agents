import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, describeError } from '../api/client';
import type { FeeStatus, PaymentStatus } from '../api/types';
import { humanize } from '../lib/format';

export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`spinner spinner-${size}`} aria-hidden="true" />;
}

export function Loading({ label = 'Loading…', testId = 'loading' }: { label?: string; testId?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite" data-testid={testId}>
      <Spinner size="lg" />
      <span>{label}</span>
    </div>
  );
}

type AlertVariant = 'error' | 'success' | 'warning' | 'info';

export function Alert({
  variant = 'info',
  title,
  children,
  testId,
  action,
}: {
  variant?: AlertVariant;
  title?: string;
  children?: ReactNode;
  testId?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className={`alert alert-${variant}`}
      role={variant === 'error' || variant === 'warning' ? 'alert' : 'status'}
      data-testid={testId ?? `alert-${variant}`}
    >
      <div className="alert-body">
        {title && <strong className="alert-title">{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className="alert-action">{action}</div>}
    </div>
  );
}

/** Standard error block for failed page loads. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <Alert
      variant="error"
      title={notFound ? 'Not found' : 'Could not load data'}
      testId="error-state"
      action={
        onRetry && !notFound ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry} data-testid="retry-button">
            Try again
          </button>
        ) : notFound ? (
          <Link to="/" className="btn btn-secondary btn-sm">
            Go to dashboard
          </Link>
        ) : undefined
      }
    >
      {describeError(error)}
      {error instanceof ApiError && error.requestId && (
        <div className="muted small">Request ID: {error.requestId}</div>
      )}
    </Alert>
  );
}

export function EmptyState({ title, children, testId = 'empty-state' }: { title: string; children?: ReactNode; testId?: string }) {
  return (
    <div className="empty-state" data-testid={testId}>
      <strong>{title}</strong>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}

const PAYMENT_TONES: Record<PaymentStatus, string> = {
  SUCCEEDED: 'success',
  FAILED: 'danger',
  PROCESSING: 'warning',
  PENDING: 'info',
  CANCELLED: 'neutral',
};

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  SUCCEEDED: 'Successful',
  FAILED: 'Failed',
  PROCESSING: 'Processing',
  PENDING: 'Awaiting confirmation',
  CANCELLED: 'Cancelled',
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={`badge badge-${PAYMENT_TONES[status]}`} data-testid="payment-status-badge" data-status={status}>
      {PAYMENT_LABELS[status]}
    </span>
  );
}

export function FeeStatusBadge({ status, overdue }: { status: FeeStatus; overdue: boolean }) {
  const tone = status === 'PAID' ? 'success' : overdue ? 'danger' : status === 'PARTIALLY_PAID' ? 'info' : 'warning';
  const label = status !== 'PAID' && overdue ? 'Overdue' : humanize(status);
  return (
    <span className={`badge badge-${tone}`} data-testid="fee-status-badge" data-status={overdue && status !== 'PAID' ? 'OVERDUE' : status}>
      {label}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {back && (
          <Link to={back.to} className="back-link" data-testid="back-link">
            ← {back.label}
          </Link>
        )}
        <h1 data-testid="page-title">{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

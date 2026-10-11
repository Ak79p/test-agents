import { Link, useParams } from 'react-router-dom';
import { api } from '../api/endpoints';
import { Alert, EmptyState, ErrorState, FeeStatusBadge, Loading, PageHeader, PaymentStatusBadge } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { dueLabel, formatDate, formatDateTime, formatMoney, humanize } from '../lib/format';

export function FeeDetailPage() {
  const { feeId = '' } = useParams();
  const { data: fee, error, loading, reload } = useApi((signal) => api.fee(feeId, signal), [feeId]);

  if (loading && !fee) return <Loading label="Loading fee…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!fee) return null;

  const paid = fee.status === 'PAID';
  const progress = Math.round((fee.amount_paid_cents / fee.amount_cents) * 100);

  return (
    <div data-testid="fee-detail-page">
      <PageHeader
        title={fee.description}
        subtitle={`${fee.student_name} · ${fee.term}`}
        back={{ to: '/', label: 'Dashboard' }}
        actions={
          !paid && (
            <Link
              to={`/fees/${fee.id}/pay`}
              className={`btn btn-primary ${fee.has_payment_in_progress ? 'disabled' : ''}`}
              aria-disabled={fee.has_payment_in_progress}
              onClick={(e) => fee.has_payment_in_progress && e.preventDefault()}
              data-testid="pay-now-button"
            >
              Pay {formatMoney(fee.balance_cents, fee.currency)}
            </Link>
          )
        }
      />

      {fee.has_payment_in_progress && (
        <Alert variant="warning" testId="payment-in-progress">
          A payment for this fee is currently processing. You can pay again once it completes.
        </Alert>
      )}

      <div className="detail-grid">
        <section className="card" aria-label="Fee summary">
          <div className="card-row">
            <span className="muted">Status</span>
            <FeeStatusBadge status={fee.status} overdue={fee.is_overdue} />
          </div>
          <dl className="dl">
            <dt>Category</dt>
            <dd data-testid="fee-category">{humanize(fee.category)}</dd>
            <dt>Due date</dt>
            <dd data-testid="fee-due-date">
              {formatDate(fee.due_date)}
              {!paid && (
                <span className={`small ${fee.is_overdue ? 'text-danger' : 'muted'}`}> · {dueLabel(fee.days_until_due)}</span>
              )}
            </dd>
            <dt>Total amount</dt>
            <dd data-testid="fee-amount">{formatMoney(fee.amount_cents, fee.currency)}</dd>
            <dt>Paid to date</dt>
            <dd data-testid="fee-amount-paid">{formatMoney(fee.amount_paid_cents, fee.currency)}</dd>
            <dt>Balance</dt>
            <dd data-testid="fee-balance">
              <strong>{formatMoney(fee.balance_cents, fee.currency)}</strong>
            </dd>
          </dl>
          <div
            className="progress"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Amount paid"
          >
            <div className="progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <p className="muted small">{progress}% paid</p>
        </section>

        <section className="card" aria-labelledby="fee-payments-heading">
          <h2 id="fee-payments-heading">Payments for this fee</h2>
          {fee.payments.length === 0 ? (
            <EmptyState title="No payments yet" testId="fee-payments-empty" />
          ) : (
            <ul className="list" data-testid="fee-payments">
              {fee.payments.map((p) => (
                <li key={p.id}>
                  <Link to={`/payments/${p.id}`} className="list-row" data-testid={`fee-payment-${p.id}`}>
                    <div>
                      <strong>{p.reference}</strong>
                      <div className="muted small">{formatDateTime(p.created_at)}</div>
                    </div>
                    <div className="list-row-end">
                      <span>{formatMoney(p.amount_cents, p.currency)}</span>
                      <PaymentStatusBadge status={p.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

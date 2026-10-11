import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { describeError } from '../api/client';
import { api } from '../api/endpoints';
import type { Payment } from '../api/types';
import { Alert, ErrorState, Loading, PageHeader, PaymentStatusBadge, Spinner } from '../components/ui';
import { config } from '../config';
import { useApi } from '../hooks/useApi';
import { formatDateTime, formatMoney, humanize } from '../lib/format';

export function PaymentPage() {
  const { paymentId = '' } = useParams();
  const location = useLocation();
  const fromCheckout = (location.state as { fromCheckout?: boolean } | null)?.fromCheckout ?? false;
  const { data, error, loading, reload } = useApi((signal) => api.payment(paymentId, signal), [paymentId]);
  const [payment, setPayment] = useState<Payment | null>(null);

  useEffect(() => setPayment(data), [data]);

  if (loading && !payment) return <Loading label="Loading payment…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!payment) return null;

  return (
    <div data-testid="payment-page" data-payment-status={payment.status}>
      <PageHeader
        title={fromCheckout ? 'Payment result' : 'Payment details'}
        subtitle={`Reference ${payment.reference}`}
        back={{ to: '/transactions', label: 'Transactions' }}
      />
      <StatusPanel payment={payment} onChange={setPayment} />
      <div className="detail-grid">
        <section className="card" aria-labelledby="details-heading">
          <h2 id="details-heading">Details</h2>
          <dl className="dl" data-testid="payment-details">
            <dt>Status</dt>
            <dd>
              <PaymentStatusBadge status={payment.status} />
            </dd>
            <dt>Amount</dt>
            <dd data-testid="detail-amount">{formatMoney(payment.amount_cents, payment.currency)}</dd>
            <dt>Fee</dt>
            <dd>
              <Link to={`/fees/${payment.fee_id}`} data-testid="detail-fee-link">
                {payment.fee_description}
              </Link>
            </dd>
            <dt>Student</dt>
            <dd data-testid="detail-student">{payment.student_name}</dd>
            <dt>Reference</dt>
            <dd data-testid="detail-reference">{payment.reference}</dd>
            <dt>Payment ID</dt>
            <dd className="mono small" data-testid="detail-payment-id">
              {payment.id}
            </dd>
            <dt>Method</dt>
            <dd data-testid="detail-method">
              {payment.card_last4 ? `${payment.card_brand ?? 'Card'} •••• ${payment.card_last4}` : humanize(payment.payment_method)}
            </dd>
            {payment.failure_code && (
              <>
                <dt>Failure reason</dt>
                <dd data-testid="detail-failure">
                  {payment.failure_message} <span className="muted small">({payment.failure_code})</span>
                </dd>
              </>
            )}
            <dt>Created</dt>
            <dd>{formatDateTime(payment.created_at)}</dd>
            <dt>Completed</dt>
            <dd>{formatDateTime(payment.completed_at)}</dd>
            <dt>Gateway reference</dt>
            <dd className="mono small">{payment.gateway_reference ?? '—'}</dd>
            <dt>Confirmation attempts</dt>
            <dd>{payment.confirm_attempts}</dd>
          </dl>
        </section>
        <section className="card" aria-labelledby="timeline-heading">
          <h2 id="timeline-heading">Timeline</h2>
          <ol className="timeline" data-testid="payment-timeline">
            {payment.events.map((e, i) => (
              <li key={i} data-testid="timeline-event" data-event-type={e.type}>
                <strong>{humanize(e.type)}</strong>
                <span className="muted small">{formatDateTime(e.created_at)}</span>
                {e.message && <p className="small">{e.message}</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

function StatusPanel({ payment, onChange }: { payment: Payment; onChange: (p: Payment) => void }) {
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const amount = formatMoney(payment.amount_cents, payment.currency);

  // Poll the lightweight status endpoint while the gateway outcome is unknown.
  useEffect(() => {
    if (payment.status !== 'PROCESSING') return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();
    setPollTimedOut(false);

    const poll = async (delay: number) => {
      timer = setTimeout(async () => {
        if (stopped) return;
        try {
          const status = await api.paymentStatus(payment.id);
          setPollError(null);
          if (status.is_final || status.status !== 'PROCESSING') {
            const full = await api.payment(payment.id);
            if (!stopped) onChange(full);
            return;
          }
          if (Date.now() - startedAt >= config.pollTimeoutMs) {
            setPollTimedOut(true);
            return;
          }
          poll(Math.max(status.retry_after_ms ?? config.pollIntervalMs, config.pollIntervalMs));
        } catch (err) {
          if (stopped) return;
          setPollError(describeError(err));
          poll(config.pollIntervalMs * 2);
        }
      }, delay);
    };
    poll(config.pollIntervalMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [payment.id, payment.status, onChange]);

  const cancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      onChange(await api.cancelPayment(payment.id));
    } catch (err) {
      setCancelError(describeError(err));
    } finally {
      setCancelling(false);
    }
  };

  switch (payment.status) {
    case 'SUCCEEDED':
      return (
        <div className="status-panel status-success" data-testid="payment-success">
          <div className="status-icon" aria-hidden="true">✓</div>
          <div>
            <h2>Payment successful</h2>
            <p>
              {amount} paid for {payment.fee_description} ({payment.student_name}).
            </p>
            <div className="status-actions">
              <Link to="/" className="btn btn-primary" data-testid="back-to-dashboard">
                Back to dashboard
              </Link>
              <Link to="/transactions" className="btn btn-secondary">
                View transactions
              </Link>
            </div>
          </div>
        </div>
      );
    case 'FAILED':
      return (
        <div className="status-panel status-failure" data-testid="payment-failure">
          <div className="status-icon" aria-hidden="true">✕</div>
          <div>
            <h2>Payment failed</h2>
            <p data-testid="failure-message">{payment.failure_message ?? 'The payment could not be completed.'}</p>
            <div className="status-actions">
              <Link to={`/fees/${payment.fee_id}/pay`} className="btn btn-primary" data-testid="try-again-button">
                Try again
              </Link>
              <Link to="/" className="btn btn-secondary">
                Back to dashboard
              </Link>
            </div>
          </div>
        </div>
      );
    case 'PROCESSING':
      return (
        <div className="status-panel status-pending" data-testid="payment-pending" aria-live="polite">
          <div className="status-icon" aria-hidden="true">
            <Spinner size="lg" />
          </div>
          <div>
            <h2>Payment pending</h2>
            <p>We're waiting for confirmation from the payment provider. This page updates automatically.</p>
            {pollError && <p className="small text-danger">Having trouble checking the status: {pollError}</p>}
            {pollTimedOut && (
              <Alert variant="warning" testId="poll-timeout">
                This is taking longer than usual. Check back later; you won't be charged twice.
              </Alert>
            )}
          </div>
        </div>
      );
    case 'PENDING':
      return (
        <div className="status-panel status-info" data-testid="payment-awaiting">
          <div className="status-icon" aria-hidden="true">…</div>
          <div>
            <h2>Awaiting confirmation</h2>
            <p>
              This payment of {amount} has been created but not yet confirmed.
              {payment.failure_message && <> Last attempt: {payment.failure_message}</>}
            </p>
            {cancelError && <p className="small text-danger">{cancelError}</p>}
            <div className="status-actions">
              <Link
                to={`/fees/${payment.fee_id}/pay?payment=${payment.id}`}
                className="btn btn-primary"
                data-testid="continue-payment-button"
              >
                Continue payment
              </Link>
              <button type="button" className="btn btn-secondary" onClick={cancel} disabled={cancelling} data-testid="cancel-payment-button">
                {cancelling ? 'Cancelling…' : 'Cancel payment'}
              </button>
            </div>
          </div>
        </div>
      );
    case 'CANCELLED':
      return (
        <div className="status-panel status-neutral" data-testid="payment-cancelled">
          <div className="status-icon" aria-hidden="true">–</div>
          <div>
            <h2>Payment cancelled</h2>
            <p>No money was taken.</p>
            <div className="status-actions">
              <Link to={`/fees/${payment.fee_id}`} className="btn btn-secondary">
                Back to fee
              </Link>
            </div>
          </div>
        </div>
      );
  }
}

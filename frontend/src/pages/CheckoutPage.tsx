import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, describeError } from '../api/client';
import { api } from '../api/endpoints';
import type { FeeDetail, Payment } from '../api/types';
import { Alert, ErrorState, Loading, PageHeader, Spinner } from '../components/ui';
import { config } from '../config';
import {
  formatCardNumber,
  formatExpiry,
  mapServerCardErrors,
  newIdempotencyKey,
  TEST_CARDS,
  toCardDetails,
  validateCard,
  type CardErrors,
  type CardForm,
} from '../lib/card';
import { formatMoney, parseAmountToCents } from '../lib/format';

const MIN_PARTIAL_CENTS = 100;

export function CheckoutPage() {
  const { feeId = '' } = useParams();
  const [params] = useSearchParams();
  const resumeId = params.get('payment');
  const navigate = useNavigate();

  const [fee, setFee] = useState<FeeDetail | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);

  // Load the fee (and the payment being resumed, if any)
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const f = await api.fee(feeId, controller.signal);
        let p: Payment | null = null;
        if (resumeId) {
          p = await api.payment(resumeId, controller.signal);
          if (p.fee_id !== f.id || p.status !== 'PENDING') {
            navigate(`/payments/${p.id}`, { replace: true });
            return;
          }
        }
        setFee(f);
        setPayment(p);
      } catch (err) {
        if (!controller.signal.aborted) setLoadError(err);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [feeId, resumeId, navigate, reloadTick]);

  if (loading) return <Loading label="Preparing checkout…" />;
  if (loadError) return <ErrorState error={loadError} onRetry={() => setReloadTick((t) => t + 1)} />;
  if (!fee) return null;

  return (
    <div data-testid="checkout-page">
      <PageHeader
        title="Checkout"
        subtitle={`${fee.description} · ${fee.student_name}`}
        back={{ to: `/fees/${fee.id}`, label: 'Fee details' }}
      />
      <ol className="steps" aria-label="Checkout steps">
        <li className={payment ? 'done' : 'active'} data-testid="step-amount">
          1. Amount
        </li>
        <li className={payment ? 'active' : ''} data-testid="step-card">
          2. Card details
        </li>
      </ol>
      {payment ? (
        <CardStep fee={fee} payment={payment} />
      ) : (
        <AmountStep fee={fee} onCreated={(p) => setPayment(p)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ step 1 */

function AmountStep({ fee, onCreated }: { fee: FeeDetail; onCreated: (p: Payment) => void }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'full' | 'custom'>('full');
  const [custom, setCustom] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  // Same amount => same key, so double-clicks and retries after network errors never create duplicates.
  const keyRef = useRef<{ amount: number; key: string } | null>(null);

  if (fee.status === 'PAID') {
    return (
      <Alert variant="success" title="Nothing to pay" testId="fee-paid">
        This fee has been paid in full. <Link to="/">Back to dashboard</Link>
      </Alert>
    );
  }

  const validateAmount = (): number | null => {
    if (mode === 'full') return fee.balance_cents;
    if (!custom.trim()) return fail('Enter an amount.');
    const cents = parseAmountToCents(custom);
    if (cents === null) return fail('Enter a valid amount, e.g. 1500.00');
    if (cents <= 0) return fail('Amount must be greater than zero.');
    if (cents > fee.balance_cents) return fail(`Amount cannot exceed the balance of ${formatMoney(fee.balance_cents, fee.currency)}.`);
    if (cents < MIN_PARTIAL_CENTS && cents !== fee.balance_cents)
      return fail(`Minimum partial payment is ${formatMoney(MIN_PARTIAL_CENTS, fee.currency)}.`);
    return cents;
  };
  function fail(msg: string): null {
    setAmountError(msg);
    return null;
  }

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    setAmountError(null);
    const amount = validateAmount();
    if (amount === null) return;
    if (!keyRef.current || keyRef.current.amount !== amount) keyRef.current = { amount, key: newIdempotencyKey() };
    setSubmitting(true);
    try {
      const { payment } = await api.createPayment(fee.id, amount, keyRef.current.key);
      if (payment.status === 'PENDING') onCreated(payment);
      else navigate(`/payments/${payment.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'AMOUNT_EXCEEDS_BALANCE') setAmountError(err.message);
      else setError(err);
      setSubmitting(false);
    }
  };

  const inProgressId =
    error instanceof ApiError && error.code === 'PAYMENT_IN_PROGRESS'
      ? (error.details as { payment_id?: string })?.payment_id
      : undefined;

  return (
    <form className="card checkout-card" onSubmit={onSubmit} noValidate data-testid="amount-form">
      <h2>How much would you like to pay?</h2>
      {fee.has_payment_in_progress && (
        <Alert variant="warning" testId="payment-in-progress">
          Another payment for this fee is still processing.
        </Alert>
      )}
      {error != null && (
        <Alert
          variant="error"
          testId="create-payment-error"
          action={inProgressId && <Link to={`/payments/${inProgressId}`}>View payment</Link>}
        >
          {describeError(error)}
        </Alert>
      )}

      <fieldset className="radio-group">
        <legend className="sr-only">Payment amount</legend>
        <label className={`radio-card ${mode === 'full' ? 'selected' : ''}`}>
          <input
            type="radio"
            name="amount-mode"
            value="full"
            checked={mode === 'full'}
            onChange={() => setMode('full')}
            data-testid="amount-full-radio"
          />
          <span>
            <strong>Full balance</strong>
            <span className="muted"> {formatMoney(fee.balance_cents, fee.currency)}</span>
          </span>
        </label>
        <label className={`radio-card ${mode === 'custom' ? 'selected' : ''}`}>
          <input
            type="radio"
            name="amount-mode"
            value="custom"
            checked={mode === 'custom'}
            onChange={() => setMode('custom')}
            data-testid="amount-custom-radio"
          />
          <span>
            <strong>Other amount</strong>
            <span className="muted"> (partial payment)</span>
          </span>
        </label>
      </fieldset>

      {mode === 'custom' && (
        <div className="field">
          <label htmlFor="custom-amount">Amount (R)</label>
          <input
            id="custom-amount"
            inputMode="decimal"
            placeholder="0.00"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            aria-invalid={!!amountError}
            aria-describedby={amountError ? 'amount-error' : undefined}
            data-testid="custom-amount-input"
            autoFocus
          />
        </div>
      )}
      {amountError && (
        <p className="field-error" id="amount-error" data-testid="amount-error">
          {amountError}
        </p>
      )}

      <div className="form-actions">
        <Link to={`/fees/${fee.id}`} className="btn btn-secondary">
          Back
        </Link>
        <button type="submit" className="btn btn-primary" disabled={submitting || fee.has_payment_in_progress} data-testid="continue-button">
          {submitting ? (
            <>
              <Spinner size="sm" /> Creating payment…
            </>
          ) : (
            'Continue to payment'
          )}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ step 2 */

const EMPTY_CARD: CardForm = { holderName: '', number: '', expiry: '', cvc: '' };

function CardStep({ fee, payment }: { fee: FeeDetail; payment: Payment }) {
  const navigate = useNavigate();
  const [form, setForm] = useState<CardForm>(EMPTY_CARD);
  const [errors, setErrors] = useState<CardErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof CardForm, boolean>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const update = (field: keyof CardForm, value: string) => {
    const next = { ...form, [field]: value };
    setForm(next);
    if (touched[field]) setErrors((e) => ({ ...e, [field]: validateCard(next)[field] }));
  };
  const blur = (field: keyof CardForm) => {
    setTouched((t) => ({ ...t, [field]: true }));
    setErrors((e) => ({ ...e, [field]: validateCard(form)[field] }));
  };

  const goToResult = () => navigate(`/payments/${payment.id}`, { replace: true, state: { fromCheckout: true } });

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    const found = validateCard(form);
    setErrors(found);
    setTouched({ holderName: true, number: true, expiry: true, cvc: true });
    if (Object.keys(found).length) return;

    setSubmitting(true);
    try {
      await api.confirmPayment(payment.id, toCardDetails(form));
      goToResult(); // 200 (SUCCEEDED / FAILED) or 202 (PROCESSING)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'GATEWAY_TIMEOUT' || err.code === 'INVALID_PAYMENT_STATE') return goToResult();
        if (err.code === 'VALIDATION_ERROR') setErrors(mapServerCardErrors(err.fieldErrors));
      }
      setError(err);
      setSubmitting(false);
    }
  };

  const onCancel = async () => {
    setCancelling(true);
    try {
      await api.cancelPayment(payment.id);
      goToResult();
    } catch (err) {
      setError(err);
      setCancelling(false);
      setConfirmCancel(false);
    }
  };

  const gatewayError = error instanceof ApiError && error.code === 'GATEWAY_ERROR';
  const amount = formatMoney(payment.amount_cents, payment.currency);

  return (
    <div className="checkout-layout">
      <form className="card checkout-card" onSubmit={onSubmit} noValidate data-testid="card-form" aria-busy={submitting}>
        <h2>Card details</h2>
        {error != null && (
          <Alert
            variant={gatewayError ? 'warning' : 'error'}
            title={gatewayError ? 'Payment provider unavailable' : 'Payment could not be submitted'}
            testId="confirm-error"
          >
            {describeError(error)}
            {gatewayError && ' Your card was not charged.'}
          </Alert>
        )}

        <CardField id="holder-name" label="Name on card" error={errors.holderName} testId="card-name-input">
          <input
            id="holder-name"
            autoComplete="cc-name"
            value={form.holderName}
            onChange={(e) => update('holderName', e.target.value)}
            onBlur={() => blur('holderName')}
            aria-invalid={!!errors.holderName}
            data-testid="card-name-input"
          />
        </CardField>
        <CardField id="card-number" label="Card number" error={errors.number} testId="card-number-input">
          <input
            id="card-number"
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="1234 5678 9012 3456"
            value={form.number}
            onChange={(e) => update('number', formatCardNumber(e.target.value))}
            onBlur={() => blur('number')}
            aria-invalid={!!errors.number}
            data-testid="card-number-input"
          />
        </CardField>
        <div className="field-row">
          <CardField id="card-expiry" label="Expiry (MM/YY)" error={errors.expiry} testId="card-expiry-input">
            <input
              id="card-expiry"
              inputMode="numeric"
              autoComplete="cc-exp"
              placeholder="MM/YY"
              value={form.expiry}
              onChange={(e) => update('expiry', formatExpiry(e.target.value))}
              onBlur={() => blur('expiry')}
              aria-invalid={!!errors.expiry}
              data-testid="card-expiry-input"
            />
          </CardField>
          <CardField id="card-cvc" label="CVC" error={errors.cvc} testId="card-cvc-input">
            <input
              id="card-cvc"
              inputMode="numeric"
              autoComplete="cc-csc"
              placeholder="123"
              maxLength={4}
              value={form.cvc}
              onChange={(e) => update('cvc', e.target.value.replace(/\D/g, ''))}
              onBlur={() => blur('cvc')}
              aria-invalid={!!errors.cvc}
              data-testid="card-cvc-input"
            />
          </CardField>
        </div>

        <div className="form-actions">
          {confirmCancel ? (
            <div className="confirm-inline" data-testid="cancel-confirmation">
              <span>Cancel this payment?</span>
              <button type="button" className="btn btn-danger btn-sm" onClick={onCancel} disabled={cancelling} data-testid="confirm-cancel-button">
                {cancelling ? 'Cancelling…' : 'Yes, cancel'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmCancel(false)} data-testid="keep-payment-button">
                Keep paying
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setConfirmCancel(true)}
              disabled={submitting}
              data-testid="cancel-payment-button"
            >
              Cancel payment
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={submitting || cancelling} data-testid="pay-button">
            {submitting ? (
              <>
                <Spinner size="sm" /> Processing…
              </>
            ) : (
              `Pay ${amount}`
            )}
          </button>
        </div>
        {submitting && (
          <div className="processing-overlay" role="status" aria-live="assertive" data-testid="processing-overlay">
            <Spinner size="lg" />
            <strong>Processing your payment…</strong>
            <span className="muted">Please don't close or refresh this page.</span>
          </div>
        )}
      </form>

      <aside className="checkout-aside">
        <div className="card" data-testid="order-summary">
          <h2>Summary</h2>
          <dl className="dl">
            <dt>Fee</dt>
            <dd>{fee.description}</dd>
            <dt>Student</dt>
            <dd>{fee.student_name}</dd>
            <dt>Reference</dt>
            <dd data-testid="payment-reference">{payment.reference}</dd>
            <dt>Amount</dt>
            <dd>
              <strong data-testid="payment-amount">{amount}</strong>
            </dd>
          </dl>
          <p className="muted small">🔒 Simulated payment – no real card is charged.</p>
        </div>
        {config.showTestCards && (
          <details className="card test-cards" data-testid="test-cards">
            <summary>Test cards</summary>
            <p className="muted small">Any future expiry date and any 3-digit CVC.</p>
            <ul>
              {TEST_CARDS.map((c) => (
                <li key={c.number}>
                  <button
                    type="button"
                    className="link-button mono"
                    onClick={() => {
                      const next = {
                        holderName: form.holderName || 'Test Parent',
                        number: c.number,
                        expiry: form.expiry || '12/30',
                        cvc: form.cvc || '123',
                      };
                      setForm(next);
                      setErrors({});
                    }}
                    data-testid={`test-card-${c.number.replace(/\s/g, '')}`}
                  >
                    {c.number}
                  </button>
                  <span className="muted small"> {c.outcome}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </aside>
    </div>
  );
}

function CardField({
  id,
  label,
  error,
  testId,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error && (
        <p className="field-error" data-testid={testId.replace('-input', '-error')}>
          {error}
        </p>
      )}
    </div>
  );
}

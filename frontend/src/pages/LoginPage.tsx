import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, describeError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Spinner } from '../components/ui';

const DEMO_ACCOUNTS = [
  { email: 'thandi.mokoena@example.com', note: '2 children, overdue + partial fees' },
  { email: 'john.smith@example.com', note: '1 child' },
  { email: 'priya.naidoo@example.com', note: '3 children, many fees' },
  { email: 'sipho.dlamini@example.com', note: 'everything paid' },
  { email: 'ayesha.patel@example.com', note: 'no linked students' },
];
const DEMO_PASSWORD = 'Password123!';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function LoginPage() {
  const { session, sessionExpired, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (session) return <Navigate to={next} replace />;

  const validate = () => {
    const e: typeof errors = {};
    if (!email.trim()) e.email = 'Email is required.';
    else if (!EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address.';
    if (!password) e.password = 'Password is required.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(next.startsWith('/') ? next : '/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
        const fe = err.fieldErrors;
        setErrors({ email: fe.email, password: fe.password });
      }
      setFormError(describeError(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card card">
        <div className="login-brand">
          <span className="brand-mark brand-mark-lg" aria-hidden="true">F</span>
          <div>
            <h1>FeeFlow</h1>
            <p className="muted">Pay school fees for your children</p>
          </div>
        </div>

        {sessionExpired && (
          <Alert variant="warning" testId="session-expired">
            Your session has expired. Please log in again.
          </Alert>
        )}
        {formError && (
          <Alert variant="error" testId="login-error">
            {formError}
          </Alert>
        )}

        <form onSubmit={onSubmit} noValidate data-testid="login-form">
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
              data-testid="email-input"
            />
            {errors.email && (
              <p className="field-error" id="email-error" data-testid="email-error">
                {errors.email}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
              data-testid="password-input"
            />
            {errors.password && (
              <p className="field-error" id="password-error" data-testid="password-error">
                {errors.password}
              </p>
            )}
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting} data-testid="login-button">
            {submitting ? (
              <>
                <Spinner size="sm" /> Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        <details className="demo-accounts" data-testid="demo-accounts">
          <summary>Demo accounts (password: {DEMO_PASSWORD})</summary>
          <ul>
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.email}>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setEmail(a.email);
                    setPassword(DEMO_PASSWORD);
                    setErrors({});
                    setFormError(null);
                  }}
                  data-testid={`demo-account-${a.email.split('@')[0]}`}
                >
                  {a.email}
                </button>
                <span className="muted small"> — {a.note}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}

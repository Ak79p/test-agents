import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/endpoints';
import { EmptyState, ErrorState, FeeStatusBadge, Loading, PageHeader, PaymentStatusBadge } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { dueLabel, formatDate, formatDateTime, formatMoney } from '../lib/format';

export function DashboardPage() {
  const dashboard = useApi((signal) => api.dashboard(signal), []);
  const [studentFilter, setStudentFilter] = useState('');
  const outstanding = useApi((signal) => api.outstandingFees(studentFilter || undefined, signal), [studentFilter]);

  if (dashboard.loading && !dashboard.data) return <Loading label="Loading your dashboard…" />;
  if (dashboard.error) return <ErrorState error={dashboard.error} onRetry={dashboard.reload} />;
  const data = dashboard.data!;
  const { summary } = data;
  const firstName = data.parent.full_name.split(' ')[0];

  return (
    <div data-testid="dashboard-page">
      <PageHeader title={`Hello, ${firstName}`} subtitle="Here's an overview of your school fees." />

      <section className="stats-grid" aria-label="Summary">
        <div className="stat card" data-testid="stat-total-outstanding">
          <span className="stat-label">Total outstanding</span>
          <span className="stat-value">{formatMoney(summary.total_outstanding_cents, summary.currency)}</span>
          <span className="muted small">{summary.outstanding_count} unpaid fee(s)</span>
        </div>
        <div className={`stat card ${summary.overdue_count ? 'stat-danger' : ''}`} data-testid="stat-overdue">
          <span className="stat-label">Overdue</span>
          <span className="stat-value">{formatMoney(summary.overdue_cents, summary.currency)}</span>
          <span className="muted small">{summary.overdue_count} overdue fee(s)</span>
        </div>
        <div className="stat card" data-testid="stat-next-due">
          <span className="stat-label">Next due date</span>
          <span className="stat-value">{formatDate(summary.next_due_date)}</span>
          <span className="muted small">Upcoming payments</span>
        </div>
        <div className="stat card" data-testid="stat-paid-recently">
          <span className="stat-label">Paid (last 90 days)</span>
          <span className="stat-value">{formatMoney(summary.paid_last_90_days_cents, summary.currency)}</span>
          <span className="muted small">Successful payments</span>
        </div>
      </section>

      <section className="section" aria-labelledby="students-heading">
        <h2 id="students-heading">Students</h2>
        {data.students.length === 0 ? (
          <EmptyState title="No students linked" testId="students-empty">
            There are no students linked to your account yet. Contact your school to link a learner.
          </EmptyState>
        ) : (
          <div className="student-grid">
            {data.students.map((s) => (
              <article key={s.id} className="card student-card" data-testid={`student-card-${s.id}`}>
                <div className="student-avatar" aria-hidden="true">
                  {s.first_name[0]}
                  {s.last_name[0]}
                </div>
                <div className="student-info">
                  <h3 data-testid="student-name">{s.full_name}</h3>
                  <p className="muted small">
                    {s.grade} · {s.school_name}
                  </p>
                  <p className="muted small">Student no. {s.student_number}</p>
                </div>
                <div className="student-balance">
                  <span className="muted small">Outstanding</span>
                  <strong data-testid="student-outstanding">{formatMoney(s.outstanding_cents, s.currency)}</strong>
                  {s.overdue_cents > 0 && (
                    <span className="text-danger small">{formatMoney(s.overdue_cents, s.currency)} overdue</span>
                  )}
                  {s.next_due_date && <span className="muted small">Next due {formatDate(s.next_due_date)}</span>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="fees-heading">
        <div className="section-header">
          <h2 id="fees-heading">Outstanding fees</h2>
          {data.students.length > 1 && (
            <div className="inline-field">
              <label htmlFor="student-filter">Student</label>
              <select
                id="student-filter"
                value={studentFilter}
                onChange={(e) => setStudentFilter(e.target.value)}
                data-testid="outstanding-student-filter"
              >
                <option value="">All students</option>
                {data.students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {outstanding.loading ? (
          <Loading label="Loading fees…" testId="fees-loading" />
        ) : outstanding.error ? (
          <ErrorState error={outstanding.error} onRetry={outstanding.reload} />
        ) : outstanding.data!.items.length === 0 ? (
          <EmptyState title="You're all paid up 🎉" testId="fees-empty">
            There are no outstanding fees.
          </EmptyState>
        ) : (
          <div className="table-wrap card">
            <table className="table responsive-table" data-testid="outstanding-fees-table">
              <thead>
                <tr>
                  <th scope="col">Fee</th>
                  <th scope="col">Student</th>
                  <th scope="col">Due date</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Balance
                  </th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {outstanding.data!.items.map((f) => (
                  <tr key={f.id} data-testid={`fee-row-${f.id}`}>
                    <td data-label="Fee">
                      <Link to={`/fees/${f.id}`} data-testid="fee-link">
                        {f.description}
                      </Link>
                      <div className="muted small">{f.term}</div>
                    </td>
                    <td data-label="Student">{f.student_name}</td>
                    <td data-label="Due date">
                      {formatDate(f.due_date)}
                      <div className={`small ${f.is_overdue ? 'text-danger' : 'muted'}`}>{dueLabel(f.days_until_due)}</div>
                    </td>
                    <td data-label="Status">
                      <FeeStatusBadge status={f.status} overdue={f.is_overdue} />
                    </td>
                    <td data-label="Balance" className="num" data-testid="fee-balance">
                      {formatMoney(f.balance_cents, f.currency)}
                    </td>
                    <td className="actions">
                      <Link to={`/fees/${f.id}/pay`} className="btn btn-primary btn-sm" data-testid="pay-fee-button">
                        Pay
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Total</td>
                  <td className="num" data-testid="outstanding-total">
                    {formatMoney(outstanding.data!.total_outstanding_cents, outstanding.data!.currency)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="recent-heading">
        <div className="section-header">
          <h2 id="recent-heading">Recent payments</h2>
          <Link to="/transactions" data-testid="view-all-transactions">
            View all →
          </Link>
        </div>
        {data.recent_transactions.length === 0 ? (
          <EmptyState title="No payments yet" testId="recent-empty" />
        ) : (
          <ul className="card list" data-testid="recent-transactions">
            {data.recent_transactions.map((p) => (
              <li key={p.id}>
                <Link to={`/payments/${p.id}`} className="list-row" data-testid={`recent-transaction-${p.id}`}>
                  <div>
                    <strong>{p.fee_description}</strong>
                    <div className="muted small">
                      {p.student_name} · {formatDateTime(p.created_at)}
                    </div>
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
  );
}

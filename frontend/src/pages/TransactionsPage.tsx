import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/endpoints';
import type { PaymentStatus } from '../api/types';
import { EmptyState, ErrorState, Loading, PageHeader, PaymentStatusBadge } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { formatDateTime, formatMoney } from '../lib/format';

const STATUSES: PaymentStatus[] = ['SUCCEEDED', 'FAILED', 'PROCESSING', 'PENDING', 'CANCELLED'];
const PAGE_SIZES = [5, 10, 20, 50];

export function TransactionsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  // Filters live in the URL so they survive reloads and can be deep-linked.
  const status = (params.get('status') ?? '') as PaymentStatus | '';
  const studentId = params.get('student') ?? '';
  const dateFrom = params.get('from') ?? '';
  const dateTo = params.get('to') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = PAGE_SIZES.includes(Number(params.get('size'))) ? Number(params.get('size')) : 10;
  const dateRangeInvalid = !!dateFrom && !!dateTo && dateFrom > dateTo;

  const students = useApi((signal) => api.students(signal), []);
  const list = useApi(
    (signal) =>
      dateRangeInvalid
        ? Promise.resolve(null)
        : api.transactions({ status, studentId, dateFrom, dateTo, page, pageSize }, signal),
    [status, studentId, dateFrom, dateTo, page, pageSize, dateRangeInvalid],
  );

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  const hasFilters = !!(status || studentId || dateFrom || dateTo);
  const data = list.data;

  return (
    <div data-testid="transactions-page">
      <PageHeader title="Transactions" subtitle="All payments made from your account." />

      <form className="card filters" onSubmit={(e) => e.preventDefault()} data-testid="transaction-filters">
        <div className="field">
          <label htmlFor="filter-status">Status</label>
          <select id="filter-status" value={status} onChange={(e) => setFilter('status', e.target.value)} data-testid="filter-status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="filter-student">Student</label>
          <select id="filter-student" value={studentId} onChange={(e) => setFilter('student', e.target.value)} data-testid="filter-student">
            <option value="">All students</option>
            {students.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="filter-from">From</label>
          <input id="filter-from" type="date" value={dateFrom} onChange={(e) => setFilter('from', e.target.value)} data-testid="filter-date-from" />
        </div>
        <div className="field">
          <label htmlFor="filter-to">To</label>
          <input id="filter-to" type="date" value={dateTo} onChange={(e) => setFilter('to', e.target.value)} data-testid="filter-date-to" />
        </div>
        {hasFilters && (
          <button type="button" className="btn btn-secondary filters-clear" onClick={() => setParams(new URLSearchParams())} data-testid="clear-filters">
            Clear filters
          </button>
        )}
      </form>
      {dateRangeInvalid && (
        <p className="field-error" data-testid="date-range-error">
          "From" date must be on or before the "To" date.
        </p>
      )}

      {dateRangeInvalid ? null : list.loading ? (
        <Loading label="Loading transactions…" testId="transactions-loading" />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={hasFilters ? 'No transactions match your filters' : 'No transactions yet'} testId="transactions-empty" />
      ) : (
        <>
          <div className="table-wrap card">
            <table className="table responsive-table clickable-rows" data-testid="transactions-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Reference</th>
                  <th scope="col">Fee</th>
                  <th scope="col">Student</th>
                  <th scope="col">Method</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id} onClick={() => navigate(`/payments/${p.id}`)} data-testid={`transaction-row-${p.id}`}>
                    <td data-label="Date">{formatDateTime(p.created_at)}</td>
                    <td data-label="Reference">
                      <Link to={`/payments/${p.id}`} onClick={(e) => e.stopPropagation()} data-testid="transaction-link">
                        {p.reference}
                      </Link>
                    </td>
                    <td data-label="Fee">{p.fee_description}</td>
                    <td data-label="Student">{p.student_name}</td>
                    <td data-label="Method">{p.card_last4 ? `${p.card_brand} •••• ${p.card_last4}` : '—'}</td>
                    <td data-label="Status">
                      <PaymentStatusBadge status={p.status} />
                    </td>
                    <td data-label="Amount" className="num">
                      {formatMoney(p.amount_cents, p.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav className="pagination" aria-label="Pagination" data-testid="pagination">
            <span className="muted small" data-testid="pagination-summary">
              Showing {(data.page - 1) * data.page_size + 1}–{Math.min(data.page * data.page_size, data.total)} of {data.total}
            </span>
            <div className="pagination-controls">
              <label className="sr-only" htmlFor="page-size">
                Rows per page
              </label>
              <select id="page-size" value={pageSize} onChange={(e) => setFilter('size', e.target.value)} data-testid="page-size">
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setFilter('page', String(page - 1))}
                data-testid="prev-page"
              >
                Previous
              </button>
              <span data-testid="page-indicator">
                Page {data.page} of {Math.max(data.total_pages, 1)}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={page >= data.total_pages}
                onClick={() => setFilter('page', String(page + 1))}
                data-testid="next-page"
              >
                Next
              </button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}

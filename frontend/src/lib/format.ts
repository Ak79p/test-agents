const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(cents: number, currency = 'ZAR'): string {
  let fmt = moneyFormatters.get(currency);
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-ZA', { style: 'currency', currency, minimumFractionDigits: 2 });
    moneyFormatters.set(currency, fmt);
  }
  return fmt.format(cents / 100);
}

/** "2026-10-21" -> "21 Oct 2026" (date-only values are treated as calendar dates, not UTC instants). */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function dueLabel(daysUntilDue: number): string {
  if (daysUntilDue < 0) {
    const days = Math.abs(daysUntilDue);
    return `Overdue by ${days} day${days === 1 ? '' : 's'}`;
  }
  if (daysUntilDue === 0) return 'Due today';
  return `Due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`;
}

export function humanize(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Parses a rand amount typed by the user ("1 250,50" or "1250.50") into cents, or null if invalid. */
export function parseAmountToCents(input: string): number | null {
  const normalized = input.replace(/[\sR]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(parseFloat(normalized) * 100);
}

// Starter (not a catalogue case): authenticated, read-only parent journey.
// setup(): one login as PERF_USER_EMAIL (default loadtest001@example.com) → token shared with all VUs.
// Each iteration: GET /dashboard → GET /fees/outstanding → GET /fees/{first fee id} → GET /transactions?page_size=10.
// No payments, no resets, no simulation changes. Side effects: the single login writes one auth-token row; read
// endpoints may settle that parent's own due PROCESSING payments (none on a seeded loadtest account).
// Contracts from the OpenAPI schemas: LoginResponse, DashboardResponse, OutstandingFeesResponse, FeeDetail, TransactionList.
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { config, url } from '../../config/env.js';
import { resolveProfile, thresholds, thinkTime, SUMMARY_TREND_STATS } from '../../config/profiles.js';
import { authed, login } from '../../lib/auth.js';
import { summaryHandler } from '../../lib/summary.js';

const profile = resolveProfile();

export const options = {
  scenarios: { read_journey: profile.scenario },
  thresholds: thresholds('read_journey'),
  summaryTrendStats: SUMMARY_TREND_STATS,
  tags: { category: 'performance', suite: 'starter', script: 'read-journey' },
};

if (__VU === 0) {
  console.log(`[read-journey] target ${config.host} · account ${config.perfUserEmail} · profile ${profile.name}: ${profile.description}`);
}

export function setup() {
  return { token: login(config.perfUserEmail) };
}

export default function ({ token }) {
  let feeId;

  group('dashboard', () => {
    const res = http.get(url('/dashboard'), authed(token, 'GET /dashboard'));
    const body = res.status === 200 ? res.json() : null;
    check(res, {
      'dashboard: status 200': (r) => r.status === 200,
      'dashboard: has parent, summary, students': () => Boolean(body?.parent && body?.summary && Array.isArray(body?.students)),
    });
  });

  group('outstanding fees', () => {
    const res = http.get(url('/fees/outstanding'), authed(token, 'GET /fees/outstanding'));
    const body = res.status === 200 ? res.json() : null;
    check(res, {
      'fees/outstanding: status 200': (r) => r.status === 200,
      'fees/outstanding: count == items.length': () => Array.isArray(body?.items) && body.count === body.items.length,
      'fees/outstanding: totals are numbers': () => typeof body?.total_outstanding_cents === 'number' && typeof body?.overdue_cents === 'number',
    });
    feeId = body?.items?.[0]?.id;
  });

  group('fee detail', () => {
    if (!feeId) return; // a fully paid account has no outstanding fee to open; the checks above already record that
    const res = http.get(url(`/fees/${encodeURIComponent(feeId)}`), authed(token, 'GET /fees/{id}'));
    const body = res.status === 200 ? res.json() : null;
    check(res, {
      'fees/{id}: status 200': (r) => r.status === 200,
      'fees/{id}: same fee with payments list': () => body?.id === feeId && Array.isArray(body?.payments),
    });
  });

  group('transactions', () => {
    const res = http.get(url('/transactions?page_size=10'), authed(token, 'GET /transactions'));
    const body = res.status === 200 ? res.json() : null;
    check(res, {
      'transactions: status 200': (r) => r.status === 200,
      'transactions: page shape': () =>
        Array.isArray(body?.items) && typeof body?.total === 'number' && body?.page === 1 && body?.page_size === 10,
    });
  });

  sleep(thinkTime(profile.name));
}

export const handleSummary = summaryHandler('read-journey', profile, 'read_journey');

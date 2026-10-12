// Starter (not a catalogue case): unauthenticated API smoke against GET /api/v1/health.
// Low impact: smoke profile = 1 VU, 1 iteration by default. No login, no writes, no simulation changes.
// Contract (backend/app/routers/health.py, OpenAPI HealthResponse): 200 with
// { status: "ok", version, environment, database: "ok", timestamp }. Health is never delayed by the simulation.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { config, url } from '../../config/env.js';
import { resolveProfile, thresholds, thinkTime, SUMMARY_TREND_STATS } from '../../config/profiles.js';
import { summaryHandler } from '../../lib/summary.js';

const profile = resolveProfile();

export const options = {
  scenarios: { api_smoke: profile.scenario },
  thresholds: thresholds('api_smoke'),
  summaryTrendStats: SUMMARY_TREND_STATS,
  tags: { category: 'performance', suite: 'starter', script: 'api-smoke' },
};

if (__VU === 0) console.log(`[api-smoke] target ${config.host} · profile ${profile.name}: ${profile.description}`);

export default function () {
  const res = http.get(url('/health'), { tags: { name: 'GET /health' }, timeout: config.requestTimeout });
  const body = res.status === 200 ? res.json() : null;
  check(res, {
    'health: status 200': (r) => r.status === 200,
    'health: status "ok"': () => body?.status === 'ok',
    'health: database "ok"': () => body?.database === 'ok',
    'health: has version, environment, timestamp': () =>
      typeof body?.version === 'string' && typeof body?.environment === 'string' && typeof body?.timestamp === 'string',
  });
  sleep(thinkTime(profile.name));
}

export const handleSummary = summaryHandler('api-smoke', profile, 'api_smoke');

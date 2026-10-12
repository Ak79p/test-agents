// handleSummary builder: writes a machine-readable JSON summary and a human-readable Markdown report to
// config.resultsDir, and prints a short text summary. Use in a script:
//   export const handleSummary = summaryHandler('read-journey');
import { config } from '../config/env.js';

const fmtMs = (v) => (typeof v === 'number' ? `${v.toFixed(1)} ms` : 'n/a');
const fmtPct = (v) => (typeof v === 'number' ? `${(v * 100).toFixed(2)}%` : 'n/a');
const fmtNum = (v, digits = 2) => (typeof v === 'number' ? v.toFixed(digits) : 'n/a');

/**
 * Pulls the headline numbers out of k6's summary data (missing metrics stay undefined). HTTP numbers come
 * from the scenario-scoped sub-metrics (thresholds(scenario) creates them), so setup()/teardown() requests
 * such as the login are excluded; all-request totals remain in the JSON summary under k6.metrics.
 */
function headline(data, scenario) {
  const m = (name) => data.metrics[name]?.values ?? {};
  const scoped = (name) => data.metrics[`${name}{scenario:${scenario}}`]?.values ?? m(name);
  const duration = scoped('http_req_duration');
  const reqs = scoped('http_reqs');
  const failed = scoped('http_req_failed');
  const checks = m('checks');
  const iterations = m('iterations');
  return {
    requests: reqs.count,
    throughputPerSec: reqs.rate,
    errorRate: failed.rate,
    latencyMs: {
      avg: duration.avg,
      med: duration.med,
      p90: duration['p(90)'],
      p95: duration['p(95)'],
      p99: duration['p(99)'],
      max: duration.max,
    },
    checks: { passed: checks.passes, failed: checks.fails, rate: checks.rate },
    iterations: iterations.count,
    // Arrival-rate executors: iterations k6 could not start (target rate not reached). 0 when the metric is absent.
    droppedIterations: m('dropped_iterations').count ?? 0,
    vusMax: m('vus_max').max ?? m('vus_max').value,
  };
}

/** Every threshold with its pass/fail state, as k6 evaluated it. */
function thresholdResults(data) {
  const rows = [];
  for (const [metric, info] of Object.entries(data.metrics)) {
    for (const [expression, result] of Object.entries(info.thresholds ?? {})) {
      rows.push({ metric, expression, ok: result.ok });
    }
  }
  return rows;
}

function markdown(name, meta, h, thresholds) {
  const lines = [
    `# k6 report: ${name}`,
    '',
    `Generated ${meta.generatedAt}. Target host: \`${meta.host}\`. Profile: \`${meta.profile}\` (${meta.profileDescription}). ${meta.scope}.`,
    '',
    '## Thresholds (provisional until a baseline is measured)',
    '',
    '| Metric | Threshold | Result |',
    '|---|---|---|',
    ...thresholds.map((t) => `| \`${t.metric}\` | \`${t.expression}\` | ${t.ok ? 'PASS' : '**FAIL**'} |`),
    '',
    '## Results',
    '',
    '| Measure | Value |',
    '|---|---|',
    `| Requests | ${h.requests ?? 'n/a'} |`,
    `| Throughput | ${fmtNum(h.throughputPerSec)} req/s |`,
    `| Error rate (http_req_failed) | ${fmtPct(h.errorRate)} |`,
    `| Latency avg / median | ${fmtMs(h.latencyMs.avg)} / ${fmtMs(h.latencyMs.med)} |`,
    `| Latency p90 / p95 / p99 | ${fmtMs(h.latencyMs.p90)} / ${fmtMs(h.latencyMs.p95)} / ${fmtMs(h.latencyMs.p99)} |`,
    `| Latency max | ${fmtMs(h.latencyMs.max)} |`,
    `| Checks passed / failed | ${h.checks.passed ?? 'n/a'} / ${h.checks.failed ?? 'n/a'} (${fmtPct(h.checks.rate)}) |`,
    `| Iterations | ${h.iterations ?? 'n/a'} |`,
    `| Dropped iterations | ${h.droppedIterations} |`,
    `| Max VUs | ${h.vusMax ?? 'n/a'} |`,
    '',
    'Per-endpoint latency is in the JSON summary under `metrics` (`http_req_duration{name:…}`) when a script defines per-name thresholds.',
    '',
  ];
  return lines.join('\n');
}

/** Returns a handleSummary(data) function; `profile` is the resolved profile, `scenario` the workload scenario name. */
export function summaryHandler(name, profile, scenario) {
  return (data) => {
    const meta = {
      script: name,
      generatedAt: new Date().toISOString(),
      host: config.host,
      profile: profile.name,
      profileDescription: profile.description,
      scenario,
      scope: `HTTP numbers cover scenario ${scenario} only (setup/teardown requests excluded)`,
    };
    const h = headline(data, scenario);
    const thresholds = thresholdResults(data);
    const passed = thresholds.every((t) => t.ok);
    const base = `${config.resultsDir}/${name}`;
    const text = [
      '',
      `k6 summary: ${name}  ·  host ${meta.host}  ·  profile ${meta.profile} (${meta.profileDescription})`,
      `  requests ${h.requests ?? 'n/a'}  ·  ${fmtNum(h.throughputPerSec)} req/s  ·  errors ${fmtPct(h.errorRate)}  ·  checks ${fmtPct(h.checks.rate)}`,
      `  latency avg ${fmtMs(h.latencyMs.avg)}  med ${fmtMs(h.latencyMs.med)}  p90 ${fmtMs(h.latencyMs.p90)}  p95 ${fmtMs(h.latencyMs.p95)}  p99 ${fmtMs(h.latencyMs.p99)}`,
      `  iterations ${h.iterations ?? 'n/a'}  ·  dropped iterations ${h.droppedIterations}`,
      ...thresholds.map((t) => `  ${t.ok ? '✓' : '✗'} ${t.metric}: ${t.expression}`),
      `  thresholds ${passed ? 'PASSED' : 'FAILED'}  ·  files: ${base}-summary.json, ${base}-report.md`,
      '',
    ].join('\n');
    return {
      stdout: text,
      // setup_data holds whatever setup() returned (e.g. bearer tokens): never write it to disk.
      [`${base}-summary.json`]: JSON.stringify({ meta, headline: h, thresholds, passed, k6: { ...data, setup_data: '[redacted]' } }, null, 2),
      [`${base}-report.md`]: markdown(name, meta, h, thresholds),
    };
  };
}

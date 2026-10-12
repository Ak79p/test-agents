#!/usr/bin/env node
// Safe entry point for the npm perf:* scripts (tests/k6/package.json). No dependencies.
//
//   node run.mjs check      prerequisites + static validation (k6 version, `k6 inspect` of every script); runs no load
//   node run.mjs smoke      starter API smoke: GET /health, 1 VU × 1 iteration
//   node run.mjs read       starter read journey, PERF_PROFILE (default smoke); heavier profiles need PERF_ALLOW_LOAD=yes
//   node run.mjs baseline   read journey with the baseline profile (1 VU, 1 min); needs PERF_ALLOW_LOAD=yes
//   node run.mjs case <ID>  catalogue case scripts/<ID>.js (e.g. AUTH-PERF-001), PERF_PROFILE smoke (default) or
//                           case (the case's own workload; needs PERF_ALLOW_LOAD=yes and per-run approval)
//
// Before any run it loads tests/k6/.env (then TEST_USER_PASSWORD / API_BASE_URL from tests/playwright/.env when
// still unset; both files are git-ignored), refuses non-local hosts, checks the API is up, and prints the target
// host and the exact scenario k6 resolved from the script. Values of secrets are never printed.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SECRET_KEYS = ['TEST_USER_PASSWORD'];
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
const RUNS = {
  smoke: { script: 'scripts/starter/api-smoke.js', profile: () => 'smoke', needsPassword: false },
  read: { script: 'scripts/starter/read-journey.js', profile: () => process.env.PERF_PROFILE || 'smoke', needsPassword: true },
  baseline: { script: 'scripts/starter/read-journey.js', profile: () => 'baseline', needsPassword: true },
};

function parseEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !line.trimStart().startsWith('#')) out[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/** process.env, then tests/k6/.env, then selected keys from tests/playwright/.env (first non-empty wins). */
function loadEnv() {
  const env = { ...process.env };
  const sources = [
    [parseEnvFile(path.join(here, '.env')), null],
    [parseEnvFile(path.join(here, '..', 'playwright', '.env')), ['TEST_USER_PASSWORD', 'API_BASE_URL']],
  ];
  for (const [values, onlyKeys] of sources) {
    for (const [key, value] of Object.entries(values)) {
      if ((onlyKeys && !onlyKeys.includes(key)) || !value || env[key]) continue;
      env[key] = value;
    }
  }
  env.API_BASE_URL = (env.API_BASE_URL || 'http://127.0.0.1:8000/api/v1').replace(/\/+$/, '');
  return env;
}

function fail(message, code = 1) {
  console.error(`\n✗ ${message}\n`);
  process.exit(code);
}

function k6Version() {
  const res = spawnSync('k6', ['version'], { encoding: 'utf8' });
  if (res.error || res.status !== 0) return null;
  return res.stdout.trim().split('\n')[0];
}

function requireK6() {
  const version = k6Version();
  if (!version) {
    fail(
      'k6 is not installed or not on PATH.\n' +
        '  Windows: winget install k6 --source winget   (or choco install k6, or the MSI from https://github.com/grafana/k6/releases)\n' +
        '  macOS:   brew install k6\n' +
        '  Then open a new terminal and run: k6 version',
    );
  }
  return version;
}

function checkHost(env) {
  const host = new URL(env.API_BASE_URL).hostname.toLowerCase();
  const display = host.includes(':') ? `[${host}]` : host;
  if (!LOCAL_HOSTS.includes(display) && (env.PERF_ALLOWED_HOST || '').toLowerCase() !== display) {
    fail(`Refusing to target "${display}": local hosts only. Set PERF_ALLOWED_HOST=${display} only for an approved, non-production host you own.`);
  }
  return display;
}

async function apiIsUp(env) {
  try {
    const res = await fetch(`${env.API_BASE_URL}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Static validation: k6 parses the script and resolves its options without running it. */
function inspect(script, env) {
  // `k6 inspect` ignores system env vars unless asked; without this the shown profile could differ from the run.
  const res = spawnSync('k6', ['inspect', '--include-system-env-vars', script], { cwd: here, env, encoding: 'utf8' });
  if (res.status !== 0) return { ok: false, error: (res.stderr || res.stdout).trim().split('\n').slice(-3).join('\n') };
  try {
    return { ok: true, options: JSON.parse(res.stdout).options ?? JSON.parse(res.stdout) };
  } catch {
    return { ok: true, options: null };
  }
}

function describeEnv(env) {
  const keys = ['API_BASE_URL', 'PERF_USER_EMAIL', 'PERF_PROFILE', 'PERF_ALLOW_LOAD', 'PERF_ALLOWED_HOST', ...SECRET_KEYS];
  return keys.map((k) => `    ${k.padEnd(19)} ${SECRET_KEYS.includes(k) ? (env[k] ? '(set)' : '(missing)') : env[k] || '(default)'}`).join('\n');
}

async function check() {
  const env = loadEnv();
  console.log(`k6: ${requireK6()}`);
  const host = checkHost(env);
  console.log(`target: ${env.API_BASE_URL} (host ${host})\nenvironment:\n${describeEnv(env)}`);
  const scripts = [
    ...Object.values(RUNS).map((r) => r.script),
    ...readdirSync(path.join(here, 'scripts')).filter((f) => f.endsWith('.js')).map((f) => `scripts/${f}`),
  ].filter((s, i, all) => all.indexOf(s) === i);
  let failures = 0;
  for (const script of scripts) {
    const result = inspect(script, { ...env, PERF_PROFILE: 'smoke' });
    console.log(`  ${result.ok ? '✓' : '✗'} k6 inspect ${script}${result.ok ? '' : `\n      ${result.error}`}`);
    if (!result.ok) failures++;
  }
  const up = await apiIsUp(env);
  console.log(`  ${up ? '✓' : '!'} API ${up ? 'reachable' : 'NOT reachable (start it: scripts\\start-backend.ps1)'} at ${env.API_BASE_URL}/health`);
  console.log(`  ${env.TEST_USER_PASSWORD ? '✓' : '!'} TEST_USER_PASSWORD ${env.TEST_USER_PASSWORD ? 'set' : 'missing (needed by perf:read / perf:baseline)'}`);
  if (failures) fail(`${failures} script(s) failed static validation.`);
  console.log('\nperf:check passed (static checks only; no load was generated).');
}

/** Catalogue case run: validates the ID and that scripts/<ID>.js exists; smoke unless PERF_PROFILE says otherwise. */
function caseSpec(id) {
  if (!/^[A-Z]+-PERF-\d{3}$/.test(id || '')) fail('Usage: node run.mjs case <AREA>-PERF-NNN   (e.g. npm run perf:case -- AUTH-PERF-001)');
  const script = `scripts/${id}.js`;
  if (!existsSync(path.join(here, script))) fail(`No script for ${id}: ${script} does not exist.`);
  return { script, profile: () => process.env.PERF_PROFILE || 'smoke', needsPassword: true };
}

async function run(spec) {
  const env = loadEnv();
  env.PERF_PROFILE = spec.profile();
  const version = requireK6();
  const host = checkHost(env);
  if (spec.needsPassword && !env.TEST_USER_PASSWORD) {
    fail('TEST_USER_PASSWORD is not set. Put it in tests/k6/.env (copy env.example) or tests/playwright/.env.');
  }
  // Resolve the profile through the script itself, so the opt-in guard and the shown scenario are k6's own.
  const resolved = inspect(spec.script, env);
  if (!resolved.ok) fail(`The script refused to start:\n  ${resolved.error}`);
  const scenarios = resolved.options?.scenarios ?? {};
  console.log(
    [
      '',
      `┌ k6 run  (${version})`,
      `│ script   ${spec.script}`,
      `│ target   ${env.API_BASE_URL}  (host ${host})`,
      `│ profile  ${env.PERF_PROFILE}${env.PERF_PROFILE === 'smoke' ? '  (low impact)' : '  (OPT-IN LOAD: PERF_ALLOW_LOAD=yes)'}`,
      ...Object.entries(scenarios).map(([key, s]) => `│ scenario ${key}: ${JSON.stringify(s)}`),
      `│ results  tests/k6/${(env.PERF_RESULTS_DIR || 'results').replace(/\/+$/, '')}/`,
      '└',
    ].join('\n'),
  );
  if (!(await apiIsUp(env))) fail(`API not reachable at ${env.API_BASE_URL}/health. Start it: scripts\\start-backend.ps1`);
  mkdirSync(path.join(here, env.PERF_RESULTS_DIR || 'results'), { recursive: true });
  const res = spawnSync('k6', ['run', '--no-usage-report', spec.script], { cwd: here, env, stdio: 'inherit' });
  if (res.error) fail(`Could not start k6: ${res.error.message}`);
  process.exit(res.status ?? 1);
}

const command = process.argv[2];
if (command === 'check') await check();
else if (command === 'case') await run(caseSpec(process.argv[3]));
else if (RUNS[command]) await run(RUNS[command]);
else fail('Usage: node run.mjs check | smoke | read | baseline | case <ID>');

import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { env } from './config/env';

const repoRoot = path.resolve(__dirname, '..', '..');
const isWindows = process.platform === 'win32';

/**
 * Projects
 *  - api          → tests in ./api, baseURL = API_BASE_URL (use relative paths: request.get('fees/outstanding'))
 *  - ui-chromium  → tests in ./ui, baseURL = BASE_URL, desktop viewport
 *  - ui-mobile    → tests in ./ui tagged @mobile, phone viewport
 *  - hybrid       → tests in ./hybrid that need both the browser and direct API calls
 *                   (baseURL = BASE_URL; create API contexts with env.apiBaseUrl)
 *
 * Test titles must start with their catalogue ID (e.g. "PAY-API-003 ...") so a single
 * case can be run with: npx playwright test --grep PAY-API-003
 */
export default defineConfig({
  testDir: '.',
  outputDir: 'test-results',
  // One shared SQLite database backs the app; keep execution serial unless tests isolate their data.
  fullyParallel: false,
  workers: env.workers,
  forbidOnly: env.isCI,
  retries: env.isCI ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },

  projects: [
    {
      name: 'api',
      testDir: './api',
      use: {
        baseURL: env.apiBaseUrl,
        extraHTTPHeaders: { Accept: 'application/json' },
      },
    },
    {
      name: 'ui-chromium',
      testDir: './ui',
      grepInvert: /@mobile/,
      use: {
        ...devices['Desktop Chrome'],
        channel: env.browserChannel,
        baseURL: env.baseUrl,
      },
    },
    {
      name: 'ui-mobile',
      testDir: './ui',
      grep: /@mobile/,
      use: {
        ...devices['Pixel 7'],
        channel: env.browserChannel,
        baseURL: env.baseUrl,
      },
    },
    {
      name: 'hybrid',
      testDir: './hybrid',
      use: {
        ...devices['Desktop Chrome'],
        channel: env.browserChannel,
        baseURL: env.baseUrl,
      },
    },
  ],

  // Opt-in (PW_START_SERVERS=true): start the app if it is not already running.
  webServer: env.startServers
    ? [
        {
          command: isWindows ? '.venv\\Scripts\\python.exe run.py' : '.venv/bin/python run.py',
          cwd: path.join(repoRoot, 'backend'),
          url: `${env.apiBaseUrl}health`,
          reuseExistingServer: true,
          timeout: 60_000,
        },
        {
          command: 'npm run dev',
          cwd: path.join(repoRoot, 'frontend'),
          url: env.baseUrl,
          reuseExistingServer: true,
          timeout: 60_000,
        },
      ]
    : undefined,
});

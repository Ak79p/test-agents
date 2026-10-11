const env = import.meta.env;

export const config = {
  apiBaseUrl: (env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api/v1').replace(/\/$/, ''),
  pollIntervalMs: Number(env.VITE_PAYMENT_POLL_INTERVAL_MS || 1500),
  pollTimeoutMs: Number(env.VITE_PAYMENT_POLL_TIMEOUT_MS || 120000),
  showTestCards: (env.VITE_SHOW_TEST_CARDS ?? 'true') !== 'false',
};

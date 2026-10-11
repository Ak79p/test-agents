/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_PAYMENT_POLL_INTERVAL_MS?: string;
  readonly VITE_PAYMENT_POLL_TIMEOUT_MS?: string;
  readonly VITE_SHOW_TEST_CARDS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

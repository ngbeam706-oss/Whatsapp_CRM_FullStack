// End-to-end smoke tests (Playwright). Run: npm run e2e
//
// By default they run against a local copy: the API (npm run server, port 3000, using .env) and the
// production build (vite preview, port 4173, which forwards /api to the API like Netlify does).
// Set E2E_BASE_URL to test another address instead, e.g. a deploy preview.
//
// Signed-in tests need a TEST login (never a real staff member's password) in .env:
//   E2E_EMAIL=...      E2E_PASSWORD=...
// Without them only the signed-out checks run. See e2e/README.md.
import { defineConfig } from '@playwright/test';

const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  timeout: 45000,
  retries: 0,
  workers: 1, // one login at a time, gentle on the real Supabase project
  reporter: [['list']],
  use: {
    baseURL: external || 'http://localhost:4173',
    // Microsoft Edge that comes with Windows: no separate browser download needed.
    channel: process.env.E2E_BROWSER_CHANNEL || 'msedge',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // A fake microphone (no prompt, no real device) for the call tests; harmless for the rest.
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  },
  webServer: external ? undefined : [
    { command: 'npm run server', url: 'http://localhost:3000/api/health', reuseExistingServer: true, timeout: 60000 },
    { command: 'npm run build && npm run preview -- --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 120000 },
  ],
});

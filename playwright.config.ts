import { defineConfig } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * Deliberately separate from Vitest rather than folded into it. These tests
 * launch a real browser with the real built extension and take seconds each,
 * where the 1,179 unit tests take about twenty seconds in total — mixing them
 * would make the fast suite slow and nobody would run it on every save.
 *
 * Run with `npm run e2e`, after `npm run build`.
 */
export default defineConfig({
  testDir: './e2e',
  // Extensions load into a persistent profile, and parallel workers would each
  // want their own. One worker keeps that simple and the suite is small.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // A test that only passes on the third go is a flaky test, and a flaky
  // security check is worse than no check — it teaches people to ignore red.
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});

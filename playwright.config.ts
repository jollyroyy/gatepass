import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// The e2e suite signs in as real Supabase users against the real project, so it
// needs the same .env the app does — `E2E_PASSWORD` for the cast, and
// `SUPABASE_DB_URL`/`SUPABASE_SERVICE_ROLE_KEY` for global setup's seeding.
dotenv.config();

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5174';

export default defineConfig({
  testDir: './tests/e2e',
  // Vitest owns tests/unit and tests/security; Playwright owns tests/e2e alone.
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  // Every worker drives the SAME Supabase project. Four is enough parallelism to
  // keep a full run under a few minutes and few enough that two workers rarely
  // race for the same pass row.
  workers: process.env.CI ? 2 : 4,
  // A lifecycle fixture is a whole business process, not a click: raise a pass,
  // then sign it through three approval offices in three separate browser
  // contexts. That is ~40s on a quiet machine and more under parallel workers,
  // so a 45s budget failed setup hooks that were working perfectly.
  timeout: 150_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  globalSetup: './tests/e2e/global-setup.ts',

  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // The QR scan path calls getUserMedia, which needs a secure context and a
    // camera. localhost is a secure context; the permission still has to be
    // granted or the browser prompts and the test hangs.
    permissions: ['camera'],
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  },

  projects: [
    // One sign-in per role, once, into tests/e2e/.state/<role>.json.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

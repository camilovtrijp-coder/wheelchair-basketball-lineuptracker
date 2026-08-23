import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

// Losse config van playwright.config.ts: deze suite draait tegen de echte
// Firebase Auth-/Firestore-emulator (via `firebase emulators:exec` in CI, zie
// .github/workflows/ci.yml's v2-auth-e2e-job) en de tests seeden/muteren
// gedeelde emulatordata (firebase/scripts/seed.ts, en zelfstandige fixtures
// via tests/e2e-auth/adminFixtures.ts) — bewust serieel, niet parallel of met
// retries, om races en verwarrende dubbele mutaties te voorkomen.
export default defineConfig({
  testDir: './tests/e2e-auth',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-auth' }]],
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run preview:e2e',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 120_000,
  },
});

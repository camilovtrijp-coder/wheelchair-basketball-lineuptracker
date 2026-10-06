import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

// Losse config van playwright.config.ts: deze suite draait tegen de echte
// Firebase Auth-/Firestore-emulator (via `firebase emulators:exec` in CI, zie
// .github/workflows/ci.yml's v2-auth-e2e-job) en de tests seeden/muteren
// gedeelde emulatordata (firebase/scripts/seed.ts, en zelfstandige fixtures
// via tests/e2e-auth/adminFixtures.ts) — bewust serieel en niet parallel, om
// races te voorkomen. Retries: lokaal 0; in CI één (besluit eigenaar 6 oktober
// 2026, na de root-cause-fixes uit #100/#101). Een test die pas bij de retry
// slaagt, staat als 'flaky' in de list-uitvoer en in het HTML-rapport en moet
// als bevinding worden behandeld, niet als groen zonder meer. Meer dan één retry
// kan een echte race verbergen.
export default defineConfig({
  testDir: './tests/e2e-auth',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
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

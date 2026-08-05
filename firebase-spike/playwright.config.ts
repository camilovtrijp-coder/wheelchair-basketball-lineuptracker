import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 0,
  // Beide tests schrijven naar hetzelfde settings-document; parallel uitvoeren geeft state-conflict.
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:5183',
    headless: true,
    // Chromium is voorgeïnstalleerd in de CCR-omgeving; executablePath overschrijft de versie-check.
    ...devices['Desktop Chrome'],
    launchOptions: {
      executablePath: '/opt/pw-browsers/chromium',
    },
  },
  webServer: {
    command: 'npx vite --config browser-harness/vite.config.ts',
    url: 'http://127.0.0.1:5183',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

import { defineConfig, devices } from '@playwright/test';
import * as fs from 'fs';

// Gebruik de CI/CCR-systeeminstallatie als die bestaat; anders laat Playwright de standaard
// ontdekking doen (na "npx playwright install chromium" of via PLAYWRIGHT_BROWSERS_PATH).
const ccrChromiumPath = '/opt/pw-browsers/chromium';
const chromiumExecutable = fs.existsSync(ccrChromiumPath) ? ccrChromiumPath : undefined;

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
    ...devices['Desktop Chrome'],
    launchOptions: {
      ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
    },
  },
  webServer: {
    command: 'npx vite --config browser-harness/vite.config.ts',
    url: 'http://127.0.0.1:5183',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

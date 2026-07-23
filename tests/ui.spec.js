const { test, expect } = require('@playwright/test');
const path = require('path');

test('Lineup Tracker UI visual test', async ({ page }) => {
  const filePath = 'file://' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');
  await page.goto(filePath);

  // 1. Initial Roster tab
  await page.screenshot({ path: 'tests/screenshots/1-team-roster.png', fullPage: true });

  // 2. Go to Match tab
  const matchTab = page.locator('.tabbtn', { hasText: 'Wedstrijd' });
  await matchTab.click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/screenshots/2-pregame-match.png', fullPage: true });

  // Start match if ready
  const startBtn = page.locator('#startbtn');
  if (await startBtn.isVisible() && await startBtn.isEnabled()) {
    await startBtn.click();
    await page.waitForTimeout(300);
    
    // Screenshot live match tracking view
    await page.screenshot({ path: 'tests/screenshots/3-live-match.png', fullPage: true });

    // Click on first court player chip to activate swap mode & pulse animation
    const firstChip = page.locator('.chip').first();
    if (await firstChip.isVisible()) {
      await firstChip.click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: 'tests/screenshots/4-swap-mode-pulse.png', fullPage: true });
    }
  }

  // 3. Stats tab
  const statsTab = page.locator('.tabbtn', { hasText: 'Stats' });
  await statsTab.click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/screenshots/5-stats-tab.png', fullPage: true });
});

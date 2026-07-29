const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  seedRunningMatch,
  seedFullTeam,
  seedEmpty,
  buildBackup,
  readLocalStorage,
  SMALL_GAME_PLAYERS,
  SMALL_GAME_SETTINGS,
  STORAGE_KEY,
  ROSTER_KEY,
  SETTINGS_KEY,
  LANG_KEY,
  GAMES_KEY
} = require('./fixtures');

/**
 * Schrijft een backup object naar een tijdelijk JSON bestand.
 */
function writeTempBackup(backup) {
  const filePath = path.join(os.tmpdir(), `lineup-tracker-test-backup-${Date.now()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2));
  return filePath;
}

test.describe('Hervatten, back-up en import', () => {
  test('herlaadt pagina met lopende wedstrijd en hervat', async ({ page }) => {
    await seedRunningMatch(page);

    // Resume modal verschijnt bij herladen
    await expect(page.locator('text=Opgeslagen wedstrijd gevonden')).toBeVisible();
    await expect(page.locator('text=1 segment')).toBeVisible();

    // Klik hervatten
    await page.locator('button:has-text("Hervatten")').click();

    // We zijn terug in tracking view met de juiste score
    await expect(page.locator('select.scoresel.amber')).toHaveValue('4');
    await expect(page.locator('select.scoresel.sky')).toHaveValue('2');
    await expect(page.locator('text=Op de vloer (5)')).toBeVisible();
    await expect(page.locator('text=Segmenten (1)')).toBeVisible();
  });

  test('exporteert een volledige JSON back-up', async ({ page }) => {
    await seedFullTeam(page);

    // Open instellingen
    await page.locator('button:has-text("⚙")').click();

    // Start download
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button:has-text("Exporteer alle data")').click()
    ]);

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    const content = fs.readFileSync(downloadPath, 'utf-8');
    const backup = JSON.parse(content);

    expect(backup.type).toBe('lineup-tracker-backup');
    expect(backup.version).toBe(1);
    expect(backup.exportedAt).toBeTruthy();
    expect(backup.data).toBeTruthy();

    // Alle verwachte keys aanwezig
    expect(backup.data[ROSTER_KEY]).toEqual(SMALL_GAME_PLAYERS);
    expect(backup.data[SETTINGS_KEY]).toEqual(SMALL_GAME_SETTINGS);
    expect(backup.data[LANG_KEY]).toBe('nl');
    expect(backup.data[GAMES_KEY]).toHaveLength(1);
  });

  test('importeert back-up in een lege browsercontext', async ({ page }) => {
    await seedEmpty(page);

    // Bevestig dat we leeg beginnen
    const before = await readLocalStorage(page);
    expect(Object.keys(before).length).toBe(0);

    // Maak een backup bestand
    const backup = buildBackup({
      roster: SMALL_GAME_PLAYERS,
      settings: SMALL_GAME_SETTINGS,
      lang: 'nl',
      games: []
    });
    const backupFile = writeTempBackup(backup);

    page.on('dialog', dialog => dialog.accept());

    // Open instellingen
    await page.locator('button:has-text("⚙")').click();

    // Upload backup; app herlaadt na import
    await Promise.all([
      page.waitForNavigation(),
      page.setInputFiles('#backupFileInput', backupFile)
    ]);
    await page.waitForLoadState('networkidle');

    // Controleer dat data hersteld is
    const after = await readLocalStorage(page);
    expect(JSON.parse(after[ROSTER_KEY])).toEqual(SMALL_GAME_PLAYERS);
    expect(JSON.parse(after[SETTINGS_KEY])).toEqual(SMALL_GAME_SETTINGS);
    expect(after[LANG_KEY]).toBe('nl');

    // Team tab toont de geïmporteerde spelers
    await page.locator('.tabbtn', { hasText: 'Team' }).click();
    const names = await page.locator('input[placeholder="Naam"]').evaluateAll(els => els.map(el => el.value));
    expect(names).toEqual(SMALL_GAME_PLAYERS.map(p => p.naam));

    fs.unlinkSync(backupFile);
  });

  test('wijst ongeldige JSON af zonder bestaande data te beschadigen', async ({ page }) => {
    await seedFullTeam(page);

    // Lees huidige data
    const before = await readLocalStorage(page);
    expect(before[ROSTER_KEY]).toBeTruthy();

    // Maak een ongeldig backup bestand
    const invalidFile = path.join(os.tmpdir(), `lineup-tracker-invalid-${Date.now()}.json`);
    fs.writeFileSync(invalidFile, '{"type":"lineup-tracker-backup","version":1,"data":"broken"}');

    // Dialog handler: accepteer import vraag, maar we verwachten een alert voor ongeldige JSON
    page.on('dialog', async dialog => {
      if (dialog.type() === 'confirm') {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });

    // Open instellingen
    await page.locator('button:has-text("⚙")').click();

    // Upload ongeldige backup
    await page.setInputFiles('#backupFileInput', invalidFile);

    // Data moet intact blijven
    const after = await readLocalStorage(page);
    expect(after[ROSTER_KEY]).toEqual(before[ROSTER_KEY]);
    expect(after[GAMES_KEY]).toEqual(before[GAMES_KEY]);

    // Alert moet getoond zijn (Playwright dialog handler dismissed deze)
    fs.unlinkSync(invalidFile);
  });
});

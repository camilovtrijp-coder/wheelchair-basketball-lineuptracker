const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  seedApp,
  appUrl,
  TEST_PLAYERS,
  SMALL_GAME_PLAYERS,
  SMALL_GAME_SETTINGS,
  buildBackup,
  seedEmpty,
  readLocalStorage,
  ROSTER_KEY,
  GAMES_KEY,
  SETTINGS_KEY,
  LANG_KEY,
  STORAGE_KEY
} = require('./fixtures');

const MOBILE_VIEWPORT = { width: 390, height: 844 };

/**
 * Stelt cumulatieve score en eindtijd in en slaat een segment op.
 * Begin staat standaard op 10:00, eind teveel opgegeven.
 */
async function saveSegment(page, { endTime, scoreFor, scoreAgainst }) {
  await page.locator('select.scoresel.amber').selectOption(String(scoreFor));
  await page.locator('select.scoresel.sky').selectOption(String(scoreAgainst));
  const [endMin, endSec] = endTime.split(':').map(s => String(parseInt(s, 10)));
  const timeSelects = page.locator('select.timesel');
  await timeSelects.nth(2).selectOption(endMin);
  await timeSelects.nth(3).selectOption(endSec);
  await page.locator('button:has-text("Segment opslaan")').click();
}

/**
 * Bevestig een wissel opgegeven kloktijd.
 */
async function confirmSwap(page, endTime) {
  await page.locator('button:has-text("Klaar met wisselen")').click();
  const swapModal = page.locator('.modal').filter({ hasText: 'Wissel(s) — kloktijd?' });
  await expect(swapModal).toBeVisible();
  const [endMin, endSec] = endTime.split(':').map(s => String(parseInt(s, 10)));
  const swapSelects = swapModal.locator('select');
  await swapSelects.first().selectOption(endMin);
  await swapSelects.nth(1).selectOption(endSec);
  await swapModal.locator('button:has-text("Bevestigen")').click();
}

test.describe('PR 1.6 - fase-1-dekking', () => {
  test('meerdere gelijktijdige wissels in één bevestigingsronde', async ({ page }) => {
    await seedApp(page);
    await page.locator('.tabbtn', { hasText: 'Wedstrijd' }).click();
    await page.locator('#startbtn').click();

    // Startopstelling: 1,2,3,4,5 (Anna,Bram,Cara,Dirk,Eva)
    // Eerste wissel: Anna(#4, id1) <-> Finn(#21, id6)
    await page.getByRole('button', { name: /Anna/ }).first().click();
    await page.getByRole('button', { name: /Finn/ }).first().click();
    // Tweede wissel zonder te bevestigen: Bram(#7, id2) <-> Gijs(#33, id7)
    await page.getByRole('button', { name: /Bram/ }).first().click();
    await page.getByRole('button', { name: /Gijs/ }).first().click();

    // Bevestig beide wissels in één segment
    await confirmSwap(page, '8:00');

    // Segment opgeslagen met oude opstelling (1,2,3,4,5)
    await expect(page.locator('text=Segmenten (1)')).toBeVisible();

    // Nieuwe opstelling op het veld: #4 en #7 zijn vervangen door #21 en #33
    // Veld = origineel [4,7,9,11,14] minus {4,7} plus {21,33} => [9,11,14,21,33]
    const courtNrs = await page.locator('.grid5').first().locator('.chip .nr').evaluateAll(els => els.map(el => el.textContent.trim()));
    expect(courtNrs.sort()).toEqual(['11', '14', '21', '33', '9']);
  });

  test('wissel op nul seconden maakt geen leeg segment', async ({ page }) => {
    await seedApp(page);
    await page.locator('.tabbtn', { hasText: 'Wedstrijd' }).click();
    await page.locator('#startbtn').click();

    // Sla eerst een echt segment op zodat begin op 8:00 staat
    await saveSegment(page, { endTime: '8:00', scoreFor: 4, scoreAgainst: 2 });
    await expect(page.locator('text=Segmenten (1)')).toBeVisible();

    // Wissel Anna(#4) <-> Finn(#21) en bevestig op dezelfde kloktijd 8:00 (0 seconden)
    await page.getByRole('button', { name: /Anna/ }).first().click();
    await page.getByRole('button', { name: /Finn/ }).first().click();
    await confirmSwap(page, '8:00');

    // Er mag géén nieuw segment zijn bijgevoegd (duur 0 wordt overgeslagen)
    await expect(page.locator('text=Segmenten (1)')).toBeVisible();
  });

  test('deelnemers en vijf starters expliciet kiezen', async ({ page }) => {
    await seedApp(page);
    await page.locator('.tabbtn', { hasText: 'Wedstrijd' }).click();

    // 8 deelnemers standaard aan; zet Finn(#21), Gijs(#33), Hana(#55) op niet-meedaan
    // Elke spelerrij is een .card met tekst "#<nr> <naam>"; de "Meedoen"-toggle is de eerste toggle-knop
    for (const naam of ['Finn', 'Gijs', 'Hana']) {
      const row = page.locator('.card.row.between').filter({ hasText: new RegExp('#\\d+ ' + naam) });
      await row.locator('button.toggle').first().click();
    }

    // Kies 5 expliciete starters: Anna,Bram,Cara,Dirk,Eva (Start-toggle = 2e toggle)
    for (const naam of ['Anna', 'Bram', 'Cara', 'Dirk', 'Eva']) {
      const row = page.locator('.card.row.between').filter({ hasText: new RegExp('#\\d+ ' + naam) });
      await row.locator('button.toggle').nth(1).click();
    }

    // Startknop moet enabled zijn
    await expect(page.locator('#startbtn')).toBeEnabled();

    // Start en controleer dat precies deze 5 op het veld staan
    await page.locator('#startbtn').click();
    const courtNrs = await page.locator('.grid5 .chip .nr').evaluateAll(els => els.map(el => el.textContent.trim()));
    expect(courtNrs.sort()).toEqual(['11', '14', '4', '7', '9']);
  });

  test('geïmporteerde historie zichtbaar in de interface', async ({ page }) => {
    await seedEmpty(page);

    // Bouw backup met één afgeronde wedstrijd
    const roster = SMALL_GAME_PLAYERS;
    const settings = SMALL_GAME_SETTINGS;
    const game = {
      id: 'g-imported-1',
      opponent: 'Geïmporteerd Team',
      competition: 'Importcompetitie',
      date: '2025-01-15T12:00:00.000Z',
      players: roster,
      segments: [{
        quarter: 1, beginSec: 600, endSec: 540, durSec: 60,
        lineup: roster.map(p => p.id),
        pf: 10, pa: 3, classSum: 0, allowed: 0, over: false
      }],
      scoreFor: 10, scoreAgainst: 3,
      quarterCount: settings.quarterCount, periodLabel: settings.periodLabel, useClassLimit: settings.useClassLimit
    };
    const backup = buildBackup({ roster, settings, lang: 'nl', games: [game] });
    const backupFile = path.join(os.tmpdir(), `lineup-tracker-import-history-${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(backup));

    page.on('dialog', dialog => dialog.accept());

    await page.locator('button:has-text("⚙")').click();
    await Promise.all([
      page.waitForNavigation(),
      page.setInputFiles('#backupFileInput', backupFile)
    ]);
    await page.waitForLoadState('networkidle');

    // Historie tab toont de geïmporteerde wedstrijd
    await page.locator('.tabbtn', { hasText: 'Historie' }).click();
    await expect(page.locator('text=Geïmporteerd Team')).toBeVisible();
    await expect(page.locator('text=Importcompetitie')).toBeVisible();
    await expect(page.locator('text=10 - 3')).toBeVisible();

    fs.unlinkSync(backupFile);
  });

  test('Engelse foutmelding bij ongeldige back-up', async ({ page }) => {
    await seedApp(page);
    // Wissel naar Engels
    await page.getByRole('button', { name: 'EN', exact: true }).click();

    // Maak syntactisch ongeldig bestand
    const invalidFile = path.join(os.tmpdir(), `lineup-invalid-en-${Date.now()}.json`);
    fs.writeFileSync(invalidFile, 'dit is geen json {[');

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    await page.locator('button:has-text("⚙")').click();
    await page.setInputFiles('#backupFileInput', invalidFile);

    // Wacht tot de alert daadwerkelijk is verschenen (FileReader is async)
    await expect.poll(() => dialogs.filter(d => d.type === 'alert').length, { timeout: 5000 }).toBe(1);
    expect(dialogs.find(d => d.type === 'alert').message).toContain("doesn't look like a valid Lineup Tracker backup");

    // Geen confirm-dialoog geweest
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(0);

    fs.unlinkSync(invalidFile);
  });

  test('touch-viewport: segment opslaan via tap op mobiel', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await seedApp(page);
    await page.locator('.tabbtn', { hasText: 'Wedstrijd' }).click();
    await page.locator('#startbtn').click();

    // Tap +1 eigen team (touch via click op mobiele viewport)
    await page.locator('button:has-text("+1")').first().click();
    await expect(page.locator('select.scoresel.amber')).toHaveValue('1');

    // Stel eindtijd in en sla segment op
    await saveSegment(page, { endTime: '8:00', scoreFor: 1, scoreAgainst: 0 });
    await expect(page.locator('text=Segmenten (1)')).toBeVisible();
  });

  test('lineupcode bevat vijf oplopend gesorteerde rugnummers', async ({ page }) => {
    await seedApp(page);
    await page.locator('.tabbtn', { hasText: 'Wedstrijd' }).click();
    await page.locator('#startbtn').click();
    await saveSegment(page, { endTime: '8:00', scoreFor: 4, scoreAgainst: 2 });

    // Exporteer CSV en controleer de lineupcode-kolom
    await page.locator('button:has-text("Alleen CSV exporteren")').click();
    const exportModal = page.locator('.modal').filter({ hasText: 'Export' });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportModal.locator('button:has-text("Deel / download CSV")').click()
    ]);
    const csv = fs.readFileSync(await download.path(), 'utf-8');
    const lines = csv.split('\n');
    // Header bevat "Lineup code"; eerste data-regel bevat oplopende codes
    const headerIdx = lines.findIndex(l => l.includes('Lineup code'));
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    const dataLine = lines[headerIdx + 1];
    // Laatste kolom = lineupcode "4-7-9-11-14"
    const code = dataLine.trim().split(',').pop();
    expect(code).toBe('4-7-9-11-14');
    const parts = code.split('-');
    expect(parts).toHaveLength(5);
    expect(parts.map(Number)).toEqual(parts.map(Number).sort((a, b) => a - b));
  });

  test('speler-minuten = vijf maal gespeelde wedstrijdminuten', async ({ page }) => {
    await seedApp(page);
    await page.locator('.tabbtn', { hasText: 'Wedstrijd' }).click();
    await page.locator('#startbtn').click();

    // 3 segmenten van elk 2:00 = 6:00 wedstrijdminuten per speler
    await saveSegment(page, { endTime: '8:00', scoreFor: 4, scoreAgainst: 2 });
    await saveSegment(page, { endTime: '6:00', scoreFor: 7, scoreAgainst: 5 });
    await page.locator('.q').filter({ hasText: '2' }).click();
    await saveSegment(page, { endTime: '8:00', scoreFor: 13, scoreAgainst: 11 });

    // Totale speeltijd = 6:00 = 360 s; 5 spelers => 1800 speler-seconden
    // Exporteer CSV "Speeltijd per speler" sectie en sommeer
    await page.locator('button:has-text("Alleen CSV exporteren")').click();
    const exportModal = page.locator('.modal').filter({ hasText: 'Export' });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportModal.locator('button:has-text("Deel / download CSV")').click()
    ]);
    const csv = fs.readFileSync(await download.path(), 'utf-8');
    // Sectie "Speeltijd per speler" met kolom "Seconden"
    const minutesSection = csv.split('Speeltijd per speler')[1] || '';
    const rows = minutesSection.split('\n').filter(r => r.trim() && !r.startsWith('Speler'));
    const totalPlayerSeconds = rows.reduce((sum, r) => {
      const cols = r.split(',');
      // Kolom "Seconden" is de een-na-laatste (voor "Aantal beurten")
      return sum + Number(cols[cols.length - 2]);
    }, 0);
    // 5 spelers × 360 s = 1800
    expect(totalPlayerSeconds).toBe(1800);
  });

  test('plus/min = punten voor min punten tegen (expliciet)', async ({ page }) => {
    await seedApp(page);
    await page.locator('.tabbtn', { hasText: 'Wedstrijd' }).click();
    await page.locator('#startbtn').click();

    // Segment 1: pf=4, pa=2 => pm=+2
    await saveSegment(page, { endTime: '8:00', scoreFor: 4, scoreAgainst: 2 });
    // Segment 2: pf=8-4=4, pa=4-2=2 => pm=+2, totaal +4
    await saveSegment(page, { endTime: '6:00', scoreFor: 8, scoreAgainst: 4 });

    // Exporteer CSV en controleer Plusminus-kolom
    await page.locator('button:has-text("Alleen CSV exporteren")').click();
    const exportModal = page.locator('.modal').filter({ hasText: 'Export' });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportModal.locator('button:has-text("Deel / download CSV")').click()
    ]);
    const csv = fs.readFileSync(await download.path(), 'utf-8');
    const lines = csv.split('\n');
    const headerIdx = lines.findIndex(l => l.includes('Plusminus'));
    const seg1 = lines[headerIdx + 1].split(',');
    const seg2 = lines[headerIdx + 2].split(',');
    // Plusminus = 8e index "Plusminus"
    const pmHeader = lines[headerIdx].split(',');
    const pmIdx = pmHeader.findIndex(h => h.trim() === 'Plusminus');
    expect(Number(seg1[pmIdx])).toBe(2);
    expect(Number(seg2[pmIdx])).toBe(2);
  });

  // P0-1: schema-invalid import verwijdert BACKUP_KEYS. Bekende productcode-bug.
  // Deze test is verwacht falend (test.fail) totdat importvalidatie is opgelost vóór Fase 2.
  test.fail('syntactisch geldige JSON met ongeldig schema mag geen data verwijderen', async ({ page }) => {
    await seedApp(page);
    const before = await readLocalStorage(page);
    expect(before[ROSTER_KEY]).toBeTruthy();

    // data als string (geen object): passeert huidige validatie in index.html:1333
    const invalidSchema = '{"type":"lineup-tracker-backup","version":1,"data":"broken"}';
    const invalidFile = path.join(os.tmpdir(), `lineup-invalid-schema-${Date.now()}.json`);
    fs.writeFileSync(invalidFile, invalidSchema);

    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      if (dialog.type() === 'alert') await dialog.dismiss();
      else await dialog.accept(); // Bevestig NIET — we verwachten dat alert eerst verschijnt
    });

    await page.locator('button:has-text("⚙")').click();
    await page.setInputFiles('#backupFileInput', invalidFile);

    // Wacht op minstens één dialog (FileReader async)
    await expect.poll(() => dialogs.length, { timeout: 5000 }).toBeGreaterThan(0);

    // De alert moet verschijnen, NIET de confirm
    expect(dialogs.some(d => d.type === 'alert' && d.message.includes('geen geldige'))).toBe(true);

    // Geen confirm-dialoog voor import
    expect(dialogs.filter(d => d.type === 'confirm')).toHaveLength(0);

    // localStorage moet byte-gelijk blijven
    const after = await readLocalStorage(page);
    expect(after[ROSTER_KEY]).toEqual(before[ROSTER_KEY]);
    expect(after[GAMES_KEY]).toEqual(before[GAMES_KEY]);
    expect(after[SETTINGS_KEY]).toEqual(before[SETTINGS_KEY]);
    expect(after[LANG_KEY]).toEqual(before[LANG_KEY]);
    expect(after[STORAGE_KEY]).toEqual(before[STORAGE_KEY]);

    fs.unlinkSync(invalidFile);
  });
});
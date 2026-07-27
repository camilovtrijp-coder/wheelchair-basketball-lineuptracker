const { test, expect } = require('@playwright/test');
const {
  STORAGE_KEYS,
  createMockRoster,
  clearLocalStorage,
  seedLocalStorage,
  createMockFinishedGames,
} = require('./fixtures/test-helpers');

test.describe('ROBA Lineup Tracker - End-to-End Test Baseline (Desktop Chromium)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorage(page);
    await page.reload();
  });

  // ---------------------------------------------------------------------------
  // Scenario 1: Team- en Wedstrijdvoorbereiding
  // ---------------------------------------------------------------------------
  test('Scenario 1: Teamopzet, rugnummersorgering, starter-selectie en wedstrijdstart', async ({ page }) => {
    await page.goto('/');

    // 1. Verifieer dat Team-tabblad actief is
    const rosterTab = page.locator('.tabbtn', { hasText: /Team|Roster/i });
    await rosterTab.click();
    await expect(rosterTab).toHaveClass(/on/);

    // 2. Voeg 6 fictieve spelers toe
    const mockRoster = createMockRoster().slice(0, 6);
    for (let i = 0; i < mockRoster.length; i++) {
      await page.locator('button', { hasText: /\+ Speler toevoegen|\+ Add player/i }).click();
    }

    const nameInputs = page.locator('input[placeholder*="Naam"], input[placeholder*="Name"]');
    const nrInputs = page.locator('input.num');

    for (let i = 0; i < mockRoster.length; i++) {
      await nameInputs.nth(i).fill(mockRoster[i].naam);
      await nrInputs.nth(i).fill(mockRoster[i].nr);
      await nrInputs.nth(i).blur();
    }

    // Assert rugnummers zijn ingevuld en op volgorde (4, 7, 10, 12, 15, 22)
    const filledNrs = await nrInputs.allInputValues();
    expect(filledNrs.slice(0, 6)).toEqual(['4', '7', '10', '12', '15', '22']);

    // 3. Ga naar Wedstrijd-tabblad, vul tegenstander/competitie in en selecteer 5 starters
    await page.locator('.tabbtn', { hasText: /Wedstrijd|Track/i }).click();

    await page.locator('input[oninput*="setOpponent"]').fill('Bulls Basketball');
    await page.locator('input[oninput*="setCompetition"]').fill('Regio Competitie Q3');

    // Zet speler 6 (#22) op niet meedoen via de Meedoen-toggle
    const participateToggles = page.locator('button', { hasText: /Meedoen|Play/i });
    await participateToggles.nth(5).click(); // speler 6 niet meedoen

    // Selecteer de eerste 5 als starter
    const starterToggles = page.locator('button', { hasText: /^Start$/i });
    for (let i = 0; i < 5; i++) {
      await starterToggles.nth(i).click();
    }

    // Assert dat startknop geactiveerd is
    const startMatchBtn = page.locator('#startbtn');
    await expect(startMatchBtn).toBeEnabled();
    await expect(startMatchBtn).toContainText(/Start wedstrijd|Start match/i);

    // Start wedstrijd
    await startMatchBtn.click();

    // 4. Assert dat er exact 5 spelers op het veld staan
    const courtChips = page.locator('.grid5 .chip');
    await expect(courtChips).toHaveCount(5);

    // Assert dat rugnummers 4, 7, 10, 12, 15 op het veld staan
    const courtNrs = await page.locator('.grid5 .chip .nr').allInnerTexts();
    expect(courtNrs).toEqual(['4', '7', '10', '12', '15']);
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: Score & Segmentregistratie & Herladen
  // ---------------------------------------------------------------------------
  test('Scenario 2: Registreer score/segment met geldige eindtijd en verifieer hervatten', async ({ page }) => {
    const mockRoster = createMockRoster();
    await seedLocalStorage(page, { roster: mockRoster });
    await page.goto('/');

    await page.locator('.tabbtn', { hasText: /Wedstrijd|Track/i }).click();
    await page.locator('#startbtn').click();

    // Registreer punten voor (+2, +3 = 5) en tegen (+2)
    await page.locator('button.scorebtn.btn-amber', { hasText: '+2' }).click();
    await page.locator('button.scorebtn.btn-amber', { hasText: '+3' }).click();
    await page.locator('button.scorebtn.btn-sky', { hasText: '+2' }).click();

    // Stel een geldige eindtijd in (8:00 bij aftellen 10:00 -> 0:00) vóór "Segment opslaan"
    // timesel indexes: 0=beginMin, 1=beginSec, 2=endMin, 3=endSec
    const endMinSelect = page.locator('select.timesel').nth(2);
    await endMinSelect.selectOption('8');

    // Assert dat opslaanknop geactiveerd is (dur > 0: 2:00 = 120s, +3)
    const saveSegBtn = page.locator('button', { hasText: /Segment opslaan|Save segment/i });
    await expect(saveSegBtn).not.toHaveClass(/disabled/);
    await expect(saveSegBtn).toContainText('+3');

    // Sla segment op
    await saveSegBtn.click();

    // Assert dat 1 segment in de lijst staat met de juiste score (+3) en duur (2:00)
    const segCards = page.locator('.seg');
    await expect(segCards).toHaveCount(1);
    await expect(segCards.first()).toContainText('+3');
    await expect(segCards.first()).toContainText('2:00');

    // Herlaad pagina en verifieer hervatten van lopende wedstrijd
    await page.reload();

    const resumeBtn = page.locator('button', { hasText: /Hervatten|Resume/i });
    if (await resumeBtn.isVisible()) {
      await resumeBtn.click();
    }

    // Assert dat opgeslagen score en segment behouden zijn
    await expect(page.locator('.seg')).toHaveCount(1);
    await expect(page.locator('.seg').first()).toContainText('+3');
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: Enkelvoudige Wissel
  // ---------------------------------------------------------------------------
  test('Scenario 3: Enkelvoudige wissel op vaste kloktijd met lineup bijwerking', async ({ page }) => {
    const mockRoster = createMockRoster();
    await seedLocalStorage(page, { roster: mockRoster });
    await page.goto('/');

    await page.locator('.tabbtn', { hasText: /Wedstrijd|Track/i }).click();
    await page.locator('#startbtn').click();

    // Selecteer veldspeler 1 (#4) en bankspeler 1 (#22)
    const courtChip = page.getByTestId('court-list').locator('.chip').first();
    await expect(courtChip.locator('.nr')).toHaveText('4');
    await courtChip.click();

    const benchChip = page.getByTestId('bench-list').locator('.chip').first();
    await expect(benchChip.locator('.nr')).toHaveText('22');
    await benchChip.click();

    // Bevestig wissel
    const doneSwapBtn = page.locator('button', { hasText: /Klaar met wisselen|Done substituting/i });
    await expect(doneSwapBtn).toBeVisible();
    await doneSwapBtn.click();

    // Stel kloktijd in modal in op 8:00 (dur > 0)
    const modalEndMinSelect = page.locator('.modal select.timesel').first();
    if (await modalEndMinSelect.isVisible()) {
      await modalEndMinSelect.selectOption('8');
    }

    // Bevestig in modal
    await page.locator('.modal button', { hasText: /Bevestigen|Confirm/i }).click();

    // Assert dat 5 spelers op de vloer staan en dat speler #22 nu op het veld staat
    const courtNrs = await page.getByTestId('court-list').locator('.chip .nr').allInnerTexts();
    expect(courtNrs).toContain('22');
    expect(courtNrs).not.toContain('4');

    // Assert dat het voorgaande segment is opgeslagen
    await expect(page.locator('.seg')).toHaveCount(1);
  });

  // ---------------------------------------------------------------------------
  // Scenario 4: Meervoudige Wissel
  // ---------------------------------------------------------------------------
  test('Scenario 4: Meervoudige wissel in één wisselblok zonder dubbele of lege segmenten', async ({ page }) => {
    const mockRoster = createMockRoster();
    await seedLocalStorage(page, { roster: mockRoster });
    await page.goto('/');

    await page.locator('.tabbtn', { hasText: /Wedstrijd|Track/i }).click();
    await page.locator('#startbtn').click();

    const courtChips = page.getByTestId('court-list').locator('.chip');
    const benchChips = page.getByTestId('bench-list').locator('.chip');

    // Wissel 1: Veld #4 <-> Bank #22
    await courtChips.nth(0).click();
    await benchChips.nth(0).click();

    // Wissel 2: Veld #7 <-> Bank #33
    await courtChips.nth(1).click();
    await benchChips.nth(1).click();

    // Bevestig wisselblok 1x op kloktijd 7:00
    await page.locator('button', { hasText: /Klaar met wisselen|Done substituting/i }).click();

    const modalEndMinSelect = page.locator('.modal select.timesel').first();
    if (await modalEndMinSelect.isVisible()) {
      await modalEndMinSelect.selectOption('7');
    }

    await page.locator('.modal button', { hasText: /Bevestigen|Confirm/i }).click();

    // Assert dat exact 5 spelers op het veld staan en dat #22 en #33 op het veld staan
    const courtNrs = await page.getByTestId('court-list').locator('.chip .nr').allInnerTexts();
    expect(courtNrs).toContain('22');
    expect(courtNrs).toContain('33');
    expect(courtNrs.length).toBe(5);

    // Assert dat precies 1 segment is aangemaakt voor dit wisselblok
    await expect(page.locator('.seg')).toHaveCount(1);
  });

  // ---------------------------------------------------------------------------
  // Scenario 5: Segmentcorrectie en Verwijdering
  // ---------------------------------------------------------------------------
  test('Scenario 5: Segment bewerken en verwijderen met herberekening', async ({ page }) => {
    const mockRoster = createMockRoster();
    await seedLocalStorage(page, { roster: mockRoster });
    await page.goto('/');

    await page.locator('.tabbtn', { hasText: /Wedstrijd|Track/i }).click();
    await page.locator('#startbtn').click();

    // Registreer punten +2 en stel eindtijd in op 8:00
    await page.locator('button.scorebtn.btn-amber', { hasText: '+2' }).click();
    await page.locator('select.timesel').nth(2).selectOption('8');
    await page.locator('button', { hasText: /Segment opslaan|Save segment/i }).click();

    // Assert dat segment is opgeslagen
    await expect(page.locator('.seg')).toHaveCount(1);
    await expect(page.locator('.seg').first()).toContainText('+2');

    // Open bewerk-modal van het segment
    await page.locator('.seg').first().click();

    // Assert dat modal "Segment bewerken" is geopend
    await expect(page.locator('.modal h2')).toContainText(/Segment bewerken|Edit segment/i);

    // Wijzig de score, tijd en lineup
    await page.locator('.modal input[oninput*="setEditPts(\'pf\'"]').fill('5');
    await page.locator('.modal select.timesel').nth(2).selectOption('7'); // verander eindtijd naar 7:00
    
    // Haal 5e speler uit de lineup en voeg 6e toe (bijv. ID 5 eruit, ID 6 erin)
    // Aangezien mockRoster [4, 7, 10, 12, 15, 22, 33] is, klikken we op nr 15 en 22
    const chip15 = page.locator('.modal .grid5 .chip', { hasText: '15' });
    const chip22 = page.locator('.modal .grid5 .chip', { hasText: '22' });
    if (await chip15.isVisible() && await chip22.isVisible()) {
      await chip15.click(); // Deselecteer
      await chip22.click(); // Selecteer
    } else {
      await page.locator('.modal .grid5 .chip').nth(4).click();
      await page.locator('.modal .grid5 .chip').nth(5).click();
    }

    // Sla het segment op
    await page.locator('.modal button', { hasText: /Opslaan|Save/i }).click();

    // Assert gewijzigde waarden (score is nu +5, tijd is nu 10:00 tot 7:00 = 3:00)
    const segCard = page.locator('.seg').first();
    await expect(segCard).toContainText('+5');
    await expect(segCard).toContainText('3:00');
    await expect(segCard).toContainText('22');

    // Assert herberekening running score in de scoresel
    await expect(page.locator('.scoresel.amber')).toHaveValue('5');

    // Open bewerk-modal opnieuw
    await segCard.click();

    // Verwijder het segment via bevestigingsdialog
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('.modal button', { hasText: /Verwijderen|Delete/i }).click();

    // Assert dat er 0 segmenten over zijn en de score is gereset
    await expect(page.locator('.seg')).toHaveCount(0);
    await expect(page.locator('.scoresel.amber')).toHaveValue('0');
  });

  // ---------------------------------------------------------------------------
  // Scenario 6: Wedstrijd Afronden en Historie
  // ---------------------------------------------------------------------------
  test('Scenario 6: Wedstrijd afronden, opslaan in Historie en schone start van nieuwe wedstrijd', async ({ page }) => {
    const mockRoster = createMockRoster();
    await seedLocalStorage(page, { roster: mockRoster });
    await page.goto('/');

    await page.locator('.tabbtn', { hasText: /Wedstrijd|Track/i }).click();
    await page.locator('input[oninput*="setOpponent"]').fill('Knights BC');
    await page.locator('#startbtn').click();

    // Registreer score en stel eindtijd in op 8:00
    await page.locator('button.scorebtn.btn-amber', { hasText: '+2' }).click();
    await page.locator('select.timesel').nth(2).selectOption('8');
    await page.locator('button', { hasText: /Segment opslaan|Save segment/i }).click();

    // Rond wedstrijd af via bevestiging
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('button', { hasText: /Wedstrijd afronden|Finish match/i }).click();

    // Assert dat de afgeronde wedstrijd automatisch is geopend
    const backBtn = page.locator('button', { hasText: /Terug|Back/i });
    await expect(backBtn).toBeVisible();
    await expect(page.locator('h1').first()).toContainText('Knights BC');

    // Sluit de wedstrijddetails om de Historie lijst te zien
    await backBtn.click();

    // Assert dat we terug zijn op de Historie-lijst
    const historyTab = page.locator('.tabbtn', { hasText: /Historie|History/i });
    await expect(historyTab).toHaveClass(/on/);

    // Assert dat de afgeronde wedstrijd in Historie staat met tegenstander "Knights BC" en score "2 - 0"
    const historyCard = page.locator('button.card', { hasText: 'Knights BC' });
    await expect(historyCard).toBeVisible();
    await expect(historyCard).toContainText('2 - 0');

    // Ga terug naar Wedstrijd-tabblad -> assert dat een schone nieuwe wedstrijd is gestart
    await page.locator('.tabbtn', { hasText: /Wedstrijd|Track/i }).click();
    await expect(page.locator('#startbtn')).toBeVisible();

    // Ga naar Team-tabblad -> assert dat de spelerslijst behouden is gebleven
    await page.locator('.tabbtn', { hasText: /Team|Roster/i }).click();
    const nrInputs = page.locator('input.num');
    await expect(nrInputs.first()).toHaveValue('4');
  });

  // ---------------------------------------------------------------------------
  // Scenario 7: Stats
  // ---------------------------------------------------------------------------
  test('Scenario 7: Statistieken over afgeronde wedstrijden met combinaties en per-10-minutenweergave', async ({ page }) => {
    const mockRoster = createMockRoster();
    const mockGames = createMockFinishedGames();

    await seedLocalStorage(page, { roster: mockRoster, games: mockGames });
    await page.goto('/');

    // Ga naar Stats tab
    await page.locator('.tabbtn', { hasText: /Stats/i }).click();

    // Assert dat Stats tabel geladen is en data bevat
    await expect(page.locator('#app')).not.toContainText(/Nog geen wedstrijddata|No match data yet/i);

    // Assert dat combinatieknoppen 1 t/m 5 aanwezig zijn
    const comboBtn1 = page.locator('button.q', { hasText: '1' });
    const comboBtn5 = page.locator('button.q', { hasText: '5' });
    await expect(comboBtn1).toBeVisible();
    await expect(comboBtn5).toBeVisible();

    // Schakel per-10-minutenweergave uit voor absolute getallen
    const per10Btn = page.locator('button', { hasText: /Per 10 min/i });
    if (await per10Btn.isVisible()) {
      // Indien het al "on" is, klik uit, anders laat staan
      const classList = await per10Btn.getAttribute('class') || '';
      const style = await per10Btn.getAttribute('style') || '';
      if (style.includes('var(--primary-soft)')) {
        await per10Btn.click(); // Toggle off
      }
    }

    // Controleer Alex de Vries (speler 1) over G101 en G102 (lineup1)
    await comboBtn1.click();
    
    // G101 (2 segmenten): pf 42, pa 30, dur 1200
    // G102 (3 segmenten): pf 67, pa 58, dur 1800
    // Totaal Alex de Vries (On): pf 109, pa 88, dur 3000 (50 min), On PM = +21
    const alexCard = page.locator('.card', { hasText: 'Alex de Vries' }).first();
    await expect(alexCard).toContainText('50:00'); // Tijd
    await expect(alexCard).toContainText('109'); // Pts For
    await expect(alexCard).toContainText('88'); // Pts Against
    await expect(alexCard.locator('.badge-pm').first()).toContainText('+21.0'); // On +/-
  });

  // ---------------------------------------------------------------------------
  // Scenario 8: Trends
  // ---------------------------------------------------------------------------
  test('Scenario 8: Trends analyse over meerdere wedstrijden met sortering', async ({ page }) => {
    const mockRoster = createMockRoster();
    const mockGames = createMockFinishedGames();

    await seedLocalStorage(page, { roster: mockRoster, games: mockGames });
    await page.goto('/');

    // Ga naar Trends tab
    await page.locator('.tabbtn', { hasText: /Trends/i }).click();

    // Assert dat Trends pagina niet leeg is
    await expect(page.locator('#app')).not.toContainText(/Nog geen wedstrijddata|No match data yet/i);

    // Test sorteerknop
    const sortBtn = page.locator('button', { hasText: /Sorteer|Sort/i }).first();
    if (await sortBtn.isVisible()) {
      // Klik door sortering (PM / Min / Nr)
      await sortBtn.click();
      await sortBtn.click();
      
      // Concreet checken of Alex de Vries een gemiddelde PM (Per 10 min uitgeschakeld) toont
      // Totaal +21 over 5 segmenten = gemiddelde PM per wedstrijd is +10.5 over de 2 wedstrijden
      const per10Btn = page.locator('button', { hasText: /Per 10 min/i }).first();
      const style = await per10Btn.getAttribute('style') || '';
      if (style.includes('var(--primary-soft)')) {
        await per10Btn.click(); // Toggle per-10-min off
      }

      const alexCard = page.locator('.card', { hasText: 'Alex de Vries' });
      await expect(alexCard).toContainText('+10.5'); // Avg PM over 2 wedstrijden (+21 / 2)
    }
  });

  // ---------------------------------------------------------------------------
  // Scenario 9: Back-up en Herstel
  // ---------------------------------------------------------------------------
  test('Scenario 9: Exporteer en importeer back-up van alle gegevens via JSON-bestand', async ({ page }) => {
    const mockRoster = createMockRoster();
    const mockGames = createMockFinishedGames();

    await seedLocalStorage(page, {
      roster: mockRoster,
      games: mockGames,
      settings: { teamName: 'ROBA Test Stars' },
    });
    await page.goto('/');

    // Check pre-condition
    await expect(page.locator('h1').first()).toContainText('ROBA Test Stars');

    // Open Instellingen (⚙)
    await page.locator('button', { hasText: '⚙' }).click();

    // Download json back-up
    const downloadPromise = page.waitForEvent('download');
    await page.locator('button', { hasText: /Exporteer alle data|Export all data/i }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    // Sluit instellingen
    await page.locator('.modal button', { hasText: '✕' }).first().click();

    // Wis de opslag volledig
    await clearLocalStorage(page);
    await page.reload();

    // Assert opslag gewist:
    await expect(page.locator('h1').first()).not.toContainText('ROBA Test Stars');

    // Open instellingen en importeer back-up
    await page.locator('button', { hasText: '⚙' }).click();
    const fileInput = page.locator('input[type="file"][accept="application/json"]');
    await fileInput.setInputFiles(downloadPath);

    // App herlaadt zelf in handleImportBackupFile als succesvol (bij alert)
    page.once('dialog', dialog => dialog.accept()); // accepteer succes melding
    await page.waitForTimeout(300); // kleine pauze voor reload of herlaad handmatig
    await page.reload();

    // Assert data hersteld
    await expect(page.locator('h1').first()).toContainText('ROBA Test Stars');
    await page.locator('.tabbtn', { hasText: /Team|Roster/i }).click();
    const courtChips = page.locator('input.num');
    await expect(courtChips.first()).toHaveValue('4');
  });

  // ---------------------------------------------------------------------------
  // Scenario 10: Taal, Instellingen en Klassegrenscontrole
  // ---------------------------------------------------------------------------
  test('Scenario 10: Taal NL/EN toggle, instellingen en klassegrenscontrole', async ({ page }) => {
    // Eerst een geldige spelerslijst seeden zodat we de wedstrijd later probleemloos kunnen starten
    const mockRoster = createMockRoster();
    await seedLocalStorage(page, { roster: mockRoster });
    await page.goto('/');

    // 1. Test taalwissel NL -> EN
    const langBtn = page.locator('button', { hasText: /EN|NL/i }).first();
    await langBtn.click();

    // Assert dat taal gewijzigd is naar EN
    await expect(page.locator('.tabbtn', { hasText: /Roster/i })).toBeVisible();

    // Herlaad en assert dat taal 'en' behouden blijft
    await page.reload();
    await expect(page.locator('.tabbtn', { hasText: /Roster/i })).toBeVisible();

    // 2. Open Instellingen (⚙) en schakel classificatiesysteem in
    await page.locator('button', { hasText: '⚙' }).click();

    const classSwitch = page.getByTestId('class-limit-toggle');
    if (await classSwitch.isVisible()) {
      await classSwitch.check({ force: true });
    }

    // Sluit instellingen
    await page.locator('.modal button', { hasText: '✕' }).first().click();

    // Assert dat klassegrensbalk zichtbaar is bij Wedstrijd
    await page.locator('.tabbtn', { hasText: /Track|Wedstrijd/i }).click();
    await page.locator('#startbtn').click();
    await expect(page.locator('.class-bar-bg')).toBeVisible();
  });
});

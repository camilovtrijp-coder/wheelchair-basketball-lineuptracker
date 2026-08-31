// PR 8.2a (docs/pr-8.2-plan.md §C 8.2a werk 5/§B punt 3): keyboard-only-
// e2e-bewijs dat de nieuwe focus-trap (`infrastructure/a11y/focusTrap.ts`,
// `application/a11y/useFocusTrap.ts`) daadwerkelijk werkt in de browser-DOM,
// niet alleen in de jsdom-unit-tests (`focusTrap.spec.ts`). Minimale dekking
// per §C 8.2a werk 5: modaal openen met het toetsenbord, Tab-cyclus binnen
// het dialoog, Escape sluit, focus-restore naar het openende element. De
// live-wedstrijdbediening (score/wissel/context) via alleen toetsenbord is
// PR 8.2b-scope (§B punt 3 tweede helft) — die knoppen zijn vandaag nog geen
// volwaardige focusbare/toetsenbord-activeerbare elementen.
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

/** Verzamelt de `data-testid` van elk element dat op zijn beurt focus krijgt
 * terwijl er herhaaldelijk Tab gedrukt wordt — voor het aantonen dat de
 * cyclus binnen het dialoog blijft (nooit een element buiten `.modal`). */
async function activeTestId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
}

async function activeIsInsideModal(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const active = document.activeElement;
    const modal = document.querySelector('.modal');
    return Boolean(active && modal && modal.contains(active));
  });
}

test.describe('v2 a11y — keyboard-only modaalbediening (PR 8.2a)', () => {
  test('modaal openen/sluiten met toetsenbord: Tab-cyclus blijft binnen het dialoog, Escape sluit, focus keert terug', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('nav-stats').click();

    const opener = page.getByTestId('stats-games-btn');
    await opener.focus();
    await expect(opener).toBeFocused();

    // Openen puur via toetsenbord — geen `click()`/`tap()`.
    await page.keyboard.press('Enter');
    const modal = page.getByTestId('stats-games-modal');
    await expect(modal).toBeVisible();

    // De focus-trap verplaatst focus meteen naar het eerste focusbare
    // element binnen het dialoog (de "wissen"-knop, want deze modal heeft
    // een `onClear`) — nooit op de openende knop erachter.
    await expect(page.getByTestId('stats-games-modal-clear')).toBeFocused();

    // Zonder wedstrijddata bevat dit dialoog precies twee focusbare
    // elementen (clear + done) — Tab vanaf de laatste cyclet terug naar de
    // eerste, nooit naar de achtergrondpagina.
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('stats-games-modal-done')).toBeFocused();
    expect(await activeIsInsideModal(page)).toBe(true);

    await page.keyboard.press('Tab');
    await expect(page.getByTestId('stats-games-modal-clear')).toBeFocused();
    expect(await activeTestId(page)).toBe('stats-games-modal-clear');

    // Shift+Tab vanaf het eerste element cyclet terug naar het laatste.
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByTestId('stats-games-modal-done')).toBeFocused();

    // Escape sluit het dialoog en geeft focus terug aan de knop die het
    // opende.
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(opener).toBeFocused();
  });

  // Externe review PR #81: de bovenstaande test bewijst alleen de gedeelde
  // `ModalDialog`/`GamesFilterModal`-implementatie, niet de twee losse
  // live-wedstrijdmodals (`swap-confirm-modal`, `edit-segment-modal` in
  // `LiveTrackingPanel.tsx`) die hun eigen `modal-overlay`/`modal`-opbouw
  // hebben (zelfde reden als `TakeoverConfirmDialog`: een ander
  // knoppenpaar dan clear/done). Beide kregen in dezelfde PR de
  // focus-trap; deze test bewijst 'm op `swap-confirm-modal`. Deze twee
  // modals hebben (net als vóór deze PR) geen Escape-sluitgedrag — alleen
  // de focus-trap zelf is hier getest, geen Escape-regressie geïntroduceerd.
  test('swap-confirm-modal (live-wedstrijdmodaal, geen ModalDialog-hergebruik): Tab-cyclus blijft binnen het dialoog, "Terug" geeft focus terug aan de openende knop', async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
    await page.goto('/');
    await page.getByTestId('nav-roster').click();
    for (let i = 0; i < 6; i += 1) {
      await page.getByTestId('roster-add').click();
    }
    const names = page.locator('[data-testid^="roster-naam-"]');
    await expect(names).toHaveCount(6);
    for (let i = 0; i < 6; i += 1) {
      await names.nth(i).fill(`Speler ${i + 1}`);
    }
    await page.getByTestId('roster-save').click();
    await page.reload();

    await page.getByTestId('nav-game').click();
    await page.getByTestId('game-start-btn').click();
    await expect(page.getByTestId('score-row-for')).toBeVisible();

    await page.locator('[data-testid^="court-chip-"]').first().click();
    await page.locator('[data-testid^="bench-chip-"]').first().click();
    const swapDoneBtn = page.getByTestId('swap-done-btn');
    await swapDoneBtn.click();

    const modal = page.getByTestId('swap-confirm-modal');
    await expect(modal).toBeVisible();

    // De focus-trap verplaatst focus meteen naar het eerste focusbare
    // element (de minuten-select).
    await expect(page.getByTestId('swap-confirm-min')).toBeFocused();

    // Vier focusbare elementen: min-select, sec-select, terug-knop,
    // bevestig-knop. Tab vanaf het laatste cyclet terug naar het eerste.
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('swap-confirm-sec')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('swap-confirm-back')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('swap-confirm-confirm')).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await activeTestId(page)).toBe('swap-confirm-min');
    expect(await activeIsInsideModal(page)).toBe(true);

    // "Terug" sluit het dialoog en geeft focus terug aan de knop die het
    // opende (geen Escape-ondersteuning op dit dialoog, zie boven).
    await page.getByTestId('swap-confirm-back').click();
    await expect(modal).not.toBeVisible();
    await expect(swapDoneBtn).toBeFocused();
  });

  // Externe review PR #81, vierde ronde: de bovenstaande test bewijst
  // swap-confirm-modal, maar `edit-segment-modal` — de TWEEDE, apart
  // geïmplementeerde live-wedstrijdmodaal in LiveTrackingPanel.tsx (ook
  // géén ModalDialog-hergebruik, ook géén Escape-sluitgedrag, zelfde reden
  // als hierboven) — had nog geen eigen browserbewijs, ondanks al wel
  // `useFocusTrap` en axe-dekking te hebben (a11y-axe.spec.ts). Dit dialoog
  // heeft een grillige, datagedreven hoeveelheid focusbare elementen
  // (kwartaalknoppen × quarterCount, vier tijd-selects, een chip per
  // rosterspeler, twee puntenvelden, opslaan/verwijderen) — in plaats van
  // elk element hard te coderen, telt deze test hoeveel Tabs nodig zijn om
  // helemaal rond te komen (terug bij het eerste element) en bewijst dat
  // focus op ELKE stap binnen `.modal` blijft: dat bewijst containment
  // ongeacht de exacte, datagedreven elementenlijst.
  test('edit-segment-modal (live-wedstrijdmodaal, geen ModalDialog-hergebruik): Tab-cyclus blijft binnen het dialoog, sluiten geeft focus terug aan de segmentregel die het opende', async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
    await page.goto('/');
    await page.getByTestId('nav-roster').click();
    for (let i = 0; i < 5; i += 1) {
      await page.getByTestId('roster-add').click();
    }
    const names = page.locator('[data-testid^="roster-naam-"]');
    await expect(names).toHaveCount(5);
    for (let i = 0; i < 5; i += 1) {
      await names.nth(i).fill(`Speler ${i + 1}`);
    }
    await page.getByTestId('roster-save').click();
    await page.reload();

    await page.getByTestId('nav-game').click();
    await page.getByTestId('game-start-btn').click();
    await expect(page.getByTestId('score-row-for')).toBeVisible();

    // Eén segment opslaan zodat er een `segment-item-*`-rij bestaat om het
    // dialoog vanaf te openen — zelfde opzet als a11y-axe.spec.ts se
    // "live tracking incl. open segment-bewerken-modaal".
    await page.getByTestId('score-plus2-for').click();
    await page.getByTestId('end-min').selectOption('5');
    await page.getByTestId('save-segment-btn').click();
    const segmentItem = page.locator('[data-testid^="segment-item-"]').first();
    await expect(segmentItem).toBeVisible();

    // Openen puur via toetsenbord — geen `click()`.
    await segmentItem.focus();
    await expect(segmentItem).toBeFocused();
    await page.keyboard.press('Enter');

    const modal = page.getByTestId('edit-segment-modal');
    await expect(modal).toBeVisible();

    // De focus-trap verplaatst focus meteen naar het eerste focusbare
    // element: de ✕-sluitknop (staat vóór de kwartaalknoppen/tijd-
    // selects/chips in de DOM).
    const closeBtn = page.getByTestId('edit-segment-close');
    await expect(closeBtn).toBeFocused();

    // Shift+Tab vanaf het eerste element cyclet terug naar het LAATSTE —
    // bewijst de achterwaartse cyclus zonder de exacte elementenlijst hard
    // te coderen — en Tab daarna weer terug naar het eerste.
    await page.keyboard.press('Shift+Tab');
    expect(await activeTestId(page)).not.toBe('edit-segment-close');
    expect(await activeIsInsideModal(page)).toBe(true);
    await page.keyboard.press('Tab');
    await expect(closeBtn).toBeFocused();

    // Voorwaartse cyclus: Tab net zo vaak als nodig om weer bij de
    // sluitknop uit te komen, en bewijs op ELKE stap dat focus binnen
    // `.modal` blijft — nooit een Tab die naar de achtergrondpagina lekt.
    let steps = 0;
    do {
      await page.keyboard.press('Tab');
      expect(await activeIsInsideModal(page)).toBe(true);
      steps += 1;
    } while ((await activeTestId(page)) !== 'edit-segment-close' && steps < 30);
    expect(steps).toBeLessThan(30);
    await expect(closeBtn).toBeFocused();

    // Sluiten puur via toetsenbord (Enter op de al-gefocuste ✕-knop; geen
    // Escape-ondersteuning op dit dialoog, zie boven) — geeft focus terug
    // aan de segmentregel die het opende.
    await page.keyboard.press('Enter');
    await expect(modal).not.toBeVisible();
    await expect(segmentItem).toBeFocused();
  });
});

// PR 8.2b (docs/pr-8.2-plan.md §C 8.2b werk 2): de live-wedstrijdbediening
// (score toekennen, wissel uitvoeren, kwart wisselen) puur via het
// toetsenbord — geen `page.click()`/`page.tap()`. Onderzoek in 8.2b bevestigt
// dat `LiveTrackingPanel.tsx` al uitsluitend `<button>`/`<select>`-elementen
// gebruikt voor deze bediening (geen `<div onClick>`-patronen), dus dit is
// bewijs dat de bestaande implementatie al werkt, geen nieuwe UI-code.
test.describe('v2 a11y — keyboard-only live-wedstrijdbediening (PR 8.2b)', () => {
  test('score toekennen, een wissel uitvoeren en van kwart wisselen zijn volledig met een toetsenbord bereikbaar', async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
    await page.goto('/');
    await page.getByTestId('nav-roster').click();
    for (let i = 0; i < 6; i += 1) {
      await page.getByTestId('roster-add').click();
    }
    const names = page.locator('[data-testid^="roster-naam-"]');
    await expect(names).toHaveCount(6);
    for (let i = 0; i < 6; i += 1) {
      await names.nth(i).fill(`Speler ${i + 1}`);
    }
    await page.getByTestId('roster-save').click();
    await page.reload();

    await page.getByTestId('nav-game').click();
    await page.getByTestId('game-start-btn').click();
    await expect(page.getByTestId('score-row-for')).toBeVisible();

    // Score toekennen: focus + Enter op de "+2"-knop, geen `.click()`.
    const scorePlus2 = page.getByTestId('score-plus2-for');
    await scorePlus2.focus();
    await expect(scorePlus2).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('score-select-for')).toHaveValue('2');

    // Nogmaals +3 via Spatie (native `<button>`-activatie ondersteunt beide).
    const scorePlus3 = page.getByTestId('score-plus3-for');
    await scorePlus3.focus();
    await page.keyboard.press(' ');
    await expect(page.getByTestId('score-select-for')).toHaveValue('5');

    // Wissel uitvoeren: eerst een veldspeler, dan een bankspeler selecteren
    // — allebei via focus()+Enter. Bewaar de bank-chip se testid vooraf om
    // na de wissel te bewijzen dat die speler nu op het veld staat, zonder
    // de exacte, data-gedreven speler-id's hard te coderen.
    const courtChip = page.locator('[data-testid^="court-chip-"]').first();
    await courtChip.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('swap-selected')).toBeVisible();

    const benchChip = page.locator('[data-testid^="bench-chip-"]').first();
    const benchTestId = await benchChip.getAttribute('data-testid');
    expect(benchTestId).toBeTruthy();
    await benchChip.focus();
    await page.keyboard.press('Enter');

    const swappedInPlayerId = benchTestId!.replace('bench-chip-', '');
    await expect(page.getByTestId(`court-chip-${swappedInPlayerId}`)).toBeVisible();

    // Kwart wisselen: focus + Enter op kwart 2.
    const quarter2 = page.getByTestId('quarter-btn-2');
    await quarter2.focus();
    await page.keyboard.press('Enter');
    await expect(quarter2).toHaveClass(/quarter-btn--active/);
  });
});

// PR 8.2b (§C 8.2b werk 2, tweede helft van §B punt 3): de contextwissel via
// `AuthGate.tsx`'s teamswitcher (`SessionBar`'s "wissel"-knop → een
// organisatie/team kiezen in `ContextSwitcher`) puur via het toetsenbord.
// Vereist de Firebase Auth-/Firestore-emulator + seed-data (zelfde
// afhankelijkheid als de rest van deze e2e-suite via `./fixtures`) — bob
// heeft in de seed twee teams onder `org-rotterdam` (`team-u23`, waar
// `fixtures.ts` 'm standaard in inlogt, en `team-u17`).
test.describe('v2 a11y — keyboard-only contextwissel (PR 8.2b)', () => {
  test('de contextwisselaar (organisatie + team kiezen) is volledig met een toetsenbord bereikbaar', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('nav-game')).toBeVisible();

    const switchBtn = page.getByTestId('switch-context');
    await switchBtn.focus();
    await expect(switchBtn).toBeFocused();
    await page.keyboard.press('Enter');

    const orgBtn = page.getByTestId('context-org-org-rotterdam');
    await expect(orgBtn).toBeVisible();
    await orgBtn.focus();
    await page.keyboard.press('Enter');

    const teamBtn = page.getByTestId('context-team-team-u17');
    await expect(teamBtn).toBeVisible();
    await teamBtn.focus();
    await expect(teamBtn).toBeFocused();
    await page.keyboard.press('Enter');

    // Terug in de app, nu in team-u17's context.
    await expect(page.getByTestId('nav-game')).toBeVisible();
    const storedContext = await page.evaluate(() =>
      window.localStorage.getItem('lineup-tracker-selected-context'),
    );
    expect(JSON.parse(storedContext ?? '{}')).toMatchObject({
      orgId: 'org-rotterdam',
      teamId: 'team-u17',
    });
  });
});

// PR 8.2c (docs/pr-8.2-plan.md §B punt 5, tweede subpunt — herzien na de
// externe review op PR #84): de herroepbare vertrouwd-apparaat-instelling in
// `SessionBar.tsx` had aanvankelijk geen `aria-label`, geen focus-trap, geen
// Escape-afhandeling en geen focusherstel. Zelfde patroon/dekking als
// `ModalDialog.tsx`/`TakeoverConfirmDialog.tsx` hierboven.
test.describe('v2 a11y — herroepbare vertrouwd-apparaat-instelling (PR 8.2c)', () => {
  test('bevestigingsdialoog bij uitzetten: toegankelijke naam, initiële focus, Tab-cyclus, Escape sluit en focus keert terug naar de toggle', async ({
    page,
  }) => {
    // Zonder expliciete taalkeuze detecteert de app in CI-Chromium 'en'
    // (navigator.language) i.p.v. 'nl' — zelfde addInitScript-conventie als
    // de andere tests in dit bestand die Nederlandse tekst verwachten.
    // Overleeft ook de paginareload verderop (addInitScript draait op elke
    // nieuwe document-load in deze paginacontext, niet alleen page.goto()).
    await page.addInitScript(() => window.localStorage.setItem('lineup-tracker-lang', 'nl'));
    await page.goto('/');
    await expect(page.getByTestId('nav-settings')).toBeVisible();

    // fixtures.ts kiest 'onvertrouwd apparaat' als startpunt (zie
    // tests/e2e/fixtures.ts) — eerst aanzetten via toetsenbord (geen
    // bevestiging nodig voor die richting), wat een paginareload triggert
    // (AuthGate.tsx's handleChangeTrustedDevice()).
    const toggle = page.getByTestId('trusted-device-setting-toggle');
    await expect(toggle).not.toBeChecked();
    await toggle.focus();
    await page.keyboard.press('Space');
    await page.waitForSelector('[data-testid="nav-settings"]', { timeout: 15_000 });
    await expect(page.getByTestId('trusted-device-setting-toggle')).toBeChecked();

    // Uitzetten via toetsenbord opent de bevestigingsdialoog (geen reload nog).
    const toggleAfterReload = page.getByTestId('trusted-device-setting-toggle');
    await toggleAfterReload.focus();
    await page.keyboard.press('Space');

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName('Apparaat als gedeeld markeren?');

    // Initiële focus: het eerste focusbare element binnen het dialoog.
    const confirmBtn = page.getByTestId('trusted-device-revoke-confirm-btn');
    const cancelBtn = page.getByTestId('trusted-device-revoke-cancel-btn');
    await expect(confirmBtn).toBeFocused();

    // Tab-cyclus blijft binnen het dialoog.
    await page.keyboard.press('Tab');
    await expect(cancelBtn).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(confirmBtn).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(cancelBtn).toBeFocused();

    // Escape sluit het dialoog en geeft focus terug aan de toggle die het opende.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('trusted-device-revoke-confirm')).toHaveCount(0);
    await expect(page.getByTestId('trusted-device-setting-toggle')).toBeFocused();
    await expect(page.getByTestId('trusted-device-setting-toggle')).toBeChecked();
  });
});

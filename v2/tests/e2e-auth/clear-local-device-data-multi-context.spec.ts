// PR 8.2c, P1-fix na de externe review op PR #84: `clearLocalDeviceData()`
// construeerde aanvankelijk de te wissen sleutel uitsluitend uit de op dat
// moment geselecteerde org/team-context — wedstrijd-/synchronisatiedata van
// een ANDERE, eerder op dit apparaat gebruikte org/team (bijv. een team
// waar de gebruiker eerder naartoe wisselde) bleef daardoor stilzwijgend
// staan na uitloggen op een gedeeld/onvertrouwd apparaat. Dit bewijst het
// gerepareerde gedrag end-to-end (echte uitlogflow, geen unit-mock): data
// voor een NIET-huidige context (rechtstreeks in localStorage geseed —
// simuleert "dit apparaat gebruikte eerder ook team B") wordt bij uitloggen
// vanuit de HUIDIGE context (team A) net zo goed gewist, terwijl de
// beschermde sleutels (taalvoorkeur, de vertrouwd-apparaatvlag zelf)
// intact blijven.
//
// Geen aparte "uitloggen zonder geselecteerde context"-scenario: de
// uitlogknop (SessionBar) bestaat alleen in de 'active'-app-state, die een
// geselecteerde context vereist (deriveAppState.ts) — dat pad is via de UI
// niet bereikbaar, en clearLocalDeviceData() zelf neemt sinds deze fix geen
// org/team-parameter meer (het enumereert nu ALLE localStorage-sleutels),
// dus is er ook geen op-context-gebaseerde blinde vlek meer mogelijk.
import { test, expect } from '@playwright/test';
import { signUp, uniqueTestEmail } from './helpers';

test('gedeeld apparaat: uitloggen wist wedstrijddata van ALLE eerder gebruikte org/team-contexten op dit apparaat, niet alleen de huidige', async ({
  page,
}) => {
  const email = uniqueTestEmail('multi-context-wipe');
  await signUp(page, email, 'MultiCtx123!');
  await page.waitForSelector('[data-testid="trusted-device-no"]', { timeout: 10_000 });
  await page.getByTestId('trusted-device-no').click();

  await page.waitForSelector('[data-testid="onboarding-org-name"]', { timeout: 10_000 });
  await page.getByTestId('onboarding-org-name').fill('Multi Context Org');
  await page.getByTestId('onboarding-team-name').fill('Team A');
  await page.getByTestId('onboarding-submit').click();
  await page.waitForSelector('[data-testid^="context-org-"]', { timeout: 10_000 });
  await page.locator('[data-testid^="context-org-"]').first().click();
  await page.waitForSelector('[data-testid^="context-team-"]', { timeout: 10_000 });
  await page.locator('[data-testid^="context-team-"]').first().click();
  await expect(page.getByTestId('nav-settings')).toBeVisible({ timeout: 10_000 });

  const lang = await page.evaluate(() => window.localStorage.getItem('lineup-tracker-lang'));

  // Simuleert een andere, NIET-huidige org/team-context die dit apparaat
  // eerder gebruikte — rechtstreeks localStorage seeden i.p.v. een tweede
  // echte organisatie/team aanmaken, want het defect zat precies in hoe
  // clearLocalDeviceData() de te wissen sleutel construeerde, niet in de
  // contextwisselaar zelf.
  const otherContextKeys = await page.evaluate(() => {
    const orgId = 'org-elsewhere';
    const teamId = 'team-elsewhere';
    const keys = {
      activeGame: `lineup-tracker-v2-active-game:${orgId}:${teamId}`,
      completedGames: `lineup-tracker-v2-completed-games:${orgId}:${teamId}`,
      pendingFinalize: `lineup-tracker-v2-pending-finalize:${orgId}:${teamId}`,
      migrationRun: `lineup-tracker-v2-migration-run:${orgId}:${teamId}`,
      checkpoint: 'lineup-tracker-v2-game-sync-checkpoint:game-from-other-context',
    };
    window.localStorage.setItem(keys.activeGame, JSON.stringify({ id: 'game-from-other-context' }));
    window.localStorage.setItem(
      keys.completedGames,
      JSON.stringify([{ id: 'completed-from-other-context' }]),
    );
    window.localStorage.setItem(keys.pendingFinalize, '{}');
    window.localStorage.setItem(keys.migrationRun, '{}');
    window.localStorage.setItem(keys.checkpoint, '{}');
    return keys;
  });

  // Uitloggen gebeurt vanuit de HUIDIGE context (Team A) — de bovenstaande
  // sleutels horen bij een andere context en mogen toch verdwijnen.
  await page.getByTestId('sign-out').click();
  await page.waitForSelector('[data-testid="auth-email"]', { timeout: 10_000 });

  const remaining = await page.evaluate(
    (keys) => ({
      activeGame: window.localStorage.getItem(keys.activeGame),
      completedGames: window.localStorage.getItem(keys.completedGames),
      pendingFinalize: window.localStorage.getItem(keys.pendingFinalize),
      migrationRun: window.localStorage.getItem(keys.migrationRun),
      checkpoint: window.localStorage.getItem(keys.checkpoint),
      trustedDevice: window.localStorage.getItem('lineup-tracker-trusted-device'),
      lang: window.localStorage.getItem('lineup-tracker-lang'),
    }),
    otherContextKeys,
  );

  expect(remaining.activeGame).toBeNull();
  expect(remaining.completedGames).toBeNull();
  expect(remaining.pendingFinalize).toBeNull();
  expect(remaining.migrationRun).toBeNull();
  expect(remaining.checkpoint).toBeNull();
  // Nooit gewist: de vertrouwd-apparaatvlag zelf (apparaateigenschap) en de taalvoorkeur.
  expect(remaining.trustedDevice).toBe('false');
  expect(remaining.lang).toBe(lang);
});

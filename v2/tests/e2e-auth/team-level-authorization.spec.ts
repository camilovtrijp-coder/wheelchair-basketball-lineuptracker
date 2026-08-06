import { test, expect } from '@playwright/test';
import { adminDb, lookupUidByEmail } from './adminFixtures';
import { signUp, answerTrustedDevice, uniqueTestEmail } from './helpers';

// PR 5.2-reviewbevindingen (independent review op head 168d65c):
// - [P1] contextwisselaar toonde elk team van de organisatie aan elk organisatielid, ongeacht
//   teamspecifieke toegang (`getMyTeamAccess()` viel terug op de orgrol i.p.v. "niet tonen").
// - [P1] `deriveAppState` controleerde alleen `selectedContext.orgId` tegen de membershiplijst,
//   nooit `teamId` — intrekking van uitsluitend een teamMembers-document (organisatiemembership
//   blijft bestaan) bleef daardoor onopgemerkt en de context bleef `active`.
// Beide tests hieronder gebruiken bewust een gebruiker met org-rol 'viewer' (geen owner/admin,
// die altijd impliciete volledige teamtoegang hebben) zodat het verschil tussen "wel/geen
// expliciet teamMembers-document" zichtbaar is.
test.describe('team-niveau autorisatie in de contextwisselaar', () => {
  test('toont alleen teams waar de gebruiker aantoonbaar toegang toe heeft, niet elk team van de organisatie', async ({
    page,
  }) => {
    const email = uniqueTestEmail('teamvis');
    const password = 'TeamVis123!';
    await signUp(page, email, password);
    await answerTrustedDevice(page, true);
    await page.waitForSelector('[data-testid="no-organizations-body"]', { timeout: 10_000 });

    const uid = await lookupUidByEmail(email, password);
    const db = adminDb();
    const orgRef = db.collection('organizations').doc();
    await orgRef.set({ name: 'Zichtbaarheid Org', createdBy: uid, createdAt: new Date() });
    await orgRef.collection('organizationMembers').doc(uid).set({
      role: 'viewer',
      email,
      uid,
      joinedAt: new Date(),
    });
    const teamAllowedRef = orgRef.collection('teams').doc();
    await teamAllowedRef.set({ name: 'Toegestaan team', createdBy: uid, createdAt: new Date() });
    const teamHiddenRef = orgRef.collection('teams').doc();
    await teamHiddenRef.set({ name: 'Verborgen team', createdBy: uid, createdAt: new Date() });
    // Expliciet teamMembers-document alléén voor teamAllowedRef.
    await teamAllowedRef.collection('teamMembers').doc(uid).set({
      role: 'coach',
      email,
      addedAt: new Date(),
    });

    await page.reload();
    await page.waitForSelector(`[data-testid="context-org-${orgRef.id}"]`, { timeout: 10_000 });
    await page.getByTestId(`context-org-${orgRef.id}`).click();
    await page.waitForSelector(`[data-testid="context-team-${teamAllowedRef.id}"]`, {
      timeout: 10_000,
    });
    await expect(page.getByTestId(`context-team-${teamHiddenRef.id}`)).toHaveCount(0);
  });

  test('intrekking van uitsluitend teamMembers/{uid} trekt de actieve context in, ook als het organisatiemembership blijft bestaan', async ({
    page,
  }) => {
    const email = uniqueTestEmail('teamrevoke');
    const password = 'TeamRevoke123!';
    await signUp(page, email, password);
    await answerTrustedDevice(page, true);
    await page.waitForSelector('[data-testid="no-organizations-body"]', { timeout: 10_000 });

    const uid = await lookupUidByEmail(email, password);
    const db = adminDb();
    const orgRef = db.collection('organizations').doc();
    await orgRef.set({ name: 'Intrekking Org', createdBy: uid, createdAt: new Date() });
    await orgRef.collection('organizationMembers').doc(uid).set({
      role: 'viewer',
      email,
      uid,
      joinedAt: new Date(),
    });
    const teamRef = orgRef.collection('teams').doc();
    await teamRef.set({ name: 'Team', createdBy: uid, createdAt: new Date() });
    const teamMemberRef = teamRef.collection('teamMembers').doc(uid);
    await teamMemberRef.set({ role: 'coach', email, addedAt: new Date() });

    await page.reload();
    await page.waitForSelector(`[data-testid="context-org-${orgRef.id}"]`, { timeout: 10_000 });
    await page.getByTestId(`context-org-${orgRef.id}`).click();
    await page.waitForSelector(`[data-testid="context-team-${teamRef.id}"]`, { timeout: 10_000 });
    await page.getByTestId(`context-team-${teamRef.id}`).click();
    await expect(page.getByTestId('nav-settings')).toBeVisible();

    // Trek UITSLUITEND de teamtoegang in — het organisatiemembership blijft intact, dus de
    // oude, org-only check zou dit gemist hebben.
    await teamMemberRef.delete();

    await page.reload();
    await page.waitForSelector('[data-testid="context-revoked-body"]', { timeout: 10_000 });
    await expect(page.getByTestId('nav-settings')).toHaveCount(0);
  });
});

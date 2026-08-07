import { test, expect } from '@playwright/test';
import { adminDb, lookupUidByEmail } from './adminFixtures';
import { signUp, answerTrustedDevice, uniqueTestEmail } from './helpers';

// Issue #31 (owner-besluit: nu oplossen in PR #30, niet uitstellen — zie PR-review).
// Een team-only gebruiker heeft in een organisatie UITSLUITEND een expliciet
// `teamMembers`-document, geen enkel `organizationMembers`-document — bijv. een coach/
// scorer/viewer die alleen aan één specifiek team is toegevoegd. Vóór deze fix bouwde
// `AuthGate` de contextlijst uitsluitend op uit `listMyMemberships()` (organisatieniveau),
// dus zulke gebruikers zagen na inloggen altijd het "geen organisaties"-onboardingscherm,
// ongeacht hun daadwerkelijke teamtoegang.
test.describe('team-only lidmaatschap (issue #31): geen enkel organizationMembers-document', () => {
  test('ziet en kan al zijn team-only organisaties selecteren, en geen organisatie waar hij geen toegang toe heeft', async ({
    page,
  }) => {
    const email = uniqueTestEmail('teamonly');
    const password = 'TeamOnly123!';
    await signUp(page, email, password);
    await answerTrustedDevice(page, true);
    await page.waitForSelector('[data-testid="no-organizations-body"]', { timeout: 10_000 });

    const uid = await lookupUidByEmail(email, password);
    const db = adminDb();

    // Org A: team-only lid als coach van precies één team, geen organizationMembers-document.
    const orgARef = db.collection('organizations').doc();
    await orgARef.set({
      name: 'Team-only Org A',
      createdBy: 'iemand-anders',
      createdAt: new Date(),
    });
    const teamA1Ref = orgARef.collection('teams').doc();
    await teamA1Ref.set({
      name: 'Team A1',
      orgName: 'Team-only Org A',
      createdBy: 'iemand-anders',
      createdAt: new Date(),
    });
    await teamA1Ref.collection('teamMembers').doc(uid).set({
      role: 'coach',
      email,
      uid,
      addedAt: new Date(),
    });

    // Org B: TWEEDE team-only organisatie (bewijst de multi-org-positiefquery, net als
    // firebase/tests/rules/team-context-switcher-query.spec.ts op Rules-niveau).
    const orgBRef = db.collection('organizations').doc();
    await orgBRef.set({
      name: 'Team-only Org B',
      createdBy: 'iemand-anders',
      createdAt: new Date(),
    });
    const teamB1Ref = orgBRef.collection('teams').doc();
    await teamB1Ref.set({
      name: 'Team B1',
      orgName: 'Team-only Org B',
      createdBy: 'iemand-anders',
      createdAt: new Date(),
    });
    await teamB1Ref.collection('teamMembers').doc(uid).set({
      role: 'viewer',
      email,
      uid,
      addedAt: new Date(),
    });

    // Org C: geen enkele toegang (geen organizationMembers, geen teamMembers) — mag nergens
    // in de contextwisselaar van deze gebruiker verschijnen.
    const orgCRef = db.collection('organizations').doc();
    await orgCRef.set({
      name: 'Ontoegankelijke Org C',
      createdBy: 'iemand-anders',
      createdAt: new Date(),
    });

    await page.reload();
    await page.waitForSelector(`[data-testid="context-org-${orgARef.id}"]`, { timeout: 10_000 });
    await expect(page.getByTestId(`context-org-${orgBRef.id}`)).toBeVisible();
    await expect(page.getByTestId(`context-org-${orgCRef.id}`)).toHaveCount(0);

    // Org A openen: precies Team A1 zichtbaar, met de teamspecifieke rol (coach) — géén
    // netwerkcall naar listTeams()/getMyTeamAccess() nodig/mogelijk voor deze gebruiker (Rules
    // kunnen een ongefilterde lijstquery niet vooraf bewijzen zonder organizationMembers).
    await page.getByTestId(`context-org-${orgARef.id}`).click();
    await page.waitForSelector(`[data-testid="context-team-${teamA1Ref.id}"]`, { timeout: 10_000 });
    await expect(page.getByTestId(`context-team-${teamA1Ref.id}`)).toContainText('coach');

    // Org B openen (klapt A automatisch in): Team B1 zichtbaar met rol viewer.
    await page.getByTestId(`context-org-${orgBRef.id}`).click();
    await page.waitForSelector(`[data-testid="context-team-${teamB1Ref.id}"]`, { timeout: 10_000 });
    await expect(page.getByTestId(`context-team-${teamB1Ref.id}`)).toContainText('viewer');

    // Team B1 selecteren: de gewone App wordt zichtbaar, net als voor een org-lid.
    await page.getByTestId(`context-team-${teamB1Ref.id}`).click();
    await expect(page.getByTestId('nav-settings')).toBeVisible();
  });

  test('intrekking van de enige teamMembers van een team-only gebruiker brengt hem terug naar het onboardingscherm', async ({
    page,
  }) => {
    const email = uniqueTestEmail('teamonlyrevoke');
    const password = 'TeamOnlyRevoke123!';
    await signUp(page, email, password);
    await answerTrustedDevice(page, true);
    await page.waitForSelector('[data-testid="no-organizations-body"]', { timeout: 10_000 });

    const uid = await lookupUidByEmail(email, password);
    const db = adminDb();
    const orgRef = db.collection('organizations').doc();
    await orgRef.set({
      name: 'Enige Team-only Org',
      createdBy: 'iemand-anders',
      createdAt: new Date(),
    });
    const teamRef = orgRef.collection('teams').doc();
    await teamRef.set({
      name: 'Enig Team',
      orgName: 'Enige Team-only Org',
      createdBy: 'iemand-anders',
      createdAt: new Date(),
    });
    const teamMemberRef = teamRef.collection('teamMembers').doc(uid);
    await teamMemberRef.set({ role: 'scorer', email, uid, addedAt: new Date() });

    await page.reload();
    await page.waitForSelector(`[data-testid="context-org-${orgRef.id}"]`, { timeout: 10_000 });
    await page.getByTestId(`context-org-${orgRef.id}`).click();
    await page.waitForSelector(`[data-testid="context-team-${teamRef.id}"]`, { timeout: 10_000 });
    await page.getByTestId(`context-team-${teamRef.id}`).click();
    await expect(page.getByTestId('nav-settings')).toBeVisible();

    // Dit was de ENIGE toegang van deze gebruiker (geen organizationMembers, geen ander team) —
    // intrekking laat de samengevoegde memberships-lijst leeg achter, dus terug naar
    // "geen organisaties" i.p.v. "context ingetrokken" (zie deriveAppState: een lege
    // memberships-lijst wordt eerder gecontroleerd dan de geselecteerde context).
    await teamMemberRef.delete();

    await page.reload();
    await page.waitForSelector('[data-testid="no-organizations-body"]', { timeout: 10_000 });
    await expect(page.getByTestId('nav-settings')).toHaveCount(0);
  });
});

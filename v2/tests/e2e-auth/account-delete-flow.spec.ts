// PR 8.3c-2d (docs/pr-8.3c-2b-plan.md §B.9/§D, docs/pr-8.3c-2c-plan.md §3/§4): e2e voor
// "account verwijderen" tegen de ECHTE Firebase Auth-/Firestore-emulator met de ECHTE
// Security Rules. Volgorde en eindpoort zijn bewezen in vitest (spy-volgorde) en de
// Rules-suite; dit bestand bewijst in een echte browser met serverreadback via Admin:
//
//   - happy path (plan → wachtwoord → verwijderd): daarna faalt inloggen, het Auth-account
//     bestaat niet meer, alle eigen Firestore-documenten zijn weg, al het andere is
//     byte-identiek, lokale-modusdata in localStorage is ongemoeid en de IndexedDB-cache van
//     Firestore is gewist (B7);
//   - verkeerd wachtwoord en "te veel pogingen": niets geschreven;
//   - blokkades: `needs-action`, geen Doorgaan, niets geschreven;
//   - hervatting "Firestore leeg, Auth aanwezig" vanaf het geen-organisaties-scherm;
//   - de eindpoort vlak vóór `deleteUser`: een uitnodiging die NA de opruiming ontstaat,
//     houdt het verwijderen tegen (geen productiecode nodig: de Admin-write gebeurt in een
//     Playwright-route op de tweede reauthenticatie, vóór de eindpoort);
//   - `deleteUser` die mislukt (A5): netwerkfout en `requires-recent-login` geven "je account
//     bestaat nog"; opnieuw proberen slaagt. De Auth-emulator dwingt geen recente aanmelding
//     af (en de app reauthenticeert vlak vóór `deleteUser`), dus `requires-recent-login`
//     komt hier uit een Playwright-route die het emulatorantwoord vervangt door de echte
//     REST-foutcode `CREDENTIAL_TOO_OLD_LOGIN_AGAIN`; de SDK maakt daar zelf
//     `auth/requires-recent-login` van.
import { test, expect, type Page, type Route } from '@playwright/test';
import {
  authAccountExists,
  createUser,
  passwordSignInSucceeds,
  readOwnDocuments,
  seedBystanderOrg,
  seedDeletionRequest,
  seedInvitation,
  seedMember,
  seedOrg,
  seedTeamMember,
  snapshotOrganization,
  type Org,
} from './accountFlowFixtures';
import {
  dialog,
  firestoreIndexedDbNames,
  openAccountPanel,
  readLocalStorage,
  signInAndSelect,
  signInUser,
  text,
} from './accountFlowPage';

const EMPTY = { organizationMembers: [], teamMembers: [], invitations: [] };

// Lokale-modussleutels (v1/lokale modus) die B7 NOOIT mag wissen.
const LOCAL_MODE_KEYS = [
  'lineup-tracker-settings',
  'lineup-tracker-roster',
  'lineup-tracker-games',
  'lineup-tracker-lang',
];

function omit(snapshot: Record<string, unknown>, paths: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(snapshot).filter(([path]) => !paths.includes(path)));
}

async function snapshots(orgs: Org[]): Promise<Record<string, unknown>[]> {
  return Promise.all(orgs.map((org) => snapshotOrganization(org)));
}

/** Een REST-fout van de Auth-API zoals Google hem stuurt (de SDK vertaalt de code zelf). */
async function fulfillAuthError(route: Route, message: string): Promise<void> {
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers });
    return;
  }
  await route.fulfill({
    status: 400,
    headers,
    contentType: 'application/json',
    body: JSON.stringify({
      error: { code: 400, message, errors: [{ message, reason: 'invalid' }] },
    }),
  });
}

async function openDeletePlan(page: Page): Promise<void> {
  await openAccountPanel(page);
  await page.getByTestId('account-delete-start-btn').click();
  await expect(page.getByTestId('account-delete-plan')).toBeVisible({ timeout: 20_000 });
}

async function submitPassword(page: Page, password: string): Promise<void> {
  await page.getByTestId('account-delete-password-input').fill(password);
  await page.getByTestId('account-delete-confirm-btn').click();
}

test.describe('8.3c-2d — account verwijderen: volledige stroom', () => {
  test('plan → wachtwoord → verwijderd: inloggen faalt, eigen data weg, rest en lokale modus intact, Firestore-cache gewist', async ({
    page,
  }) => {
    const orgA = await seedOrg('del-happy Org-A', { teamCount: 2 });
    const orgB = await seedOrg('del-happy Org-B');
    const orgC = await seedOrg('del-happy Org-C');
    const bystander = await seedBystanderOrg('del-happy');
    const other = await createUser('del-happy-ander');
    const user = await createUser('del-happy');
    const [a1 = '', a2 = ''] = orgA.teamIds;
    await seedMember(orgA, other, 'organizationOwner');
    await seedTeamMember(orgA, a1, other, 'coach');
    await seedMember(orgA, user, 'coach');
    await seedTeamMember(orgA, a1, user, 'coach');
    await seedTeamMember(orgA, a2, user, 'viewer');
    await seedTeamMember(orgB, orgB.teamIds[0] ?? '', user, 'scorer'); // team-only
    const invPendingA = await seedInvitation(orgA, user.email, 'pending', 'coach');
    const invClaimedA = await seedInvitation(orgA, user.email, 'claimed');
    const invC = await seedInvitation(orgC, user.email, 'pending'); // alleen uitnodigingen
    await seedInvitation(orgA, `iemand-anders-${orgA.orgId}@example.test`, 'pending');
    const before = await snapshots([orgA, orgB, orgC, bystander]);

    // Lokale-modusdata op dit apparaat (fictief), vóór het inloggen.
    await page.goto('/');
    await page.evaluate(() => {
      window.localStorage.setItem(
        'lineup-tracker-roster',
        JSON.stringify([
          { id: 1, nr: '9', naam: 'Lokale Speler', kl: '2.0', vrouw: false, jeugd: false },
        ]),
      );
      window.localStorage.setItem('lineup-tracker-games', JSON.stringify([]));
    });
    await signInAndSelect(page, user, orgA.orgId, a1);
    const localBefore = await readLocalStorage(page, LOCAL_MODE_KEYS);
    expect(localBefore['lineup-tracker-roster']).toContain('Lokale Speler');
    expect(await firestoreIndexedDbNames(page)).not.toEqual([]);
    // Besluit R7: wat het account op dit apparaat achterliet (fictieve waarden). Geen actieve
    // wedstrijd of afronding in de wachtrij: die blokkeren verwijderen (zie de blokkadetest).
    const r7Keys = [
      `lineup-tracker-v2-migration-run:${orgA.orgId}:${a1}`,
      `lineup-tracker-v2-completed-games:${orgA.orgId}:${a1}`,
      `lineup-tracker-v2-game-sync-checkpoint:game-r7`,
      'lineup-tracker-v2-device-id',
      'lineup-tracker-cloud-imported-settings',
    ];
    await page.evaluate((keys) => {
      for (const key of keys) window.localStorage.setItem(key, JSON.stringify({ fictief: true }));
    }, r7Keys);

    await openDeletePlan(page);
    await expect(page.getByTestId(`account-delete-org-${orgA.orgId}`)).toContainText(
      text('nl', 'accountDeleteClassLeave'),
    );
    await expect(page.getByTestId(`account-delete-org-${orgB.orgId}`)).toContainText(
      text('nl', 'accountDeleteClassLeaveTeamOnly'),
    );
    await expect(page.getByTestId(`account-delete-org-${orgC.orgId}`)).toContainText(
      text('nl', 'accountDeleteClassInvitationsOnly'),
    );
    await expect(page.getByTestId('account-delete-invitations')).toHaveText(
      text('nl', 'accountDeleteInvitations', { count: 3 }),
    );
    await expect(page.getByTestId('account-delete-ready')).toBeVisible();
    // Het plan is read-only.
    expect(await snapshots([orgA, orgB, orgC, bystander])).toEqual(before);

    await page.getByTestId('account-delete-continue-btn').click();
    await expect(dialog(page)).toHaveAttribute(
      'aria-label',
      text('nl', 'accountDeletePasswordTitle'),
    );
    await expect(page.getByTestId('account-delete-password-input')).toHaveAttribute(
      'type',
      'password',
    );
    await submitPassword(page, user.password);
    await expect(page.getByTestId('account-delete-deleted')).toHaveText(
      text('nl', 'accountDeleteDeleted'),
      { timeout: 30_000 },
    );

    // Auth: weg, inloggen faalt.
    expect(await authAccountExists(user.uid)).toBe(false);
    expect(await passwordSignInSucceeds(user.email, user.password)).toBe(false);
    // Firestore: niets van de gebruiker over; de rest byte-identiek.
    expect(await readOwnDocuments(user.uid, user.email)).toEqual(EMPTY);
    const [afterA, afterB, afterC, afterBystander] = await snapshots([orgA, orgB, orgC, bystander]);
    expect(afterA).toEqual(
      omit(before[0] ?? {}, [
        `organizations/${orgA.orgId}/organizationMembers/${user.uid}`,
        `organizations/${orgA.orgId}/teams/${a1}/teamMembers/${user.uid}`,
        `organizations/${orgA.orgId}/teams/${a2}/teamMembers/${user.uid}`,
        invPendingA,
        invClaimedA,
      ]),
    );
    expect(afterB).toEqual(
      omit(before[1] ?? {}, [
        `organizations/${orgB.orgId}/teams/${orgB.teamIds[0] ?? ''}/teamMembers/${user.uid}`,
      ]),
    );
    expect(afterC).toEqual(omit(before[2] ?? {}, [invC]));
    expect(afterBystander).toEqual(before[3]);

    // B7: lokale-modusdata intact, Firestore-IndexedDB-cache gewist.
    expect(await readLocalStorage(page, LOCAL_MODE_KEYS)).toEqual(localBefore);
    expect(await firestoreIndexedDbNames(page)).toEqual([]);
    // R7: de org-gescoopte gegevens, het apparaat-ID en de vlaggen zijn weg.
    expect(Object.values(await readLocalStorage(page, r7Keys))).toEqual(r7Keys.map(() => null));

    // Sluiten → inlogscherm; inloggen met de oude gegevens faalt in de UI.
    await page.getByTestId('account-delete-close-btn').click();
    await expect(page.getByTestId('auth-email')).toBeVisible();
    await page.getByTestId('auth-email').fill(user.typedEmail);
    await page.getByTestId('auth-password').fill(user.password);
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('auth-error')).toBeVisible({ timeout: 15_000 });
  });

  test('verkeerd wachtwoord en "te veel pogingen" schrijven niets; het account blijft', async ({
    page,
  }) => {
    const org = await seedOrg('del-wrongpw Org');
    const bystander = await seedBystanderOrg('del-wrongpw');
    const owner = await createUser('del-wrongpw-owner');
    const user = await createUser('del-wrongpw');
    await seedMember(org, owner, 'organizationOwner');
    await seedMember(org, user, 'viewer');
    await seedTeamMember(org, org.teamIds[0] ?? '', user, 'viewer');
    await seedInvitation(org, user.email, 'pending');
    const before = await snapshots([org, bystander]);

    await signInAndSelect(page, user, org.orgId, org.teamIds[0] ?? '');
    await openDeletePlan(page);
    await page.getByTestId('account-delete-continue-btn').click();
    await submitPassword(page, 'Helemaal-Fout-1!');
    await expect(page.getByTestId('account-delete-password-error')).toHaveText(
      text('nl', 'accountDeleteWrongPassword'),
      { timeout: 20_000 },
    );
    // Het veld is na versturen leeggemaakt (het wachtwoord blijft niet staan).
    await expect(page.getByTestId('account-delete-password-input')).toHaveValue('');
    expect(await snapshots([org, bystander])).toEqual(before);
    expect(await authAccountExists(user.uid)).toBe(true);

    // De Auth-emulator kent geen rate limit: de echte foutcode via een route.
    await page.route(/accounts:signInWithPassword/, (route) =>
      fulfillAuthError(route, 'TOO_MANY_ATTEMPTS_TRY_LATER'),
    );
    await submitPassword(page, user.password);
    await expect(page.getByTestId('account-delete-password-error')).toHaveText(
      text('nl', 'accountDeleteTooManyRequests'),
      { timeout: 20_000 },
    );
    await page.unroute(/accounts:signInWithPassword/);
    expect(await snapshots([org, bystander])).toEqual(before);
    expect(await authAccountExists(user.uid)).toBe(true);
    expect(await passwordSignInSucceeds(user.email, user.password)).toBe(true);
  });

  test('blokkades (enige owner, maker zonder owner, open verwijderverzoek, lokaal werk): needs-action, geen Doorgaan, niets geschreven', async ({
    page,
  }) => {
    const user = await createUser('del-blocked');
    const helper = await createUser('del-blocked-lid');
    const free = await seedOrg('del-blocked Vrij'); // gewoon te verlaten
    const sole = await seedOrg('del-blocked Enige-owner');
    const creator = await seedOrg('del-blocked Maker', { createdBy: user.uid });
    const pending = await seedOrg('del-blocked Verzoek');
    const local = await seedOrg('del-blocked Lokaal', { teamCount: 2 });
    await seedMember(free, helper, 'organizationOwner');
    await seedMember(free, user, 'coach');
    await seedTeamMember(free, free.teamIds[0] ?? '', user, 'coach');
    await seedMember(sole, user, 'organizationOwner');
    await seedMember(sole, helper, 'viewer');
    await seedMember(creator, helper, 'organizationOwner');
    await seedMember(creator, user, 'organizationAdmin');
    await seedMember(pending, user, 'organizationOwner');
    await seedDeletionRequest(pending, user.uid);
    await seedMember(local, helper, 'organizationOwner');
    await seedMember(local, user, 'scorer');
    const all = [free, sole, creator, pending, local];
    const before = await snapshots(all);

    await signInAndSelect(page, user, free.orgId, free.teamIds[0] ?? '');
    await page.evaluate(
      (key) => {
        window.localStorage.setItem(key, JSON.stringify({ phase: 'tracking' }));
      },
      `lineup-tracker-v2-active-game:${local.orgId}:${local.teamIds[1] ?? ''}`,
    );
    await openDeletePlan(page);

    await expect(page.getByTestId('account-delete-blocked')).toHaveText(
      text('nl', 'accountDeleteBlockedTitle'),
    );
    await expect(page.getByTestId('account-delete-continue-btn')).toHaveCount(0);
    await expect(page.getByTestId('account-delete-recheck-btn')).toBeVisible();
    const row = (org: Org) => page.getByTestId(`account-delete-org-${org.orgId}`);
    await expect(row(free)).toHaveAttribute('data-blocked', 'false');
    await expect(row(sole)).toHaveAttribute('data-blocked', 'true');
    await expect(row(sole)).toContainText(text('nl', 'accountDeleteClassOwnerSole'));
    await expect(page.getByTestId(`account-delete-transfer-${sole.orgId}`)).toBeVisible();
    await expect(row(creator)).toContainText(text('nl', 'accountDeleteClassCreatorNeedsOwner'));
    await expect(row(pending)).toContainText(text('nl', 'accountDeleteClassAwaitingDeletion'));
    await expect(row(local)).toContainText(text('nl', 'accountDeleteClassLocalWork', { count: 1 }));

    // Opnieuw controleren verandert niets aan het plan en schrijft niets.
    await page.getByTestId('account-delete-recheck-btn').click();
    await expect(page.getByTestId('account-delete-blocked')).toBeVisible({ timeout: 20_000 });
    expect(await snapshots(all)).toEqual(before);
    expect(await authAccountExists(user.uid)).toBe(true);
  });
});

test.describe('8.3c-2d — account verwijderen: hervatting, eindpoort en mislukte deleteUser', () => {
  test('"Firestore leeg, Auth aanwezig": vanaf het geen-organisaties-scherm alleen nog het account', async ({
    page,
  }) => {
    const bystander = await seedBystanderOrg('del-resume');
    const before = await snapshotOrganization(bystander);
    const user = await createUser('del-resume');
    await signInUser(page, user);
    await expect(page.getByTestId('no-organizations-body')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('no-org-delete-account-btn').click();
    await expect(page.getByTestId('account-delete-auth-only')).toHaveText(
      text('nl', 'accountDeleteAuthOnly'),
      { timeout: 20_000 },
    );
    await page.getByTestId('account-delete-continue-btn').click();
    await submitPassword(page, user.password);
    await expect(page.getByTestId('account-delete-deleted')).toBeVisible({ timeout: 30_000 });
    expect(await authAccountExists(user.uid)).toBe(false);
    expect(await snapshotOrganization(bystander)).toEqual(before);
  });

  test('eindpoort: een uitnodiging die NA de opruiming ontstaat houdt deleteUser tegen; daarna lukt het', async ({
    page,
  }) => {
    const org = await seedOrg('del-gate Org');
    const late = await seedOrg('del-gate Late-Org');
    const owner = await createUser('del-gate-owner');
    const user = await createUser('del-gate');
    await seedMember(org, owner, 'organizationOwner');
    await seedTeamMember(org, org.teamIds[0] ?? '', user, 'coach');

    await signInAndSelect(page, user, org.orgId, org.teamIds[0] ?? '');
    await openDeletePlan(page);
    await page.getByTestId('account-delete-continue-btn').click();

    // Eerste reauth = de opruiming, tweede = `deleteAuthAccount`, vóór eindpoort 5'. Precies
    // daartussen maakt "een beheerder" een nieuwe uitnodiging aan (R3-venster).
    let reauths = 0;
    let lateInvitation = '';
    await page.route(/accounts:signInWithPassword/, async (route) => {
      if (route.request().method() === 'POST') {
        reauths += 1;
        if (reauths === 2) lateInvitation = await seedInvitation(late, user.email, 'pending');
      }
      await route.continue();
    });
    let deleteCalls = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && /accounts:delete/.test(request.url())) deleteCalls += 1;
    });
    await submitPassword(page, user.password);
    await expect(page.getByTestId('account-delete-result')).toContainText(
      text('nl', 'accountDeleteIncompleteFinalGate', { members: 0, teams: 0, invitations: 1 }),
      { timeout: 30_000 },
    );
    await page.unroute(/accounts:signInWithPassword/);
    expect(reauths).toBe(2);
    expect(deleteCalls).toBe(0);
    expect(await authAccountExists(user.uid)).toBe(true);
    const own = await readOwnDocuments(user.uid, user.email);
    expect(own.teamMembers).toEqual([]);
    expect(own.invitations).toEqual([`${lateInvitation}#pending`]);

    // Opnieuw: verse beoordeling toont de late organisatie, daarna verwijderd.
    await page.getByTestId('account-delete-retry-btn').click();
    await expect(page.getByTestId(`account-delete-org-${late.orgId}`)).toContainText(
      text('nl', 'accountDeleteClassInvitationsOnly'),
      { timeout: 20_000 },
    );
    await page.getByTestId('account-delete-continue-btn').click();
    await submitPassword(page, user.password);
    await expect(page.getByTestId('account-delete-deleted')).toBeVisible({ timeout: 30_000 });
    expect(await readOwnDocuments(user.uid, user.email)).toEqual(EMPTY);
    expect(await authAccountExists(user.uid)).toBe(false);
  });

  test('deleteUser mislukt (requires-recent-login, daarna netwerk): "je account bestaat nog", opnieuw proberen slaagt', async ({
    page,
  }) => {
    const org = await seedOrg('del-authfail Org');
    const owner = await createUser('del-authfail-owner');
    const user = await createUser('del-authfail');
    await seedMember(org, owner, 'organizationOwner');
    await seedTeamMember(org, org.teamIds[0] ?? '', user, 'viewer');

    await signInAndSelect(page, user, org.orgId, org.teamIds[0] ?? '');
    await openDeletePlan(page);
    await page.getByTestId('account-delete-continue-btn').click();

    // 1. Twee keer requires-recent-login: de coördinator reauthenticeert één keer opnieuw
    //    (B2) en geeft dan op met "account bestaat nog".
    let deleteCalls = 0;
    await page.route(/accounts:delete/, async (route) => {
      if (route.request().method() === 'POST') deleteCalls += 1;
      await fulfillAuthError(route, 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN');
    });
    await submitPassword(page, user.password);
    const result = page.getByTestId('account-delete-result');
    await expect(result).toContainText(text('nl', 'accountDeleteClearedAuthPresent'), {
      timeout: 30_000,
    });
    await expect(result).toContainText(text('nl', 'accountDeleteReasonRecentLogin'));
    expect(deleteCalls).toBe(2);
    expect(await readOwnDocuments(user.uid, user.email)).toEqual(EMPTY);
    expect(await authAccountExists(user.uid)).toBe(true);
    await expect(page.getByTestId('account-delete-deleted')).toHaveCount(0);
    await page.unroute(/accounts:delete/);

    // 2. Netwerkfout op deleteUser (A5): opnieuw "account bestaat nog", reden netwerk.
    await page.route(/accounts:delete/, (route) => route.abort('internetdisconnected'));
    await page.getByTestId('account-delete-retry-btn').click();
    await submitPassword(page, user.password);
    await expect(result).toContainText(text('nl', 'accountDeleteReasonNetwork'), {
      timeout: 30_000,
    });
    expect(await authAccountExists(user.uid)).toBe(true);
    await page.unroute(/accounts:delete/);

    // 3. Opnieuw, zonder storing: verwijderd.
    await page.getByTestId('account-delete-retry-btn').click();
    await submitPassword(page, user.password);
    await expect(page.getByTestId('account-delete-deleted')).toBeVisible({ timeout: 30_000 });
    expect(await authAccountExists(user.uid)).toBe(false);
  });

  test('herladen midden in de flow (na de opruiming, vóór deleteUser): opnieuw starten hervat met alleen het account', async ({
    page,
  }) => {
    const org = await seedOrg('del-reload Org');
    const owner = await createUser('del-reload-owner');
    const user = await createUser('del-reload');
    await seedMember(org, owner, 'organizationOwner');
    await seedMember(org, user, 'coach');
    await seedTeamMember(org, org.teamIds[0] ?? '', user, 'coach');
    await signInAndSelect(page, user, org.orgId, org.teamIds[0] ?? '');
    await openDeletePlan(page);
    await page.getByTestId('account-delete-continue-btn').click();

    // De tweede reauth (in `deleteAuthAccount`, ná de opruiming) blijft hangen; dan herladen.
    let reauths = 0;
    let reachedSecond: () => void = () => undefined;
    const second = new Promise<void>((resolve) => {
      reachedSecond = resolve;
    });
    await page.route(/accounts:signInWithPassword/, async (route) => {
      if (route.request().method() === 'POST') reauths += 1;
      if (reauths === 2) {
        reachedSecond();
        return; // nooit beantwoord: de pagina wordt herladen
      }
      await route.continue();
    });
    await submitPassword(page, user.password);
    await second;
    expect(await readOwnDocuments(user.uid, user.email)).toEqual(EMPTY);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.reload();

    // Na herladen: geen lidmaatschap meer → geen-organisaties-scherm; de sessie bestaat nog.
    await expect(page.getByTestId('no-organizations-body')).toBeVisible({ timeout: 20_000 });
    expect(await authAccountExists(user.uid)).toBe(true);
    await page.getByTestId('no-org-delete-account-btn').click();
    await expect(page.getByTestId('account-delete-auth-only')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('account-delete-continue-btn').click();
    await submitPassword(page, user.password);
    await expect(page.getByTestId('account-delete-deleted')).toBeVisible({ timeout: 30_000 });
    expect(await authAccountExists(user.uid)).toBe(false);
  });
});

// PR 8.3b deel 2/2 (docs/pr-8.3-plan.md §C 8.3b werk 6): de herstelproef
// ("portabiliteitsherstel") voor de organisatie-export. Bewijst dat een
// export die uit organisatie A wordt gebouwd, in een GEHEEL NIEUWE,
// geïsoleerde Emulator-doelorganisatie kan worden teruggeschreven en van
// daaruit — via de ECHTE `FirestoreOrganizationExportGateway`/
// `OrganizationExportCoordinator` en de ECHTE Firestore Security Rules,
// ingelogd als een TWEEDE, eigen eigenaarsaccount — als inhoudelijk
// gelijkwaardige inventaris wordt teruggelezen. De brondata zelf wordt nooit
// aangeraakt (plan werk 6: "bron blijft byte-voor-byte intact").
//
// Bewust GEEN Playwright-`page`/browser-UI nodig: dit bestand roept de
// productiecode rechtstreeks vanuit Node aan (client Firebase SDK, verbonden
// met de Auth-/Firestore-emulator) — precies het "test-only Admin-/
// Emulatorharness die nooit in de productiebuild komt" uit plan werk 6.
// `organizationExportFixtures.ts` (dit PR-deel) levert de seed-/restore-
// hulpfuncties; die zijn zelf ook uitsluitend testcode.
//
// Kon dit NIET lokaal draaien — zelfde sandboxbeperking als
// `organization-export-flow.spec.ts`/`migration-flow.spec.ts`: uitgaand
// verkeer naar `firebase-public.firebaseio.com` (nodig voor de
// Firestore-/Auth-emulator-jars) is in deze sandbox geblokkeerd. Wél
// `tsc -b`/`eslint`/`prettier`-schoon geverifieerd.

import { test, expect } from '@playwright/test';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  type Auth,
} from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { adminDb } from './adminFixtures';
import {
  seedFullOrganization,
  restoreOrganizationExportIntoNewOrg,
  normalizeExportForComparison,
} from './organizationExportFixtures';
import { OrganizationExportCoordinator } from '../../src/application/export/OrganizationExportCoordinator';
import { FirestoreOrganizationExportGateway } from '../../src/infrastructure/export/FirestoreOrganizationExportGateway';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

const PROJECT_ID = 'demo-lineup-tracker-dev';
const PASSWORD = 'RestoreProof123!';

function makeClientApp(name: string): { app: FirebaseApp; auth: Auth; db: Firestore } {
  const app = initializeApp({ projectId: PROJECT_ID, apiKey: 'demo-key' }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, {
    disableWarnings: true,
  });
  const db = getFirestore(app);
  const [host, portStr] = (process.env.FIRESTORE_EMULATOR_HOST as string).split(':');
  connectFirestoreEmulator(db, host as string, Number(portStr));
  return { app, auth, db };
}

test('PR 8.3b deel 2/2 werk 6 — export van organisatie A teruggeschreven naar een nieuwe organisatie B levert een inhoudelijk gelijke inventaris op; bron blijft ongewijzigd', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sourceClient = makeClientApp(`export-restore-source-${suffix}`);
  const targetClient = makeClientApp(`export-restore-target-${suffix}`);

  try {
    const sourceEmail = `restore-source-${suffix}@example.test`;
    const sourceCred = await createUserWithEmailAndPassword(
      sourceClient.auth,
      sourceEmail,
      PASSWORD,
    );
    const sourceUid = sourceCred.user.uid;

    const admin = adminDb();
    const seeded = await seedFullOrganization(admin, {
      orgName: 'Restore-Proof-Bron-Org',
      teamName: 'Restore-Proof-Team',
      ownerUid: sourceUid,
      ownerEmail: sourceEmail,
      coachUid: `coach-${suffix}`,
      coachEmail: 'coach-restore@example.test',
    });

    await signInWithEmailAndPassword(sourceClient.auth, sourceEmail, PASSWORD);
    const sourceGateway = new FirestoreOrganizationExportGateway(sourceClient.db);
    // Diagnostisch: roep de gateway EERST rechtstreeks aan (vóór de
    // coordinator, die een `read-failed`-reden platslaat tot een string
    // zonder de onderliggende fout) zodat een falende read hier een
    // bruikbare foutmelding geeft in plaats van alleen "failed".
    const directRead = await sourceGateway.readOrganizationExportInput(seeded.orgId);
    if (!directRead.ok) {
      const detail =
        directRead.error.code === 'read-failed'
          ? String(
              directRead.error.detail instanceof Error
                ? directRead.error.detail.stack
                : directRead.error.detail,
            )
          : directRead.error.code;
      throw new Error(`bronexport-gateway faalde (${directRead.error.code}): ${detail}`);
    }
    const sourceCoordinator = new OrganizationExportCoordinator(sourceGateway);
    const sourceOutcome = await sourceCoordinator.run({
      organizationId: seeded.orgId,
    });
    if (sourceOutcome.status !== 'ok') {
      throw new Error(`bronexport onverwacht niet ok: ${sourceOutcome.status}`);
    }
    const sourceExport = sourceOutcome.export;
    expect(sourceExport.teams).toHaveLength(1);
    expect(sourceExport.counts.completedGames).toBe(2);

    // Restore: test-only Admin-harness schrijft de export terug naar een
    // GEHEEL NIEUWE organisatie — nooit over de bron heen.
    const targetEmail = `restore-target-${suffix}@example.test`;
    const targetCred = await createUserWithEmailAndPassword(
      targetClient.auth,
      targetEmail,
      PASSWORD,
    );
    const targetUid = targetCred.user.uid;
    const restoredOrgId = await restoreOrganizationExportIntoNewOrg(admin, sourceExport, targetUid);
    expect(restoredOrgId).not.toBe(seeded.orgId);

    // Herreview PR #89 (P1/P2): bewijs de eigenaarssubstitutie zelf, vóór de
    // readback via de coordinator — een falende substitutie zou anders alleen
    // zichtbaar zijn als een generieke 'denied', niet als een duidelijke
    // assertiefout op de daadwerkelijke oorzaak.
    const restoredOwnerMember = await admin
      .collection('organizations')
      .doc(restoredOrgId)
      .collection('organizationMembers')
      .doc(targetUid)
      .get();
    expect(restoredOwnerMember.exists).toBe(true);
    expect(restoredOwnerMember.data()?.role).toBe('organizationOwner');

    await signInWithEmailAndPassword(targetClient.auth, targetEmail, PASSWORD);
    const targetCoordinator = new OrganizationExportCoordinator(
      new FirestoreOrganizationExportGateway(targetClient.db),
    );
    const restoredOutcome = await targetCoordinator.run({
      organizationId: restoredOrgId,
    });
    if (restoredOutcome.status !== 'ok') {
      throw new Error(`herstelde export onverwacht niet ok: ${restoredOutcome.status}`);
    }
    const restoredExport = restoredOutcome.export;

    // Canonieke inventaris (aantallen) moet exact gelijk zijn.
    expect(restoredExport.counts).toEqual(sourceExport.counts);

    // Inhoudelijke gelijkheid, onafhankelijk van de (bewust verschillende)
    // doelorganisatie-identiteit — zie `normalizeExportForComparison()`.
    expect(normalizeExportForComparison(restoredExport)).toEqual(
      normalizeExportForComparison(sourceExport),
    );

    // Bron blijft byte-voor-byte intact: een herhaalde bronexport levert nog
    // steeds exact dezelfde contentHash op als de eerste keer.
    const sourceRereadOutcome = await sourceCoordinator.run({
      organizationId: seeded.orgId,
    });
    if (sourceRereadOutcome.status !== 'ok') {
      throw new Error('herlezen van de bron onverwacht niet ok');
    }
    expect(sourceRereadOutcome.export.contentHash).toBe(sourceExport.contentHash);
  } finally {
    await deleteApp(sourceClient.app);
    await deleteApp(targetClient.app);
  }
});

test('PR 8.3b deel 2/2 werk 6, herreview P1/P2 — eigendomsoverdracht: oprichter is geen lid meer, restore herkent de ACTUELE exporterende eigenaar', async () => {
  // Reproduceert het scenario uit de review: `organization.createdBy` (de
  // OPRICHTER) verschilt van `exportedBy` (de ACTUELE, daadwerkelijk
  // exporterende owner) — bijv. omdat de oprichter is vertrokken en
  // eigendom is overgedragen. Vóór de fix koppelde de restore de
  // eigenaarssubstitutie aan `organization.createdBy`; met een oprichter die
  // geen lid meer is, kreeg de nieuwe doelaccount dan HELEMAAL geen
  // membership.
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sourceClient = makeClientApp(`export-restore-transfer-source-${suffix}`);
  const targetClient = makeClientApp(`export-restore-transfer-target-${suffix}`);

  try {
    const ownerEmail = `restore-transfer-owner-${suffix}@example.test`;
    const ownerCred = await createUserWithEmailAndPassword(sourceClient.auth, ownerEmail, PASSWORD);
    const ownerUid = ownerCred.user.uid;

    const admin = adminDb();
    const seeded = await seedFullOrganization(admin, {
      orgName: 'Restore-Proof-Overdracht-Org',
      teamName: 'Restore-Proof-Overdracht-Team',
      ownerUid,
      ownerEmail,
      coachUid: `coach-${suffix}`,
      coachEmail: 'coach-transfer@example.test',
    });

    // De oprichter is een ANDER, inmiddels vertrokken account — `createdBy`
    // wijst niet meer naar een bestaand `organizationMembers`-document.
    const departedFounderUid = `departed-founder-${suffix}`;
    await admin
      .collection('organizations')
      .doc(seeded.orgId)
      .update({ createdBy: departedFounderUid });

    await signInWithEmailAndPassword(sourceClient.auth, ownerEmail, PASSWORD);
    const sourceGateway = new FirestoreOrganizationExportGateway(sourceClient.db);
    const sourceCoordinator = new OrganizationExportCoordinator(sourceGateway);
    const sourceOutcome = await sourceCoordinator.run({
      organizationId: seeded.orgId,
    });
    if (sourceOutcome.status !== 'ok') {
      throw new Error(`bronexport onverwacht niet ok: ${sourceOutcome.status}`);
    }
    const sourceExport = sourceOutcome.export;
    expect(sourceExport.organization.createdBy).toBe(departedFounderUid);
    expect(sourceExport.exportedBy).toBe(ownerUid);
    expect(sourceExport.organizationMembers.map((m) => m.id)).toEqual([ownerUid]);

    const targetEmail = `restore-transfer-target-${suffix}@example.test`;
    const targetCred = await createUserWithEmailAndPassword(
      targetClient.auth,
      targetEmail,
      PASSWORD,
    );
    const targetUid = targetCred.user.uid;
    const restoredOrgId = await restoreOrganizationExportIntoNewOrg(admin, sourceExport, targetUid);

    const restoredOwnerMember = await admin
      .collection('organizations')
      .doc(restoredOrgId)
      .collection('organizationMembers')
      .doc(targetUid)
      .get();
    expect(restoredOwnerMember.exists).toBe(true);
    expect(restoredOwnerMember.data()?.role).toBe('organizationOwner');

    await signInWithEmailAndPassword(targetClient.auth, targetEmail, PASSWORD);
    const targetCoordinator = new OrganizationExportCoordinator(
      new FirestoreOrganizationExportGateway(targetClient.db),
    );
    const restoredOutcome = await targetCoordinator.run({
      organizationId: restoredOrgId,
    });
    if (restoredOutcome.status !== 'ok') {
      throw new Error(`herstelde export onverwacht niet ok: ${restoredOutcome.status}`);
    }
    expect(restoredOutcome.export.counts).toEqual(sourceExport.counts);
  } finally {
    await deleteApp(sourceClient.app);
    await deleteApp(targetClient.app);
  }
});

test('PR 8.3b deel 2/2, herreview P1 tweede ronde — een ingelogde admin kan de coordinator niet met de uid van de echte owner laten exporteren', async () => {
  // Reproduceert exact het lek uit de review: vóór deze fix nam de gateway
  // een `callerUid`-PARAMETER aan, dus een admin kon simpelweg de owner's
  // uid meegeven (`readCallerRole(orgId, ownerUid)`) — Rules staan toe dat
  // elk orglid ELK `organizationMembers/{uid}`-document leest, dus die read
  // slaagde en leverde `'organizationOwner'` op. Nu neemt
  // `readAuthoritativeCaller()` GEEN identiteitsparameter meer aan: de uid
  // komt uitsluitend uit `getAuth(db.app).currentUser`, de daadwerkelijk
  // ingelogde sessie van DIT Firestore-client-object. Dit bewijst het tegen
  // een echte, apart ingelogde admin-sessie — geen mock.
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ownerClient = makeClientApp(`export-spoof-owner-${suffix}`);
  const adminClient = makeClientApp(`export-spoof-admin-${suffix}`);

  try {
    const ownerEmail = `export-spoof-owner-${suffix}@example.test`;
    const ownerCred = await createUserWithEmailAndPassword(ownerClient.auth, ownerEmail, PASSWORD);
    const ownerUid = ownerCred.user.uid;

    const adminEmail = `export-spoof-admin-${suffix}@example.test`;
    const adminCred = await createUserWithEmailAndPassword(adminClient.auth, adminEmail, PASSWORD);
    const adminUid = adminCred.user.uid;

    const admin = adminDb();
    const seeded = await seedFullOrganization(admin, {
      orgName: 'Export-Spoof-Org',
      teamName: 'Export-Spoof-Team',
      ownerUid,
      ownerEmail,
      coachUid: `coach-${suffix}`,
      coachEmail: 'coach-spoof@example.test',
    });
    // De tweede account is een ECHTE organizationAdmin — geen team-only rol
    // — zodat Rules 'm dezelfde leestoegang geven als de owner tot
    // `organizationMembers`/`invitations`/teamfamilies (isOrgMember()), exact
    // de situatie die het lek mogelijk maakte.
    await admin
      .collection('organizations')
      .doc(seeded.orgId)
      .collection('organizationMembers')
      .doc(adminUid)
      .set({ role: 'organizationAdmin', email: adminEmail, uid: adminUid, joinedAt: new Date() });

    await signInWithEmailAndPassword(adminClient.auth, adminEmail, PASSWORD);
    const adminCoordinator = new OrganizationExportCoordinator(
      new FirestoreOrganizationExportGateway(adminClient.db),
    );
    // Geen enkel veld op `OrganizationExportRequest` kan de owner's uid
    // meegeven — dit is dus geen "geef de verkeerde parameter niet mee"-
    // discipline, maar een structurele onmogelijkheid.
    const outcome = await adminCoordinator.run({ organizationId: seeded.orgId });
    expect(outcome).toEqual({ status: 'denied' });
  } finally {
    await deleteApp(ownerClient.app);
    await deleteApp(adminClient.app);
  }
});

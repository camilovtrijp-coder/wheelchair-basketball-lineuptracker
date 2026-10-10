// PR 8.3c-2b-iii (docs/pr-8.3c-2b-plan.md §B.7, §B.8, §C.3, §D.1 #3, §D.3) — overdracht van
// het eigenaarschap en het intrekken van uitnodigingen tegen de ECHTE Auth-emulator en de
// echte Firestore-emulator met de echte Rules.
//
// Hier draaien de echte v2-gateway en -coördinator (`FirestoreOwnershipTransferGateway`,
// `OwnershipTransferCoordinator`) met echte, in de Auth-emulator aangemaakte gebruikers en
// echte ID-tokens, elk in een eigen app-instantie. Waar een test een write buiten de
// gateway om probeert (een gebruiker die zichzelf promoveert, een intrekking vanuit een
// gesloten status), gebruikt hij exact de pad- en patchbouwers uit
// `v2/src/infrastructure/account/ownershipTransferPaths.ts` die ook de gateway gebruikt.
//
// Vereist `firebase emulators:exec --only firestore,auth`. Alleen fictieve gebruikers,
// adressen en wachtwoorden; het demo-project bestaat alleen in de emulator.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import {
  Timestamp as ClientTimestamp,
  connectFirestoreEmulator,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createTestEnv, withAdmin } from './helpers/testEnv.js';
import { ORG_A, ORG_B, TEAM_A1, TEAM_A2, TEAM_B1, USERS } from './helpers/fixtures.js';
import { dagenGeleden } from './helpers/retention.js';
import { FirestoreOwnershipTransferGateway } from '../../../v2/src/infrastructure/account/FirestoreOwnershipTransferGateway.js';
import { OwnershipTransferCoordinator } from '../../../v2/src/application/account/OwnershipTransferCoordinator.js';
import {
  organizationInvitationRef,
  organizationMemberRef,
  promoteToOwnerPatch,
  revokeInvitationPatch,
} from '../../../v2/src/infrastructure/account/ownershipTransferPaths.js';

const PROJECT_ID = 'demo-lineup-tracker-dev';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const PASSWORD = 'fictief-Wachtwoord-2biii';
const TEAM_A3 = 'team-u15';
const COACH_D = { uid: 'uid-fictief-coach-d', email: 'coach-d-2biii@example.test' };

const EMAILS = {
  ownerA: 'eigenaar-a-2biii@example.test',
  candidateB: 'kandidaat-b-2biii@example.test',
  adminC: 'admin-c-2biii@example.test',
} as const;
type Actor = keyof typeof EMAILS;

interface Session {
  uid: string;
  app: FirebaseApp;
  db: Firestore;
  gateway: FirestoreOwnershipTransferGateway;
  coordinator: OwnershipTransferCoordinator;
}

let env: RulesTestEnvironment;
let appCounter = 0;
let sessions: Record<Actor, Session>;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});

async function clearAuthEmulator() {
  const response = await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: 'DELETE',
  });
  expect(response.ok).toBe(true);
}

async function markEmailVerified(localId: string) {
  const response = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
      body: JSON.stringify({ localId, emailVerified: true }),
    },
  );
  expect(response.ok).toBe(true);
}

/** Een echte gebruiker in de Auth-emulator, ingelogd in een EIGEN app-instantie. */
async function signUp(email: string): Promise<Session> {
  appCounter += 1;
  const app = initializeApp(
    { projectId: PROJECT_ID, apiKey: 'fictieve-demo-sleutel' },
    `2biii-${appCounter}`,
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const credential = await createUserWithEmailAndPassword(auth, email, PASSWORD);
  await markEmailVerified(credential.user.uid);
  await credential.user.getIdToken(true);
  const gateway = new FirestoreOwnershipTransferGateway(db);
  return {
    uid: credential.user.uid,
    app,
    db,
    gateway,
    coordinator: new OwnershipTransferCoordinator(gateway),
  };
}

/**
 * Org A (maker A, 60 dagen oud): A owner, B coach (kandidaat), C admin, D coach (zonder
 * account). A zit in team A1 en A2, D in A1 en A3. Uitnodigingen in org A op A's adres:
 * pending, accepted (andere spelling), claimed, revoked; plus één op D's adres. Org B
 * (owner frank): A is daar ook owner, met een teamMembers-document en een open
 * uitnodiging — alles in org B moet onaangeroerd blijven.
 */
async function seed(createdDaysAgo = 60) {
  const { ownerA, candidateB, adminC } = sessions;
  await withAdmin(env, async (admin) => {
    const orgA = admin.collection('organizations').doc(ORG_A);
    await orgA.set({
      name: 'Org A (fictief)',
      createdBy: ownerA.uid,
      createdAt: dagenGeleden(createdDaysAgo),
    });
    const members: [string, string, string][] = [
      [ownerA.uid, 'organizationOwner', EMAILS.ownerA],
      [candidateB.uid, 'coach', EMAILS.candidateB],
      [adminC.uid, 'organizationAdmin', EMAILS.adminC],
      [COACH_D.uid, 'coach', COACH_D.email],
    ];
    for (const [uid, role, email] of members) {
      await orgA.collection('organizationMembers').doc(uid).set({ role, email, uid });
    }
    for (const teamId of [TEAM_A1, TEAM_A2, TEAM_A3]) {
      await orgA
        .collection('teams')
        .doc(teamId)
        .set({ name: teamId, orgName: 'Org A (fictief)', createdBy: ownerA.uid });
    }
    const teamMember = (teamId: string, uid: string, email: string) =>
      orgA
        .collection('teams')
        .doc(teamId)
        .collection('teamMembers')
        .doc(uid)
        .set({ role: 'coach', email, uid });
    await teamMember(TEAM_A1, ownerA.uid, EMAILS.ownerA);
    await teamMember(TEAM_A2, ownerA.uid, EMAILS.ownerA);
    await teamMember(TEAM_A1, COACH_D.uid, COACH_D.email);
    await teamMember(TEAM_A3, COACH_D.uid, COACH_D.email);

    const invitation = (id: string, data: Record<string, unknown>) =>
      orgA
        .collection('invitations')
        .doc(id)
        .set({
          role: 'organizationAdmin',
          invitedBy: adminC.uid,
          invitedAt: dagenGeleden(1),
          acceptedAt: null,
          ...data,
        });
    await invitation('inv-a-pending', { email: EMAILS.ownerA, status: 'pending' });
    await invitation('inv-a-accepted', {
      email: 'Eigenaar-A-2biii@Example.test',
      status: 'accepted',
      acceptedAt: dagenGeleden(0),
    });
    await invitation('inv-a-claimed', {
      email: EMAILS.ownerA,
      status: 'claimed',
      acceptedAt: dagenGeleden(1),
      claimedAt: dagenGeleden(1),
    });
    await invitation('inv-a-revoked', {
      email: EMAILS.ownerA,
      status: 'revoked',
      revokedAt: dagenGeleden(10),
    });
    await invitation('inv-d', { email: COACH_D.email, status: 'pending' });

    const orgB = admin.collection('organizations').doc(ORG_B);
    await orgB.set({
      name: 'Org B (fictief)',
      createdBy: USERS.frank.uid,
      createdAt: dagenGeleden(60),
    });
    await orgB
      .collection('organizationMembers')
      .doc(USERS.frank.uid)
      .set({ role: 'organizationOwner', email: USERS.frank.email, uid: USERS.frank.uid });
    await orgB
      .collection('organizationMembers')
      .doc(ownerA.uid)
      .set({ role: 'organizationOwner', email: EMAILS.ownerA, uid: ownerA.uid });
    await orgB.collection('teams').doc(TEAM_B1).set({
      name: TEAM_B1,
      orgName: 'Org B (fictief)',
      createdBy: USERS.frank.uid,
    });
    await orgB
      .collection('teams')
      .doc(TEAM_B1)
      .collection('teamMembers')
      .doc(ownerA.uid)
      .set({ role: 'coach', email: EMAILS.ownerA, uid: ownerA.uid });
    await orgB
      .collection('invitations')
      .doc('inv-b')
      .set({
        email: EMAILS.ownerA,
        role: 'organizationOwner',
        status: 'pending',
        invitedBy: USERS.frank.uid,
        invitedAt: dagenGeleden(1),
        acceptedAt: null,
      });
  });
}

/**
 * Elk document dat `seed()` aanmaakt (pad → data), via Admin — voor "niets veranderd": de
 * twee organisatiedocumenten, hun `organizationMembers`, `invitations`, `teams` en per team
 * de `teamMembers`. Andere families seedt deze spec niet (bijv. `deletionRequests`); die
 * vallen buiten deze vergelijking.
 */
async function dumpAll(): Promise<Record<string, unknown>> {
  return withAdmin(env, async (admin) => {
    const out: Record<string, unknown> = {};
    for (const orgId of [ORG_A, ORG_B]) {
      const org = admin.collection('organizations').doc(orgId);
      const orgSnapshot = await org.get();
      if (orgSnapshot.exists) out[org.path] = orgSnapshot.data();
      for (const sub of ['organizationMembers', 'invitations']) {
        for (const entry of (await org.collection(sub).get()).docs) {
          out[entry.ref.path] = entry.data();
        }
      }
      for (const team of (await org.collection('teams').get()).docs) {
        out[team.ref.path] = team.data();
        for (const entry of (await team.ref.collection('teamMembers').get()).docs) {
          out[entry.ref.path] = entry.data();
        }
      }
    }
    return out;
  });
}

async function adminGet(path: string): Promise<Record<string, unknown> | undefined> {
  return withAdmin(env, async (admin) => (await admin.doc(path).get()).data());
}

const memberPath = (orgId: string, uid: string) =>
  `organizations/${orgId}/organizationMembers/${uid}`;
const invitationPath = (orgId: string, id: string) => `organizations/${orgId}/invitations/${id}`;
const teamMemberPath = (orgId: string, teamId: string, uid: string) =>
  `organizations/${orgId}/teams/${teamId}/teamMembers/${uid}`;

async function setRole(orgId: string, uid: string, role: string) {
  await withAdmin(env, async (admin) => {
    await admin.doc(memberPath(orgId, uid)).update({ role });
  });
}

beforeEach(async () => {
  await env.clearFirestore();
  await clearAuthEmulator();
  sessions = {
    ownerA: await signUp(EMAILS.ownerA),
    candidateB: await signUp(EMAILS.candidateB),
    adminC: await signUp(EMAILS.adminC),
  };
});

afterEach(async () => {
  for (const session of Object.values(sessions)) await deleteApp(session.app);
});

describe('overdracht in twee stappen (echte Rules, echte Auth-tokens)', () => {
  it('A promoveert B, B rondt af: A’s open uitnodigingen ingetrokken, teamMembers en membership weg; org B en anderen intact', async () => {
    const { ownerA, candidateB, adminC } = sessions;
    await seed();
    const before = await dumpAll();

    // Stap 0 (A): kandidaten.
    expect(await ownerA.coordinator.listTransferCandidates(ORG_A)).toEqual({
      status: 'ok',
      candidates: expect.arrayContaining([
        { uid: candidateB.uid, role: 'coach', email: EMAILS.candidateB },
        { uid: adminC.uid, role: 'organizationAdmin', email: EMAILS.adminC },
        { uid: COACH_D.uid, role: 'coach', email: COACH_D.email },
      ]),
      otherOwners: [],
    });

    // Stap 1 (A): promoveren. Alleen `role` verandert.
    expect(await ownerA.coordinator.promote(ORG_A, candidateB.uid)).toEqual({
      status: 'ok',
      outcome: 'promoted',
    });
    expect(await adminGet(memberPath(ORG_A, candidateB.uid))).toEqual({
      role: 'organizationOwner',
      email: EMAILS.candidateB,
      uid: candidateB.uid,
    });
    expect(await ownerA.coordinator.promote(ORG_A, candidateB.uid)).toEqual({
      status: 'ok',
      outcome: 'already-owner',
    });
    // A kan de overdracht niet zelf afronden.
    expect(await ownerA.coordinator.completeTransfer(ORG_A, ownerA.uid)).toEqual({
      status: 'denied',
      reason: 'self',
    });
    // B ziet A als andere owner (afleidbare "wacht op bevestiging").
    expect(await candidateB.coordinator.listTransferCandidates(ORG_A)).toMatchObject({
      status: 'ok',
      otherOwners: [{ uid: ownerA.uid, role: 'organizationOwner', email: EMAILS.ownerA }],
    });

    // Stap 2 (B): andere eigenaar verwijderen.
    const startedAt = Date.now();
    expect(await candidateB.coordinator.completeTransfer(ORG_A, ownerA.uid)).toEqual({
      status: 'ok',
      revokedInvitations: 2,
      skippedMalformedInvitations: 0,
      removedTeamMemberships: 2,
      organizationMember: 'deleted',
    });

    const after = await dumpAll();
    // Precies deze paden zijn veranderd of verdwenen; elk ander geseed document (zie
    // `dumpAll`: organisaties, leden, uitnodigingen, teams, teamMembers) is byte-gelijk.
    const changed = Object.keys(before)
      .filter((path) => JSON.stringify(before[path]) !== JSON.stringify(after[path]))
      .sort();
    expect(changed).toEqual(
      [
        memberPath(ORG_A, candidateB.uid), // gepromoveerd
        memberPath(ORG_A, ownerA.uid), // verwijderd
        teamMemberPath(ORG_A, TEAM_A1, ownerA.uid),
        teamMemberPath(ORG_A, TEAM_A2, ownerA.uid),
        invitationPath(ORG_A, 'inv-a-pending'),
        invitationPath(ORG_A, 'inv-a-accepted'),
      ].sort(),
    );
    expect(after[memberPath(ORG_A, ownerA.uid)]).toBeUndefined();
    expect(after[teamMemberPath(ORG_A, TEAM_A1, ownerA.uid)]).toBeUndefined();
    for (const id of ['inv-a-pending', 'inv-a-accepted']) {
      const invitation = after[invitationPath(ORG_A, id)] as Record<string, unknown>;
      expect(invitation.status).toBe('revoked');
      // Servergebonden `revokedAt` (Rules: == request.time).
      const revokedAt = (invitation.revokedAt as { toMillis(): number }).toMillis();
      expect(revokedAt).toBeGreaterThanOrEqual(startedAt - 5_000);
      expect(revokedAt).toBeLessThanOrEqual(Date.now() + 5_000);
    }

    // Idempotent.
    expect(await candidateB.coordinator.completeTransfer(ORG_A, ownerA.uid)).toEqual({
      status: 'not-found',
    });
  });

  it('A kan een ingetrokken uitnodiging daarna niet meer accepteren of claimen (R1, eerlijk overdrachtspad)', async () => {
    const { ownerA, candidateB } = sessions;
    await seed();
    await ownerA.coordinator.promote(ORG_A, candidateB.uid);
    await candidateB.coordinator.completeTransfer(ORG_A, ownerA.uid);

    await expect(
      updateDoc(organizationInvitationRef(ownerA.db, ORG_A, 'inv-a-pending'), {
        status: 'accepted',
        acceptedAt: serverTimestamp(),
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });

    // De uitnodiging met A's exacte token-adres die al accepted was, kan niet meer geclaimd
    // worden (status nu revoked). Seed er één met het exacte adres om de claim zelf te toetsen.
    await withAdmin(env, async (admin) => {
      await admin.doc(invitationPath(ORG_A, 'inv-a-accepted-exact')).set({
        email: EMAILS.ownerA,
        role: 'organizationOwner',
        status: 'accepted',
        invitedBy: candidateB.uid,
        invitedAt: dagenGeleden(1),
        acceptedAt: dagenGeleden(0),
      });
    });
    const revoked = await candidateB.gateway.revokeOpenInvitationsForEmail(ORG_A, EMAILS.ownerA, candidateB.uid);
    expect(revoked).toEqual({ ok: true, revoked: 1, alreadyClosed: 0, skippedMalformed: 0 });
    const batch = writeBatch(ownerA.db);
    batch.update(organizationInvitationRef(ownerA.db, ORG_A, 'inv-a-accepted-exact'), {
      status: 'claimed',
      claimedAt: serverTimestamp(),
    });
    batch.set(organizationMemberRef(ownerA.db, ORG_A, ownerA.uid), {
      role: 'organizationOwner',
      email: EMAILS.ownerA,
      uid: ownerA.uid,
      invitationId: 'inv-a-accepted-exact',
    });
    await expect(batch.commit()).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('R2 (bewust niet opgelost): binnen 7 dagen na createdAt kan een verwijderde maker zich via de bootstrap weer owner maken; daarna niet', async () => {
    const { ownerA, candidateB } = sessions;
    const bootstrap = () =>
      setDoc(organizationMemberRef(ownerA.db, ORG_A, ownerA.uid), {
        role: 'organizationOwner',
        email: EMAILS.ownerA,
        uid: ownerA.uid,
      });

    await seed(60);
    await ownerA.coordinator.promote(ORG_A, candidateB.uid);
    await candidateB.coordinator.completeTransfer(ORG_A, ownerA.uid);
    await expect(bootstrap()).rejects.toMatchObject({ code: 'permission-denied' });

    await env.clearFirestore();
    await seed(1);
    await ownerA.coordinator.promote(ORG_A, candidateB.uid);
    expect(await candidateB.coordinator.completeTransfer(ORG_A, ownerA.uid)).toMatchObject({
      status: 'ok',
    });
    // Restvenster R2: dit slaagt. Gedocumenteerd in ontwerp §B.8/§F en threat model §7.
    await expect(bootstrap()).resolves.toBeUndefined();
  });
});

describe('geen enkele stap voor een niet-owner', () => {
  it('admin C en coach B: coördinator weigert vóór elke write; gateway-writes worden door Rules geweigerd', async () => {
    const { ownerA, candidateB, adminC } = sessions;
    await seed();
    const before = await dumpAll();

    for (const session of [adminC, candidateB]) {
      expect(await session.coordinator.listTransferCandidates(ORG_A)).toEqual({
        status: 'denied',
        reason: 'not-owner',
      });
      expect(await session.coordinator.promote(ORG_A, COACH_D.uid)).toEqual({
        status: 'denied',
        reason: 'not-owner',
      });
      expect(await session.coordinator.completeTransfer(ORG_A, ownerA.uid)).toEqual({
        status: 'denied',
        reason: 'not-owner',
      });
    }

    // Buiten de coördinator om, rechtstreeks via de gateway: de Rules houden het tegen.
    // Een admin kan niemand tot owner maken en geen owner verwijderen.
    expect(await adminC.gateway.promoteToOwner(ORG_A, candidateB.uid, 'coach', adminC.uid)).toEqual({
      ok: false,
      error: { code: 'rejected' },
    });
    expect(
      await adminC.gateway.removeOrganizationMember(ORG_A, ownerA.uid, 'organizationOwner', adminC.uid),
    ).toEqual({ ok: false, error: { code: 'rejected' } });
    // Een coach kan niets van een ander verwijderen, promoveren of intrekken.
    expect(await candidateB.gateway.promoteToOwner(ORG_A, COACH_D.uid, 'coach', candidateB.uid)).toEqual({
      ok: false,
      error: { code: 'rejected' },
    });
    expect(
      await candidateB.gateway.removeOrganizationMember(ORG_A, ownerA.uid, 'organizationOwner', candidateB.uid),
    ).toEqual({ ok: false, error: { code: 'rejected' } });
    expect(await candidateB.gateway.removeTeamMembershipsOf(ORG_A, ownerA.uid, candidateB.uid)).toEqual({
      ok: false,
      error: { code: 'rejected' },
      removed: 0,
    });
    expect(
      await candidateB.gateway.revokeOpenInvitationsForEmail(ORG_A, EMAILS.ownerA, candidateB.uid),
    ).toMatchObject({ ok: false, error: { code: 'failed' }, revoked: 0 });

    expect(await dumpAll()).toEqual(before);
  });

  it('een niet-lid (owner van een andere organisatie) kan in org A niets', async () => {
    const { adminC } = sessions;
    await seed();
    await withAdmin(env, async (admin) => {
      await admin.doc(memberPath(ORG_A, adminC.uid)).delete();
      await admin
        .doc(memberPath(ORG_B, adminC.uid))
        .set({ role: 'organizationOwner', email: EMAILS.adminC, uid: adminC.uid });
    });
    const before = await dumpAll();
    expect(await adminC.coordinator.completeTransfer(ORG_A, sessions.ownerA.uid)).toEqual({
      status: 'denied',
      reason: 'not-a-member',
    });
    expect(await adminC.coordinator.promote(ORG_A, COACH_D.uid)).toEqual({
      status: 'denied',
      reason: 'not-a-member',
    });
    expect(await adminC.gateway.listOrganizationMembers(ORG_A)).toMatchObject({
      ok: false,
      error: { code: 'read-failed' },
    });
    expect(await dumpAll()).toEqual(before);
  });
});

describe('niemand maakt zichzelf owner of admin', () => {
  it('gateway weigert de eigen uid; de echte Rules weigeren dezelfde patch op het eigen document', async () => {
    const { candidateB, adminC } = sessions;
    await seed();
    expect(await candidateB.gateway.promoteToOwner(ORG_A, candidateB.uid, 'coach', candidateB.uid)).toEqual({
      ok: false,
      error: { code: 'self-target' },
    });
    expect(await candidateB.coordinator.promote(ORG_A, candidateB.uid)).toEqual({
      status: 'denied',
      reason: 'not-owner',
    });
    // Buiten de gateway om, met exact dezelfde pad- en patchbouwer.
    for (const session of [candidateB, adminC]) {
      await expect(
        updateDoc(organizationMemberRef(session.db, ORG_A, session.uid), promoteToOwnerPatch()),
      ).rejects.toMatchObject({ code: 'permission-denied' });
    }
    await expect(
      updateDoc(organizationMemberRef(candidateB.db, ORG_A, candidateB.uid), {
        role: 'organizationAdmin',
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await adminGet(memberPath(ORG_A, candidateB.uid)))?.role).toBe('coach');
    expect((await adminGet(memberPath(ORG_A, adminC.uid)))?.role).toBe('organizationAdmin');
  });

  it('een owner kan zichzelf niet verwijderen (ook niet via de gateway)', async () => {
    const { ownerA } = sessions;
    await seed();
    expect(
      await ownerA.gateway.removeOrganizationMember(ORG_A, ownerA.uid, 'organizationOwner', ownerA.uid),
    ).toEqual({ ok: false, error: { code: 'self-target' } });
    expect(await ownerA.gateway.removeTeamMembershipsOf(ORG_A, ownerA.uid, ownerA.uid)).toEqual({
      ok: false,
      error: { code: 'self-target' },
      removed: 0,
    });
    expect(await adminGet(memberPath(ORG_A, ownerA.uid))).toBeDefined();
  });
});

describe('sessiewissel tijdens de flow (expectedCallerUid)', () => {
  it('de sessie is een ANDERE owner dan degene die de flow startte → not-signed-in voor alle vier, niets geschreven', async () => {
    const { ownerA, candidateB } = sessions;
    await seed();
    // candidateB is hier een echte, ingelogde owner (na stap 1); de flow werd door A gestart.
    await setRole(ORG_A, candidateB.uid, 'organizationOwner');
    const before = await adminGet(memberPath(ORG_A, ownerA.uid));
    const notSignedIn = { code: 'not-signed-in' };
    expect(
      await candidateB.gateway.promoteToOwner(ORG_A, COACH_D.uid, 'coach', ownerA.uid),
    ).toEqual({ ok: false, error: notSignedIn });
    expect(
      await candidateB.gateway.revokeOpenInvitationsForEmail(ORG_A, EMAILS.ownerA, ownerA.uid),
    ).toEqual({ ok: false, error: notSignedIn, revoked: 0 });
    expect(await candidateB.gateway.removeTeamMembershipsOf(ORG_A, ownerA.uid, ownerA.uid)).toEqual(
      { ok: false, error: notSignedIn, removed: 0 },
    );
    expect(
      await candidateB.gateway.removeOrganizationMember(
        ORG_A,
        ownerA.uid,
        'organizationOwner',
        ownerA.uid,
      ),
    ).toEqual({ ok: false, error: notSignedIn });
    expect(await adminGet(memberPath(ORG_A, ownerA.uid))).toEqual(before);
    expect((await adminGet(memberPath(ORG_A, COACH_D.uid)))?.role).toBe('coach');
  });
});

describe('rol verandert tijdens de flow (D.1 #3)', () => {
  it('A gedemoveerd tussen preflight en promote → rejected, niets geschreven', async () => {
    const { ownerA, candidateB } = sessions;
    await seed();
    expect(await ownerA.coordinator.listTransferCandidates(ORG_A)).toMatchObject({ status: 'ok' });
    // De admin-seed omzeilt Rules: zo verliest A zijn ownerrol "van buitenaf".
    await setRole(ORG_A, ownerA.uid, 'organizationAdmin');
    expect(await ownerA.gateway.promoteToOwner(ORG_A, candidateB.uid, 'coach', ownerA.uid)).toEqual({
      ok: false,
      error: { code: 'rejected' },
    });
    expect(await ownerA.coordinator.promote(ORG_A, candidateB.uid)).toEqual({
      status: 'denied',
      reason: 'not-owner',
    });
    expect((await adminGet(memberPath(ORG_A, candidateB.uid)))?.role).toBe('coach');
  });

  it('rol van de kandidaat gewijzigd na het lezen → role-changed in de transactie, niets geschreven', async () => {
    const { ownerA, candidateB } = sessions;
    await seed();
    await setRole(ORG_A, candidateB.uid, 'scorer');
    expect(await ownerA.gateway.promoteToOwner(ORG_A, candidateB.uid, 'coach', ownerA.uid)).toEqual({
      ok: false,
      error: { code: 'role-changed', actualRole: 'scorer' },
    });
    expect((await adminGet(memberPath(ORG_A, candidateB.uid)))?.role).toBe('scorer');
  });

  it('B verliest zijn ownerrol vóór completeTransfer → denied, A en zijn uitnodigingen intact', async () => {
    const { ownerA, candidateB } = sessions;
    await seed();
    await ownerA.coordinator.promote(ORG_A, candidateB.uid);
    await setRole(ORG_A, candidateB.uid, 'organizationAdmin');
    const before = await dumpAll();
    expect(await candidateB.coordinator.completeTransfer(ORG_A, ownerA.uid)).toEqual({
      status: 'denied',
      reason: 'not-owner',
    });
    expect(
      await candidateB.gateway.removeOrganizationMember(ORG_A, ownerA.uid, 'organizationOwner', candidateB.uid),
    ).toEqual({ ok: false, error: { code: 'rejected' } });
    expect(await dumpAll()).toEqual(before);
  });

  it('A gedemoveerd (door een andere owner) vóór de laatste write → role-changed, membership blijft', async () => {
    const { ownerA, candidateB } = sessions;
    await seed();
    await ownerA.coordinator.promote(ORG_A, candidateB.uid);
    await setRole(ORG_A, ownerA.uid, 'organizationAdmin');
    expect(
      await candidateB.gateway.removeOrganizationMember(ORG_A, ownerA.uid, 'organizationOwner', candidateB.uid),
    ).toEqual({ ok: false, error: { code: 'role-changed', actualRole: 'organizationAdmin' } });
    expect(await candidateB.coordinator.completeTransfer(ORG_A, ownerA.uid)).toEqual({
      status: 'denied',
      reason: 'target-not-owner',
    });
    expect(await adminGet(memberPath(ORG_A, ownerA.uid))).toBeDefined();
  });
});

describe('revokeOpenInvitationsForEmail (herbruikbaar, R1)', () => {
  it('raakt alleen open uitnodigingen op dat adres in die organisatie; tweede aanroep 0', async () => {
    const { ownerA } = sessions;
    await seed();
    const before = await dumpAll();
    expect(await ownerA.gateway.revokeOpenInvitationsForEmail(ORG_A, COACH_D.email, ownerA.uid)).toEqual({
      ok: true,
      revoked: 1,
      alreadyClosed: 0,
      skippedMalformed: 0,
    });
    const after = await dumpAll();
    const changed = Object.keys(before).filter(
      (path) => JSON.stringify(before[path]) !== JSON.stringify(after[path]),
    );
    expect(changed).toEqual([invitationPath(ORG_A, 'inv-d')]);
    expect(await ownerA.gateway.revokeOpenInvitationsForEmail(ORG_A, COACH_D.email, ownerA.uid)).toEqual({
      ok: true,
      revoked: 0,
      alreadyClosed: 0,
      skippedMalformed: 0,
    });
  });

  it('ook een admin mag intrekken (bestaande Rules-bevoegdheid), een coach niet', async () => {
    const { adminC, candidateB } = sessions;
    await seed();
    expect(await adminC.gateway.revokeOpenInvitationsForEmail(ORG_A, COACH_D.email, adminC.uid)).toEqual({
      ok: true,
      revoked: 1,
      alreadyClosed: 0,
      skippedMalformed: 0,
    });
    expect(
      await candidateB.gateway.revokeOpenInvitationsForEmail(ORG_A, EMAILS.ownerA, candidateB.uid),
    ).toMatchObject({ ok: false, error: { code: 'failed' } });
  });

  it('de Rules accepteren de patch alleen vanuit pending/accepted en alleen met revokedAt == request.time', async () => {
    const { ownerA } = sessions;
    await seed();
    for (const id of ['inv-a-claimed', 'inv-a-revoked']) {
      await expect(
        updateDoc(organizationInvitationRef(ownerA.db, ORG_A, id), revokeInvitationPatch()),
      ).rejects.toMatchObject({ code: 'permission-denied' });
    }
    await expect(
      updateDoc(organizationInvitationRef(ownerA.db, ORG_A, 'inv-d'), {
        status: 'revoked',
        revokedAt: ClientTimestamp.fromDate(dagenGeleden(5)),
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      updateDoc(organizationInvitationRef(ownerA.db, ORG_A, 'inv-d'), revokeInvitationPatch()),
    ).resolves.toBeUndefined();
  });

  it('een misvormde uitnodiging (geen email-veld; ander adres met onbekende rol) blokkeert niet en wordt niet beschreven', async () => {
    const { ownerA } = sessions;
    await seed();
    await withAdmin(env, async (admin) => {
      await admin.doc(invitationPath(ORG_A, 'inv-zonder-adres')).set({
        role: 'coach',
        status: 'pending',
        invitedBy: ownerA.uid,
        invitedAt: dagenGeleden(1),
        acceptedAt: null,
      });
      await admin.doc(invitationPath(ORG_A, 'inv-rare-rol')).set({
        email: 'iemand-anders-2biii@example.test',
        role: 'onbekend',
        status: 'pending',
      });
    });
    const before = await dumpAll();
    expect(await ownerA.gateway.revokeOpenInvitationsForEmail(ORG_A, COACH_D.email, ownerA.uid)).toEqual({
      ok: true,
      revoked: 1,
      alreadyClosed: 0,
      skippedMalformed: 1,
    });
    const after = await dumpAll();
    const changed = Object.keys(before).filter(
      (path) => JSON.stringify(before[path]) !== JSON.stringify(after[path]),
    );
    expect(changed).toEqual([invitationPath(ORG_A, 'inv-d')]);
  });

  // Opruim-PR 2 (reviewnit 1 van #110): een uitnodiging OP het doeladres met een onbekende
  // status blokkeerde de overdracht (fail closed) tot de opruimtermijn. De Rules laten zo'n
  // document niet accepteren (eist `pending`), niet claimen (eist `accepted`) en niet
  // intrekken (eist `pending`/`accepted`): het is inert en wordt nu overgeslagen en geteld.
  it('uitnodiging op het doeladres met onbekende status: Rules weigeren accepteren en intrekken; de overdracht slaat haar over', async () => {
    const { ownerA, candidateB, adminC } = sessions;
    await seed();
    await withAdmin(env, async (admin) => {
      await admin.doc(invitationPath(ORG_A, 'inv-a-onbekend')).set({
        email: EMAILS.ownerA,
        role: 'organizationAdmin',
        status: 'verlopen',
        invitedBy: adminC.uid,
        invitedAt: dagenGeleden(1),
        acceptedAt: null,
      });
    });
    const ref = (db: Firestore) => organizationInvitationRef(db, ORG_A, 'inv-a-onbekend');
    // De uitgenodigde zelf (geverifieerd adres = `email`) kan niet accepteren of claimen.
    await expect(
      updateDoc(ref(ownerA.db), { status: 'accepted', acceptedAt: serverTimestamp() }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      updateDoc(ref(ownerA.db), { status: 'claimed', claimedAt: serverTimestamp() }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    // Owner en admin kunnen haar niet intrekken.
    for (const session of [ownerA, adminC]) {
      await expect(updateDoc(ref(session.db), revokeInvitationPatch())).rejects.toMatchObject({
        code: 'permission-denied',
      });
    }

    await ownerA.coordinator.promote(ORG_A, candidateB.uid);
    expect(await candidateB.coordinator.completeTransfer(ORG_A, ownerA.uid)).toEqual({
      status: 'ok',
      revokedInvitations: 2,
      skippedMalformedInvitations: 1,
      removedTeamMemberships: 2,
      organizationMember: 'deleted',
    });
    expect(await adminGet(invitationPath(ORG_A, 'inv-a-onbekend'))).toMatchObject({
      status: 'verlopen',
    });
  });

  it('org B blijft onaangeroerd: A’s uitnodiging daar staat nog open', async () => {
    const { ownerA } = sessions;
    await seed();
    await ownerA.gateway.revokeOpenInvitationsForEmail(ORG_A, EMAILS.ownerA, ownerA.uid);
    expect((await adminGet(invitationPath(ORG_B, 'inv-b')))?.status).toBe('pending');
    expect(await adminGet(teamMemberPath(ORG_B, TEAM_B1, ownerA.uid))).toBeDefined();
  });
});

// Reviewbevinding A op #108: twee owners (twee apparaten, twee app-instanties, dus geen
// gedeeld slot in de coördinator) verwijderen elkaar TEGELIJK. Zonder de read van het eigen
// membership in de transactie kunnen beide commits volgens de review slagen, waarna org A
// zonder owner achterblijft. Elke iteratie begint met een verse seed; herhaald om te tonen
// dat het geen gelukkige timing is.
//
// Eerlijk over wat de emulator laat zien (2b-iii-fix, 50 iteraties per meting): MET de fix
// 50/50 keer precies één `ok` en één owner, zowel via de gateway als via de coördinator.
// ZONDER de fix (mutatie: geen read van het eigen membership) gaf de gateway-race 10 van de
// 50 keer "beide `rejected`" (de emulator weigert dan beide commits) en nooit "beide `ok`,
// geen owner": het verlies van de laatste owner is in de emulator niet gereproduceerd. De
// coördinator-race bleef ook zonder fix 50/50 groen (de stappen ervoor ontkoppelen de twee
// laatste transacties). Deze test bewijst dus de uitkomst MET de fix tegen de echte Rules;
// dat de fix nodig is, rust op de transactiesemantiek van de client-SDK (unit-test met een
// commit die tussendoor het eigen membership verwijdert) en op reviewbevinding A.
describe('gelijktijdige overdracht: twee owners verwijderen elkaar (reviewbevinding A, #108)', () => {
  const ITERATIONS = 10;

  async function ownersOfOrgA(): Promise<string[]> {
    return withAdmin(env, async (admin) =>
      (await admin.collection(`organizations/${ORG_A}/organizationMembers`).get()).docs
        .filter((entry) => entry.data().role === 'organizationOwner')
        .map((entry) => entry.id)
        .sort(),
    );
  }

  /** Org A met A én B als owner (B is door A gepromoveerd). */
  async function seedTwoOwners() {
    await env.clearFirestore();
    await seed();
    await setRole(ORG_A, sessions.candidateB.uid, 'organizationOwner');
  }

  it(`gateway: removeOrganizationMember over en weer, ${ITERATIONS}×: precies één slaagt, er blijft een owner`, async () => {
    const { ownerA, candidateB } = sessions;
    const tally: string[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      await seedTwoOwners();
      const [byA, byB] = await Promise.all([
        ownerA.gateway.removeOrganizationMember(ORG_A, candidateB.uid, 'organizationOwner', ownerA.uid),
        candidateB.gateway.removeOrganizationMember(ORG_A, ownerA.uid, 'organizationOwner', candidateB.uid),
      ]);
      const owners = await ownersOfOrgA();
      const okCount = [byA, byB].filter((result) => result.ok).length;
      tally.push(`${okCount} ok, ${owners.length} owner(s)`);
    }
    // Eerst de hele reeks, zodat een mutatierun toont hoe vaak het misgaat.
    expect(tally).toEqual(Array.from({ length: ITERATIONS }, () => '1 ok, 1 owner(s)'));
  });

  it('gateway: de verliezer krijgt `rejected` en de winnaar blijft de enige owner', async () => {
    const { ownerA, candidateB } = sessions;
    await seedTwoOwners();
    const [byA, byB] = await Promise.all([
      ownerA.gateway.removeOrganizationMember(ORG_A, candidateB.uid, 'organizationOwner', ownerA.uid),
      candidateB.gateway.removeOrganizationMember(ORG_A, ownerA.uid, 'organizationOwner', candidateB.uid),
    ]);
    const [winner, loser] = byA.ok ? [ownerA, byB] : [candidateB, byA];
    expect(loser).toEqual({ ok: false, error: { code: 'rejected' } });
    expect(await ownersOfOrgA()).toEqual([winner.uid]);
  });

  it(`coördinator: completeTransfer over en weer, ${ITERATIONS}×: precies één ok, er blijft een owner`, async () => {
    const { ownerA, candidateB } = sessions;
    const tally: string[] = [];
    const loserStatuses: string[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      await seedTwoOwners();
      const [byA, byB] = await Promise.all([
        ownerA.coordinator.completeTransfer(ORG_A, candidateB.uid),
        candidateB.coordinator.completeTransfer(ORG_A, ownerA.uid),
      ]);
      const owners = await ownersOfOrgA();
      const okCount = [byA, byB].filter((outcome) => outcome.status === 'ok').length;
      tally.push(`${okCount} ok, ${owners.length} owner(s)`);
      if (okCount === 1) {
        const [winner, loser] = byA.status === 'ok' ? [ownerA, byB] : [candidateB, byA];
        // De winnaar is de enige overgebleven owner; de verliezer (zelf verwijderd) geen ok.
        expect(owners).toEqual([winner.uid]);
        loserStatuses.push(loser.status);
      }
    }
    expect(tally).toEqual(Array.from({ length: ITERATIONS }, () => '1 ok, 1 owner(s)'));
    // De verliezer stuit op Rules of op zijn verloren ownerrol: `rejected`, `incomplete` of
    // `denied`, nooit `failed` (Opruim-PR 2, reviewnit 2 van #110). Gemeten in 12 runs van
    // deze test (120 races): 120× `incomplete` — 112× bij `pre-removal-check` (de
    // footprint-read van de verliezer wordt geweigerd zodra hij geen lid meer is) en 8× bij
    // `team-members`. `failed/read-failed` is alleen denkbaar als de verliezer na zijn
    // geslaagde owner-check stilvalt tot de winnaar de héle overdracht heeft afgerond; dan
    // weigeren de Rules zijn ledenlijst. Met gelijk gestarte aanroepen treedt dat hier niet
    // op; wordt deze test daardoor ooit rood, dan is dat dat venster, geen verlies van de
    // laatste owner (dat bewaakt de tally hierboven).
    for (const status of loserStatuses) {
      expect(['rejected', 'incomplete', 'denied']).toContain(status);
    }
  });
});

// PR 8.3c-2b-ii (docs/pr-8.3c-2b-plan.md §C.2, §D.1 #8, §D.2 #5) — accountverwijdering
// tegen de ECHTE Auth-emulator én de echte Firestore-emulator met de echte Rules.
//
// Anders dan account-gateway-queries.spec.ts draait hier de echte gateway- en
// coördinatorcode uit v2 (`FirestoreAccountGateway`, `FirebaseAccountAuthGateway`,
// `AccountDeletionCoordinator`) met een echte, in de Auth-emulator aangemaakte gebruiker
// en echte ID-tokens: reauthenticatie met e-mail/wachtwoord, de drie querycontract-
// queries met de token-claims, de self-deletes, de eindpoort en `deleteUser()`.
//
// Vereist `firebase emulators:exec --only firestore,auth` (zet
// FIREBASE_AUTH_EMULATOR_HOST). Alleen fictieve gebruikers en wachtwoorden; het
// demo-project bestaat alleen in de emulator.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createTestEnv, withAdmin } from './helpers/testEnv.js';
import { ORG_A, ORG_B, TEAM_A1, USERS } from './helpers/fixtures.js';
import { dagenGeleden } from './helpers/retention.js';
import { FirestoreAccountGateway } from '../../../v2/src/infrastructure/account/FirestoreAccountGateway.js';
import { FirebaseAccountAuthGateway } from '../../../v2/src/infrastructure/auth/FirebaseAccountAuthGateway.js';
import { AccountDeletionCoordinator } from '../../../v2/src/application/account/AccountDeletionCoordinator.js';

const PROJECT_ID = 'demo-lineup-tracker-dev';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const EMAIL = 'vertrekker-2bii@example.test';
const PASSWORD = 'fictief-Wachtwoord-2bii';

let env: RulesTestEnvironment;
let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let appCounter = 0;

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

/** Zet `emailVerified` in de Auth-emulator (beheer-endpoint, alleen emulator). */
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

/** Een nieuwe gebruiker met geverifieerd adres, ingelogd in een eigen app-instantie. */
async function signUpVerified(): Promise<string> {
  const credential = await createUserWithEmailAndPassword(auth, EMAIL, PASSWORD);
  await markEmailVerified(credential.user.uid);
  await credential.user.getIdToken(true);
  return credential.user.uid;
}

function coordinator() {
  return new AccountDeletionCoordinator(
    new FirestoreAccountGateway(db),
    new FirebaseAccountAuthGateway(auth),
    { countForOrganization: () => 0 },
  );
}

beforeEach(async () => {
  await env.clearFirestore();
  await clearAuthEmulator();
  appCounter += 1;
  app = initializeApp(
    { projectId: PROJECT_ID, apiKey: 'fictieve-demo-sleutel' },
    `2bii-${appCounter}`,
  );
  auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
});

afterEach(async () => {
  await deleteApp(app);
});

describe('FirebaseAccountAuthGateway tegen de Auth-emulator', () => {
  it('reauthenticatie: verkeerd wachtwoord → wrong-password; juist → ok; andere uid → geweigerd', async () => {
    const uid = await signUpVerified();
    const gateway = new FirebaseAccountAuthGateway(auth);

    expect(await gateway.reauthenticateWithPassword('fout-fictief', { expectedUid: uid })).toEqual({
      ok: false,
      code: 'wrong-password',
    });
    expect(await gateway.reauthenticateWithPassword(PASSWORD, { expectedUid: uid })).toEqual({
      ok: true,
    });
    expect(
      await gateway.reauthenticateWithPassword(PASSWORD, { expectedUid: 'uid-fictief-ander' }),
    ).toEqual({ ok: false, code: 'not-signed-in' });
  });

  it('readVerifiedEmailClaim leest de geverifieerde claim uit een vers token', async () => {
    const uid = await signUpVerified();
    expect(await new FirebaseAccountAuthGateway(auth).readVerifiedEmailClaim()).toEqual({
      ok: true,
      uid,
      email: EMAIL,
      verified: true,
    });
  });

  it('deleteCurrentUser met een vreemde expectedUid doet niets; met de eigen uid verwijdert het account', async () => {
    const uid = await signUpVerified();
    const gateway = new FirebaseAccountAuthGateway(auth);
    expect(await gateway.deleteCurrentUser({ expectedUid: 'uid-fictief-ander' })).toEqual({
      ok: false,
      code: 'not-signed-in',
    });
    expect(await gateway.deleteCurrentUser({ expectedUid: uid })).toEqual({ ok: true });
    expect(auth.currentUser).toBeNull();
    await expect(signInWithEmailAndPassword(auth, EMAIL, PASSWORD)).rejects.toMatchObject({
      code: expect.stringMatching(/auth\/(user-not-found|invalid-credential)/),
    });
  });
});

describe('AccountDeletionCoordinator end-to-end (echte Rules, echte Auth-tokens)', () => {
  /**
   * Org A (maker alice): de vertrekker is coach met een teamMembers-document en een
   * open uitnodiging van vandaag (D.2 #5: jonge uitnodiging); in org B heeft hij alleen
   * een geclaimde uitnodiging. Alice' documenten moeten blijven staan.
   */
  async function seed(uid: string) {
    await withAdmin(env, async (admin) => {
      const orgA = admin.collection('organizations').doc(ORG_A);
      await orgA.set({
        name: 'Org A (fictief)',
        createdBy: USERS.alice.uid,
        createdAt: dagenGeleden(60),
      });
      await orgA
        .collection('organizationMembers')
        .doc(USERS.alice.uid)
        .set({ role: 'organizationOwner', email: USERS.alice.email, uid: USERS.alice.uid });
      await orgA
        .collection('organizationMembers')
        .doc(uid)
        .set({ role: 'coach', email: EMAIL, uid });
      await orgA.collection('teams').doc(TEAM_A1).set({
        name: TEAM_A1,
        orgName: 'Org A (fictief)',
        createdBy: USERS.alice.uid,
      });
      await orgA
        .collection('teams')
        .doc(TEAM_A1)
        .collection('teamMembers')
        .doc(uid)
        .set({ role: 'coach', email: EMAIL, uid });
      await orgA
        .collection('invitations')
        .doc('inv-vandaag')
        .set({
          email: EMAIL,
          role: 'organizationAdmin',
          status: 'pending',
          invitedBy: USERS.alice.uid,
          invitedAt: dagenGeleden(0),
          acceptedAt: null,
        });
      const orgB = admin.collection('organizations').doc(ORG_B);
      await orgB.set({
        name: 'Org B (fictief)',
        createdBy: USERS.frank.uid,
        createdAt: dagenGeleden(60),
      });
      await orgB
        .collection('invitations')
        .doc('inv-oud')
        .set({
          email: EMAIL,
          role: 'viewer',
          status: 'claimed',
          invitedBy: USERS.frank.uid,
          invitedAt: dagenGeleden(40),
          acceptedAt: dagenGeleden(39),
        });
    });
  }

  async function remainingOwnDocuments(uid: string): Promise<string[]> {
    return withAdmin(env, async (admin) => {
      const paths: string[] = [];
      for (const [group, field, value] of [
        ['organizationMembers', 'uid', uid],
        ['teamMembers', 'uid', uid],
        ['invitations', 'email', EMAIL],
      ] as const) {
        const snapshot = await admin.collectionGroup(group).where(field, '==', value).get();
        paths.push(...snapshot.docs.map((d) => d.ref.path));
      }
      return paths;
    });
  }

  it('assess → clearFirestoreData → deleteAuthAccount: alles weg, account verwijderd, andermans data intact', async () => {
    const uid = await signUpVerified();
    await seed(uid);
    const flow = coordinator();

    expect(await flow.assess()).toMatchObject({
      status: 'ready-to-clear',
      plan: {
        canProceed: true,
        invitationCount: 2,
        organizations: [
          { organizationId: ORG_A, class: 'leave' },
          { organizationId: ORG_B, class: 'invitations-only' },
        ],
      },
    });

    // Verkeerd wachtwoord: NIETS geschreven (B2).
    expect(await flow.clearFirestoreData('fout-fictief')).toEqual({
      status: 'reauth-failed',
      reason: 'wrong-password',
    });
    expect(await remainingOwnDocuments(uid)).toHaveLength(4);

    expect(await flow.clearFirestoreData(PASSWORD)).toEqual({ status: 'ready-for-auth-deletion' });
    expect(await remainingOwnDocuments(uid)).toEqual([]);
    // Afleidbaar: Firestore leeg, Auth-account nog aanwezig.
    expect(await flow.assess()).toEqual({ status: 'ready-for-auth-deletion' });
    expect(auth.currentUser?.uid).toBe(uid);

    expect(await flow.deleteAuthAccount(PASSWORD)).toEqual({ status: 'deleted' });
    expect(auth.currentUser).toBeNull();
    await expect(signInWithEmailAndPassword(auth, EMAIL, PASSWORD)).rejects.toMatchObject({
      code: expect.stringMatching(/auth\/(user-not-found|invalid-credential)/),
    });

    await withAdmin(env, async (admin) => {
      const alice = await admin
        .collection('organizations')
        .doc(ORG_A)
        .collection('organizationMembers')
        .doc(USERS.alice.uid)
        .get();
      expect(alice.exists).toBe(true);
    });
  });

  it('nieuwe uitnodiging na clearFirestoreData (R3): eindpoort 5′ houdt deleteUser tegen', async () => {
    const uid = await signUpVerified();
    await seed(uid);
    const flow = coordinator();
    expect(await flow.clearFirestoreData(PASSWORD)).toEqual({ status: 'ready-for-auth-deletion' });

    await withAdmin(env, async (admin) => {
      await admin
        .collection('organizations')
        .doc(ORG_A)
        .collection('invitations')
        .doc('inv-nieuw')
        .set({
          email: EMAIL,
          role: 'viewer',
          status: 'pending',
          invitedBy: USERS.alice.uid,
          invitedAt: dagenGeleden(0),
          acceptedAt: null,
        });
    });

    expect(await flow.deleteAuthAccount(PASSWORD)).toEqual({
      status: 'incomplete',
      stage: 'final-gate',
      organizationId: null,
      remaining: { organizationMembers: 0, teamMembers: 0, invitations: 1 },
    });
    // Het account bestaat nog: opnieuw inloggen lukt.
    await signOut(auth);
    await expect(signInWithEmailAndPassword(auth, EMAIL, PASSWORD)).resolves.toBeDefined();
  });

  it('ongeverifieerd e-mailadres → email-not-verified, nul writes en geen deleteUser', async () => {
    const credential = await createUserWithEmailAndPassword(auth, EMAIL, PASSWORD);
    await seed(credential.user.uid);
    const flow = coordinator();
    expect(await flow.clearFirestoreData(PASSWORD)).toEqual({ status: 'email-not-verified' });
    expect(await flow.deleteAuthAccount(PASSWORD)).toEqual({ status: 'email-not-verified' });
    expect(await remainingOwnDocuments(credential.user.uid)).toHaveLength(4);
    expect(auth.currentUser?.uid).toBe(credential.user.uid);
  });
});

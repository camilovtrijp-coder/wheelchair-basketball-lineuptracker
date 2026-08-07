// Bewijst intrekking tijdens queued write, op Node-niveau (review-opvolging #29, P2):
// - Kevin's membership wordt verwijderd terwijl zijn schrijfcontext al bestaat;
// - Na intrekking slaagt een poging om settings te schrijven NIET (permission denied);
// - De server-side data blijft ongewijzigd.
//
// Overgezet uit firebase-spike/tests/rules/offline-revocation-node.spec.ts: de
// `firebase-spike`-CI-job test alleen de oude, losstaande Rules-kopie en beschermt
// firebase/firestore.rules niet — deze regressie moet dus ook hier staan.
// De echte IndexedDB-persistentie (browser-e2e) blijft spike-only en is PR 5.3-scope
// (issue #27); dit Node-scenario bewijst uitsluitend de Rules-afwijzing zelf.

import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createTestEnv, assertSucceeds, assertFails, authCtx, withAdmin } from './helpers/testEnv.js';
import { ORG_A, TEAM_A1, USERS, SAMPLE_SETTINGS } from './helpers/fixtures.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await withAdmin(env, async (db) => {
    await db.collection('organizations').doc(ORG_A).set({ name: 'Org A', createdBy: USERS.alice.uid });
    await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('organizationMembers')
      .doc(USERS.alice.uid)
      .set({ role: 'organizationOwner', email: USERS.alice.email, uid: USERS.alice.uid });
    await db.collection('organizations').doc(ORG_A).collection('teams').doc(TEAM_A1).set({
      name: 'Team A1',
      orgName: 'Org A',
      createdBy: USERS.alice.uid,
    });
    // Kevin heeft een teamMembers-doc → mag settings schrijven als coach.
    await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('teams')
      .doc(TEAM_A1)
      .collection('teamMembers')
      .doc(USERS.kevin.uid)
      .set({ role: 'coach', email: USERS.kevin.email, uid: USERS.kevin.uid });
    await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('teams')
      .doc(TEAM_A1)
      .collection('settings')
      .doc('current')
      .set(SAMPLE_SETTINGS);
  });
});

describe('kevin: toegang ingetrokken terwijl write wordt geprobeerd', () => {
  it('kevin mag schrijven vóór intrekking', async () => {
    const kevinDb = authCtx(env, USERS.kevin.uid, { email: USERS.kevin.email, email_verified: true });
    await assertSucceeds(
      setDoc(doc(kevinDb, 'organizations', ORG_A, 'teams', TEAM_A1, 'settings', 'current'), {
        ...SAMPLE_SETTINGS,
        teamName: 'Kevin was hier',
      }),
    );
  });

  it('kevin mag NIET meer schrijven nadat zijn teamMembers-doc is verwijderd', async () => {
    // Simuleer intrekking: verwijder kevin's membership.
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('teamMembers')
        .doc(USERS.kevin.uid)
        .delete();
    });

    const kevinDb = authCtx(env, USERS.kevin.uid, { email: USERS.kevin.email, email_verified: true });
    await assertFails(
      setDoc(doc(kevinDb, 'organizations', ORG_A, 'teams', TEAM_A1, 'settings', 'current'), {
        ...SAMPLE_SETTINGS,
        teamName: 'Na intrekking',
      }),
    );
  });

  it('server-data is ongewijzigd na mislukte write', async () => {
    // Schrijf initieel als kevin.
    const kevinDb = authCtx(env, USERS.kevin.uid, { email: USERS.kevin.email, email_verified: true });
    await setDoc(doc(kevinDb, 'organizations', ORG_A, 'teams', TEAM_A1, 'settings', 'current'), {
      ...SAMPLE_SETTINGS,
      teamName: 'Vóór intrekking',
    });

    // Trek membership in.
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('teamMembers')
        .doc(USERS.kevin.uid)
        .delete();
    });

    // Probeer te overschrijven — faalt.
    await assertFails(
      setDoc(doc(kevinDb, 'organizations', ORG_A, 'teams', TEAM_A1, 'settings', 'current'), {
        ...SAMPLE_SETTINGS,
        teamName: 'Na intrekking — moet niet op server staan',
      }),
    );

    // Lees de data als alice (owner) — moet de pre-intrekkingswaarde tonen.
    const aliceDb = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    const snap = await getDoc(doc(aliceDb, 'organizations', ORG_A, 'teams', TEAM_A1, 'settings', 'current'));
    expect((snap.data() as Record<string, unknown>)['teamName']).toBe('Vóór intrekking');
  });
});

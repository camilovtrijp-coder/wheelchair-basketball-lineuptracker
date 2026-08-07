// Bewijst directe-pad cross-org isolatie:
// Een gebruiker die lid is van org A kan NIETS lezen of schrijven in org B,
// ook niet via een handmatig samengesteld geldig Firestore-pad.
// Rules zijn geen queryfilters — dit test de fundamentele isolatiegrens.
// Zie context-switcher-query.spec.ts voor de collectionGroup-variant (issue #28).

import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createTestEnv, assertSucceeds, assertFails, authCtx, withAdmin } from './helpers/testEnv.js';
import { ORG_A, ORG_B, TEAM_A1, TEAM_B1, USERS, SAMPLE_SETTINGS, SAMPLE_ROSTER } from './helpers/fixtures.js';

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
    // Org A: dave is scorer op team A1.
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
    await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('teams')
      .doc(TEAM_A1)
      .collection('teamMembers')
      .doc(USERS.dave.uid)
      .set({ role: 'scorer', email: USERS.dave.email, uid: USERS.dave.uid });
    await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('teams')
      .doc(TEAM_A1)
      .collection('settings')
      .doc('current')
      .set(SAMPLE_SETTINGS);

    // Org B: frank is owner, dave heeft GEEN membership.
    await db.collection('organizations').doc(ORG_B).set({ name: 'Org B', createdBy: USERS.frank.uid });
    await db
      .collection('organizations')
      .doc(ORG_B)
      .collection('organizationMembers')
      .doc(USERS.frank.uid)
      .set({ role: 'organizationOwner', email: USERS.frank.email, uid: USERS.frank.uid });
    await db.collection('organizations').doc(ORG_B).collection('teams').doc(TEAM_B1).set({
      name: 'Team B1',
      orgName: 'Org B',
      createdBy: USERS.frank.uid,
    });
    await db
      .collection('organizations')
      .doc(ORG_B)
      .collection('teams')
      .doc(TEAM_B1)
      .collection('settings')
      .doc('current')
      .set(SAMPLE_SETTINGS);
    await db
      .collection('organizations')
      .doc(ORG_B)
      .collection('teams')
      .doc(TEAM_B1)
      .collection('roster')
      .doc('current')
      .set(SAMPLE_ROSTER);
  });
});

describe('dave (lid van org A) probeert org B te lezen of schrijven', () => {
  it('mag settings van org B NIET lezen (geen membership)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email });
    await assertFails(getDoc(doc(db, 'organizations', ORG_B, 'teams', TEAM_B1, 'settings', 'current')));
  });

  it('mag roster van org B NIET lezen (geen membership)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email });
    await assertFails(getDoc(doc(db, 'organizations', ORG_B, 'teams', TEAM_B1, 'roster', 'current')));
  });

  it('mag settings van org B NIET schrijven', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email });
    await assertFails(setDoc(doc(db, 'organizations', ORG_B, 'teams', TEAM_B1, 'settings', 'current'), SAMPLE_SETTINGS));
  });

  it('mag het org B-document NIET lezen', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email });
    await assertFails(getDoc(doc(db, 'organizations', ORG_B)));
  });

  it('mag eigen org A-settings wel lezen (controlegroep)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email });
    await assertSucceeds(getDoc(doc(db, 'organizations', ORG_A, 'teams', TEAM_A1, 'settings', 'current')));
  });
});

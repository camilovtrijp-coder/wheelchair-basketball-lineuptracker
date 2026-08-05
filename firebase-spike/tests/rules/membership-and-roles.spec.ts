// Bewijst item 4 + deel van item 5 uit PR 4.4:
// - één gebruiker (alice) in twee organisaties met verschillende rollen;
// - volledige schrijfmatrix voor settings/roster per rol;
// - org owner/admin hebben impliciete teamtoegang zonder teamMembers-doc.

import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  createTestEnv,
  assertSucceeds,
  assertFails,
  authCtx,
  withAdmin,
} from './helpers/testEnv.js';
import {
  ORG_A, ORG_B, TEAM_A1, TEAM_B1, USERS, SAMPLE_SETTINGS, SAMPLE_ROSTER,
} from './helpers/fixtures.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();

  // Seed minimale fixture via admin.
  await withAdmin(env, async (db) => {
    // Org A
    await db.collection('organizations').doc(ORG_A).set({
      name: 'Rotterdam Basketball (fictief)', createdBy: USERS.alice.uid,
    });
    await db.collection('organizations').doc(ORG_A)
      .collection('organizationMembers').doc(USERS.alice.uid)
      .set({ role: 'organizationOwner', email: USERS.alice.email });
    await db.collection('organizations').doc(ORG_A)
      .collection('organizationMembers').doc(USERS.bob.uid)
      .set({ role: 'organizationAdmin', email: USERS.bob.email });
    await db.collection('organizations').doc(ORG_A)
      .collection('teams').doc(TEAM_A1).set({ name: 'U23', createdBy: USERS.alice.uid });
    // carol = coach, dave = scorer, erin = viewer op team A1
    for (const [uid, role, email] of [
      [USERS.carol.uid, 'coach',  USERS.carol.email],
      [USERS.dave.uid,  'scorer', USERS.dave.email],
      [USERS.erin.uid,  'viewer', USERS.erin.email],
    ] as [string, string, string][]) {
      await db.collection('organizations').doc(ORG_A)
        .collection('teams').doc(TEAM_A1)
        .collection('teamMembers').doc(uid).set({ role, email });
    }
    // Initieel settings/roster
    await db.collection('organizations').doc(ORG_A)
      .collection('teams').doc(TEAM_A1)
      .collection('settings').doc('current').set(SAMPLE_SETTINGS);
    await db.collection('organizations').doc(ORG_A)
      .collection('teams').doc(TEAM_A1)
      .collection('roster').doc('current').set(SAMPLE_ROSTER);

    // Org B
    await db.collection('organizations').doc(ORG_B).set({
      name: 'NBB (fictief)', createdBy: USERS.frank.uid,
    });
    await db.collection('organizations').doc(ORG_B)
      .collection('organizationMembers').doc(USERS.frank.uid)
      .set({ role: 'organizationOwner', email: USERS.frank.email });
    await db.collection('organizations').doc(ORG_B)
      .collection('organizationMembers').doc(USERS.alice.uid)
      .set({ role: 'viewer', email: USERS.alice.email });
    await db.collection('organizations').doc(ORG_B)
      .collection('teams').doc(TEAM_B1).set({ name: 'NBB Selectie', createdBy: USERS.frank.uid });
    await db.collection('organizations').doc(ORG_B)
      .collection('teams').doc(TEAM_B1)
      .collection('settings').doc('current').set(SAMPLE_SETTINGS);
    await db.collection('organizations').doc(ORG_B)
      .collection('teams').doc(TEAM_B1)
      .collection('roster').doc('current').set(SAMPLE_ROSTER);
  });
});

function settingsRef(db: ReturnType<typeof authCtx>, orgId: string, teamId: string) {
  return doc(db, 'organizations', orgId, 'teams', teamId, 'settings', 'current');
}
function rosterRef(db: ReturnType<typeof authCtx>, orgId: string, teamId: string) {
  return doc(db, 'organizations', orgId, 'teams', teamId, 'roster', 'current');
}

describe('alice: organizationOwner in org A, viewer in org B', () => {
  it('mag settings/roster lezen en schrijven in org A (owner)', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertSucceeds(getDoc(settingsRef(db, ORG_A, TEAM_A1)));
    await assertSucceeds(setDoc(settingsRef(db, ORG_A, TEAM_A1), { ...SAMPLE_SETTINGS, teamName: 'Gewijzigd' }));
    await assertSucceeds(getDoc(rosterRef(db, ORG_A, TEAM_A1)));
    await assertSucceeds(setDoc(rosterRef(db, ORG_A, TEAM_A1), SAMPLE_ROSTER));
  });

  it('mag settings/roster lezen in org B (viewer), maar NIET schrijven', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertSucceeds(getDoc(settingsRef(db, ORG_B, TEAM_B1)));
    await assertFails(setDoc(settingsRef(db, ORG_B, TEAM_B1), SAMPLE_SETTINGS));
    await assertSucceeds(getDoc(rosterRef(db, ORG_B, TEAM_B1)));
    await assertFails(setDoc(rosterRef(db, ORG_B, TEAM_B1), SAMPLE_ROSTER));
  });
});

describe('bob: organizationAdmin in org A', () => {
  it('mag settings/roster schrijven (admin heeft impliciete teamtoegang)', async () => {
    const db = authCtx(env, USERS.bob.uid, { email: USERS.bob.email, email_verified: true });
    await assertSucceeds(setDoc(settingsRef(db, ORG_A, TEAM_A1), SAMPLE_SETTINGS));
    await assertSucceeds(setDoc(rosterRef(db, ORG_A, TEAM_A1), SAMPLE_ROSTER));
  });
});

describe('carol: coach op team A1', () => {
  it('mag settings/roster schrijven (coach-rol)', async () => {
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertSucceeds(setDoc(settingsRef(db, ORG_A, TEAM_A1), SAMPLE_SETTINGS));
    await assertSucceeds(setDoc(rosterRef(db, ORG_A, TEAM_A1), SAMPLE_ROSTER));
  });
});

describe('dave: scorer op team A1', () => {
  it('mag settings/roster lezen maar NIET schrijven (scorer-rol)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertSucceeds(getDoc(settingsRef(db, ORG_A, TEAM_A1)));
    await assertFails(setDoc(settingsRef(db, ORG_A, TEAM_A1), SAMPLE_SETTINGS));
    await assertSucceeds(getDoc(rosterRef(db, ORG_A, TEAM_A1)));
    await assertFails(setDoc(rosterRef(db, ORG_A, TEAM_A1), SAMPLE_ROSTER));
  });
});

describe('erin: viewer op team A1', () => {
  it('mag settings/roster lezen maar NIET schrijven (viewer-rol)', async () => {
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    await assertSucceeds(getDoc(settingsRef(db, ORG_A, TEAM_A1)));
    await assertFails(setDoc(settingsRef(db, ORG_A, TEAM_A1), SAMPLE_SETTINGS));
  });
});

describe('niet-ingelogde gebruiker', () => {
  it('mag helemaal niets lezen of schrijven', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'organizations', ORG_A, 'teams', TEAM_A1, 'settings', 'current')));
    await assertFails(setDoc(doc(db, 'organizations', ORG_A, 'teams', TEAM_A1, 'settings', 'current'), SAMPLE_SETTINGS));
  });
});

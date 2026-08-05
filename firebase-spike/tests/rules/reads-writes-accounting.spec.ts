// Instrumenteert drie representatieve flows en rapporteert reads/writes in afterAll.
// De output wordt gebruikt als brondata voor SPIKE_REPORT.md §3.

import { beforeAll, afterAll, describe, it } from 'vitest';
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  createTestEnv, authCtx, withAdmin,
} from './helpers/testEnv.js';
import { ORG_A, TEAM_A1, USERS, SAMPLE_SETTINGS, SAMPLE_ROSTER } from './helpers/fixtures.js';

let env: RulesTestEnvironment;

const counts = {
  loginAndLoad:  { reads: 0, writes: 0 },
  editSave:      { reads: 0, writes: 0 },
  inviteAccept:  { reads: 0, writes: 0 },
};

beforeAll(async () => {
  env = await createTestEnv();
  await env.clearFirestore();
  await withAdmin(env, async (db) => {
    await db.collection('organizations').doc(ORG_A).set({ name: 'Org A', createdBy: USERS.alice.uid });
    await db.collection('organizations').doc(ORG_A)
      .collection('organizationMembers').doc(USERS.alice.uid)
      .set({ role: 'organizationOwner', email: USERS.alice.email });
    await db.collection('organizations').doc(ORG_A)
      .collection('teams').doc(TEAM_A1).set({ name: 'Team A1', createdBy: USERS.alice.uid });
    await db.collection('organizations').doc(ORG_A)
      .collection('teams').doc(TEAM_A1)
      .collection('settings').doc('current').set(SAMPLE_SETTINGS);
    await db.collection('organizations').doc(ORG_A)
      .collection('teams').doc(TEAM_A1)
      .collection('roster').doc('current').set(SAMPLE_ROSTER);
    // Uitnodiging voor grace (pending).
    await db.collection('organizations').doc(ORG_A)
      .collection('invitations').doc('inv-acc-grace').set({
        email: USERS.grace.email, role: 'viewer', status: 'pending',
        invitedBy: USERS.alice.uid, invitedAt: new Date(), acceptedAt: null,
      });
  });
});

afterAll(async () => {
  // Rapport — ook zichtbaar in de CI-output als test-log.
  console.log('\n=== reads/writes-telling per flow ===');
  console.log('Flow 1 (login+laad settings+roster):',
    JSON.stringify(counts.loginAndLoad));
  console.log('Flow 2 (bewerk+sla settings op):',
    JSON.stringify(counts.editSave));
  console.log('Flow 3 (uitnodiging accepteren+membership claimen):',
    JSON.stringify(counts.inviteAccept));
  const totals = {
    reads:  counts.loginAndLoad.reads  + counts.editSave.reads  + counts.inviteAccept.reads,
    writes: counts.loginAndLoad.writes + counts.editSave.writes + counts.inviteAccept.writes,
  };
  console.log('Totaal over 3 flows:', JSON.stringify(totals));
  console.log('(Extrapolatie: ~', totals.reads * 100, 'reads/dag bij 100 dagelijkse sessies');
  console.log(' Spark-gratis-quotum: 50.000 reads/dag, 20.000 writes/dag)');
  console.log('=====================================\n');

  await env.cleanup();
});

describe('Flow 1: laden settings + roster', () => {
  it('telt reads bij het lezen van settings en roster', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await getDoc(doc(db, 'organizations', ORG_A, 'teams', TEAM_A1, 'settings', 'current'));
    counts.loginAndLoad.reads++;
    await getDoc(doc(db, 'organizations', ORG_A, 'teams', TEAM_A1, 'roster', 'current'));
    counts.loginAndLoad.reads++;
    // NB: telt alleen client-zijdige SDK-reads (getDoc/setDoc-aanroepen vanuit de applicatie).
    // Rules-interne get()/exists()-aanroepen voor membership-checks zijn hier niet zichtbaar
    // maar tellen wél mee voor de Firestore-quotastelling server-zijde.
    // Zie §3 SPIKE_REPORT.md voor toelichting en correctiefactor.
  });
});

describe('Flow 2: settings opslaan', () => {
  it('telt reads+writes bij het opslaan van settings', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    // Lees → wijzig in geheugen → schrijf (typisch use-case patroon).
    await getDoc(doc(db, 'organizations', ORG_A, 'teams', TEAM_A1, 'settings', 'current'));
    counts.editSave.reads++;
    await setDoc(
      doc(db, 'organizations', ORG_A, 'teams', TEAM_A1, 'settings', 'current'),
      { ...SAMPLE_SETTINGS, teamName: 'Bijgewerkt (accounting-test)' },
    );
    counts.editSave.writes++;
  });
});

describe('Flow 3: uitnodiging accepteren + membership claimen', () => {
  it('telt reads+writes voor accepteren en claimen', async () => {
    // Stap 1: grace accepteert — alleen status + acceptedAt (conform de rule).
    const graceDb = authCtx(env, USERS.grace.uid, { email: USERS.grace.email, email_verified: true });
    await updateDoc(
      doc(graceDb, 'organizations', ORG_A, 'invitations', 'inv-acc-grace'),
      { status: 'accepted', acceptedAt: new Date() },
    );
    counts.inviteAccept.writes++;

    // Stap 2: grace claimt membership + uitnodiging atomair.
    const batch = writeBatch(graceDb);
    batch.set(
      doc(graceDb, 'organizations', ORG_A, 'organizationMembers', USERS.grace.uid),
      { role: 'viewer', email: USERS.grace.email, invitationId: 'inv-acc-grace', joinedAt: new Date() },
    );
    batch.update(
      doc(graceDb, 'organizations', ORG_A, 'invitations', 'inv-acc-grace'),
      { status: 'claimed', claimedAt: new Date() },
    );
    await batch.commit();
    counts.inviteAccept.writes += 2;
    // Elke batch-write kost de Rule-engine ook een paar interne get()/getAfter()-aanroepen;
    // die zijn hier niet apart geteld maar wel zichtbaar in de emulator-UI.
  });
});

// PR 7.2c (docs/pr-7.2-plan.md §C 7.2c werk 4): reproduceerbare client-
// call-telling voor de completedGames-flows die 7.2a/7.2b/7.2c toevoegen —
// zelfde emulatorproxy-methode en dezelfde beperkingen als
// `pilot-reads-writes-accounting.spec.ts` (PR 5.4c): dit is GEEN Firestore-
// factuurmeting, Rules-interne reads/listener-reconnects zitten er niet in.
// Losstaand bestand (i.p.v. uitbreiding van het PR 5.4c-bestand): andere
// collecties/paden (completedGames i.p.v. settings), eigen scenario's
// (afronden/upload, cloudhistoriequery op twee apparaten, tombstone-delete)
// — vermenging onder één afterAll-samenvatting zou de twee onafhankelijke
// pilotmetingen verwarrend maken. Vergelijk deze emulatorextrapolatie later
// op staging met de 5.5c-baseline (`docs/pr-5.5-onderzoeksrapport.md`).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { doc, getDocs, collection, query, orderBy, updateDoc, writeBatch, Timestamp } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { authCtx, createTestEnv, withAdmin } from './helpers/testEnv.js';
import { ORG_A, TEAM_A1, USERS, sampleGame, sampleCompletedGame } from './helpers/fixtures.js';

type Count = { reads: number; writes: number };

let env: RulesTestEnvironment;

const counts: {
  upload: Count;
  historyQueryTwoDevices: Count;
  tombstoneDelete: Count;
} = {
  upload: { reads: 0, writes: 0 },
  historyQueryTwoDevices: { reads: 0, writes: 0 },
  tombstoneDelete: { reads: 0, writes: 0 },
};

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  const total = Object.values(counts).reduce(
    (sum, count) => ({ reads: sum.reads + count.reads, writes: sum.writes + count.writes }),
    { reads: 0, writes: 0 },
  );
  console.log('\n=== PR 7.2c pilot client-call-telling (completedGames) ===');
  for (const [flow, count] of Object.entries(counts)) console.log(flow, JSON.stringify(count));
  console.log('Totaal drie scenario’s:', JSON.stringify(total));
  console.log(
    '100 volledige pilot-runs (1 afronding + 1 tweede-apparaat-historiebezoek + 1 delete elk):',
    JSON.stringify({ reads: total.reads * 100, writes: total.writes * 100 }),
  );
  console.log('Rules-interne reads en listener-reconnects zijn niet inbegrepen.\n');
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await withAdmin(env, async (db) => {
    await db
      .collection('organizations')
      .doc(ORG_A)
      .set({ name: 'Org A', createdBy: USERS.alice.uid });
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
  });
});

function completedGameRef(db: ReturnType<typeof authCtx>, completedGameId: string) {
  return doc(db, 'organizations', ORG_A, 'teams', TEAM_A1, 'completedGames', completedGameId);
}

function gameRef(db: ReturnType<typeof authCtx>, gameId: string) {
  return doc(db, 'organizations', ORG_A, 'teams', TEAM_A1, 'games', gameId);
}

describe('PR 7.2c pilot client-call-telling (completedGames)', () => {
  it('telt een afronding (finalize-batch: completedGame-create + game-parentpatch)', async () => {
    const deviceA = authCtx(env, USERS.alice.uid, { email: USERS.alice.email });
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-1')
        .set(sampleGame({ writerUid: USERS.alice.uid, deviceId: 'device-alice' }));
    });
    // De Admin-SDK-seed hierboven is geen client-call en telt dus niet mee.
    const batch = writeBatch(deviceA);
    batch.set(
      completedGameRef(deviceA, 'completed-1'),
      sampleCompletedGame({ sourceGameId: 'game-1' }),
    );
    batch.update(gameRef(deviceA, 'game-1'), { completedGameId: 'completed-1', revision: 1 });
    await batch.commit();
    // Eén WriteBatch met twee documentmutaties = twee billable writes.
    counts.upload.writes += 2;

    expect(counts.upload).toEqual({ reads: 0, writes: 2 });
  });

  it('telt een cloudhistoriequery op twee apparaten (apparaat A net afgerond, apparaat B bezoekt Historie)', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('completedGames')
        .doc('completed-1')
        .set(sampleCompletedGame());
    });

    const deviceA = authCtx(env, USERS.alice.uid, { email: USERS.alice.email });
    const deviceB = authCtx(env, USERS.alice.uid, { email: USERS.alice.email });
    const queryRef = (db: ReturnType<typeof authCtx>) =>
      query(
        collection(db, 'organizations', ORG_A, 'teams', TEAM_A1, 'completedGames'),
        orderBy('date', 'desc'),
      );

    const [snapA, snapB] = await Promise.all([getDocs(queryRef(deviceA)), getDocs(queryRef(deviceB))]);
    // Eén query-read per teruggegeven document (Firestore-billingmodel), per apparaat.
    counts.historyQueryTwoDevices.reads += snapA.size + snapB.size;

    expect(counts.historyQueryTwoDevices).toEqual({ reads: 2, writes: 0 });
  });

  it('telt een tombstone-delete (één update-patch)', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('completedGames')
        .doc('completed-1')
        .set(sampleCompletedGame());
    });
    const deviceA = authCtx(env, USERS.alice.uid, { email: USERS.alice.email });
    await updateDoc(completedGameRef(deviceA, 'completed-1'), {
      deletedAt: Timestamp.now(),
      deletedBy: USERS.alice.uid,
      revision: 1,
    });
    counts.tombstoneDelete.writes += 1;

    expect(counts.tombstoneDelete).toEqual({ reads: 0, writes: 1 });
  });
});

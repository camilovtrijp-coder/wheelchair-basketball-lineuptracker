// PR 7.3c (docs/pr-7.3-plan.md §C 7.3c werk 5): reproduceerbare client-
// call-telling voor de overname-/live-viewerflows die 7.3a/7.3b/7.3c
// toevoegen — zelfde emulatorproxy-methode en dezelfde beperkingen als
// `pilot-reads-writes-accounting.spec.ts` (PR 5.4c) en
// `pilot-reads-writes-completed-games.spec.ts` (PR 7.2c): dit is GEEN
// Firestore-factuurmeting, Rules-interne reads/listener-reconnects zitten
// er niet in. `subscribeToGame()`'s ÉÉN-KEER-eerste-snapshot wordt hier via
// `getDoc()`/`getDocs()` gemeten (zelfde billing als een eerste
// `onSnapshot()`-levering) — elke VOLGENDE live update op een open listener
// is in het echte Firestore-billingmodel gratis (geen nieuwe "document
// read" per gewijzigd veld), dus bewust niet apart geteld.
//
// Losstaand bestand — eigen scenario's (live-viewer-eerste-snapshot,
// overname-write, hervatte upload+patch ná overname), geen vermenging met
// de twee bestaande pilotmetingen. Vergelijk deze emulatorextrapolatie later
// op staging met de 5.5c-baseline (`docs/pr-5.5-onderzoeksrapport.md`) — een
// live Firebase-staging-project is vanuit deze sandbox niet bereikbaar, zie
// docs/pr-7.3-plan.md §C 7.3c "Geïmplementeerd" voor de precieze reden.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { doc, getDoc, getDocs, collection, setDoc, updateDoc } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { authCtx, createTestEnv, withAdmin } from './helpers/testEnv.js';
import { ORG_A, TEAM_A1, USERS, sampleGame, sampleGameAction } from './helpers/fixtures.js';

type Count = { reads: number; writes: number };

let env: RulesTestEnvironment;

const counts: {
  viewerInitialSnapshot: Count;
  takeoverWrite: Count;
  postTakeoverUploadAndPatch: Count;
} = {
  viewerInitialSnapshot: { reads: 0, writes: 0 },
  takeoverWrite: { reads: 0, writes: 0 },
  postTakeoverUploadAndPatch: { reads: 0, writes: 0 },
};

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  const total = Object.values(counts).reduce(
    (sum, count) => ({ reads: sum.reads + count.reads, writes: sum.writes + count.writes }),
    { reads: 0, writes: 0 },
  );
  console.log('\n=== PR 7.3c pilot client-call-telling (overname/live-viewer) ===');
  for (const [flow, count] of Object.entries(counts)) console.log(flow, JSON.stringify(count));
  console.log('Totaal drie scenario’s:', JSON.stringify(total));
  console.log(
    '100 volledige pilot-runs (1 viewer-opstart + 1 overname + 1 hervatte upload/patch elk):',
    JSON.stringify({ reads: total.reads * 100, writes: total.writes * 100 }),
  );
  console.log(
    'Rules-interne reads, listener-reconnects en VOLGENDE live-updates op een al-open listener zijn niet inbegrepen.\n',
  );
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
    for (const [uid, role, email] of [
      [USERS.carol.uid, 'coach', USERS.carol.email],
      [USERS.dave.uid, 'scorer', USERS.dave.email],
    ] as [string, string, string][]) {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('teamMembers')
        .doc(uid)
        .set({ role, email, uid });
    }
  });
});

function gameRef(db: ReturnType<typeof authCtx>, gameId: string) {
  return doc(db, 'organizations', ORG_A, 'teams', TEAM_A1, 'games', gameId);
}

function actionsCollection(db: ReturnType<typeof authCtx>, gameId: string) {
  return collection(db, 'organizations', ORG_A, 'teams', TEAM_A1, 'games', gameId, 'actions');
}

describe('PR 7.3c pilot client-call-telling (overname/live-viewer)', () => {
  it('telt de eerste snapshot van een live-viewerabonnement (subscribeToGame(): parent + actions)', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-1')
        .set(sampleGame({ writerUid: USERS.alice.uid, deviceId: 'device-alice', phase: 'tracking' }));
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-1')
        .collection('actions')
        .doc('action-1')
        .set(sampleGameAction({ gameId: 'game-1', authorUid: USERS.alice.uid, deviceId: 'device-alice' }));
    });
    const viewerDb = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });

    const [parentSnap, actionsSnap] = await Promise.all([
      getDoc(gameRef(viewerDb, 'game-1')),
      getDocs(actionsCollection(viewerDb, 'game-1')),
    ]);
    // Eén read voor het parentdocument, één read per actiondocument.
    counts.viewerInitialSnapshot.reads += 1 + actionsSnap.size;

    expect(parentSnap.exists()).toBe(true);
    expect(counts.viewerInitialSnapshot).toEqual({ reads: 2, writes: 0 });
  });

  it('telt een overname (10d: één update-patch, epoch +1)', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-1')
        .set(
          sampleGame({
            writerUid: USERS.dave.uid,
            deviceId: 'device-dave',
            writerEpoch: 1,
            claimedAt: '2026-01-01T00:00:00.000Z',
            lastWriterActivityAt: '2026-01-01T00:00:00.000Z',
          }),
        );
    });
    const carolDb = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await updateDoc(gameRef(carolDb, 'game-1'), {
      writerUid: USERS.carol.uid,
      deviceId: 'device-carol',
      writerEpoch: 2,
      claimedAt: '2026-01-01T00:10:00.000Z',
      lastWriterActivityAt: '2026-01-01T00:10:00.000Z',
      revision: 1,
    });
    counts.takeoverWrite.writes += 1;

    expect(counts.takeoverWrite).toEqual({ reads: 0, writes: 1 });
  });

  it('telt een hervatte sync ná overname: N action-uploads + één snapshotpatch', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-1')
        .set(
          sampleGame({
            writerUid: USERS.carol.uid,
            deviceId: 'device-carol',
            writerEpoch: 2,
            claimedAt: '2026-01-01T00:10:00.000Z',
            lastWriterActivityAt: '2026-01-01T00:10:00.000Z',
            revision: 1,
          }),
        );
    });
    const carolDb = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });

    // Twee acties onder het NIEUWE epoch — sequence 0/1, geen collision met
    // wat dave (het oude epoch) al eventueel uploadde (aparte actionId's,
    // aparte create-only-documenten).
    await setDoc(
      doc(actionsCollection(carolDb, 'game-1'), 'action-new-1'),
      sampleGameAction({
        gameId: 'game-1',
        actionId: 'action-new-1',
        authorUid: USERS.carol.uid,
        deviceId: 'device-carol',
        writerEpoch: 2,
        sequence: 0,
      }),
    );
    await setDoc(
      doc(actionsCollection(carolDb, 'game-1'), 'action-new-2'),
      sampleGameAction({
        gameId: 'game-1',
        actionId: 'action-new-2',
        authorUid: USERS.carol.uid,
        deviceId: 'device-carol',
        writerEpoch: 2,
        sequence: 1,
      }),
    );
    counts.postTakeoverUploadAndPatch.writes += 2;

    await updateDoc(gameRef(carolDb, 'game-1'), {
      lastWriterActivityAt: '2026-01-01T00:11:00.000Z',
      revision: 2,
    });
    counts.postTakeoverUploadAndPatch.writes += 1;

    expect(counts.postTakeoverUploadAndPatch).toEqual({ reads: 0, writes: 3 });
  });
});

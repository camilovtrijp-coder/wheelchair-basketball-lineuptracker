// PR 7.2a (docs/pr-7.2-plan.md §C 7.2a, firestore.rules punt 16) — Rules voor
// completedGames/{completedGameId}. Bewijst:
// - lezen voor elk geautoriseerd teamlid, schrijven (create) alleen voor
//   owner/admin/coach/scorer, en alleen door de ACTUELE writer van het
//   sourceGameId-parentdocument;
// - create-only: update/delete altijd geweigerd (bevroren historie-item);
// - volledige schema-/typevalidatie (exacte sleutelset, veldtypen);
// - pad-/payloadcontext (organizationId/teamId) en cross-org/team-isolatie.

import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { doc, setDoc, updateDoc, deleteDoc, getDoc } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createTestEnv, assertSucceeds, assertFails, authCtx, withAdmin } from './helpers/testEnv.js';
import {
  ORG_A,
  ORG_B,
  TEAM_A1,
  TEAM_B1,
  USERS,
  sampleGame,
  sampleCompletedGame,
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
      [USERS.erin.uid, 'viewer', USERS.erin.email],
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

    await db
      .collection('organizations')
      .doc(ORG_B)
      .set({ name: 'Org B', createdBy: USERS.frank.uid });
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

    // game-1 op team A1, dave = huidige writer — de bron voor de
    // completed-snapshots hieronder.
    await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('teams')
      .doc(TEAM_A1)
      .collection('games')
      .doc('game-1')
      .set(sampleGame({ writerUid: USERS.dave.uid, deviceId: 'device-dave' }));
  });
});

function completedGameRef(
  db: ReturnType<typeof authCtx>,
  orgId: string,
  teamId: string,
  completedGameId: string,
) {
  return doc(db, 'organizations', orgId, 'teams', teamId, 'completedGames', completedGameId);
}

describe('completedGames/{completedGameId}: create', () => {
  it('de huidige writer (scorer) mag een completed-snapshot aanmaken', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertSucceeds(
      setDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), sampleCompletedGame()),
    );
  });

  it('een bevoegde gebruiker die niet de huidige writer is mag GEEN completed-snapshot aanmaken', async () => {
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertFails(
      setDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), sampleCompletedGame()),
    );
  });

  it('owner (impliciete toegang, maar niet de huidige writer) mag ook NIET aanmaken', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      setDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), sampleCompletedGame()),
    );
  });

  it('viewer mag GEEN completed-snapshot aanmaken', async () => {
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    await assertFails(
      setDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), sampleCompletedGame()),
    );
  });

  it('mag GEEN organizationId die afwijkt van het pad (vervalste context)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'),
        sampleCompletedGame({ organizationId: ORG_B }),
      ),
    );
  });

  it('mag GEEN teamId die afwijkt van het pad (vervalste context)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'),
        sampleCompletedGame({ teamId: TEAM_B1 }),
      ),
    );
  });

  it('mag GEEN sourceGameId die naar een niet-bestaande wedstrijd verwijst', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'),
        sampleCompletedGame({ sourceGameId: 'game-onbekend' }),
      ),
    );
  });

  it('cross-org: frank (org B) mag GEEN completed-snapshot aanmaken op een wedstrijd van org A', async () => {
    const db = authCtx(env, USERS.frank.uid, { email: USERS.frank.email, email_verified: true });
    await assertFails(
      setDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), sampleCompletedGame()),
    );
  });

  it('mag GEEN document zonder verplicht veld aanmaken (ontbrekende syncedAt)', async () => {
    const { syncedAt: _syncedAt, ...withoutSyncedAt } = sampleCompletedGame();
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(setDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), withoutSyncedAt));
  });

  it('mag GEEN document met een onbekend extra veld aanmaken', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), {
        ...sampleCompletedGame(),
        extraVeld: 'onverwacht',
      }),
    );
  });

  it('mag GEEN niet-array segments aanmaken (verkeerd type)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'),
        sampleCompletedGame({ segments: 'niet-een-array' }),
      ),
    );
  });

  it('mag GEEN niet-ISO-vorm voor date aanmaken', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'),
        sampleCompletedGame({ date: 'niet-een-tijdstip' }),
      ),
    );
  });

  it('niet-ingelogde gebruiker mag niets lezen of schrijven', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), sampleCompletedGame()),
    );
    await assertFails(getDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1')));
  });
});

describe('completedGames/{completedGameId}: read', () => {
  beforeEach(async () => {
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
  });

  it('viewer mag lezen', async () => {
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    await assertSucceeds(getDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1')));
  });

  it('een gebruiker zonder enige membership in org A mag NIET lezen', async () => {
    const db = authCtx(env, USERS.frank.uid, { email: USERS.frank.email, email_verified: true });
    await assertFails(getDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1')));
  });
});

describe('completedGames/{completedGameId}: onveranderlijk (nooit update/delete in fase 7.2a)', () => {
  beforeEach(async () => {
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
  });

  it('de oorspronkelijke writer mag het NIET updaten', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), { scoreFor: 99 }),
    );
  });

  it('owner mag het ook NIET updaten', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      updateDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), { scoreFor: 99 }),
    );
  });

  it('owner mag het NIET verwijderen', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(deleteDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1')));
  });
});

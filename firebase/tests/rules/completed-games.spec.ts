// PR 7.2a (docs/pr-7.2-plan.md §C 7.2a, firestore.rules punt 16) — Rules voor
// completedGames/{completedGameId}. Bewijst:
// - lezen voor elk geautoriseerd teamlid, schrijven (create) alleen voor
//   owner/admin/coach/scorer, en alleen door de ACTUELE writer van het
//   sourceGameId-parentdocument;
// - create-only: update/delete altijd geweigerd (bevroren historie-item);
// - volledige schema-/typevalidatie (exacte sleutelset, veldtypen);
// - pad-/payloadcontext (organizationId/teamId) en cross-org/team-isolatie;
// - [P1, externe review PR #61] atomische binding tussen deze create en de
//   games/{sourceGameId}-finalize-patch via `getAfter()`: een standalone
//   create (zonder de bijbehorende parentpatch in dezelfde batch) faalt
//   altijd, en dezelfde writer kan nooit twee completed-snapshots voor één
//   sourceGameId laten ontstaan — zie `finalizeBatch()` hieronder, die exact
//   spiegelt wat `FirestoreGameCloudGateway.finalizeCompletedGame()` als
//   ÉÉN Firestore-`WriteBatch` verstuurt.

import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { doc, setDoc, updateDoc, deleteDoc, getDoc, writeBatch, Timestamp } from 'firebase/firestore';
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

function gameRef(db: ReturnType<typeof authCtx>, orgId: string, teamId: string, gameId: string) {
  return doc(db, 'organizations', orgId, 'teams', teamId, 'games', gameId);
}

/**
 * Spiegelt exact `FirestoreGameCloudGateway.finalizeCompletedGame()`: ÉÉN
 * atomische `WriteBatch` die zowel de completed-snapshot aanmaakt als
 * `completedGameId`/`revision`/`updatedAt` op het parentdocument patcht.
 * `gameRevision` is de HUIDIGE (vóór deze batch) revisie van `games/{gameId}`.
 */
function finalizeBatch(
  db: ReturnType<typeof authCtx>,
  orgId: string,
  teamId: string,
  gameId: string,
  completedGameId: string,
  gameRevision: number,
  completedGameOverrides: Record<string, unknown> = {},
) {
  const batch = writeBatch(db);
  batch.set(
    completedGameRef(db, orgId, teamId, completedGameId),
    sampleCompletedGame({ sourceGameId: gameId, ...completedGameOverrides }),
  );
  batch.update(gameRef(db, orgId, teamId, gameId), {
    completedGameId,
    revision: gameRevision + 1,
  });
  return batch.commit();
}

describe('completedGames/{completedGameId}: create (atomisch met de parent-finalize-patch)', () => {
  it('de huidige writer (scorer) mag een wedstrijd atomisch afronden (batch: create + parentpatch)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertSucceeds(finalizeBatch(db, ORG_A, TEAM_A1, 'game-1', 'completed-1', 0));
  });

  // P1-fix (externe review PR #61): een standalone create (zonder de
  // bijbehorende parentpatch in DEZELFDE batch) faalt nu altijd — getAfter()
  // ziet dan de ONGEWIJZIGDE parentstaat (completedGameId blijft null), die
  // niet overeenkomt met dit document-ID.
  it('een standalone create ZONDER de parent-finalize-patch in dezelfde batch wordt geweigerd', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), sampleCompletedGame()),
    );
  });

  // P1-fix: dezelfde writer mag NOOIT een tweede completed-snapshot voor
  // dezelfde sourceGameId laten ontstaan. Na een geslaagde eerste batch
  // (completedGameId='completed-1') faalt een tweede batch die een ANDER
  // ID probeert atomisch — de parentpatch-helft eist zelf al
  // `resource.data.completedGameId == null` (punt 15), dus de hele tweede
  // batch faalt, inclusief de create van 'completed-2'.
  it('een tweede finalize-batch voor dezelfde wedstrijd (ander completedGameId) wordt atomisch geweigerd', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertSucceeds(finalizeBatch(db, ORG_A, TEAM_A1, 'game-1', 'completed-1', 0));
    await assertFails(finalizeBatch(db, ORG_A, TEAM_A1, 'game-1', 'completed-2', 1));

    // Bewijs dat de tweede batch ECHT atomisch faalde: geen orphan-snapshot.
    await withAdmin(env, async (adminDb) => {
      const orphan = await adminDb
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('completedGames')
        .doc('completed-2')
        .get();
      expect(orphan.exists).toBe(false);
    });
  });

  // P1-fix: een batch die een completedGames-document aanmaakt maar de
  // parent naar een ANDER ID patcht dan het document-ID zelf (of helemaal
  // niet patcht) is precies het orphan-scenario dat getAfter() moet
  // voorkomen.
  it('een batch met een mismatch tussen het completedGames-ID en de parentpatch wordt geweigerd', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    const batch = writeBatch(db);
    batch.set(
      completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'),
      sampleCompletedGame({ sourceGameId: 'game-1' }),
    );
    batch.update(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
      completedGameId: 'completed-ANDER',
      revision: 1,
    });
    await assertFails(batch.commit());

    await withAdmin(env, async (adminDb) => {
      const orphan = await adminDb
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('completedGames')
        .doc('completed-1')
        .get();
      expect(orphan.exists).toBe(false);
    });
  });

  it('een bevoegde gebruiker die niet de huidige writer is mag GEEN wedstrijd afronden', async () => {
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertFails(finalizeBatch(db, ORG_A, TEAM_A1, 'game-1', 'completed-1', 0));
  });

  it('owner (impliciete toegang, maar niet de huidige writer) mag ook NIET afronden', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(finalizeBatch(db, ORG_A, TEAM_A1, 'game-1', 'completed-1', 0));
  });

  it('viewer mag GEEN wedstrijd afronden', async () => {
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    await assertFails(finalizeBatch(db, ORG_A, TEAM_A1, 'game-1', 'completed-1', 0));
  });

  it('mag GEEN organizationId die afwijkt van het pad (vervalste context)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      finalizeBatch(db, ORG_A, TEAM_A1, 'game-1', 'completed-1', 0, { organizationId: ORG_B }),
    );
  });

  it('mag GEEN teamId die afwijkt van het pad (vervalste context)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      finalizeBatch(db, ORG_A, TEAM_A1, 'game-1', 'completed-1', 0, { teamId: TEAM_B1 }),
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

  it('cross-org: frank (org B) mag GEEN wedstrijd van org A afronden', async () => {
    const db = authCtx(env, USERS.frank.uid, { email: USERS.frank.email, email_verified: true });
    await assertFails(finalizeBatch(db, ORG_A, TEAM_A1, 'game-1', 'completed-1', 0));
  });

  it('mag GEEN document zonder verplicht veld aanmaken (ontbrekende syncedAt)', async () => {
    const { syncedAt: _syncedAt, ...withoutSyncedAt } = sampleCompletedGame();
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    const batch = writeBatch(db);
    batch.set(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), withoutSyncedAt);
    batch.update(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
      completedGameId: 'completed-1',
      revision: 1,
    });
    await assertFails(batch.commit());
  });

  it('mag GEEN document met een onbekend extra veld aanmaken', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    const batch = writeBatch(db);
    batch.set(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), {
      ...sampleCompletedGame(),
      extraVeld: 'onverwacht',
    });
    batch.update(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
      completedGameId: 'completed-1',
      revision: 1,
    });
    await assertFails(batch.commit());
  });

  it('mag GEEN niet-array segments aanmaken (verkeerd type)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      finalizeBatch(db, ORG_A, TEAM_A1, 'game-1', 'completed-1', 0, {
        segments: 'niet-een-array',
      }),
    );
  });

  it('mag GEEN niet-ISO-vorm voor date aanmaken', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      finalizeBatch(db, ORG_A, TEAM_A1, 'game-1', 'completed-1', 0, {
        date: 'niet-een-tijdstip',
      }),
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

// PR 7.2c (docs/pr-7.2-plan.md §C 7.2c werk 1) — de tombstone-fieldpatch:
// een toegestane `deletedAt`/`deletedBy`/`revision`-update, verder identiek
// onveranderlijk. `allow delete` blijft `false` (bewezen hierboven, geldt
// ongewijzigd) — dit hele blok bewijst uitsluitend het NIEUWE `allow
// update`-pad, spiegelt `FirestoreGameCloudGateway.tombstoneCompletedGame()`.
describe('completedGames/{completedGameId}: tombstone-fieldpatch (PR 7.2c)', () => {
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

  function tombstonePatch(uid: string, overrides: Record<string, unknown> = {}) {
    return {
      deletedAt: Timestamp.now(),
      deletedBy: uid,
      revision: 1,
      ...overrides,
    };
  }

  it('owner mag tombstonen', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertSucceeds(
      updateDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), tombstonePatch(USERS.alice.uid)),
    );
  });

  it('coach mag tombstonen', async () => {
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertSucceeds(
      updateDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), tombstonePatch(USERS.carol.uid)),
    );
  });

  it('scorer mag NIET tombstonen (mag wedstrijdacties schrijven, geen afgeronde historie verwijderen)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), tombstonePatch(USERS.dave.uid)),
    );
  });

  it('viewer mag NIET tombstonen', async () => {
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    await assertFails(
      updateDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), tombstonePatch(USERS.erin.uid)),
    );
  });

  it('cross-org: frank (org B) mag NIET tombstonen', async () => {
    const db = authCtx(env, USERS.frank.uid, { email: USERS.frank.email, email_verified: true });
    await assertFails(
      updateDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), tombstonePatch(USERS.frank.uid)),
    );
  });

  it('een coach mag GEEN tombstone "namens" een ander teamlid zetten (deletedBy != request.auth.uid)', async () => {
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertFails(
      updateDoc(
        completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'),
        tombstonePatch(USERS.dave.uid),
      ),
    );
  });

  it('een tombstone-patch mag GEEN ander veld meesturen (bevroren inhoud blijft byte-identiek)', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      updateDoc(
        completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'),
        tombstonePatch(USERS.alice.uid, { scoreFor: 99 }),
      ),
    );
  });

  it('een tombstone-patch met een verouderde revisie wordt geweigerd (optimistische concurrency)', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      updateDoc(
        completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'),
        tombstonePatch(USERS.alice.uid, { revision: 5 }),
      ),
    );
  });

  it('een dubbele tombstone-poging wordt geweigerd (al getombstoned, geen resurrectie-/re-tombstone-pad)', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertSucceeds(
      updateDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), tombstonePatch(USERS.alice.uid)),
    );
    await assertFails(
      updateDoc(
        completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'),
        tombstonePatch(USERS.alice.uid, { revision: 2 }),
      ),
    );
  });

  it('een "undelete"-poging (deletedAt terug naar null) wordt geweigerd', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertSucceeds(
      updateDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), tombstonePatch(USERS.alice.uid)),
    );
    await assertFails(
      updateDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), {
        deletedAt: null,
        deletedBy: null,
        revision: 2,
      }),
    );
  });

  it('een getombstoned item blijft ook onverwijderbaar (allow delete blijft false)', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertSucceeds(
      updateDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1'), tombstonePatch(USERS.alice.uid)),
    );
    await assertFails(deleteDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1')));
  });

  it('viewer mag een getombstoned item nog gewoon lezen (audit/export blijft mogelijk)', async () => {
    const owner = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertSucceeds(
      updateDoc(
        completedGameRef(owner, ORG_A, TEAM_A1, 'completed-1'),
        tombstonePatch(USERS.alice.uid),
      ),
    );
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    await assertSucceeds(getDoc(completedGameRef(db, ORG_A, TEAM_A1, 'completed-1')));
  });
});

// PR 7.2c, externe review op PR #65 (P1): een document dat vóór PR 7.2c is
// aangemaakt (PR 7.2a/7.2b-schema) mist `revision`/`deletedAt`/`deletedBy`
// VOLLEDIG. Dit blok seedt zo'n legacy-document rechtstreeks (geen `create`,
// dat zou nu de nieuwe punt-16-validatie raken) en bewijst dat de tombstone-
// update-regel het toch correct afhandelt via de `('veld' in resource.data)`-
// defaulting.
describe('completedGames/{completedGameId}: backward-compat met een legacy (PR 7.2a/7.2b) document zonder revision/deletedAt/deletedBy (PR 7.2c)', () => {
  function legacyCompletedGame() {
    const { revision: _r, deletedAt: _d, deletedBy: _b, ...legacy } = sampleCompletedGame();
    return legacy;
  }

  beforeEach(async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('completedGames')
        .doc('legacy-1')
        .set(legacyCompletedGame());
    });
  });

  it('een legacy-document kan gewoon gelezen worden', async () => {
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    const snap = await getDoc(completedGameRef(db, ORG_A, TEAM_A1, 'legacy-1'));
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.revision).toBeUndefined();
  });

  it('owner mag een legacy-document tombstonen — revision start impliciet op 0, bevroren inhoud blijft ongewijzigd', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertSucceeds(
      updateDoc(completedGameRef(db, ORG_A, TEAM_A1, 'legacy-1'), {
        deletedAt: Timestamp.now(),
        deletedBy: USERS.alice.uid,
        revision: 1,
      }),
    );
    const snap = await getDoc(completedGameRef(db, ORG_A, TEAM_A1, 'legacy-1'));
    const data = snap.data()!;
    expect(data.deletedAt).not.toBeNull();
    expect(data.deletedBy).toBe(USERS.alice.uid);
    expect(data.revision).toBe(1);
    // Bevroren inhoud (spelers/segmenten/score/...) letterlijk ongewijzigd.
    const legacy = legacyCompletedGame();
    expect(data.scoreFor).toBe(legacy.scoreFor);
    expect(data.scoreAgainst).toBe(legacy.scoreAgainst);
    expect(data.segments).toEqual(legacy.segments);
    expect(data.players).toEqual(legacy.players);
  });

  it('een tombstone-poging op een legacy-document met de VERKEERDE (niet-impliciete) revisie wordt geweigerd', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      updateDoc(completedGameRef(db, ORG_A, TEAM_A1, 'legacy-1'), {
        deletedAt: Timestamp.now(),
        deletedBy: USERS.alice.uid,
        revision: 2,
      }),
    );
  });

  it('scorer mag een legacy-document nog steeds NIET tombstonen', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(completedGameRef(db, ORG_A, TEAM_A1, 'legacy-1'), {
        deletedAt: Timestamp.now(),
        deletedBy: USERS.dave.uid,
        revision: 1,
      }),
    );
  });
});

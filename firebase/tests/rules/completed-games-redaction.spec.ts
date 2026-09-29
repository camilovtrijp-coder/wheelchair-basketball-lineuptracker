// PR 8.3c-1 — redactie van een verlopen tombstone
// (docs/pr-8.3c-besluitvoorstel.md §3.3, verfijning E.2a).
//
// Een getombstonede wedstrijd wordt na 90 dagen NIET hard verwijderd (dan
// verdwijnt het signaal waarop de resurrectiepreventie van 7.2c steunt) maar
// geredigeerd: de persoonsgegevens gaan eruit — inclusief `deletedBy` — terwijl
// `deletedAt`, `sourceGameId`, `date` en de context blijven staan. Dit bestand
// bewijst de tweede update-tak in firestore.rules: alleen de owner, alleen na de
// 90-dagen-ondergrens, alleen de leeg te maken velden, servergebonden
// `redactedAt`, `revision + 1`, en niet twee keer.

import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { doc, getDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createTestEnv, assertSucceeds, assertFails, authCtx, withAdmin } from './helpers/testEnv.js';
import { ORG_A, ORG_B, TEAM_A1, USERS, sampleCompletedGame } from './helpers/fixtures.js';
import { CLAIMS, dagenGeleden, seedOrganizations } from './helpers/retention.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await seedOrganizations(env);
});

const ID = 'completed-redactie';

function ref(db: ReturnType<typeof authCtx>) {
  return doc(db, 'organizations', ORG_A, 'teams', TEAM_A1, 'completedGames', ID);
}
function ownerDb() {
  return authCtx(env, USERS.alice.uid, CLAIMS.alice);
}

/** Seedt een getombstonede wedstrijd die `dagen` dagen geleden getombstoned is. */
async function seedTombstoned(dagen: number, overrides: Record<string, unknown> = {}) {
  await withAdmin(env, async (db) => {
    await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('teams')
      .doc(TEAM_A1)
      .collection('completedGames')
      .doc(ID)
      .set(
        sampleCompletedGame({
          deletedAt: dagenGeleden(dagen),
          deletedBy: USERS.carol.uid,
          revision: 1,
          ...overrides,
        }),
      );
  });
}

function redactionPatch(overrides: Record<string, unknown> = {}) {
  return {
    opponent: '',
    competition: '',
    players: [],
    segments: [],
    scoreFor: 0,
    scoreAgainst: 0,
    deletedBy: null,
    redactedAt: serverTimestamp(),
    revision: 2,
    ...overrides,
  };
}

describe('completedGames: redactie na 90 dagen', () => {
  it('owner mag een tombstone van 91 dagen oud redigeren', async () => {
    await seedTombstoned(91);
    await assertSucceeds(updateDoc(ref(ownerDb()), redactionPatch()));
  });

  it('laat na de redactie deletedAt, sourceGameId, date en context ongewijzigd staan', async () => {
    await seedTombstoned(91);
    const voor = (await withAdmin(env, async (db) =>
      db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('completedGames')
        .doc(ID)
        .get(),
    )).data()!;
    await assertSucceeds(updateDoc(ref(ownerDb()), redactionPatch()));
    const na = (await assertSucceeds(getDoc(ref(ownerDb())))).data()!;

    expect(na.deletedBy).toBeNull();
    expect(na.opponent).toBe('');
    expect(na.competition).toBe('');
    expect(na.players).toEqual([]);
    expect(na.segments).toEqual([]);
    expect(na.scoreFor).toBe(0);
    expect(na.scoreAgainst).toBe(0);
    expect(na.revision).toBe(2);
    expect(na.redactedAt).toBeDefined();
    // resurrectiepreventie: deletedAt blijft een niet-null tijdstempel
    expect(na.deletedAt).not.toBeNull();
    expect(na.deletedAt.toMillis()).toBe(voor.deletedAt.toMillis());
    for (const veld of ['organizationId', 'teamId', 'sourceGameId', 'date', 'quarterCount', 'periodLabel', 'useClassLimit']) {
      expect(na[veld], veld).toEqual(voor[veld]);
    }
  });

  it('weigert redactie van een tombstone van 89 dagen oud (ondergrens)', async () => {
    await seedTombstoned(89);
    await assertFails(updateDoc(ref(ownerDb()), redactionPatch()));
  });

  it('weigert redactie van een tombstone van 1 dag oud', async () => {
    await seedTombstoned(1);
    await assertFails(updateDoc(ref(ownerDb()), redactionPatch()));
  });

  it('weigert redactie van een NIET-getombstoned wedstrijd, hoe oud ook', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('completedGames')
        .doc(ID)
        .set(sampleCompletedGame({ syncedAt: dagenGeleden(400) }));
    });
    await assertFails(updateDoc(ref(ownerDb()), redactionPatch({ revision: 1 })));
  });

  it('een legacy tombstone zonder `revision` (pre-7.2c-schema) is redigeerbaar met revision 1', async () => {
    await withAdmin(env, async (db) => {
      const { revision: _weg, ...zonderRevision } = sampleCompletedGame({
        deletedAt: dagenGeleden(120),
        deletedBy: USERS.carol.uid,
      });
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('completedGames')
        .doc(ID)
        .set(zonderRevision);
    });
    await assertSucceeds(updateDoc(ref(ownerDb()), redactionPatch({ revision: 1 })));
  });

  it.each([
    ['bob (admin)', USERS.bob.uid, CLAIMS.bob],
    ['carol (org-coach zonder teamrij)', USERS.carol.uid, CLAIMS.carol],
    ['dave (scorer)', USERS.dave.uid, CLAIMS.dave],
    ['erin (viewer)', USERS.erin.uid, CLAIMS.erin],
    ['henry (team-only coach — mag wél tombstonen, dus dit is de echte coachcheck)', USERS.henry.uid, CLAIMS.henry],
    ['frank (owner van een ANDERE organisatie)', USERS.frank.uid, CLAIMS.frank],
  ])('%s mag NIET redigeren', async (_naam, uid, claims) => {
    await seedTombstoned(120);
    await assertFails(updateDoc(ref(authCtx(env, uid, claims)), redactionPatch()));
  });

  it.each([
    ['een clientgekozen string', '2026-01-01T00:00:00.000Z'],
    ['een teruggedateerd tijdstempel', Timestamp.fromMillis(Date.now() - 200 * 86_400_000)],
    ['een toekomstig tijdstempel', Timestamp.fromMillis(Date.now() + 3_600_000)],
    ['null', null],
  ])('weigert redactedAt als %s (moet == request.time zijn)', async (_naam, waarde) => {
    await seedTombstoned(120);
    await assertFails(updateDoc(ref(ownerDb()), redactionPatch({ redactedAt: waarde })));
  });

  it('weigert een redactie zonder redactedAt', async () => {
    await seedTombstoned(120);
    const { redactedAt: _weg, ...zonder } = redactionPatch();
    await assertFails(updateDoc(ref(ownerDb()), zonder));
  });

  it('weigert een redactie die deletedBy NIET leegmaakt', async () => {
    await seedTombstoned(120);
    await assertFails(updateDoc(ref(ownerDb()), redactionPatch({ deletedBy: USERS.carol.uid })));
    await assertFails(updateDoc(ref(ownerDb()), redactionPatch({ deletedBy: '' })));
  });

  it.each([
    ['opponent', { opponent: 'Fictieve Tegenstander' }],
    ['competition', { competition: 'Fictieve Competitie' }],
    ['players', { players: [{ id: 'gp-1' }] }],
    ['segments', { segments: [{ id: 'seg-1' }] }],
    ['scoreFor', { scoreFor: 60 }],
    ['scoreAgainst', { scoreAgainst: 50 }],
  ])('weigert een redactie die %s niet leegmaakt', async (_veld, overrides) => {
    await seedTombstoned(120);
    await assertFails(updateDoc(ref(ownerDb()), redactionPatch(overrides)));
  });

  it.each([
    ['deletedAt (terugdateren of wissen)', { deletedAt: null }],
    ['deletedAt naar een ander tijdstempel', { deletedAt: serverTimestamp() }],
    ['sourceGameId', { sourceGameId: 'ander-game' }],
    ['date', { date: '2020-01-01T00:00:00.000Z' }],
    ['organizationId', { organizationId: ORG_B }],
    ['teamId', { teamId: 'team-b1' }],
    ['syncedAt', { syncedAt: serverTimestamp() }],
    ['quarterCount', { quarterCount: 2 }],
  ])('weigert een redactie die ook %s wijzigt (allowlist)', async (_veld, extra) => {
    await seedTombstoned(120);
    await assertFails(updateDoc(ref(ownerDb()), redactionPatch(extra)));
  });

  it('weigert een redactie zonder revision +1', async () => {
    await seedTombstoned(120);
    await assertFails(updateDoc(ref(ownerDb()), redactionPatch({ revision: 1 })));
    await assertFails(updateDoc(ref(ownerDb()), redactionPatch({ revision: 7 })));
  });

  it('weigert een TWEEDE redactie (redactedAt kan niet opnieuw gestempeld worden)', async () => {
    await seedTombstoned(120);
    await assertSucceeds(updateDoc(ref(ownerDb()), redactionPatch()));
    await assertFails(updateDoc(ref(ownerDb()), redactionPatch({ revision: 3 })));
  });

  it('een geredigeerd document blijft onverwijderbaar (geen hard delete, ook niet voor de owner)', async () => {
    await seedTombstoned(120);
    await assertSucceeds(updateDoc(ref(ownerDb()), redactionPatch()));
    await assertFails(deleteDoc(ref(ownerDb())));
  });

  it('de owner kan een verlopen tombstone niet "un-tombstonen" via het redactiepad', async () => {
    await seedTombstoned(120);
    await assertFails(
      updateDoc(ref(ownerDb()), redactionPatch({ deletedAt: null, deletedBy: null })),
    );
  });
});

describe('completedGames: de bestaande tombstonepatch blijft ongemoeid door de redactietak', () => {
  it('owner kan een verse (niet-getombstonede) wedstrijd nog steeds tombstonen', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('completedGames')
        .doc(ID)
        .set(sampleCompletedGame());
    });
    await assertSucceeds(
      updateDoc(ref(ownerDb()), {
        deletedAt: serverTimestamp(),
        deletedBy: USERS.alice.uid,
        revision: 1,
      }),
    );
  });

  it('een redactiepatch op een NIEUWE tombstone (net gezet) wordt geweigerd', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('completedGames')
        .doc(ID)
        .set(sampleCompletedGame());
    });
    await assertSucceeds(
      updateDoc(ref(ownerDb()), {
        deletedAt: serverTimestamp(),
        deletedBy: USERS.alice.uid,
        revision: 1,
      }),
    );
    // Zelfde sessie, direct erna: de 90-dagengrens is niet bereikt.
    await assertFails(updateDoc(ref(ownerDb()), redactionPatch()));
  });
});

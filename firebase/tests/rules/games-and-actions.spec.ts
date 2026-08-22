// PR 7.1b (docs/pr-7.1-plan.md §C 7.1b) — Rules voor games/{gameId}/actions/{actionId}.
// Bewijst:
// - lezen voor elk geautoriseerd teamlid, schrijven alleen voor owner/admin/coach/scorer;
// - game-create: pad-/payloadcontext, toegestane initiële fase/revisie/epoch, "maker"-borging;
// - game-update is gesplitst in een normale patch (uitsluitend de ACTUELE writer; writer-/
//   epoch-/claimvelden blijven exact ongewijzigd, `lastWriterActivityAt` mag wel), een
//   initiële claim (alleen op een nog ongeclaimd document, uitsluitend de eigen uid, epoch
//   blijft gelijk) en (PR 7.3a) een overname van een AL geclaimd document (elke bevoegde
//   rol, epoch moet met exact 1 omhoog, claimedAt/lastWriterActivityAt samen op "nu"); strikte
//   veldallowlist per pad, toegestane faseovergang, monotone revisie;
// - action-create: create-only, eigen auteur, epoch/deviceId moeten matchen met de ACTUELE
//   claim op het parentdocument (stale-epoch-weigering — dit fenced een oude writer na een
//   PR 7.3a-overname: diens acties uit de vorige epoch worden altijd geweigerd);
// - action-update/delete altijd geweigerd (ADR-002 punt 1: create-only is echt onveranderlijk);
// - volledige schema-/typevalidatie (exacte sleutelset, veldtypen, schemaVersion,
//   action-discriminant/payload, ISO-tijdstipvorm) voor zowel games als actions;
// - cross-org/team-isolatie en self-promotion (vervalste writerUid/context);
// - queryscope: een collectionGroup-query op actions blijft default-deny (geen recursieve match).

import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  collectionGroup,
  getDocs,
  query,
} from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  createTestEnv,
  assertSucceeds,
  assertFails,
  authCtx,
  withAdmin,
} from './helpers/testEnv.js';
import {
  ORG_A,
  ORG_B,
  TEAM_A1,
  TEAM_B1,
  USERS,
  sampleGame,
  sampleLegacyGame,
  sampleGameAction,
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
    // Org A: alice = owner, bob = admin (org-niveau); carol = coach, dave =
    // scorer, erin = viewer (team-niveau, team A1).
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
    await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('organizationMembers')
      .doc(USERS.bob.uid)
      .set({ role: 'organizationAdmin', email: USERS.bob.email, uid: USERS.bob.uid });
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

    // Org B: frank = owner op team B1. Geen enkele org-A-gebruiker heeft hier
    // toegang (cross-org-isolatietests).
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
  });
});

function gameRef(db: ReturnType<typeof authCtx>, orgId: string, teamId: string, gameId: string) {
  return doc(db, 'organizations', orgId, 'teams', teamId, 'games', gameId);
}
function actionRef(
  db: ReturnType<typeof authCtx>,
  orgId: string,
  teamId: string,
  gameId: string,
  actionId: string,
) {
  return doc(db, 'organizations', orgId, 'teams', teamId, 'games', gameId, 'actions', actionId);
}

describe('games/{gameId}: create', () => {
  it('owner mag een wedstrijd aanmaken', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertSucceeds(setDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), sampleGame()));
  });

  it('admin mag een wedstrijd aanmaken', async () => {
    const db = authCtx(env, USERS.bob.uid, { email: USERS.bob.email, email_verified: true });
    await assertSucceeds(setDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), sampleGame()));
  });

  it('coach mag een wedstrijd aanmaken', async () => {
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertSucceeds(setDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), sampleGame()));
  });

  it('scorer mag een wedstrijd aanmaken (canWriteGameData, ruimer dan canManageTeamData)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertSucceeds(setDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), sampleGame()));
  });

  it('viewer mag GEEN wedstrijd aanmaken', async () => {
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    await assertFails(setDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), sampleGame()));
  });

  it('mag GEEN organizationId die afwijkt van het pad (vervalste context)', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      setDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), sampleGame({ organizationId: ORG_B })),
    );
  });

  it('mag GEEN teamId die afwijkt van het pad (vervalste context)', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      setDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), sampleGame({ teamId: TEAM_B1 })),
    );
  });

  it('mag GEEN onbekende fase bij create', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      setDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), sampleGame({ phase: 'afgerond' })),
    );
  });

  it('mag GEEN revision anders dan 0 bij create', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(setDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), sampleGame({ revision: 1 })));
  });

  it('mag GEEN writerEpoch anders dan 0 bij create', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      setDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), sampleGame({ writerEpoch: 1 })),
    );
  });

  it('self-promotion: mag writerUid NIET op een ANDERE gebruiker zetten dan de maker', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), sampleGame({ writerUid: USERS.alice.uid })),
    );
  });

  it('mag writerUid WEL op de eigen uid zetten (directe claim bij create), mét claimedAt/lastWriterActivityAt samen op "nu"', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertSucceeds(
      setDoc(
        gameRef(db, ORG_A, TEAM_A1, 'game-1'),
        sampleGame({
          writerUid: USERS.dave.uid,
          deviceId: 'device-dave',
          claimedAt: '2026-01-01T00:00:00.000Z',
          lastWriterActivityAt: '2026-01-01T00:00:00.000Z',
        }),
      ),
    );
  });

  it('mag GEEN directe claim bij create zonder claimedAt (PR 7.3a)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        gameRef(db, ORG_A, TEAM_A1, 'game-1'),
        sampleGame({ writerUid: USERS.dave.uid, deviceId: 'device-dave' }),
      ),
    );
  });

  it('mag GEEN claimedAt zonder writerUid bij create', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        gameRef(db, ORG_A, TEAM_A1, 'game-1'),
        sampleGame({ claimedAt: '2026-01-01T00:00:00.000Z' }),
      ),
    );
  });

  // Tweede reviewerprobe (externe review, aug. 2026, P1): writerUid/deviceId
  // moeten SAMEN "beide null" of "beide gezet" zijn — een writer zonder
  // geldige deviceId kan daarna geen enkele action meer schrijven.
  it('mag GEEN writerUid zetten zonder geldige deviceId (writer/device-inconsistentie)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        gameRef(db, ORG_A, TEAM_A1, 'game-1'),
        sampleGame({ writerUid: USERS.dave.uid, deviceId: null }),
      ),
    );
  });

  it('mag GEEN lege string als deviceId aanmaken bij een directe claim', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        gameRef(db, ORG_A, TEAM_A1, 'game-1'),
        sampleGame({ writerUid: USERS.dave.uid, deviceId: '' }),
      ),
    );
  });

  it('mag GEEN deviceId zetten zonder writerUid (writer/device-inconsistentie, omgekeerd)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        gameRef(db, ORG_A, TEAM_A1, 'game-1'),
        sampleGame({ writerUid: null, deviceId: 'device-dave' }),
      ),
    );
  });

  it('cross-team: dave (scorer op team A1) mag GEEN wedstrijd aanmaken op team B1', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        gameRef(db, ORG_B, TEAM_B1, 'game-1'),
        sampleGame({ organizationId: ORG_B, teamId: TEAM_B1 }),
      ),
    );
  });

  it('niet-ingelogde gebruiker mag niets lezen of schrijven', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(setDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), sampleGame()));
    await assertFails(getDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1')));
  });
});

describe('games/{gameId}: read', () => {
  beforeEach(async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-1')
        .set(sampleGame());
    });
  });

  it('viewer mag lezen maar niet schrijven', async () => {
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    await assertSucceeds(getDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1')));
    await assertFails(updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), { curQuarter: 2 }));
  });

  it('een gebruiker zonder enige membership in org A mag NIET lezen', async () => {
    const db = authCtx(env, USERS.frank.uid, { email: USERS.frank.email, email_verified: true });
    await assertFails(getDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1')));
  });
});

describe('games/{gameId}: update', () => {
  beforeEach(async () => {
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
            claimedAt: '2026-01-01T00:00:00.000Z',
            lastWriterActivityAt: '2026-01-01T00:00:00.000Z',
          }),
        );
    });
  });

  it('scorer (huidige writer) mag draaivelden patchen met revision+1', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertSucceeds(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        onCourt: ['gp-1'],
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 1,
      }),
    );
  });

  it('mag de fase van setup naar tracking zetten (toegestane overgang)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertSucceeds(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        phase: 'tracking',
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 1,
      }),
    );
  });

  // `lastWriterActivityAt` moet een geldig ISO-tijdstip BLIJVEN (rules'
  // isValidGamePayload()), maar hoeft niet per se in élke patch te wijzigen —
  // de al aanwezige geldige waarde uit de fixture hierboven volstaat als de
  // patch het veld zelf niet meestuurt. `projectGameSnapshotPatch()` stuurt
  // 'm in de praktijk altijd mee (spiegelt "nu"), maar Rules dwingen dat niet
  // strikt af — vandaar geen losse negatieve test hiervoor.

  it('mag de fase NIET van tracking terug naar setup zetten', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-1')
        .update({ phase: 'tracking' });
    });
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        phase: 'setup',
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 1,
      }),
    );
  });

  it('mag een kernveld (opponent) NIET wijzigen', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        opponent: 'Andere tegenstander',
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 1,
      }),
    );
  });

  it('mag organizationId/teamId NIET wijzigen', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        teamId: TEAM_B1,
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 1,
      }),
    );
  });

  it('mag revision NIET overslaan (moet exact +1 zijn)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        onCourt: ['gp-1'],
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 2,
      }),
    );
  });

  it('mag writerEpoch NIET laten dalen', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-1')
        .update({ writerEpoch: 2 });
    });
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerEpoch: 1,
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 1,
      }),
    );
  });

  // Review-opvolging (externe review, aug. 2026, P1): een normale patch mocht
  // voorheen writerUid/deviceId/writerEpoch gewoon meesturen — elke bevoegde
  // gebruiker (niet alleen de huidige writer) kon zo de claim overschrijven,
  // en writerEpoch kon willekeurig vooruitspringen zonder enige overname.
  it('de huidige writer mag writerEpoch NIET laten stijgen via een normale patch (geen overname via dit pad)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerEpoch: 1,
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 1,
      }),
    );
  });

  it('de huidige writer mag deviceId NIET wijzigen via een normale patch', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        deviceId: 'ander-apparaat',
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 1,
      }),
    );
  });

  it('de huidige writer mag writerUid NIET op een ander zetten via een normale patch', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.alice.uid,
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 1,
      }),
    );
  });

  it('de huidige writer mag claimedAt NIET wijzigen via een normale patch', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        claimedAt: '2026-01-01T00:05:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 1,
      }),
    );
  });

  it('een andere bevoegde gebruiker (carol, coach) dan de huidige writer (dave) mag NIET patchen', async () => {
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        onCourt: ['gp-1'],
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 1,
      }),
    );
  });

  it('owner (impliciete toegang, maar niet de huidige writer) mag ook NIET patchen', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        onCourt: ['gp-1'],
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 1,
      }),
    );
  });

  it('viewer mag NIET patchen', async () => {
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        onCourt: ['gp-1'],
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 1,
      }),
    );
  });

  it('mag NOOIT verwijderd worden', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(deleteDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1')));
  });
});

// P1-fix (externe review PR #66): documenten van vóór PR 7.3a missen
// `claimedAt`/`lastWriterActivityAt` server-side VOLLEDIG (geen `null`, de
// sleutels zelf ontbreken — `sampleLegacyGame()` bootst dat exact na, zie
// firebase/tests/rules/helpers/fixtures.ts). Zie firestore.rules punt 19
// voor de volledige toelichting.
describe('games/{gameId}: backward-compat (P1, externe review PR #66) — documenten van vóór PR 7.3a', () => {
  it('een ongeclaimd legacydocument kan alsnog via het initiële-claimpad (10b) geclaimd worden', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-legacy-unclaimed')
        .set(sampleLegacyGame());
    });
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertSucceeds(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-legacy-unclaimed'), {
        writerUid: USERS.dave.uid,
        deviceId: 'device-dave',
        claimedAt: '2026-01-01T00:05:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 1,
      }),
    );
  });

  it('een AL geclaimd legacydocument (claimedAt/lastWriterActivityAt afwezig) kan door de huidige writer opgewaardeerd worden via een normale patch (10a), met claimedAt ongewijzigd teruggezet op null', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-legacy-claimed')
        .set(sampleLegacyGame({ writerUid: USERS.dave.uid, deviceId: 'device-dave' }));
    });
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    // `GameSyncCoordinator.sync()` stuurt `claimedAt` in de praktijk altijd
    // mee (ongewijzigd terugecho'd, `ensure.claimedAt ?? null`, zie
    // `projectGameSnapshotPatch()`) — expliciet `null` hier, spiegelt exact
    // die aanroep. Zie de volgende test voor waarom dat veld niet weggelaten
    // mag worden.
    await assertSucceeds(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-legacy-claimed'), {
        onCourt: ['gp-1'],
        claimedAt: null,
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 1,
      }),
    );
  });

  // `updateDoc()` raakt alleen de meegestuurde velden — een patch die
  // `claimedAt` zelf NIET meestuurt, laat de sleutel op een legacydocument
  // dus voor altijd afwezig; `isValidGamePayload()` eist die sleutel juist
  // PRESENT op het resulterende document. Dit is precies waarom
  // `GameSyncCoordinator.sync()`/`projectGameSnapshotPatch()` `claimedAt`
  // voortaan ALTIJD meesturen (test hierboven) — zonder dat zou elke normale
  // patch op een legacydocument voor altijd blijven weigeren.
  it('een AL geclaimd legacydocument weigert een patch die claimedAt zelf niet meestuurt (bewijst de noodzaak van de app-fix)', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-legacy-claimed-2')
        .set(sampleLegacyGame({ writerUid: USERS.dave.uid, deviceId: 'device-dave' }));
    });
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-legacy-claimed-2'), {
        onCourt: ['gp-1'],
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 1,
      }),
    );
  });

  it('een AL geclaimd legacydocument weigert een patch die claimedAt via dit pad WEL een waarde geeft (nog steeds geen claim/overname via 10a)', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-legacy-claimed-3')
        .set(sampleLegacyGame({ writerUid: USERS.dave.uid, deviceId: 'device-dave' }));
    });
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-legacy-claimed-3'), {
        onCourt: ['gp-1'],
        claimedAt: '2026-01-01T00:05:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 1,
      }),
    );
  });

  it('een ANDERE bevoegde gebruiker dan de huidige writer kan het migratiepad NIET misbruiken om een legacydocument via 10a over te nemen', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-legacy-claimed-4')
        .set(sampleLegacyGame({ writerUid: USERS.dave.uid, deviceId: 'device-dave' }));
    });
    // carol (coach) is bevoegd om wedstrijddata te schrijven, maar is niet de
    // huidige writer (dave) — de backward-compat-guard mag dat niet omzeilen.
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-legacy-claimed-4'), {
        onCourt: ['gp-1'],
        claimedAt: null,
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 1,
      }),
    );
  });

  it('een AL geclaimd legacydocument kan nog steeds normaal overgenomen worden via 10d (epoch +1)', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-legacy-takeover')
        .set(sampleLegacyGame({ writerUid: USERS.dave.uid, deviceId: 'device-dave' }));
    });
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertSucceeds(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-legacy-takeover'), {
        writerUid: USERS.carol.uid,
        deviceId: 'device-carol',
        writerEpoch: 1,
        claimedAt: '2026-01-01T00:05:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:05:00.000Z',
        revision: 1,
      }),
    );
  });

  it('een afgerond legacyparentdocument (completedGameId gezet, claimedAt afwezig) blijft leesbaar', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-legacy-completed')
        .set(
          sampleLegacyGame({
            writerUid: USERS.dave.uid,
            deviceId: 'device-dave',
            completedGameId: 'completed-legacy-1',
          }),
        );
    });
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    const snapshot = await assertSucceeds(getDoc(gameRef(db, ORG_A, TEAM_A1, 'game-legacy-completed')));
    expect(snapshot.data()?.completedGameId).toBe('completed-legacy-1');
    expect(snapshot.data()?.claimedAt).toBeUndefined();
  });
});

describe('games/{gameId}: initiële claim via update (nog geen writer)', () => {
  beforeEach(async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-1')
        .set(sampleGame()); // writerUid/deviceId blijven null (default sampleGame())
    });
  });

  it('scorer mag een nog ongeclaimd document op de eigen uid claimen, mét claimedAt/lastWriterActivityAt samen op "nu"', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertSucceeds(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.dave.uid,
        deviceId: 'device-dave',
        claimedAt: '2026-01-01T00:00:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:00:00.000Z',
        revision: 1,
      }),
    );
  });

  it('mag NIET claimen zonder claimedAt (PR 7.3a)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.dave.uid,
        deviceId: 'device-dave',
        revision: 1,
      }),
    );
  });

  it('claimedAt en lastWriterActivityAt moeten SAMEN op dezelfde waarde gezet worden bij de initiële claim', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.dave.uid,
        deviceId: 'device-dave',
        claimedAt: '2026-01-01T00:00:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:01:00.000Z',
        revision: 1,
      }),
    );
  });

  it('mag NIET een ANDER uid claimen dan de eigen (self-promotion via update)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.alice.uid,
        deviceId: 'device-alice',
        claimedAt: '2026-01-01T00:00:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:00:00.000Z',
        revision: 1,
      }),
    );
  });

  it('mag NIET claimen met een lege string als deviceId', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.dave.uid,
        deviceId: '',
        claimedAt: '2026-01-01T00:00:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:00:00.000Z',
        revision: 1,
      }),
    );
  });

  it('mag writerEpoch NIET laten springen tijdens de initiële claim', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.dave.uid,
        deviceId: 'device-dave',
        writerEpoch: 1,
        claimedAt: '2026-01-01T00:00:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:00:00.000Z',
        revision: 1,
      }),
    );
  });

  it('viewer mag niet claimen', async () => {
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.erin.uid,
        deviceId: 'device-erin',
        revision: 1,
      }),
    );
  });
});

describe('games/{gameId}: overname (10d, PR 7.3a) van een AL geclaimd document', () => {
  beforeEach(async () => {
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
  });

  it('een andere bevoegde gebruiker (carol) mag een geldige overname doen: epoch +1, claimedAt/lastWriterActivityAt samen op "nu"', async () => {
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertSucceeds(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.carol.uid,
        deviceId: 'device-carol',
        writerEpoch: 2,
        claimedAt: '2026-01-01T00:10:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:10:00.000Z',
        revision: 1,
      }),
    );
  });

  it('de huidige writer (dave) mag zichzelf ook op een ANDER apparaat overnemen (bijv. na een crash)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertSucceeds(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.dave.uid,
        deviceId: 'device-dave-2',
        writerEpoch: 2,
        claimedAt: '2026-01-01T00:10:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:10:00.000Z',
        revision: 1,
      }),
    );
  });

  it('mag NIET een ANDER uid overnemen dan de eigen (self-promotion via overname)', async () => {
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.alice.uid,
        deviceId: 'device-alice',
        writerEpoch: 2,
        claimedAt: '2026-01-01T00:10:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:10:00.000Z',
        revision: 1,
      }),
    );
  });

  it('viewer (erin) mag niet overnemen', async () => {
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.erin.uid,
        deviceId: 'device-erin',
        writerEpoch: 2,
        claimedAt: '2026-01-01T00:10:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:10:00.000Z',
        revision: 1,
      }),
    );
  });

  it('writerEpoch moet met EXACT 1 omhoog — een sprong wordt geweigerd', async () => {
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.carol.uid,
        deviceId: 'device-carol',
        writerEpoch: 5,
        claimedAt: '2026-01-01T00:10:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:10:00.000Z',
        revision: 1,
      }),
    );
  });

  it('writerEpoch mag NIET ongewijzigd blijven bij een overname (dat is het 10a-normale-patchpad, niet 10d)', async () => {
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.carol.uid,
        deviceId: 'device-carol',
        writerEpoch: 1,
        claimedAt: '2026-01-01T00:10:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:10:00.000Z',
        revision: 1,
      }),
    );
  });

  it('mag NIET overnemen met een lege string als deviceId', async () => {
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.carol.uid,
        deviceId: '',
        writerEpoch: 2,
        claimedAt: '2026-01-01T00:10:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:10:00.000Z',
        revision: 1,
      }),
    );
  });

  it('claimedAt en lastWriterActivityAt moeten SAMEN op dezelfde waarde gezet worden', async () => {
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.carol.uid,
        deviceId: 'device-carol',
        writerEpoch: 2,
        claimedAt: '2026-01-01T00:10:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:09:00.000Z',
        revision: 1,
      }),
    );
  });

  it('mag geen draaivelden meesturen in dezelfde patch (10d raakt uitsluitend claim-/epochvelden)', async () => {
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.carol.uid,
        deviceId: 'device-carol',
        writerEpoch: 2,
        claimedAt: '2026-01-01T00:10:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:10:00.000Z',
        onCourt: ['gp-1'],
        revision: 1,
      }),
    );
  });

  it('revisiemismatch (stale revision) wordt geweigerd, ook bij een verder geldige overname', async () => {
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.carol.uid,
        deviceId: 'device-carol',
        writerEpoch: 2,
        claimedAt: '2026-01-01T00:10:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:10:00.000Z',
        revision: 99,
      }),
    );
  });

  it('een reeds afgeronde wedstrijd (completedGameId gezet) kan niet meer overgenomen worden', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-1')
        .update({ completedGameId: 'completed-1', revision: 1 });
    });
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.carol.uid,
        deviceId: 'device-carol',
        writerEpoch: 2,
        claimedAt: '2026-01-01T00:10:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:10:00.000Z',
        revision: 2,
      }),
    );
  });

  it('een oude action-envelope uit de vorige epoch wordt na overname geweigerd (fencing)', async () => {
    const carolDb = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertSucceeds(
      updateDoc(gameRef(carolDb, ORG_A, TEAM_A1, 'game-1'), {
        writerUid: USERS.carol.uid,
        deviceId: 'device-carol',
        writerEpoch: 2,
        claimedAt: '2026-01-01T00:10:00.000Z',
        lastWriterActivityAt: '2026-01-01T00:10:00.000Z',
        revision: 1,
      }),
    );
    // dave (de oude writer, epoch 1) probeert alsnog een actie te uploaden.
    const daveDb = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        doc(daveDb, 'organizations', ORG_A, 'teams', TEAM_A1, 'games', 'game-1', 'actions', 'stale-1'),
        sampleGameAction({ authorUid: USERS.dave.uid, deviceId: 'device-dave', writerEpoch: 1 }),
      ),
    );
  });
});

// PR 7.2a, punt 15 (docs/pr-7.2-plan.md §C 7.2a) — de eenmalige
// finalize-patch die completedGameId van null naar een niet-lege string zet.
describe('games/{gameId}: finalize-patch (completedGameId, PR 7.2a)', () => {
  beforeEach(async () => {
    await withAdmin(env, async (db) => {
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

  it('de huidige writer mag completedGameId zetten met revision+1', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertSucceeds(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        completedGameId: 'completed-1',
        revision: 1,
      }),
    );
  });

  it('een andere bevoegde gebruiker dan de huidige writer mag NIET finalizen', async () => {
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        completedGameId: 'completed-1',
        revision: 1,
      }),
    );
  });

  it('mag GEEN lege string als completedGameId zetten', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), { completedGameId: '', revision: 1 }),
    );
  });

  it('mag naast completedGameId geen ander veld meesturen (bv. onCourt)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        completedGameId: 'completed-1',
        onCourt: ['gp-1'],
        revision: 1,
      }),
    );
  });

  it('mag revision niet overslaan tijdens finalizen', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        completedGameId: 'completed-1',
        revision: 2,
      }),
    );
  });

  it('een reeds afgeronde wedstrijd mag NIET nogmaals finalizen (geen tweede completedGameId)', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-1')
        .update({ completedGameId: 'completed-1', revision: 1 });
    });
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        completedGameId: 'completed-2',
        revision: 2,
      }),
    );
  });

  it('een afgeronde wedstrijd accepteert ook geen normale draaiveldpatch meer', async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-1')
        .update({ completedGameId: 'completed-1', revision: 1 });
    });
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), { onCourt: ['gp-1'], revision: 2 }),
    );
  });
});

// Review-opvolging (externe review, aug. 2026, P1): Rules controleerden
// voorheen slechts enkele context-/writervelden, niet de volledige
// sleutelset/veldtypen — een document zonder verplicht veld (bv. `updatedAt`,
// exact de reviewerprobe) of met een onbekend extra veld werd geaccepteerd.
describe('games/{gameId}: schema-/typevalidatie (create)', () => {
  it('mag GEEN document zonder verplicht veld aanmaken (ontbrekende updatedAt)', async () => {
    const { updatedAt: _updatedAt, ...withoutUpdatedAt } = sampleGame();
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(setDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), withoutUpdatedAt));
  });

  it('mag GEEN document met een onbekend extra veld aanmaken', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      setDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), { ...sampleGame(), extraVeld: 'onverwacht' }),
    );
  });

  it('mag GEEN clockDown als string aanmaken (verkeerd type)', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      setDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), sampleGame({ clockDown: 'true' })),
    );
  });

  it('mag GEEN niet-geheel getal curQuarter aanmaken (verkeerd type)', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      setDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), sampleGame({ curQuarter: 1.5 })),
    );
  });

  it('mag GEEN players als niet-array aanmaken (verkeerd type)', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      setDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), sampleGame({ players: 'niet-een-array' })),
    );
  });

  it('mag GEEN niet-ISO-vorm voor createdAt aanmaken', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      setDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), sampleGame({ createdAt: 'niet-een-tijdstip' })),
    );
  });

  it('mag GEEN niet-null/niet-string completedGameId aanmaken (PR 7.2a)', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      setDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), sampleGame({ completedGameId: 42 })),
    );
  });
});

describe('games/{gameId}/actions/{actionId}: create (stale-epoch/deviceId-weigering)', () => {
  beforeEach(async () => {
    // dave = huidige writer, epoch 3, device-dave — simuleert een al bestaande
    // claim (het daadwerkelijke overname-transactieproces is PR 7.3-scope; deze
    // Rule-laag hoeft alleen de ACTUELE claim te kennen, ongeacht hoe die tot
    // stand kwam).
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-1')
        .set(sampleGame({ writerUid: USERS.dave.uid, deviceId: 'device-dave', writerEpoch: 3 }));
    });
  });

  it('de huidige writer (dave) mag een actie aanmaken met de actuele epoch/deviceId', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertSucceeds(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({ authorUid: USERS.dave.uid, deviceId: 'device-dave', writerEpoch: 3 }),
      ),
    );
  });

  it('een oude/overgenomen writerEpoch wordt geweigerd (fundament voor PR 7.3-overname)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({ authorUid: USERS.dave.uid, deviceId: 'device-dave', writerEpoch: 2 }),
      ),
    );
  });

  it('een afwijkende deviceId wordt geweigerd (ander apparaat, zelfde gebruiker)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({ authorUid: USERS.dave.uid, deviceId: 'ander-apparaat', writerEpoch: 3 }),
      ),
    );
  });

  it('iemand anders dan de huidige writer (carol, coach) mag GEEN actie aanmaken', async () => {
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({ authorUid: USERS.carol.uid, deviceId: 'device-carol', writerEpoch: 3 }),
      ),
    );
  });

  it('vervalste auteur (authorUid != request.auth.uid) wordt geweigerd', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({ authorUid: USERS.alice.uid, deviceId: 'device-dave', writerEpoch: 3 }),
      ),
    );
  });

  // Review-opvolging (externe review, aug. 2026): oorspronkelijk één
  // gecombineerde test die alleen `gameId` muteerde — opgesplitst in vier
  // afzonderlijke probes zodat elk contextveld aantoonbaar los fail-closed is.
  it('vervalste gameId (contextveld) wordt geweigerd', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({
          authorUid: USERS.dave.uid,
          deviceId: 'device-dave',
          writerEpoch: 3,
          gameId: 'game-2',
        }),
      ),
    );
  });

  it('vervalste actionId (contextveld) wordt geweigerd', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({
          authorUid: USERS.dave.uid,
          deviceId: 'device-dave',
          writerEpoch: 3,
          actionId: 'action-9',
        }),
      ),
    );
  });

  it('vervalste organizationId (contextveld) wordt geweigerd', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({
          authorUid: USERS.dave.uid,
          deviceId: 'device-dave',
          writerEpoch: 3,
          organizationId: ORG_B,
        }),
      ),
    );
  });

  it('vervalste teamId (contextveld) wordt geweigerd', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({
          authorUid: USERS.dave.uid,
          deviceId: 'device-dave',
          writerEpoch: 3,
          teamId: TEAM_B1,
        }),
      ),
    );
  });

  // Review-opvolging (externe review, aug. 2026, P1): Rules controleerden
  // voorheen slechts enkele context-/writervelden, niet de volledige
  // sleutelset/veldtypen/schemaVersion/action-discriminant.
  it('mag GEEN actie zonder verplicht veld aanmaken (ontbrekende sequence)', async () => {
    const { sequence: _sequence, ...withoutSequence } = sampleGameAction({
      authorUid: USERS.dave.uid,
      deviceId: 'device-dave',
      writerEpoch: 3,
    });
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(setDoc(actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'), withoutSequence));
  });

  it('mag GEEN actie met een onbekend extra veld aanmaken', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'), {
        ...sampleGameAction({ authorUid: USERS.dave.uid, deviceId: 'device-dave', writerEpoch: 3 }),
        extraVeld: 'onverwacht',
      }),
    );
  });

  it('mag GEEN onbekende schemaVersion aanmaken', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({
          authorUid: USERS.dave.uid,
          deviceId: 'device-dave',
          writerEpoch: 3,
          schemaVersion: 2,
        }),
      ),
    );
  });

  it('mag GEEN onbekend actietype aanmaken', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({
          authorUid: USERS.dave.uid,
          deviceId: 'device-dave',
          writerEpoch: 3,
          action: { type: 'score-multiply', team: 'for', delta: 2 },
        }),
      ),
    );
  });

  it('mag GEEN score-delta met een extra onbekend payloadveld aanmaken', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({
          authorUid: USERS.dave.uid,
          deviceId: 'device-dave',
          writerEpoch: 3,
          action: { type: 'score-delta', team: 'for', delta: 2, extraVeld: 'onverwacht' },
        }),
      ),
    );
  });

  it('mag GEEN niet-numerieke delta aanmaken (verkeerd type)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({
          authorUid: USERS.dave.uid,
          deviceId: 'device-dave',
          writerEpoch: 3,
          action: { type: 'score-delta', team: 'for', delta: '2' },
        }),
      ),
    );
  });

  it('mag GEEN niet-ISO-vorm voor occurredAt aanmaken', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({
          authorUid: USERS.dave.uid,
          deviceId: 'device-dave',
          writerEpoch: 3,
          occurredAt: 'niet-een-tijdstip',
        }),
      ),
    );
  });

  it('mag GEEN lege string als deviceId aanmaken', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({ authorUid: USERS.dave.uid, deviceId: '', writerEpoch: 3 }),
      ),
    );
  });

  // Tweede reviewerprobe (externe review, aug. 2026, P1): `segment` werd
  // voorheen alleen op `map`-type gecontroleerd — een leeg object of een
  // segment met verkeerd-getypeerde/extra velden ging erdoorheen, terwijl
  // assertSegment() alle elf velden van Segment valideert.
  const validSegment = {
    id: 'seg-1',
    quarter: 1,
    beginSec: 600,
    endSec: 480,
    durSec: 120,
    lineup: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5'],
    pf: 4,
    pa: 2,
    classSum: 14.0,
    allowed: 14.5,
    over: false,
  };

  it('mag GEEN segment-saved met een leeg segment-object aanmaken', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({
          authorUid: USERS.dave.uid,
          deviceId: 'device-dave',
          writerEpoch: 3,
          action: { type: 'segment-saved', segment: {} },
        }),
      ),
    );
  });

  it('mag GEEN segment-saved met een ontbrekend segmentveld aanmaken', async () => {
    const { over: _over, ...segmentWithoutOver } = validSegment;
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({
          authorUid: USERS.dave.uid,
          deviceId: 'device-dave',
          writerEpoch: 3,
          action: { type: 'segment-saved', segment: segmentWithoutOver },
        }),
      ),
    );
  });

  it('mag GEEN segment-saved met een onbekend extra segmentveld aanmaken', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({
          authorUid: USERS.dave.uid,
          deviceId: 'device-dave',
          writerEpoch: 3,
          action: { type: 'segment-saved', segment: { ...validSegment, extraVeld: 'onverwacht' } },
        }),
      ),
    );
  });

  it('mag GEEN segment met een verkeerd getypeerd veld aanmaken (quarter als string)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({
          authorUid: USERS.dave.uid,
          deviceId: 'device-dave',
          writerEpoch: 3,
          action: { type: 'segment-saved', segment: { ...validSegment, quarter: '1' } },
        }),
      ),
    );
  });

  it('mag GEEN segment-edited met een leeg segment-object aanmaken', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({
          authorUid: USERS.dave.uid,
          deviceId: 'device-dave',
          writerEpoch: 3,
          action: { type: 'segment-edited', segmentId: 'seg-1', segment: {} },
        }),
      ),
    );
  });

  it('mag GEEN segment-edited met een lege segmentId aanmaken', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({
          authorUid: USERS.dave.uid,
          deviceId: 'device-dave',
          writerEpoch: 3,
          action: { type: 'segment-edited', segmentId: '', segment: validSegment },
        }),
      ),
    );
  });

  it('mag GEEN segment-deleted met een lege segmentId aanmaken', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({
          authorUid: USERS.dave.uid,
          deviceId: 'device-dave',
          writerEpoch: 3,
          action: { type: 'segment-deleted', segmentId: '' },
        }),
      ),
    );
  });

  it('mag WEL een volledig geldig segment-saved aanmaken (regressie, geen overvalidatie)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertSucceeds(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({
          authorUid: USERS.dave.uid,
          deviceId: 'device-dave',
          writerEpoch: 3,
          action: { type: 'segment-saved', segment: validSegment },
        }),
      ),
    );
  });

  it('viewer mag GEEN actie aanmaken', async () => {
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({ authorUid: USERS.erin.uid, deviceId: 'device-erin', writerEpoch: 3 }),
      ),
    );
  });

  it('cross-org: frank (org B) mag GEEN actie aanmaken op een wedstrijd van org A', async () => {
    const db = authCtx(env, USERS.frank.uid, { email: USERS.frank.email, email_verified: true });
    await assertFails(
      setDoc(
        actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'),
        sampleGameAction({ authorUid: USERS.frank.uid, deviceId: 'device-frank', writerEpoch: 3 }),
      ),
    );
  });
});

describe('games/{gameId}/actions/{actionId}: create-only (nooit update/delete)', () => {
  beforeEach(async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-1')
        .set(sampleGame({ writerUid: USERS.dave.uid, deviceId: 'device-dave', writerEpoch: 0 }));
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-1')
        .collection('actions')
        .doc('action-1')
        .set(
          sampleGameAction({ authorUid: USERS.dave.uid, deviceId: 'device-dave', writerEpoch: 0 }),
        );
    });
  });

  it('de auteur zelf mag de actie NIET updaten', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'), {
        action: { type: 'score-delta', team: 'for', delta: 99 },
      }),
    );
  });

  it('de auteur zelf mag de actie NIET verwijderen', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(deleteDoc(actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1')));
  });

  it('owner mag de actie ook NIET updaten of verwijderen', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      updateDoc(actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1'), { sequence: 99 }),
    );
    await assertFails(deleteDoc(actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1')));
  });

  it('elk geautoriseerd teamlid mag de actielog wel lezen (incl. viewer)', async () => {
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    await assertSucceeds(getDoc(actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1')));
  });
});

describe('queryscope: collectionGroup op actions blijft default-deny', () => {
  beforeEach(async () => {
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-1')
        .set(sampleGame({ writerUid: USERS.dave.uid, deviceId: 'device-dave' }));
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('games')
        .doc('game-1')
        .collection('actions')
        .doc('action-1')
        .set(sampleGameAction({ authorUid: USERS.dave.uid, deviceId: 'device-dave' }));
    });
  });

  it('een collectionGroup-query op actions geeft geen resultaten (geen recursieve match)', async () => {
    // Er is bewust GEEN recursieve-wildcard match voor `actions` (punt 12) —
    // een collectionGroup-LIST-query zonder zo'n match faalt altijd voor élke
    // gebruiker, ook een geautoriseerd teamlid dat het onderliggende document
    // wél via het directe pad mag lezen.
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    try {
      const snap = await getDocs(query(collectionGroup(db, 'actions')));
      expect(snap.empty).toBe(true);
    } catch (err) {
      // Een permission-denied van Firestore zelf is een even geldige, veilige uitkomst.
      expect(String(err)).toMatch(/permission|PERMISSION_DENIED/i);
    }
  });

  it('het onderliggende document blijft wel via het directe pad leesbaar (regressie)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertSucceeds(getDoc(actionRef(db, ORG_A, TEAM_A1, 'game-1', 'action-1')));
  });
});

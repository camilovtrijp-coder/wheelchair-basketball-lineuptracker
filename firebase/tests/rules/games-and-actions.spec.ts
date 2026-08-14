// PR 7.1b (docs/pr-7.1-plan.md §C 7.1b) — Rules voor games/{gameId}/actions/{actionId}.
// Bewijst:
// - lezen voor elk geautoriseerd teamlid, schrijven alleen voor owner/admin/coach/scorer;
// - game-create: pad-/payloadcontext, toegestane initiële fase/revisie/epoch, "maker"-borging;
// - game-update: strikte veldallowlist, toegestane faseovergang, monotone epoch/revisie;
// - action-create: create-only, eigen auteur, epoch/deviceId/writerUid moeten matchen met het
//   parentdocument (stale-epoch-weigering — het fundament voor de PR 7.3-overname);
// - action-update/delete altijd geweigerd (ADR-002 punt 1: create-only is echt onveranderlijk);
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

  it('mag writerUid WEL op de eigen uid zetten (directe claim bij create)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertSucceeds(
      setDoc(
        gameRef(db, ORG_A, TEAM_A1, 'game-1'),
        sampleGame({ writerUid: USERS.dave.uid, deviceId: 'device-dave' }),
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
        .set(sampleGame({ writerUid: USERS.dave.uid, deviceId: 'device-dave' }));
    });
  });

  it('scorer (huidige writer) mag draaivelden patchen met revision+1', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertSucceeds(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), { onCourt: ['gp-1'], revision: 1 }),
    );
  });

  it('mag de fase van setup naar tracking zetten (toegestane overgang)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertSucceeds(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), { phase: 'tracking', revision: 1 }),
    );
  });

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
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), { phase: 'setup', revision: 1 }),
    );
  });

  it('mag een kernveld (opponent) NIET wijzigen', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), {
        opponent: 'Andere tegenstander',
        revision: 1,
      }),
    );
  });

  it('mag organizationId/teamId NIET wijzigen', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), { teamId: TEAM_B1, revision: 1 }),
    );
  });

  it('mag revision NIET overslaan (moet exact +1 zijn)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), { onCourt: ['gp-1'], revision: 2 }),
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
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), { writerEpoch: 1, revision: 1 }),
    );
  });

  it('viewer mag NIET patchen', async () => {
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    await assertFails(
      updateDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1'), { onCourt: ['gp-1'], revision: 1 }),
    );
  });

  it('mag NOOIT verwijderd worden', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(deleteDoc(gameRef(db, ORG_A, TEAM_A1, 'game-1')));
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

  it('vervalste contextvelden (gameId/actionId/organizationId/teamId) worden geweigerd', async () => {
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

// PR 8.3c-0 — servergebonden bewaartijdstempels.
//
// Bewijst dat de vier tijdstempels waarop toekomstige bewaartermijnen gaan
// rekenen (docs/pr-8.3c-besluitvoorstel.md §3.1) niet meer door de client
// bepaald kunnen worden:
//
//   invitations create  → invitedAt  == request.time
//   accepteerpatch      → acceptedAt == request.time
//   claimpatch          → claimedAt  == request.time
//   tombstonepatch      → deletedAt  == request.time   (was: `is timestamp`)
//
// Per veld dezelfde vier negatieve gevallen — ontbrekend, verkeerd getypeerd,
// in de toekomst en teruggedateerd — plus het positieve geval met
// `serverTimestamp()`. De positieve gevallen staan hier bewust óók, zodat dit
// bestand op zichzelf leesbaar maakt wat wél en niet mag; de bredere
// flowdekking (rollen, e-mailverificatie, atomaire batch, replay) blijft in
// bootstrap-and-invitation-flow.spec.ts en completed-games.spec.ts.
//
// Let op: `GameDocument.claimedAt` is een ANDER veld (ISO-string op
// games/{gameId}, PR 7.3a) en valt buiten deze PR — zie games-and-actions.spec.ts.

import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import { doc, setDoc, updateDoc, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createTestEnv, assertSucceeds, assertFails, authCtx, withAdmin } from './helpers/testEnv.js';
import { ORG_A, TEAM_A1, USERS, sampleCompletedGame } from './helpers/fixtures.js';

let env: RulesTestEnvironment;

// Ruim buiten elke plausibele klokafwijking, zodat deze tests niet flaken op
// een trage runner: Rules eist exacte gelijkheid met request.time, maar een
// test die "net" ernaast zit zou een verkeerd signaal geven over de marge.
const EEN_UUR = 60 * 60 * 1000;
const TOEKOMST = () => Timestamp.fromMillis(Date.now() + EEN_UUR);
const VERLEDEN = () => Timestamp.fromMillis(Date.now() - 90 * 24 * EEN_UUR);

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await withAdmin(env, async (db) => {
    await db.collection('organizations').doc(ORG_A).set({
      name: 'Org A',
      createdBy: USERS.alice.uid,
    });
    for (const [uid, role, email] of [
      [USERS.alice.uid, 'organizationOwner', USERS.alice.email],
      [USERS.bob.uid, 'organizationAdmin', USERS.bob.email],
    ] as [string, string, string][]) {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('organizationMembers')
        .doc(uid)
        .set({ role, email, uid });
    }
    await db.collection('organizations').doc(ORG_A).collection('teams').doc(TEAM_A1).set({
      name: 'Team A1',
      orgName: 'Org A',
      createdBy: USERS.alice.uid,
    });
  });
});

const INV = 'inv-8-3-c-0';

function invitationPayload(overrides: Record<string, unknown> = {}) {
  return {
    email: USERS.grace.email,
    role: 'viewer',
    status: 'pending',
    invitedBy: USERS.alice.uid,
    invitedAt: serverTimestamp(),
    acceptedAt: null,
    ...overrides,
  };
}

async function seedInvitation(status: 'pending' | 'accepted') {
  await withAdmin(env, async (db) => {
    await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('invitations')
      .doc(INV)
      .set({
        email: USERS.grace.email,
        role: 'viewer',
        status,
        invitedBy: USERS.alice.uid,
        invitedAt: new Date(),
        acceptedAt: status === 'accepted' ? new Date() : null,
      });
  });
}

function aliceDb() {
  return authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
}
function graceDb() {
  return authCtx(env, USERS.grace.uid, { email: USERS.grace.email, email_verified: true });
}

describe('invitations create: invitedAt == request.time', () => {
  it('slaagt met serverTimestamp()', async () => {
    await assertSucceeds(
      setDoc(doc(aliceDb(), 'organizations', ORG_A, 'invitations', INV), invitationPayload()),
    );
  });

  it('weigert een ONTBREKENDE invitedAt', async () => {
    const { invitedAt: _weg, ...zonder } = invitationPayload();
    await assertFails(
      setDoc(doc(aliceDb(), 'organizations', ORG_A, 'invitations', INV), zonder),
    );
  });

  it('weigert een VERKEERD GETYPEERDE invitedAt (string)', async () => {
    await assertFails(
      setDoc(
        doc(aliceDb(), 'organizations', ORG_A, 'invitations', INV),
        invitationPayload({ invitedAt: '2026-01-01T00:00:00.000Z' }),
      ),
    );
  });

  it('weigert een invitedAt in de TOEKOMST', async () => {
    await assertFails(
      setDoc(
        doc(aliceDb(), 'organizations', ORG_A, 'invitations', INV),
        invitationPayload({ invitedAt: TOEKOMST() }),
      ),
    );
  });

  it('weigert een TERUGGEDATEERDE invitedAt — de kern van deze PR', async () => {
    // Zonder deze eis zou een uitnodiging bij aanmaak al 90 dagen "oud" zijn en
    // daarmee elke bewaartermijn die 8.3c-1 erop legt meteen passeren.
    await assertFails(
      setDoc(
        doc(aliceDb(), 'organizations', ORG_A, 'invitations', INV),
        invitationPayload({ invitedAt: VERLEDEN() }),
      ),
    );
  });
});

describe('invitations accepteren: acceptedAt == request.time', () => {
  beforeEach(async () => {
    await seedInvitation('pending');
  });

  it('slaagt met serverTimestamp()', async () => {
    await assertSucceeds(
      updateDoc(doc(graceDb(), 'organizations', ORG_A, 'invitations', INV), {
        status: 'accepted',
        acceptedAt: serverTimestamp(),
      }),
    );
  });

  it('weigert een ONTBREKENDE acceptedAt', async () => {
    await assertFails(
      updateDoc(doc(graceDb(), 'organizations', ORG_A, 'invitations', INV), {
        status: 'accepted',
      }),
    );
  });

  it('weigert een VERKEERD GETYPEERDE acceptedAt (string)', async () => {
    await assertFails(
      updateDoc(doc(graceDb(), 'organizations', ORG_A, 'invitations', INV), {
        status: 'accepted',
        acceptedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
  });

  it('weigert een acceptedAt in de TOEKOMST', async () => {
    await assertFails(
      updateDoc(doc(graceDb(), 'organizations', ORG_A, 'invitations', INV), {
        status: 'accepted',
        acceptedAt: TOEKOMST(),
      }),
    );
  });

  it('weigert een TERUGGEDATEERDE acceptedAt', async () => {
    await assertFails(
      updateDoc(doc(graceDb(), 'organizations', ORG_A, 'invitations', INV), {
        status: 'accepted',
        acceptedAt: VERLEDEN(),
      }),
    );
  });
});

describe('invitations claimen: claimedAt == request.time (atomaire batch)', () => {
  beforeEach(async () => {
    await seedInvitation('accepted');
  });

  function claimBatch(claimedAt: unknown) {
    const db = graceDb();
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.grace.uid), {
      role: 'viewer',
      email: USERS.grace.email,
      uid: USERS.grace.uid,
      invitationId: INV,
      joinedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'organizations', ORG_A, 'invitations', INV), {
      status: 'claimed',
      claimedAt,
    });
    return batch.commit();
  }

  it('slaagt met serverTimestamp() — de batch blijft atomair werken', async () => {
    // Binnen één WriteBatch delen alle writes dezelfde request.time, dus de
    // getAfter()-koppeling tussen membership-create en claim blijft intact.
    await assertSucceeds(claimBatch(serverTimestamp()));
  });

  it('weigert een VERKEERD GETYPEERDE claimedAt (string)', async () => {
    await assertFails(claimBatch('2026-01-01T00:00:00.000Z'));
  });

  it('weigert een claimedAt in de TOEKOMST', async () => {
    await assertFails(claimBatch(TOEKOMST()));
  });

  it('weigert een TERUGGEDATEERDE claimedAt', async () => {
    await assertFails(claimBatch(VERLEDEN()));
  });

  it('weigert een ONTBREKENDE claimedAt', async () => {
    const db = graceDb();
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.grace.uid), {
      role: 'viewer',
      email: USERS.grace.email,
      uid: USERS.grace.uid,
      invitationId: INV,
      joinedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'organizations', ORG_A, 'invitations', INV), { status: 'claimed' });
    await assertFails(batch.commit());
  });
});

describe('completedGames tombstone: deletedAt == request.time', () => {
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

  function patch(deletedAt: unknown) {
    return updateDoc(
      doc(aliceDb(), 'organizations', ORG_A, 'teams', TEAM_A1, 'completedGames', 'completed-1'),
      { deletedAt, deletedBy: USERS.alice.uid, revision: 1 },
    );
  }

  it('slaagt met serverTimestamp() — zoals de productiegateway al schrijft', async () => {
    await assertSucceeds(patch(serverTimestamp()));
  });

  it('weigert een ONTBREKENDE deletedAt', async () => {
    await assertFails(
      updateDoc(
        doc(aliceDb(), 'organizations', ORG_A, 'teams', TEAM_A1, 'completedGames', 'completed-1'),
        { deletedBy: USERS.alice.uid, revision: 1 },
      ),
    );
  });

  it('weigert een VERKEERD GETYPEERDE deletedAt (string)', async () => {
    await assertFails(patch('2026-01-01T00:00:00.000Z'));
  });

  it('weigert een deletedAt in de TOEKOMST', async () => {
    await assertFails(patch(TOEKOMST()));
  });

  it('weigert een TERUGGEDATEERDE deletedAt — dit was vóór 8.3c-0 toegestaan', async () => {
    // De oude regel eiste alleen `deletedAt is timestamp`. Een owner kon een
    // tombstone dus meteen 90 dagen oud maken en zou daarmee de redactiegrens
    // uit 8.3c-1 in dezelfde handeling al passeren.
    await assertFails(patch(VERLEDEN()));
  });
});

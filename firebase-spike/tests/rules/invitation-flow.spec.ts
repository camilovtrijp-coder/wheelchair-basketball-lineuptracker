// Bewijst item 7 (ADR-003 Rules-only uitnodigingsflow) end-to-end:
// - aanmaken: alleen owner/admin, niet coach/scorer/viewer;
// - accepteren: geverifieerde e-mail van de uitgenodigde, alleen status+acceptedAt;
// - negatief accepteren: verkeerde e-mail, niet-geverifieerd, al geaccepteerd;
// - membership claimen: uid/rol moeten matchen en membership+claimed-update zijn atomair;
// - ingetrokken-vóór-acceptatie blokkeert claim.

import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import { doc, setDoc, updateDoc, deleteDoc, getDoc, writeBatch } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  createTestEnv, assertSucceeds, assertFails, authCtx, withAdmin,
} from './helpers/testEnv.js';
import { ORG_A, USERS } from './helpers/fixtures.js';

let env: RulesTestEnvironment;

const INV_ID = 'inv-test-grace';

beforeAll(async () => { env = await createTestEnv(); });
afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await withAdmin(env, async (db) => {
    await db.collection('organizations').doc(ORG_A).set({
      name: 'Org A', createdBy: USERS.alice.uid,
    });
    // alice = owner, bob = admin, carol = coach
    for (const [uid, role, email] of [
      [USERS.alice.uid, 'organizationOwner', USERS.alice.email],
      [USERS.bob.uid,   'organizationAdmin', USERS.bob.email],
    ] as [string, string, string][]) {
      await db.collection('organizations').doc(ORG_A)
        .collection('organizationMembers').doc(uid)
        .set({ role, email });
    }
    // carol is GEEN org-member — alleen via team (voor de negatieve aanmaak-test)
    await db.collection('organizations').doc(ORG_A)
      .collection('teams').doc('team-u23').set({ name: 'U23', createdBy: USERS.alice.uid });
    await db.collection('organizations').doc(ORG_A)
      .collection('teams').doc('team-u23')
      .collection('teamMembers').doc(USERS.carol.uid)
      .set({ role: 'coach', email: USERS.carol.email });
  });
});

describe('uitnodiging aanmaken', () => {
  it('owner (alice) mag een uitnodiging aanmaken', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertSucceeds(
      setDoc(doc(db, 'organizations', ORG_A, 'invitations', INV_ID), {
        email: USERS.grace.email,
        role: 'viewer',
        status: 'pending',
        invitedBy: USERS.alice.uid,
        invitedAt: new Date(),
        acceptedAt: null,
      }),
    );
  });

  it('admin (bob) mag een uitnodiging aanmaken', async () => {
    const db = authCtx(env, USERS.bob.uid, { email: USERS.bob.email, email_verified: true });
    await assertSucceeds(
      setDoc(doc(db, 'organizations', ORG_A, 'invitations', INV_ID + '-bob'), {
        email: USERS.grace.email,
        role: 'viewer',
        status: 'pending',
        invitedBy: USERS.bob.uid,
        invitedAt: new Date(),
        acceptedAt: null,
      }),
    );
  });

  it('coach (carol) mag GEEN uitnodiging aanmaken (geen org-member)', async () => {
    const db = authCtx(env, USERS.carol.uid, { email: USERS.carol.email, email_verified: true });
    await assertFails(
      setDoc(doc(db, 'organizations', ORG_A, 'invitations', INV_ID + '-carol'), {
        email: USERS.grace.email,
        role: 'viewer',
        status: 'pending',
        invitedBy: USERS.carol.uid,
        invitedAt: new Date(),
        acceptedAt: null,
      }),
    );
  });

  it('admin (bob) mag GEEN uitnodiging aanmaken met rol organizationOwner', async () => {
    const db = authCtx(env, USERS.bob.uid, { email: USERS.bob.email, email_verified: true });
    await assertFails(
      setDoc(doc(db, 'organizations', ORG_A, 'invitations', INV_ID + '-bob-owner'), {
        email: USERS.grace.email,
        role: 'organizationOwner',
        status: 'pending',
        invitedBy: USERS.bob.uid,
        invitedAt: new Date(),
        acceptedAt: null,
      }),
    );
  });

  it('owner (alice) KAN uitnodiging aanmaken met rol organizationOwner', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertSucceeds(
      setDoc(doc(db, 'organizations', ORG_A, 'invitations', INV_ID + '-alice-owner'), {
        email: USERS.grace.email,
        role: 'organizationOwner',
        status: 'pending',
        invitedBy: USERS.alice.uid,
        invitedAt: new Date(),
        acceptedAt: null,
      }),
    );
  });

  it('aanmaak wordt geweigerd als status niet pending is', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      setDoc(doc(db, 'organizations', ORG_A, 'invitations', INV_ID), {
        email: USERS.grace.email,
        role: 'viewer',
        status: 'accepted', // moet pending zijn bij aanmaak
        invitedBy: USERS.alice.uid,
        invitedAt: new Date(),
        acceptedAt: null,
      }),
    );
  });
});

describe('uitnodiging accepteren', () => {
  beforeEach(async () => {
    // Zet een pending uitnodiging voor grace.
    await withAdmin(env, async (db) => {
      await db.collection('organizations').doc(ORG_A)
        .collection('invitations').doc(INV_ID).set({
          email: USERS.grace.email,
          role: 'viewer',
          status: 'pending',
          invitedBy: USERS.bob.uid,
          invitedAt: new Date(),
          acceptedAt: null,
        });
    });
  });

  it('grace (geverifieerd, correct e-mail) mag accepteren', async () => {
    const db = authCtx(env, USERS.grace.uid, {
      email: USERS.grace.email,
      email_verified: true,
    });
    await assertSucceeds(
      updateDoc(doc(db, 'organizations', ORG_A, 'invitations', INV_ID), {
        status: 'accepted',
        acceptedAt: new Date(),
      }),
    );
  });

  it('jack (niet-geverifieerd) mag NIET accepteren', async () => {
    // Zet ook een uitnodiging voor jack.
    const jackInvId = 'inv-jack';
    await withAdmin(env, async (db) => {
      await db.collection('organizations').doc(ORG_A)
        .collection('invitations').doc(jackInvId).set({
          email: USERS.jack.email,
          role: 'viewer',
          status: 'pending',
          invitedBy: USERS.bob.uid,
          invitedAt: new Date(),
          acceptedAt: null,
        });
    });
    const db = authCtx(env, USERS.jack.uid, {
      email: USERS.jack.email,
      email_verified: false, // kritieke randgeval uit ADR-003
    });
    await assertFails(
      updateDoc(doc(db, 'organizations', ORG_A, 'invitations', jackInvId), {
        status: 'accepted',
        acceptedAt: new Date(),
      }),
    );
  });

  it('erin (verkeerd e-mailadres) mag grace\'s uitnodiging NIET accepteren', async () => {
    const db = authCtx(env, USERS.erin.uid, {
      email: USERS.erin.email,
      email_verified: true,
    });
    await assertFails(
      updateDoc(doc(db, 'organizations', ORG_A, 'invitations', INV_ID), {
        status: 'accepted',
        acceptedAt: new Date(),
      }),
    );
  });

  it('mag NIET de role wijzigen bij accepteren (alleen status + acceptedAt)', async () => {
    const db = authCtx(env, USERS.grace.uid, {
      email: USERS.grace.email,
      email_verified: true,
    });
    await assertFails(
      updateDoc(doc(db, 'organizations', ORG_A, 'invitations', INV_ID), {
        status: 'accepted',
        acceptedAt: new Date(),
        role: 'organizationOwner', // poging tot rol-upgrade
      }),
    );
  });
});

describe('membership claimen na acceptatie', () => {
  beforeEach(async () => {
    // Accepted uitnodiging voor grace.
    await withAdmin(env, async (db) => {
      await db.collection('organizations').doc(ORG_A)
        .collection('invitations').doc(INV_ID).set({
          email: USERS.grace.email,
          role: 'viewer',
          status: 'accepted',
          invitedBy: USERS.bob.uid,
          invitedAt: new Date(),
          acceptedAt: new Date(),
        });
    });
  });

  it('grace mag membership en claimed-status atomair aanmaken met de juiste rol', async () => {
    const db = authCtx(env, USERS.grace.uid, {
      email: USERS.grace.email,
      email_verified: true,
    });
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.grace.uid), {
      role: 'viewer',
      email: USERS.grace.email,
      invitationId: INV_ID,
      joinedAt: new Date(),
    });
    batch.update(doc(db, 'organizations', ORG_A, 'invitations', INV_ID), {
      status: 'claimed',
      claimedAt: new Date(),
    });
    await assertSucceeds(batch.commit());
  });

  it('grace mag membership NIET los aanmaken zonder de uitnodiging atomair te claimen', async () => {
    const db = authCtx(env, USERS.grace.uid, {
      email: USERS.grace.email,
      email_verified: true,
    });
    await assertFails(setDoc(
      doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.grace.uid),
      {
        role: 'viewer',
        email: USERS.grace.email,
        invitationId: INV_ID,
        joinedAt: new Date(),
      },
    ));
  });

  it('grace mag de uitnodiging NIET los claimen zonder atomair membership aan te maken', async () => {
    const db = authCtx(env, USERS.grace.uid, {
      email: USERS.grace.email,
      email_verified: true,
    });
    await assertFails(updateDoc(
      doc(db, 'organizations', ORG_A, 'invitations', INV_ID),
      { status: 'claimed', claimedAt: new Date() },
    ));
  });

  it('grace mag GEEN hogere rol claimen dan de uitnodiging toekende', async () => {
    const db = authCtx(env, USERS.grace.uid, {
      email: USERS.grace.email,
      email_verified: true,
    });
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.grace.uid), {
      role: 'organizationOwner', // uitnodiging gaf 'viewer'
      email: USERS.grace.email,
      invitationId: INV_ID,
      joinedAt: new Date(),
    });
    batch.update(doc(db, 'organizations', ORG_A, 'invitations', INV_ID), {
      status: 'claimed',
      claimedAt: new Date(),
    });
    await assertFails(batch.commit());
  });

  it('erin mag het membership NIET claimen met grace\'s uitnodiging (uid mismatch)', async () => {
    const db = authCtx(env, USERS.erin.uid, {
      email: USERS.erin.email,
      email_verified: true,
    });
    // Erin probeert grace's invitation te gebruiken voor haar eigen uid.
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.erin.uid), {
      role: 'viewer',
      email: USERS.erin.email,
      invitationId: INV_ID, // dit is grace's invitation
      joinedAt: new Date(),
    });
    batch.update(doc(db, 'organizations', ORG_A, 'invitations', INV_ID), {
      status: 'claimed',
      claimedAt: new Date(),
    });
    await assertFails(batch.commit());
  });
});

describe('ingetrokken uitnodiging blokkeert claim', () => {
  it('henry (ingetrokken uitnodiging) kan GEEN membership aanmaken', async () => {
    await withAdmin(env, async (db) => {
      await db.collection('organizations').doc(ORG_A)
        .collection('invitations').doc('inv-henry').set({
          email: USERS.henry.email,
          role: 'coach',
          status: 'revoked',
          invitedBy: USERS.bob.uid,
          invitedAt: new Date(),
          acceptedAt: null,
        });
    });
    const db = authCtx(env, USERS.henry.uid, {
      email: USERS.henry.email,
      email_verified: true,
    });
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.henry.uid), {
      role: 'coach',
      email: USERS.henry.email,
      invitationId: 'inv-henry',
      joinedAt: new Date(),
    });
    batch.update(doc(db, 'organizations', ORG_A, 'invitations', 'inv-henry'), {
      status: 'claimed',
      claimedAt: new Date(),
    });
    await assertFails(batch.commit());
  });
});

describe('uitgebruikte uitnodiging blokkeert herinstroom (replay-blokkade)', () => {
  it('grace kan membership niet opnieuw aanmaken na claim → owner-delete → her-claim', async () => {
    await withAdmin(env, async (db) => {
      await db.collection('organizations').doc(ORG_A)
        .collection('invitations').doc(INV_ID).set({
          email: USERS.grace.email, role: 'viewer', status: 'accepted',
          invitedBy: USERS.bob.uid, invitedAt: new Date(), acceptedAt: new Date(),
        });
    });

    const graceDb = authCtx(env, USERS.grace.uid, { email: USERS.grace.email, email_verified: true });

    // Stap 1: grace claimt membership en uitnodiging in één atomaire batch.
    const claimBatch = writeBatch(graceDb);
    claimBatch.set(doc(graceDb, 'organizations', ORG_A, 'organizationMembers', USERS.grace.uid), {
      role: 'viewer', email: USERS.grace.email, invitationId: INV_ID, joinedAt: new Date(),
    });
    claimBatch.update(doc(graceDb, 'organizations', ORG_A, 'invitations', INV_ID), {
      status: 'claimed', claimedAt: new Date(),
    });
    await assertSucceeds(claimBatch.commit());

    // Stap 2: owner (alice) trekt het membership in.
    const aliceDb = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertSucceeds(
      deleteDoc(doc(aliceDb, 'organizations', ORG_A, 'organizationMembers', USERS.grace.uid)),
    );

    // Stap 3: grace probeert dezelfde atomaire claim opnieuw — moet mislukken.
    const replayBatch = writeBatch(graceDb);
    replayBatch.set(doc(graceDb, 'organizations', ORG_A, 'organizationMembers', USERS.grace.uid), {
      role: 'viewer', email: USERS.grace.email, invitationId: INV_ID, joinedAt: new Date(),
    });
    replayBatch.update(doc(graceDb, 'organizations', ORG_A, 'invitations', INV_ID), {
      status: 'claimed', claimedAt: new Date(),
    });
    await assertFails(replayBatch.commit());
  });
});

describe('uitnodiging intrekken', () => {
  it('owner mag een pending uitnodiging intrekken (status → revoked)', async () => {
    await withAdmin(env, async (db) => {
      await db.collection('organizations').doc(ORG_A)
        .collection('invitations').doc(INV_ID).set({
          email: USERS.grace.email,
          role: 'viewer',
          status: 'pending',
          invitedBy: USERS.bob.uid,
          invitedAt: new Date(),
          acceptedAt: null,
        });
    });
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertSucceeds(
      updateDoc(doc(db, 'organizations', ORG_A, 'invitations', INV_ID), { status: 'revoked' }),
    );
  });

  it('intrekken mag GEEN andere velden wijzigen', async () => {
    await withAdmin(env, async (db) => {
      await db.collection('organizations').doc(ORG_A)
        .collection('invitations').doc(INV_ID).set({
          email: USERS.grace.email,
          role: 'viewer',
          status: 'pending',
          invitedBy: USERS.bob.uid,
          invitedAt: new Date(),
          acceptedAt: null,
        });
    });
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      updateDoc(doc(db, 'organizations', ORG_A, 'invitations', INV_ID), {
        status: 'revoked',
        role: 'organizationOwner', // extra veld — mag niet
      }),
    );
  });
});

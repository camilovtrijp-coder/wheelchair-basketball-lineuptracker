// Bewijst self-promotion geblokkeerd:
// - erin (viewer) kan haar eigen membership NIET naar een hogere rol updaten;
// - een gebruiker kan zichzelf NIET een membership aanmaken op een org die hij niet gemaakt heeft;
// - een owner kan zijn EIGEN membership-document niet via het update-pad wijzigen
//   (enkel het andermans-pad is toegestaan voor owner/admin);
// - het nieuwe `uid`-veld (issue #28) kan niet vervalst worden bij create;
// - het `uid`-veld kan ook niet vervalst worden bij UPDATE door owner/admin
//   (P1-review #29), inclusief het bewijs dat de outsider-contextquery na de
//   geblokkeerde poging nog steeds niets teruggeeft.

import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { doc, setDoc, updateDoc, deleteDoc, collectionGroup, getDocs, query, where } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createTestEnv, assertSucceeds, assertFails, authCtx, withAdmin } from './helpers/testEnv.js';
import { ORG_A, TEAM_A1, USERS } from './helpers/fixtures.js';

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
    await db.collection('organizations').doc(ORG_A).set({
      name: 'Org A',
      createdBy: USERS.alice.uid,
    });
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
    await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('organizationMembers')
      .doc(USERS.erin.uid)
      .set({ role: 'viewer', email: USERS.erin.email, uid: USERS.erin.uid });
    await db.collection('organizations').doc(ORG_A).collection('teams').doc(TEAM_A1).set({
      name: 'Team A1',
      createdBy: USERS.alice.uid,
    });
    await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('teams')
      .doc(TEAM_A1)
      .collection('teamMembers')
      .doc(USERS.erin.uid)
      .set({ role: 'viewer', email: USERS.erin.email });
  });
});

describe('erin (viewer) self-promotion pogingen', () => {
  it('mag haar eigen orgMember-doc NIET updaten naar owner', async () => {
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    await assertFails(
      updateDoc(doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.erin.uid), {
        role: 'organizationOwner',
      }),
    );
  });

  it('mag haar eigen orgMember-doc NIET via setDoc overschrijven naar admin', async () => {
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    await assertFails(
      setDoc(doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.erin.uid), {
        role: 'organizationAdmin',
        email: USERS.erin.email,
        uid: USERS.erin.uid,
      }),
    );
  });

  it('mag zichzelf GEEN owner-membership aanmaken op een org die een ander maakte', async () => {
    // Erin probeert een nieuw membership-doc aan te maken als owner — bootstrap-regel vereist
    // dat de org door diezelfde uid is aangemaakt (dat is alice, niet erin).
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    // Verwijder eerst erins bestaande doc zodat dit een create-poging is.
    await withAdmin(env, async (adb) => {
      await adb.collection('organizations').doc(ORG_A).collection('organizationMembers').doc(USERS.erin.uid).delete();
    });
    await assertFails(
      setDoc(doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.erin.uid), {
        role: 'organizationOwner',
        email: USERS.erin.email,
        uid: USERS.erin.uid,
      }),
    );
  });

  it('mag het `uid`-veld NIET vervalsen bij een bootstrap-create-poging op eigen org', async () => {
    // Erin maakt haar eigen org aan (dus createdBy-check slaagt), maar zet een ander uid-veld.
    const ownOrg = 'org-erin-eigen';
    await withAdmin(env, async (adb) => {
      await adb.collection('organizations').doc(ownOrg).set({ name: 'Erins Org', createdBy: USERS.erin.uid });
    });
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    await assertFails(
      setDoc(doc(db, 'organizations', ownOrg, 'organizationMembers', USERS.erin.uid), {
        role: 'organizationOwner',
        email: USERS.erin.email,
        uid: USERS.bob.uid, // vervalst
      }),
    );
  });
});

describe('bob (admin) mag GEEN owner-rol aanraken', () => {
  it('admin mag een viewer NIET naar organizationOwner promoveren', async () => {
    const db = authCtx(env, USERS.bob.uid, { email: USERS.bob.email, email_verified: true });
    await assertFails(
      updateDoc(doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.erin.uid), {
        role: 'organizationOwner',
      }),
    );
  });

  it('admin mag het ownership-membership van de owner NIET verwijderen', async () => {
    const db = authCtx(env, USERS.bob.uid, { email: USERS.bob.email, email_verified: true });
    await assertFails(deleteDoc(doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.alice.uid)));
  });

  it('admin KAN een viewer naar organizationAdmin promoveren (niet-owner-rol wél toegestaan)', async () => {
    const db = authCtx(env, USERS.bob.uid, { email: USERS.bob.email, email_verified: true });
    await assertSucceeds(
      updateDoc(doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.erin.uid), {
        role: 'organizationAdmin',
      }),
    );
  });

  it('admin mag het `uid`-veld van andermans membership NIET wijzigen (P1-review #29)', async () => {
    const db = authCtx(env, USERS.bob.uid, { email: USERS.bob.email, email_verified: true });
    await assertFails(
      updateDoc(doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.erin.uid), {
        uid: USERS.dave.uid, // vervalst — moet gelijk blijven aan de document-ID
      }),
    );

    // Outsider-contextquery: dave (op wiens uid de poging mikte) mag na de
    // geblokkeerde update nog steeds NIETS terugkrijgen van org A — het
    // `uid`-veld op erins doc is onveranderd gebleven.
    const daveDb = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    const snap = await getDocs(
      query(collectionGroup(daveDb, 'organizationMembers'), where('uid', '==', USERS.dave.uid)),
    );
    expect(snap.empty).toBe(true);
  });
});

describe('alice (owner) mag haar EIGEN membership NIET via het owner/admin-pad wijzigen', () => {
  it('owner kan eigen doc niet updaten via update-pad (uid == uid blokkeert)', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      updateDoc(doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.alice.uid), {
        role: 'organizationAdmin',
      }),
    );
  });

  it('owner KAN erins membership wel wijzigen (andermans doc)', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertSucceeds(
      updateDoc(doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.erin.uid), {
        role: 'coach',
      }),
    );
  });

  it('owner mag het `uid`-veld van andermans membership NIET wijzigen (P1-review #29)', async () => {
    // Vervalste update van erins membership: uid laten afwijken van de document-ID.
    // Zonder de fix zou dit erins membership "onvindbaar" maken voor haarzelf via
    // de collectionGroup-query (issue #28) en het membership aan een ander tonen.
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      updateDoc(doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.erin.uid), {
        uid: USERS.dave.uid, // vervalst — moet gelijk blijven aan de document-ID
      }),
    );

    // Outsider-contextquery: dave (op wiens uid de poging mikte) mag na de
    // geblokkeerde update nog steeds NIETS terugkrijgen van org A.
    const daveDb = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    const snap = await getDocs(
      query(collectionGroup(daveDb, 'organizationMembers'), where('uid', '==', USERS.dave.uid)),
    );
    expect(snap.empty).toBe(true);
  });
});

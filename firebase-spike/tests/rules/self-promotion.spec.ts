// Bewijst item 5 (self-promotion geblokkeerd):
// - erin (viewer) kan haar eigen membership NIET naar een hogere rol updaten;
// - een gebruiker kan zichzelf NIET een membership aanmaken op een org die hij niet gemaakt heeft;
// - een owner kan zijn EIGEN membership-document niet via het update-pad wijzigen
//   (enkel het andermans-pad is toegestaan voor owner/admin).

import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  createTestEnv, assertSucceeds, assertFails, authCtx, withAdmin,
} from './helpers/testEnv.js';
import { ORG_A, TEAM_A1, USERS } from './helpers/fixtures.js';

let env: RulesTestEnvironment;

beforeAll(async () => { env = await createTestEnv(); });
afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await withAdmin(env, async (db) => {
    await db.collection('organizations').doc(ORG_A).set({
      name: 'Org A', createdBy: USERS.alice.uid,
    });
    await db.collection('organizations').doc(ORG_A)
      .collection('organizationMembers').doc(USERS.alice.uid)
      .set({ role: 'organizationOwner', email: USERS.alice.email });
    await db.collection('organizations').doc(ORG_A)
      .collection('organizationMembers').doc(USERS.erin.uid)
      .set({ role: 'viewer', email: USERS.erin.email });
    await db.collection('organizations').doc(ORG_A)
      .collection('teams').doc(TEAM_A1).set({ name: 'Team A1', createdBy: USERS.alice.uid });
    await db.collection('organizations').doc(ORG_A)
      .collection('teams').doc(TEAM_A1)
      .collection('teamMembers').doc(USERS.erin.uid)
      .set({ role: 'viewer', email: USERS.erin.email });
  });
});

describe('erin (viewer) self-promotion pogingen', () => {
  it('mag haar eigen orgMember-doc NIET updaten naar owner', async () => {
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    await assertFails(
      updateDoc(
        doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.erin.uid),
        { role: 'organizationOwner' },
      ),
    );
  });

  it('mag haar eigen orgMember-doc NIET via setDoc overschrijven naar admin', async () => {
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    await assertFails(
      setDoc(
        doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.erin.uid),
        { role: 'organizationAdmin', email: USERS.erin.email },
      ),
    );
  });

  it('mag zichzelf GEEN owner-membership aanmaken op een org die een ander maakte', async () => {
    // Erin probeert een nieuw membership-doc aan te maken als owner — bootstrap-regel vereist
    // dat de org door diezelfde uid is aangemaakt (dat is alice, niet erin).
    const db = authCtx(env, USERS.erin.uid, { email: USERS.erin.email, email_verified: true });
    // Verwijder eerst erins bestaande doc zodat dit een create-poging is.
    await withAdmin(env, async (adb) => {
      await adb.collection('organizations').doc(ORG_A)
        .collection('organizationMembers').doc(USERS.erin.uid).delete();
    });
    await assertFails(
      setDoc(
        doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.erin.uid),
        { role: 'organizationOwner', email: USERS.erin.email },
      ),
    );
  });
});

describe('alice (owner) mag haar EIGEN membership NIET via het owner/admin-pad wijzigen', () => {
  it('owner kan eigen doc niet updaten via update-pad (uid == uid blokkeert)', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      updateDoc(
        doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.alice.uid),
        { role: 'organizationAdmin' },
      ),
    );
  });

  it('owner KAN erins membership wel wijzigen (andermans doc)', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertSucceeds(
      updateDoc(
        doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.erin.uid),
        { role: 'coach' },
      ),
    );
  });
});

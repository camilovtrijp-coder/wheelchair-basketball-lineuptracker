// PR 8.3c-2 (besluitrecord §8.7): twee termijnen die de restgaten uit de review van #98 insnoeren.
//
// 1. Claimtermijn (restgat 1): de claim-update van een uitnodiging (accepted → claimed) kan
//    alleen binnen 30 dagen na `invitedAt`.
// 2. Bootstrap-binding (restgat 2): de bootstrap-create van het owner-membership kan alleen
//    binnen 7 dagen na `createdAt` van de organisatie; zonder (of met een onleesbare)
//    `createdAt` faalt hij gesloten.
//
// Seeds lopen via de admin-context (omzeilt Rules) en stellen documenten van een bepaalde
// leeftijd voor; de client-writes gebruiken `serverTimestamp()` zoals de echte app. Alle
// gebruikers en e-mailadressen zijn fictief.

import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import { doc, setDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  createTestEnv,
  assertSucceeds,
  assertFails,
  authCtx,
  withAdmin,
} from './helpers/testEnv.js';
import { ORG_A, USERS } from './helpers/fixtures.js';
import { dagenGeleden } from './helpers/retention.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});

const ctx = (key: keyof typeof USERS) =>
  authCtx(env, USERS[key].uid, { email: USERS[key].email, email_verified: true });
const ts = (dagen: number) => Timestamp.fromDate(dagenGeleden(dagen));

/** Seed een organisatie die `leeftijdDagen` oud is (of zonder `createdAt` bij `null`). */
async function seedOrg(
  leeftijdDagen: number | null,
  members: Array<[keyof typeof USERS, string]> = [],
) {
  await env.clearFirestore();
  await withAdmin(env, async (db) => {
    const org = db.collection('organizations').doc(ORG_A);
    await org.set({
      name: 'Org A (fictief)',
      createdBy: USERS.alice.uid,
      ...(leeftijdDagen === null ? {} : { createdAt: ts(leeftijdDagen) }),
    });
    for (const [key, role] of members) {
      await org
        .collection('organizationMembers')
        .doc(USERS[key].uid)
        .set({ role, email: USERS[key].email, uid: USERS[key].uid });
    }
  });
}

const bootstrap = (key: keyof typeof USERS) =>
  setDoc(doc(ctx(key), 'organizations', ORG_A, 'organizationMembers', USERS[key].uid), {
    role: 'organizationOwner',
    email: USERS[key].email,
    uid: USERS[key].uid,
  });

describe('bootstrap-binding: owner-membership aanmaken alleen in de eerste 7 dagen', () => {
  it('de maker van een organisatie van 6 dagen oud kan zijn owner-membership aanmaken', async () => {
    await seedOrg(6);
    await assertSucceeds(bootstrap('alice'));
  });

  it('de maker van een organisatie van 8 dagen oud kan dat NIET meer', async () => {
    await seedOrg(8);
    await assertFails(bootstrap('alice'));
  });

  it('ook een organisatie van een jaar oud blijft dicht', async () => {
    await seedOrg(365);
    await assertFails(bootstrap('alice'));
  });

  it('een organisatie zonder createdAt faalt gesloten', async () => {
    await seedOrg(null);
    await assertFails(bootstrap('alice'));
  });

  it('een organisatie met een createdAt dat geen tijdstip is faalt gesloten', async () => {
    await seedOrg(null);
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .update({ createdAt: '2026-01-01T00:00:00.000Z' });
    });
    await assertFails(bootstrap('alice'));
  });

  it('een ander dan de maker kan nooit bootstrappen, ook niet in de eerste 7 dagen', async () => {
    await seedOrg(1);
    await assertFails(bootstrap('bob'));
  });

  it('de bootstrap geeft alleen de owner-rol: een lagere rol aanmaken faalt ook binnen 7 dagen', async () => {
    await seedOrg(1);
    await assertFails(
      setDoc(doc(ctx('alice'), 'organizations', ORG_A, 'organizationMembers', USERS.alice.uid), {
        role: 'coach',
        email: USERS.alice.email,
        uid: USERS.alice.uid,
      }),
    );
  });

  it('gedemoveerde maker door een owner verwijderd: na 7 dagen geen re-bootstrap meer (RESTGAT 2 dicht)', async () => {
    await seedOrg(30, [
      ['alice', 'coach'],
      ['kevin', 'organizationOwner'],
    ]);
    await assertSucceeds(
      deleteDoc(doc(ctx('kevin'), 'organizations', ORG_A, 'organizationMembers', USERS.alice.uid)),
    );
    await assertFails(bootstrap('alice'));
  });

  it('gedemoveerde maker door een ADMIN verwijderd: na 7 dagen geen re-bootstrap meer (RESTGAT 2b dicht)', async () => {
    await seedOrg(30, [
      ['alice', 'coach'],
      ['bob', 'organizationAdmin'],
    ]);
    await assertSucceeds(
      deleteDoc(doc(ctx('bob'), 'organizations', ORG_A, 'organizationMembers', USERS.alice.uid)),
    );
    await assertFails(bootstrap('alice'));
  });

  it('restvenster (gedocumenteerd): binnen de eerste 7 dagen kan een verwijderde gedemoveerde maker nog wel terug', async () => {
    await seedOrg(2, [
      ['alice', 'coach'],
      ['kevin', 'organizationOwner'],
    ]);
    await assertSucceeds(
      deleteDoc(doc(ctx('kevin'), 'organizations', ORG_A, 'organizationMembers', USERS.alice.uid)),
    );
    await assertSucceeds(bootstrap('alice'));
  });

  it('de bestaande app-flow blijft werken: organisatie + owner-membership aanmaken in één sessie', async () => {
    await env.clearFirestore();
    const db = ctx('grace');
    await assertSucceeds(
      setDoc(doc(db, 'organizations', 'org-grace-nieuw'), {
        name: 'Graces Org (fictief)',
        createdBy: USERS.grace.uid,
        createdAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      setDoc(doc(db, 'organizations', 'org-grace-nieuw', 'organizationMembers', USERS.grace.uid), {
        role: 'organizationOwner',
        email: USERS.grace.email,
        uid: USERS.grace.uid,
      }),
    );
  });
});

describe('claimtermijn: accepted → claimed alleen binnen 30 dagen na invitedAt', () => {
  const INV = 'inv-termijn';

  async function seedAcceptedInvitation(invitedDagenGeleden: number, role = 'organizationAdmin') {
    await seedOrg(400, [
      ['alice', 'organizationOwner'],
      ['erin', 'viewer'],
    ]);
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('invitations')
        .doc(INV)
        .set({
          email: USERS.grace.email,
          role,
          status: 'accepted',
          invitedAt: ts(invitedDagenGeleden),
          acceptedAt: ts(Math.min(invitedDagenGeleden, 1)),
        });
    });
  }

  const claim = (key: keyof typeof USERS, role = 'organizationAdmin') => {
    const db = ctx(key);
    const batch = writeBatch(db);
    batch.update(doc(db, 'organizations', ORG_A, 'invitations', INV), {
      status: 'claimed',
      claimedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'organizations', ORG_A, 'organizationMembers', USERS[key].uid), {
      role,
      email: USERS[key].email,
      uid: USERS[key].uid,
      invitationId: INV,
    });
    return batch.commit();
  };

  it('een claim 29 dagen na invitedAt lukt', async () => {
    await seedAcceptedInvitation(29);
    await assertSucceeds(claim('grace'));
  });

  it('een claim 31 dagen na invitedAt faalt, ook al is de uitnodiging nog accepted', async () => {
    await seedAcceptedInvitation(31);
    await assertFails(claim('grace'));
  });

  it('een claim lang na invitedAt (een jaar) faalt', async () => {
    await seedAcceptedInvitation(365);
    await assertFails(claim('grace'));
  });

  it('het membership aanmaken zonder de claim-update faalt ook na de termijn (geen omweg)', async () => {
    await seedAcceptedInvitation(31);
    await assertFails(
      setDoc(doc(ctx('grace'), 'organizations', ORG_A, 'organizationMembers', USERS.grace.uid), {
        role: 'organizationAdmin',
        email: USERS.grace.email,
        uid: USERS.grace.uid,
        invitationId: INV,
      }),
    );
  });

  it('RESTGAT 1 ingesnoerd: een lid dat vertrekt kan een oude (31 dagen) hogere uitnodiging niet meer claimen', async () => {
    await seedOrg(400, [
      ['alice', 'organizationOwner'],
      ['erin', 'viewer'],
    ]);
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('invitations')
        .doc(INV)
        .set({
          email: USERS.erin.email,
          role: 'organizationAdmin',
          status: 'accepted',
          invitedAt: ts(31),
          acceptedAt: ts(30),
        });
    });
    const db = ctx('erin');
    await assertSucceeds(
      deleteDoc(doc(db, 'organizations', ORG_A, 'organizationMembers', USERS.erin.uid)),
    );
    await assertFails(claim('erin'));
  });

  it('restvenster (gedocumenteerd): een recente (5 dagen) hogere uitnodiging blijft na vertrek claimbaar', async () => {
    await seedOrg(400, [
      ['alice', 'organizationOwner'],
      ['erin', 'viewer'],
    ]);
    await withAdmin(env, async (db) => {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('invitations')
        .doc(INV)
        .set({
          email: USERS.erin.email,
          role: 'organizationAdmin',
          status: 'accepted',
          invitedAt: ts(5),
          acceptedAt: ts(4),
        });
    });
    await assertSucceeds(
      deleteDoc(doc(ctx('erin'), 'organizations', ORG_A, 'organizationMembers', USERS.erin.uid)),
    );
    await assertSucceeds(claim('erin'));
  });

  it('de verkeerde e-mail kan binnen de termijn niet claimen (bestaand gedrag ongewijzigd)', async () => {
    await seedAcceptedInvitation(2);
    await assertFails(claim('henry'));
  });
});

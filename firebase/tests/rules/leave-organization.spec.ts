// PR 8.3c-2a (docs/pr-8.3c-besluitvoorstel.md §4.3): "organisatie verlaten" — alleen de
// Rules-kant. Iedereen behalve een owner verwijdert het EIGEN `organizationMembers`-document;
// iedereen verwijdert het EIGEN `teamMembers`-document. Een owner kan zijn org-membership
// niet verwijderen, en de maker van de organisatie ook niet (anders kan een gedemoveerde
// maker zich via de bootstrap-create weer owner maken). Alles met fictieve gebruikers.
//
// Bewijst ook de post-delete-readback uit §4.3/§5 test 6: nadat elk lidmaatschap weg is,
// geven beide eigen-uid-collectionGroup-queries nul rijen terug (geen permission-denied).
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import {
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  createTestEnv,
  assertSucceeds,
  assertFails,
  authCtx,
  unauthCtx,
  withAdmin,
} from './helpers/testEnv.js';
import { ORG_A, ORG_B, TEAM_A1, TEAM_B1, USERS } from './helpers/fixtures.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

type Role = 'organizationOwner' | 'organizationAdmin' | 'coach' | 'scorer' | 'viewer';
const user = (key: keyof typeof USERS) => USERS[key];
const ctx = (key: keyof typeof USERS) =>
  authCtx(env, user(key).uid, { email: user(key).email, email_verified: true });
const orgMemberRef = (db: ReturnType<typeof ctx>, org: string, key: keyof typeof USERS) =>
  doc(db, 'organizations', org, 'organizationMembers', user(key).uid);
const teamMemberRef = (
  db: ReturnType<typeof ctx>,
  org: string,
  team: string,
  key: keyof typeof USERS,
) => doc(db, 'organizations', org, 'teams', team, 'teamMembers', user(key).uid);

async function teamMemberExists(key: keyof typeof USERS): Promise<boolean> {
  return withAdmin(env, async (admin) => {
    const snap = await admin
      .collection('organizations')
      .doc(ORG_A)
      .collection('teams')
      .doc(TEAM_A1)
      .collection('teamMembers')
      .doc(user(key).uid)
      .get();
    return snap.exists;
  });
}

beforeEach(async () => {
  await env.clearFirestore();
  await withAdmin(env, async (db) => {
    const org = db.collection('organizations').doc(ORG_A);
    await org.set({ name: 'Rotterdam Basketball (fictief)', createdBy: USERS.alice.uid });
    const members: [keyof typeof USERS, Role][] = [
      ['alice', 'organizationOwner'],
      ['bob', 'organizationAdmin'],
      ['carol', 'coach'],
      ['dave', 'scorer'],
      ['erin', 'viewer'],
      ['kevin', 'organizationOwner'], // tweede owner die NIET de maker is
    ];
    for (const [key, role] of members) {
      await org
        .collection('organizationMembers')
        .doc(user(key).uid)
        .set({ role, email: user(key).email, uid: user(key).uid });
    }
    const team = org.collection('teams').doc(TEAM_A1);
    await team.set({ name: 'U23', orgName: 'Org A', createdBy: USERS.alice.uid });
    // carol/dave/erin hebben ook een teamMembers-document; frank is TEAM-ONLY (geen org-lidmaatschap);
    // alice (owner) heeft er ook één, om te bewijzen dat een owner het eigen document wél kan
    // verwijderen (bestaande owner/admin-tak) en daarna nog steeds toegang heeft.
    const teamMembers: [keyof typeof USERS, string][] = [
      ['carol', 'coach'],
      ['dave', 'scorer'],
      ['erin', 'viewer'],
      ['frank', 'coach'],
      ['alice', 'coach'],
    ];
    for (const [key, role] of teamMembers) {
      await team
        .collection('teamMembers')
        .doc(user(key).uid)
        .set({ role, email: user(key).email, uid: user(key).uid });
    }
    // Een tweede organisatie, om cross-org te bewijzen.
    const other = db.collection('organizations').doc(ORG_B);
    await other.set({ name: 'NBB (fictief)', createdBy: USERS.grace.uid });
    await other
      .collection('organizationMembers')
      .doc(USERS.grace.uid)
      .set({ role: 'organizationOwner', email: USERS.grace.email, uid: USERS.grace.uid });
    await other
      .collection('organizationMembers')
      .doc(USERS.henry.uid)
      .set({ role: 'coach', email: USERS.henry.email, uid: USERS.henry.uid });
    await other.collection('teams').doc(TEAM_B1).set({ name: 'Selectie', orgName: 'Org B' });
    await other
      .collection('teams')
      .doc(TEAM_B1)
      .collection('teamMembers')
      .doc(USERS.henry.uid)
      .set({ role: 'coach', email: USERS.henry.email, uid: USERS.henry.uid });
  });
});

describe('organizationMembers: het eigen membership verwijderen (organisatie verlaten)', () => {
  for (const key of ['bob', 'carol', 'dave', 'erin'] as const) {
    it(`${key} (niet-owner) kan zijn EIGEN membership verwijderen`, async () => {
      const db = ctx(key);
      await assertSucceeds(deleteDoc(orgMemberRef(db, ORG_A, key)));
      await withAdmin(env, async (admin) => {
        const snap = await admin
          .collection('organizations')
          .doc(ORG_A)
          .collection('organizationMembers')
          .doc(user(key).uid)
          .get();
        expect(snap.exists).toBe(false);
      });
    });
  }

  it('een owner (niet de maker) kan zichzelf NIET verwijderen', async () => {
    await assertFails(deleteDoc(orgMemberRef(ctx('kevin'), ORG_A, 'kevin')));
  });

  it('de owner die de maker is kan zichzelf NIET verwijderen', async () => {
    await assertFails(deleteDoc(orgMemberRef(ctx('alice'), ORG_A, 'alice')));
  });

  it('een GEDEMOVEERDE maker kan zichzelf niet verwijderen (anders re-bootstrap als owner)', async () => {
    await withAdmin(env, async (admin) => {
      await admin
        .collection('organizations')
        .doc(ORG_A)
        .collection('organizationMembers')
        .doc(USERS.alice.uid)
        .update({ role: 'organizationAdmin' });
    });
    const db = ctx('alice');
    await assertFails(deleteDoc(orgMemberRef(db, ORG_A, 'alice')));
    // En het document staat er nog: er is dus geen leeg gat waarin de bootstrap-create kan landen.
    await assertSucceeds(getDoc(orgMemberRef(db, ORG_A, 'alice')));
  });

  it('een gedemoveerde maker kan door een owner worden verwijderd (let op: dat opent RESTGAT 2, zie onderaan)', async () => {
    await withAdmin(env, async (admin) => {
      await admin
        .collection('organizations')
        .doc(ORG_A)
        .collection('organizationMembers')
        .doc(USERS.alice.uid)
        .update({ role: 'coach' });
    });
    await assertSucceeds(deleteDoc(orgMemberRef(ctx('kevin'), ORG_A, 'alice')));
  });

  it('na een geslaagde self-delete kan dezelfde gebruiker zich NIET opnieuw als owner aanmaken', async () => {
    const db = ctx('carol');
    await assertSucceeds(deleteDoc(orgMemberRef(db, ORG_A, 'carol')));
    await assertFails(
      setDoc(orgMemberRef(db, ORG_A, 'carol'), {
        role: 'organizationOwner',
        email: user('carol').email,
        uid: user('carol').uid,
      }),
    );
  });

  it('niemand verwijdert andermans membership via de self-deletetak (coach → viewer, viewer → admin)', async () => {
    await assertFails(deleteDoc(orgMemberRef(ctx('carol'), ORG_A, 'erin')));
    await assertFails(deleteDoc(orgMemberRef(ctx('erin'), ORG_A, 'bob')));
    await assertFails(deleteDoc(orgMemberRef(ctx('dave'), ORG_A, 'kevin')));
  });

  it('cross-org: een lid van een andere organisatie kan hier niets verwijderen', async () => {
    await assertFails(deleteDoc(orgMemberRef(ctx('henry'), ORG_A, 'carol')));
    // en andersom: carol raakt ORG_B niet aan
    await assertFails(deleteDoc(orgMemberRef(ctx('carol'), ORG_B, 'henry')));
  });

  it('een niet-ingelogde gebruiker kan niets verwijderen', async () => {
    await assertFails(
      deleteDoc(
        doc(unauthCtx(env), 'organizations', ORG_A, 'organizationMembers', user('carol').uid),
      ),
    );
  });

  it('bestaande takken blijven gelden: owner verwijdert andermans membership, admin geen owner', async () => {
    await assertSucceeds(deleteDoc(orgMemberRef(ctx('kevin'), ORG_A, 'erin')));
    await assertFails(deleteDoc(orgMemberRef(ctx('bob'), ORG_A, 'kevin')));
  });
});

describe('teamMembers: het eigen document verwijderen', () => {
  for (const key of ['carol', 'dave', 'erin'] as const) {
    it(`${key} (org-lid, niet-owner) kan zijn EIGEN teamMembers-document verwijderen`, async () => {
      await assertSucceeds(deleteDoc(teamMemberRef(ctx(key), ORG_A, TEAM_A1, key)));
      expect(await teamMemberExists(key)).toBe(false);
    });
  }

  it('een TEAM-ONLY lid (geen organizationMembers-document) kan zijn eigen teamMembers-document verwijderen', async () => {
    await assertSucceeds(deleteDoc(teamMemberRef(ctx('frank'), ORG_A, TEAM_A1, 'frank')));
    expect(await teamMemberExists('frank')).toBe(false);
  });

  it('een owner kan zijn eigen teamMembers-document verwijderen, maar houdt zijn toegang via het org-membership', async () => {
    // Geen nieuwe tak nodig: owner/admin konden dit al. Het document verleent een owner niets.
    const db = ctx('alice');
    await assertSucceeds(deleteDoc(teamMemberRef(db, ORG_A, TEAM_A1, 'alice')));
    expect(await teamMemberExists('alice')).toBe(false);
    await assertSucceeds(getDoc(doc(db, 'organizations', ORG_A, 'teams', TEAM_A1)));
    await assertSucceeds(getDoc(orgMemberRef(db, ORG_A, 'alice')));
  });

  it('niemand verwijdert het teamMembers-document van een ander via de self-deletetak', async () => {
    await assertFails(deleteDoc(teamMemberRef(ctx('carol'), ORG_A, TEAM_A1, 'dave')));
    await assertFails(deleteDoc(teamMemberRef(ctx('frank'), ORG_A, TEAM_A1, 'carol')));
    await assertFails(deleteDoc(teamMemberRef(ctx('henry'), ORG_A, TEAM_A1, 'carol')));
  });

  it('een niet-ingelogde gebruiker kan niets verwijderen', async () => {
    await assertFails(
      deleteDoc(
        doc(
          unauthCtx(env),
          'organizations',
          ORG_A,
          'teams',
          TEAM_A1,
          'teamMembers',
          user('carol').uid,
        ),
      ),
    );
  });

  it('bestaande tak blijft gelden: owner/admin verwijdert andermans teamMembers-document', async () => {
    await assertSucceeds(deleteDoc(teamMemberRef(ctx('bob'), ORG_A, TEAM_A1, 'carol')));
  });
});

describe('volgorde en eindcontrole (§4.3)', () => {
  it('de vaste volgorde werkt: teamMembers eerst, dan als laatste het organizationMembers-document', async () => {
    const db = ctx('carol');
    await assertSucceeds(deleteDoc(teamMemberRef(db, ORG_A, TEAM_A1, 'carol')));
    await assertSucceeds(deleteDoc(orgMemberRef(db, ORG_A, 'carol')));
  });

  it('de volgorde is bewijsdiscipline, geen bevoegdheid: andersom lukt de delete technisch ook', async () => {
    const db = ctx('erin');
    await assertSucceeds(deleteDoc(orgMemberRef(db, ORG_A, 'erin')));
    await assertSucceeds(deleteDoc(teamMemberRef(db, ORG_A, TEAM_A1, 'erin')));
  });

  it('de eindcontrole werkt ná de laatste delete: beide eigen-uid-collectionGroup-queries geven nul rijen', async () => {
    const db = ctx('carol');
    // Vooraf: één rij in elk.
    const orgBefore = await assertSucceeds(
      getDocs(
        query(collectionGroup(db, 'organizationMembers'), where('uid', '==', user('carol').uid)),
      ),
    );
    const teamBefore = await assertSucceeds(
      getDocs(query(collectionGroup(db, 'teamMembers'), where('uid', '==', user('carol').uid))),
    );
    expect(orgBefore.size).toBe(1);
    expect(teamBefore.size).toBe(1);

    await assertSucceeds(deleteDoc(teamMemberRef(db, ORG_A, TEAM_A1, 'carol')));
    await assertSucceeds(deleteDoc(orgMemberRef(db, ORG_A, 'carol')));

    // Achteraf: nul rijen, en de query is NIET geweigerd (de recursieve matches hangen aan het token).
    const orgAfter = await assertSucceeds(
      getDocs(
        query(collectionGroup(db, 'organizationMembers'), where('uid', '==', user('carol').uid)),
      ),
    );
    const teamAfter = await assertSucceeds(
      getDocs(query(collectionGroup(db, 'teamMembers'), where('uid', '==', user('carol').uid))),
    );
    expect(orgAfter.size).toBe(0);
    expect(teamAfter.size).toBe(0);
  });

  it('na het verlaten verliest de gebruiker de leestoegang tot de organisatie', async () => {
    const db = ctx('dave');
    await assertSucceeds(getDoc(doc(db, 'organizations', ORG_A)));
    await assertSucceeds(deleteDoc(teamMemberRef(db, ORG_A, TEAM_A1, 'dave')));
    await assertSucceeds(deleteDoc(orgMemberRef(db, ORG_A, 'dave')));
    await assertFails(getDoc(doc(db, 'organizations', ORG_A)));
  });

  it('andere leden worden niet geraakt door het vertrek van één lid', async () => {
    await assertSucceeds(deleteDoc(teamMemberRef(ctx('carol'), ORG_A, TEAM_A1, 'carol')));
    await assertSucceeds(deleteDoc(orgMemberRef(ctx('carol'), ORG_A, 'carol')));
    await assertSucceeds(getDoc(orgMemberRef(ctx('dave'), ORG_A, 'dave')));
    await assertSucceeds(getDoc(teamMemberRef(ctx('dave'), ORG_A, TEAM_A1, 'dave')));
  });
});

// RESTGATEN uit besluitrecord §8.6 (review van PR #98), na de besluiten van §8.7. RESTGAT 1
// (claim na vertrek) is ingesnoerd tot 30 dagen na `invitedAt`; de bewijzen daarvan staan in
// claim-and-bootstrap-terms.spec.ts, en de pin hieronder blijft als restvenster bestaan.
// RESTGAT 2 en 2b (bootstrap na verwijdering) zijn dicht na 7 dagen; hier de twee oorspronkelijke
// paden als negatieve test. Het restvenster van de eerste 7 dagen staat in dezelfde nieuwe spec.
describe('restgaten uit besluitrecord §8.6 na de termijnen van §8.7', () => {
  it('RESTGAT 1 (restvenster 30 dagen): een lid dat vertrekt kan een recente, nog openstaande uitnodiging met een hogere rol claimen', async () => {
    // erin is viewer; er staat nog een accepted uitnodiging op haar adres met rol admin.
    await withAdmin(env, async (admin) => {
      await admin
        .collection('organizations')
        .doc(ORG_A)
        .collection('invitations')
        .doc('inv-open')
        .set({
          email: user('erin').email,
          role: 'organizationAdmin',
          status: 'accepted',
          invitedAt: Timestamp.now(),
          acceptedAt: Timestamp.now(),
        });
    });
    const db = ctx('erin');
    // Vóór het vertrekken kan dit niet: de claim vereist dat het eigen membership NIET bestaat.
    const blocked = writeBatch(db);
    blocked.update(doc(db, 'organizations', ORG_A, 'invitations', 'inv-open'), {
      status: 'claimed',
      claimedAt: serverTimestamp(),
    });
    blocked.set(orgMemberRef(db, ORG_A, 'erin'), {
      role: 'organizationAdmin',
      email: user('erin').email,
      uid: user('erin').uid,
      invitationId: 'inv-open',
    });
    await assertFails(blocked.commit());
    // Na het vertrekken wel (nieuw door 8.3c-2a): de beheerder die dit niet wil, trekt de
    // uitnodiging in vóór of bij het demoveren/verwijderen (client-discipline in 2b/2c).
    await assertSucceeds(deleteDoc(orgMemberRef(db, ORG_A, 'erin')));
    const claim = writeBatch(db);
    claim.update(doc(db, 'organizations', ORG_A, 'invitations', 'inv-open'), {
      status: 'claimed',
      claimedAt: serverTimestamp(),
    });
    claim.set(orgMemberRef(db, ORG_A, 'erin'), {
      role: 'organizationAdmin',
      email: user('erin').email,
      uid: user('erin').uid,
      invitationId: 'inv-open',
    });
    await assertSucceeds(claim.commit());
  });

  it('RESTGAT 2b gesloten door de bootstrap-binding: een ADMIN verwijdert een gedemoveerde maker, maar die kan zich na 7 dagen niet meer owner maken', async () => {
    await withAdmin(env, async (admin) => {
      const org = admin.collection('organizations').doc(ORG_A);
      await org.update({
        createdAt: Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
      });
      await org.collection('organizationMembers').doc(USERS.alice.uid).update({ role: 'coach' });
    });
    await assertSucceeds(deleteDoc(orgMemberRef(ctx('bob'), ORG_A, 'alice')));
    await assertFails(
      setDoc(orgMemberRef(ctx('alice'), ORG_A, 'alice'), {
        role: 'organizationOwner',
        email: user('alice').email,
        uid: user('alice').uid,
      }),
    );
  });

  it('RESTGAT 2 gesloten door de bootstrap-binding: een OWNER verwijdert een gedemoveerde maker, maar die kan zich na 7 dagen niet meer owner maken', async () => {
    await withAdmin(env, async (admin) => {
      const org = admin.collection('organizations').doc(ORG_A);
      await org.update({
        createdAt: Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
      });
      await org.collection('organizationMembers').doc(USERS.alice.uid).update({ role: 'coach' });
    });
    await assertSucceeds(deleteDoc(orgMemberRef(ctx('kevin'), ORG_A, 'alice')));
    await assertFails(
      setDoc(orgMemberRef(ctx('alice'), ORG_A, 'alice'), {
        role: 'organizationOwner',
        email: user('alice').email,
        uid: user('alice').uid,
      }),
    );
  });
});

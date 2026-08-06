// Issue #28 — querycontract voor de toekomstige contextwisselaar ("alle
// organisaties waar ik lid van ben"). De ENIGE toegestane niet-directe query
// in de hele app is:
//
//   collectionGroup('organizationMembers').where('uid', '==', <eigen uid>)
//
// Zie firebase/docs/QUERY_CONTRACT.md voor het volledige contract. Dit bestand
// bewijst empirisch:
//  1. positief: die ene toegestane query levert precies de eigen memberships
//     op, over meerdere organisaties heen;
//  2. negatief: geen enkele andere collectionGroup-vorm (zonder filter, of
//     met andermans uid) geeft een membershipdocument van een organisatie
//     terug waar de aanvrager geen lid van is;
//  3. negatief: het `uid`-veld zelf kan niet vervalst worden bij aanmaak
//     (afgedekt in bootstrap-and-invitation-flow.spec.ts en self-promotion.spec.ts;
//     hier alleen de queryconsequentie).

import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { collectionGroup, getDocs, query, where } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createTestEnv, authCtx, withAdmin } from './helpers/testEnv.js';
import { ORG_A, ORG_B, USERS } from './helpers/fixtures.js';

let env: RulesTestEnvironment;

// Derde organisatie, alleen voor dit bestand: frank is hier owner en NERGENS
// anders lid van, zodat "een crafted query met andermans uid" een echte
// cross-org-poging is en niet toevallig al toegestaan zou zijn via isOrgMember.
const ORG_C = 'org-c-geen-toegang-voor-dave';

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await withAdmin(env, async (db) => {
    // Org A: alice = owner, dave = viewer (org-niveau membership, niet alleen team).
    await db.collection('organizations').doc(ORG_A).set({ name: 'Org A', createdBy: USERS.alice.uid });
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
      .doc(USERS.dave.uid)
      .set({ role: 'viewer', email: USERS.dave.email, uid: USERS.dave.uid });

    // Org B: alice = viewer (tweede org voor alice — bewijst de positieve multi-org-query).
    await db.collection('organizations').doc(ORG_B).set({ name: 'Org B', createdBy: USERS.frank.uid });
    await db
      .collection('organizations')
      .doc(ORG_B)
      .collection('organizationMembers')
      .doc(USERS.frank.uid)
      .set({ role: 'organizationOwner', email: USERS.frank.email, uid: USERS.frank.uid });
    await db
      .collection('organizations')
      .doc(ORG_B)
      .collection('organizationMembers')
      .doc(USERS.alice.uid)
      .set({ role: 'viewer', email: USERS.alice.email, uid: USERS.alice.uid });

    // Org C: frank = owner, dave heeft GEEN membership hier of in org B.
    await db.collection('organizations').doc(ORG_C).set({ name: 'Org C', createdBy: USERS.frank.uid });
    await db
      .collection('organizations')
      .doc(ORG_C)
      .collection('organizationMembers')
      .doc(USERS.frank.uid)
      .set({ role: 'organizationOwner', email: USERS.frank.email, uid: USERS.frank.uid });
  });
});

describe('positief: eigen memberships over meerdere organisaties', () => {
  it('alice krijgt via de toegestane query precies haar 2 memberships (org A + org B)', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    const snap = await getDocs(
      query(collectionGroup(db, 'organizationMembers'), where('uid', '==', USERS.alice.uid)),
    );
    expect(snap.size).toBe(2);
    const orgIds = snap.docs.map((d) => d.ref.parent.parent!.id).sort();
    expect(orgIds).toEqual([ORG_A, ORG_B].sort());
    for (const d of snap.docs) {
      expect(d.data().uid).toBe(USERS.alice.uid);
    }
  });

  it('dave krijgt via de toegestane query precies zijn 1 membership (alleen org A)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    const snap = await getDocs(
      query(collectionGroup(db, 'organizationMembers'), where('uid', '==', USERS.dave.uid)),
    );
    expect(snap.size).toBe(1);
    expect(snap.docs[0]!.ref.parent.parent!.id).toBe(ORG_A);
  });
});

describe('negatief: geen enkele andere collectionGroup-vorm lekt cross-org', () => {
  it('dave krijgt met andermans uid (frank, owner van org B/C) GEEN documenten terug', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    try {
      const snap = await getDocs(
        query(collectionGroup(db, 'organizationMembers'), where('uid', '==', USERS.frank.uid)),
      );
      // Als de query zelf al niet wordt afgewezen, mag ze in ieder geval geen
      // enkel resultaat opleveren — frank's memberships zitten in org B/C,
      // waar dave geen lid van is.
      expect(snap.empty).toBe(true);
    } catch (err) {
      // Een permission-denied van Firestore zelf is een even geldige, veilige uitkomst.
      expect(String(err)).toMatch(/permission|PERMISSION_DENIED/i);
    }
  });

  it('dave krijgt via een ongefilterde collectionGroup-query GEEN org-B- of org-C-document', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    try {
      const snap = await getDocs(query(collectionGroup(db, 'organizationMembers')));
      const foreignOrgDocs = snap.docs.filter((d) => {
        const orgId = d.ref.parent.parent!.id;
        return orgId === ORG_B || orgId === ORG_C;
      });
      expect(foreignOrgDocs).toHaveLength(0);
    } catch (err) {
      expect(String(err)).toMatch(/permission|PERMISSION_DENIED/i);
    }
  });

  it('een niet-ingelogde gebruiker mag de collectionGroup-query helemaal niet uitvoeren', async () => {
    const db = env.unauthenticatedContext().firestore();
    await expect(
      getDocs(query(collectionGroup(db, 'organizationMembers'), where('uid', '==', USERS.alice.uid))),
    ).rejects.toThrow();
  });
});

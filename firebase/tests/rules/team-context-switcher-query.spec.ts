// Issue #31 — querycontract voor team-only leden (uitsluitend een
// `teamMembers`-document, geen `organizationMembers`) in de contextwisselaar.
// Exact hetzelfde patroon als issue #28 (context-switcher-query.spec.ts), nu
// toegepast op `teamMembers`. De ENIGE toegestane niet-directe query is:
//
//   collectionGroup('teamMembers').where('uid', '==', <eigen uid>)
//
// Zie firebase/docs/QUERY_CONTRACT.md voor het volledige contract. Dit
// bestand bewijst empirisch:
//  1. positief: die ene toegestane query levert precies dave's eigen
//     teamMembers-documenten op, over meerdere organisaties heen — zonder
//     dat dave ergens een organizationMembers-document heeft;
//  2. positief: dave kan de organisatienaam lezen via het gedenormaliseerde
//     `orgName`-veld op het teamdocument, maar NIET via een directe
//     `organizations/{orgId}`-read (die blijft `isOrgMember`-only — geen
//     verbreding van organisatiereads);
//  3. negatief: geen enkele andere collectionGroup-vorm (zonder filter, of
//     met andermans uid) geeft een teamMembers-document van een team terug
//     waar dave geen lid van is;
//  4. negatief: het `uid`-veld zelf kan niet vervalst worden bij create/update
//     (zelfde patroon als self-promotion.spec.ts voor organizationMembers).

import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { collectionGroup, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createTestEnv, assertSucceeds, assertFails, authCtx, withAdmin } from './helpers/testEnv.js';
import { ORG_A, ORG_B, TEAM_A1, TEAM_B1, USERS } from './helpers/fixtures.js';

let env: RulesTestEnvironment;

// Derde organisatie, alleen voor dit bestand: frank is hier owner en dave heeft
// er GEEN enkele toegang (geen organizationMembers, geen teamMembers) — een
// echte cross-org-poging, niet toevallig al toegestaan via canReadTeam.
const ORG_C = 'org-c-geen-toegang-voor-dave-team';
const TEAM_C1 = 'team-c1';

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await withAdmin(env, async (db) => {
    // Org A: alice = owner. dave is UITSLUITEND teamlid van TEAM_A1 (viewer) —
    // bewust GEEN organizationMembers-document voor dave, dat is precies het
    // team-only-scenario uit issue #31.
    await db.collection('organizations').doc(ORG_A).set({ name: 'Org A', createdBy: USERS.alice.uid });
    await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('organizationMembers')
      .doc(USERS.alice.uid)
      .set({ role: 'organizationOwner', email: USERS.alice.email, uid: USERS.alice.uid });
    await db.collection('organizations').doc(ORG_A).collection('teams').doc(TEAM_A1).set({
      name: 'U23',
      orgName: 'Org A',
      createdBy: USERS.alice.uid,
    });
    await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('teams')
      .doc(TEAM_A1)
      .collection('teamMembers')
      .doc(USERS.dave.uid)
      .set({ role: 'viewer', email: USERS.dave.email, uid: USERS.dave.uid });

    // Org B: frank = owner. dave is ook hier UITSLUITEND teamlid (coach) van
    // TEAM_B1 — tweede team-only-org, bewijst de multi-org-positieve query.
    await db.collection('organizations').doc(ORG_B).set({ name: 'Org B', createdBy: USERS.frank.uid });
    await db
      .collection('organizations')
      .doc(ORG_B)
      .collection('organizationMembers')
      .doc(USERS.frank.uid)
      .set({ role: 'organizationOwner', email: USERS.frank.email, uid: USERS.frank.uid });
    await db.collection('organizations').doc(ORG_B).collection('teams').doc(TEAM_B1).set({
      name: 'NBB Selectie',
      orgName: 'Org B',
      createdBy: USERS.frank.uid,
    });
    await db
      .collection('organizations')
      .doc(ORG_B)
      .collection('teams')
      .doc(TEAM_B1)
      .collection('teamMembers')
      .doc(USERS.dave.uid)
      .set({ role: 'coach', email: USERS.dave.email, uid: USERS.dave.uid });

    // Org C: frank = owner, dave heeft hier HELEMAAL GEEN toegang.
    await db.collection('organizations').doc(ORG_C).set({ name: 'Org C', createdBy: USERS.frank.uid });
    await db
      .collection('organizations')
      .doc(ORG_C)
      .collection('organizationMembers')
      .doc(USERS.frank.uid)
      .set({ role: 'organizationOwner', email: USERS.frank.email, uid: USERS.frank.uid });
    await db.collection('organizations').doc(ORG_C).collection('teams').doc(TEAM_C1).set({
      name: 'Team C1',
      orgName: 'Org C',
      createdBy: USERS.frank.uid,
    });
  });
});

describe('positief: eigen team-only toegang over meerdere organisaties, zonder organizationMembers', () => {
  it('dave krijgt via de toegestane query precies zijn 2 teamMembers-documenten (org A + org B)', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    const snap = await getDocs(
      query(collectionGroup(db, 'teamMembers'), where('uid', '==', USERS.dave.uid)),
    );
    expect(snap.size).toBe(2);
    for (const d of snap.docs) {
      expect(d.data().uid).toBe(USERS.dave.uid);
    }
  });

  it('dave kan de organisatienaam lezen via het teamdocument (orgName), zonder organizationMembers', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    const teamSnap = await getDoc(doc(db, 'organizations', ORG_A, 'teams', TEAM_A1));
    expect(teamSnap.exists()).toBe(true);
    expect(teamSnap.data()?.orgName).toBe('Org A');
  });

  it('dave kan de organisatie ZELF niet direct lezen — orgName-denormalisatie verbreedt organisatiereads niet', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(getDoc(doc(db, 'organizations', ORG_A)));
  });
});

describe('negatief: geen enkele andere collectionGroup-vorm lekt cross-org', () => {
  it('dave krijgt met andermans uid (frank, owner van org C) GEEN documenten terug', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    try {
      const snap = await getDocs(
        query(collectionGroup(db, 'teamMembers'), where('uid', '==', USERS.frank.uid)),
      );
      expect(snap.empty).toBe(true);
    } catch (err) {
      expect(String(err)).toMatch(/permission|PERMISSION_DENIED/i);
    }
  });

  it('dave krijgt via een ongefilterde collectionGroup-query GEEN org-C-document', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    try {
      const snap = await getDocs(query(collectionGroup(db, 'teamMembers')));
      const orgCDocs = snap.docs.filter((d) => d.ref.parent.parent!.parent.parent!.id === ORG_C);
      expect(orgCDocs).toHaveLength(0);
    } catch (err) {
      expect(String(err)).toMatch(/permission|PERMISSION_DENIED/i);
    }
  });

  it('een niet-ingelogde gebruiker mag de collectionGroup-query helemaal niet uitvoeren', async () => {
    const db = env.unauthenticatedContext().firestore();
    await expect(
      getDocs(query(collectionGroup(db, 'teamMembers'), where('uid', '==', USERS.dave.uid))),
    ).rejects.toThrow();
  });
});

describe('negatief: het `uid`-veld op teamMembers kan niet vervalst worden', () => {
  it('alice (owner) mag bij een NIEUW teamMembers-document geen afwijkend uid-veld zetten', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      setDoc(doc(db, 'organizations', ORG_A, 'teams', TEAM_A1, 'teamMembers', USERS.erin.uid), {
        role: 'viewer',
        email: USERS.erin.email,
        uid: USERS.bob.uid, // vervalst
      }),
    );
  });

  it('alice (owner) mag het uid-veld van een bestaand teamMembers-document niet wijzigen', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertFails(
      updateDoc(doc(db, 'organizations', ORG_A, 'teams', TEAM_A1, 'teamMembers', USERS.dave.uid), {
        uid: USERS.bob.uid, // vervalst — moet gelijk blijven aan de document-ID
      }),
    );

    // Outsider-contextquery: bob (op wiens uid de poging mikte) krijgt na de
    // geblokkeerde update nog steeds niets van org A — dave's uid-veld bleef intact.
    const bobDb = authCtx(env, USERS.bob.uid, { email: USERS.bob.email, email_verified: true });
    const snap = await getDocs(
      query(collectionGroup(bobDb, 'teamMembers'), where('uid', '==', USERS.bob.uid)),
    );
    expect(snap.empty).toBe(true);
  });

  it('een gewoon teamlid (geen owner/admin) mag sowieso geen teamMembers-document aanmaken', async () => {
    const db = authCtx(env, USERS.dave.uid, { email: USERS.dave.email, email_verified: true });
    await assertFails(
      setDoc(doc(db, 'organizations', ORG_A, 'teams', TEAM_A1, 'teamMembers', USERS.erin.uid), {
        role: 'viewer',
        email: USERS.erin.email,
        uid: USERS.erin.uid,
      }),
    );
  });

  it('alice (owner) KAN wél een correct teamMembers-document aanmaken (regressie)', async () => {
    const db = authCtx(env, USERS.alice.uid, { email: USERS.alice.email, email_verified: true });
    await assertSucceeds(
      setDoc(doc(db, 'organizations', ORG_A, 'teams', TEAM_A1, 'teamMembers', USERS.erin.uid), {
        role: 'viewer',
        email: USERS.erin.email,
        uid: USERS.erin.uid,
      }),
    );
  });
});

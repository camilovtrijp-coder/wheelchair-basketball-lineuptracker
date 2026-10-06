// PR 8.3c-2b-i (docs/pr-8.3c-2b-plan.md §C.1, §D) — bewijst tegen de ECHTE Security
// Rules dat de query- en padbouwers die `FirestoreAccountGateway` gebruikt
// (`v2/src/infrastructure/account/accountQueries.ts`, bewust vrij van Auth) precies
// doen wat het ontwerp belooft: de drie querycontract-queries slagen voor de eigen
// identiteit en leveren alleen eigen rijen; een vreemde uid/e-mail wordt geweigerd; de
// eigen deletes slagen in de ontworpen volgorde; de eindcontrole geeft nul rijen; en
// het verlaten van organisatie A laat organisatie B onaangeroerd.
//
// De gateway zelf draait hier niet (`getAuth().currentUser` bestaat niet in
// `@firebase/rules-unit-testing`-contexten); zijn logica is met een gemockte SDK gedekt
// in `v2/tests/unit/FirestoreAccountGateway.spec.ts`. Alle reads gaan hier, net als in de
// gateway, via `getDocsFromServer`/`getDocFromServer`. Alleen fictieve gebruikers.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  assertFails,
  assertSucceeds,
  authCtx,
  createTestEnv,
  withAdmin,
} from './helpers/testEnv.js';
import { ORG_A, ORG_B, TEAM_A1, TEAM_A2, TEAM_B1, USERS } from './helpers/fixtures.js';
import { dagenGeleden } from './helpers/retention.js';
import {
  deletionRequestConverter,
  invitationConverter,
  organizationMemberConverter,
  teamMemberConverter,
} from '../../src/documents/index.js';
import {
  organizationIdOf,
  ownInvitationRef,
  ownInvitationsQuery,
  ownOrganizationMemberRef,
  ownOrganizationMembershipsQuery,
  ownTeamMemberRef,
  ownTeamMembershipsQuery,
  teamIdOf,
} from '../../../v2/src/infrastructure/account/accountQueries.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});

type UserKey = keyof typeof USERS;
type Role = 'organizationOwner' | 'organizationAdmin' | 'coach' | 'scorer' | 'viewer';
type InvitationStatus = 'pending' | 'accepted' | 'claimed' | 'revoked';

const ORG_C = 'org-zonder-maker';
const ORG_D = 'org-wees';

const carol = USERS.carol;
const henry = USERS.henry;

function dbFor(key: UserKey, emailVerified = true): Firestore {
  return authCtx(env, USERS[key].uid, {
    email: USERS[key].email,
    email_verified: emailVerified,
  }) as unknown as Firestore;
}

async function seedMember(
  admin: FirebaseFirestore.Firestore,
  orgId: string,
  key: UserKey,
  role: Role,
) {
  await admin
    .collection('organizations')
    .doc(orgId)
    .collection('organizationMembers')
    .doc(USERS[key].uid)
    .set({ role, email: USERS[key].email, uid: USERS[key].uid });
}

async function seedTeamMember(
  admin: FirebaseFirestore.Firestore,
  orgId: string,
  teamId: string,
  key: UserKey,
  role: Role,
) {
  await admin
    .collection('organizations')
    .doc(orgId)
    .collection('teams')
    .doc(teamId)
    .collection('teamMembers')
    .doc(USERS[key].uid)
    .set({ role, email: USERS[key].email, uid: USERS[key].uid });
}

async function seedInvitation(
  admin: FirebaseFirestore.Firestore,
  orgId: string,
  id: string,
  email: string,
  status: InvitationStatus,
  role: Role,
  invitedDaysAgo = 1,
) {
  await admin
    .collection('organizations')
    .doc(orgId)
    .collection('invitations')
    .doc(id)
    .set({
      email,
      role,
      status,
      invitedBy: USERS.alice.uid,
      invitedAt: dagenGeleden(invitedDaysAgo),
      acceptedAt: status === 'pending' ? null : dagenGeleden(invitedDaysAgo),
    });
}

/**
 * Org A (maker alice, owner): carol is coach (org-lid) met teamMembers in A1 en A2 en
 * vier eigen uitnodigingen (pending/accepted/claimed/revoked); henry is team-only coach
 * in A1; bob is admin. Org B (maker frank, owner): carol is viewer met een teamMembers-
 * document in B1 en een eigen pending-uitnodiging. Org C heeft geen `createdBy`; voor
 * org D bestaat alleen carols membership (wees-membership).
 */
beforeEach(async () => {
  await env.clearFirestore();
  await withAdmin(env, async (admin) => {
    await admin
      .collection('organizations')
      .doc(ORG_A)
      .set({
        name: 'Org A (fictief)',
        createdBy: USERS.alice.uid,
        createdAt: dagenGeleden(60),
      });
    await seedMember(admin, ORG_A, 'alice', 'organizationOwner');
    await seedMember(admin, ORG_A, 'bob', 'organizationAdmin');
    await seedMember(admin, ORG_A, 'carol', 'coach');
    for (const team of [TEAM_A1, TEAM_A2]) {
      await admin.collection('organizations').doc(ORG_A).collection('teams').doc(team).set({
        name: team,
        orgName: 'Org A (fictief)',
        createdBy: USERS.alice.uid,
      });
    }
    await seedTeamMember(admin, ORG_A, TEAM_A1, 'carol', 'coach');
    await seedTeamMember(admin, ORG_A, TEAM_A2, 'carol', 'coach');
    await seedTeamMember(admin, ORG_A, TEAM_A1, 'henry', 'coach');
    await seedTeamMember(admin, ORG_A, TEAM_A1, 'bob', 'coach');
    await seedInvitation(admin, ORG_A, 'inv-pending', carol.email, 'pending', 'organizationAdmin');
    await seedInvitation(
      admin,
      ORG_A,
      'inv-accepted',
      carol.email,
      'accepted',
      'organizationOwner',
    );
    await seedInvitation(admin, ORG_A, 'inv-claimed', carol.email, 'claimed', 'coach', 40);
    await seedInvitation(admin, ORG_A, 'inv-revoked', carol.email, 'revoked', 'scorer', 40);
    await seedInvitation(admin, ORG_A, 'inv-bob', USERS.bob.email, 'pending', 'coach');

    await admin
      .collection('organizations')
      .doc(ORG_B)
      .set({
        name: 'Org B (fictief)',
        createdBy: USERS.frank.uid,
        createdAt: dagenGeleden(60),
      });
    await seedMember(admin, ORG_B, 'frank', 'organizationOwner');
    await seedMember(admin, ORG_B, 'carol', 'viewer');
    await admin.collection('organizations').doc(ORG_B).collection('teams').doc(TEAM_B1).set({
      name: TEAM_B1,
      orgName: 'Org B (fictief)',
      createdBy: USERS.frank.uid,
    });
    await seedTeamMember(admin, ORG_B, TEAM_B1, 'carol', 'viewer');
    await seedInvitation(admin, ORG_B, 'inv-b', carol.email, 'pending', 'coach');

    await admin.collection('organizations').doc(ORG_C).set({ name: 'Org C (fictief)' });
    await seedMember(admin, ORG_C, 'carol', 'coach');
    await seedMember(admin, ORG_D, 'carol', 'coach');
  });
});

function paths(snapshot: { docs: { ref: { path: string } }[] }): string[] {
  return snapshot.docs.map((entry) => entry.ref.path).sort();
}

async function ownInventory(db: Firestore, key: UserKey) {
  const user = USERS[key];
  const memberships = await getDocsFromServer(
    ownOrganizationMembershipsQuery(db, user.uid).withConverter(organizationMemberConverter),
  );
  const teams = await getDocsFromServer(
    ownTeamMembershipsQuery(db, user.uid).withConverter(teamMemberConverter),
  );
  const invitations = await getDocsFromServer(
    ownInvitationsQuery(db, user.email).withConverter(invitationConverter),
  );
  return { memberships, teams, invitations };
}

describe('de drie querycontract-queries met de gatewaybouwers', () => {
  it('slagen voor de eigen identiteit en leveren uitsluitend eigen rijen (via de echte converters)', async () => {
    const db = dbFor('carol');
    const { memberships, teams, invitations } = await assertSucceeds(ownInventory(db, 'carol'));

    expect(memberships.docs.map((entry) => organizationIdOf(entry)).sort()).toEqual(
      [ORG_A, ORG_B, ORG_C, ORG_D].sort(),
    );
    expect(memberships.docs.every((entry) => entry.data().uid === carol.uid)).toBe(true);

    expect(
      teams.docs.map((entry) => `${organizationIdOf(entry)}/${teamIdOf(entry)}`).sort(),
    ).toEqual([`${ORG_A}/${TEAM_A1}`, `${ORG_A}/${TEAM_A2}`, `${ORG_B}/${TEAM_B1}`].sort());
    expect(teams.docs.every((entry) => entry.data().uid === carol.uid)).toBe(true);

    expect(invitations.docs.map((entry) => entry.id).sort()).toEqual(
      ['inv-accepted', 'inv-b', 'inv-claimed', 'inv-pending', 'inv-revoked'].sort(),
    );
    expect(invitations.docs.every((entry) => entry.data().email === carol.email)).toBe(true);
  });

  it('een query met een VREEMDE uid of e-mail wordt geweigerd', async () => {
    const db = dbFor('carol');
    await assertFails(getDocsFromServer(ownOrganizationMembershipsQuery(db, USERS.bob.uid)));
    await assertFails(getDocsFromServer(ownTeamMembershipsQuery(db, henry.uid)));
    await assertFails(getDocsFromServer(ownInvitationsQuery(db, USERS.bob.email)));
  });

  it('de uitnodigingsquery zonder geverifieerde e-mailclaim wordt geweigerd (gateway: email-not-verified vooraf)', async () => {
    await assertFails(getDocsFromServer(ownInvitationsQuery(dbFor('carol', false), carol.email)));
  });

  it('een team-only lid vindt zijn eigen teamMembers-document maar heeft geen membership', async () => {
    const db = dbFor('henry');
    const memberships = await assertSucceeds(
      getDocsFromServer(ownOrganizationMembershipsQuery(db, henry.uid)),
    );
    const teams = await assertSucceeds(getDocsFromServer(ownTeamMembershipsQuery(db, henry.uid)));
    expect(memberships.size).toBe(0);
    expect(paths(teams)).toEqual([
      `organizations/${ORG_A}/teams/${TEAM_A1}/teamMembers/${henry.uid}`,
    ]);
  });
});

describe('organisatie verlaten in de ontworpen volgorde, met de echte padbouwers', () => {
  it('teamMembers → open uitnodigingen → controle → membership LAATST → eindcontrole nul rijen; org B onaangeroerd', async () => {
    const db = dbFor('carol');

    // Feiten (§B.6) als lid: organisatie, ledenlijst en verwijderverzoek, van de server.
    const organization = await assertSucceeds(getDocFromServer(doc(db, 'organizations', ORG_A)));
    expect(organization.data()?.createdBy).toBe(USERS.alice.uid);
    const members = await assertSucceeds(
      getDocsFromServer(
        collection(db, 'organizations', ORG_A, 'organizationMembers').withConverter(
          organizationMemberConverter,
        ),
      ),
    );
    expect(
      members.docs.filter((m) => m.data().role === 'organizationOwner').map((m) => m.id),
    ).toEqual([USERS.alice.uid]);
    const request = await assertSucceeds(
      getDocFromServer(
        doc(db, 'organizations', ORG_A, 'deletionRequests', 'current').withConverter(
          deletionRequestConverter,
        ),
      ),
    );
    expect(request.exists()).toBe(false);

    // 3 — eigen teamMembers in org A.
    for (const team of [TEAM_A1, TEAM_A2]) {
      await assertSucceeds(deleteDoc(ownTeamMemberRef(db, ORG_A, team, carol.uid)));
    }
    // 4 — eigen OPENSTAANDE uitnodigingen in org A (B3).
    for (const id of ['inv-pending', 'inv-accepted']) {
      await assertSucceeds(deleteDoc(ownInvitationRef(db, ORG_A, id)));
    }
    // 5 — per-organisatie-controle (server), terwijl het membership nog staat.
    const check = await assertSucceeds(ownInventory(db, 'carol'));
    expect(check.teams.docs.filter((entry) => organizationIdOf(entry) === ORG_A)).toHaveLength(0);
    expect(
      check.invitations.docs.filter(
        (entry) =>
          organizationIdOf(entry) === ORG_A &&
          ['pending', 'accepted'].includes(entry.data().status),
      ),
    ).toHaveLength(0);
    expect(check.memberships.docs.some((entry) => organizationIdOf(entry) === ORG_A)).toBe(true);

    // 6 — het eigen membership als LAATSTE write.
    await assertSucceeds(deleteDoc(ownOrganizationMemberRef(db, ORG_A, carol.uid)));

    // 7 — eindcontrole ná de laatste delete: beide uid-queries, gefilterd op org A, leeg.
    const final = await assertSucceeds(ownInventory(db, 'carol'));
    expect(
      final.memberships.docs.filter((entry) => organizationIdOf(entry) === ORG_A),
    ).toHaveLength(0);
    expect(final.teams.docs.filter((entry) => organizationIdOf(entry) === ORG_A)).toHaveLength(0);

    // claimed/revoked in A blijven (B3); org B is volledig onaangeroerd.
    expect(
      final.invitations.docs
        .filter((entry) => organizationIdOf(entry) === ORG_A)
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(['inv-claimed', 'inv-revoked']);
    expect(final.memberships.docs.some((entry) => organizationIdOf(entry) === ORG_B)).toBe(true);
    expect(paths(final.teams)).toContain(
      `organizations/${ORG_B}/teams/${TEAM_B1}/teamMembers/${carol.uid}`,
    );
    expect(final.invitations.docs.some((entry) => entry.id === 'inv-b')).toBe(true);

    // Andermans documenten in A zijn er nog.
    const bobInA = await withAdmin(
      env,
      async (admin) =>
        (
          await admin
            .collection('organizations')
            .doc(ORG_A)
            .collection('organizationMembers')
            .doc(USERS.bob.uid)
            .get()
        ).exists,
    );
    expect(bobInA).toBe(true);
  });

  it('team-only lid: eigen teamMembers-document weg, daarna beide uid-queries leeg', async () => {
    const db = dbFor('henry');
    await assertSucceeds(deleteDoc(ownTeamMemberRef(db, ORG_A, TEAM_A1, henry.uid)));
    const memberships = await assertSucceeds(
      getDocsFromServer(ownOrganizationMembershipsQuery(db, henry.uid)),
    );
    const teams = await assertSucceeds(getDocsFromServer(ownTeamMembershipsQuery(db, henry.uid)));
    expect(memberships.size + teams.size).toBe(0);
  });

  it('A1 vastgepind: een TWEEDE delete van het al verwijderde membership of de uitnodiging wordt geweigerd, een teamMembers-delete niet', async () => {
    const db = dbFor('carol');
    await assertSucceeds(deleteDoc(ownTeamMemberRef(db, ORG_A, TEAM_A1, carol.uid)));
    await assertSucceeds(deleteDoc(ownTeamMemberRef(db, ORG_A, TEAM_A2, carol.uid)));
    await assertSucceeds(deleteDoc(ownInvitationRef(db, ORG_A, 'inv-pending')));
    await assertSucceeds(deleteDoc(ownOrganizationMemberRef(db, ORG_A, carol.uid)));

    // Rules lezen `resource.data` → op een ontbrekend document: permission-denied.
    await assertFails(deleteDoc(ownOrganizationMemberRef(db, ORG_A, carol.uid)));
    await assertFails(deleteDoc(ownInvitationRef(db, ORG_A, 'inv-pending')));
    // De teamMembers-tak verwijst niet naar `resource` en slaagt ook op een ontbrekend document.
    await assertSucceeds(deleteDoc(ownTeamMemberRef(db, ORG_A, TEAM_A1, carol.uid)));

    // Daarom leest de gateway EERST terug: de eigen queries tonen dat ze weg zijn
    // (→ `already-gone`, geen delete-poging, geen fout).
    const after = await assertSucceeds(ownInventory(db, 'carol'));
    expect(after.memberships.docs.some((entry) => organizationIdOf(entry) === ORG_A)).toBe(false);
    expect(after.invitations.docs.some((entry) => entry.id === 'inv-pending')).toBe(false);
  });

  it('na B3 kan de vertrekker de verwijderde hogere-rol-uitnodiging niet meer claimen (eerlijk pad van R1)', async () => {
    const db = dbFor('carol');
    for (const team of [TEAM_A1, TEAM_A2]) {
      await assertSucceeds(deleteDoc(ownTeamMemberRef(db, ORG_A, team, carol.uid)));
    }
    for (const id of ['inv-pending', 'inv-accepted']) {
      await assertSucceeds(deleteDoc(ownInvitationRef(db, ORG_A, id)));
    }
    await assertSucceeds(deleteDoc(ownOrganizationMemberRef(db, ORG_A, carol.uid)));

    const claim = writeBatch(db);
    claim.update(ownInvitationRef(db, ORG_A, 'inv-accepted'), {
      status: 'claimed',
      claimedAt: serverTimestamp(),
    });
    claim.set(ownOrganizationMemberRef(db, ORG_A, carol.uid), {
      role: 'organizationOwner',
      email: carol.email,
      uid: carol.uid,
      invitationId: 'inv-accepted',
    });
    await assertFails(claim.commit());
  });

  it('een uitnodiging van VANDAAG is via de query te vinden en zelf te verwijderen; daarna leeg (§5 test 5)', async () => {
    await withAdmin(env, async (admin) => {
      await seedInvitation(admin, ORG_B, 'inv-vandaag', USERS.grace.email, 'pending', 'viewer', 0);
    });
    const db = dbFor('grace');
    const found = await assertSucceeds(
      getDocsFromServer(ownInvitationsQuery(db, USERS.grace.email)),
    );
    expect(found.docs.map((entry) => entry.id)).toEqual(['inv-vandaag']);
    await assertSucceeds(deleteDoc(ownInvitationRef(db, ORG_B, 'inv-vandaag')));
    const after = await assertSucceeds(
      getDocsFromServer(ownInvitationsQuery(db, USERS.grace.email)),
    );
    expect(after.size).toBe(0);
  });
});

describe('serverweigeringen die de coördinator al in de preflight afvangt', () => {
  it('cross-org/andermans pad: de eigen-padbouwer met een vreemde uid wordt geweigerd', async () => {
    const db = dbFor('carol');
    await assertFails(deleteDoc(ownOrganizationMemberRef(db, ORG_A, USERS.bob.uid)));
    await assertFails(deleteDoc(ownTeamMemberRef(db, ORG_A, TEAM_A1, henry.uid)));
    await assertFails(deleteDoc(ownInvitationRef(db, ORG_A, 'inv-bob')));
    await assertFails(deleteDoc(ownOrganizationMemberRef(db, ORG_B, USERS.frank.uid)));
  });

  it('owner en (gedemoveerde) maker kunnen hun membership niet zelf verwijderen', async () => {
    await assertFails(deleteDoc(ownOrganizationMemberRef(dbFor('alice'), ORG_A, USERS.alice.uid)));
    await withAdmin(env, async (admin) => {
      await seedMember(admin, ORG_A, 'alice', 'organizationAdmin');
      await seedMember(admin, ORG_A, 'bob', 'organizationOwner');
    });
    await assertFails(deleteDoc(ownOrganizationMemberRef(dbFor('alice'), ORG_A, USERS.alice.uid)));
  });

  it('organisatie zonder createdBy: ruwe read geeft geen maker, self-delete wordt geweigerd', async () => {
    const db = dbFor('carol');
    const organization = await assertSucceeds(getDocFromServer(doc(db, 'organizations', ORG_C)));
    expect(organization.data()?.createdBy).toBeUndefined();
    await assertFails(deleteDoc(ownOrganizationMemberRef(db, ORG_C, carol.uid)));
  });

  it('wees-membership: het organisatiedocument ontbreekt (leesbaar als lid) en de self-delete wordt geweigerd', async () => {
    const db = dbFor('carol');
    const organization = await assertSucceeds(getDocFromServer(doc(db, 'organizations', ORG_D)));
    expect(organization.exists()).toBe(false);
    await assertFails(deleteDoc(ownOrganizationMemberRef(db, ORG_D, carol.uid)));
  });

  it('rol wordt tijdens de flow owner: de laatste delete wordt geweigerd en het membership blijft staan', async () => {
    const db = dbFor('carol');
    await assertSucceeds(deleteDoc(ownTeamMemberRef(db, ORG_A, TEAM_A1, carol.uid)));
    await assertSucceeds(
      updateDoc(doc(dbFor('alice'), 'organizations', ORG_A, 'organizationMembers', carol.uid), {
        role: 'organizationOwner',
      }),
    );
    await assertFails(deleteDoc(ownOrganizationMemberRef(db, ORG_A, carol.uid)));
    const still = await assertSucceeds(
      getDocsFromServer(ownOrganizationMembershipsQuery(db, carol.uid)),
    );
    expect(still.docs.some((entry) => organizationIdOf(entry) === ORG_A)).toBe(true);
  });
});

describe('veel documenten (§D.1 geval 6)', () => {
  it('3 organisaties, 25 teams en 12 uitnodigingen: alles weg in de vaste volgorde, eindcontrole leeg', async () => {
    const orgs = ['org-veel-1', 'org-veel-2', 'org-veel-3'];
    await env.clearFirestore();
    await withAdmin(env, async (admin) => {
      for (const [index, orgId] of orgs.entries()) {
        await admin
          .collection('organizations')
          .doc(orgId)
          .set({ name: orgId, createdBy: USERS.alice.uid, createdAt: dagenGeleden(60) });
        await seedMember(admin, orgId, 'alice', 'organizationOwner');
        await seedMember(admin, orgId, 'kevin', 'scorer');
        const teamCount = index === 0 ? 9 : 8; // 9 + 8 + 8 = 25
        for (let t = 0; t < teamCount; t += 1) {
          await seedTeamMember(admin, orgId, `team-${t}`, 'kevin', 'scorer');
        }
        for (let i = 0; i < 4; i += 1) {
          await seedInvitation(admin, orgId, `inv-${i}`, USERS.kevin.email, 'pending', 'coach');
        }
      }
    });
    const db = dbFor('kevin');
    const kevin = USERS.kevin;

    const start = await assertSucceeds(ownInventory(db, 'kevin'));
    expect([start.memberships.size, start.teams.size, start.invitations.size]).toEqual([3, 25, 12]);

    for (const orgId of orgs) {
      for (const entry of start.teams.docs.filter((e) => organizationIdOf(e) === orgId)) {
        await assertSucceeds(deleteDoc(ownTeamMemberRef(db, orgId, teamIdOf(entry)!, kevin.uid)));
      }
      for (const entry of start.invitations.docs.filter((e) => organizationIdOf(e) === orgId)) {
        await assertSucceeds(deleteDoc(ownInvitationRef(db, orgId, entry.id)));
      }
      await assertSucceeds(deleteDoc(ownOrganizationMemberRef(db, orgId, kevin.uid)));
    }

    const final = await assertSucceeds(ownInventory(db, 'kevin'));
    expect([final.memberships.size, final.teams.size, final.invitations.size]).toEqual([0, 0, 0]);
  });
});

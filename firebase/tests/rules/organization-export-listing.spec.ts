// PR 8.3b (docs/pr-8.3-plan.md §C 8.3b werk 2): bewijst dat de nieuwe
// query-vorm die `FirestoreOrganizationExportGateway` gebruikt — een
// ONGEFILTERDE `getDocs(collection(...))`-listing (geen `where(...)`,
// anders dan de bestaande, expliciet toegestane collectionGroup-queries uit
// firebase/docs/QUERY_CONTRACT.md) — onder de bestaande Rules exact hetzelfde
// autorisatiegedrag geeft als een losse `getDoc()`: een lid van de
// organisatie/het team mag listen, een cross-org-aanvaller of een volledig
// onbekende gebruiker niet. Dit is de EERSTE plek in de codebase die zo'n
// brede listing doet (voorheen: uitsluitend gescopete per-team/orgId-paden of
// een uid-gefilterde collectionGroup), dus dit gedrag stond nog nergens
// vastgelegd.
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
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
  USERS,
  SAMPLE_SETTINGS,
  SAMPLE_ROSTER,
  sampleGame,
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
    await db
      .collection('organizations')
      .doc(ORG_A)
      .set({ name: 'Org A', createdBy: USERS.alice.uid });
    await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('organizationMembers')
      .doc(USERS.alice.uid)
      .set({
        role: 'organizationOwner',
        email: USERS.alice.email,
        uid: USERS.alice.uid,
      });
    await db.collection('organizations').doc(ORG_A).collection('invitations').doc('inv-1').set({
      email: 'invited@example.test',
      role: 'coach',
      status: 'revoked',
      invitedBy: USERS.alice.uid,
      invitedAt: new Date(),
      acceptedAt: null,
    });
    await db.collection('organizations').doc(ORG_A).collection('teams').doc(TEAM_A1).set({
      name: 'Team A1',
      orgName: 'Org A',
      createdBy: USERS.alice.uid,
    });
    await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('teams')
      .doc(TEAM_A1)
      .collection('teamMembers')
      .doc(USERS.carol.uid)
      .set({ role: 'coach', email: USERS.carol.email, uid: USERS.carol.uid });
    await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('teams')
      .doc(TEAM_A1)
      .collection('settings')
      .doc('current')
      .set(SAMPLE_SETTINGS);
    await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('teams')
      .doc(TEAM_A1)
      .collection('roster')
      .doc('current')
      .set(SAMPLE_ROSTER);
    await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('teams')
      .doc(TEAM_A1)
      .collection('games')
      .doc('game-1')
      .set(sampleGame());
    await db
      .collection('organizations')
      .doc(ORG_A)
      .collection('teams')
      .doc(TEAM_A1)
      .collection('completedGames')
      .doc('completed-1')
      .set({
        organizationId: ORG_A,
        teamId: TEAM_A1,
        sourceGameId: 'game-1',
        opponent: 'X',
        competition: 'Y',
        date: '2026-01-01T00:00:00.000Z',
        players: [],
        segments: [],
        scoreFor: 10,
        scoreAgainst: 5,
        quarterCount: 4,
        periodLabel: '',
        useClassLimit: false,
        syncedAt: new Date(),
        revision: 0,
        deletedAt: null,
        deletedBy: null,
      });

    // Onafhankelijke tweede organisatie met een eigen owner — cross-org-fixture.
    await db
      .collection('organizations')
      .doc(ORG_B)
      .set({ name: 'Org B', createdBy: USERS.bob.uid });
    await db
      .collection('organizations')
      .doc(ORG_B)
      .collection('organizationMembers')
      .doc(USERS.bob.uid)
      .set({
        role: 'organizationOwner',
        email: USERS.bob.email,
        uid: USERS.bob.uid,
      });
  });
});

describe('firestore.rules — ongefilterde collectielisting t.b.v. organisatie-export (PR 8.3b)', () => {
  it('de organisatie-owner mag elke org-/teamfamilie listen', async () => {
    const owner = authCtx(env, USERS.alice.uid);
    await assertSucceeds(getDocs(collection(owner, 'organizations', ORG_A, 'organizationMembers')));
    await assertSucceeds(getDocs(collection(owner, 'organizations', ORG_A, 'invitations')));
    await assertSucceeds(getDocs(collection(owner, 'organizations', ORG_A, 'teams')));
    await assertSucceeds(
      getDocs(collection(owner, 'organizations', ORG_A, 'teams', TEAM_A1, 'teamMembers')),
    );
    await assertSucceeds(
      getDocs(collection(owner, 'organizations', ORG_A, 'teams', TEAM_A1, 'games')),
    );
    await assertSucceeds(
      getDocs(collection(owner, 'organizations', ORG_A, 'teams', TEAM_A1, 'completedGames')),
    );
    await assertSucceeds(
      getDocs(collection(owner, 'organizations', ORG_A, 'teams', TEAM_A1, 'migrationRuns')),
    );
  });

  it('een gewoon teamlid (coach) mag zijn eigen team listen, maar geen org-brede families', async () => {
    const coach = authCtx(env, USERS.carol.uid);
    await assertSucceeds(
      getDocs(collection(coach, 'organizations', ORG_A, 'teams', TEAM_A1, 'teamMembers')),
    );
    // Geen organizationMembers-document voor carol → isOrgMember(ORG_A) is false.
    await assertFails(getDocs(collection(coach, 'organizations', ORG_A, 'organizationMembers')));
    await assertFails(getDocs(collection(coach, 'organizations', ORG_A, 'invitations')));
  });

  it('cross-org: de owner van Org B mag niets van Org A listen', async () => {
    const crossOrgOwner = authCtx(env, USERS.bob.uid);
    await assertFails(
      getDocs(collection(crossOrgOwner, 'organizations', ORG_A, 'organizationMembers')),
    );
    await assertFails(getDocs(collection(crossOrgOwner, 'organizations', ORG_A, 'invitations')));
    await assertFails(getDocs(collection(crossOrgOwner, 'organizations', ORG_A, 'teams')));
    await assertFails(
      getDocs(collection(crossOrgOwner, 'organizations', ORG_A, 'teams', TEAM_A1, 'teamMembers')),
    );
    await assertFails(
      getDocs(collection(crossOrgOwner, 'organizations', ORG_A, 'teams', TEAM_A1, 'settings')),
    );
    await assertFails(
      getDocs(collection(crossOrgOwner, 'organizations', ORG_A, 'teams', TEAM_A1, 'games')),
    );
    await assertFails(
      getDocs(
        collection(crossOrgOwner, 'organizations', ORG_A, 'teams', TEAM_A1, 'completedGames'),
      ),
    );
  });

  it('een volledig onbekende, geverifieerde gebruiker mag niets van Org A listen', async () => {
    const stranger = authCtx(env, USERS.frank.uid);
    await assertFails(getDocs(collection(stranger, 'organizations', ORG_A, 'organizationMembers')));
    await assertFails(getDocs(collection(stranger, 'organizations', ORG_A, 'teams')));
    await assertFails(
      getDocs(collection(stranger, 'organizations', ORG_A, 'teams', TEAM_A1, 'teamMembers')),
    );
  });

  it('sanity check: de fixture-data zelf is echt aanwezig (listing is niet toevallig leeg-maar-toegestaan)', async () => {
    const owner = authCtx(env, USERS.alice.uid);
    const members = await getDocs(collection(owner, 'organizations', ORG_A, 'organizationMembers'));
    expect(members.size).toBe(1);
    const games = await getDocs(
      collection(owner, 'organizations', ORG_A, 'teams', TEAM_A1, 'games'),
    );
    expect(games.size).toBe(1);
  });
});

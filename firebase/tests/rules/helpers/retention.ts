// Gedeelde fixtures voor de 8.3c-1-Rules-specs (verwijderverzoek, tombstone-
// redactie, uitnodigingsbewaring): één fictieve organisatie met alle vijf
// rollen, een cross-org-aanvaller en een team-only lid.

import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { withAdmin } from './testEnv.js';
import { ORG_A, ORG_B, TEAM_A1, TEAM_B1, USERS } from './fixtures.js';

const DAG = 24 * 60 * 60 * 1000;

/** Een moment `dagen` dagen geleden — voor seeds die Rules omzeilen. */
export function dagenGeleden(dagen: number): Date {
  return new Date(Date.now() - dagen * DAG);
}

export const CLAIMS = {
  alice: { email: USERS.alice.email, email_verified: true },
  bob: { email: USERS.bob.email, email_verified: true },
  carol: { email: USERS.carol.email, email_verified: true },
  dave: { email: USERS.dave.email, email_verified: true },
  erin: { email: USERS.erin.email, email_verified: true },
  frank: { email: USERS.frank.email, email_verified: true },
  grace: { email: USERS.grace.email, email_verified: true },
  henry: { email: USERS.henry.email, email_verified: true },
} as const;

/**
 * alice=owner, bob=admin, carol=coach, dave=scorer, erin=viewer (allemaal als
 * organizationMembers-rij), henry=team-only coach (alleen teamMembers), en
 * frank=owner van de aparte organisatie B.
 */
export async function seedOrganizations(env: RulesTestEnvironment): Promise<void> {
  await env.clearFirestore();
  await withAdmin(env, async (db) => {
    const orgA = db.collection('organizations').doc(ORG_A);
    await orgA.set({ name: 'Org A', createdBy: USERS.alice.uid });
    for (const [user, role] of [
      [USERS.alice, 'organizationOwner'],
      [USERS.bob, 'organizationAdmin'],
      [USERS.carol, 'coach'],
      [USERS.dave, 'scorer'],
      [USERS.erin, 'viewer'],
    ] as const) {
      await orgA
        .collection('organizationMembers')
        .doc(user.uid)
        .set({ role, email: user.email, uid: user.uid });
    }
    await orgA.collection('teams').doc(TEAM_A1).set({
      name: 'Team A1',
      orgName: 'Org A',
      createdBy: USERS.alice.uid,
    });
    await orgA
      .collection('teams')
      .doc(TEAM_A1)
      .collection('teamMembers')
      .doc(USERS.henry.uid)
      .set({ role: 'coach', email: USERS.henry.email, uid: USERS.henry.uid });

    const orgB = db.collection('organizations').doc(ORG_B);
    await orgB.set({ name: 'Org B', createdBy: USERS.frank.uid });
    await orgB
      .collection('organizationMembers')
      .doc(USERS.frank.uid)
      .set({ role: 'organizationOwner', email: USERS.frank.email, uid: USERS.frank.uid });
    await orgB.collection('teams').doc(TEAM_B1).set({
      name: 'Team B1',
      orgName: 'Org B',
      createdBy: USERS.frank.uid,
    });
  });
}

// PR 7.4b (docs/pr-7.4-plan.md §C 7.4b werk 1/2, firestore.rules
// migrationRuns/{runId}) — bewijst:
// - lezen voor elk geautoriseerd teamlid (canReadTeam), net als settings/
//   roster/games/completedGames;
// - schrijven (create/update) alleen voor bulkmigratie-rollen
//   (organizationOwner/organizationAdmin/coach — spiegelt
//   `domain/migration/capability.ts` canBulkMigrate()), scorer/viewer geweigerd;
// - create-only kernvelden: een update mag manifestHash/source/target/
//   createdBy/createdAt nooit wijzigen;
// - optimistische concurrency op `revision` (spiegelt games/{gameId});
// - `rollbackRequested` is eenmalig omkeerbaar (false → true), nooit terug;
// - geen hard delete, voor geen enkele rol.

import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { doc, setDoc, updateDoc, deleteDoc, getDoc } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createTestEnv, assertSucceeds, assertFails, authCtx, withAdmin } from './helpers/testEnv.js';
import { ORG_A, ORG_B, TEAM_A1, USERS } from './helpers/fixtures.js';

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
      .set({ role: 'organizationOwner', email: USERS.alice.email, uid: USERS.alice.uid });
    await db.collection('organizations').doc(ORG_A).collection('teams').doc(TEAM_A1).set({
      name: 'Team A1',
      orgName: 'Org A',
      createdBy: USERS.alice.uid,
    });
    for (const [uid, role, email] of [
      [USERS.carol.uid, 'coach', USERS.carol.email],
      [USERS.dave.uid, 'scorer', USERS.dave.email],
      [USERS.erin.uid, 'viewer', USERS.erin.email],
    ] as [string, string, string][]) {
      await db
        .collection('organizations')
        .doc(ORG_A)
        .collection('teams')
        .doc(TEAM_A1)
        .collection('teamMembers')
        .doc(uid)
        .set({ role, email, uid });
    }
    await db.collection('organizations').doc(ORG_B).set({ name: 'Org B', createdBy: 'nobody' });
  });
});

function runRef(db: ReturnType<typeof authCtx>, orgId: string, teamId: string, runId: string) {
  return doc(db, 'organizations', orgId, 'teams', teamId, 'migrationRuns', runId);
}

function sampleManifest(createdBy: string, overrides: Record<string, unknown> = {}) {
  return {
    manifestHash: 'hash-1',
    source: { organizationId: 'org-src', teamId: 'team-src', organizationName: 'Bron', teamName: 'T' },
    target: { organizationId: ORG_A, teamId: TEAM_A1, organizationName: 'Org A', teamName: 'Team A1' },
    callerRole: 'coach',
    contextFingerprint: 'fp-1',
    createdBy,
    createdAt: '2026-08-23T10:00:00.000Z',
    items: [],
    status: 'paused',
    revision: 0,
    rollbackRequested: false,
    updatedAt: null,
    ...overrides,
  };
}

describe('firestore.rules — migrationRuns/{runId} (docs/pr-7.4-plan.md §C 7.4b)', () => {
  it('coach/organizationOwner mogen aanmaken, scorer/viewer niet', async () => {
    const coach = authCtx(env, USERS.carol.uid);
    await assertSucceeds(
      setDoc(runRef(coach, ORG_A, TEAM_A1, 'run-1'), sampleManifest(USERS.carol.uid)),
    );

    const scorer = authCtx(env, USERS.dave.uid);
    await assertFails(
      setDoc(runRef(scorer, ORG_A, TEAM_A1, 'run-2'), sampleManifest(USERS.dave.uid)),
    );

    const viewer = authCtx(env, USERS.erin.uid);
    await assertFails(
      setDoc(runRef(viewer, ORG_A, TEAM_A1, 'run-3'), sampleManifest(USERS.erin.uid)),
    );
  });

  it('elk teamlid (inclusief viewer) mag een run lezen', async () => {
    const coach = authCtx(env, USERS.carol.uid);
    await assertSucceeds(
      setDoc(runRef(coach, ORG_A, TEAM_A1, 'run-1'), sampleManifest(USERS.carol.uid)),
    );
    const viewer = authCtx(env, USERS.erin.uid);
    await assertSucceeds(getDoc(runRef(viewer, ORG_A, TEAM_A1, 'run-1')));
  });

  it('createdBy moet de aanroeper zelf zijn', async () => {
    const coach = authCtx(env, USERS.carol.uid);
    await assertFails(
      setDoc(runRef(coach, ORG_A, TEAM_A1, 'run-1'), sampleManifest(USERS.dave.uid)),
    );
  });

  it('cross-org isolatie: geen toegang tot een run onder een andere organisatie', async () => {
    const coach = authCtx(env, USERS.carol.uid);
    await assertFails(
      setDoc(runRef(coach, ORG_B, TEAM_A1, 'run-1'), sampleManifest(USERS.carol.uid)),
    );
  });

  it('update: kernvelden blijven immutabel, alleen items/status/rollbackRequested/revision wijzigen', async () => {
    const coach = authCtx(env, USERS.carol.uid);
    await assertSucceeds(
      setDoc(runRef(coach, ORG_A, TEAM_A1, 'run-1'), sampleManifest(USERS.carol.uid)),
    );

    await assertSucceeds(
      updateDoc(runRef(coach, ORG_A, TEAM_A1, 'run-1'), {
        items: [{ kind: 'settings', sourceId: 'current', targetId: 'current', label: 'x', payloadHash: 'h', status: 'confirmed', lastError: null }],
        status: 'completed',
        revision: 1,
      }),
    );

    // Kernveld wijzigen (manifestHash) mag nooit.
    await assertFails(
      updateDoc(runRef(coach, ORG_A, TEAM_A1, 'run-1'), {
        manifestHash: 'ander-hash',
        revision: 2,
      }),
    );
  });

  it('optimistische concurrency: revision moet exact met 1 omhoog', async () => {
    const coach = authCtx(env, USERS.carol.uid);
    await assertSucceeds(
      setDoc(runRef(coach, ORG_A, TEAM_A1, 'run-1'), sampleManifest(USERS.carol.uid)),
    );
    await assertFails(
      updateDoc(runRef(coach, ORG_A, TEAM_A1, 'run-1'), { items: [], status: 'paused', revision: 5 }),
    );
    await assertSucceeds(
      updateDoc(runRef(coach, ORG_A, TEAM_A1, 'run-1'), { items: [], status: 'paused', revision: 1 }),
    );
  });

  it('rollbackRequested mag alleen false → true, nooit terug', async () => {
    const coach = authCtx(env, USERS.carol.uid);
    await assertSucceeds(
      setDoc(runRef(coach, ORG_A, TEAM_A1, 'run-1'), sampleManifest(USERS.carol.uid)),
    );
    await assertSucceeds(
      updateDoc(runRef(coach, ORG_A, TEAM_A1, 'run-1'), {
        items: [],
        status: 'paused',
        rollbackRequested: true,
        revision: 1,
      }),
    );
    await assertFails(
      updateDoc(runRef(coach, ORG_A, TEAM_A1, 'run-1'), {
        items: [],
        status: 'paused',
        rollbackRequested: false,
        revision: 2,
      }),
    );
  });

  it('geen hard delete, ook niet voor owner', async () => {
    const owner = authCtx(env, USERS.alice.uid);
    await assertSucceeds(
      setDoc(runRef(owner, ORG_A, TEAM_A1, 'run-1'), sampleManifest(USERS.alice.uid)),
    );
    await assertFails(deleteDoc(runRef(owner, ORG_A, TEAM_A1, 'run-1')));
  });
});

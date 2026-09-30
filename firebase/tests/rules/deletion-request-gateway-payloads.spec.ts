// PR 8.3c-1 deel 2 — bewijst tegen de ECHTE Security Rules dat PRECIES wat
// `FirestoreDeletionRequestGateway` schrijft geaccepteerd wordt, en dat een
// `exportProof` uit een ECHTE 8.3b-export (`buildOrganizationExport`) de exacte
// vorm heeft die Rules eisen. Dit is de drift-bewaker tussen drie lagen die elk
// hun eigen handgeschreven kopie van de tien tellingen hebben: het v2-exportcontract,
// het documentcontract en `exportCountKeys()` in firestore.rules.
//
// De payloadfuncties komen uit v2 (`deletionRequestPayloads.ts`, bewust vrij van
// padopbouw en Auth). De gateway zelf draait hier niet: `getAuth().currentUser`
// bestaat niet in `@firebase/rules-unit-testing`-contexten; de gateway wordt met
// echte Auth-sessie in de e2e-auth-suite gedekt (8.3c-1c-ii).

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createTestEnv, assertSucceeds, assertFails, authCtx } from './helpers/testEnv.js';
import { ORG_A, USERS } from './helpers/fixtures.js';
import { CLAIMS, seedOrganizations } from './helpers/retention.js';
import { DELETION_REQUEST_COUNT_KEYS, deletionRequestConverter } from '../../src/documents/index.js';
import {
  buildCancelPatch,
  buildCreatePayload,
  buildRestartPatch,
} from '../../../v2/src/infrastructure/deletion/deletionRequestPayloads.js';
import { buildOrganizationExport } from '../../../v2/src/domain/export/build.js';
import type { DeletionExportProof } from '../../../v2/src/domain/deletion/types.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await seedOrganizations(env);
});

function ownerDb() {
  return authCtx(env, USERS.alice.uid, CLAIMS.alice);
}
function requestRef(db: ReturnType<typeof authCtx>) {
  return doc(db, 'organizations', ORG_A, 'deletionRequests', 'current');
}

/** Een echte export van een minimale fictieve organisatie op een gegeven moment. */
function realProof(now: string): DeletionExportProof {
  const built = buildOrganizationExport(
    {
      organization: {
        id: ORG_A,
        name: 'Org A',
        createdBy: USERS.alice.uid,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      organizationMembers: [
        { id: USERS.alice.uid, uid: USERS.alice.uid, role: 'organizationOwner' },
      ],
      invitations: [],
      teams: [
        {
          teamId: 'team-a1',
          name: 'Team A1',
          orgName: 'Org A',
          createdBy: USERS.alice.uid,
          createdAt: '2026-01-01T00:00:00.000Z',
          teamMembers: [],
          settings: null,
          roster: null,
          games: [],
          completedGames: [],
          migrationRuns: [],
        },
      ],
    },
    { uid: USERS.alice.uid, role: 'organizationOwner', now },
  );
  if (!built.allowed) throw new Error('export had moeten slagen');
  return {
    contentHash: built.export.contentHash,
    exportedAt: built.export.exportedAt,
    counts: built.export.counts,
  };
}

describe('gateway-payloads tegen de echte Rules', () => {
  it('de tellingen van een echte export dragen exact de sleutels die Rules en het documentcontract eisen', () => {
    const proof = realProof('2026-09-29T10:00:00.000Z');
    expect(Object.keys(proof.counts).sort()).toEqual([...DELETION_REQUEST_COUNT_KEYS].sort());
  });

  it('create met een echt exportProof wordt geaccepteerd en is via de converter terug te lezen', async () => {
    const proof = realProof('2026-09-29T10:00:00.000Z');
    await assertSucceeds(setDoc(requestRef(ownerDb()), buildCreatePayload(ORG_A, USERS.alice.uid, proof)));

    const snap = await assertSucceeds(
      getDoc(requestRef(ownerDb()).withConverter(deletionRequestConverter)),
    );
    const read = snap.data()!;
    expect(read.status).toBe('requested');
    expect(read.attempt).toBe(1);
    expect(read.revision).toBe(0);
    expect(read.requestedBy).toBe(USERS.alice.uid);
    expect(read.exportProof).toEqual(proof);
    expect(read.requestedAt.toMillis()).toBeGreaterThan(0);
  });

  it('de volledige cyclus met gateway-payloads: create → cancel → restart → cancel → restart', async () => {
    const db = ownerDb();
    const first = realProof('2026-09-29T10:00:00.000Z');
    const second = realProof('2026-09-29T11:00:00.000Z');
    const third = realProof('2026-09-29T12:00:00.000Z');

    await assertSucceeds(setDoc(requestRef(db), buildCreatePayload(ORG_A, USERS.alice.uid, first)));
    await assertSucceeds(updateDoc(requestRef(db), buildCancelPatch({ revision: 0 })));
    await assertSucceeds(
      updateDoc(requestRef(db), buildRestartPatch({ attempt: 1, revision: 1 }, USERS.alice.uid, second)),
    );
    await assertSucceeds(updateDoc(requestRef(db), buildCancelPatch({ revision: 2 })));
    await assertSucceeds(
      updateDoc(requestRef(db), buildRestartPatch({ attempt: 2, revision: 3 }, USERS.alice.uid, third)),
    );

    const read = (
      await assertSucceeds(getDoc(requestRef(db).withConverter(deletionRequestConverter)))
    ).data()!;
    expect(read).toMatchObject({ status: 'requested', attempt: 3, revision: 4 });
    expect(read.exportProof.exportedAt).toBe('2026-09-29T12:00:00.000Z');
    expect(read.cancelledAt).toBeNull();
  });

  it('een herstart met het OUDE bewijs (zelfde exportedAt) wordt door Rules geweigerd — de coordinator meldt dat als clock-behind', async () => {
    const db = ownerDb();
    const proof = realProof('2026-09-29T10:00:00.000Z');
    await assertSucceeds(setDoc(requestRef(db), buildCreatePayload(ORG_A, USERS.alice.uid, proof)));
    await assertSucceeds(updateDoc(requestRef(db), buildCancelPatch({ revision: 0 })));
    await assertFails(
      updateDoc(requestRef(db), buildRestartPatch({ attempt: 1, revision: 1 }, USERS.alice.uid, proof)),
    );
  });

  it('een verouderde revisie in de patch wordt door Rules geweigerd (de gateway meldt rejected)', async () => {
    const db = ownerDb();
    await assertSucceeds(
      setDoc(requestRef(db), buildCreatePayload(ORG_A, USERS.alice.uid, realProof('2026-09-29T10:00:00.000Z'))),
    );
    await assertFails(updateDoc(requestRef(db), buildCancelPatch({ revision: 5 })));
  });

  it('een niet-owner kan met dezelfde payload niets aanmaken', async () => {
    const proof = realProof('2026-09-29T10:00:00.000Z');
    await assertFails(
      setDoc(
        requestRef(authCtx(env, USERS.bob.uid, CLAIMS.bob)),
        buildCreatePayload(ORG_A, USERS.bob.uid, proof),
      ),
    );
  });
});

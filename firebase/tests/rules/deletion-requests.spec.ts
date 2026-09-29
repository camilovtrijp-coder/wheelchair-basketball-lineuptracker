// PR 8.3c-1 — organizations/{orgId}/deletionRequests/current
// (docs/pr-8.3c-besluitvoorstel.md §2.5).
//
// Bewijst de toestandsmachine die Rules voor een CLIENT toestaan:
//
//   (niets) ──create──> requested ──cancel──> cancelled ──restart(attempt+1)──> requested
//
// en dat al het andere default-deny is: `executing`/`completed`/`failed` zijn
// voorbehouden aan het runbook (Admin-rechten), een niet-owner kan niets, er is
// geen hard delete, en `organizationId`/`attempt` kunnen niet buiten de herstart
// om bewegen. Rules kunnen de blokkerende voorwaarden (recente wedstrijd,
// migratierun) en de echtheid van `exportProof` NIET afdwingen — dat is
// applicatielogica en staat in de rulescommentaar; hier wordt alleen de vorm
// bewaakt.

import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createTestEnv, assertSucceeds, assertFails, authCtx, unauthCtx, withAdmin } from './helpers/testEnv.js';
import { ORG_A, ORG_B, USERS } from './helpers/fixtures.js';
import { CLAIMS, seedOrganizations } from './helpers/retention.js';

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
function requestRef(db: ReturnType<typeof authCtx>, orgId = ORG_A) {
  return doc(db, 'organizations', orgId, 'deletionRequests', 'current');
}

function exportProof(overrides: Record<string, unknown> = {}) {
  return {
    contentHash: 'sha256-fictief-0001',
    exportedAt: '2026-09-29T10:00:00.000Z',
    counts: exportCounts(),
    ...overrides,
  };
}

/** Exact de tien sleutels van `OrganizationExportSectionCounts` (v2 8.3b). */
function exportCounts(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    organizationMembers: 5,
    invitations: 2,
    teams: 1,
    teamMembers: 1,
    settingsDocuments: 1,
    rosterPlayers: 8,
    games: 0,
    gameActions: 0,
    completedGames: 3,
    migrationRuns: 0,
    ...overrides,
  };
}

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_A,
    status: 'requested',
    attempt: 1,
    requestedBy: USERS.alice.uid,
    requestedAt: serverTimestamp(),
    exportProof: exportProof(),
    cancelledAt: null,
    revision: 0,
    ...overrides,
  };
}

/** Seedt via Admin (omzeilt Rules) een bestaand document in een gegeven staat. */
async function seedRequest(overrides: Record<string, unknown> = {}, orgId = ORG_A) {
  await withAdmin(env, async (db) => {
    await db
      .collection('organizations')
      .doc(orgId)
      .collection('deletionRequests')
      .doc('current')
      .set({
        organizationId: orgId,
        status: 'requested',
        attempt: 1,
        requestedBy: USERS.alice.uid,
        requestedAt: new Date(),
        exportProof: exportProof(),
        cancelledAt: null,
        revision: 0,
        ...overrides,
      });
  });
}

describe('deletionRequests/current: create', () => {
  it('owner mag een verwijderverzoek aanmaken (attempt 1, revision 0)', async () => {
    await assertSucceeds(setDoc(requestRef(ownerDb()), createPayload()));
  });

  it.each([
    ['bob (admin)', USERS.bob.uid, CLAIMS.bob],
    ['carol (coach)', USERS.carol.uid, CLAIMS.carol],
    ['dave (scorer)', USERS.dave.uid, CLAIMS.dave],
    ['erin (viewer)', USERS.erin.uid, CLAIMS.erin],
    ['henry (team-only coach)', USERS.henry.uid, CLAIMS.henry],
    ['frank (owner van een ANDERE organisatie)', USERS.frank.uid, CLAIMS.frank],
  ])('%s mag GEEN verwijderverzoek aanmaken', async (_naam, uid, claims) => {
    await assertFails(
      setDoc(requestRef(authCtx(env, uid, claims)), createPayload({ requestedBy: uid })),
    );
  });

  it('een niet-ingelogde gebruiker mag niets aanmaken', async () => {
    await assertFails(setDoc(requestRef(unauthCtx(env)), createPayload()));
  });

  it('weigert een ander document-ID dan `current`', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), 'organizations', ORG_A, 'deletionRequests', 'tweede'), createPayload()),
    );
  });

  it('weigert een organizationId die niet bij het pad past', async () => {
    await assertFails(setDoc(requestRef(ownerDb()), createPayload({ organizationId: ORG_B })));
  });

  it('weigert requestedBy van een ANDER dan de aanroeper', async () => {
    await assertFails(setDoc(requestRef(ownerDb()), createPayload({ requestedBy: USERS.bob.uid })));
  });

  it.each([
    ['een clientgekozen string', '2026-01-01T00:00:00.000Z'],
    ['een teruggedateerd tijdstempel', Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000)],
    ['een tijdstempel in de toekomst', Timestamp.fromMillis(Date.now() + 60 * 60 * 1000)],
    ['null', null],
  ])('weigert requestedAt als %s (moet == request.time zijn)', async (_naam, waarde) => {
    await assertFails(setDoc(requestRef(ownerDb()), createPayload({ requestedAt: waarde })));
  });

  it('weigert een ontbrekende requestedAt', async () => {
    const { requestedAt: _weg, ...zonder } = createPayload();
    await assertFails(setDoc(requestRef(ownerDb()), zonder));
  });

  it.each(['executing', 'completed', 'failed', 'cancelled'])(
    'weigert aanmaken rechtstreeks in status %s (alleen `requested`)',
    async (status) => {
      await assertFails(setDoc(requestRef(ownerDb()), createPayload({ status })));
    },
  );

  it('weigert attempt anders dan 1 bij create', async () => {
    await assertFails(setDoc(requestRef(ownerDb()), createPayload({ attempt: 2 })));
    await assertFails(setDoc(requestRef(ownerDb()), createPayload({ attempt: 0 })));
  });

  it('weigert revision anders dan 0 bij create', async () => {
    await assertFails(setDoc(requestRef(ownerDb()), createPayload({ revision: 1 })));
  });

  it('weigert cancelledAt anders dan null bij create', async () => {
    await assertFails(setDoc(requestRef(ownerDb()), createPayload({ cancelledAt: serverTimestamp() })));
  });

  it('weigert een ONTBREKEND exportProof (geen geldige aanvraag zonder)', async () => {
    const { exportProof: _weg, ...zonder } = createPayload();
    await assertFails(setDoc(requestRef(ownerDb()), zonder));
    await assertFails(setDoc(requestRef(ownerDb()), createPayload({ exportProof: null })));
  });

  it.each([
    ['een lege contentHash', { contentHash: '' }],
    ['een contentHash die geen string is', { contentHash: 42 }],
    ['een exportedAt in een verkeerde vorm', { exportedAt: 'gisteren' }],
    ['een exportedAt die geen string is', { exportedAt: Timestamp.now() }],
    ['counts die geen map is', { counts: [1, 2, 3] }],
    ['counts als lege map', { counts: {} }],
    ['een extra veld in het exportProof', { extra: 'nee' }],
  ])('weigert %s in het exportProof', async (_naam, overrides) => {
    await assertFails(
      setDoc(requestRef(ownerDb()), createPayload({ exportProof: exportProof(overrides) })),
    );
  });

  it('weigert counts met een ONTBREKENDE telling (alle tien zijn verplicht)', async () => {
    for (const sleutel of Object.keys(exportCounts())) {
      const { [sleutel]: _weg, ...zonder } = exportCounts();
      await assertFails(
        setDoc(requestRef(ownerDb()), createPayload({ exportProof: exportProof({ counts: zonder }) })),
      );
    }
  });

  it.each([
    ['een negatieve telling', { teams: -1 }],
    ['een fractionele telling', { teams: 1.5 }],
    ['een telling als string', { teams: '1' }],
    ['een telling als null', { completedGames: null }],
    ['een telling als boolean', { games: true }],
    ['een telling als map', { invitations: { aantal: 1 } }],
    ['een extra, onbekende telling', { onbekend: 1 }],
  ])('weigert counts met %s', async (_naam, overrides) => {
    await assertFails(
      setDoc(
        requestRef(ownerDb()),
        createPayload({ exportProof: exportProof({ counts: exportCounts(overrides) }) }),
      ),
    );
  });

  it('accepteert counts met nullen overal (een lege organisatie is een geldige export)', async () => {
    const nullen = Object.fromEntries(Object.keys(exportCounts()).map((k) => [k, 0]));
    await assertSucceeds(
      setDoc(requestRef(ownerDb()), createPayload({ exportProof: exportProof({ counts: nullen }) })),
    );
  });

  it('weigert een herstart met vervormde counts', async () => {
    await seedRequest({ status: 'cancelled', cancelledAt: new Date(), revision: 1 });
    await assertFails(
      updateDoc(requestRef(ownerDb()), {
        status: 'requested',
        attempt: 2,
        requestedBy: USERS.alice.uid,
        requestedAt: serverTimestamp(),
        exportProof: exportProof({ counts: exportCounts({ teams: -1 }), exportedAt: '2026-09-30T10:00:00.000Z' }),
        cancelledAt: null,
        revision: 2,
      }),
    );
  });

  it('weigert een ontbrekende contentHash of counts in het exportProof', async () => {
    const { contentHash: _h, ...zonderHash } = exportProof();
    const { counts: _c, ...zonderCounts } = exportProof();
    await assertFails(setDoc(requestRef(ownerDb()), createPayload({ exportProof: zonderHash })));
    await assertFails(setDoc(requestRef(ownerDb()), createPayload({ exportProof: zonderCounts })));
  });

  it('weigert een extra top-level veld (exacte sleutelset)', async () => {
    await assertFails(setDoc(requestRef(ownerDb()), createPayload({ pad: 'organizations/ORG_B' })));
  });

  it('weigert een ontbrekend kernveld', async () => {
    const { attempt: _weg, ...zonder } = createPayload();
    await assertFails(setDoc(requestRef(ownerDb()), zonder));
  });

  it('weigert een tweede create op een bestaand document als update-omweg (geen overschrijven)', async () => {
    await seedRequest();
    await assertFails(setDoc(requestRef(ownerDb()), createPayload()));
  });
});

describe('deletionRequests/current: read', () => {
  it.each([
    ['alice (owner)', USERS.alice.uid, CLAIMS.alice],
    ['bob (admin)', USERS.bob.uid, CLAIMS.bob],
    ['carol (coach)', USERS.carol.uid, CLAIMS.carol],
    ['dave (scorer)', USERS.dave.uid, CLAIMS.dave],
    ['erin (viewer)', USERS.erin.uid, CLAIMS.erin],
  ])('%s mag het verwijderverzoek lezen (banner voor alle leden)', async (_naam, uid, claims) => {
    await seedRequest();
    await assertSucceeds(getDoc(requestRef(authCtx(env, uid, claims))));
  });

  it('een team-only lid zonder organizationMembers-rij mag NIET lezen (isOrgMember)', async () => {
    await seedRequest();
    await assertFails(getDoc(requestRef(authCtx(env, USERS.henry.uid, CLAIMS.henry))));
  });

  it('cross-org: frank mag het verzoek van organisatie A NIET lezen', async () => {
    await seedRequest();
    await assertFails(getDoc(requestRef(authCtx(env, USERS.frank.uid, CLAIMS.frank))));
  });

  it('een niet-ingelogde gebruiker mag niet lezen', async () => {
    await seedRequest();
    await assertFails(getDoc(requestRef(unauthCtx(env))));
  });
});

describe('deletionRequests/current: annuleren (requested → cancelled)', () => {
  function cancelPatch(overrides: Record<string, unknown> = {}) {
    return { status: 'cancelled', cancelledAt: serverTimestamp(), revision: 1, ...overrides };
  }

  it('owner mag annuleren vanuit requested', async () => {
    await seedRequest();
    await assertSucceeds(updateDoc(requestRef(ownerDb()), cancelPatch()));
  });

  it.each([
    ['bob (admin)', USERS.bob.uid, CLAIMS.bob],
    ['carol (coach)', USERS.carol.uid, CLAIMS.carol],
    ['dave (scorer)', USERS.dave.uid, CLAIMS.dave],
    ['erin (viewer)', USERS.erin.uid, CLAIMS.erin],
    ['frank (cross-org)', USERS.frank.uid, CLAIMS.frank],
  ])('%s mag NIET annuleren', async (_naam, uid, claims) => {
    await seedRequest();
    await assertFails(updateDoc(requestRef(authCtx(env, uid, claims)), cancelPatch()));
  });

  it('weigert annuleren met een clientgekozen cancelledAt', async () => {
    await seedRequest();
    await assertFails(
      updateDoc(requestRef(ownerDb()), cancelPatch({ cancelledAt: '2026-01-01T00:00:00.000Z' })),
    );
    await assertFails(
      updateDoc(
        requestRef(ownerDb()),
        cancelPatch({ cancelledAt: Timestamp.fromMillis(Date.now() - 86_400_000) }),
      ),
    );
  });

  it('weigert annuleren zonder revision +1 (optimistische concurrency)', async () => {
    await seedRequest();
    await assertFails(updateDoc(requestRef(ownerDb()), cancelPatch({ revision: 5 })));
    await assertFails(updateDoc(requestRef(ownerDb()), cancelPatch({ revision: 0 })));
  });

  it('weigert annuleren dat een ander veld meestuurt (attempt, requestedBy, organizationId, exportProof)', async () => {
    for (const extra of [
      { attempt: 9 },
      { requestedBy: USERS.bob.uid },
      { organizationId: ORG_B },
      { exportProof: exportProof({ contentHash: 'sha256-ander' }) },
    ]) {
      await seedRequest();
      await assertFails(updateDoc(requestRef(ownerDb()), cancelPatch(extra)));
    }
  });

  it.each(['cancelled', 'executing', 'completed', 'failed'])(
    'weigert annuleren vanuit %s (alleen vanuit requested)',
    async (status) => {
      await seedRequest({ status, revision: 1 });
      await assertFails(updateDoc(requestRef(ownerDb()), cancelPatch({ revision: 2 })));
    },
  );
});

describe('deletionRequests/current: herstart (cancelled → requested, attempt + 1)', () => {
  async function seedCancelled(overrides: Record<string, unknown> = {}) {
    await seedRequest({
      status: 'cancelled',
      cancelledAt: new Date(),
      revision: 1,
      ...overrides,
    });
  }

  function restartPatch(overrides: Record<string, unknown> = {}) {
    return {
      status: 'requested',
      attempt: 2,
      requestedBy: USERS.alice.uid,
      requestedAt: serverTimestamp(),
      // Vers bewijs: nieuwe hash EN een strikt latere exportedAt dan de seed.
      exportProof: exportProof({
        contentHash: 'sha256-fictief-0002',
        exportedAt: '2026-09-30T10:00:00.000Z',
      }),
      cancelledAt: null,
      revision: 2,
      ...overrides,
    };
  }

  it('owner mag na annuleren opnieuw starten met attempt + 1 en een vers exportProof', async () => {
    await seedCancelled();
    await assertSucceeds(updateDoc(requestRef(ownerDb()), restartPatch()));
  });

  it('bewijst de volledige cyclus: create → annuleren → herstart → opnieuw annuleren → tweede herstart', async () => {
    const db = ownerDb();
    await assertSucceeds(setDoc(requestRef(db), createPayload()));
    await assertSucceeds(
      updateDoc(requestRef(db), { status: 'cancelled', cancelledAt: serverTimestamp(), revision: 1 }),
    );
    await assertSucceeds(updateDoc(requestRef(db), restartPatch()));
    await assertSucceeds(
      updateDoc(requestRef(db), { status: 'cancelled', cancelledAt: serverTimestamp(), revision: 3 }),
    );
    await assertSucceeds(
      updateDoc(
        requestRef(db),
        restartPatch({
          attempt: 3,
          revision: 4,
          exportProof: exportProof({ contentHash: 'sha256-fictief-0003', exportedAt: '2026-10-01T10:00:00.000Z' }),
        }),
      ),
    );
  });

  it.each([
    ['bob (admin)', USERS.bob.uid, CLAIMS.bob],
    ['carol (coach)', USERS.carol.uid, CLAIMS.carol],
    ['erin (viewer)', USERS.erin.uid, CLAIMS.erin],
    ['frank (cross-org)', USERS.frank.uid, CLAIMS.frank],
  ])('%s mag NIET opnieuw starten', async (_naam, uid, claims) => {
    await seedCancelled();
    await assertFails(
      updateDoc(requestRef(authCtx(env, uid, claims)), restartPatch({ requestedBy: uid })),
    );
  });

  it('weigert een herstart waarbij attempt niet met precies 1 stijgt', async () => {
    await seedCancelled();
    await assertFails(updateDoc(requestRef(ownerDb()), restartPatch({ attempt: 1 })));
    await assertFails(updateDoc(requestRef(ownerDb()), restartPatch({ attempt: 3 })));
  });

  it('weigert een herstart die requestedBy op een ander zet', async () => {
    await seedCancelled();
    await assertFails(updateDoc(requestRef(ownerDb()), restartPatch({ requestedBy: USERS.bob.uid })));
  });

  it.each([
    ['een clientgekozen string', '2026-01-01T00:00:00.000Z'],
    ['een teruggedateerd tijdstempel', Timestamp.fromMillis(Date.now() - 7 * 86_400_000)],
    ['een toekomstig tijdstempel', Timestamp.fromMillis(Date.now() + 3_600_000)],
  ])('weigert een herstart met requestedAt als %s', async (_naam, waarde) => {
    await seedCancelled();
    await assertFails(updateDoc(requestRef(ownerDb()), restartPatch({ requestedAt: waarde })));
  });

  it('weigert een herstart met EXACT hetzelfde exportProof als de geannuleerde poging', async () => {
    await seedCancelled();
    await assertFails(updateDoc(requestRef(ownerDb()), restartPatch({ exportProof: exportProof() })));
  });

  it('weigert een herstart met dezelfde exportedAt maar een andere hash (niet vers)', async () => {
    await seedCancelled();
    await assertFails(
      updateDoc(
        requestRef(ownerDb()),
        restartPatch({ exportProof: exportProof({ contentHash: 'sha256-fictief-0002' }) }),
      ),
    );
  });

  it('weigert een herstart met een OUDER exportProof dan de geannuleerde poging', async () => {
    await seedCancelled();
    await assertFails(
      updateDoc(
        requestRef(ownerDb()),
        restartPatch({
          exportProof: exportProof({
            contentHash: 'sha256-fictief-0002',
            exportedAt: '2026-09-01T10:00:00.000Z',
          }),
        }),
      ),
    );
  });

  it('weigert een herstart zonder geldig vers exportProof', async () => {
    await seedCancelled();
    await assertFails(updateDoc(requestRef(ownerDb()), restartPatch({ exportProof: null })));
    await assertFails(
      updateDoc(requestRef(ownerDb()), restartPatch({ exportProof: exportProof({ contentHash: '' }) })),
    );
  });

  it('weigert een herstart die cancelledAt niet terugzet op null', async () => {
    await seedCancelled();
    await assertFails(updateDoc(requestRef(ownerDb()), restartPatch({ cancelledAt: serverTimestamp() })));
  });

  it('weigert een herstart die organizationId wijzigt (kernveld blijft onveranderlijk)', async () => {
    await seedCancelled();
    await assertFails(updateDoc(requestRef(ownerDb()), restartPatch({ organizationId: ORG_B })));
  });

  it('weigert een herstart zonder revision +1', async () => {
    await seedCancelled();
    await assertFails(updateDoc(requestRef(ownerDb()), restartPatch({ revision: 1 })));
    await assertFails(updateDoc(requestRef(ownerDb()), restartPatch({ revision: 9 })));
  });

  it('weigert elke andere uitgaande overgang uit cancelled (executing/completed/failed/cancelled)', async () => {
    for (const status of ['executing', 'completed', 'failed', 'cancelled']) {
      await seedCancelled();
      await assertFails(
        updateDoc(requestRef(ownerDb()), restartPatch({ status, attempt: 1, cancelledAt: null })),
      );
      await assertFails(updateDoc(requestRef(ownerDb()), { status, revision: 2 }));
    }
  });

  it.each(['requested', 'executing', 'completed', 'failed'])(
    'weigert een herstart vanuit %s (alleen vanuit cancelled)',
    async (status) => {
      await seedRequest({ status, revision: 1 });
      await assertFails(updateDoc(requestRef(ownerDb()), restartPatch()));
    },
  );
});

describe('deletionRequests/current: runbookstatussen en verwijderen zijn NIET voor de client', () => {
  it.each(['executing', 'completed', 'failed'])(
    'owner kan een requested-verzoek niet zelf naar %s zetten',
    async (status) => {
      await seedRequest();
      await assertFails(updateDoc(requestRef(ownerDb()), { status, revision: 1 }));
    },
  );

  it('owner kan attempt niet los ophogen zonder herstart', async () => {
    await seedRequest();
    await assertFails(updateDoc(requestRef(ownerDb()), { attempt: 2, revision: 1 }));
  });

  it.each([
    ['requested', 'owner'],
    ['cancelled', 'owner'],
    ['executing', 'owner'],
    ['completed', 'owner'],
  ])('geen hard delete: owner kan een %s-verzoek niet verwijderen', async (status) => {
    await seedRequest({ status, revision: 1 });
    await assertFails(deleteDoc(requestRef(ownerDb())));
  });

  it('een verwijderverzoek van organisatie A verandert niets aan organisatie B (pad komt uit het document, niet uit invoer)', async () => {
    await seedRequest();
    await assertFails(setDoc(requestRef(authCtx(env, USERS.frank.uid, CLAIMS.frank), ORG_A), createPayload()));
    // frank is wél owner van B: zijn eigen verzoek slaagt, met zijn eigen organizationId.
    await assertSucceeds(
      setDoc(
        requestRef(authCtx(env, USERS.frank.uid, CLAIMS.frank), ORG_B),
        createPayload({ organizationId: ORG_B, requestedBy: USERS.frank.uid }),
      ),
    );
  });
});

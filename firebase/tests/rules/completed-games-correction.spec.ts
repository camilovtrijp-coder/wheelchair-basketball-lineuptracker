// PR 7.5c (docs/pr-7.5-plan.md §D.3/§F, firestore.rules punt 21) — de smalle
// CORRECTIE-`allow update`-tak op completedGames/{id}. Bewijst positief
// (owner/admin/coach corrigeert één segment met revisie +1 en een passend
// logitem, ook op een legacy-document zonder revision/deletedAt) en negatief
// (alles wat het plan §F noemt, plus de segment-/score-/logconsistentie die
// Rules via `segmentIndex` en list-slices kunnen afdwingen). De payload
// spiegelt exact `FirestoreGameCloudGateway.correctCompletedGame()`
// (arrayUnion van het ene logitem, serverTimestamp voor correctedAt).
// Fictieve data; geen echte spelers of credentials.

import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { arrayUnion, deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createTestEnv, assertSucceeds, assertFails, authCtx, unauthCtx, withAdmin } from './helpers/testEnv.js';
import { ORG_A, ORG_B, TEAM_A1, TEAM_A2, TEAM_B1, USERS, sampleCompletedGame } from './helpers/fixtures.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});

const SEG1 = {
  id: 'seg-1',
  quarter: 1,
  beginSec: 600,
  endSec: 480,
  durSec: 120,
  lineup: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5'],
  pf: 4,
  pa: 2,
  classSum: 14.0,
  allowed: 14.5,
  over: false,
};
const SEG2 = {
  id: 'seg-2',
  quarter: 1,
  beginSec: 480,
  endSec: 300,
  durSec: 180,
  lineup: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-6'],
  pf: 6,
  pa: 4,
  classSum: 14.5,
  allowed: 14.5,
  over: false,
  tov: 1,
};

function baseGame(overrides: Record<string, unknown> = {}) {
  return sampleCompletedGame({ segments: [SEG1, SEG2], scoreFor: 10, scoreAgainst: 6, ...overrides });
}

/** Correctie van seg-1: eind 480 -> 420 (duur 180), pf 4 -> 7, tov 0 -> 2. */
const BEFORE1 = { quarter: 1, beginSec: 600, endSec: 480, pf: 4, pa: 2, tov: 0 };
const AFTER1 = { quarter: 1, beginSec: 600, endSec: 420, pf: 7, pa: 2, tov: 2 };
const SEG1_CORRECTED = { ...SEG1, endSec: 420, durSec: 180, pf: 7, tov: 2 };

function entry(uid: string | null, overrides: Record<string, unknown> = {}) {
  return {
    id: 'corr-1',
    segmentId: 'seg-1',
    segmentIndex: 0,
    at: '2026-02-01T10:00:00.000Z',
    by: uid,
    before: BEFORE1,
    after: AFTER1,
    ...overrides,
  };
}

/** Geldige patch voor `baseGame()`; `overrides` vervangen/voegen velden toe. */
function patch(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    segments: [SEG1_CORRECTED, SEG2],
    scoreFor: 13,
    scoreAgainst: 6,
    corrections: arrayUnion(entry(uid)),
    correctedAt: serverTimestamp(),
    revision: 1,
    ...overrides,
  };
}

function ref(db: ReturnType<typeof authCtx>, id = 'completed-1', orgId = ORG_A, teamId = TEAM_A1) {
  return doc(db, 'organizations', orgId, 'teams', teamId, 'completedGames', id);
}

const ctx = (user: { uid: string; email: string }) =>
  authCtx(env, user.uid, { email: user.email, email_verified: true });

async function seed(id: string, data: Record<string, unknown>, orgId = ORG_A, teamId = TEAM_A1) {
  await withAdmin(env, async (db) => {
    await db
      .collection('organizations')
      .doc(orgId)
      .collection('teams')
      .doc(teamId)
      .collection('completedGames')
      .doc(id)
      .set(data);
  });
}

beforeEach(async () => {
  await env.clearFirestore();
  await withAdmin(env, async (db) => {
    const org = db.collection('organizations').doc(ORG_A);
    await org.set({ name: 'Org A', createdBy: USERS.alice.uid });
    await org
      .collection('organizationMembers')
      .doc(USERS.alice.uid)
      .set({ role: 'organizationOwner', email: USERS.alice.email, uid: USERS.alice.uid });
    await org
      .collection('organizationMembers')
      .doc(USERS.bob.uid)
      .set({ role: 'organizationAdmin', email: USERS.bob.email, uid: USERS.bob.uid });
    await org.collection('teams').doc(TEAM_A1).set({ name: 'Team A1', orgName: 'Org A', createdBy: USERS.alice.uid });
    await org.collection('teams').doc(TEAM_A2).set({ name: 'Team A2', orgName: 'Org A', createdBy: USERS.alice.uid });
    for (const [uid, role, email] of [
      [USERS.carol.uid, 'coach', USERS.carol.email],
      [USERS.dave.uid, 'scorer', USERS.dave.email],
      [USERS.erin.uid, 'viewer', USERS.erin.email],
    ] as [string, string, string][]) {
      await org.collection('teams').doc(TEAM_A1).collection('teamMembers').doc(uid).set({ role, email, uid });
    }
    // Carol is alleen op team A1 coach; op team A2 heeft ze niets.
    const orgB = db.collection('organizations').doc(ORG_B);
    await orgB.set({ name: 'Org B', createdBy: USERS.frank.uid });
    await orgB
      .collection('organizationMembers')
      .doc(USERS.frank.uid)
      .set({ role: 'organizationOwner', email: USERS.frank.email, uid: USERS.frank.uid });
    await orgB.collection('teams').doc(TEAM_B1).set({ name: 'Team B1', orgName: 'Org B', createdBy: USERS.frank.uid });
  });
  await seed('completed-1', baseGame());
});

describe('correctie: toegestaan (positief)', () => {
  it('owner mag een segment corrigeren (revisie +1, logitem, correctedAt server-gebonden)', async () => {
    const db = ctx(USERS.alice);
    await assertSucceeds(updateDoc(ref(db), patch(USERS.alice.uid)));
    const data = (await getDoc(ref(db))).data()!;
    expect(data.revision).toBe(1);
    expect(data.scoreFor).toBe(13);
    expect(data.scoreAgainst).toBe(6);
    expect(data.segments[0]).toMatchObject({ id: 'seg-1', endSec: 420, durSec: 180, pf: 7, tov: 2 });
    expect(data.segments[1]).toEqual(SEG2);
    expect(data.corrections).toEqual([entry(USERS.alice.uid)]);
    expect(data.correctedAt).toBeInstanceOf(Timestamp);
    // Onaangeroerd:
    expect(data.players).toEqual(baseGame().players);
    expect(data.date).toBe(baseGame().date);
    expect(data.sourceGameId).toBe('game-1');
  });

  it('admin (organizationAdmin) mag corrigeren', async () => {
    await assertSucceeds(updateDoc(ref(ctx(USERS.bob)), patch(USERS.bob.uid)));
  });

  it('coach mag corrigeren', async () => {
    await assertSucceeds(updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid)));
  });

  it('een lokale correctie zonder account (by: null) mag worden geüpload', async () => {
    await assertSucceeds(
      updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid, { corrections: arrayUnion(entry(null)) })),
    );
  });

  it('het tweede logitem komt achter het eerste; het eerste blijft ongewijzigd (revisie 1 -> 2)', async () => {
    const db = ctx(USERS.carol);
    await assertSucceeds(updateDoc(ref(db), patch(USERS.carol.uid)));
    // Tweede correctie op seg-2 (index 1): pa 4 -> 5.
    const second = {
      id: 'corr-2',
      segmentId: 'seg-2',
      segmentIndex: 1,
      at: '2026-02-02T10:00:00.000Z',
      by: USERS.carol.uid,
      before: { quarter: 1, beginSec: 480, endSec: 300, pf: 6, pa: 4, tov: 1 },
      after: { quarter: 1, beginSec: 480, endSec: 300, pf: 6, pa: 5, tov: 1 },
    };
    await assertSucceeds(
      updateDoc(ref(db), {
        segments: [SEG1_CORRECTED, { ...SEG2, pa: 5 }],
        scoreFor: 13,
        scoreAgainst: 7,
        corrections: arrayUnion(second),
        correctedAt: serverTimestamp(),
        revision: 2,
      }),
    );
    const data = (await getDoc(ref(db))).data()!;
    expect(data.corrections.map((c: { id: string }) => c.id)).toEqual(['corr-1', 'corr-2']);
    expect(data.revision).toBe(2);
  });

  it('een correctie die tov naar 0 terugzet laat de sleutel `tov` weg (zoals projectSegment)', async () => {
    const { tov: _tov, ...noTov } = SEG2;
    const item = {
      id: 'corr-tov',
      segmentId: 'seg-2',
      segmentIndex: 1,
      at: '2026-02-01T10:00:00.000Z',
      by: USERS.carol.uid,
      before: { quarter: 1, beginSec: 480, endSec: 300, pf: 6, pa: 4, tov: 1 },
      after: { quarter: 1, beginSec: 480, endSec: 300, pf: 6, pa: 4, tov: 0 },
    };
    await assertSucceeds(
      updateDoc(ref(ctx(USERS.carol)), {
        segments: [SEG1, noTov],
        scoreFor: 10,
        scoreAgainst: 6,
        corrections: arrayUnion(item),
        correctedAt: serverTimestamp(),
        revision: 1,
      }),
    );
  });

  it('werkt ook op een realistisch groot document (12 spelers, 80 segmenten, 40 eerdere correcties) binnen de Rules-limiet van 1000 expressies', async () => {
    const players = Array.from({ length: 12 }, (_, i) => ({
      id: `gp-${i + 1}`,
      rosterId: i + 1,
      nr: String(i + 1),
      naam: `Fictief Speler ${i + 1}`,
      kl: '3.0',
      vrouw: false,
      jeugd: false,
      participate: true,
      start: i < 5,
    }));
    const segments = Array.from({ length: 80 }, (_, i) => ({
      ...SEG1,
      id: `seg-${i + 1}`,
    }));
    const log = Array.from({ length: 40 }, (_, i) =>
      entry(USERS.carol.uid, { id: `old-${i}`, segmentId: 'seg-1', segmentIndex: 0 }),
    );
    await seed(
      'completed-big',
      baseGame({ players, segments, scoreFor: 320, scoreAgainst: 160, corrections: log, correctedAt: Timestamp.now(), revision: 40 }),
    );
    const item = entry(USERS.carol.uid, { id: 'corr-big', segmentId: 'seg-40', segmentIndex: 39 });
    const corrected = { ...segments[39], endSec: 420, durSec: 180, pf: 7, tov: 2 };
    await assertSucceeds(
      updateDoc(ref(ctx(USERS.carol), 'completed-big'), {
        segments: segments.map((seg, i) => (i === 39 ? corrected : seg)),
        scoreFor: 323,
        scoreAgainst: 160,
        corrections: arrayUnion(item),
        correctedAt: serverTimestamp(),
        revision: 41,
      }),
    );
  });

  it('een legacy-document zonder revision/deletedAt/deletedBy kan gecorrigeerd worden (revision start impliciet op 0)', async () => {
    const { revision: _r, deletedAt: _d, deletedBy: _b, ...legacy } = baseGame();
    await seed('legacy-1', legacy);
    const db = ctx(USERS.carol);
    await assertSucceeds(updateDoc(ref(db, 'legacy-1'), patch(USERS.carol.uid)));
    expect((await getDoc(ref(db, 'legacy-1'))).data()!.revision).toBe(1);
  });

  it('een legacy-document met een verkeerde (niet-impliciete) revisie wordt geweigerd', async () => {
    const { revision: _r, deletedAt: _d, deletedBy: _b, ...legacy } = baseGame();
    await seed('legacy-1', legacy);
    await assertFails(updateDoc(ref(ctx(USERS.carol), 'legacy-1'), patch(USERS.carol.uid, { revision: 2 })));
  });
});

describe('correctie: bevoegdheid (negatief)', () => {
  it('scorer mag NIET corrigeren (mag wedstrijdacties schrijven, geen afgeronde historie wijzigen)', async () => {
    await assertFails(updateDoc(ref(ctx(USERS.dave)), patch(USERS.dave.uid)));
  });

  it('viewer mag NIET corrigeren', async () => {
    await assertFails(updateDoc(ref(ctx(USERS.erin)), patch(USERS.erin.uid)));
  });

  it('cross-org: de owner van org B mag NIET corrigeren', async () => {
    await assertFails(updateDoc(ref(ctx(USERS.frank)), patch(USERS.frank.uid)));
  });

  it('cross-team: een coach van team A1 mag NIET een wedstrijd van team A2 corrigeren', async () => {
    await seed('completed-a2', baseGame({ teamId: TEAM_A2 }), ORG_A, TEAM_A2);
    await assertFails(updateDoc(ref(ctx(USERS.carol), 'completed-a2', ORG_A, TEAM_A2), patch(USERS.carol.uid)));
  });

  it('niet-ingelogd mag niet corrigeren', async () => {
    await assertFails(updateDoc(ref(unauthCtx(env)), patch('uid-x')));
  });

  it('een logitem mag GEEN `by` van een ander lid dragen', async () => {
    await assertFails(
      updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid, { corrections: arrayUnion(entry(USERS.alice.uid)) })),
    );
  });

  it('hard delete blijft verboden, ook voor de owner van een gecorrigeerd document', async () => {
    const db = ctx(USERS.alice);
    await assertSucceeds(updateDoc(ref(db), patch(USERS.alice.uid)));
    await assertFails(deleteDoc(ref(db)));
  });
});

describe('correctie: revisie, tombstone en tijd (negatief)', () => {
  it('revisie niet +1 (sprong naar 2) wordt geweigerd', async () => {
    await assertFails(updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid, { revision: 2 })));
  });

  it('revisie ongewijzigd (0) wordt geweigerd', async () => {
    await assertFails(updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid, { revision: 0 })));
  });

  it('een verouderde revisie na een eerdere correctie (tweede apparaat) wordt geweigerd', async () => {
    const a = ctx(USERS.carol);
    await assertSucceeds(updateDoc(ref(a), patch(USERS.carol.uid)));
    // Apparaat B corrigeert nog op revisie 0 -> weigering (conflict).
    await assertFails(updateDoc(ref(ctx(USERS.alice)), patch(USERS.alice.uid, { corrections: arrayUnion(entry(USERS.alice.uid, { id: 'corr-b' })) })));
  });

  it('een getombstoned document mag niet meer gecorrigeerd worden', async () => {
    await seed('completed-dead', baseGame({ deletedAt: Timestamp.now(), deletedBy: USERS.alice.uid, revision: 1 }));
    await assertFails(updateDoc(ref(ctx(USERS.alice), 'completed-dead'), patch(USERS.alice.uid, { revision: 2 })));
  });

  it('correctedAt ongelijk aan request.time (clienttijd) wordt geweigerd', async () => {
    await assertFails(updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid, { correctedAt: Timestamp.now() })));
  });

  it('correctedAt ontbreekt wordt geweigerd', async () => {
    const { correctedAt: _c, ...without } = patch(USERS.carol.uid);
    await assertFails(updateDoc(ref(ctx(USERS.carol)), without));
  });
});

describe('correctie: onaangeroerde velden en veldenset (negatief)', () => {
  for (const [field, value] of [
    ['players', []],
    ['date', '2026-03-03T00:00:00.000Z'],
    ['sourceGameId', 'game-9'],
    ['organizationId', ORG_B],
    ['teamId', TEAM_A2],
    ['opponent', 'Andere Tegenstander'],
    ['quarterCount', 2],
    ['syncedAt', Timestamp.fromMillis(1)],
    ['deletedAt', Timestamp.now()],
    ['deletedBy', 'uid-carol'],
  ] as [string, unknown][]) {
    it(`een correctie die ook \`${field}\` wijzigt wordt geweigerd`, async () => {
      await assertFails(updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid, { [field]: value })));
    });
  }

  it('een extra (onbekend) veld wordt geweigerd', async () => {
    await assertFails(updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid, { extra: 1 })));
  });

  it('een patch zonder corrections (alleen segments/score/revision/correctedAt) wordt geweigerd', async () => {
    const { corrections: _c, ...without } = patch(USERS.carol.uid);
    await assertFails(updateDoc(ref(ctx(USERS.carol)), without));
  });

  it('een patch zonder segments (corrections wel) wordt geweigerd: het log beschrijft een wijziging die niet plaatsvond', async () => {
    const { segments: _s, ...without } = patch(USERS.carol.uid);
    await assertFails(updateDoc(ref(ctx(USERS.carol)), without));
  });
});

describe('correctie: correctielog (negatief)', () => {
  async function seedCorrected() {
    await assertSucceeds(updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid)));
  }

  it('corrections verkleinen (bestaand item weghalen) wordt geweigerd', async () => {
    await seedCorrected();
    await assertFails(
      updateDoc(ref(ctx(USERS.carol)), {
        segments: [SEG1_CORRECTED, SEG2],
        corrections: [],
        correctedAt: serverTimestamp(),
        revision: 2,
      }),
    );
  });

  it('een bestaand logitem wijzigen terwijl een nieuw item wordt toegevoegd wordt geweigerd', async () => {
    await seedCorrected();
    const second = entry(USERS.carol.uid, {
      id: 'corr-2',
      segmentId: 'seg-2',
      segmentIndex: 1,
      before: { quarter: 1, beginSec: 480, endSec: 300, pf: 6, pa: 4, tov: 1 },
      after: { quarter: 1, beginSec: 480, endSec: 300, pf: 6, pa: 5, tov: 1 },
    });
    await assertFails(
      updateDoc(ref(ctx(USERS.carol)), {
        segments: [SEG1_CORRECTED, { ...SEG2, pa: 5 }],
        scoreAgainst: 7,
        corrections: [entry(USERS.carol.uid, { at: '2026-02-09T10:00:00.000Z' }), second],
        correctedAt: serverTimestamp(),
        revision: 2,
      }),
    );
  });

  it('meer dan één item tegelijk toevoegen wordt geweigerd', async () => {
    const extra = entry(USERS.carol.uid, { id: 'corr-extra' });
    await assertFails(
      updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid, { corrections: [entry(USERS.carol.uid), extra] })),
    );
  });

  it('géén item toevoegen (corrections ongewijzigd) maar wel revisie +1 wordt geweigerd', async () => {
    await assertFails(updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid, { corrections: [] })));
  });

  it('het 51e logitem (MAX_CORRECTIONS = 50) wordt geweigerd', async () => {
    const log = Array.from({ length: 50 }, (_, i) => entry(USERS.carol.uid, { id: `corr-${i}` }));
    await seed('completed-full', baseGame({ corrections: log, correctedAt: Timestamp.now(), revision: 50 }));
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol), 'completed-full'),
        patch(USERS.carol.uid, { corrections: arrayUnion(entry(USERS.carol.uid, { id: 'corr-51' })), revision: 51 }),
      ),
    );
  });

  it('het 50e logitem is nog toegestaan', async () => {
    const log = Array.from({ length: 49 }, (_, i) => entry(USERS.carol.uid, { id: `corr-${i}` }));
    await seed('completed-49', baseGame({ corrections: log, correctedAt: Timestamp.now(), revision: 49 }));
    await assertSucceeds(
      updateDoc(
        ref(ctx(USERS.carol), 'completed-49'),
        patch(USERS.carol.uid, { corrections: arrayUnion(entry(USERS.carol.uid, { id: 'corr-50' })), revision: 50 }),
      ),
    );
  });

  it('een onbekend segmentId (index wijst naar een ander segment) wordt geweigerd', async () => {
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol)),
        patch(USERS.carol.uid, { corrections: arrayUnion(entry(USERS.carol.uid, { segmentId: 'seg-onbekend' })) }),
      ),
    );
  });

  it('een segmentIndex buiten het bereik wordt geweigerd', async () => {
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol)),
        patch(USERS.carol.uid, { corrections: arrayUnion(entry(USERS.carol.uid, { segmentIndex: 5 })) }),
      ),
    );
  });

  it('een logitem zonder segmentIndex of met extra sleutel wordt geweigerd', async () => {
    const { segmentIndex: _i, ...noIndex } = entry(USERS.carol.uid);
    await assertFails(updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid, { corrections: arrayUnion(noIndex) })));
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol)),
        patch(USERS.carol.uid, { corrections: arrayUnion(entry(USERS.carol.uid, { naam: 'Fictief Speler' })) }),
      ),
    );
  });

  it('een logitem met een niet-ISO `at` of lege `id` wordt geweigerd', async () => {
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol)),
        patch(USERS.carol.uid, { corrections: arrayUnion(entry(USERS.carol.uid, { at: 'gisteren' })) }),
      ),
    );
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol)),
        patch(USERS.carol.uid, { corrections: arrayUnion(entry(USERS.carol.uid, { id: '' })) }),
      ),
    );
  });

  it('`before` dat niet overeenkomt met het oude segment wordt geweigerd (gelogd origineel klopt niet)', async () => {
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol)),
        patch(USERS.carol.uid, {
          corrections: arrayUnion(entry(USERS.carol.uid, { before: { ...BEFORE1, pf: 5 } })),
        }),
      ),
    );
  });

  it('`after` dat niet overeenkomt met het nieuwe segment wordt geweigerd', async () => {
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol)),
        patch(USERS.carol.uid, {
          corrections: arrayUnion(entry(USERS.carol.uid, { after: { ...AFTER1, endSec: 400 } })),
        }),
      ),
    );
  });

  it('niet-bewerkbare of ontbrekende velden in before/after worden geweigerd', async () => {
    const { tov: _t, ...beforeNoTov } = BEFORE1;
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol)),
        patch(USERS.carol.uid, { corrections: arrayUnion(entry(USERS.carol.uid, { before: beforeNoTov })) }),
      ),
    );
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol)),
        patch(USERS.carol.uid, {
          corrections: arrayUnion(entry(USERS.carol.uid, { after: { ...AFTER1, lineup: ['gp-1'] } })),
        }),
      ),
    );
  });
});

describe('correctie: segmenten en score (negatief)', () => {
  it('een correctie die óók een ander segment wijzigt wordt geweigerd', async () => {
    await assertFails(
      updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid, { segments: [SEG1_CORRECTED, { ...SEG2, pf: 99 }] })),
    );
  });

  it('een correctie die de opstelling (lineup) van het segment wijzigt wordt geweigerd', async () => {
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol)),
        patch(USERS.carol.uid, { segments: [{ ...SEG1_CORRECTED, lineup: ['gp-9'] }, SEG2] }),
      ),
    );
  });

  it('een correctie die classSum/allowed/over van het segment wijzigt wordt geweigerd', async () => {
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol)),
        patch(USERS.carol.uid, { segments: [{ ...SEG1_CORRECTED, over: true }, SEG2] }),
      ),
    );
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol)),
        patch(USERS.carol.uid, { segments: [{ ...SEG1_CORRECTED, classSum: 20 }, SEG2] }),
      ),
    );
  });

  it('segmenten toevoegen of verwijderen wordt geweigerd', async () => {
    await assertFails(
      updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid, { segments: [SEG1_CORRECTED] })),
    );
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol)),
        patch(USERS.carol.uid, { segments: [SEG1_CORRECTED, SEG2, { ...SEG2, id: 'seg-3' }] }),
      ),
    );
  });

  it('een gewijzigd segment-id wordt geweigerd', async () => {
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol)),
        patch(USERS.carol.uid, { segments: [{ ...SEG1_CORRECTED, id: 'seg-x' }, SEG2] }),
      ),
    );
  });

  it('een inconsistente eindscore (scoreFor wijkt af van oud + delta pf) wordt geweigerd', async () => {
    await assertFails(updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid, { scoreFor: 99 })));
    await assertFails(updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid, { scoreAgainst: 7 })));
  });

  it('een durSec die niet bij begin/eind past, of <= 0 is, wordt geweigerd', async () => {
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol)),
        patch(USERS.carol.uid, { segments: [{ ...SEG1_CORRECTED, durSec: 999 }, SEG2] }),
      ),
    );
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol)),
        patch(USERS.carol.uid, {
          segments: [{ ...SEG1_CORRECTED, endSec: 600, durSec: 0 }, SEG2],
          corrections: arrayUnion(entry(USERS.carol.uid, { after: { ...AFTER1, endSec: 600 } })),
        }),
      ),
    );
  });

  it('waarden buiten bereik (kwart > quarterCount, negatieve pf, tov < 0) worden geweigerd', async () => {
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol)),
        patch(USERS.carol.uid, {
          segments: [{ ...SEG1_CORRECTED, quarter: 9 }, SEG2],
          corrections: arrayUnion(entry(USERS.carol.uid, { after: { ...AFTER1, quarter: 9 } })),
        }),
      ),
    );
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol)),
        patch(USERS.carol.uid, {
          segments: [{ ...SEG1_CORRECTED, pf: 151 }, SEG2],
          scoreFor: 157,
          corrections: arrayUnion(entry(USERS.carol.uid, { after: { ...AFTER1, pf: 151 } })),
        }),
      ),
    );
    await assertFails(
      updateDoc(
        ref(ctx(USERS.carol)),
        patch(USERS.carol.uid, {
          segments: [{ ...SEG1_CORRECTED, tov: -1 }, SEG2],
          corrections: arrayUnion(entry(USERS.carol.uid, { after: { ...AFTER1, tov: -1 } })),
        }),
      ),
    );
  });
});

describe('correctie: bestaande takken blijven werken', () => {
  it('de tombstone-patch werkt nog (ook op een eerder gecorrigeerd document)', async () => {
    const db = ctx(USERS.carol);
    await assertSucceeds(updateDoc(ref(db), patch(USERS.carol.uid)));
    await assertSucceeds(
      updateDoc(ref(db), { deletedAt: serverTimestamp(), deletedBy: USERS.carol.uid, revision: 2 }),
    );
  });

  it('een tombstone-patch mag de correctievelden niet meesturen', async () => {
    await assertFails(
      updateDoc(ref(ctx(USERS.carol)), {
        deletedAt: serverTimestamp(),
        deletedBy: USERS.carol.uid,
        revision: 1,
        corrections: arrayUnion(entry(USERS.carol.uid)),
      }),
    );
  });

  it('een create met correctievelden blijft geweigerd (create-only payload ongewijzigd)', async () => {
    // Zonder de finalize-batch faalt elke create al; dit bewijst bovendien dat
    // de uitgebreide sleutelset niet in de create-validatie is geslopen.
    const db = ctx(USERS.dave);
    await assertFails(
      setDoc(ref(db, 'completed-new'), baseGame({ corrections: [entry(USERS.dave.uid)], correctedAt: Timestamp.now() })),
    );
  });
});

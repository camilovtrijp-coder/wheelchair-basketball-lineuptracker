// PR 7.7c (docs/pr-7.7-plan.md §C.4, firestore.rules punt 22) — de LINEUP-correctie
// van een segment van een afgeronde wedstrijd, bovenop de 7.5c-correctietak
// (completed-games-correction.spec.ts). Bewijst positief (owner/admin/coach) en
// negatief (viewer/scorer/niet-lid/andere organisatie; 4 of dubbele spelers; speler
// die niet in `players` staat of niet meedeed; lineup alleen in before óf after;
// niet-passend segment; ander segment gewijzigd; log met 2 nieuwe items) en dat de
// oude scalaire correctie ongewijzigd blijft slagen. De payload spiegelt
// `projectCompletedGameCorrection()` (v2): `lineup`/`allowed` in before én after
// plus het cloud-only `lineupPlayerIndexes` (positie van elke speler in `players`).
// Fictieve data; geen echte spelers of credentials.

import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { arrayUnion, doc, getDoc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createTestEnv, assertSucceeds, assertFails, authCtx, withAdmin } from './helpers/testEnv.js';
import { ORG_A, ORG_B, TEAM_A1, TEAM_A2, TEAM_B1, USERS, sampleCompletedGame } from './helpers/fixtures.js';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});

// Spelers gp-1..gp-8 (index 0..7): gp-6 klasse 2.0, gp-7 deed NIET mee, gp-9 staat er niet in.
function players() {
  return Array.from({ length: 8 }, (_, i) => ({
    id: `gp-${i + 1}`,
    rosterId: i + 1,
    nr: String(i + 1),
    naam: `Fictief Speler ${i + 1}`,
    kl: i === 5 ? '2.0' : '3.0',
    vrouw: i === 5,
    jeugd: false,
    participate: i !== 6,
    start: i < 5,
  }));
}

const L_OLD = ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5'];
const L_NEW = ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-6'];
const IX_NEW = [0, 1, 2, 3, 5];

const SEG1 = {
  id: 'seg-1',
  quarter: 1,
  beginSec: 600,
  endSec: 480,
  durSec: 120,
  lineup: L_OLD,
  pf: 4,
  pa: 2,
  classSum: 15,
  allowed: 14.5,
  over: true,
};
const SEG2 = {
  id: 'seg-2',
  quarter: 1,
  beginSec: 480,
  endSec: 300,
  durSec: 180,
  lineup: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-8'],
  pf: 6,
  pa: 4,
  classSum: 15,
  allowed: 14.5,
  over: true,
  tov: 1,
};

/** Seg-1 na wissel gp-5 -> gp-6: som 12 + 2 = 14, toegestaan 15.5 (bonus 1.0), niet over. */
const SEG1_NEW = { ...SEG1, lineup: L_NEW, classSum: 14, allowed: 15.5, over: false };

function baseGame(overrides: Record<string, unknown> = {}) {
  return sampleCompletedGame({
    players: players(),
    segments: [SEG1, SEG2],
    scoreFor: 10,
    scoreAgainst: 6,
    ...overrides,
  });
}

const BASE1 = { quarter: 1, beginSec: 600, endSec: 480, pf: 4, pa: 2, tov: 0 };

function entry(uid: string | null, overrides: Record<string, unknown> = {}) {
  return {
    id: 'corr-l1',
    segmentId: 'seg-1',
    segmentIndex: 0,
    at: '2026-02-01T10:00:00.000Z',
    by: uid,
    before: { ...BASE1, lineup: L_OLD, allowed: 14.5 },
    after: { ...BASE1, lineup: L_NEW, allowed: 15.5 },
    lineupPlayerIndexes: IX_NEW,
    ...overrides,
  };
}

/** Geldige lineupcorrectie van `baseGame()` (alleen de lineup wijzigt). */
function patch(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    segments: [SEG1_NEW, SEG2],
    scoreFor: 10,
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

describe('lineupcorrectie: toegestaan (positief)', () => {
  it('owner mag de lineup van een segment corrigeren (alleen lineup/classSum/allowed/over wijzigen)', async () => {
    const db = ctx(USERS.alice);
    await assertSucceeds(updateDoc(ref(db), patch(USERS.alice.uid)));
    const data = (await getDoc(ref(db))).data()!;
    expect(data.revision).toBe(1);
    expect(data.segments[0]).toEqual(SEG1_NEW);
    expect(data.segments[1]).toEqual(SEG2);
    expect(data.scoreFor).toBe(10);
    expect(data.corrections).toEqual([entry(USERS.alice.uid)]);
    expect(data.correctedAt).toBeInstanceOf(Timestamp);
    expect(data.players).toEqual(players());
  });

  it('admin (organizationAdmin) mag de lineup corrigeren', async () => {
    await assertSucceeds(updateDoc(ref(ctx(USERS.bob)), patch(USERS.bob.uid)));
  });

  it('coach mag de lineup corrigeren', async () => {
    await assertSucceeds(updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid)));
  });

  it('een lokale lineupcorrectie zonder account (by: null) mag worden geüpload', async () => {
    await assertSucceeds(
      updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid, { corrections: arrayUnion(entry(null)) })),
    );
  });

  it('lineup en tijd/score/turnovers tegelijk in één correctie', async () => {
    // eind 480 -> 420 (duur 180), pf 4 -> 7, tov 0 -> 2, plus wissel gp-5 -> gp-6.
    const seg = { ...SEG1_NEW, endSec: 420, durSec: 180, pf: 7, tov: 2 };
    const item = entry(USERS.carol.uid, {
      before: { ...BASE1, lineup: L_OLD, allowed: 14.5 },
      after: { quarter: 1, beginSec: 600, endSec: 420, pf: 7, pa: 2, tov: 2, lineup: L_NEW, allowed: 15.5 },
    });
    await assertSucceeds(
      updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid, {
        segments: [seg, SEG2],
        scoreFor: 13,
        corrections: arrayUnion(item),
      })),
    );
  });

  it('een speler die al in de oude lineup stond mag blijven, ook als hij niet `participate` is (gp-7)', async () => {
    const oldLineup = ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-7'];
    const seg1 = { ...SEG1, lineup: oldLineup };
    await seed('completed-np', baseGame({ segments: [seg1, SEG2] }));
    // gp-5 komt erbij, gp-7 blijft vervangen? Nee: gp-7 blijft staan, gp-4 -> gp-5.
    const newLineup = ['gp-1', 'gp-2', 'gp-3', 'gp-5', 'gp-7'];
    const item = entry(USERS.carol.uid, {
      before: { ...BASE1, lineup: oldLineup, allowed: 14.5 },
      after: { ...BASE1, lineup: newLineup, allowed: 14.5 },
      lineupPlayerIndexes: [0, 1, 2, 4, 6],
    });
    await assertSucceeds(
      updateDoc(ref(ctx(USERS.carol), 'completed-np'), patch(USERS.carol.uid, {
        segments: [{ ...seg1, lineup: newLineup }, SEG2],
        corrections: arrayUnion(item),
      })),
    );
  });

  it('worst case: alle 5 spelers vervangen door nieuwe deelnemers, door een coach, binnen de Rules-limiet', async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({
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
    await seed('completed-all-new', baseGame({ players: twelve }));
    const allNew = ['gp-6', 'gp-8', 'gp-9', 'gp-10', 'gp-12'];
    const item = entry(USERS.carol.uid, {
      after: { ...BASE1, lineup: allNew, allowed: 15.5 },
      lineupPlayerIndexes: [5, 7, 8, 9, 11],
    });
    await assertSucceeds(
      updateDoc(ref(ctx(USERS.carol), 'completed-all-new'), patch(USERS.carol.uid, {
        segments: [{ ...SEG1_NEW, lineup: allNew }, SEG2],
        corrections: arrayUnion(item),
      })),
    );
  });

  it('zonder klassegrens (useClassLimit false) blijft classSum 0', async () => {
    const seg1 = { ...SEG1, classSum: 0, allowed: 0, over: false };
    await seed('completed-nolimit', baseGame({ useClassLimit: false, segments: [seg1, SEG2] }));
    const item = entry(USERS.carol.uid, {
      before: { ...BASE1, lineup: L_OLD, allowed: 0 },
      after: { ...BASE1, lineup: L_NEW, allowed: 0 },
    });
    await assertSucceeds(
      updateDoc(ref(ctx(USERS.carol), 'completed-nolimit'), patch(USERS.carol.uid, {
        segments: [{ ...seg1, lineup: L_NEW }, SEG2],
        corrections: arrayUnion(item),
      })),
    );
  });

  it('een tweede (lineup)correctie op een ander segment achter een eerste scalaire correctie (revisie 1 -> 2)', async () => {
    const db = ctx(USERS.carol);
    await assertSucceeds(updateDoc(ref(db), patch(USERS.carol.uid)));
    // seg-2 index 1: gp-8 -> gp-5. Klasse 3.0 + 3.0 + 3.0 + 3.0 + 3.0 = 15, toegestaan 14.5, over blijft true.
    const newLineup = ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5'];
    const second = {
      id: 'corr-l2',
      segmentId: 'seg-2',
      segmentIndex: 1,
      at: '2026-02-02T10:00:00.000Z',
      by: USERS.carol.uid,
      before: { quarter: 1, beginSec: 480, endSec: 300, pf: 6, pa: 4, tov: 1, lineup: SEG2.lineup, allowed: 14.5 },
      after: { quarter: 1, beginSec: 480, endSec: 300, pf: 6, pa: 4, tov: 1, lineup: newLineup, allowed: 14.5 },
      lineupPlayerIndexes: [0, 1, 2, 3, 4],
    };
    await assertSucceeds(
      updateDoc(ref(db), {
        segments: [SEG1_NEW, { ...SEG2, lineup: newLineup }],
        scoreFor: 10,
        scoreAgainst: 6,
        corrections: arrayUnion(second),
        correctedAt: serverTimestamp(),
        revision: 2,
      }),
    );
    const data = (await getDoc(ref(db))).data()!;
    expect(data.corrections.map((c: { id: string }) => c.id)).toEqual(['corr-l1', 'corr-l2']);
  });

  it('oude scalaire correctie (geen lineup in het logitem) blijft slagen', async () => {
    const item = {
      id: 'corr-old',
      segmentId: 'seg-1',
      segmentIndex: 0,
      at: '2026-02-01T10:00:00.000Z',
      by: USERS.carol.uid,
      before: BASE1,
      after: { quarter: 1, beginSec: 600, endSec: 420, pf: 7, pa: 2, tov: 2 },
    };
    await assertSucceeds(
      updateDoc(ref(ctx(USERS.carol)), {
        segments: [{ ...SEG1, endSec: 420, durSec: 180, pf: 7, tov: 2 }, SEG2],
        scoreFor: 13,
        scoreAgainst: 6,
        corrections: arrayUnion(item),
        correctedAt: serverTimestamp(),
        revision: 1,
      }),
    );
  });

  it('werkt binnen de Rules-limiet van 1000 expressies op een groot document (15 spelers, 80 segmenten, 40 eerdere correcties)', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
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
    const segments = Array.from({ length: 80 }, (_, i) => ({ ...SEG1, id: `seg-${i + 1}` }));
    const log = Array.from({ length: 40 }, (_, i) => ({
      id: `old-${i}`,
      segmentId: 'seg-1',
      segmentIndex: 0,
      at: '2026-02-01T10:00:00.000Z',
      by: USERS.carol.uid,
      before: { ...BASE1, lineup: L_OLD, allowed: 14.5 },
      after: { ...BASE1, lineup: L_OLD, allowed: 14.5 },
      lineupPlayerIndexes: [0, 1, 2, 3, 4],
    }));
    await seed(
      'completed-big',
      baseGame({ players: many, segments, scoreFor: 320, scoreAgainst: 160, corrections: log, correctedAt: Timestamp.now(), revision: 40 }),
    );
    // Wissel in segment 40 (index 39): gp-5 -> gp-15 (laatste speler in de lijst).
    const newLineup = ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-15'];
    const item = entry(USERS.carol.uid, {
      id: 'corr-big',
      segmentId: 'seg-40',
      segmentIndex: 39,
      after: { ...BASE1, lineup: newLineup, allowed: 14.5 },
      before: { ...BASE1, lineup: L_OLD, allowed: 14.5 },
      lineupPlayerIndexes: [0, 1, 2, 3, 14],
    });
    await assertSucceeds(
      updateDoc(ref(ctx(USERS.carol), 'completed-big'), {
        segments: segments.map((seg, i) => (i === 39 ? { ...seg, lineup: newLineup, classSum: 15, allowed: 14.5, over: true } : seg)),
        scoreFor: 320,
        scoreAgainst: 160,
        corrections: arrayUnion(item),
        correctedAt: serverTimestamp(),
        revision: 41,
      }),
    );
  });
});

describe('lineupcorrectie: bevoegdheid (negatief)', () => {
  it('viewer mag NIET', async () => {
    await assertFails(updateDoc(ref(ctx(USERS.erin)), patch(USERS.erin.uid)));
  });

  it('scorer mag NIET', async () => {
    await assertFails(updateDoc(ref(ctx(USERS.dave)), patch(USERS.dave.uid)));
  });

  it('niet-lid / andere organisatie (owner van org B) mag NIET', async () => {
    await assertFails(updateDoc(ref(ctx(USERS.frank)), patch(USERS.frank.uid)));
  });

  it('coach van team A1 mag NIET een wedstrijd van team A2 corrigeren', async () => {
    await seed('completed-a2', baseGame({ teamId: TEAM_A2 }), ORG_A, TEAM_A2);
    await assertFails(updateDoc(ref(ctx(USERS.carol), 'completed-a2', ORG_A, TEAM_A2), patch(USERS.carol.uid)));
  });

  it('een logitem mag GEEN `by` van een ander lid dragen', async () => {
    await assertFails(
      updateDoc(ref(ctx(USERS.carol)), patch(USERS.carol.uid, { corrections: arrayUnion(entry(USERS.alice.uid)) })),
    );
  });
});

describe('lineupcorrectie: lineup-validatie (negatief)', () => {
  const carol = () => ctx(USERS.carol);
  const withLineup = (newLineup: unknown, extra: Record<string, unknown> = {}) => {
    const item = entry(USERS.carol.uid, {
      after: { ...BASE1, lineup: newLineup, allowed: 15.5 },
      ...extra,
    });
    return patch(USERS.carol.uid, {
      segments: [{ ...SEG1_NEW, lineup: newLineup }, SEG2],
      corrections: arrayUnion(item),
    });
  };

  it('lineup met 4 spelers wordt geweigerd', async () => {
    const four = ['gp-1', 'gp-2', 'gp-3', 'gp-6'];
    await assertFails(updateDoc(ref(carol()), withLineup(four, { lineupPlayerIndexes: [0, 1, 2, 5] })));
  });

  it('lineup met 6 spelers wordt geweigerd', async () => {
    const six = [...L_NEW, 'gp-8'];
    await assertFails(updateDoc(ref(carol()), withLineup(six, { lineupPlayerIndexes: [0, 1, 2, 3, 5, 7] })));
  });

  it('lineup met een dubbele speler wordt geweigerd', async () => {
    const dup = ['gp-1', 'gp-2', 'gp-3', 'gp-6', 'gp-6'];
    await assertFails(updateDoc(ref(carol()), withLineup(dup, { lineupPlayerIndexes: [0, 1, 2, 5, 5] })));
  });

  it('lineup met een niet-string speler-ID wordt geweigerd', async () => {
    const bad = ['gp-1', 'gp-2', 'gp-3', 'gp-4', 6];
    await assertFails(updateDoc(ref(carol()), withLineup(bad)));
  });

  it('een speler die NIET in `players` staat (gp-9) wordt geweigerd', async () => {
    const unknown = ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-9'];
    // index buiten de lijst
    await assertFails(updateDoc(ref(carol()), withLineup(unknown, { lineupPlayerIndexes: [0, 1, 2, 3, 8] })));
    // index die naar een andere speler wijst
    await assertFails(updateDoc(ref(carol()), withLineup(unknown, { lineupPlayerIndexes: [0, 1, 2, 3, 5] })));
  });

  it('een speler die NIET meedeed (gp-7, niet in de oude lineup) wordt geweigerd', async () => {
    const np = ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-7'];
    await assertFails(updateDoc(ref(carol()), withLineup(np, { lineupPlayerIndexes: [0, 1, 2, 3, 6] })));
  });

  it('spelerindexen die niet bij de nieuwe lineup passen worden geweigerd', async () => {
    await assertFails(updateDoc(ref(carol()), withLineup(L_NEW, { lineupPlayerIndexes: [0, 1, 2, 3, 4] })));
    await assertFails(updateDoc(ref(carol()), withLineup(L_NEW, { lineupPlayerIndexes: [0, 1, 2, 3] })));
    await assertFails(updateDoc(ref(carol()), withLineup(L_NEW, { lineupPlayerIndexes: [0, 1, 2, 3, -1] })));
  });

  it('lineupPlayerIndexes ontbreken bij een lineupcorrectie wordt geweigerd', async () => {
    const { lineupPlayerIndexes: _ix, ...noIx } = entry(USERS.carol.uid);
    await assertFails(updateDoc(ref(carol()), patch(USERS.carol.uid, { corrections: arrayUnion(noIx) })));
  });

  it('lineupPlayerIndexes bij een correctie ZONDER lineup wordt geweigerd', async () => {
    const item = {
      id: 'corr-x',
      segmentId: 'seg-1',
      segmentIndex: 0,
      at: '2026-02-01T10:00:00.000Z',
      by: USERS.carol.uid,
      before: BASE1,
      after: { ...BASE1, pf: 7 },
      lineupPlayerIndexes: [0, 1, 2, 3, 4],
    };
    await assertFails(
      updateDoc(ref(carol()), patch(USERS.carol.uid, {
        segments: [{ ...SEG1, pf: 7 }, SEG2],
        scoreFor: 13,
        corrections: arrayUnion(item),
      })),
    );
  });

  it('een "lineupcorrectie" met dezelfde spelers in andere volgorde wordt geweigerd (geen echte wijziging)', async () => {
    const reordered = ['gp-5', 'gp-4', 'gp-3', 'gp-2', 'gp-1'];
    await assertFails(
      updateDoc(ref(carol()), withLineup(reordered, {
        after: { ...BASE1, lineup: reordered, allowed: 14.5 },
        lineupPlayerIndexes: [4, 3, 2, 1, 0],
      })),
    );
  });
});

describe('lineupcorrectie: vorm van before/after (negatief)', () => {
  const carol = () => ctx(USERS.carol);

  it('lineup alleen in `after` wordt geweigerd', async () => {
    const item = entry(USERS.carol.uid, { before: BASE1 });
    await assertFails(updateDoc(ref(carol()), patch(USERS.carol.uid, { corrections: arrayUnion(item) })));
  });

  it('lineup alleen in `before` wordt geweigerd', async () => {
    const item = entry(USERS.carol.uid, { after: BASE1 });
    await assertFails(updateDoc(ref(carol()), patch(USERS.carol.uid, { corrections: arrayUnion(item) })));
  });

  it('`allowed` zonder `lineup` (of omgekeerd) wordt geweigerd', async () => {
    const { lineupPlayerIndexes: _ix, ...onlyAllowed } = entry(USERS.carol.uid, {
      before: { ...BASE1, allowed: 14.5 },
      after: { ...BASE1, allowed: 15.5 },
    });
    await assertFails(updateDoc(ref(carol()), patch(USERS.carol.uid, { corrections: arrayUnion(onlyAllowed) })));
    const onlyLineup = entry(USERS.carol.uid, {
      before: { ...BASE1, lineup: L_OLD },
      after: { ...BASE1, lineup: L_NEW },
    });
    await assertFails(updateDoc(ref(carol()), patch(USERS.carol.uid, { corrections: arrayUnion(onlyLineup) })));
  });

  it('`allowed` niet-numeriek of niet-eindig wordt geweigerd', async () => {
    for (const allowed of ['15.5', Number.NaN, Infinity]) {
      const item = entry(USERS.carol.uid, { after: { ...BASE1, lineup: L_NEW, allowed } });
      await assertFails(
        updateDoc(ref(carol()), patch(USERS.carol.uid, {
          segments: [{ ...SEG1_NEW, allowed }, SEG2],
          corrections: arrayUnion(item),
        })),
      );
    }
  });

  it('`before.lineup` die niet overeenkomt met het oude segment wordt geweigerd', async () => {
    const item = entry(USERS.carol.uid, { before: { ...BASE1, lineup: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-8'], allowed: 14.5 } });
    await assertFails(updateDoc(ref(carol()), patch(USERS.carol.uid, { corrections: arrayUnion(item) })));
  });

  it('`before.allowed` die niet overeenkomt met het oude segment wordt geweigerd', async () => {
    const item = entry(USERS.carol.uid, { before: { ...BASE1, lineup: L_OLD, allowed: 99 } });
    await assertFails(updateDoc(ref(carol()), patch(USERS.carol.uid, { corrections: arrayUnion(item) })));
  });
});

describe('lineupcorrectie: segment, classSum en over (negatief)', () => {
  const carol = () => ctx(USERS.carol);

  it('het nieuwe segment draagt een andere lineup dan `after.lineup` -> geweigerd', async () => {
    await assertFails(
      updateDoc(ref(carol()), patch(USERS.carol.uid, {
        segments: [{ ...SEG1_NEW, lineup: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-8'] }, SEG2],
      })),
    );
  });

  it('het nieuwe segment draagt een andere `allowed` dan `after.allowed` -> geweigerd', async () => {
    await assertFails(
      updateDoc(ref(carol()), patch(USERS.carol.uid, { segments: [{ ...SEG1_NEW, allowed: 16 }, SEG2] })),
    );
  });

  it('het segment blijft ongewijzigd terwijl het logitem een lineupwijziging meldt -> geweigerd', async () => {
    await assertFails(updateDoc(ref(carol()), patch(USERS.carol.uid, { segments: [SEG1, SEG2] })));
  });

  it('`over` is niet consistent met classSum > allowed + 0.001 -> geweigerd', async () => {
    await assertFails(
      updateDoc(ref(carol()), patch(USERS.carol.uid, { segments: [{ ...SEG1_NEW, over: true }, SEG2] })),
    );
    // 16 > 15.5: moet over = true zijn
    await assertFails(
      updateDoc(ref(carol()), patch(USERS.carol.uid, { segments: [{ ...SEG1_NEW, classSum: 16, over: false }, SEG2] })),
    );
  });

  it('`classSum` niet numeriek, negatief of absurd groot -> geweigerd', async () => {
    for (const classSum of ['14', -1, 1000]) {
      await assertFails(
        updateDoc(ref(carol()), patch(USERS.carol.uid, { segments: [{ ...SEG1_NEW, classSum }, SEG2] })),
      );
    }
  });

  it('zonder klassegrens mag classSum niet > 0 zijn', async () => {
    const seg1 = { ...SEG1, classSum: 0, allowed: 0, over: false };
    await seed('completed-nolimit', baseGame({ useClassLimit: false, segments: [seg1, SEG2] }));
    const item = entry(USERS.carol.uid, {
      before: { ...BASE1, lineup: L_OLD, allowed: 0 },
      after: { ...BASE1, lineup: L_NEW, allowed: 0 },
    });
    await assertFails(
      updateDoc(ref(carol(), 'completed-nolimit'), patch(USERS.carol.uid, {
        segments: [{ ...seg1, lineup: L_NEW, classSum: 14, over: true }, SEG2],
        corrections: arrayUnion(item),
      })),
    );
  });

  it('een ander dan het aangewezen segment wijzigt ook (lineup van seg-2) -> geweigerd', async () => {
    await assertFails(
      updateDoc(ref(carol()), patch(USERS.carol.uid, {
        segments: [SEG1_NEW, { ...SEG2, lineup: L_NEW }],
      })),
    );
  });

  it('het nieuwe segment wijzigt ook een niet-toegestane sleutel (id) -> geweigerd', async () => {
    await assertFails(
      updateDoc(ref(carol()), patch(USERS.carol.uid, { segments: [{ ...SEG1_NEW, id: 'seg-x' }, SEG2] })),
    );
  });

  it('zonder lineup in het logitem mag het segment de lineup niet wijzigen (oude correctie)', async () => {
    const item = {
      id: 'corr-s',
      segmentId: 'seg-1',
      segmentIndex: 0,
      at: '2026-02-01T10:00:00.000Z',
      by: USERS.carol.uid,
      before: BASE1,
      after: { ...BASE1, pf: 7 },
    };
    await assertFails(
      updateDoc(ref(carol()), patch(USERS.carol.uid, {
        segments: [{ ...SEG1, pf: 7, lineup: L_NEW }, SEG2],
        scoreFor: 13,
        corrections: arrayUnion(item),
      })),
    );
    await assertFails(
      updateDoc(ref(carol()), patch(USERS.carol.uid, {
        segments: [{ ...SEG1, pf: 7, classSum: 14, over: false }, SEG2],
        scoreFor: 13,
        corrections: arrayUnion(item),
      })),
    );
  });

  it('de spelerslijst (`players`) mag in dezelfde write niet wijzigen -> geweigerd', async () => {
    const extra = [...players(), { ...players()[0]!, id: 'gp-9', rosterId: 9 }];
    await assertFails(updateDoc(ref(carol()), patch(USERS.carol.uid, { players: extra })));
  });
});

describe('lineupcorrectie: correctielog en revisie (negatief)', () => {
  const carol = () => ctx(USERS.carol);

  it('een log dat met TWEE nieuwe items groeit wordt geweigerd', async () => {
    const second = entry(USERS.carol.uid, { id: 'corr-l2' });
    await assertFails(
      updateDoc(ref(carol()), patch(USERS.carol.uid, {
        corrections: arrayUnion(entry(USERS.carol.uid), second),
      })),
    );
  });

  it('een bestaand logitem herschrijven (eerste item wijzigt) wordt geweigerd', async () => {
    await assertSucceeds(updateDoc(ref(carol()), patch(USERS.carol.uid)));
    const tampered = {
      segments: [SEG1_NEW, SEG2],
      scoreFor: 10,
      scoreAgainst: 6,
      corrections: [{ ...entry(USERS.carol.uid), at: '2026-03-01T10:00:00.000Z' }, entry(USERS.carol.uid, { id: 'corr-l2' })],
      correctedAt: serverTimestamp(),
      revision: 2,
    };
    await assertFails(updateDoc(ref(carol()), tampered));
  });

  it('revisie niet +1 wordt geweigerd', async () => {
    await assertFails(updateDoc(ref(carol()), patch(USERS.carol.uid, { revision: 2 })));
    await assertFails(updateDoc(ref(carol()), patch(USERS.carol.uid, { revision: 0 })));
  });

  it('een getombstoned document mag niet meer gecorrigeerd worden', async () => {
    await seed('completed-dead', baseGame({ deletedAt: Timestamp.now(), deletedBy: USERS.alice.uid, revision: 1 }));
    await assertFails(
      updateDoc(ref(carol(), 'completed-dead'), patch(USERS.carol.uid, { revision: 2 })),
    );
  });

  it('een logitem met een onbekende extra sleutel wordt geweigerd', async () => {
    const item = { ...entry(USERS.carol.uid), extra: 1 };
    await assertFails(updateDoc(ref(carol()), patch(USERS.carol.uid, { corrections: arrayUnion(item) })));
  });
});

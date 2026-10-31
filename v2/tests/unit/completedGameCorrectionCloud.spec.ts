// PR 7.5c: puur datawerk rond cloudcorrecties — lineage/merge-keuze, projectie
// naar de cloudpayload en het terugprojecteren van een gelezen document.
import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { CompletedGameDocument } from 'firebase-base/documents';
import {
  compareCorrectionLineage,
  pickHigherRevision,
  revisionOf,
} from '../../src/domain/game/correctionLineage';
import { correctSegment } from '../../src/domain/game/correction';
import type { CompletedGame, Segment } from '../../src/domain/game/types';
import {
  projectCompletedGameCorrection,
  projectCompletedGameSnapshot,
} from '../../src/application/game/projectCompletedGameForCloud';
import { completedGameFromDocument } from '../../src/infrastructure/game/FirestoreCompletedGameRepository';

function seg(overrides: Partial<Segment>): Segment {
  return {
    id: 's1',
    quarter: 1,
    beginSec: 600,
    endSec: 420,
    durSec: 180,
    lineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
    pf: 6,
    pa: 4,
    classSum: 15,
    allowed: 14.5,
    over: true,
    tov: 2,
    ...overrides,
  };
}

function base(overrides: Partial<CompletedGame> = {}): CompletedGame {
  return {
    id: 'cg-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: 'src-1',
    opponent: 'Fictief Team',
    competition: '',
    date: '2026-01-01T10:00:00.000Z',
    players: [],
    segments: [
      seg({ id: 's1' }),
      seg({ id: 's2', beginSec: 420, endSec: 180, durSec: 240, pf: 8, pa: 6, tov: 1 }),
    ],
    scoreFor: 14,
    scoreAgainst: 10,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: true,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

function correct(game: CompletedGame, id: string, segmentId: string, patch: object): CompletedGame {
  const r = correctSegment(game, segmentId, patch, 'uid-1', {
    id,
    now: new Date('2026-02-02T09:00:00.000Z'),
  });
  if (!r.ok) throw new Error(r.error);
  return r.game;
}

describe('compareCorrectionLineage / pickHigherRevision', () => {
  const c1 = correct(base(), 'a', 's1', { pf: 9 });
  const c2 = correct(c1, 'b', 's2', { pa: 7 });
  const other = correct(base(), 'x', 's1', { pf: 10 });

  it('same: beide ongecorrigeerd, of hetzelfde log', () => {
    expect(compareCorrectionLineage(base(), base())).toBe('same');
    expect(compareCorrectionLineage(c1, c1)).toBe('same');
  });
  it('local-ahead / cloud-ahead: het ene log is een voorvoegsel van het andere', () => {
    expect(compareCorrectionLineage(c2, c1)).toBe('local-ahead');
    expect(compareCorrectionLineage(c1, base())).toBe('local-ahead');
    expect(compareCorrectionLineage(c1, c2)).toBe('cloud-ahead');
    expect(compareCorrectionLineage(base(), c1)).toBe('cloud-ahead');
  });
  it('diverged: verschillende correcties, ook bij gelijke revisie', () => {
    expect(compareCorrectionLineage(c1, other)).toBe('diverged');
    expect(compareCorrectionLineage(c2, other)).toBe('diverged');
    expect(compareCorrectionLineage(other, c2)).toBe('diverged');
  });
  it('een log-voorvoegsel zonder hogere revisie telt als diverged (inconsistente data, niet gokken)', () => {
    expect(compareCorrectionLineage({ ...c1, revision: 0 }, base())).toBe('diverged');
  });
  it('revisionOf behandelt ontbrekende/ongeldige revisie als 0', () => {
    expect(revisionOf({ ...base(), revision: undefined as unknown as number })).toBe(0);
    expect(revisionOf(c2)).toBe(2);
  });
  it('pickHigherRevision: hogere wint, gelijk = lokaal', () => {
    expect(pickHigherRevision(base(), c1)).toBe(c1);
    expect(pickHigherRevision(c1, base())).toBe(c1);
    const l = base({ opponent: 'L' });
    const c = base({ opponent: 'C' });
    expect(pickHigherRevision(l, c)).toBe(l);
  });
});

describe('projectCompletedGameCorrection', () => {
  it('projecteert de uitkomst van een correctie met segmentIndex en zonder extra velden', () => {
    const game = correct(base(), 'corr-1', 's2', { pa: 7, tov: 0 });
    const correction = game.corrections![0]!;
    const payload = projectCompletedGameCorrection(game, correction)!;
    expect(payload.scoreFor).toBe(14);
    expect(payload.scoreAgainst).toBe(11);
    expect(payload.correction).toEqual({
      id: 'corr-1',
      segmentId: 's2',
      segmentIndex: 1,
      at: '2026-02-02T09:00:00.000Z',
      by: 'uid-1',
      before: { quarter: 1, beginSec: 420, endSec: 180, pf: 8, pa: 6, tov: 1 },
      after: { quarter: 1, beginSec: 420, endSec: 180, pf: 8, pa: 7, tov: 0 },
    });
    // tov 0 → sleutel weggelaten, zoals bij finalize (projectSegment).
    expect(payload.segments[1]).not.toHaveProperty('tov');
    expect(payload.segments[0]).toMatchObject({ id: 's1', tov: 2 });
    expect(Object.keys(payload).sort()).toEqual([
      'correction',
      'scoreAgainst',
      'scoreFor',
      'segments',
    ]);
  });

  it('geeft null bij een onbekend segmentId (niets veilig te versturen)', () => {
    const game = correct(base(), 'corr-1', 's1', { pf: 9 });
    expect(
      projectCompletedGameCorrection(game, { ...game.corrections![0]!, segmentId: 'nope' }),
    ).toBeNull();
  });

  it('muteert de invoer niet', () => {
    const game = correct(base(), 'corr-1', 's1', { pf: 9 });
    const snapshot = JSON.parse(JSON.stringify(game)) as unknown;
    projectCompletedGameCorrection(game, game.corrections![0]!);
    expect(game).toEqual(snapshot);
  });

  it('create-payload (projectCompletedGameSnapshot) blijft ongewijzigd: geen correctievelden, revision 0', () => {
    const corrected = correct(base(), 'corr-1', 's1', { pf: 9 });
    const projection = projectCompletedGameSnapshot(corrected);
    expect(projection).not.toHaveProperty('corrections');
    expect(projection).not.toHaveProperty('correctedAt');
    expect(projection.revision).toBe(0);
  });
});

describe('completedGameFromDocument — correctievelden', () => {
  const doc: CompletedGameDocument = {
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: 'src-1',
    opponent: 'Fictief Team',
    competition: '',
    date: '2026-01-01T10:00:00.000Z',
    players: [],
    segments: [],
    scoreFor: 0,
    scoreAgainst: 0,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: true,
    syncedAt: Timestamp.now(),
    revision: 0,
    deletedAt: null,
    deletedBy: null,
  };

  it('ongecorrigeerd document: geen corrections/correctedAt-sleutels in de domeinvorm', () => {
    const game = completedGameFromDocument('cg-1', doc);
    expect(game).not.toHaveProperty('corrections');
    expect(game).not.toHaveProperty('correctedAt');
  });

  it('gecorrigeerd document: logitems zonder cloud-only segmentIndex, correctedAt als ISO-string', () => {
    const game = completedGameFromDocument('cg-1', {
      ...doc,
      revision: 1,
      corrections: [
        {
          id: 'corr-1',
          segmentId: 's1',
          segmentIndex: 0,
          at: '2026-02-02T09:00:00.000Z',
          by: null,
          before: { quarter: 1, beginSec: 600, endSec: 420, pf: 6, pa: 4, tov: 2 },
          after: { quarter: 1, beginSec: 600, endSec: 300, pf: 9, pa: 4, tov: 3 },
        },
      ],
      correctedAt: Timestamp.fromDate(new Date('2026-02-02T09:00:01.000Z')),
    });
    expect(game.revision).toBe(1);
    expect(game.correctedAt).toBe('2026-02-02T09:00:01.000Z');
    expect(game.corrections).toEqual([
      {
        id: 'corr-1',
        segmentId: 's1',
        at: '2026-02-02T09:00:00.000Z',
        by: null,
        before: { quarter: 1, beginSec: 600, endSec: 420, pf: 6, pa: 4, tov: 2 },
        after: { quarter: 1, beginSec: 600, endSec: 300, pf: 9, pa: 4, tov: 3 },
      },
    ]);
    expect(game.corrections![0]).not.toHaveProperty('segmentIndex');
  });
});

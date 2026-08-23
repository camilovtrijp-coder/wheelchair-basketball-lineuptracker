// PR 7.3b (docs/pr-7.3-plan.md §C 7.3b werk 2/5): bewijst dat een read-only
// viewer, die cloud-action-envelopes via een Firestore-listener ontvangt
// (mogelijk laat, uit volgorde, of met een gedupliceerde retry), exact
// dezelfde score-/segmenthistorie afleidt als de lokale writer uit zijn eigen
// `ActiveGame.actions`-array (`domain/game/tracking.ts` `deriveGameHistory()`).
import { describe, it, expect } from 'vitest';
import {
  deriveCloudGameHistory,
  sortCloudActions,
  type CloudGameActionEnvelope,
} from '../../src/domain/game/deriveGameStateFromCloud';
import { deriveGameHistory } from '../../src/domain/game/tracking';
import type { ActiveGame, GameAction, Segment } from '../../src/domain/game/types';

function segment(id: string, over: Partial<Segment> = {}): Segment {
  return {
    id,
    quarter: 1,
    beginSec: 600,
    endSec: 480,
    durSec: 120,
    lineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
    pf: 4,
    pa: 2,
    classSum: 10,
    allowed: 14,
    over: false,
    ...over,
  };
}

/** Bouwt een cloud-envelope uit een lokale `GameAction`, `sequence` == de
 * positie in de array — spiegelt exact `projectGameForCloud.ts`
 * `projectGameActions()`. */
function envelope(action: GameAction, sequence: number): CloudGameActionEnvelope {
  const actionId = action.id;
  const occurredAt = action.at;
  switch (action.type) {
    case 'score-delta':
      return {
        actionId,
        sequence,
        occurredAt,
        action: { type: 'score-delta', team: action.team, delta: action.delta },
      };
    case 'score-set':
      return {
        actionId,
        sequence,
        occurredAt,
        action: { type: 'score-set', team: action.team, value: action.value },
      };
    case 'segment-saved':
      return {
        actionId,
        sequence,
        occurredAt,
        action: { type: 'segment-saved', segment: action.segment },
      };
    case 'segment-edited':
      return {
        actionId,
        sequence,
        occurredAt,
        action: {
          type: 'segment-edited',
          segmentId: action.segmentId,
          segment: action.segment,
        },
      };
    case 'segment-deleted':
      return {
        actionId,
        sequence,
        occurredAt,
        action: { type: 'segment-deleted', segmentId: action.segmentId },
      };
  }
}

const ACTIONS: GameAction[] = [
  { type: 'score-delta', id: 'a1', team: 'for', delta: 2, at: '2026-01-01T10:00:00.000Z' },
  { type: 'score-delta', id: 'a2', team: 'against', delta: 1, at: '2026-01-01T10:00:05.000Z' },
  { type: 'segment-saved', id: 'a3', segment: segment('seg-1'), at: '2026-01-01T10:05:00.000Z' },
  { type: 'score-delta', id: 'a4', team: 'for', delta: 3, at: '2026-01-01T10:06:00.000Z' },
  {
    type: 'segment-edited',
    id: 'a5',
    segmentId: 'seg-1',
    segment: segment('seg-1', { pf: 6 }),
    at: '2026-01-01T10:07:00.000Z',
  },
];

describe('domain/game/deriveGameStateFromCloud (PR 7.3b)', () => {
  it('levert bij in-volgorde envelopes dezelfde historie op als de lokale reducer', () => {
    const envelopes = ACTIONS.map(envelope);
    const local = deriveGameHistory({ actions: ACTIONS } as ActiveGame);
    const cloud = deriveCloudGameHistory(envelopes);
    expect(cloud).toEqual(local);
  });

  it('sorteert uit-volgorde/laat-afgeleverde envelopes correct op sequence', () => {
    const envelopes = ACTIONS.map(envelope);
    const shuffled = [envelopes[3]!, envelopes[0]!, envelopes[4]!, envelopes[1]!, envelopes[2]!];
    const local = deriveGameHistory({ actions: ACTIONS } as ActiveGame);
    expect(deriveCloudGameHistory(shuffled)).toEqual(local);
  });

  it('dedupliceert een gedupliceerde retry (zelfde actionId tweemaal in de snapshot) zonder de historie te dubbelen', () => {
    const envelopes = ACTIONS.map(envelope);
    const withDuplicate = [...envelopes, envelopes[0]!];
    const local = deriveGameHistory({ actions: ACTIONS } as ActiveGame);
    expect(deriveCloudGameHistory(withDuplicate)).toEqual(local);
  });

  it('sortCloudActions is stabiel en idempotent bij een reeds gesorteerde lijst', () => {
    const envelopes = ACTIONS.map(envelope);
    expect(sortCloudActions(envelopes)).toEqual(envelopes);
    expect(sortCloudActions(sortCloudActions(envelopes))).toEqual(sortCloudActions(envelopes));
  });

  it('levert de lege historie op zonder acties', () => {
    expect(deriveCloudGameHistory([])).toEqual(
      deriveGameHistory({ actions: [] } as unknown as ActiveGame),
    );
  });

  it('herberekent scoreStartFor/Against correct na een segment-deleted, ongeacht leveringsvolgorde', () => {
    const withDelete: GameAction[] = [
      ...ACTIONS,
      { type: 'segment-deleted', id: 'a6', segmentId: 'seg-1', at: '2026-01-01T10:08:00.000Z' },
    ];
    const envelopes = withDelete.map(envelope);
    const shuffled = [...envelopes].reverse();
    const local = deriveGameHistory({ actions: withDelete } as ActiveGame);
    expect(deriveCloudGameHistory(shuffled)).toEqual(local);
  });
});

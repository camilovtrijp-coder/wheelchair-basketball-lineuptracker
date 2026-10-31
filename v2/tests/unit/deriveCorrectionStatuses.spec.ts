import { describe, it, expect } from 'vitest';
import {
  deriveCorrectionStatuses,
  sameCorrectionStatuses,
} from '../../src/application/game/deriveCorrectionStatuses';
import type { CompletedGame } from '../../src/domain/game/types';

function g(id: string, corrected: boolean): CompletedGame {
  return {
    id,
    organizationId: 'o',
    teamId: 't',
    sourceGameId: `s-${id}`,
    opponent: 'Fictief Team',
    competition: '',
    date: '2026-01-01T10:00:00.000Z',
    players: [],
    segments: [],
    scoreFor: 0,
    scoreAgainst: 0,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
    ...(corrected
      ? {
          corrections: [
            {
              id: `c-${id}`,
              at: '2026-01-02T10:00:00.000Z',
              by: null,
              segmentId: 'x',
              before: { quarter: 1, beginSec: 1, endSec: 0, pf: 0, pa: 0, tov: 0 },
              after: { quarter: 1, beginSec: 1, endSec: 0, pf: 1, pa: 0, tov: 0 },
            },
          ],
        }
      : {}),
  };
}

describe('application/game/deriveCorrectionStatuses (PR 7.6a)', () => {
  it('lokale modus (geen correctionSyncStatus): lege map', () => {
    expect(deriveCorrectionStatuses({}, [g('a', true)])).toEqual({});
  });

  it('bevraagt alleen gecorrigeerde wedstrijden en laat null weg', () => {
    const asked: string[] = [];
    const repo = {
      correctionSyncStatus(id: string) {
        asked.push(id);
        return id === 'b' ? null : ('conflict' as const);
      },
    };
    const out = deriveCorrectionStatuses(repo, [g('a', true), g('b', true), g('c', false)]);
    expect(out).toEqual({ a: 'conflict' });
    expect(asked).toEqual(['a', 'b']);
  });

  it('sameCorrectionStatuses vergelijkt inhoud', () => {
    expect(sameCorrectionStatuses({ a: 'conflict' }, { a: 'conflict' })).toBe(true);
    expect(sameCorrectionStatuses({ a: 'conflict' }, { a: 'actie-nodig' })).toBe(false);
    expect(sameCorrectionStatuses({ a: 'conflict' }, {})).toBe(false);
  });
});

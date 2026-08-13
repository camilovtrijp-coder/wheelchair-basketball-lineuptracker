import { describe, it, expect } from 'vitest';
import type { ActiveGame, GamePlayer } from '../../src/domain/game/types';
import { MAX_CLOCK_SECONDS } from '../../src/domain/game/types';
import {
  buildSegment,
  scoreDeltaAction,
  segmentSavedAction,
  type ClassificationConfig,
} from '../../src/domain/game/tracking';
import { canFinishGame, finishGame } from '../../src/domain/game/finish';

function player(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    id: 'p1',
    rosterId: 1,
    nr: '1',
    naam: 'Speler',
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: false,
    ...overrides,
  };
}

function game(overrides: Partial<ActiveGame> = {}): ActiveGame {
  return {
    id: 'game-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players: [player()],
    opponent: 'Tegenstander X',
    competition: 'Competitie Y',
    clockDown: true,
    limitStr: '14.5',
    onCourt: ['p1'],
    curQuarter: 1,
    beginSec: MAX_CLOCK_SECONDS,
    endSec: MAX_CLOCK_SECONDS,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:05:00.000Z',
    ...overrides,
  };
}

const noClass: ClassificationConfig = {
  useClassLimit: false,
  classBaseLimit: 14.5,
  maxBonus: 0,
  bonusTag1Only: 0,
  bonusTag2Only: 0,
  bonusBoth: 0,
};

const settings = { quarterCount: 4, periodLabel: 'Kwart', useClassLimit: false };

describe('canFinishGame', () => {
  it('is false zonder segmenten (v1-guard: state.segments.length === 0)', () => {
    expect(canFinishGame(game())).toBe(false);
  });

  it('is true zodra er minstens één afgeleid segment is', () => {
    const seg = buildSegment(game(), 1, MAX_CLOCK_SECONDS, 420, ['p1'], 2, 0, noClass);
    const withSegment = game({ actions: [segmentSavedAction(seg)] });
    expect(canFinishGame(withSegment)).toBe(true);
  });
});

describe('finishGame', () => {
  it('geeft null terug wanneer nog niet afgerond mag worden', () => {
    expect(finishGame(game(), settings)).toBeNull();
  });

  it('bevriest de deriveGameHistory-uitkomst en de meegegeven instellingen', () => {
    const seg = buildSegment(game(), 1, MAX_CLOCK_SECONDS, 420, ['p1'], 3, 1, noClass);
    const withSegment = game({
      actions: [
        scoreDeltaAction('for', 3),
        scoreDeltaAction('against', 1),
        segmentSavedAction(seg),
      ],
    });

    const completed = finishGame(withSegment, {
      quarterCount: 2,
      periodLabel: 'Helft',
      useClassLimit: true,
    });

    expect(completed).not.toBeNull();
    expect(completed).toMatchObject({
      organizationId: 'org-1',
      teamId: 'team-1',
      opponent: 'Tegenstander X',
      competition: 'Competitie Y',
      scoreFor: 3,
      scoreAgainst: 1,
      quarterCount: 2,
      periodLabel: 'Helft',
      useClassLimit: true,
    });
    expect(completed?.segments).toHaveLength(1);
    expect(completed?.players).toEqual(withSegment.players);
    expect(typeof completed?.id).toBe('string');
    expect(completed?.id).not.toBe(withSegment.id);
    expect(() => new Date(completed!.date).toISOString()).not.toThrow();
  });

  it('kopieert de spelerssnapshot los van de bron (geen gedeelde referentie)', () => {
    const seg = buildSegment(game(), 1, MAX_CLOCK_SECONDS, 420, ['p1'], 1, 0, noClass);
    const source = game({ actions: [segmentSavedAction(seg)] });
    const completed = finishGame(source, settings);
    expect(completed?.players[0]).not.toBe(source.players[0]);
    expect(completed?.players[0]).toEqual(source.players[0]);
  });
});

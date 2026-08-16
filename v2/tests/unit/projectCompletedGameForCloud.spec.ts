import { describe, it, expect } from 'vitest';
import type { ActiveGame, GameAction, GamePlayer, Segment } from '../../src/domain/game/types';
import { MAX_CLOCK_SECONDS } from '../../src/domain/game/types';
import { finishGame } from '../../src/domain/game/finish';
import { projectCompletedGameSnapshot } from '../../src/application/game/projectCompletedGameForCloud';

function player(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    id: `gp-${overrides.rosterId ?? 1}`,
    rosterId: 1,
    nr: '1',
    naam: 'Speler',
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: true,
    ...overrides,
  };
}

function segment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 'seg-1',
    quarter: 1,
    beginSec: MAX_CLOCK_SECONDS,
    endSec: 0,
    durSec: MAX_CLOCK_SECONDS,
    lineup: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5'],
    pf: 6,
    pa: 4,
    classSum: 14.0,
    allowed: 14.5,
    over: false,
    ...overrides,
  };
}

/** Zelfde handmatig narekenbare fixture als projectGameForCloud.spec.ts:
 * vier kwarten, scoreFor 24/scoreAgainst 16. */
function fullGameFixture(): ActiveGame {
  const players = [1, 2, 3, 4, 5].map((n) => player({ rosterId: n, nr: String(n) }));
  const actions: GameAction[] = [1, 2, 3, 4].flatMap((quarter) => {
    const minute = String(10 + quarter).padStart(2, '0');
    return [
      {
        type: 'score-delta',
        id: `action-q${quarter}-for`,
        team: 'for',
        delta: 6,
        at: `2026-01-01T00:${minute}:00.000Z`,
      },
      {
        type: 'score-delta',
        id: `action-q${quarter}-against`,
        team: 'against',
        delta: 4,
        at: `2026-01-01T00:${minute}:20.000Z`,
      },
      {
        type: 'segment-saved',
        id: `action-q${quarter}`,
        segment: segment({ id: `seg-q${quarter}`, quarter }),
        at: `2026-01-01T00:${minute}:40.000Z`,
      },
    ] as GameAction[];
  });
  return {
    id: 'game-full',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players,
    opponent: 'Fictieve Tegenstander',
    competition: 'Fictieve Competitie',
    clockDown: true,
    limitStr: '14.5',
    onCourt: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5'],
    curQuarter: 4,
    beginSec: MAX_CLOCK_SECONDS,
    endSec: MAX_CLOCK_SECONDS,
    pendingSwapLineup: null,
    actions,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:05:00.000Z',
  };
}

describe('projectCompletedGameSnapshot (PR 7.2a)', () => {
  it('behoudt finishGame()-uitkomst 1:1 — geen herberekening van score/segmenten', () => {
    const completed = finishGame(fullGameFixture(), {
      quarterCount: 4,
      periodLabel: 'kwart',
      useClassLimit: true,
    });
    expect(completed).not.toBeNull();
    const snapshot = projectCompletedGameSnapshot(completed!);

    expect(snapshot.scoreFor).toBe(completed!.scoreFor);
    expect(snapshot.scoreAgainst).toBe(completed!.scoreAgainst);
    expect(snapshot.scoreFor).toBe(24);
    expect(snapshot.scoreAgainst).toBe(16);
    expect(snapshot.segments).toEqual(completed!.segments);
    expect(snapshot.players).toEqual(completed!.players);
    expect(snapshot.quarterCount).toBe(4);
    expect(snapshot.periodLabel).toBe('kwart');
    expect(snapshot.useClassLimit).toBe(true);
    expect(snapshot.date).toBe(completed!.date);
    expect(snapshot.sourceGameId).toBe(completed!.sourceGameId);
    expect(snapshot.organizationId).toBe(completed!.organizationId);
    expect(snapshot.teamId).toBe(completed!.teamId);
  });

  it('is deterministisch: dezelfde CompletedGame levert een gelijke snapshot op', () => {
    const completed = finishGame(fullGameFixture(), {
      quarterCount: 4,
      periodLabel: 'kwart',
      useClassLimit: true,
    })!;
    expect(projectCompletedGameSnapshot(completed)).toEqual(
      projectCompletedGameSnapshot(completed),
    );
  });

  it('muteert de meegegeven CompletedGame niet (defensieve kopieën van arrays)', () => {
    const completed = finishGame(fullGameFixture(), {
      quarterCount: 4,
      periodLabel: 'kwart',
      useClassLimit: true,
    })!;
    const snapshot = projectCompletedGameSnapshot(completed);
    snapshot.players.push(player({ rosterId: 9, nr: '9' }));
    snapshot.segments.push(segment({ id: 'seg-extra' }));
    expect(completed.players).toHaveLength(5);
    expect(completed.segments).toHaveLength(4);
  });

  it('draagt geen id/syncedAt (server-/documentbookkeeping, geen domeinveld)', () => {
    const completed = finishGame(fullGameFixture(), {
      quarterCount: 4,
      periodLabel: 'kwart',
      useClassLimit: true,
    })!;
    const snapshot = projectCompletedGameSnapshot(completed);
    expect(snapshot).not.toHaveProperty('id');
    expect(snapshot).not.toHaveProperty('syncedAt');
  });
});

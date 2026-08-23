import { describe, it, expect } from 'vitest';
import {
  buildGameSyncDiagnostics,
  unconfirmedGameActions,
} from '../../src/domain/game/gameSyncDiagnostics';
import {
  createEmptyGameSyncCheckpoint,
  withConfirmedActions,
} from '../../src/domain/game/syncCheckpoint';
import type { ActiveGame, GameAction } from '../../src/domain/game/types';

function gameWithActions(actionIds: string[]): ActiveGame {
  const actions: GameAction[] = actionIds.map((id, index) => ({
    type: 'score-delta',
    id,
    team: 'for',
    delta: 2,
    at: `2026-01-01T00:0${index}:00.000Z`,
  }));
  return {
    id: 'game-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players: [],
    opponent: 'Tegenstander',
    competition: 'Competitie',
    clockDown: true,
    limitStr: '14.5',
    onCourt: [],
    curQuarter: 1,
    beginSec: 600,
    endSec: 600,
    pendingSwapLineup: null,
    actions,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('domain/game/gameSyncDiagnostics (PR 7.1c)', () => {
  it('telt bevestigde/pending acties correct, zonder spelers-/scoredata in de descriptor', () => {
    const game = gameWithActions(['a1', 'a2', 'a3']);
    const checkpoint = withConfirmedActions(
      createEmptyGameSyncCheckpoint('game-1', 'org-1', 'team-1', '2026-01-01T00:00:00.000Z'),
      ['a1', 'a2'],
      '2026-01-01T00:01:00.000Z',
    );

    const diagnostics = buildGameSyncDiagnostics(game, checkpoint);

    expect(diagnostics).toEqual({
      gameId: 'game-1',
      status: 'idle',
      totalActionCount: 3,
      confirmedActionCount: 2,
      pendingActionCount: 1,
      serverRevision: 0,
      lastError: undefined,
      updatedAt: '2026-01-01T00:01:00.000Z',
    });
    // Geen enkel veld van de descriptor mag een speler-/scoreveld bevatten.
    expect(Object.keys(diagnostics)).not.toContain('players');
    expect(Object.keys(diagnostics)).not.toContain('scoreFor');
    expect(Object.keys(diagnostics)).not.toContain('actions');
  });

  it('een leeg checkpoint levert 0 bevestigde / alle acties pending op', () => {
    const game = gameWithActions(['a1', 'a2']);
    const checkpoint = createEmptyGameSyncCheckpoint(
      'game-1',
      'org-1',
      'team-1',
      '2026-01-01T00:00:00.000Z',
    );
    const diagnostics = buildGameSyncDiagnostics(game, checkpoint);
    expect(diagnostics.confirmedActionCount).toBe(0);
    expect(diagnostics.pendingActionCount).toBe(2);
  });

  it('draagt lastError door vanuit een actie-nodig-checkpoint', () => {
    const game = gameWithActions([]);
    const checkpoint = {
      ...createEmptyGameSyncCheckpoint('game-1', 'org-1', 'team-1', '2026-01-01T00:00:00.000Z'),
      status: 'actie-nodig' as const,
      lastError: 'permission-denied',
    };
    const diagnostics = buildGameSyncDiagnostics(game, checkpoint);
    expect(diagnostics.status).toBe('actie-nodig');
    expect(diagnostics.lastError).toBe('permission-denied');
  });
});

describe('domain/game/gameSyncDiagnostics unconfirmedGameActions (PR 7.3c werk 2/3)', () => {
  it('geeft alleen de nog niet bevestigde acties terug, in de originele volgorde', () => {
    const game = gameWithActions(['a1', 'a2', 'a3']);
    const checkpoint = withConfirmedActions(
      createEmptyGameSyncCheckpoint('game-1', 'org-1', 'team-1', '2026-01-01T00:00:00.000Z'),
      ['a2'],
      '2026-01-01T00:01:00.000Z',
    );
    const unconfirmed = unconfirmedGameActions(game, checkpoint);
    expect(unconfirmed.map((a) => a.id)).toEqual(['a1', 'a3']);
  });

  it('een leeg checkpoint levert ALLE lokale acties op', () => {
    const game = gameWithActions(['a1', 'a2']);
    const checkpoint = createEmptyGameSyncCheckpoint(
      'game-1',
      'org-1',
      'team-1',
      '2026-01-01T00:00:00.000Z',
    );
    expect(unconfirmedGameActions(game, checkpoint).map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('alles bevestigd levert een lege lijst op — nooit de lokale actielog zelf muteren', () => {
    const game = gameWithActions(['a1', 'a2']);
    const checkpoint = withConfirmedActions(
      createEmptyGameSyncCheckpoint('game-1', 'org-1', 'team-1', '2026-01-01T00:00:00.000Z'),
      ['a1', 'a2'],
      '2026-01-01T00:01:00.000Z',
    );
    expect(unconfirmedGameActions(game, checkpoint)).toEqual([]);
    // Puur: de oorspronkelijke game.actions blijft ongewijzigd (2 items).
    expect(game.actions).toHaveLength(2);
  });
});

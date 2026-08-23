import { describe, it, expect } from 'vitest';
import { buildPendingGameActionsEnvelope } from '../../src/infrastructure/game/exportPendingGameActions';
import type { GameAction } from '../../src/domain/game/types';

describe('infrastructure/game/exportPendingGameActions (PR 7.3c werk 2/3)', () => {
  it('bouwt een zelfbeschrijvende envelop met gameId/organizationId/teamId en de acties zelf', () => {
    const actions: GameAction[] = [
      { type: 'score-delta', id: 'a1', team: 'for', delta: 2, at: '2026-01-01T00:00:00.000Z' },
      { type: 'score-delta', id: 'a2', team: 'against', delta: 1, at: '2026-01-01T00:01:00.000Z' },
    ];
    const envelope = buildPendingGameActionsEnvelope(
      'game-1',
      'org-1',
      'team-1',
      actions,
      () => '2026-08-23T00:00:00.000Z',
    );
    expect(envelope).toEqual({
      type: 'lineup-tracker-game-actions',
      version: 1,
      exportedAt: '2026-08-23T00:00:00.000Z',
      gameId: 'game-1',
      organizationId: 'org-1',
      teamId: 'team-1',
      actions,
    });
  });

  it('een lege actielijst levert een geldige, lege envelop op (geen crash)', () => {
    const envelope = buildPendingGameActionsEnvelope('game-1', 'org-1', 'team-1', []);
    expect(envelope.actions).toEqual([]);
  });

  it('kopieert de actielijst (geen gedeelde referentie met de invoer)', () => {
    const actions: GameAction[] = [
      { type: 'score-delta', id: 'a1', team: 'for', delta: 1, at: '2026-01-01T00:00:00.000Z' },
    ];
    const envelope = buildPendingGameActionsEnvelope('game-1', 'org-1', 'team-1', actions);
    expect(envelope.actions).not.toBe(actions);
    expect(envelope.actions).toEqual(actions);
  });
});

import { describe, it, expect } from 'vitest';
import type { ActiveGame, GamePlayer } from '../../src/domain/game/types';
import {
  canStartGame,
  deriveWriterClaimState,
  gameStartBlockReason,
  type CloudClaimStatus,
} from '../../src/domain/game/writerClaim';

function player(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    id: 'gp-1',
    rosterId: 1,
    nr: '7',
    naam: 'Jan',
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: true,
    ...overrides,
  };
}

function fiveReadyPlayers(): GamePlayer[] {
  return [1, 2, 3, 4, 5].map((n) =>
    player({ id: `gp-${n}`, rosterId: n, nr: String(n), naam: `Speler ${n}` }),
  );
}

function game(overrides: Partial<ActiveGame> = {}): ActiveGame {
  return {
    id: 'game-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'setup',
    players: fiveReadyPlayers(),
    opponent: '',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: [],
    curQuarter: 1,
    beginSec: 0,
    endSec: 0,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    ...overrides,
  };
}

describe('domain/game/writerClaim: deriveWriterClaimState (PR 7.3a)', () => {
  const self = { authorUid: 'uid-alice', deviceId: 'device-alice' };

  it('unclaimed als writerUid/deviceId beide null zijn', () => {
    expect(
      deriveWriterClaimState({ writerUid: null, deviceId: null, writerEpoch: 0 }, self),
    ).toEqual({
      kind: 'unclaimed',
    });
  });

  it('own als writerUid/deviceId overeenkomen met dit apparaat', () => {
    expect(
      deriveWriterClaimState(
        { writerUid: 'uid-alice', deviceId: 'device-alice', writerEpoch: 2 },
        self,
      ),
    ).toEqual({
      kind: 'own',
      identity: { writerUid: 'uid-alice', deviceId: 'device-alice', writerEpoch: 2 },
    });
  });

  it('other als een ANDER uid/apparaat de writer is', () => {
    expect(
      deriveWriterClaimState(
        { writerUid: 'uid-bob', deviceId: 'device-bob', writerEpoch: 1 },
        self,
      ),
    ).toEqual({
      kind: 'other',
      identity: { writerUid: 'uid-bob', deviceId: 'device-bob', writerEpoch: 1 },
    });
  });

  it('other als hetzelfde uid maar een ANDER apparaat de writer is (zelfde gebruiker, tweede toestel)', () => {
    expect(
      deriveWriterClaimState(
        { writerUid: 'uid-alice', deviceId: 'device-ander-toestel', writerEpoch: 1 },
        self,
      ),
    ).toEqual({
      kind: 'other',
      identity: { writerUid: 'uid-alice', deviceId: 'device-ander-toestel', writerEpoch: 1 },
    });
  });
});

describe('domain/game/writerClaim: gameStartBlockReason/canStartGame (PR 7.3a)', () => {
  const notRequired: CloudClaimStatus = { kind: 'not-required' };

  it('roster-redenen gaan altijd eerst, ongeacht cloudclaimstatus', () => {
    const notReady = game({ players: [player({ naam: '' })] });
    expect(gameStartBlockReason(notReady, notRequired)).toEqual({
      kind: 'roster',
      reason: 'needFivePlayers',
    });
    expect(
      gameStartBlockReason(notReady, {
        kind: 'confirmed',
        identity: { writerUid: 'x', deviceId: 'y', writerEpoch: 0 },
      }),
    ).toEqual({
      kind: 'roster',
      reason: 'needFivePlayers',
    });
  });

  it('alleen-lokale modus (not-required) start zonder cloudclaim zodra roster klaar is', () => {
    expect(gameStartBlockReason(game(), notRequired)).toBeNull();
    expect(canStartGame(game(), notRequired)).toBe(true);
  });

  it('cloudmodus: pending blokkeert starten zolang roster al klaar is', () => {
    expect(gameStartBlockReason(game(), { kind: 'pending' })).toEqual({
      kind: 'cloud-claim',
      status: { kind: 'pending' },
    });
    expect(canStartGame(game(), { kind: 'pending' })).toBe(false);
  });

  it('cloudmodus: blocked blokkeert starten, met de foutcode zichtbaar in de reden', () => {
    const blocked: CloudClaimStatus = { kind: 'blocked', code: 'already-claimed' };
    expect(gameStartBlockReason(game(), blocked)).toEqual({ kind: 'cloud-claim', status: blocked });
    expect(canStartGame(game(), blocked)).toBe(false);
  });

  it('cloudmodus: confirmed staat starten toe zodra roster klaar is', () => {
    const confirmed: CloudClaimStatus = {
      kind: 'confirmed',
      identity: { writerUid: 'uid-alice', deviceId: 'device-alice', writerEpoch: 0 },
    };
    expect(gameStartBlockReason(game(), confirmed)).toBeNull();
    expect(canStartGame(game(), confirmed)).toBe(true);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { GameSyncCoordinator } from '../../src/application/game/GameSyncCoordinator';
import { LocalStorageGameSyncCheckpointRepository } from '../../src/infrastructure/game/LocalStorageGameSyncCheckpointRepository';
import type {
  GameActionUploadOutcome,
  GameCloudGateway,
  GameSnapshotProjection,
  GameSnapshotWriteResult,
} from '../../src/application/game/GameCloudGateway';
import type { GameCloudWriterContext } from '../../src/application/game/projectGameForCloud';
import type { ActiveGame, GameAction } from '../../src/domain/game/types';
import type { GameActionEnvelopeDocument } from 'firebase-base/documents';
import type { KeyValueStorage } from '../../src/i18n/persistence';

class MemoryStorage implements KeyValueStorage {
  private readonly store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

/** Vaste, oplopende klok — deterministisch narekenbaar in assertions. */
function fixedClock() {
  let n = 0;
  return () => `2026-01-01T00:00:${String(n++).padStart(2, '0')}.000Z`;
}

function gameWithActions(actionIds: string[], overrides: Partial<ActiveGame> = {}): ActiveGame {
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
    onCourt: ['gp-1'],
    curQuarter: 1,
    beginSec: 600,
    endSec: 590,
    pendingSwapLineup: null,
    actions,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const writer: GameCloudWriterContext = {
  authorUid: 'uid-alice',
  deviceId: 'device-alice',
  writerEpoch: 0,
};

interface GatewayScript {
  ensureGame?: (
    snapshot: GameSnapshotProjection,
  ) => GameSnapshotWriteResult | Promise<GameSnapshotWriteResult>;
  uploadActions?: (
    actions: readonly GameActionEnvelopeDocument[],
  ) => GameActionUploadOutcome[] | Promise<GameActionUploadOutcome[]>;
  patchSnapshot?: (
    patch: Partial<GameSnapshotProjection>,
    expectedRevision: number,
  ) => GameSnapshotWriteResult | Promise<GameSnapshotWriteResult>;
}

function mockGateway(script: GatewayScript): GameCloudGateway & {
  calls: { ensureGame: number; uploadActions: number; patchSnapshot: number };
  uploadedActionIds: string[][];
} {
  const calls = { ensureGame: 0, uploadActions: 0, patchSnapshot: 0 };
  const uploadedActionIds: string[][] = [];
  return {
    calls,
    uploadedActionIds,
    async ensureGame(_org, _team, _gameId, snapshot) {
      calls.ensureGame += 1;
      return script.ensureGame
        ? script.ensureGame(snapshot)
        : { ok: true, revision: 0, writerUid: null, deviceId: null };
    },
    async uploadActions(_org, _team, _gameId, actions) {
      calls.uploadActions += 1;
      uploadedActionIds.push(actions.map((a) => a.actionId));
      return script.uploadActions
        ? script.uploadActions(actions)
        : actions.map((a) => ({ actionId: a.actionId, ok: true }));
    },
    async patchSnapshot(_org, _team, _gameId, patch, expectedRevision) {
      calls.patchSnapshot += 1;
      return script.patchSnapshot
        ? script.patchSnapshot(patch, expectedRevision)
        : { ok: true, revision: expectedRevision + 1 };
    },
  };
}

describe('application/game/GameSyncCoordinator (PR 7.1c)', () => {
  it('happy path: claimt een ongeclaimde wedstrijd, uploadt alle acties en patcht de snapshot', async () => {
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(new MemoryStorage());
    const gateway = mockGateway({});
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints, now: fixedClock() });
    const game = gameWithActions(['a1', 'a2']);

    const result = await coordinator.sync(game, writer);

    expect(result.status).toBe('idle');
    expect(result.confirmedActionIds.sort()).toEqual(['a1', 'a2']);
    expect(result.serverRevision).toBe(2); // claim (0->1) + veldpatch (1->2)
    expect(gateway.calls.ensureGame).toBe(1);
    expect(gateway.calls.patchSnapshot).toBe(2); // claim + veldpatch
    expect(gateway.calls.uploadActions).toBe(1);
    expect(gateway.uploadedActionIds[0]?.sort()).toEqual(['a1', 'a2']);
    expect(checkpoints.read('game-1')).toEqual(result);
  });

  it('slaat de claimstap over als dit apparaat de wedstrijd al claimde (zelfde writerUid/deviceId)', async () => {
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(new MemoryStorage());
    const gateway = mockGateway({
      ensureGame: () => ({
        ok: true,
        revision: 3,
        writerUid: writer.authorUid,
        deviceId: writer.deviceId,
      }),
    });
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints, now: fixedClock() });
    const game = gameWithActions(['a1']);

    const result = await coordinator.sync(game, writer);

    expect(result.status).toBe('idle');
    // patchSnapshot wordt alleen nog voor de veldpatch aangeroepen, niet voor een claim.
    expect(gateway.calls.patchSnapshot).toBe(1);
    expect(result.serverRevision).toBe(4);
  });

  it('faalt zichtbaar (actie-nodig) als een ANDER apparaat/andere gebruiker de wedstrijd al claimde', async () => {
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(new MemoryStorage());
    const gateway = mockGateway({
      ensureGame: () => ({ ok: true, revision: 1, writerUid: 'uid-bob', deviceId: 'device-bob' }),
    });
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints, now: fixedClock() });
    const game = gameWithActions(['a1']);

    const result = await coordinator.sync(game, writer);

    expect(result.status).toBe('actie-nodig');
    expect(result.lastError).toContain('uid-bob');
    // Geen enkele actie wordt geüpload op een wedstrijd die niet van dit apparaat is.
    expect(gateway.calls.uploadActions).toBe(0);
    expect(gateway.calls.patchSnapshot).toBe(0);
  });

  it('faalt zichtbaar als ensureGame() faalt, zonder verdere stappen te proberen', async () => {
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(new MemoryStorage());
    const gateway = mockGateway({
      ensureGame: () => ({ ok: false, error: new Error('offline') }),
    });
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints, now: fixedClock() });
    const game = gameWithActions(['a1']);

    const result = await coordinator.sync(game, writer);

    expect(result.status).toBe('actie-nodig');
    expect(result.lastError).toBe('offline');
    expect(gateway.calls.uploadActions).toBe(0);
    expect(gateway.calls.patchSnapshot).toBe(0);
  });

  it('uploadt alleen nog onbevestigde acties (idempotent — bevestigde acties nooit opnieuw)', async () => {
    const storage = new MemoryStorage();
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(storage);
    // Simuleer een checkpoint van een eerdere, gedeeltelijk gelukte sync.
    checkpoints.write({
      gameId: 'game-1',
      organizationId: 'org-1',
      teamId: 'team-1',
      confirmedActionIds: ['a1'],
      serverRevision: 5,
      status: 'actie-nodig',
      lastError: 'eerdere poging faalde',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const gateway = mockGateway({
      ensureGame: () => ({
        ok: true,
        revision: 5,
        writerUid: writer.authorUid,
        deviceId: writer.deviceId,
      }),
    });
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints, now: fixedClock() });
    const game = gameWithActions(['a1', 'a2', 'a3']);

    const result = await coordinator.sync(game, writer);

    expect(gateway.uploadedActionIds[0]?.sort()).toEqual(['a2', 'a3']);
    expect(result.confirmedActionIds.sort()).toEqual(['a1', 'a2', 'a3']);
    expect(result.status).toBe('idle');
  });

  it('een gedeeltelijk mislukte upload bevestigt de geslaagde acties, meldt actie-nodig en patcht de snapshot niet', async () => {
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(new MemoryStorage());
    const gateway = mockGateway({
      ensureGame: () => ({
        ok: true,
        revision: 0,
        writerUid: writer.authorUid,
        deviceId: writer.deviceId,
      }),
      uploadActions: (actions) =>
        actions.map((a, index) =>
          index === 0
            ? { actionId: a.actionId, ok: true }
            : { actionId: a.actionId, ok: false, error: new Error('rules-afwijzing') },
        ),
    });
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints, now: fixedClock() });
    const game = gameWithActions(['a1', 'a2']);

    const result = await coordinator.sync(game, writer);

    expect(result.status).toBe('actie-nodig');
    expect(result.confirmedActionIds).toEqual(['a1']);
    expect(result.lastError).toBe('rules-afwijzing');
    expect(gateway.calls.patchSnapshot).toBe(0);
  });

  it('een mislukte veldpatch aan het eind laat eerder bevestigde acties ongemoeid', async () => {
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(new MemoryStorage());
    const gateway = mockGateway({
      ensureGame: () => ({
        ok: true,
        revision: 2,
        writerUid: writer.authorUid,
        deviceId: writer.deviceId,
      }),
      patchSnapshot: () => ({ ok: false, error: new Error('verouderde revisie') }),
    });
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints, now: fixedClock() });
    const game = gameWithActions(['a1']);

    const result = await coordinator.sync(game, writer);

    expect(result.status).toBe('actie-nodig');
    expect(result.confirmedActionIds).toEqual(['a1']);
    expect(result.lastError).toBe('verouderde revisie');
    expect(result.serverRevision).toBe(2);
  });

  it('slaat de action-upload volledig over als er niets onbevestigds is, patcht nog wel de snapshot', async () => {
    const storage = new MemoryStorage();
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(storage);
    checkpoints.write({
      gameId: 'game-1',
      organizationId: 'org-1',
      teamId: 'team-1',
      confirmedActionIds: ['a1'],
      serverRevision: 1,
      status: 'idle',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const gateway = mockGateway({
      ensureGame: () => ({
        ok: true,
        revision: 1,
        writerUid: writer.authorUid,
        deviceId: writer.deviceId,
      }),
    });
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints, now: fixedClock() });
    const game = gameWithActions(['a1']);

    await coordinator.sync(game, writer);

    expect(gateway.calls.uploadActions).toBe(0);
    expect(gateway.calls.patchSnapshot).toBe(1);
  });

  it('local mode ontstaat nooit: de coordinator praat uitsluitend met de meegegeven poorten, geen eigen netwerkaanroepen', async () => {
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(new MemoryStorage());
    const ensureGame = vi.fn(async () => ({
      ok: true,
      revision: 0,
      writerUid: null,
      deviceId: null,
    }));
    const uploadActions = vi.fn(
      async (_o: string, _t: string, _g: string, actions: readonly GameActionEnvelopeDocument[]) =>
        actions.map((a) => ({ actionId: a.actionId, ok: true })),
    );
    const patchSnapshot = vi.fn(
      async (
        _o: string,
        _t: string,
        _g: string,
        _patch: Partial<GameSnapshotProjection>,
        rev: number,
      ) => ({
        ok: true,
        revision: rev + 1,
      }),
    );
    const gateway: GameCloudGateway = { ensureGame, uploadActions, patchSnapshot };
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints });
    await coordinator.sync(gameWithActions(['a1']), writer);
    expect(ensureGame).toHaveBeenCalledTimes(1);
    expect(uploadActions).toHaveBeenCalledTimes(1);
    expect(patchSnapshot).toHaveBeenCalledTimes(2);
  });
});

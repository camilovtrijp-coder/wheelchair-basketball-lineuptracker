import { describe, it, expect, vi } from 'vitest';
import { GameSyncCoordinator } from '../../src/application/game/GameSyncCoordinator';
import { LocalStorageGameSyncCheckpointRepository } from '../../src/infrastructure/game/LocalStorageGameSyncCheckpointRepository';
import type {
  CompletedGameSnapshotProjection,
  CompletedGameWriteResult,
  GameActionUploadOutcome,
  GameCloudGateway,
  GameSnapshotProjection,
  GameSnapshotWriteResult,
} from '../../src/application/game/GameCloudGateway';
import type { GameCloudWriterContext } from '../../src/application/game/projectGameForCloud';
import type { ActiveGame, CompletedGame, GameAction } from '../../src/domain/game/types';
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

function completedGameFor(game: ActiveGame, overrides: Partial<CompletedGame> = {}): CompletedGame {
  return {
    id: 'completed-1',
    organizationId: game.organizationId,
    teamId: game.teamId,
    sourceGameId: game.id,
    opponent: game.opponent,
    competition: game.competition,
    date: '2026-01-01T02:00:00.000Z',
    players: [],
    segments: [],
    scoreFor: 10,
    scoreAgainst: 8,
    quarterCount: 4,
    periodLabel: 'kwart',
    useClassLimit: true,
    ...overrides,
  };
}

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
  ensureCompletedGame?: (
    completedGameId: string,
    snapshot: CompletedGameSnapshotProjection,
  ) => CompletedGameWriteResult | Promise<CompletedGameWriteResult>;
}

function mockGateway(script: GatewayScript): GameCloudGateway & {
  calls: {
    ensureGame: number;
    uploadActions: number;
    patchSnapshot: number;
    ensureCompletedGame: number;
  };
  uploadedActionIds: string[][];
} {
  const calls = { ensureGame: 0, uploadActions: 0, patchSnapshot: 0, ensureCompletedGame: 0 };
  const uploadedActionIds: string[][] = [];
  return {
    calls,
    uploadedActionIds,
    async ensureGame(_org, _team, _gameId, snapshot) {
      calls.ensureGame += 1;
      return script.ensureGame
        ? script.ensureGame(snapshot)
        : { ok: true, revision: 0, writerUid: null, deviceId: null, completedGameId: null };
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
    async ensureCompletedGame(_org, _team, completedGameId, snapshot) {
      calls.ensureCompletedGame += 1;
      return script.ensureCompletedGame
        ? script.ensureCompletedGame(completedGameId, snapshot)
        : { ok: true };
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

  it('REGRESSIE (P1, externe review PR #56): verwerpt een checkpoint dat bij een ANDER organisatie/team hoort — bijv. na een backup-import die dezelfde gameId naar een ander team retagt (domain/backup/migrateV1.ts retagWithContext())', async () => {
    const storage = new MemoryStorage();
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(storage);
    // Checkpoint van team A: actie 'a1' is daar al bevestigd.
    checkpoints.write({
      gameId: 'game-1',
      organizationId: 'org-A',
      teamId: 'team-A',
      confirmedActionIds: ['a1'],
      serverRevision: 7,
      status: 'idle',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const gateway = mockGateway({
      ensureGame: () => ({ ok: true, revision: 0, writerUid: null, deviceId: null }),
    });
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints, now: fixedClock() });
    // Dezelfde gameId, maar via backup-retag nu onderdeel van team B.
    const game = gameWithActions(['a1'], { organizationId: 'org-B', teamId: 'team-B' });

    const result = await coordinator.sync(game, writer);

    // 'a1' moet WEL geüpload worden voor team B — het team-A-checkpoint mag
    // dit nooit als "al bevestigd" filteren.
    expect(gateway.uploadedActionIds[0]).toEqual(['a1']);
    expect(result.organizationId).toBe('org-B');
    expect(result.teamId).toBe('team-B');
    expect(result.confirmedActionIds).toEqual(['a1']);
    expect(result.status).toBe('idle');

    // Het opgeslagen checkpoint draagt nu ook echt team B's context, niet
    // langer team A's — een volgende sync voor team A blijft ongemoeid
    // (ander gameId zou in de praktijk gelden, maar dit bewijst dat het
    // bewaarde checkpoint zelf is bijgewerkt naar de huidige context).
    expect(checkpoints.read('game-1')?.organizationId).toBe('org-B');
    expect(checkpoints.read('game-1')?.teamId).toBe('team-B');
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
    const ensureCompletedGame = vi.fn(async () => ({ ok: true }));
    const gateway: GameCloudGateway = {
      ensureGame,
      uploadActions,
      patchSnapshot,
      ensureCompletedGame,
    };
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints });
    await coordinator.sync(gameWithActions(['a1']), writer);
    expect(ensureGame).toHaveBeenCalledTimes(1);
    expect(uploadActions).toHaveBeenCalledTimes(1);
    expect(patchSnapshot).toHaveBeenCalledTimes(2);
    expect(ensureCompletedGame).not.toHaveBeenCalled();
  });
});

describe('application/game/GameSyncCoordinator.finalize() (PR 7.2a)', () => {
  it('happy path: syncet de wedstrijd, schrijft de completed-snapshot en patcht completedGameId', async () => {
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(new MemoryStorage());
    const gateway = mockGateway({
      ensureGame: () => ({
        ok: true,
        revision: 0,
        writerUid: writer.authorUid,
        deviceId: writer.deviceId,
        completedGameId: null,
      }),
    });
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints, now: fixedClock() });
    const game = gameWithActions(['a1']);
    const completed = completedGameFor(game);

    const result = await coordinator.finalize(game, completed, writer);

    expect(result.status).toBe('idle');
    expect(result.completedGameId).toBe('completed-1');
    // 2x ensureGame: finalize()'s eigen server-kortsluitingscheck + sync()'s
    // eigen interne ensureGame()-stap.
    expect(gateway.calls.ensureGame).toBe(2);
    expect(gateway.calls.uploadActions).toBe(1);
    expect(gateway.calls.patchSnapshot).toBe(2); // veldpatch (sync) + finalize-patch
    expect(gateway.calls.ensureCompletedGame).toBe(1);
    expect(checkpoints.read('game-1')).toEqual(result);
  });

  it('dezelfde finalize tweemaal: de tweede aanroep is een lokale no-op zonder netwerk', async () => {
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(new MemoryStorage());
    const gateway = mockGateway({
      ensureGame: () => ({
        ok: true,
        revision: 0,
        writerUid: writer.authorUid,
        deviceId: writer.deviceId,
        completedGameId: null,
      }),
    });
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints, now: fixedClock() });
    const game = gameWithActions(['a1']);
    const completed = completedGameFor(game);

    const first = await coordinator.finalize(game, completed, writer);
    expect(first.status).toBe('idle');
    const callsAfterFirst = { ...gateway.calls };

    const second = await coordinator.finalize(game, completed, writer);

    expect(second).toEqual(first);
    expect(gateway.calls).toEqual(callsAfterFirst); // geen enkele extra gateway-aanroep
  });

  it('crash na de eerste stap: ensureGame() faalt, geen enkele verdere stap wordt geprobeerd', async () => {
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(new MemoryStorage());
    const gateway = mockGateway({
      ensureGame: () => ({ ok: false, error: new Error('offline') }),
    });
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints, now: fixedClock() });
    const game = gameWithActions(['a1']);
    const completed = completedGameFor(game);

    const result = await coordinator.finalize(game, completed, writer);

    expect(result.status).toBe('actie-nodig');
    expect(result.lastError).toBe('offline');
    expect(result.completedGameId).toBeUndefined();
    expect(gateway.calls.ensureCompletedGame).toBe(0);
    expect(gateway.calls.patchSnapshot).toBe(0);
  });

  it('crash na sync(): de actieset/snapshot is bevestigd, maar ensureCompletedGame() faalt — geen completedGameId gezet', async () => {
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(new MemoryStorage());
    let ensureCompletedGameCalls = 0;
    const gateway = mockGateway({
      ensureGame: () => ({
        ok: true,
        revision: 0,
        writerUid: writer.authorUid,
        deviceId: writer.deviceId,
        completedGameId: null,
      }),
      ensureCompletedGame: () => {
        ensureCompletedGameCalls += 1;
        if (ensureCompletedGameCalls === 1) {
          return { ok: false, error: new Error('rules-afwijzing') };
        }
        return { ok: true };
      },
    });
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints, now: fixedClock() });
    const game = gameWithActions(['a1']);
    const completed = completedGameFor(game);

    const result = await coordinator.finalize(game, completed, writer);

    expect(result.status).toBe('actie-nodig');
    expect(result.lastError).toBe('rules-afwijzing');
    expect(result.completedGameId).toBeUndefined();
    // de acties zijn wél al bevestigd (sync() liep door tot het eind):
    expect(result.confirmedActionIds).toEqual(['a1']);
    expect(gateway.calls.patchSnapshot).toBe(1); // alleen de veldpatch uit sync(), nog geen finalize-patch

    // Retry: ensureCompletedGame() slaagt nu alsnog — idempotent hervat vanaf
    // de mislukte stap, sync() hoeft de al bevestigde actie niet te herhalen.
    const retry = await coordinator.finalize(game, completed, writer);
    expect(retry.status).toBe('idle');
    expect(retry.completedGameId).toBe('completed-1');
    expect(gateway.uploadedActionIds).toHaveLength(1); // geen tweede upload-poging voor 'a1'
  });

  it('crash na ensureCompletedGame(): de finalize-patch faalt — retry hervat zonder een tweede snapshot te maken', async () => {
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(new MemoryStorage());
    let completedGameCalls = 0;
    let failPatchOnce = true;
    const gateway = mockGateway({
      ensureGame: () => ({
        ok: true,
        revision: 0,
        writerUid: writer.authorUid,
        deviceId: writer.deviceId,
        completedGameId: null,
      }),
      ensureCompletedGame: () => {
        completedGameCalls += 1;
        return { ok: true, alreadyConfirmed: completedGameCalls > 1 };
      },
      patchSnapshot: (patch, expectedRevision) => {
        if ('completedGameId' in patch && failPatchOnce) {
          failPatchOnce = false;
          return { ok: false, error: new Error('verouderde revisie') };
        }
        return { ok: true, revision: expectedRevision + 1 };
      },
    });
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints, now: fixedClock() });
    const game = gameWithActions(['a1']);
    const completed = completedGameFor(game);

    const result = await coordinator.finalize(game, completed, writer);
    expect(result.status).toBe('actie-nodig');
    expect(result.completedGameId).toBeUndefined();

    const retry = await coordinator.finalize(game, completed, writer);
    expect(retry.status).toBe('idle');
    expect(retry.completedGameId).toBe('completed-1');
    expect(completedGameCalls).toBe(2); // idempotente herhaling, geen tweede ECHTE snapshot
  });

  it('afwijkende bestaande payload: ensureCompletedGame() ziet een conflict en faalt zichtbaar', async () => {
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(new MemoryStorage());
    const gateway = mockGateway({
      ensureGame: () => ({
        ok: true,
        revision: 0,
        writerUid: writer.authorUid,
        deviceId: writer.deviceId,
        completedGameId: null,
      }),
      ensureCompletedGame: () => ({
        ok: false,
        error: new Error('completed-1 bestaat al met een afwijkende payload'),
      }),
    });
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints, now: fixedClock() });
    const game = gameWithActions(['a1']);
    const completed = completedGameFor(game);

    const result = await coordinator.finalize(game, completed, writer);

    expect(result.status).toBe('actie-nodig');
    expect(result.lastError).toContain('afwijkende payload');
    expect(result.completedGameId).toBeUndefined();
  });

  it('ingetrokken membership: elke stap kan met een Rules-afwijzing falen, zonder lokaal dataverlies', async () => {
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(new MemoryStorage());
    const gateway = mockGateway({
      ensureGame: () => ({
        ok: false,
        error: new Error('permission-denied: membership ingetrokken'),
      }),
    });
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints, now: fixedClock() });
    const game = gameWithActions(['a1', 'a2']);
    const completed = completedGameFor(game);

    const result = await coordinator.finalize(game, completed, writer);

    expect(result.status).toBe('actie-nodig');
    expect(result.lastError).toContain('membership ingetrokken');
    // De volledige actieset blijft ongemoeid op `game.actions` (dit domeinobject
    // wordt door de coordinator nooit gemuteerd) — geen enkele lokale write.
    expect(game.actions).toHaveLength(2);
  });

  it('server al afgerond (recovery na crash tussen server-ack en lokale checkpointwrite): geen tweede snapshot, checkpoint wordt lokaal hersteld', async () => {
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(new MemoryStorage());
    const gateway = mockGateway({
      ensureGame: () => ({
        ok: true,
        revision: 4,
        writerUid: writer.authorUid,
        deviceId: writer.deviceId,
        completedGameId: 'completed-1',
      }),
    });
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints, now: fixedClock() });
    const game = gameWithActions(['a1']);
    const completed = completedGameFor(game);

    const result = await coordinator.finalize(game, completed, writer);

    expect(result.status).toBe('idle');
    expect(result.completedGameId).toBe('completed-1');
    expect(result.serverRevision).toBe(4);
    // sync()/ensureCompletedGame()/de finalize-patch worden helemaal niet
    // meer geprobeerd — de server-kortsluiting in stap 2 volstaat.
    expect(gateway.calls.uploadActions).toBe(0);
    expect(gateway.calls.patchSnapshot).toBe(0);
    expect(gateway.calls.ensureCompletedGame).toBe(0);
    expect(checkpoints.read('game-1')).toEqual(result);
  });

  it('server al afgerond naar een ANDERE snapshot dan verwacht: faalt zichtbaar i.p.v. de mismatch te negeren', async () => {
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(new MemoryStorage());
    const gateway = mockGateway({
      ensureGame: () => ({
        ok: true,
        revision: 4,
        writerUid: writer.authorUid,
        deviceId: writer.deviceId,
        completedGameId: 'completed-ANDER',
      }),
    });
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints, now: fixedClock() });
    const game = gameWithActions(['a1']);
    const completed = completedGameFor(game);

    const result = await coordinator.finalize(game, completed, writer);

    expect(result.status).toBe('actie-nodig');
    expect(result.lastError).toContain('completed-ANDER');
    expect(gateway.calls.ensureCompletedGame).toBe(0);
  });

  it('een lokaal checkpoint met een ANDERE completedGameId (dubbele/gecorrumpeerde toestand) faalt zichtbaar zonder netwerk', async () => {
    const storage = new MemoryStorage();
    const checkpoints = new LocalStorageGameSyncCheckpointRepository(storage);
    checkpoints.write({
      gameId: 'game-1',
      organizationId: 'org-1',
      teamId: 'team-1',
      confirmedActionIds: ['a1'],
      serverRevision: 2,
      status: 'idle',
      completedGameId: 'completed-OUD',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const gateway = mockGateway({});
    const coordinator = new GameSyncCoordinator({ gateway, checkpoints, now: fixedClock() });
    const game = gameWithActions(['a1']);
    const completed = completedGameFor(game);

    const result = await coordinator.finalize(game, completed, writer);

    expect(result.status).toBe('actie-nodig');
    expect(result.lastError).toContain('completed-OUD');
    expect(gateway.calls.ensureGame).toBe(0);
  });
});

// Invariant (review PR #100 op de pending-timestamp-fix): alleen een
// SERVER-BEVESTIGDE lezing — een snapshot zonder `metadata.hasPendingWrites` —
// mag beslissen dat (a) de writerclaim bevestigd is, (b) de afronding al
// server-side gedaan is, of (c) een action al bevestigd is. Een write die op
// `withTimeout()` afketst, blijft in Firestores lokale wachtrij staan; een
// `getDoc()` daarna toont die write in de lokale weergave alsof hij al op de
// server staat. `sync()` mag op die lokale weergave doorbouwen (revisieketen,
// Firestore verstuurt de wachtrij in volgorde), maar mag er niets mee
// "bevestigen".
//
// Echte FirestoreGameCloudGateway + echte GameSyncCoordinator, alleen
// `firebase/firestore` is gemockt — zo dekt elke test de samengestelde
// uitkomst die App.tsx ziet (claim → pre-game gate, finalize → outbox).
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  serverTimestamp: vi.fn(() => 'server-timestamp-sentinel'),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  writeBatch: vi.fn(),
}));

vi.mock('firebase-base/documents', () => ({
  gameConverter: { toFirestore: (data: unknown) => data },
  gameActionConverter: { toFirestore: (data: unknown) => data },
}));

import { doc, getDoc, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import type { GameActionEnvelopeDocument } from 'firebase-base/documents';
import { FirestoreGameCloudGateway } from '../../src/infrastructure/game/FirestoreGameCloudGateway';
import { GameSyncCoordinator } from '../../src/application/game/GameSyncCoordinator';
import { LocalStorageGameSyncCheckpointRepository } from '../../src/infrastructure/game/LocalStorageGameSyncCheckpointRepository';
import type { GameCloudWriterContext } from '../../src/application/game/projectGameForCloud';
import type { ActiveGame, CompletedGame } from '../../src/domain/game/types';
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

const fakeDb = {} as unknown as Firestore;
const TIMEOUT_MS = 20;
const writer: GameCloudWriterContext = {
  authorUid: 'uid-fictief',
  deviceId: 'device-fictief',
  writerEpoch: 0,
};

function trackingGame(): ActiveGame {
  return {
    id: 'game-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players: [],
    opponent: 'Fictieve Tegenstander',
    competition: 'Fictieve Competitie',
    clockDown: true,
    limitStr: '14.5',
    onCourt: [],
    curQuarter: 1,
    beginSec: 600,
    endSec: 590,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
  };
}

function completedFor(game: ActiveGame): CompletedGame {
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
    scoreFor: 0,
    scoreAgainst: 0,
    quarterCount: 4,
    periodLabel: 'kwart',
    useClassLimit: true,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
  };
}

/** Snapshot van het parent-gamedocument; `pending` = lokale weergave met onbevestigde write. */
function gameSnapshot(fields: Record<string, unknown>, pending: boolean) {
  return {
    exists: () => true,
    metadata: { hasPendingWrites: pending, fromCache: pending },
    data: (options?: { serverTimestamps?: string }) => {
      if (pending && options?.serverTimestamps !== 'estimate') {
        throw new Error('game: veld "updatedAt" moet een Firestore Timestamp zijn');
      }
      return {
        revision: 0,
        writerUid: null,
        deviceId: null,
        writerEpoch: 0,
        claimedAt: null,
        completedGameId: null,
        ...fields,
      };
    },
  };
}

function refFor(...segments: unknown[]) {
  const ref = { path: segments.slice(1).join('/'), withConverter: () => ref };
  return ref;
}

const never = () => new Promise<never>(() => undefined);

function setup() {
  const checkpoints = new LocalStorageGameSyncCheckpointRepository(new MemoryStorage());
  const gateway = new FirestoreGameCloudGateway(fakeDb, TIMEOUT_MS);
  const coordinator = new GameSyncCoordinator({ gateway, checkpoints });
  return { checkpoints, gateway, coordinator };
}

describe('invariant: alleen een server-bevestigde lezing mag iets bevestigen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (doc as Mock).mockImplementation(refFor);
  });

  it('(a) ensureWriterClaim(): een eigen claim die alleen lokaal in de wachtrij staat is NIET confirmed', async () => {
    // Scenario B2: claimWriter-updateDoc liep eerder op de timeout vast;
    // 'Opnieuw proberen' leest nu de lokale weergave met de eigen claim.
    (getDoc as Mock).mockResolvedValue(
      gameSnapshot({ revision: 1, writerUid: writer.authorUid, deviceId: writer.deviceId }, true),
    );
    const { coordinator } = setup();

    const status = await coordinator.ensureWriterClaim(
      { ...trackingGame(), phase: 'setup', startedAt: null },
      writer,
    );

    expect(status).toEqual({ kind: 'blocked', code: 'offline' });
  });

  it('(a) ensureWriterClaim(): dezelfde claim server-bevestigd blijft confirmed', async () => {
    (getDoc as Mock).mockResolvedValue(
      gameSnapshot({ revision: 1, writerUid: writer.authorUid, deviceId: writer.deviceId }, false),
    );
    const { coordinator } = setup();

    const status = await coordinator.ensureWriterClaim(
      { ...trackingGame(), phase: 'setup', startedAt: null },
      writer,
    );

    expect(status.kind).toBe('confirmed');
  });

  it('(b) finalize(): een afrondingsbatch die alleen lokaal in de wachtrij staat is NIET gesynchroniseerd', async () => {
    // Scenario B1: de finalizeCompletedGame-batch liep op de timeout vast;
    // de retry leest de lokale weergave met completedGameId al gezet.
    (getDoc as Mock).mockResolvedValue(
      gameSnapshot(
        {
          revision: 3,
          writerUid: writer.authorUid,
          deviceId: writer.deviceId,
          completedGameId: 'completed-1',
        },
        true,
      ),
    );
    const { coordinator, checkpoints } = setup();
    const game = trackingGame();

    const result = await coordinator.finalize(game, completedFor(game), writer);

    expect(result.status).toBe('actie-nodig');
    expect(result.completedGameId).toBeUndefined();
    expect(checkpoints.read(game.id)?.completedGameId).toBeUndefined();
  });

  it('(b) finalize(): dezelfde afronding server-bevestigd geldt wel als al gedaan', async () => {
    (getDoc as Mock).mockResolvedValue(
      gameSnapshot(
        {
          revision: 3,
          writerUid: writer.authorUid,
          deviceId: writer.deviceId,
          completedGameId: 'completed-1',
        },
        false,
      ),
    );
    const { coordinator } = setup();
    const game = trackingGame();

    const result = await coordinator.finalize(game, completedFor(game), writer);

    expect(result.status).toBe('idle');
    expect(result.completedGameId).toBe('completed-1');
  });

  const action: GameActionEnvelopeDocument = {
    organizationId: 'org-1',
    teamId: 'team-1',
    gameId: 'game-1',
    actionId: 'action-1',
    authorUid: writer.authorUid,
    deviceId: writer.deviceId,
    writerEpoch: 0,
    sequence: 0,
    occurredAt: '2026-01-01T00:10:00.000Z',
    schemaVersion: 1,
    action: { type: 'score-delta', team: 'for', delta: 2 },
  };

  function actionSnapshot(pending: boolean) {
    return {
      exists: () => true,
      metadata: { hasPendingWrites: pending, fromCache: pending },
      data: () => action,
    };
  }

  it('(c) uploadActions(): een action die alleen lokaal in de wachtrij staat is NIET bevestigd', async () => {
    (setDoc as Mock).mockImplementation(never);
    (getDoc as Mock).mockResolvedValue(actionSnapshot(true));
    const { gateway } = setup();

    const outcomes = await gateway.uploadActions('org-1', 'team-1', 'game-1', [action]);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.ok).toBe(false);
    expect(outcomes[0]?.alreadyConfirmed).toBeUndefined();
  });

  it('(c) uploadActions(): een server-bevestigde identieke action blijft alreadyConfirmed', async () => {
    (setDoc as Mock).mockRejectedValue(new Error('permission-denied (bestaat al)'));
    (getDoc as Mock).mockResolvedValue(actionSnapshot(false));
    const { gateway } = setup();

    const outcomes = await gateway.uploadActions('org-1', 'team-1', 'game-1', [action]);

    expect(outcomes).toEqual([{ actionId: 'action-1', ok: true, alreadyConfirmed: true }]);
  });

  it('sync() bouwt WEL door op de lokale weergave (flakiness-fix intact): patch op de lokale revisie', async () => {
    // Eigen claim + vastgelopen patch (revisie 3) nog in de wachtrij; de
    // volgende cyclus moet niet op actie-nodig stranden maar op revisie 3
    // voortbouwen (nextRevision 4).
    (getDoc as Mock).mockResolvedValue(
      gameSnapshot({ revision: 3, writerUid: writer.authorUid, deviceId: writer.deviceId }, true),
    );
    (updateDoc as Mock).mockResolvedValue(undefined);
    const { coordinator } = setup();

    const result = await coordinator.sync(trackingGame(), writer);

    expect(result.status).toBe('idle');
    expect((updateDoc as Mock).mock.calls[0]?.[1]).toMatchObject({ revision: 4 });
  });
});

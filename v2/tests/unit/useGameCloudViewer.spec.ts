// @vitest-environment jsdom
//
// PR 7.3b (docs/pr-7.3-plan.md §C 7.3b werk 2/3/5): bewijst de hook die
// `GameSyncCoordinator.subscribeGame()` omzet naar één pure
// `GameCloudViewerSnapshot`, inclusief listenerfout- en reload-/heropen-
// gedrag (nieuw abonnement bij een gewijzigd `gameId`, oude listener
// gestopt).
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { useGameCloudViewer } from '../../src/ui/game/useGameCloudViewer';
import type { GameSyncCoordinator } from '../../src/application/game/GameSyncCoordinator';
import type {
  GameCloudActionsUpdate,
  GameCloudParentUpdate,
  GameCloudSubscriptionCallbacks,
} from '../../src/application/game/GameCloudGateway';
import type { GameDocument } from 'firebase-base/documents';

const SELF = { authorUid: 'uid-self', deviceId: 'device-self' };
const OTHER = { authorUid: 'uid-other', deviceId: 'device-other' };
const SERVER_META = { fromCache: false, hasPendingWrites: false };

function parentDoc(writer: { authorUid: string; deviceId: string }): GameDocument {
  return {
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players: [],
    opponent: '',
    competition: '',
    clockDown: false,
    limitStr: '',
    onCourt: [],
    curQuarter: 1,
    beginSec: 0,
    endSec: 0,
    pendingSwapLineup: null,
    scoreFor: 0,
    scoreAgainst: 0,
    segmentCount: 0,
    writerUid: writer.authorUid,
    deviceId: writer.deviceId,
    writerEpoch: 1,
    claimedAt: '2026-01-01T10:00:00.000Z',
    lastWriterActivityAt: '2026-01-01T10:00:00.000Z',
    revision: 1,
    createdAt: '2026-01-01T09:00:00.000Z',
    startedAt: '2026-01-01T09:30:00.000Z',
    completedGameId: null,
    updatedAt: {} as GameDocument['updatedAt'],
  };
}

/** Bewaart de laatst geregistreerde callbacks per `subscribeGame()`-aanroep,
 * zodat de test zelf `onParent`/`onActions`/`onError` kan triggeren — zelfde
 * stijl als `AppListenerError.spec.tsx`'s `ControlledAsyncSettingsRepository`. */
function fakeCoordinator() {
  const subscribeCalls: string[] = [];
  const unsubscribeSpy = vi.fn();
  let callbacks: GameCloudSubscriptionCallbacks | null = null;
  const coordinator = {
    subscribeGame(_org: string, _team: string, gameId: string, cb: GameCloudSubscriptionCallbacks) {
      subscribeCalls.push(gameId);
      callbacks = cb;
      return unsubscribeSpy;
    },
  } as unknown as GameSyncCoordinator;
  return {
    coordinator,
    subscribeCalls,
    unsubscribeSpy,
    emitParent(update: GameCloudParentUpdate) {
      callbacks?.onParent(update);
    },
    emitActions(update: GameCloudActionsUpdate) {
      callbacks?.onActions(update);
    },
    emitError(error: unknown) {
      callbacks?.onError(error);
    },
  };
}

describe('ui/game/useGameCloudViewer (PR 7.3b)', () => {
  it('alleen-lokale modus (coordinator: null): geen abonnement, blijvende lege snapshot', () => {
    const { result } = renderHook(() =>
      useGameCloudViewer(null, 'org-1', 'team-1', 'game-1', SELF),
    );
    expect(result.current.loading).toBe(true);
    expect(result.current.writerClaim).toEqual({ kind: 'unclaimed' });
  });

  it('gameId: null: geen abonnement (bijv. game.phase !== "tracking")', () => {
    const { coordinator, subscribeCalls } = fakeCoordinator();
    renderHook(() => useGameCloudViewer(coordinator, 'org-1', 'team-1', null, SELF));
    expect(subscribeCalls).toEqual([]);
  });

  it('combineert parent- en actions-updates tot één snapshot met writerClaim + historie', () => {
    const fake = fakeCoordinator();
    const { result } = renderHook(() =>
      useGameCloudViewer(fake.coordinator, 'org-1', 'team-1', 'game-1', SELF),
    );

    act(() => {
      fake.emitParent({ doc: parentDoc(OTHER), meta: SERVER_META });
      fake.emitActions({
        actions: [
          {
            organizationId: 'org-1',
            teamId: 'team-1',
            gameId: 'game-1',
            actionId: 'a1',
            authorUid: OTHER.authorUid,
            deviceId: OTHER.deviceId,
            writerEpoch: 1,
            sequence: 0,
            occurredAt: '2026-01-01T10:00:00.000Z',
            schemaVersion: 1,
            action: { type: 'score-delta', team: 'for', delta: 5 },
          },
        ],
        meta: SERVER_META,
      });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.writerClaim.kind).toBe('other');
    expect(result.current.history.scoreFor).toBe(5);
    expect(result.current.freshness).toBe('server');
  });

  it('listenerfout: freshness wordt "error", de laatst bekende stand blijft staan', () => {
    const fake = fakeCoordinator();
    const { result } = renderHook(() =>
      useGameCloudViewer(fake.coordinator, 'org-1', 'team-1', 'game-1', SELF),
    );

    act(() => {
      fake.emitParent({ doc: parentDoc(OTHER), meta: SERVER_META });
      // Review-fix (minimax, PR #68 punt 2): freshness is pas 'server' zodra
      // BEIDE streams minstens één snapshot leverden — ook de actions-stream
      // moet hier dus eerst emitten.
      fake.emitActions({ actions: [], meta: SERVER_META });
    });
    expect(result.current.freshness).toBe('server');

    act(() => fake.emitError(new Error('listener failed')));
    expect(result.current.freshness).toBe('error');
    expect(result.current.parent).not.toBeNull();
    expect(result.current.writerClaim.kind).toBe('other');
  });

  it('een gewijzigd gameId (bijv. reload/heropen op een andere wedstrijd) meldt het oude abonnement af en start een nieuw', () => {
    const fake = fakeCoordinator();
    const { rerender } = renderHook(
      ({ gameId }: { gameId: string }) =>
        useGameCloudViewer(fake.coordinator, 'org-1', 'team-1', gameId, SELF),
      { initialProps: { gameId: 'game-1' } },
    );
    expect(fake.subscribeCalls).toEqual(['game-1']);
    expect(fake.unsubscribeSpy).not.toHaveBeenCalled();

    rerender({ gameId: 'game-2' });
    expect(fake.subscribeCalls).toEqual(['game-1', 'game-2']);
    expect(fake.unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('unmount meldt het abonnement af', () => {
    const fake = fakeCoordinator();
    const { unmount } = renderHook(() =>
      useGameCloudViewer(fake.coordinator, 'org-1', 'team-1', 'game-1', SELF),
    );
    unmount();
    expect(fake.unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('een gewijzigde `self`-identiteit (andere authorUid/deviceId primitieven) meldt het oude abonnement af en start een nieuw (review-fix: geen object-identity-dependency meer)', () => {
    const fake = fakeCoordinator();
    const { rerender } = renderHook(
      ({ self }: { self: { authorUid: string; deviceId: string } }) =>
        useGameCloudViewer(fake.coordinator, 'org-1', 'team-1', 'game-1', self),
      { initialProps: { self: SELF } },
    );
    expect(fake.subscribeCalls).toEqual(['game-1']);
    expect(fake.unsubscribeSpy).not.toHaveBeenCalled();

    // Een NIEUW object met dezelfde primitieven mag NIET opnieuw abonneren
    // (voorkomt onnodige re-subscribes bij elke render).
    rerender({ self: { authorUid: SELF.authorUid, deviceId: SELF.deviceId } });
    expect(fake.subscribeCalls).toEqual(['game-1']);
    expect(fake.unsubscribeSpy).not.toHaveBeenCalled();

    // Andere primitieve waarden (bijv. een toekomstige logout/login-flow die
    // `repositories.gameWriterContext` herbouwt) MOET wel opnieuw abonneren.
    rerender({ self: OTHER });
    expect(fake.subscribeCalls).toEqual(['game-1', 'game-1']);
    expect(fake.unsubscribeSpy).toHaveBeenCalledTimes(1);
  });
});

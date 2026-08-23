import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameDocument, GameActionEnvelopeDocument } from 'firebase-base/documents';
import type { GameSyncCoordinator } from '../../application/game/GameSyncCoordinator';
import type { GameCloudSnapshotMeta } from '../../application/game/GameCloudGateway';
import {
  createEmptyGameCloudViewerSnapshot,
  deriveGameCloudViewerSnapshot,
  type GameCloudViewerSnapshot,
} from '../../application/game/GameCloudViewerState';

/**
 * PR 7.3b (docs/pr-7.3-plan.md §C 7.3b werk 2/3): React/Preact-hook rond
 * `GameSyncCoordinator.subscribeGame()` — bewaart de laatst ontvangen
 * parent-/actions-/foutstaat in refs (nooit alleen in de laatste
 * callback-payload, want `onParent`/`onActions` vuren onafhankelijk van
 * elkaar) en herberekent bij elke update de volledige, pure
 * `GameCloudViewerSnapshot` (`deriveGameCloudViewerSnapshot()`). Meldt zich
 * automatisch af bij unmount of zodra `organizationId`/`teamId`/`gameId`
 * wijzigt (nieuw abonnement, oude listeners gestopt) — nooit twee actieve
 * abonnementen op hetzelfde apparaat tegelijk.
 *
 * `coordinator === null` (alleen-lokale modus, of nog geen cloudcontext)
 * levert de blijvende `createEmptyGameCloudViewerSnapshot()`-staat op zonder
 * enige Firestore-aanroep — zelfde terughoudendheid als de rest van de
 * cloud-sync-stack (`GameSyncCoordinator.sync()`'s eigen headercommentaar).
 */
export function useGameCloudViewer(
  coordinator: GameSyncCoordinator | null,
  organizationId: string,
  teamId: string,
  gameId: string | null,
  self: { authorUid: string; deviceId: string } | null,
): GameCloudViewerSnapshot {
  const [snapshot, setSnapshot] = useState<GameCloudViewerSnapshot>(
    createEmptyGameCloudViewerSnapshot,
  );
  const parentRef = useRef<GameDocument | null>(null);
  const parentMetaRef = useRef<GameCloudSnapshotMeta | null>(null);
  const actionsRef = useRef<GameActionEnvelopeDocument[]>([]);
  const actionsMetaRef = useRef<GameCloudSnapshotMeta | null>(null);
  const hadErrorRef = useRef(false);

  useEffect(() => {
    parentRef.current = null;
    parentMetaRef.current = null;
    actionsRef.current = [];
    actionsMetaRef.current = null;
    hadErrorRef.current = false;
    setSnapshot(createEmptyGameCloudViewerSnapshot());

    if (!coordinator || gameId === null) return undefined;

    function recompute() {
      setSnapshot(
        deriveGameCloudViewerSnapshot({
          parent: parentRef.current,
          parentMeta: parentMetaRef.current,
          actions: actionsRef.current,
          actionsMeta: actionsMetaRef.current,
          hadError: hadErrorRef.current,
          self,
        }),
      );
    }

    const unsubscribe = coordinator.subscribeGame(organizationId, teamId, gameId, {
      onParent: (update) => {
        parentRef.current = update.doc;
        parentMetaRef.current = update.meta;
        recompute();
      },
      onActions: (update) => {
        actionsRef.current = update.actions;
        actionsMetaRef.current = update.meta;
        recompute();
      },
      onError: () => {
        hadErrorRef.current = true;
        recompute();
      },
    });
    return unsubscribe;
    // `self` bewust buiten de dependency-array: in de praktijk een stabiele
    // referentie (App.tsx memoized `gameWriterContext`), en opnieuw
    // abonneren puur op een `self`-identiteitswijziging is niet nodig — de
    // writerclaim-vergelijking in `deriveGameCloudViewerSnapshot()` gebeurt
    // toch bij elke `recompute()`, dus een gewijzigde `self` komt bij de
    // eerstvolgende parent-/actions-update alsnog mee.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordinator, organizationId, teamId, gameId]);

  return snapshot;
}

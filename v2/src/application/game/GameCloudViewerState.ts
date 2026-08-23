import type { GameDocument } from 'firebase-base/documents';
import {
  deriveCloudGameHistory,
  type CloudGameActionEnvelope,
} from '../../domain/game/deriveGameStateFromCloud';
import { deriveWriterClaimState, type WriterClaimState } from '../../domain/game/writerClaim';
import type { DerivedGameHistory } from '../../domain/game/tracking';
import type { GameCloudSnapshotMeta } from './GameCloudGateway';

/**
 * PR 7.3b (docs/pr-7.3-plan.md §C 7.3b werk 2/3): pure combinatie van de
 * twee onafhankelijke `GameCloudGateway.subscribeToGame()`-streams (parent +
 * actions) tot één weergavevriendelijke viewersnapshot. Geen Firestore-import
 * — deze functie is de application-laag-tegenhanger van
 * `domain/game/writerClaim.ts` se `deriveWriterClaimState()`, hier
 * uitgebreid met de afgeleide historie en de cache-/serveractualiteit die de
 * viewer-UI nodig heeft (werk 3: "toon ... cache-/serveractualiteit").
 */

/**
 * `'server'`: beide streams zijn server-bevestigd (geen van beide
 * `fromCache`/`hasPendingWrites`). `'cache'`: minstens één stream komt nog
 * uit lokale Firestore-cache of heeft een nog-onbevestigde lokale write —
 * de getoonde stand kan achterlopen. `'error'`: minstens één listener heeft
 * een fatale fout gemeld (`onError`) — de laatst bekende stand blijft
 * zichtbaar, maar wordt niet meer bijgewerkt totdat een nieuw abonnement
 * start.
 */
export type GameCloudFreshness = 'server' | 'cache' | 'error';

export interface GameCloudViewerSnapshot {
  parent: GameDocument | null;
  history: DerivedGameHistory;
  writerClaim: WriterClaimState;
  freshness: GameCloudFreshness;
  /** `true` zolang nog geen enkele parent-snapshot ontvangen is (initiële laadstaat). */
  loading: boolean;
}

const EMPTY_SNAPSHOT_HISTORY = deriveCloudGameHistory([]);

export function createEmptyGameCloudViewerSnapshot(): GameCloudViewerSnapshot {
  return {
    parent: null,
    history: EMPTY_SNAPSHOT_HISTORY,
    writerClaim: { kind: 'unclaimed' },
    freshness: 'server',
    loading: true,
  };
}

/**
 * Review-fix (minimax, PR #68 punt 2): vóórdat ZOWEL de parent- als de
 * actions-listener minstens één snapshot hebben afgeleverd, is er nog geen
 * samenhangende ("coherente") stand om als `'server'` (live/gezaghebbend) te
 * tonen — `history` kan dan nog leeg zijn terwijl `parentMeta` al wél
 * server-bevestigd is (de twee streams zijn onafhankelijk, zie
 * `deriveGameCloudViewerSnapshot()`s eigen docstring). `actionsMeta === null`
 * telt daarom NIET simpelweg als "buiten beschouwing" (het oude gedrag —
 * uitfilteren uit `metas` hieronder liet `'server'` al vóór de eerste
 * actions-snapshot doorkomen); zolang één van beide nog nooit is aangekomen
 * valt dit terug op `'cache'` (nooit `'server'`), analoog aan hoe `loading`
 * hieronder ook al specifiek op "nog geen enkele parent-snapshot" checkt.
 */
function combineFreshness(
  parentMeta: GameCloudSnapshotMeta | null,
  actionsMeta: GameCloudSnapshotMeta | null,
  hadError: boolean,
): GameCloudFreshness {
  if (hadError) return 'error';
  if (parentMeta === null || actionsMeta === null) return 'cache';
  const metas = [parentMeta, actionsMeta];
  if (metas.some((m) => m.fromCache || m.hasPendingWrites)) return 'cache';
  return 'server';
}

/**
 * Herberekent de volledige viewersnapshot. Puur en synchroon — de
 * aanroepende hook (`ui/game/useGameCloudViewer.ts`) roept dit telkens
 * opnieuw aan zodra `onParent`/`onActions`/`onError` vuurt, met de laatst
 * bekende parent/actions/meta-waarden (een gemiste stream, bijv. vóór de
 * eerste snapshot, blijft op zijn vorige waarde staan — geen "flikkering"
 * naar leeg bij elke update van de ANDERE stream). `self` is `null` zolang de
 * viewer geen eigen device-/gebruikersidentiteit heeft (zou hier nooit
 * moeten voorkomen — een viewer is altijd ingelogd — maar puur defensief:
 * levert dan gewoon `writerClaim: 'other'`/`'unclaimed'` op, nooit een crash).
 */
export function deriveGameCloudViewerSnapshot(input: {
  parent: GameDocument | null;
  parentMeta: GameCloudSnapshotMeta | null;
  actions: readonly CloudGameActionEnvelope[];
  actionsMeta: GameCloudSnapshotMeta | null;
  hadError: boolean;
  self: { authorUid: string; deviceId: string } | null;
}): GameCloudViewerSnapshot {
  const { parent, parentMeta, actions, actionsMeta, hadError, self } = input;
  const writerClaim: WriterClaimState =
    parent === null
      ? { kind: 'unclaimed' }
      : deriveWriterClaimState(
          {
            writerUid: parent.writerUid,
            deviceId: parent.deviceId,
            writerEpoch: parent.writerEpoch,
          },
          self ?? { authorUid: '', deviceId: '' },
        );
  return {
    parent,
    history: deriveCloudGameHistory(actions),
    writerClaim,
    freshness: combineFreshness(parentMeta, actionsMeta, hadError),
    loading: parent === null && parentMeta === null,
  };
}

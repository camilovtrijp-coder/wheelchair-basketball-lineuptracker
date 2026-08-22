import type { ActiveGame } from '../../domain/game/types';
import type { WriterIdentity } from '../../domain/game/writerClaim';
import type { SyncState } from '../../domain/syncState';

/**
 * Application-poort voor de live-viewerkant van het wedstrijdmodel (PR 7.3b,
 * docs/pr-7.3-plan.md §C 7.3b werk 2/3). Implementatie:
 * `infrastructure/game/FirestoreGameViewerGateway.ts`. Losstaand van
 * `GameCloudGateway` (dat is de SCHRIJVERSKANT — claim/upload/patch); deze
 * poort is uitsluitend lezen en bestaat om een apparaat dat NIET de actuele
 * schrijver is een read-only weergave van andermans actieve cloudwedstrijd te
 * geven (`app/App.tsx` gebruikt dit alleen terwijl dit apparaat zelf geen
 * lokale `'tracking'`-wedstrijd heeft, zie de aanroepplek daar).
 *
 * `'none'`: geen enkele wedstrijd van dit team staat momenteel
 * server-side op `phase:'tracking'` met `completedGameId:null` (niemand is
 * actief aan het scoren, of dit apparaat kan het door een leesfout niet
 * bepalen — zie `subscribeActiveGame()`'s `onError`). `'active'`: een andere
 * schrijver is bezig; `game` is de puur afgeleide read-only
 * `ActiveGame`-weergave (`application/game/liveView.ts` `buildLiveGameView()`),
 * geschikt om ongewijzigd aan `LiveTrackingPanel` door te geven met
 * `canWrite=false`. `sync` spiegelt exact `domain/syncState.ts`'s
 * `SyncState` — cache-/serveractualiteit voor dezelfde
 * `SyncStatusIndicator` die de rest van de app al gebruikt.
 */
export type ActiveGameViewerSnapshot =
  | { kind: 'none'; sync: SyncState }
  | {
      kind: 'active';
      game: ActiveGame;
      writer: WriterIdentity;
      lastWriterActivityAt: string | null;
      sync: SyncState;
    };

export interface GameViewerGateway {
  /**
   * Abonneert op de team-brede "is er nu een actief geschreven wedstrijd"-
   * vraag én, zodra die bestaat, op de wedstrijd zelf (parentdocument +
   * `actions`-subcollectie) — zie `FirestoreGameViewerGateway` voor de
   * tweetraps-implementatie (discoveryquery, dan een geneste abonnement-
   * wissel zodra de gevonden `gameId` verandert). Roept `onNext` bij elke
   * relevante wijziging aan met de VOLLEDIGE actuele snapshot (nooit een
   * delta). `onError` wordt aangeroepen bij een Rules-afwijzing of andere
   * queryfout (bijv. een ingetrokken membership tijdens een actief
   * abonnement) — de aanroeper behandelt dat als "geen zichtbare actieve
   * wedstrijd", nooit als een harde crash (PR 7.3b-acceptatie: een
   * listenerfout mag de rest van de app niet blokkeren). Retourneert een
   * unsubscribe-functie die ALLE onderliggende Firestore-listeners opruimt.
   */
  subscribeActiveGame(
    onNext: (snapshot: ActiveGameViewerSnapshot) => void,
    onError?: (error: unknown) => void,
  ): () => void;
}

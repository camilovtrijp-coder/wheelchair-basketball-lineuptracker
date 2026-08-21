// Cloudbron voor afgeronde-wedstrijdgeschiedenis (PR 7.2b,
// docs/pr-7.2-plan.md §C 7.2b werk 1-2).
//
// Leest UITSLUITEND — schrijven/afronden loopt via `GameSyncCoordinator`/
// `GameCloudGateway.finalizeCompletedGame()` (PR 7.2a), niet via dit pad.
// Verwijderen/tombstones zijn PR 7.2c-scope; deze klasse biedt daarom geen
// `remove()`. Om die reden implementeert deze klasse NIET de volledige
// `CompletedGameRepository`-poort (die vereist `add`/`remove`/`replaceAll`),
// maar het smallere `CloudCompletedGameSource`-contract hieronder — precies
// wat `CompositeCompletedGameRepository` nodig heeft om de cloudkant achter
// de bestaande, lokaal-georiënteerde poort samen te voegen (plan §C 7.2b
// werk 1: "documenteer bewust hoe lokale pending items met serveritems op
// ID worden samengevoegd" — de samenvoeging zelf zit in de composite, niet
// hier).
//
// Query begrensd tot de actieve organisatie/teamcontext (plan §C 7.2b werk
// 2), nieuwste eerst, met een vaste bovengrens — een `orderBy('date',
// 'desc')` op een simpele collectiequery heeft geen samengestelde index
// nodig (Firestore's automatische single-field-index volstaat), dus dit
// voegt bewust geen nieuwe index toe (plan: "voeg alleen de bewezen index
// toe"). Zie firebase/firestore.rules punt 16/17: geen collectionGroup-
// match voor `completedGames`, dus deze query blijft altijd binnen één
// team.

import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Firestore,
  type QuerySnapshot,
} from 'firebase/firestore';
import { completedGameConverter, type CompletedGameDocument } from 'firebase-base/documents';
import type { CompletedGame } from '../../domain/game/types';
import { deriveSyncState, type SyncState } from '../../domain/syncState';

/**
 * Bovengrens voor de historiequery (plan §C 7.2b werk 2: "begrensde
 * paginagrootte"). Ruim boven wat één team/seizoen realistisch aan
 * afgeronde wedstrijden opbouwt vóór PR 8.x paginatie/archivering nodig
 * maakt — geen productfunctie, puur een defensieve leesgrens.
 */
export const COMPLETED_GAMES_QUERY_LIMIT = 300;

export interface CloudCompletedGameSource {
  /**
   * Roept `onNext` bij elke (metadata-)wijziging van de team-brede
   * `completedGames`-query aan met de volledige, actuele resultaatset (niet
   * een delta) plus de van de query-snapshot afgeleide `SyncState`.
   * `onError` wordt aangeroepen bij een Rules-afwijzing of een andere
   * queryfout (bijv. een ingetrokken membership tijdens een actief
   * abonnement — zelfde faalpad als `FirestoreSettingsRepository`/
   * `FirestoreRosterRepository`'s `subscribe()`).
   */
  subscribe(
    onNext: (games: CompletedGame[], sync: SyncState) => void,
    onError?: (error: unknown) => void,
  ): () => void;
}

/**
 * Projecteert een gelezen `CompletedGameDocument` terug naar de domeinvorm
 * — de inverse van `application/game/projectCompletedGameForCloud.ts`'s
 * `projectCompletedGameSnapshot()`. `id` komt uit het Firestore-pad (net als
 * bij `GameDocument`), niet uit de documentvelden; `syncedAt` is server-
 * bookkeeping zonder domeinequivalent (zie `completedGame.ts`'s docstring)
 * en wordt hier bewust weggelaten.
 */
export function completedGameFromDocument(id: string, doc: CompletedGameDocument): CompletedGame {
  return {
    id,
    organizationId: doc.organizationId,
    teamId: doc.teamId,
    sourceGameId: doc.sourceGameId,
    opponent: doc.opponent,
    competition: doc.competition,
    date: doc.date,
    players: doc.players,
    segments: doc.segments,
    scoreFor: doc.scoreFor,
    scoreAgainst: doc.scoreAgainst,
    quarterCount: doc.quarterCount,
    periodLabel: doc.periodLabel,
    useClassLimit: doc.useClassLimit,
  };
}

export class FirestoreCompletedGameRepository implements CloudCompletedGameSource {
  constructor(
    private readonly db: Firestore,
    private readonly orgId: string,
    private readonly teamId: string,
  ) {}

  private queryRef() {
    return query(
      collection(
        this.db,
        'organizations',
        this.orgId,
        'teams',
        this.teamId,
        'completedGames',
      ).withConverter(completedGameConverter),
      orderBy('date', 'desc'),
      limit(COMPLETED_GAMES_QUERY_LIMIT),
    );
  }

  subscribe(
    onNext: (games: CompletedGame[], sync: SyncState) => void,
    onError?: (error: unknown) => void,
  ): () => void {
    return onSnapshot(
      this.queryRef(),
      { includeMetadataChanges: true },
      (snap: QuerySnapshot<CompletedGameDocument>) => {
        // Externe review op PR #64: `d.data()` roept de converter aan
        // (`completedGameConverter.fromFirestore()`), die een
        // `DocumentValidationError` gooit bij een malformed/corrupt
        // serverdocument (zie `firebase-base/documents/validation.ts`). Zonder
        // deze try/catch ontsnapt die throw ONGEVANGEN uit deze
        // `onSnapshot`-callback — de meegegeven `onError` wordt dan nooit
        // aangeroepen (Firestore's SDK roept die uitsluitend bij een eigen
        // query-/verbindingsfout aan, niet bij een fout die de aanroeper zelf
        // in de succes-callback maakt), dus de bedoelde cloudfoutbanner blijft
        // dan onterecht weg. Eén malformed document behandelt dit bewust als
        // een fout voor de HELE snapshot (niet per-item gefilterd, in
        // tegenstelling tot `LocalStorageCompletedGameRepository`): deze
        // collectie is Rules-/schema-afgedwongen bij het schrijven, dus een
        // malformed document duidt op een echte anomalie die zichtbaar hoort
        // te worden — `CompositeCompletedGameRepository` laat de LOKALE
        // historie intussen gewoon zichtbaar (zie de eigen docstring van
        // die klasse).
        let games: CompletedGame[];
        try {
          games = snap.docs.map((d) => completedGameFromDocument(d.id, d.data()));
        } catch (error) {
          if (onError) onError(error);
          return;
        }
        onNext(games, deriveSyncState(snap.metadata));
      },
      (err) => {
        if (onError) onError(err);
      },
    );
  }
}

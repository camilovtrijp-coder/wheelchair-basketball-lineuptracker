// Firestore-implementatie van GameViewerGateway (PR 7.3b,
// docs/pr-7.3-plan.md §C 7.3b werk 2/3). Geen Rules-wijziging nodig: elke
// query/lezing hier valt al onder de bestaande `allow read: if
// canReadTeam(orgId, teamId)` op `games/{gameId}` en
// `games/{gameId}/actions/{actionId}` (firebase/firestore.rules punt
// 10/11) — dezelfde regel die PR 7.1c's parentdocument-leesback al gebruikt.
// De discoveryquery hieronder is bewust GEEN `collectionGroup()`-query (die
// blijft default-deny, zie firebase/docs/QUERY_CONTRACT.md §"Wedstrijd-/
// actiepaden") — het is een gewone, padgebonden collectiequery binnen ÉÉN
// team, met twee gelijkheidsfilters (`phase`/`completedGameId`) en zonder
// `orderBy`: Firestore combineert meerdere `==`-filters via de automatische
// single-field-indexen, dus dit voegt bewust GEEN nieuwe
// `firestore.indexes.json`-override toe (zelfde "geen index tenzij bewezen
// nodig"-precedent als `FirestoreCompletedGameRepository`'s
// `orderBy('date','desc')`-query).
//
// Tweetrapsabonnement:
//   1. discovery — een live query naar "is er nu precies één (of meer, zie
//      `pickActiveGameCandidate()`) team-wedstrijd(en) met `phase:'tracking'`
//      en `completedGameId:null`". Levert alleen de velden die
//      `pickActiveGameCandidate()` nodig heeft (via `withConverter`, dus de
//      volledige `GameDocument` — geen aparte lichte projectie nodig, dit is
//      dezelfde query-omvang als een enkel-documentlezing).
//   2. inner — zodra de gekozen `gameId` verandert (een nieuwe wedstrijd
//      wordt actief, de huidige rondt af/verdwijnt, of een overname wisselt
//      'm — 7.3c-scope, maar deze gateway blijft er hier al correct op
//      reageren omdat de discoveryquery zelf herevalueert), wordt de vorige
//      binnenste abonnementenparen (parentdocument + actions-subcollectie)
//      opgeruimd en een nieuw paar opgezet. `emit()` wacht tot BEIDE
//      binnenste listeners minstens één keer geleverd hebben vóórdat 'n
//      `'active'`-snapshot naar buiten gaat — een onvolledig tussenbeeld
//      (bijv. het parentdocument al binnen, de acties nog niet) zou anders
//      een historie tonen die nog niet overeenkomt met het parentdocument se
//      `scoreFor`/`scoreAgainst`-cache.
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  where,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  gameActionConverter,
  gameConverter,
  type GameActionEnvelopeDocument,
  type GameDocument,
} from 'firebase-base/documents';
import type {
  ActiveGameViewerSnapshot,
  GameViewerGateway,
} from '../../application/game/GameViewerGateway';
import { buildLiveGameView, pickActiveGameCandidate } from '../../domain/game/liveView';
import { deriveSyncState } from '../../domain/syncState';

/** Defensieve bovengrens — normaliter matcht de discoveryquery 0 of 1
 * document (zie `pickActiveGameCandidate()`'s docstring); dit is puur een
 * leesgrens, geen productfunctie. */
const DISCOVERY_QUERY_LIMIT = 5;

export class FirestoreGameViewerGateway implements GameViewerGateway {
  constructor(
    private readonly db: Firestore,
    private readonly organizationId: string,
    private readonly teamId: string,
  ) {}

  private gamesCollectionRef() {
    return collection(
      this.db,
      'organizations',
      this.organizationId,
      'teams',
      this.teamId,
      'games',
    ).withConverter(gameConverter);
  }

  private gameRef(gameId: string) {
    return doc(
      this.db,
      'organizations',
      this.organizationId,
      'teams',
      this.teamId,
      'games',
      gameId,
    ).withConverter(gameConverter);
  }

  private actionsCollectionRef(gameId: string) {
    return collection(
      this.db,
      'organizations',
      this.organizationId,
      'teams',
      this.teamId,
      'games',
      gameId,
      'actions',
    ).withConverter(gameActionConverter);
  }

  subscribeActiveGame(
    onNext: (snapshot: ActiveGameViewerSnapshot) => void,
    onError?: (error: unknown) => void,
  ): () => void {
    let closed = false;
    // `undefined` = nog geen enkele discoverysnapshot verwerkt. Bewust
    // ONDERSCHEIDEN van `null` (= "verwerkt, en er is momenteel geen actieve
    // wedstrijd"): de discoveryhandler hieronder vergelijkt `chosen` tegen
    // deze waarde om te bepalen of er iets veranderd is sinds de vorige
    // snapshot, en slaat een ONGEWIJZIGDE uitkomst bewust over (geen
    // overbodige teardown/resubscribe van de binnenste listeners). Zonder dit
    // onderscheid zou de EERSTE snapshot van een lege collectie (`chosen ===
    // null`) gelijk lijken aan de initiële toestand en nooit tot een `emit()`
    // leiden — de aanroeper zou dan nooit horen dat er (nog) geen actieve
    // wedstrijd is, ook niet na de volledige timeout.
    let currentGameId: string | null | undefined = undefined;
    let innerUnsubGame: Unsubscribe | null = null;
    let innerUnsubActions: Unsubscribe | null = null;
    let latestGameDoc: GameDocument | null = null;
    let latestGameFromCache = false;
    let haveGameSnapshot = false;
    let latestActions: readonly GameActionEnvelopeDocument[] = [];
    let latestActionsFromCache = false;
    let haveActionsSnapshot = false;

    const teardownInner = () => {
      innerUnsubGame?.();
      innerUnsubActions?.();
      innerUnsubGame = null;
      innerUnsubActions = null;
      latestGameDoc = null;
      latestActions = [];
      haveGameSnapshot = false;
      haveActionsSnapshot = false;
    };

    const emit = () => {
      if (closed) return;
      if (currentGameId === null || currentGameId === undefined) {
        onNext({
          kind: 'none',
          sync: deriveSyncState({ fromCache: false, hasPendingWrites: false }),
        });
        return;
      }
      if (!haveGameSnapshot || !haveActionsSnapshot) return; // wacht op een compleet paar
      if (latestGameDoc === null) {
        // Het gekozen parentdocument verdween tussen de discoverysnapshot en
        // deze lezing (zeldzame race) — de eerstvolgende discoveryupdate
        // corrigeert dit vanzelf; hier alvast conservatief "geen zichtbare
        // wedstrijd" tonen i.p.v. stil blijven hangen op de vorige waarde.
        onNext({
          kind: 'none',
          sync: deriveSyncState({ fromCache: false, hasPendingWrites: false }),
        });
        return;
      }
      if (latestGameDoc.writerUid === null || latestGameDoc.deviceId === null) {
        // Kan in theorie alleen bij een corrupt/onverwacht document (elke
        // wedstrijd bereikt 'phase:tracking' pas ná een bevestigde claim, zie
        // domain/game/writerClaim.ts `gameStartBlockReason()`) — fail-safe
        // "geen zichtbare wedstrijd" i.p.v. een writer-identiteit verzinnen.
        onNext({
          kind: 'none',
          sync: deriveSyncState({ fromCache: false, hasPendingWrites: false }),
        });
        return;
      }
      const game = buildLiveGameView(currentGameId, latestGameDoc, latestActions);
      onNext({
        kind: 'active',
        game,
        writer: {
          writerUid: latestGameDoc.writerUid,
          deviceId: latestGameDoc.deviceId,
          writerEpoch: latestGameDoc.writerEpoch,
        },
        lastWriterActivityAt: latestGameDoc.lastWriterActivityAt,
        sync: deriveSyncState({
          fromCache: latestGameFromCache || latestActionsFromCache,
          hasPendingWrites: false,
        }),
      });
    };

    const subscribeInner = (gameId: string) => {
      teardownInner();
      currentGameId = gameId;
      innerUnsubGame = onSnapshot(
        this.gameRef(gameId),
        { includeMetadataChanges: true },
        (snap) => {
          latestGameDoc = snap.exists() ? snap.data() : null;
          latestGameFromCache = snap.metadata.fromCache;
          haveGameSnapshot = true;
          emit();
        },
        (err) => onError?.(err),
      );
      innerUnsubActions = onSnapshot(
        this.actionsCollectionRef(gameId),
        { includeMetadataChanges: true },
        (snap) => {
          latestActions = snap.docs.map((d) => d.data());
          latestActionsFromCache = snap.metadata.fromCache;
          haveActionsSnapshot = true;
          emit();
        },
        (err) => onError?.(err),
      );
    };

    const discoveryQuery = query(
      this.gamesCollectionRef(),
      where('phase', '==', 'tracking'),
      where('completedGameId', '==', null),
      limit(DISCOVERY_QUERY_LIMIT),
    );
    const discoveryUnsub = onSnapshot(
      discoveryQuery,
      (snap) => {
        const chosen = pickActiveGameCandidate(
          snap.docs.map((d) => ({
            gameId: d.id,
            lastWriterActivityAt: d.data().lastWriterActivityAt,
            claimedAt: d.data().claimedAt,
            createdAt: d.data().createdAt,
          })),
        );
        if (chosen === currentGameId) return;
        if (chosen === null) {
          teardownInner();
          currentGameId = null;
          emit();
        } else {
          subscribeInner(chosen);
        }
      },
      (err) => onError?.(err),
    );

    return () => {
      closed = true;
      discoveryUnsub();
      teardownInner();
    };
  }
}

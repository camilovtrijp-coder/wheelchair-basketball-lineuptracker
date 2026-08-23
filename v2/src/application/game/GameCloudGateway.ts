import type {
  CompletedGameDocument,
  GameActionEnvelopeDocument,
  GameDocument,
} from 'firebase-base/documents';
import type { WriterClaimResult } from '../../domain/game/writerClaim';

/**
 * Application-poort voor de cloudkant van het wedstrijdmodel (PR 7.1a,
 * geïmplementeerd door `infrastructure/game/FirestoreGameCloudGateway.ts` in
 * PR 7.1c, zie docs/pr-7.1-plan.md §B/§C 7.1c). UI-componenten en de
 * bestaande synchrone `GameRepository` importeren deze poort niet — alleen
 * `GameSyncCoordinator` praat hiermee, net zoals
 * `AsyncSettingsRepository`/`FirestoreSettingsRepository` losstaan van de
 * synchrone `SettingsRepository` voor de lokale modus.
 *
 * Bewuste ontwerpkeuzes uit het plan:
 * - action-upload is create-only en per-actie idempotent (ADR-002
 *   §"Verduidelijkingen voor fase 7" punt 1): een retry met dezelfde
 *   `actionId` mag nooit een afwijkende payload accepteren — `alreadyConfirmed`
 *   onderscheidt "al aanwezig, semantisch gelijk" van een echte nieuwe write.
 * - de parent-snapshot wordt nooit als volledig document overschreven; elke
 *   patch draagt de laatst bekende `expectedRevision` (optimistische
 *   concurrency) zodat een ander apparaat de draaivelden niet stil kan
 *   overschrijven.
 */
export type GameSnapshotProjection = Omit<GameDocument, 'updatedAt'>;

export interface GameSnapshotWriteResult {
  ok: boolean;
  /** Aanwezig bij `ok: true`; de nieuwe serverrevisie na deze schrijfactie. */
  revision?: number;
  /**
   * Aanwezig bij `ok: true`; de actuele `writerUid`/`deviceId` op het
   * serverdocument NA deze operatie (voor `ensureGame()`: de staat van een
   * al bestaand document; voor `patchSnapshot()`: de bevestigde staat na
   * readback). `GameSyncCoordinator` gebruikt dit om te bepalen of dit
   * apparaat de wedstrijd al mag schrijven (eigen claim) of eerst het
   * initiële-claim-pad uit firestore.rules moet doorlopen (PR 7.1b, punt
   * 10b) — zonder deze velden zou de coordinator een aparte leesoperatie
   * nodig hebben die de poort niet aanbiedt.
   */
  writerUid?: string | null;
  deviceId?: string | null;
  /**
   * PR 7.3a: aanwezig bij `ok: true`; het actuele `writerEpoch` op het
   * serverdocument NA deze operatie. `GameSyncCoordinator.sync()` gebruikt
   * dit om `projectGameActions()` het ECHTE huidige epoch mee te geven
   * i.p.v. een statische waarde uit `GameCloudWriterContext` — zonder dit
   * veld zou een upload ná een overname altijd met een verouderd epoch
   * geprobeerd worden en dus permanent op de actions-createregel (punt 11)
   * stuklopen.
   */
  writerEpoch?: number;
  /**
   * PR 7.3a, backward-compat-fix (externe review, P1): aanwezig bij `ok:
   * true`; het actuele `claimedAt` op het serverdocument NA deze operatie.
   * `GameSyncCoordinator.sync()` geeft dit ongewijzigd terug aan de
   * eerstvolgende `patchSnapshot()`-patch (`projectGameSnapshotPatch()`),
   * ook als de huidige writer geen nieuwe claim/overname doet — een document
   * van vóór PR 7.3a mist `claimedAt` server-side nog VOLLEDIG (geen `null`,
   * de sleutel zelf ontbreekt); zonder dit veld hier zou de coordinator die
   * afwezigheid niet kunnen "meenemen" naar de patch, en zou
   * `isValidGamePayload()` (firestore.rules) elke normale patch op zo'n
   * legacydocument blijven weigeren omdat het resulterende document dan nog
   * steeds geen `claimedAt`-sleutel draagt.
   */
  claimedAt?: string | null;
  /**
   * PR 7.2a: aanwezig bij `ok: true`; de actuele `completedGameId` op het
   * serverdocument NA deze operatie. `GameSyncCoordinator.finalize()`
   * gebruikt dit om een reeds server-side afgeronde wedstrijd te herkennen
   * (bijv. na een crash die het lokale checkpoint niet meer bijwerkte vóórdat
   * de vorige finalize-poging server-bevestigd raakte) zonder daarvoor een
   * aparte leesoperatie nodig te hebben.
   */
  completedGameId?: string | null;
  error?: unknown;
}

export interface GameActionUploadOutcome {
  actionId: string;
  ok: boolean;
  /** `true` wanneer het action-document al bestond met een semantisch gelijke payload. */
  alreadyConfirmed?: boolean;
  error?: unknown;
}

/**
 * PR 7.2a: projectie van een `CompletedGame` naar de cloudvorm — zie
 * `application/game/projectCompletedGameForCloud.ts`. `syncedAt` is
 * server-bijgehouden bookkeeping (net als `GameSnapshotProjection`'s
 * ontbrekende `updatedAt`), dus hier ook uitgesloten.
 */
export type CompletedGameSnapshotProjection = Omit<CompletedGameDocument, 'syncedAt'>;

/**
 * PR 7.2c: resultaat van `tombstoneCompletedGame()`. Los van
 * `GameSnapshotWriteResult` (die is toegesneden op het `games/{gameId}`-
 * parentdocument met zijn eigen `writerUid`/`deviceId`/`completedGameId`-
 * velden, die hier niet van toepassing zijn).
 */
export interface CompletedGameTombstoneResult {
  ok: boolean;
  /** Aanwezig bij `ok: true`: de nieuwe serverrevisie na deze patch. */
  revision?: number;
  error?: unknown;
}

/**
 * PR 7.3b (docs/pr-7.3-plan.md §C 7.3b werk 2): cache-/serveractualiteit van
 * één listener-snapshot — spiegelt Firestore's eigen
 * `SnapshotMetadata.fromCache`/`hasPendingWrites` een-op-een, geen eigen
 * afgeleide staat. `GameCloudGateway.subscribeToGame()` geeft dit apart per
 * (parent-, actions-)listener door, omdat beide onafhankelijk uit cache of
 * server kunnen komen (bijv. de parent al server-bevestigd, de
 * actions-subcollectie nog niet).
 */
export interface GameCloudSnapshotMeta {
  fromCache: boolean;
  hasPendingWrites: boolean;
}

/** Eén update van het parentdocument via `subscribeToGame()`. `doc: null`
 * betekent "nog geen (leesbaar) document" — vóór de eerste `ensureGame()` van
 * de writer, of een tijdelijk niet-bestaand pad; nooit "verwijderd" (games
 * worden nooit hard-deleted, zie firestore.rules). */
export interface GameCloudParentUpdate {
  doc: GameDocument | null;
  meta: GameCloudSnapshotMeta;
}

/** Eén update van de volledige `actions`-subcollectie via `subscribeToGame()`
 * — altijd de VOLLEDIGE huidige set (geen incrementeel diff-contract), in
 * WILLEKEURIGE volgorde; de aanroeper sorteert zelf op `sequence`
 * (`domain/game/deriveGameStateFromCloud.ts` `sortCloudActions()`). */
export interface GameCloudActionsUpdate {
  actions: GameActionEnvelopeDocument[];
  meta: GameCloudSnapshotMeta;
}

export interface GameCloudSubscriptionCallbacks {
  onParent: (update: GameCloudParentUpdate) => void;
  onActions: (update: GameCloudActionsUpdate) => void;
  /**
   * Een listenerfout (bijv. een afgesloten Rules-toegang, een permanente
   * netwerkstoring) op ÉÉN van beide onderliggende listeners — de andere
   * listener blijft actief. De aanroeper toont dit als "laatst bekende stand,
   * niet meer live" (docs/pr-7.3-plan.md §C 7.3b werk 3/5) i.p.v. te crashen;
   * er is bewust GEEN automatische retry hier — dat is aan de aanroeper (een
   * hernieuwde `subscribeToGame()`-aanroep, bijv. na een handmatige retry-
   * knop of reconnect), zelfde terughoudendheid als elders in deze poort rond
   * automatische recovery (§D "Geen time-based auto-takeover").
   */
  onError: (error: unknown) => void;
}

/** Stopt beide onderliggende Firestore-listeners; idempotent (dubbel
 * aanroepen is een no-op, spiegelt de Firestore SDK's eigen `Unsubscribe`). */
export type GameCloudUnsubscribe = () => void;

export interface GameCloudGateway {
  /**
   * Maakt het parentdocument aan als het nog niet bestaat; een bestaand
   * document blijft ongemoeid (de bestaande `writerUid`/`deviceId`/
   * `revision` komen terug in het resultaat, zie `GameSnapshotWriteResult`).
   *
   * PR 7.1c-correctie op de PR 7.1a-poort: `gameId` ontbrak als parameter,
   * terwijl `GameSnapshotProjection`/`GameDocument` bewust geen eigen `id`-
   * veld dragen (`gameId` komt uit het Firestore-pad, exact zoals
   * `uploadActions()`/`patchSnapshot()` hieronder al wél expliciet doen) —
   * zonder dit veld was er geen adres om naar te schrijven. Nog geen enkele
   * implementatie bestond vóór PR 7.1c, dus dit is een zuivere aanvulling,
   * geen breaking change voor bestaande aanroepers.
   */
  ensureGame(
    organizationId: string,
    teamId: string,
    gameId: string,
    snapshot: GameSnapshotProjection,
  ): Promise<GameSnapshotWriteResult>;
  /**
   * PR 7.3a (docs/pr-7.3-plan.md §B/§C 7.3a werk 2): claimt een nog
   * ONGECLAIMD parentdocument voor `writer` — spiegelt firestore.rules'
   * 10b-pad. Faalt met `code: 'already-claimed'` als een ander apparaat het
   * document tussen `ensureGame()` en deze aanroep al claimde (race, zie
   * acceptatiecriterium "claimrace" in docs/pr-7.3-plan.md §C 7.3a), met
   * `code: 'stale-revision'` bij een verouderde `expectedRevision`, met
   * `code: 'role-denied'` als de aanroeper geen `canWriteGameData`-rol heeft,
   * en met `code: 'offline'` bij een timeout/netwerkfout. `now` is de
   * client-autoritatieve ISO-claimtijd (spiegelt `createdAt`/`startedAt` —
   * door de aanroeper berekend, niet hier, voor deterministische tests).
   */
  claimWriter(
    organizationId: string,
    teamId: string,
    gameId: string,
    writer: { authorUid: string; deviceId: string },
    expectedRevision: number,
    now: string,
  ): Promise<WriterClaimResult>;
  /**
   * PR 7.3a (docs/pr-7.3-plan.md §B/§C 7.3a werk 2): neemt een AL geclaimd
   * parentdocument over voor `writer` — spiegelt firestore.rules' 10d-pad.
   * `expectedEpoch` is het epoch dat de aanroeper op het moment van de
   * overnamebeslissing kende (uit een voorafgaande lezing, bijv. voor een
   * overname-bevestigingsscherm, 7.3c-scope) — de server verhoogt met exact
   * 1; een afwijkend serverepoch (een ANDERE overname won de race) faalt met
   * `code: 'already-claimed'`. Faalt verder met dezelfde codes als
   * `claimWriter()` hierboven (`stale-revision`/`role-denied`/`offline`), en
   * met `code: 'game-completed'` als de wedstrijd server-side al is
   * afgerond. Bewust GEEN tijd-/lease-conditie — overname is altijd
   * expliciet en online (§B), nooit automatisch na verstreken tijd.
   */
  takeoverWriter(
    organizationId: string,
    teamId: string,
    gameId: string,
    writer: { authorUid: string; deviceId: string },
    expectedEpoch: number,
    expectedRevision: number,
    now: string,
  ): Promise<WriterClaimResult>;
  /** Upload van nog onbevestigde action-envelopes; elk resultaat afzonderlijk idempotent. */
  uploadActions(
    organizationId: string,
    teamId: string,
    gameId: string,
    actions: readonly GameActionEnvelopeDocument[],
  ): Promise<GameActionUploadOutcome[]>;
  /** Patcht uitsluitend de meegegeven velden; faalt bij een revisiemismatch (concurrency). */
  patchSnapshot(
    organizationId: string,
    teamId: string,
    gameId: string,
    patch: Partial<GameSnapshotProjection>,
    expectedRevision: number,
  ): Promise<GameSnapshotWriteResult>;
  /**
   * PR 7.2a, P1-fix (externe review PR #61): rondt een wedstrijd atomisch af
   * — schrijft de completed-snapshot ÉN patcht `completedGameId` op het
   * parentdocument in dezelfde Firestore-`WriteBatch`, nooit als twee losse
   * writes. Zonder deze atomiciteit kon dezelfde writer meerdere
   * completed-snapshots voor één `gameId` aanmaken, of een crash tussen de
   * twee writes een orphan-snapshot achterlaten (een snapshot zonder
   * bijbehorende parentverwijzing). firestore.rules' `getAfter()`-check op
   * de `completedGames`-createregel (punt 16) dwingt af dat beide writes
   * altijd samen slagen of samen falen — dit is dus geen client-only
   * garantie. Faalt de batch (bijv. een verouderde `expectedRevision`, een
   * Rules-afwijzing, of — idempotent — een wedstrijd die server-side al
   * naar deze of een andere `completedGameId` is afgerond), dan is GEEN van
   * beide writes doorgekomen; de aanroeper retryt via een volledig nieuwe
   * `finalize()`-cyclus (die eerst opnieuw controleert of de wedstrijd
   * intussen al afgerond is, zie `GameSyncCoordinator.finalize()`).
   */
  finalizeCompletedGame(
    organizationId: string,
    teamId: string,
    gameId: string,
    completedGameId: string,
    snapshot: CompletedGameSnapshotProjection,
    expectedRevision: number,
  ): Promise<GameSnapshotWriteResult>;
  /**
   * PR 7.2c (docs/pr-7.2-plan.md §C 7.2c werk 1/2): patcht uitsluitend
   * `deletedAt`/`deletedBy`/`revision` op een bestaande completed-snapshot —
   * een toegestane tombstone-fieldpatch, geen hard delete (`allow delete`
   * blijft `false` in firestore.rules). De bevroren wedstrijdinhoud
   * (`players`/`segments`/`scoreFor`/... ) blijft letterlijk ongewijzigd;
   * firestore.rules dwingt dat af met een `diff(...).affectedKeys()
   * .hasOnly([...])`-allowlist op precies deze drie velden. Faalt bij een
   * revisiemismatch (concurrency, zelfde contract als `patchSnapshot()`) of
   * als het document al eerder getombstoned is (rules eisen
   * `resource.data.deletedAt == null` vóór de patch) — beide gevallen komen
   * hier terug als `ok: false`, nooit als partiële/onduidelijke staat.
   */
  tombstoneCompletedGame(
    organizationId: string,
    teamId: string,
    completedGameId: string,
    deletedBy: string,
    expectedRevision: number,
  ): Promise<CompletedGameTombstoneResult>;
  /**
   * PR 7.3b (docs/pr-7.3-plan.md §C 7.3b werk 2): live abonnement op parent +
   * `actions`-subcollectie voor een read-only viewer — de writer blijft altijd
   * request/response via de methoden hierboven (§B: "geen UI-await op
   * server"), dit pad is uitsluitend voor NIET-writers die willen meekijken.
   * Rules-read-toegang is ongewijzigd (`canReadTeam`, al vóór PR 7.3b geldig
   * voor elke teamrol inclusief 'viewer'), dus geen aparte Rules-uitbreiding
   * nodig. Retourneert direct een `GameCloudUnsubscribe` — de aanroeper hoeft
   * niet te wachten op de eerste snapshot om te kunnen afmelden (bijv. een
   * component die meteen weer unmount't).
   */
  subscribeToGame(
    organizationId: string,
    teamId: string,
    gameId: string,
    callbacks: GameCloudSubscriptionCallbacks,
  ): GameCloudUnsubscribe;
}

import type {
  CompletedGameDocument,
  GameActionEnvelopeDocument,
  GameDocument,
} from 'firebase-base/documents';

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
}

import type { GameActionEnvelopeDocument, GameDocument } from 'firebase-base/documents';

/**
 * Application-poort voor de cloudkant van het wedstrijdmodel (PR 7.1a,
 * docs/pr-7.1-plan.md §B/§C 7.1c). Nog niet geïmplementeerd: de Firestore-
 * adapter en de orkestrerende `GameSyncCoordinator` volgen in PR 7.1c.
 * UI-componenten en de bestaande synchrone `GameRepository` importeren deze
 * poort niet — alleen de (nog te bouwen) coordinator praat hiermee, net zoals
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
  error?: unknown;
}

export interface GameActionUploadOutcome {
  actionId: string;
  ok: boolean;
  /** `true` wanneer het action-document al bestond met een semantisch gelijke payload. */
  alreadyConfirmed?: boolean;
  error?: unknown;
}

export interface GameCloudGateway {
  /** Maakt het parentdocument aan als het nog niet bestaat; een bestaand document blijft ongemoeid. */
  ensureGame(snapshot: GameSnapshotProjection): Promise<GameSnapshotWriteResult>;
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
}

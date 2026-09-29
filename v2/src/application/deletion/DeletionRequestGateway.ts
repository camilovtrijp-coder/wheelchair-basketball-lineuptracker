import type { DeletionExportProof, DeletionRequest } from '../../domain/deletion/types';

/**
 * PR 8.3c-1 deel 2: application-poort voor `organizations/{orgId}/deletionRequests/current`.
 * Geïmplementeerd door `infrastructure/deletion/FirestoreDeletionRequestGateway.ts`.
 *
 * Geen enkele methode neemt een identiteit (uid/rol) of een documentpad aan: de
 * organisatie-ID is het enige pad-onderdeel, en de aanvrager is uitsluitend de
 * daadwerkelijk ingelogde Firebase Auth-sessie — dezelfde harde les als de
 * 8.3b-herreview over `callerUid` (een door de aanroeper meegegeven identiteit is
 * geen autorisatiegrens). Firestore Rules zijn de gezaghebbende grens.
 *
 * Elke schrijfmethode leest het document na het schrijven TERUG en levert dat op:
 * een succesmelding zonder serverreadback is geen bewijs, en `requestedAt` is een
 * servertijdstempel die de client zelf niet kent.
 */
export type DeletionRequestReadResult =
  | { ok: true; request: DeletionRequest | null }
  | { ok: false; error: { code: 'read-failed'; detail: unknown } };

export type DeletionRequestWriteError =
  /** Rules weigerden de write: rol verloren, verouderde revisie, of een niet-toegestane overgang. */
  | { code: 'rejected' }
  /** De write is (mogelijk) geslaagd, maar teruglezen mislukte of leverde een ongeldig document. */
  | { code: 'readback-failed'; detail: unknown }
  /** Niet ingelogd — nooit een gok naar een identiteit. */
  | { code: 'not-signed-in' }
  /**
   * Geen serverantwoord binnen de timeout. Firestore zet een offline write in de
   * wachtrij; die kan LATER alsnog slagen. Rules bewaken dat met de revisie- en
   * toestandscontrole (een verouderde write faalt), maar de UI moet de status
   * daarom opnieuw lezen in plaats van "mislukt" te melden.
   */
  | { code: 'timeout' }
  | { code: 'failed'; detail: unknown };

export type DeletionRequestWriteResult =
  { ok: true; request: DeletionRequest } | { ok: false; error: DeletionRequestWriteError };

export interface DeletionRequestGateway {
  read(organizationId: string): Promise<DeletionRequestReadResult>;

  /** Maakt `requested` aan (attempt 1, revision 0). Faalt bij een bestaand document. */
  create(
    organizationId: string,
    exportProof: DeletionExportProof,
  ): Promise<DeletionRequestWriteResult>;

  /** `requested → cancelled`, revisiebewaakt op het verwachte document. */
  cancel(organizationId: string, expected: DeletionRequest): Promise<DeletionRequestWriteResult>;

  /** `cancelled → requested` met `attempt + 1` en een vers bewijs, revisiebewaakt. */
  restart(
    organizationId: string,
    expected: DeletionRequest,
    exportProof: DeletionExportProof,
  ): Promise<DeletionRequestWriteResult>;
}

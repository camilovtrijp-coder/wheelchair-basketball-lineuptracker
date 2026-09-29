import type { OrganizationExportSectionCounts } from '../export/types';

/**
 * PR 8.3c-1 deel 2 (docs/pr-8.3c-besluitvoorstel.md §2.5): domeinmodel van
 * `organizations/{orgId}/deletionRequests/current`. Bewust GEEN Firebase-
 * afhankelijkheid (`domain/` importeert geen `firebase/*`): tijdstempels zijn
 * hier platte ISO-strings; de infrastructuurlaag zet Firestore `Timestamp`s om.
 */
export const DELETION_REQUEST_STATUSES = [
  'requested',
  'cancelled',
  'executing',
  'completed',
  'failed',
] as const;
export type DeletionRequestStatus = (typeof DELETION_REQUEST_STATUSES)[number];

/** De uitkomst van een geslaagde 8.3b-export — een UX-poort met vaste vorm, geen bewijs. */
export interface DeletionExportProof {
  contentHash: string;
  /** `toISOString()`-vorm, zoals `firestore.rules` afdwingt. */
  exportedAt: string;
  counts: OrganizationExportSectionCounts;
}

export interface DeletionRequest {
  organizationId: string;
  status: DeletionRequestStatus;
  /** Generatienummer van de poging; begint op 1, +1 bij elke herstart na annuleren. */
  attempt: number;
  requestedBy: string;
  requestedAt: string;
  exportProof: DeletionExportProof;
  cancelledAt: string | null;
  revision: number;
}

/**
 * Toestanden waarin een verzoek de organisatie "in beweging" heeft: een nieuw
 * verzoek is dan niet mogelijk. `cancelled` is de enige uitgang waarin de owner
 * opnieuw kan starten; `completed` betekent dat de organisatie niet meer bestaat.
 */
export function isOpenDeletionRequest(status: DeletionRequestStatus): boolean {
  return status !== 'cancelled';
}

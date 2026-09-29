import { buildOrganizationExport } from '../../domain/export/build';
import { verifyOrganizationExportRoundtrip } from '../../domain/export/roundtrip';
import type { OrganizationExportV1 } from '../../domain/export/types';
import { canRequestOrganizationDeletion } from '../../domain/deletion/capability';
import {
  assessOrganizationForDeletion,
  buildCleanupOverview,
  type CleanupOverview,
  type DeletionAssessment,
  type DeletionBlocker,
} from '../../domain/deletion/assessment';
import type { DeletionRequest } from '../../domain/deletion/types';
import type { OrganizationExportGateway } from '../export/OrganizationExportGateway';
import type { DeletionRequestGateway, DeletionRequestWriteError } from './DeletionRequestGateway';

export interface DeletionRequestInput {
  organizationId: string;
  /**
   * De owner heeft bevestigd dat de niet-afgeronde wedstrijden zónder recente
   * activiteit niet meer nodig zijn. Zonder deze bevestiging levert een aanvraag
   * met zulke wedstrijden `needs-acknowledgement` op in plaats van een verzoek.
   */
  acknowledgedStaleGames: boolean;
}

export type DeletionAssessmentOutcome =
  | { status: 'denied' }
  | { status: 'failed'; reason: 'organization-not-found' | 'read-failed' }
  | {
      status: 'ok';
      assessment: DeletionAssessment;
      cleanup: CleanupOverview;
      existingRequest: DeletionRequest | null;
    };

export type DeletionRequestOutcome =
  | { status: 'denied' }
  | { status: 'failed'; reason: 'organization-not-found' | 'read-failed' | 'roundtripFailed' }
  | { status: 'blocked'; blockers: DeletionBlocker[] }
  | { status: 'needs-acknowledgement'; staleGameCount: number }
  | { status: 'already-open'; request: DeletionRequest }
  /**
   * Een herstart vereist een strikt latere `exportedAt` dan de geannuleerde poging
   * (Rules). Als de klok van dit apparaat achterloopt, of een eerdere poging op een
   * apparaat met een vooruitlopende klok is gemaakt, kan dat niet slagen — dat is
   * een eigen, uitlegbare uitkomst en geen generieke Rules-weigering.
   */
  | { status: 'clock-behind'; previousExportedAt: string }
  | { status: 'write-failed'; error: DeletionRequestWriteError }
  | { status: 'ok'; request: DeletionRequest; export: OrganizationExportV1 };

export type DeletionCancelOutcome =
  | { status: 'denied' }
  | { status: 'failed'; reason: 'read-failed' }
  | { status: 'not-cancellable'; current: DeletionRequest | null }
  | { status: 'write-failed'; error: DeletionRequestWriteError }
  | { status: 'ok'; request: DeletionRequest };

/**
 * PR 8.3c-1 deel 2: orkestreert het owner-geïnitieerde verwijderverzoek
 * (docs/pr-8.3c-besluitvoorstel.md §2.5). Deze coordinator VERWIJDERT NIETS: hij
 * maakt, annuleert en herstart uitsluitend het verzoekdocument. Het wissen zelf is
 * een handmatige runbookactie met beheerdersrechten.
 *
 * Volgorde bij een aanvraag — elke stap faalt gesloten en stopt de flow:
 *   1. gezaghebbende aanroeper (echte Auth-sessie + eigen membership) moet owner zijn;
 *   2. ÉÉN volledige read van de organisatie (dezelfde als de 8.3b-export);
 *   3. harde blokkades uit diezelfde momentopname → `blocked`;
 *   4. waarschuwing voor verlaten wedstrijden → `needs-acknowledgement`;
 *   5. bestaand, niet-geannuleerd verzoek → `already-open`;
 *   6. export bouwen + lokale roundtrip → het `exportProof` komt uit DEZELFDE read
 *      als de blokkadecheck, nooit uit een tweede;
 *   7. create (of herstart na annuleren) en teruglezen.
 *
 * Het `exportProof` is een UX-poort, geen bewijs; het runbook draait vlak vóór het
 * wissen zelf opnieuw een volledige export (§2.5).
 */
export class DeletionRequestCoordinator {
  constructor(
    private readonly exportGateway: OrganizationExportGateway,
    private readonly requestGateway: DeletionRequestGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Read-only beoordeling voor de UI: blokkades, waarschuwingen, opruimoverzicht. */
  async assess(organizationId: string): Promise<DeletionAssessmentOutcome> {
    const caller = await this.exportGateway.readAuthoritativeCaller(organizationId);
    if (caller === null || !canRequestOrganizationDeletion(caller.role)) {
      return { status: 'denied' };
    }
    const read = await this.exportGateway.readOrganizationExportInput(organizationId);
    if (!read.ok) return { status: 'failed', reason: read.error.code };
    const existing = await this.requestGateway.read(organizationId);
    if (!existing.ok) return { status: 'failed', reason: 'read-failed' };

    const now = this.now();
    return {
      status: 'ok',
      assessment: assessOrganizationForDeletion(read.data, now),
      cleanup: buildCleanupOverview(read.data, now),
      existingRequest: existing.request,
    };
  }

  async request(input: DeletionRequestInput): Promise<DeletionRequestOutcome> {
    const { organizationId } = input;
    const caller = await this.exportGateway.readAuthoritativeCaller(organizationId);
    if (caller === null || !canRequestOrganizationDeletion(caller.role)) {
      return { status: 'denied' };
    }

    const read = await this.exportGateway.readOrganizationExportInput(organizationId);
    if (!read.ok) return { status: 'failed', reason: read.error.code };

    const now = this.now();
    const assessment = assessOrganizationForDeletion(read.data, now);
    if (assessment.blockers.length > 0) {
      return { status: 'blocked', blockers: assessment.blockers };
    }
    if (assessment.staleUnfinishedGames.length > 0 && !input.acknowledgedStaleGames) {
      return {
        status: 'needs-acknowledgement',
        staleGameCount: assessment.staleUnfinishedGames.length,
      };
    }

    const existing = await this.requestGateway.read(organizationId);
    if (!existing.ok) return { status: 'failed', reason: 'read-failed' };
    if (existing.request !== null && existing.request.status !== 'cancelled') {
      return { status: 'already-open', request: existing.request };
    }

    const built = buildOrganizationExport(read.data, {
      uid: caller.uid,
      role: caller.role,
      now: now.toISOString(),
    });
    if (!built.allowed) return { status: 'denied' };
    if (!verifyOrganizationExportRoundtrip(built.export)) {
      return { status: 'failed', reason: 'roundtripFailed' };
    }

    const exportProof = {
      contentHash: built.export.contentHash,
      exportedAt: built.export.exportedAt,
      counts: built.export.counts,
    };

    let written;
    if (existing.request === null) {
      written = await this.requestGateway.create(organizationId, exportProof);
    } else {
      // Een herstart eist een strikt latere `exportedAt` (Rules). ISO-strings met
      // vaste vorm vergelijken chronologisch; zie firestore.rules.
      if (exportProof.exportedAt <= existing.request.exportProof.exportedAt) {
        return {
          status: 'clock-behind',
          previousExportedAt: existing.request.exportProof.exportedAt,
        };
      }
      written = await this.requestGateway.restart(organizationId, existing.request, exportProof);
    }

    if (!written.ok) return { status: 'write-failed', error: written.error };
    return { status: 'ok', request: written.request, export: built.export };
  }

  /** Annuleert een `requested`-verzoek; elk ander bestaand document is niet annuleerbaar. */
  async cancel(organizationId: string): Promise<DeletionCancelOutcome> {
    const caller = await this.exportGateway.readAuthoritativeCaller(organizationId);
    if (caller === null || !canRequestOrganizationDeletion(caller.role)) {
      return { status: 'denied' };
    }
    const existing = await this.requestGateway.read(organizationId);
    if (!existing.ok) return { status: 'failed', reason: 'read-failed' };
    if (existing.request === null || existing.request.status !== 'requested') {
      return { status: 'not-cancellable', current: existing.request };
    }
    const written = await this.requestGateway.cancel(organizationId, existing.request);
    if (!written.ok) return { status: 'write-failed', error: written.error };
    return { status: 'ok', request: written.request };
  }
}

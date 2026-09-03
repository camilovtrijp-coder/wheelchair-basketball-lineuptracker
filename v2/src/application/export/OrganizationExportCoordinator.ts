import { buildOrganizationExport } from '../../domain/export/build';
import { canExportOrganization, type OrganizationExportV1 } from '../../domain/export/types';
import { verifyOrganizationExportRoundtrip } from '../../domain/export/roundtrip';
import type { OrganizationRole } from '../../domain/organizations/types';
import type { OrganizationExportGateway } from './OrganizationExportGateway';

export interface OrganizationExportRequest {
  organizationId: string;
  callerUid: string;
  callerRole: OrganizationRole;
}

export type OrganizationExportOutcome =
  | { status: 'denied' }
  | { status: 'failed'; reason: 'organization-not-found' | 'read-failed' | 'roundtripFailed' }
  | { status: 'ok'; export: OrganizationExportV1 };

/**
 * PR 8.3b (docs/pr-8.3-plan.md §C 8.3b werk 3): orkestreert
 * "capability-/contextcheck → inventarisatie → reads → validatie →
 * aantallen/hash → lokale roundtrip → download". Bewust GEEN eigen writes —
 * dit blijft, net als `GameSyncCoordinator`/`MigrationCoordinator`, een
 * application-poort-orkestrator zonder rechtstreeks Firebase-import.
 *
 * De capabilitycheck gebeurt HIER al, vóór `gateway.readOrganizationExportInput()`
 * wordt aangeroepen — plan §C 8.3b acceptatie: "admin/coach/scorer/viewer en
 * cross-org-aanvallers krijgen geen exportactie EN GEEN LEESRESULTAAT". Een
 * niet-owner mag dus nooit één Firestore-read veroorzaken via deze
 * coordinator, laat staan een resultaat terugkrijgen.
 * `buildOrganizationExport()` herhaalt exact dezelfde check als
 * defense-in-depth (nooit één enkel controlepunt vertrouwen), niet als
 * vervanging van de check hier.
 */
export class OrganizationExportCoordinator {
  constructor(
    private readonly gateway: OrganizationExportGateway,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async run(request: OrganizationExportRequest): Promise<OrganizationExportOutcome> {
    if (!canExportOrganization(request.callerRole)) {
      return { status: 'denied' };
    }

    const read = await this.gateway.readOrganizationExportInput(request.organizationId);
    if (!read.ok) {
      return {
        status: 'failed',
        reason:
          read.error.code === 'organization-not-found' ? 'organization-not-found' : 'read-failed',
      };
    }

    const built = buildOrganizationExport(read.data, {
      uid: request.callerUid,
      role: request.callerRole,
      now: this.now(),
    });
    if (!built.allowed) {
      return { status: 'denied' };
    }

    if (!verifyOrganizationExportRoundtrip(built.export)) {
      return { status: 'failed', reason: 'roundtripFailed' };
    }

    return { status: 'ok', export: built.export };
  }
}

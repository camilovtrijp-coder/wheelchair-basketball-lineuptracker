import { buildOrganizationExport } from '../../domain/export/build';
import { canExportOrganization, type OrganizationExportV1 } from '../../domain/export/types';
import { verifyOrganizationExportRoundtrip } from '../../domain/export/roundtrip';
import type { OrganizationExportGateway } from './OrganizationExportGateway';

export interface OrganizationExportRequest {
  organizationId: string;
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
 * Herreview PR #89 (P1, tweede ronde): `OrganizationExportRequest` draagt
 * bewust GEEN `callerRole` EN GEEN `callerUid` meer. Een door de aanroeper
 * meegegeven identiteit (bijv. React-component-state) is geen betrouwbare
 * autorisatiegrens: Firestore Rules staan elk orglid toe om ELK
 * `organizationMembers/{uid}`-document binnen die organisatie te lezen
 * (`isOrgMember()`), dus zelfs een expliciete `callerUid`-parameter kon een
 * `organizationAdmin` gewoon vervangen door de OWNER's uid en zo alsnog een
 * `'organizationOwner'`-resultaat krijgen. De capabilitycheck gebeurt daarom
 * HIER, vóór `gateway.readOrganizationExportInput()`, op de uid+rol die
 * `gateway.readAuthoritativeCaller()` ZELF uit de daadwerkelijk ingelogde
 * Firebase Auth-sessie + diens `organizationMembers/{uid}`-document afleidt
 * — plan §C 8.3b acceptatie: "admin/coach/scorer/viewer en
 * cross-org-aanvallers krijgen geen exportactie EN GEEN LEESRESULTAAT". Een
 * niet-owner mag dus nooit één inventarisatie-Firestore-read veroorzaken via
 * deze coordinator, laat staan een resultaat terugkrijgen.
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
    const caller = await this.gateway.readAuthoritativeCaller(request.organizationId);
    if (caller === null || !canExportOrganization(caller.role)) {
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
      uid: caller.uid,
      role: caller.role,
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

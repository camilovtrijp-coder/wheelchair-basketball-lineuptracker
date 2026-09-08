import type { RawOrganizationExportInput } from '../../domain/export/build';
import type { OrganizationRole } from '../../domain/organizations/types';

/**
 * PR 8.3b (docs/pr-8.3-plan.md §C 8.3b werk 2): application-poort voor de
 * read-only inventarisatie van een volledige organisatie-export. Geïmplementeerd
 * door `infrastructure/export/FirestoreOrganizationExportGateway.ts`. Spiegelt
 * `application/migration/CloudMigrationInventoryGateway.ts`'s vorm — één
 * methode, puur lezen, geen enkele write.
 *
 * `error` draagt een korte, technische reden (nooit spelers-/membergegevens —
 * dit is een resultaat, geen geëxporteerd bestand) zodat de coordinator een
 * begrijpelijke NL/EN-melding kan tonen zonder zelf Firestore-foutcodes te
 * hoeven kennen.
 */
export type OrganizationExportReadError =
  { code: 'organization-not-found' } | { code: 'read-failed'; detail: unknown };

export type OrganizationExportReadResult =
  | { ok: true; data: RawOrganizationExportInput }
  | { ok: false; error: OrganizationExportReadError };

export interface OrganizationExportGateway {
  /**
   * Leest ALLE gegevensfamilies uit plan §A voor `organizationId`, over ALLE
   * teams van die organisatie. Faalt in zijn geheel (`ok: false`) zodra één
   * verwachte read of documentconversie mislukt — nooit een gedeeltelijk
   * resultaat: plan §C 8.3b acceptatie: "corrupte of deels onleesbare
   * clouddata kan niet als geslaagde export eindigen".
   */
  readOrganizationExportInput(organizationId: string): Promise<OrganizationExportReadResult>;

  /**
   * Herreview PR #89 (P1, tweede ronde): noch een door de aanroeper
   * meegegeven `callerRole`, NOCH een door de aanroeper meegegeven
   * `callerUid` is een betrouwbare autorisatiegrens. Rules staan elk orglid
   * toe om ELK `organizationMembers/{uid}`-document binnen die organisatie
   * te lezen (`isOrgMember()`) — een `organizationAdmin` kon dus eerder
   * gewoon de OWNER's uid als `callerUid` meegeven en zo alsnog
   * `'organizationOwner'` terugkrijgen. Deze methode neemt daarom GEEN
   * identiteitsparameter aan: de implementatie bepaalt zelf, uit de
   * daadwerkelijk ingelogde Firebase Auth-sessie, wie de aanroeper is (zie
   * `FirestoreOrganizationExportGateway.readAuthoritativeCaller()`) en leest
   * DIENS eigen `organizationMembers/{uid}`-document. `null` bij
   * niet-ingelogd, geen lidmaatschap, of een corrupte/onleesbare read — de
   * coordinator gebruikt UITSLUITEND dit resultaat, nooit een door de
   * aanroeper meegegeven rol of uid.
   */
  readAuthoritativeCaller(
    organizationId: string,
  ): Promise<{ uid: string; role: OrganizationRole } | null>;
}

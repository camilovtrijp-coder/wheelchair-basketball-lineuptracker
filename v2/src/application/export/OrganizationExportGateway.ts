import type { RawOrganizationExportInput } from '../../domain/export/build';

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
}

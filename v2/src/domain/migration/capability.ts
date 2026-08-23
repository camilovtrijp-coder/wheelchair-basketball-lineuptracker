import type { OrganizationRole } from '../organizations/types';
import { payloadHash } from './fingerprint';

/**
 * PR 7.4a (docs/pr-7.4-plan.md §B/§C 7.4a werk 4): pure bevoegdheids-
 * predikaat, mirrort de kleine, pure `canStartGame()`-stijl uit
 * `domain/game/writerClaim.ts` — geen Firebase-/UI-import. §B: "Alleen
 * `organizationOwner`, `organizationAdmin` en `coach` mogen bulk-migreren.
 * `scorer` mag wedstrijden bedienen via 7.3 maar niet een heel team
 * migreren of bulk verwijderen; `viewer` blijft read-only." Bewust een
 * EIGEN allowlist, geen hergebruik van `domain/organizations/teamAccess.ts`'s
 * `canManageTeamData` — die twee zijn vandaag toevallig identiek qua rollen,
 * maar drukken een ander CONCEPT uit (roster/instellingen beheren vs. een
 * volledige bulkmigratie starten); als één van beide ooit uiteenloopt
 * (bijv. een toekomstige aparte "migratie"-rol) mag dat de ander niet
 * stilzwijgend meeveranderen. 7.4b roept dit EXACT dezelfde predikaat
 * opnieuw aan vlak vóór bevestiging (plan werk 4: "Controleer capability en
 * context zowel bij preview als vlak voor bevestiging").
 */
const BULK_MIGRATION_ROLES: ReadonlySet<OrganizationRole> = new Set([
  'organizationOwner',
  'organizationAdmin',
  'coach',
]);

export function canBulkMigrate(role: OrganizationRole): boolean {
  return BULK_MIGRATION_ROLES.has(role);
}

/**
 * De exacte context waaraan een `CloudMigrationPreview` gebonden is (plan
 * werk 4: "een rol- of contextwissel maakt de preview ongeldig"). `role` is
 * hier bewust de rol van de AANROEPER in de DOELcontext (niet de bron) —
 * bulkmigratie-bevoegdheid wordt op het doelteam gecontroleerd (daar wordt
 * geschreven), zie `preview.ts`.
 */
export interface MigrationCallerContext {
  organizationId: string;
  teamId: string;
  role: OrganizationRole;
}

export type MigrationContextFingerprint = string;

/**
 * Puur, deterministisch: dezelfde `(organizationId, teamId, role)` levert
 * altijd dezelfde vingerafdruk op — gebruikt door zowel `preview.ts` (om de
 * preview eraan te binden) als `isPreviewStillValid()` hieronder (om een
 * latere context tegen die binding te toetsen).
 */
export function computeMigrationContextFingerprint(
  ctx: MigrationCallerContext,
): MigrationContextFingerprint {
  return payloadHash({ organizationId: ctx.organizationId, teamId: ctx.teamId, role: ctx.role });
}

/**
 * `true` als een eerder gebouwde preview (via zijn bewaarde
 * `contextFingerprint`) nog geldig is voor de HUIDIGE aanroepercontext.
 * Elke wissel — ander team, andere organisatie, of een rolwijziging binnen
 * dezelfde context (bijv. een gedegradeerde coach) — levert een andere
 * vingerafdruk op en maakt de preview dus ongeldig; de aanroeper (7.4b) moet
 * dan een verse preview bouwen vóór bevestiging, nooit de oude hergebruiken.
 */
export function isPreviewStillValid(
  previewContextFingerprint: MigrationContextFingerprint,
  current: MigrationCallerContext,
): boolean {
  return previewContextFingerprint === computeMigrationContextFingerprint(current);
}

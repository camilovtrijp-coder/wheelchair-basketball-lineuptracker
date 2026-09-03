import type { OrganizationRole } from '../organizations/types';

/**
 * PR 8.3b (docs/pr-8.3-plan.md §C 8.3b): pure datatypes voor de volledige
 * organisatie-export. Geen Firebase-/storage-import — zie `build.ts` voor de
 * bouwfunctie en `application/export/OrganizationExportGateway.ts` voor de
 * (infrastructure-geleverde) invoer. Elke rij is een reeds-gevalideerd,
 * JSON-veilig object: de infrastructure-laag heeft Firestore-converters en
 * Timestamp→ISO-conversie al toegepast vóórdat deze module iets ziet — een
 * rij die hier binnenkomt is per definitie geldig (fail-closed gebeurt in de
 * coordinator, vóór `buildOrganizationExport()` wordt aangeroepen: zie
 * `application/export/OrganizationExportCoordinator.ts`).
 *
 * Bewust GEEN per-veld interfaces voor elke van de elf gegevensfamilies
 * (organizationMembers/invitations/teamMembers/settings/roster/games/
 * actions/completedGames/migrationRuns): dat zou de bestaande
 * `firebase-base/documents`-converterinterfaces (die de echte, afgedwongen
 * shape al vastleggen) een tweede keer dupliceren. In plaats daarvan draagt
 * elke rij hier de converter-uitvoer 1:1 als `OrganizationExportRow`
 * (`Record<string, unknown>`), met Firestore `Timestamp`-velden al omgezet
 * naar ISO-stringvelden door de gateway — hetzelfde patroon als
 * `domain/roster/types.ts`'s `RosterPlayer` (bekende + evt. onbekende
 * velden) i.p.v. een volledig getypeerde tweede kopie.
 */
export type OrganizationExportRow = Record<string, unknown>;

export interface OrganizationExportOrganizationSection {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

/** Eén team en al zijn subcollecties, zoals gelezen op het moment van export. */
export interface OrganizationExportTeamSection {
  teamId: string;
  name: string;
  orgName: string;
  createdBy: string;
  createdAt: string;
  teamMembers: OrganizationExportRow[];
  /** `null` == er is (nog) geen `settings/current`-document. */
  settings: OrganizationExportRow | null;
  /** `null` == er is (nog) geen `roster/current`-document. */
  roster: OrganizationExportRow[] | null;
  /** Actieve (niet-afgeronde) `games/{gameId}`-documenten, elk met zijn eigen `actions`-subcollectie ingesloten. */
  games: (OrganizationExportRow & { actions: OrganizationExportRow[] })[];
  /** Bevat ook getombstonede (`deletedAt != null`) items — zie plan §A: tombstones horen bij de exportinventaris. */
  completedGames: OrganizationExportRow[];
  migrationRuns: OrganizationExportRow[];
}

export interface OrganizationExportSectionCounts {
  organizationMembers: number;
  invitations: number;
  teams: number;
  teamMembers: number;
  settingsDocuments: number;
  rosterPlayers: number;
  games: number;
  gameActions: number;
  completedGames: number;
  migrationRuns: number;
}

export type OrganizationExportDenialReason = 'roleDenied';

export interface OrganizationExportV1 {
  schemaVersion: 1;
  exportedAt: string;
  exportedBy: string;
  organization: OrganizationExportOrganizationSection;
  /** Ook ingetrokken/geclaimde uitnodigingen (plan §A) — geen statusfilter. */
  invitations: OrganizationExportRow[];
  organizationMembers: OrganizationExportRow[];
  teams: OrganizationExportTeamSection[];
  counts: OrganizationExportSectionCounts;
  /**
   * Content-hash over alles behalve `exportedAt` (zelfde reden als
   * `CloudMigrationPreview.manifestHash`: dezelfde brondata op een ander
   * moment geëxporteerd levert dezelfde hash op — nodig voor de herstelproef
   * uit plan werk 6, "vergelijk canonieke inventaris + hashes").
   */
  contentHash: string;
}

/** Puur bevoegdheidspredikaat (plan §C 8.3b acceptatie: "owner slaagt; admin/coach/scorer/viewer
 * ... krijgen geen exportactie") — bewust een eigen, smallere allowlist dan
 * `domain/migration/capability.ts`'s `canBulkMigrate()`: een volledige organisatie-export is een
 * ander, gevoeliger concept (bevat alle membership-e-mails van de hele organisatie) dan een
 * team-bulkmigratie, en mag niet stilzwijgend meeveranderen als die ooit uiteenlopen. */
export function canExportOrganization(role: OrganizationRole): boolean {
  return role === 'organizationOwner';
}

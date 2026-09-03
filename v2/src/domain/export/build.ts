import type { OrganizationRole } from '../organizations/types';
import { payloadHash } from '../migration/fingerprint';
import {
  ORGANIZATION_EXPORT_TYPE,
  canExportOrganization,
  type OrganizationExportDenialReason,
  type OrganizationExportOrganizationSection,
  type OrganizationExportRow,
  type OrganizationExportTeamSection,
  type OrganizationExportV1,
} from './types';

/** Eén team, exact zoals de gateway 'm read-only inventariseert — zie
 * `application/export/OrganizationExportGateway.ts`. */
export interface RawOrganizationExportTeam {
  teamId: string;
  name: string;
  orgName: string;
  createdBy: string;
  createdAt: string;
  teamMembers: OrganizationExportRow[];
  settings: OrganizationExportRow | null;
  /** Het volledige `roster/current`-document (`{ id: 'current', players,
   * updatedAt }`), niet alleen de kale `players`-array — zie de docstring bij
   * `OrganizationExportTeamSection.roster` in `types.ts`. */
  roster: OrganizationExportRow | null;
  games: (OrganizationExportRow & { actions: OrganizationExportRow[] })[];
  completedGames: OrganizationExportRow[];
  migrationRuns: OrganizationExportRow[];
}

function rowId(row: OrganizationExportRow): string {
  return String(row.id ?? '');
}

/**
 * Herreview PR #87 (P2): de gateway leest elke collectie zonder `orderBy()`
 * — Firestore garandeert dan GEEN stabiele volgorde, dus dezelfde inhoud kan
 * op twee reads in verschillende volgorde terugkomen. `payloadHash()` hasht
 * arrays bewust WEL ordergevoelig (zie `fingerprint.ts`'s `stableStringify()`
 * — alleen objectSLEUTELS worden gesorteerd, array-elementvolgorde niet,
 * want die IS betekenisvol voor bijv. wedstrijdactiesequenties). Zonder een
 * canonieke sortering hier zou `contentHash` dus per read kunnen wisselen
 * zonder dat de inhoud echt veranderde — reproduceerbaar lokaal aangetoond
 * (`42982aa5 != f8b2cf2b` voor dezelfde leden in omgekeerde volgorde). Sorteer
 * daarom elke collectieachtige rij canoniek op zijn Firestore-document-ID.
 */
function sortByKey<T>(rows: T[], keyOf: (row: T) => string): T[] {
  return [...rows].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/**
 * Wedstrijdacties hebben WEL een betekenisvolle eigen volgorde (hun
 * `sequence`-veld, dezelfde die `FirestoreGameCloudGateway`'s eigen
 * `orderBy('sequence')`-listener gebruikt) — die mag dus NIET op document-ID
 * gesorteerd worden (herreview PR #87, P2: "behoud alleen volgorde waar die
 * domeinbetekenis heeft"). De gateway leest ook déze subcollectie zonder
 * `orderBy()`, dus expliciet op `sequence` sorteren is hier nodig om
 * diezelfde ordergevoelige hash deterministisch te maken.
 */
function sortActionsBySequence(actions: OrganizationExportRow[]): OrganizationExportRow[] {
  return [...actions].sort((a, b) => {
    const sa = typeof a.sequence === 'number' ? a.sequence : 0;
    const sb = typeof b.sequence === 'number' ? b.sequence : 0;
    return sa - sb;
  });
}

/** `roster` is nu het volledige `{ id: 'current', players, updatedAt }`-document (zie boven). */
function rosterPlayerCount(roster: OrganizationExportRow | null): number {
  if (roster === null) return 0;
  return Array.isArray(roster.players) ? roster.players.length : 0;
}

/**
 * Reeds-gelezen, reeds-gevalideerde brondata voor de hele organisatie — de
 * coordinator (application-laag) levert dit aan na alle Firestore-reads; deze
 * module doet zelf geen enkele I/O (plan werk 3: "capability-/contextcheck →
 * inventarisatie → reads → validatie → aantallen/hash → lokale roundtrip →
 * download" — dit is uitsluitend het "aantallen/hash"-deel, puur en
 * deterministisch getest).
 */
export interface RawOrganizationExportInput {
  organization: OrganizationExportOrganizationSection;
  organizationMembers: OrganizationExportRow[];
  invitations: OrganizationExportRow[];
  teams: RawOrganizationExportTeam[];
}

export interface OrganizationExportCallerContext {
  uid: string;
  role: OrganizationRole;
  now: string;
}

export type OrganizationExportBuildResult =
  | { allowed: true; export: OrganizationExportV1 }
  | { allowed: false; denialReason: OrganizationExportDenialReason };

function toTeamSection(team: RawOrganizationExportTeam): OrganizationExportTeamSection {
  return {
    teamId: team.teamId,
    name: team.name,
    orgName: team.orgName,
    createdBy: team.createdBy,
    createdAt: team.createdAt,
    teamMembers: sortByKey(team.teamMembers, rowId),
    settings: team.settings,
    // `roster.players`' eigen volgorde is domeinbetekenisvol (bijv.
    // rugnummervolgorde) en blijft daarom ongewijzigd — het is bovendien één
    // enkel document (geen collectie), dus er is geen Firestore-readorder om
    // te canoniseren.
    roster: team.roster,
    games: sortByKey(team.games, rowId).map((game) => ({
      ...game,
      actions: sortActionsBySequence(game.actions),
    })),
    completedGames: sortByKey(team.completedGames, rowId),
    migrationRuns: sortByKey(team.migrationRuns, rowId),
  };
}

/**
 * Puur, deterministisch: dezelfde `input`+`caller` (op `now` na, dat alleen
 * in `exportedAt` belandt en buiten `contentHash` valt) levert altijd
 * dezelfde `OrganizationExportV1` op. Weigert (`allowed: false`) vóór er ook
 * maar één veld wordt samengesteld als de aanroeper geen
 * `canExportOrganization()`-rol heeft — plan §C 8.3b acceptatie: "admin/
 * coach/scorer/viewer en cross-org-aanvallers krijgen geen exportactie en
 * geen leesresultaat", dus geen enkel org-intern gegeven (ook geen
 * membership-e-mail) mag ooit in een geweigerd resultaat verschijnen.
 */
export function buildOrganizationExport(
  input: RawOrganizationExportInput,
  caller: OrganizationExportCallerContext,
): OrganizationExportBuildResult {
  if (!canExportOrganization(caller.role)) {
    return { allowed: false, denialReason: 'roleDenied' };
  }

  const teams = sortByKey(input.teams.map(toTeamSection), (t) => t.teamId);
  const organizationMembers = sortByKey(input.organizationMembers, rowId);
  const invitations = sortByKey(input.invitations, rowId);

  const counts = {
    organizationMembers: organizationMembers.length,
    invitations: invitations.length,
    teams: teams.length,
    teamMembers: teams.reduce((sum, t) => sum + t.teamMembers.length, 0),
    settingsDocuments: teams.reduce((sum, t) => sum + (t.settings === null ? 0 : 1), 0),
    rosterPlayers: teams.reduce((sum, t) => sum + rosterPlayerCount(t.roster), 0),
    games: teams.reduce((sum, t) => sum + t.games.length, 0),
    gameActions: teams.reduce(
      (sum, t) => sum + t.games.reduce((gameSum, g) => gameSum + g.actions.length, 0),
      0,
    ),
    completedGames: teams.reduce((sum, t) => sum + t.completedGames.length, 0),
    migrationRuns: teams.reduce((sum, t) => sum + t.migrationRuns.length, 0),
  };

  const sourceContext = {
    organizationId: input.organization.id,
    organizationName: input.organization.name,
  };

  const contentHash = payloadHash({
    type: ORGANIZATION_EXPORT_TYPE,
    sourceContext,
    completeness: 'complete',
    organization: input.organization,
    organizationMembers,
    invitations,
    teams,
    counts,
  });

  const result: OrganizationExportV1 = {
    type: ORGANIZATION_EXPORT_TYPE,
    schemaVersion: 1,
    exportedAt: caller.now,
    exportedBy: caller.uid,
    sourceContext,
    completeness: 'complete',
    organization: input.organization,
    organizationMembers,
    invitations,
    teams,
    counts,
    contentHash,
  };
  return { allowed: true, export: result };
}

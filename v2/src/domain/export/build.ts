import type { OrganizationRole } from '../organizations/types';
import { payloadHash } from '../migration/fingerprint';
import {
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
  roster: OrganizationExportRow[] | null;
  games: (OrganizationExportRow & { actions: OrganizationExportRow[] })[];
  completedGames: OrganizationExportRow[];
  migrationRuns: OrganizationExportRow[];
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
    teamMembers: team.teamMembers,
    settings: team.settings,
    roster: team.roster,
    games: team.games,
    completedGames: team.completedGames,
    migrationRuns: team.migrationRuns,
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

  const teams = input.teams.map(toTeamSection);

  const counts = {
    organizationMembers: input.organizationMembers.length,
    invitations: input.invitations.length,
    teams: teams.length,
    teamMembers: teams.reduce((sum, t) => sum + t.teamMembers.length, 0),
    settingsDocuments: teams.reduce((sum, t) => sum + (t.settings === null ? 0 : 1), 0),
    rosterPlayers: teams.reduce((sum, t) => sum + (t.roster?.length ?? 0), 0),
    games: teams.reduce((sum, t) => sum + t.games.length, 0),
    gameActions: teams.reduce(
      (sum, t) => sum + t.games.reduce((gameSum, g) => gameSum + g.actions.length, 0),
      0,
    ),
    completedGames: teams.reduce((sum, t) => sum + t.completedGames.length, 0),
    migrationRuns: teams.reduce((sum, t) => sum + t.migrationRuns.length, 0),
  };

  const contentHash = payloadHash({
    organization: input.organization,
    organizationMembers: input.organizationMembers,
    invitations: input.invitations,
    teams,
    counts,
  });

  const result: OrganizationExportV1 = {
    schemaVersion: 1,
    exportedAt: caller.now,
    exportedBy: caller.uid,
    organization: input.organization,
    organizationMembers: input.organizationMembers,
    invitations: input.invitations,
    teams,
    counts,
    contentHash,
  };
  return { allowed: true, export: result };
}

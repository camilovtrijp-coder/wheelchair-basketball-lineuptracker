import type { RawOrganizationExportInput } from '../export/build';
import type { OrganizationExportRow } from '../export/types';

/**
 * PR 8.3c-1 deel 2: pure beoordeling van een organisatie op basis van
 * EXACT dezelfde read-only invoer als de 8.3b-export
 * (`RawOrganizationExportInput`) — geen enkele extra Firestore-read. Twee
 * uitkomsten uit één functie-aanroep zorgen dat de blokkades, waarschuwingen en
 * het opruimoverzicht altijd over dezelfde momentopname gaan als het
 * `exportProof` van het verzoek.
 *
 * Alle termijnen komen uit docs/pr-8.3c-besluitvoorstel.md §2.5/§3.2/§3.4 en
 * spiegelen de Rules-ondergrenzen in `firebase/firestore.rules`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Een niet-afgeronde wedstrijd met activiteit binnen dit venster blokkeert een verzoek hard (§2.5). */
export const RECENT_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const INVITATION_RETENTION_DAYS = 30;
export const TOMBSTONE_RETENTION_DAYS = 90;
export const ABANDONED_GAME_DAYS = 180;
export const MIGRATION_RUN_RETENTION_DAYS = 90;

export type DeletionBlocker =
  | { code: 'recent-active-game'; teamId: string; gameId: string }
  | { code: 'migration-run-not-terminal'; teamId: string; runId: string };

export interface DeletionAssessment {
  /** Harde blokkades — geen override in de app; alleen het runbook kent er een. */
  blockers: DeletionBlocker[];
  /**
   * Niet-afgeronde wedstrijden zonder recente activiteit: geen blokkade, wel een
   * expliciet te bevestigen waarschuwing (anders maakt één vergeten wedstrijd een
   * organisatie permanent onverwijderbaar).
   */
  staleUnfinishedGames: { teamId: string; gameId: string }[];
  /**
   * Leden met uitsluitend een `teamMembers`-rij (geen `organizationMembers`-rij).
   * Zij lezen `deletionRequests/current` niet en zien dus geen banner: de owner
   * moet dit aantal in de bevestiging zien en hen handmatig informeren
   * (geaccepteerd restrisico, besluitrecord §8.3).
   */
  teamOnlyMemberCount: number;
}

export interface CleanupOverview {
  /** Getombstonede wedstrijden ouder dan 90 dagen die nog niet geredigeerd zijn. */
  redactableTombstones: number;
  /** Uitnodigingen ouder dan 30 dagen, per status en gemeten aan het tijdstempel van díé status. */
  removableInvitations: { pending: number; accepted: number; claimed: number; revoked: number };
  /** Niet-afgeronde wedstrijden zonder activiteit gedurende meer dan 180 dagen. */
  abandonedGames: number;
  /** Afgeronde migratieruns ouder dan 90 dagen. */
  expiredMigrationRuns: number;
}

/** Parseert een ISO-string; `null` bij niets of iets onleesbaars. */
function parseMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function ageMs(now: number, value: unknown): number | null {
  const ms = parseMs(value);
  return ms === null ? null : now - ms;
}

function isUnfinished(game: OrganizationExportRow): boolean {
  return game.completedGameId === null || game.completedGameId === undefined;
}

/**
 * Eén regel, fail-closed: geen tijdstempel, een onleesbaar tijdstempel of een
 * tijdstempel in de TOEKOMST (klokafwijking) telt als "recent". Liever een
 * onterechte blokkade dan een stil verlies van niet-gesynchroniseerde data.
 */
function hasRecentActivity(game: OrganizationExportRow, now: number): boolean {
  const activity = game.lastWriterActivityAt;
  if (activity === null || activity === undefined) return false;
  const age = ageMs(now, activity);
  if (age === null) return true;
  return age <= RECENT_ACTIVITY_WINDOW_MS;
}

export function assessOrganizationForDeletion(
  input: RawOrganizationExportInput,
  now: Date,
): DeletionAssessment {
  const nowMs = now.getTime();
  const blockers: DeletionBlocker[] = [];
  const staleUnfinishedGames: { teamId: string; gameId: string }[] = [];

  for (const team of input.teams) {
    for (const game of team.games) {
      if (!isUnfinished(game)) continue;
      const gameId = String(game.id ?? '');
      if (hasRecentActivity(game, nowMs)) {
        blockers.push({ code: 'recent-active-game', teamId: team.teamId, gameId });
      } else {
        staleUnfinishedGames.push({ teamId: team.teamId, gameId });
      }
    }
    for (const run of team.migrationRuns) {
      // Alleen `completed` is terminaal. Alles anders — `paused`, `actionNeeded`,
      // `compensationFailed` én een ontbrekende of onbekende status — blokkeert:
      // een half uitgevoerde migratie verwijderen laat een onbeoordeelbare
      // situatie achter (§2.5).
      if (run.status !== 'completed') {
        blockers.push({
          code: 'migration-run-not-terminal',
          teamId: team.teamId,
          runId: String(run.id ?? ''),
        });
      }
    }
  }

  const orgMemberUids = new Set(
    input.organizationMembers.map((member) => String(member.uid ?? member.id ?? '')),
  );
  const teamOnlyUids = new Set<string>();
  for (const team of input.teams) {
    for (const member of team.teamMembers) {
      const uid = String(member.uid ?? member.id ?? '');
      if (uid !== '' && !orgMemberUids.has(uid)) teamOnlyUids.add(uid);
    }
  }

  return { blockers, staleUnfinishedGames, teamOnlyMemberCount: teamOnlyUids.size };
}

/**
 * Het tijdstempel waar de 30-dagengrens van een uitnodiging aan hangt — exact de
 * `invitationRetentionAnchor()` uit `firestore.rules`: het tijdstempel van de
 * HUIDIGE status, met terugval op `invitedAt` wanneer dat ontbreekt.
 */
function invitationAnchor(invitation: OrganizationExportRow): unknown {
  const status = invitation.status;
  if (status === 'claimed' && invitation.claimedAt != null) return invitation.claimedAt;
  if (status === 'accepted' && invitation.acceptedAt != null) return invitation.acceptedAt;
  if (status === 'revoked' && invitation.revokedAt != null) return invitation.revokedAt;
  return invitation.invitedAt;
}

export function buildCleanupOverview(
  input: RawOrganizationExportInput,
  now: Date,
): CleanupOverview {
  const nowMs = now.getTime();
  const overview: CleanupOverview = {
    redactableTombstones: 0,
    removableInvitations: { pending: 0, accepted: 0, claimed: 0, revoked: 0 },
    abandonedGames: 0,
    expiredMigrationRuns: 0,
  };

  for (const invitation of input.invitations) {
    const status = invitation.status;
    if (
      status !== 'pending' &&
      status !== 'accepted' &&
      status !== 'claimed' &&
      status !== 'revoked'
    ) {
      continue;
    }
    const age = ageMs(nowMs, invitationAnchor(invitation));
    if (age !== null && age > INVITATION_RETENTION_DAYS * DAY_MS) {
      overview.removableInvitations[status] += 1;
    }
  }

  for (const team of input.teams) {
    for (const completed of team.completedGames) {
      // Een geredigeerde tombstone is te herkennen aan `deletedBy: null` naast een
      // niet-null `deletedAt`: `firestore.rules` eist bij het tombstonen
      // `deletedBy == request.auth.uid`, dus een echte (niet-geredigeerde)
      // tombstone draagt altijd een uid. `redactedAt` zelf haalt de converter
      // niet door (hij negeert onbekende velden), dus dat kan hier niet dienen.
      if (completed.deletedAt === null || completed.deletedAt === undefined) continue;
      if (completed.deletedBy === null) continue;
      const age = ageMs(nowMs, completed.deletedAt);
      if (age !== null && age > TOMBSTONE_RETENTION_DAYS * DAY_MS) {
        overview.redactableTombstones += 1;
      }
    }

    for (const game of team.games) {
      if (!isUnfinished(game)) continue;
      const age = ageMs(nowMs, game.lastWriterActivityAt ?? game.createdAt);
      if (age !== null && age > ABANDONED_GAME_DAYS * DAY_MS) overview.abandonedGames += 1;
    }

    for (const run of team.migrationRuns) {
      if (run.status !== 'completed') continue;
      const age = ageMs(nowMs, run.updatedAt);
      if (age !== null && age > MIGRATION_RUN_RETENTION_DAYS * DAY_MS) {
        overview.expiredMigrationRuns += 1;
      }
    }
  }

  return overview;
}

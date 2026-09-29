// PR 8.3c-1 deel 2 — pure beoordeling van een organisatie voor een
// verwijderverzoek (docs/pr-8.3c-besluitvoorstel.md §2.5, §3.2, §3.4, §8.3).
// Alle tijden zijn vast en met de hand na te rekenen: NU = 2026-09-29T12:00:00Z.
import { describe, expect, it } from 'vitest';
import {
  assessOrganizationForDeletion,
  buildCleanupOverview,
} from '../../src/domain/deletion/assessment';
import type { RawOrganizationExportInput } from '../../src/domain/export/build';
import type { OrganizationExportRow } from '../../src/domain/export/types';

const NOW = new Date('2026-09-29T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** ISO-tijdstip dat `ms` milliseconden vóór NU ligt. */
function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

type Game = OrganizationExportRow & { actions: OrganizationExportRow[] };

function game(overrides: Record<string, unknown> = {}): Game {
  return {
    id: 'game-1',
    completedGameId: null,
    lastWriterActivityAt: null,
    createdAt: ago(10 * DAY),
    actions: [],
    ...overrides,
  };
}

function input(
  team: {
    games?: Game[];
    completedGames?: OrganizationExportRow[];
    migrationRuns?: OrganizationExportRow[];
    teamMembers?: OrganizationExportRow[];
    teamId?: string;
  } = {},
  extra: {
    invitations?: OrganizationExportRow[];
    organizationMembers?: OrganizationExportRow[];
    moreTeams?: RawOrganizationExportInput['teams'];
  } = {},
): RawOrganizationExportInput {
  return {
    organization: {
      id: 'org-1',
      name: 'Fictieve Org',
      createdBy: 'uid-owner',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    organizationMembers: extra.organizationMembers ?? [],
    invitations: extra.invitations ?? [],
    teams: [
      {
        teamId: team.teamId ?? 'team-1',
        name: 'Team 1',
        orgName: 'Fictieve Org',
        createdBy: 'uid-owner',
        createdAt: '2026-01-01T00:00:00.000Z',
        teamMembers: team.teamMembers ?? [],
        settings: null,
        roster: null,
        games: team.games ?? [],
        completedGames: team.completedGames ?? [],
        migrationRuns: team.migrationRuns ?? [],
      },
      ...(extra.moreTeams ?? []),
    ],
  };
}

describe('assessOrganizationForDeletion: blokkades', () => {
  it('een lege organisatie heeft geen blokkades, geen waarschuwingen en geen team-only leden', () => {
    expect(assessOrganizationForDeletion(input(), NOW)).toEqual({
      blockers: [],
      staleUnfinishedGames: [],
      teamOnlyMemberCount: 0,
    });
  });

  it('een niet-afgeronde wedstrijd met activiteit 2 uur geleden blokkeert hard', () => {
    const result = assessOrganizationForDeletion(
      input({ games: [game({ id: 'g-live', lastWriterActivityAt: ago(2 * HOUR) })] }),
      NOW,
    );
    expect(result.blockers).toEqual([
      { code: 'recent-active-game', teamId: 'team-1', gameId: 'g-live' },
    ]);
    expect(result.staleUnfinishedGames).toEqual([]);
  });

  it('de grens is 24 uur: exact 24 uur geleden blokkeert nog, 24 uur en 1 ms niet meer', () => {
    const exact = assessOrganizationForDeletion(
      input({ games: [game({ lastWriterActivityAt: ago(24 * HOUR) })] }),
      NOW,
    );
    expect(exact.blockers).toHaveLength(1);
    const over = assessOrganizationForDeletion(
      input({ games: [game({ lastWriterActivityAt: ago(24 * HOUR + 1) })] }),
      NOW,
    );
    expect(over.blockers).toEqual([]);
    expect(over.staleUnfinishedGames).toEqual([{ teamId: 'team-1', gameId: 'game-1' }]);
  });

  it('een niet-afgeronde wedstrijd zonder recente activiteit is een waarschuwing, geen blokkade', () => {
    const result = assessOrganizationForDeletion(
      input({
        games: [
          game({ id: 'g-oud', lastWriterActivityAt: ago(30 * DAY) }),
          game({ id: 'g-nooit', lastWriterActivityAt: null, createdAt: ago(30 * DAY) }),
        ],
      }),
      NOW,
    );
    expect(result.blockers).toEqual([]);
    expect(result.staleUnfinishedGames.map((g) => g.gameId).sort()).toEqual(['g-nooit', 'g-oud']);
  });

  describe('lastWriterActivityAt: null (nog geen writer geclaimd)', () => {
    it('een verse wedstrijd (createdAt enkele minuten geleden) blokkeert — het apparaat kan tussen aanmaken en claimen offline zijn gevallen', () => {
      const result = assessOrganizationForDeletion(
        input({
          games: [
            game({
              id: 'g-net-aangemaakt',
              lastWriterActivityAt: null,
              createdAt: ago(5 * 60 * 1000),
            }),
          ],
        }),
        NOW,
      );
      expect(result.blockers).toEqual([
        { code: 'recent-active-game', teamId: 'team-1', gameId: 'g-net-aangemaakt' },
      ]);
      expect(result.staleUnfinishedGames).toEqual([]);
    });

    it('updatedAt gaat voor createdAt: een oude wedstrijd met een recente updatedAt blokkeert', () => {
      const result = assessOrganizationForDeletion(
        input({
          games: [
            game({
              id: 'g-recent-bijgewerkt',
              lastWriterActivityAt: null,
              createdAt: ago(60 * DAY),
              updatedAt: ago(2 * HOUR),
            }),
          ],
        }),
        NOW,
      );
      expect(result.blockers).toHaveLength(1);
    });

    it('een wedstrijd waarvan ALLE tijdstempels oud zijn is een waarschuwing, geen blokkade', () => {
      const result = assessOrganizationForDeletion(
        input({
          games: [
            game({
              id: 'g-oud',
              lastWriterActivityAt: null,
              createdAt: ago(60 * DAY),
              updatedAt: ago(50 * DAY),
            }),
          ],
        }),
        NOW,
      );
      expect(result.blockers).toEqual([]);
      expect(result.staleUnfinishedGames).toHaveLength(1);
    });

    it('een wedstrijd zonder enig tijdstempelveld is een waarschuwing (er is niets om aan te meten)', () => {
      const result = assessOrganizationForDeletion(
        input({
          games: [game({ id: 'g-kaal', lastWriterActivityAt: null, createdAt: undefined })],
        }),
        NOW,
      );
      expect(result.blockers).toEqual([]);
      expect(result.staleUnfinishedGames).toHaveLength(1);
    });

    it('lastWriterActivityAt zelf gaat voor updatedAt: een oude activiteit bij een recente updatedAt telt niet als recent', () => {
      const result = assessOrganizationForDeletion(
        input({
          games: [game({ id: 'g-x', lastWriterActivityAt: ago(30 * DAY), updatedAt: ago(HOUR) })],
        }),
        NOW,
      );
      expect(result.blockers).toEqual([]);
    });
  });

  it('een afgeronde wedstrijd (completedGameId gezet) blokkeert nooit, ook niet bij recente activiteit', () => {
    const result = assessOrganizationForDeletion(
      input({ games: [game({ completedGameId: 'c-1', lastWriterActivityAt: ago(HOUR) })] }),
      NOW,
    );
    expect(result).toEqual({ blockers: [], staleUnfinishedGames: [], teamOnlyMemberCount: 0 });
  });

  it('faalt gesloten: een tijdstempel in de TOEKOMST (klokafwijking) telt als recent', () => {
    const result = assessOrganizationForDeletion(
      input({
        games: [game({ lastWriterActivityAt: new Date(NOW.getTime() + 5 * DAY).toISOString() })],
      }),
      NOW,
    );
    expect(result.blockers).toHaveLength(1);
  });

  it('faalt gesloten: een onleesbaar tijdstempel telt als recent', () => {
    const result = assessOrganizationForDeletion(
      input({ games: [game({ lastWriterActivityAt: 'geen-tijdstip' })] }),
      NOW,
    );
    expect(result.blockers).toHaveLength(1);
  });

  it('blokkades worden per team gerapporteerd', () => {
    const second = input({
      teamId: 'team-2',
      games: [game({ id: 'g-2', lastWriterActivityAt: ago(HOUR) })],
    }).teams[0]!;
    const result = assessOrganizationForDeletion(
      input(
        { games: [game({ id: 'g-1', lastWriterActivityAt: ago(HOUR) })] },
        { moreTeams: [second] },
      ),
      NOW,
    );
    expect(result.blockers).toEqual([
      { code: 'recent-active-game', teamId: 'team-1', gameId: 'g-1' },
      { code: 'recent-active-game', teamId: 'team-2', gameId: 'g-2' },
    ]);
  });

  it('een afgeronde migratierun blokkeert niet', () => {
    const result = assessOrganizationForDeletion(
      input({ migrationRuns: [{ id: 'run-1', status: 'completed' }] }),
      NOW,
    );
    expect(result.blockers).toEqual([]);
  });

  it.each(['paused', 'actionNeeded', 'compensationFailed', 'running', 'onbekend'])(
    'een migratierun in status %s blokkeert hard',
    (status) => {
      const result = assessOrganizationForDeletion(
        input({ migrationRuns: [{ id: 'run-x', status }] }),
        NOW,
      );
      expect(result.blockers).toEqual([
        { code: 'migration-run-not-terminal', teamId: 'team-1', runId: 'run-x' },
      ]);
    },
  );

  it('faalt gesloten: een migratierun ZONDER status blokkeert', () => {
    const result = assessOrganizationForDeletion(input({ migrationRuns: [{ id: 'run-y' }] }), NOW);
    expect(result.blockers).toHaveLength(1);
  });
});

describe('assessOrganizationForDeletion: team-only leden (besluitrecord §8.3)', () => {
  it('telt alleen uids met een teamMembers-rij maar zonder organizationMembers-rij, ontdubbeld over teams', () => {
    // organizationMembers: a, b. team-1: a, c. team-2: c, d. Team-only = {c, d} = 2.
    const team2 = input({
      teamId: 'team-2',
      teamMembers: [
        { id: 'c', uid: 'c' },
        { id: 'd', uid: 'd' },
      ],
    }).teams[0]!;
    const result = assessOrganizationForDeletion(
      input(
        {
          teamMembers: [
            { id: 'a', uid: 'a' },
            { id: 'c', uid: 'c' },
          ],
        },
        {
          organizationMembers: [
            { id: 'a', uid: 'a' },
            { id: 'b', uid: 'b' },
          ],
          moreTeams: [team2],
        },
      ),
      NOW,
    );
    expect(result.teamOnlyMemberCount).toBe(2);
  });

  it('iemand die in een team én in de organisatie staat is geen team-only lid', () => {
    const result = assessOrganizationForDeletion(
      input(
        { teamMembers: [{ id: 'a', uid: 'a' }] },
        { organizationMembers: [{ id: 'a', uid: 'a' }] },
      ),
      NOW,
    );
    expect(result.teamOnlyMemberCount).toBe(0);
  });
});

describe('buildCleanupOverview', () => {
  it('een lege organisatie heeft niets op te ruimen', () => {
    expect(buildCleanupOverview(input(), NOW)).toEqual({
      redactableTombstones: 0,
      removableInvitations: { pending: 0, accepted: 0, claimed: 0, revoked: 0 },
      abandonedGames: 0,
      expiredMigrationRuns: 0,
    });
  });

  it('telt getombstonede wedstrijden vanaf 90 dagen, maar niet de geredigeerde (deletedBy null)', () => {
    const overview = buildCleanupOverview(
      input({
        completedGames: [
          { id: 'c-91', deletedAt: ago(91 * DAY), deletedBy: 'uid-1' },
          { id: 'c-89', deletedAt: ago(89 * DAY), deletedBy: 'uid-1' },
          { id: 'c-geredigeerd', deletedAt: ago(200 * DAY), deletedBy: null },
          { id: 'c-levend', deletedAt: null, deletedBy: null },
          { id: 'c-legacy' },
        ],
      }),
      NOW,
    );
    expect(overview.redactableTombstones).toBe(1);
  });

  it('meet elke uitnodigingsstatus aan het tijdstempel van díé status, met terugval op invitedAt', () => {
    const overview = buildCleanupOverview(
      input(
        {},
        {
          invitations: [
            // pending: invitedAt 31d → telt; 29d → niet
            { id: 'p-oud', status: 'pending', invitedAt: ago(31 * DAY) },
            { id: 'p-jong', status: 'pending', invitedAt: ago(29 * DAY) },
            // accepted: acceptedAt telt, niet invitedAt
            {
              id: 'a-oud',
              status: 'accepted',
              invitedAt: ago(90 * DAY),
              acceptedAt: ago(31 * DAY),
            },
            {
              id: 'a-jong',
              status: 'accepted',
              invitedAt: ago(90 * DAY),
              acceptedAt: ago(2 * DAY),
            },
            // claimed: claimedAt telt; zonder claimedAt valt hij terug op invitedAt
            { id: 'c-oud', status: 'claimed', invitedAt: ago(90 * DAY), claimedAt: ago(40 * DAY) },
            { id: 'c-jong', status: 'claimed', invitedAt: ago(90 * DAY), claimedAt: ago(1 * DAY) },
            { id: 'c-legacy', status: 'claimed', invitedAt: ago(35 * DAY) },
            // revoked: revokedAt telt; legacy zonder revokedAt valt terug op invitedAt
            { id: 'r-oud', status: 'revoked', invitedAt: ago(90 * DAY), revokedAt: ago(45 * DAY) },
            { id: 'r-jong', status: 'revoked', invitedAt: ago(90 * DAY), revokedAt: ago(3 * DAY) },
            { id: 'r-legacy', status: 'revoked', invitedAt: ago(50 * DAY) },
          ],
        },
      ),
      NOW,
    );
    expect(overview.removableInvitations).toEqual({
      pending: 1,
      accepted: 1,
      claimed: 2,
      revoked: 2,
    });
  });

  it('een uitnodiging met onbekende status of onleesbare datum wordt niet meegeteld', () => {
    const overview = buildCleanupOverview(
      input(
        {},
        {
          invitations: [
            { id: 'x', status: 'raar', invitedAt: ago(99 * DAY) },
            { id: 'y', status: 'pending', invitedAt: 'geen-datum' },
          ],
        },
      ),
      NOW,
    );
    expect(overview.removableInvitations).toEqual({
      pending: 0,
      accepted: 0,
      claimed: 0,
      revoked: 0,
    });
  });

  it('telt verlaten wedstrijden vanaf 180 dagen, met terugval op createdAt en zonder afgeronde', () => {
    const overview = buildCleanupOverview(
      input({
        games: [
          game({ id: 'g-181', lastWriterActivityAt: ago(181 * DAY) }),
          game({ id: 'g-179', lastWriterActivityAt: ago(179 * DAY) }),
          game({ id: 'g-nooit-181', lastWriterActivityAt: null, createdAt: ago(181 * DAY) }),
          game({ id: 'g-nooit-10', lastWriterActivityAt: null, createdAt: ago(10 * DAY) }),
          game({ id: 'g-af', completedGameId: 'c-1', lastWriterActivityAt: ago(400 * DAY) }),
          game({
            id: 'g-updated',
            lastWriterActivityAt: null,
            createdAt: ago(400 * DAY),
            updatedAt: ago(5 * DAY),
          }),
        ],
      }),
      NOW,
    );
    expect(overview.abandonedGames).toBe(2);
  });

  it('telt alleen AFGERONDE migratieruns ouder dan 90 dagen', () => {
    const overview = buildCleanupOverview(
      input({
        migrationRuns: [
          { id: 'm-91', status: 'completed', updatedAt: ago(91 * DAY) },
          { id: 'm-89', status: 'completed', updatedAt: ago(89 * DAY) },
          { id: 'm-vast', status: 'actionNeeded', updatedAt: ago(300 * DAY) },
          { id: 'm-zonder-datum', status: 'completed' },
        ],
      }),
      NOW,
    );
    expect(overview.expiredMigrationRuns).toBe(1);
  });
});

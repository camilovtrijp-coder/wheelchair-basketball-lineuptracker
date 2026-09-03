import { describe, expect, it } from 'vitest';
import {
  buildOrganizationExport,
  type RawOrganizationExportInput,
} from '../../src/domain/export/build';
import { canExportOrganization } from '../../src/domain/export/types';

function baseInput(): RawOrganizationExportInput {
  return {
    organization: {
      id: 'org-1',
      name: 'ROBA',
      createdBy: 'uid-owner',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    organizationMembers: [
      { uid: 'uid-owner', role: 'organizationOwner', email: 'owner@example.test' },
    ],
    invitations: [
      {
        invitationId: 'inv-1',
        email: 'invited@example.test',
        role: 'coach',
        status: 'revoked',
      },
    ],
    teams: [
      {
        teamId: 'team-1',
        name: 'Alpha',
        orgName: 'ROBA',
        createdBy: 'uid-owner',
        createdAt: '2026-01-01T00:00:00.000Z',
        teamMembers: [{ uid: 'uid-coach', role: 'coach', email: 'coach@example.test' }],
        settings: { teamName: 'Alpha' },
        roster: [{ id: 1, nr: '4', naam: 'Speler Een' }],
        games: [
          {
            id: 'game-1',
            phase: 'setup',
            actions: [],
          },
        ],
        completedGames: [
          { id: 'completed-1', scoreFor: 40, scoreAgainst: 32, deletedAt: null },
          {
            id: 'completed-2',
            scoreFor: 10,
            scoreAgainst: 50,
            deletedAt: '2026-02-01T00:00:00.000Z',
          },
        ],
        migrationRuns: [{ id: 'run-1', status: 'completed' }],
      },
    ],
  };
}

describe('canExportOrganization', () => {
  it('staat alleen organizationOwner toe', () => {
    expect(canExportOrganization('organizationOwner')).toBe(true);
    for (const role of ['organizationAdmin', 'coach', 'scorer', 'viewer'] as const) {
      expect(canExportOrganization(role)).toBe(false);
    }
  });
});

describe('buildOrganizationExport', () => {
  it('weigert elke niet-owner rol vóór er ook maar één veld wordt samengesteld', () => {
    for (const role of ['organizationAdmin', 'coach', 'scorer', 'viewer'] as const) {
      const result = buildOrganizationExport(baseInput(), {
        uid: 'uid-x',
        role,
        now: '2026-03-01T00:00:00.000Z',
      });
      expect(result).toEqual({ allowed: false, denialReason: 'roleDenied' });
    }
  });

  it('bouwt een volledige export met correcte aantallen (inclusief tombstoned completedGame)', () => {
    const result = buildOrganizationExport(baseInput(), {
      uid: 'uid-owner',
      role: 'organizationOwner',
      now: '2026-03-01T00:00:00.000Z',
    });
    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error('expected allowed export');
    expect(result.export.schemaVersion).toBe(1);
    expect(result.export.exportedAt).toBe('2026-03-01T00:00:00.000Z');
    expect(result.export.exportedBy).toBe('uid-owner');
    expect(result.export.counts).toEqual({
      organizationMembers: 1,
      invitations: 1,
      teams: 1,
      teamMembers: 1,
      settingsDocuments: 1,
      rosterPlayers: 1,
      games: 1,
      gameActions: 0,
      completedGames: 2,
      migrationRuns: 1,
    });
  });

  it('telt settings/roster als afwezig zonder te crashen als een team ze nog niet heeft', () => {
    const input = baseInput();
    input.teams[0]!.settings = null;
    input.teams[0]!.roster = null;
    const result = buildOrganizationExport(input, {
      uid: 'uid-owner',
      role: 'organizationOwner',
      now: '2026-03-01T00:00:00.000Z',
    });
    if (!result.allowed) throw new Error('expected allowed export');
    expect(result.export.counts.settingsDocuments).toBe(0);
    expect(result.export.counts.rosterPlayers).toBe(0);
    expect(result.export.teams[0]!.settings).toBeNull();
    expect(result.export.teams[0]!.roster).toBeNull();
  });

  it('is deterministisch: dezelfde input/caller (op "now" na) levert dezelfde contentHash op', () => {
    const first = buildOrganizationExport(baseInput(), {
      uid: 'uid-owner',
      role: 'organizationOwner',
      now: '2026-03-01T00:00:00.000Z',
    });
    const second = buildOrganizationExport(baseInput(), {
      uid: 'uid-owner',
      role: 'organizationOwner',
      now: '2026-04-15T00:00:00.000Z',
    });
    if (!first.allowed || !second.allowed) throw new Error('expected allowed exports');
    expect(first.export.contentHash).toBe(second.export.contentHash);
    expect(first.export.exportedAt).not.toBe(second.export.exportedAt);
  });

  it('geeft een andere contentHash bij afwijkende inhoud', () => {
    const changed = baseInput();
    changed.teams[0]!.completedGames[0]!.scoreFor = 41;
    const original = buildOrganizationExport(baseInput(), {
      uid: 'uid-owner',
      role: 'organizationOwner',
      now: '2026-03-01T00:00:00.000Z',
    });
    const modified = buildOrganizationExport(changed, {
      uid: 'uid-owner',
      role: 'organizationOwner',
      now: '2026-03-01T00:00:00.000Z',
    });
    if (!original.allowed || !modified.allowed) throw new Error('expected allowed exports');
    expect(original.export.contentHash).not.toBe(modified.export.contentHash);
  });

  it('dekt meerdere teams en gelijknamige teams over organisaties in de aantallen', () => {
    const input = baseInput();
    input.teams.push({
      teamId: 'team-2',
      name: 'Alpha', // gelijke naam als team-1, ander teamId — moet los meetellen
      orgName: 'ROBA',
      createdBy: 'uid-owner',
      createdAt: '2026-01-02T00:00:00.000Z',
      teamMembers: [],
      settings: null,
      roster: null,
      games: [],
      completedGames: [],
      migrationRuns: [],
    });
    const result = buildOrganizationExport(input, {
      uid: 'uid-owner',
      role: 'organizationOwner',
      now: '2026-03-01T00:00:00.000Z',
    });
    if (!result.allowed) throw new Error('expected allowed export');
    expect(result.export.counts.teams).toBe(2);
    expect(result.export.teams.map((t) => t.teamId)).toEqual(['team-1', 'team-2']);
  });
});

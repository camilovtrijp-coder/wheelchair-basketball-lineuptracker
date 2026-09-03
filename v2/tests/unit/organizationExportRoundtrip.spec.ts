import { describe, expect, it } from 'vitest';
import {
  serializeOrganizationExport,
  verifyOrganizationExportRoundtrip,
} from '../../src/domain/export/roundtrip';
import { buildOrganizationExport } from '../../src/domain/export/build';

function validExport() {
  const result = buildOrganizationExport(
    {
      organization: {
        id: 'org-1',
        name: 'ROBA',
        createdBy: 'uid-owner',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      organizationMembers: [
        { uid: 'uid-owner', role: 'organizationOwner', email: 'owner@example.test' },
      ],
      invitations: [],
      teams: [
        {
          teamId: 'team-1',
          name: 'Alpha',
          orgName: 'ROBA',
          createdBy: 'uid-owner',
          createdAt: '2026-01-01T00:00:00.000Z',
          teamMembers: [],
          settings: null,
          roster: null,
          games: [],
          completedGames: [],
          migrationRuns: [],
        },
      ],
    },
    { uid: 'uid-owner', role: 'organizationOwner', now: '2026-03-01T00:00:00.000Z' },
  );
  if (!result.allowed) throw new Error('expected allowed export');
  return result.export;
}

describe('organizatie-export roundtrip', () => {
  it('serialiseert naar geldige, herleesbare JSON', () => {
    const json = serializeOrganizationExport(validExport());
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('een normaal gebouwde export doorstaat de roundtrip', () => {
    expect(verifyOrganizationExportRoundtrip(validExport())).toBe(true);
  });

  it('faalt op een rauw Date-object (niet-geserialiseerd, hoort hier altijd al een ISO-string te zijn)', () => {
    // `Date` heeft zelf geen enumerable eigen properties: de eigen
    // `stableStringify()`-doorloop (die géén `toJSON()` volgt) hasht 'm als
    // `{}`, terwijl een echte JSON.stringify/parse-cyclus 'm via `toJSON()`
    // omzet naar een ISO-string — die twee hashes moeten dus verschillen.
    const withRawDate = validExport();
    (withRawDate.teams[0] as unknown as Record<string, unknown>).corruptField = new Date(
      '2026-01-01T00:00:00.000Z',
    );
    expect(verifyOrganizationExportRoundtrip(withRawDate)).toBe(false);
  });
});

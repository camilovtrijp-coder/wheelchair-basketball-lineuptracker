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

  it('faalt op een `undefined`-veld (herreview PR #87, P1: JSON.stringify() en payloadHash() filteren dit allebei stilzwijgend weg, dus een kale hashvergelijking kan dit nooit vangen)', () => {
    const withUndefinedField = validExport();
    (withUndefinedField.teams[0] as unknown as Record<string, unknown>).corruptField = undefined;
    expect(verifyOrganizationExportRoundtrip(withUndefinedField)).toBe(false);
  });

  it('faalt op een `undefined`-element in een array (JSON.stringify() zet dit stilzwijgend om naar `null`)', () => {
    const withUndefinedElement = validExport();
    (withUndefinedElement.invitations as unknown[]).push(undefined);
    expect(verifyOrganizationExportRoundtrip(withUndefinedElement)).toBe(false);
  });

  it('faalt op een functiewaarde', () => {
    const withFunction = validExport();
    (withFunction.teams[0] as unknown as Record<string, unknown>).corruptField = () => 'boom';
    expect(verifyOrganizationExportRoundtrip(withFunction)).toBe(false);
  });

  it('faalt op niet-ondersteunde numerieke waarden (NaN/Infinity)', () => {
    const withNaN = validExport();
    (withNaN.teams[0] as unknown as Record<string, unknown>).corruptField = NaN;
    expect(verifyOrganizationExportRoundtrip(withNaN)).toBe(false);

    const withInfinity = validExport();
    (withInfinity.teams[0] as unknown as Record<string, unknown>).corruptField = Infinity;
    expect(verifyOrganizationExportRoundtrip(withInfinity)).toBe(false);
  });

  it('faalt op een niet-ondersteund objecttype (Map)', () => {
    const withMap = validExport();
    (withMap.teams[0] as unknown as Record<string, unknown>).corruptField = new Map([['a', 1]]);
    expect(verifyOrganizationExportRoundtrip(withMap)).toBe(false);
  });
});

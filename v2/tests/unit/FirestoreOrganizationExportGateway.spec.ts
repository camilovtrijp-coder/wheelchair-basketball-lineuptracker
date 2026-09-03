// Herreview PR #87 (vervolg op P1): meerdere bestaande, geldige converters
// leveren bij een afwezig optioneel veld een object-property met de WAARDE
// `undefined` op (niet: de key ontbreekt) — `organizationMemberConverter`
// (`joinedAt`/`invitationId`), `invitationConverter` (`claimedAt`),
// `teamMemberConverter` (`addedAt`). Dit bewijst tegen de ECHTE converters
// (geen mock van `firebase-base/documents`, zie ook
// `organizationRoles.spec.ts` voor hetzelfde patroon) dat `toJsonSafe()`
// zulke `undefined`-properties normaliseert vóórdat `build.ts`/`roundtrip.ts`
// iets ziet, en dat de volledige keten (gateway-normalisatie → build →
// roundtripverificatie) voor deze doodgewone documenten slaagt — zonder de
// `isJsonSafe()`-controle zelf te verzwakken.
import { describe, expect, it } from 'vitest';
import { Timestamp, type QueryDocumentSnapshot } from 'firebase/firestore';
import {
  invitationConverter,
  organizationMemberConverter,
  teamMemberConverter,
} from 'firebase-base/documents';
import {
  toExportRow,
  toJsonSafe,
} from '../../src/infrastructure/export/FirestoreOrganizationExportGateway';
import { buildOrganizationExport } from '../../src/domain/export/build';
import { verifyOrganizationExportRoundtrip } from '../../src/domain/export/roundtrip';

function mockSnapshot<T extends Record<string, unknown>>(data: T): QueryDocumentSnapshot {
  return { data: () => data } as unknown as QueryDocumentSnapshot;
}

function minimalExportInput(teamMembers: Record<string, unknown>[]) {
  return {
    organization: {
      id: 'org-1',
      name: 'ROBA',
      createdBy: 'uid-owner',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    organizationMembers: [] as Record<string, unknown>[],
    invitations: [] as Record<string, unknown>[],
    teams: [
      {
        teamId: 'team-1',
        name: 'Alpha',
        orgName: 'ROBA',
        createdBy: 'uid-owner',
        createdAt: '2026-01-01T00:00:00.000Z',
        teamMembers,
        settings: null,
        roster: null,
        games: [],
        completedGames: [],
        migrationRuns: [],
      },
    ],
  };
}

function buildAndVerify(input: ReturnType<typeof minimalExportInput>) {
  const built = buildOrganizationExport(input, {
    uid: 'uid-owner',
    role: 'organizationOwner',
    now: '2026-03-01T00:00:00.000Z',
  });
  if (!built.allowed) throw new Error('expected allowed export');
  return verifyOrganizationExportRoundtrip(built.export);
}

describe('toJsonSafe(): normaliseert converter-`undefined`-properties aan de infrastructure-grens', () => {
  it('laat organizationMemberConverter-output zonder joinedAt/invitationId geen undefined-properties behouden', () => {
    const converted = organizationMemberConverter.fromFirestore!(
      mockSnapshot({ role: 'coach', email: 'coach@example.test', uid: 'uid-coach' }),
      {},
    );
    expect(Object.keys(converted)).toEqual(
      expect.arrayContaining(['role', 'email', 'uid', 'joinedAt', 'invitationId']),
    );
    expect(converted.joinedAt).toBeUndefined();
    expect(converted.invitationId).toBeUndefined();

    const row = toExportRow('uid-coach', converted as unknown as Record<string, unknown>);
    expect(Object.prototype.hasOwnProperty.call(row, 'joinedAt')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(row, 'invitationId')).toBe(false);
    expect(row).toEqual({
      id: 'uid-coach',
      role: 'coach',
      email: 'coach@example.test',
      uid: 'uid-coach',
    });
  });

  it('laat invitationConverter-output zonder claimedAt geen undefined-property behouden', () => {
    const converted = invitationConverter.fromFirestore!(
      mockSnapshot({
        email: 'invited@example.test',
        role: 'coach',
        status: 'pending',
        invitedBy: 'uid-owner',
        invitedAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')),
        acceptedAt: null,
      }),
      {},
    );
    expect(converted.claimedAt).toBeUndefined();

    const row = toExportRow('inv-1', converted as unknown as Record<string, unknown>);
    expect(Object.prototype.hasOwnProperty.call(row, 'claimedAt')).toBe(false);
  });

  it('laat teamMemberConverter-output zonder addedAt geen undefined-property behouden', () => {
    const converted = teamMemberConverter.fromFirestore!(
      mockSnapshot({ role: 'coach', email: 'coach@example.test', uid: 'uid-coach' }),
      {},
    );
    expect(converted.addedAt).toBeUndefined();

    const row = toExportRow('uid-coach', converted as unknown as Record<string, unknown>);
    expect(Object.prototype.hasOwnProperty.call(row, 'addedAt')).toBe(false);
  });

  it('geeft undefined-ELEMENTEN in een array ongewijzigd door — die moeten `isJsonSafe()` blijven laten falen', () => {
    expect(toJsonSafe(['a', undefined, 'b'])).toEqual(['a', undefined, 'b']);
  });

  it('de volledige keten (normalisatie → build → roundtrip) slaagt voor deze doodgewone documenten', () => {
    const converted = organizationMemberConverter.fromFirestore!(
      mockSnapshot({ role: 'coach', email: 'coach@example.test', uid: 'uid-coach' }),
      {},
    );
    const row = toExportRow('uid-coach', converted as unknown as Record<string, unknown>);
    expect(buildAndVerify(minimalExportInput([row]))).toBe(true);
  });

  it('een undefined-arrayelement blijft de roundtrip laten falen, ook na de normalisatiefix', () => {
    const converted = organizationMemberConverter.fromFirestore!(
      mockSnapshot({ role: 'coach', email: 'coach@example.test', uid: 'uid-coach' }),
      {},
    );
    const row = toExportRow('uid-coach', converted as unknown as Record<string, unknown>) as Record<
      string,
      unknown
    >;
    row.corruptArray = ['a', undefined, 'b'];
    expect(buildAndVerify(minimalExportInput([row]))).toBe(false);
  });
});

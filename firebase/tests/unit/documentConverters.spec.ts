// Round-trip-tests voor de typed Firestore-documentcontracten. Pure logica,
// geen Emulator nodig: een minimale mock-QueryDocumentSnapshot volstaat om
// fromFirestore() te oefenen; toFirestore() wordt direct op een voorbeeld-
// object aangeroepen.

import { describe, expect, it } from 'vitest';
import { Timestamp, type QueryDocumentSnapshot } from 'firebase/firestore';
import {
  organizationConverter,
  organizationMemberConverter,
  invitationConverter,
  teamConverter,
  teamMemberConverter,
  settingsConverter,
  rosterConverter,
  DocumentValidationError,
  type OrganizationDocument,
  type OrganizationMemberDocument,
  type InvitationDocument,
  type TeamDocument,
  type TeamMemberDocument,
  type SettingsDocument,
  type RosterDocument,
} from '../../src/documents/index.js';

function mockSnapshot<T extends Record<string, unknown>>(data: T): QueryDocumentSnapshot {
  return { data: () => data } as unknown as QueryDocumentSnapshot;
}

describe('documentcontracten: round-trip via toFirestore/fromFirestore', () => {
  it('organization', () => {
    const doc: OrganizationDocument = {
      name: 'Fictieve Org',
      createdBy: 'uid-alice',
      createdAt: Timestamp.now(),
    };
    const stored = organizationConverter.toFirestore(doc);
    expect(organizationConverter.fromFirestore!(mockSnapshot(stored as Record<string, unknown>), {})).toEqual(doc);
  });

  it('organizationMember bevat het uid-veld (issue #28-queryveld)', () => {
    const doc: OrganizationMemberDocument = {
      role: 'organizationOwner',
      email: 'alice@example.test',
      uid: 'uid-alice',
      joinedAt: Timestamp.now(),
    };
    const stored = organizationMemberConverter.toFirestore(doc);
    const roundtripped = organizationMemberConverter.fromFirestore!(
      mockSnapshot(stored as Record<string, unknown>),
      {},
    );
    expect(roundtripped).toEqual(doc);
    expect(roundtripped.uid).toBe('uid-alice');
  });

  it('invitation', () => {
    const doc: InvitationDocument = {
      email: 'grace@example.test',
      role: 'viewer',
      status: 'pending',
      invitedBy: 'uid-bob',
      invitedAt: Timestamp.now(),
      acceptedAt: null,
    };
    const stored = invitationConverter.toFirestore(doc);
    expect(invitationConverter.fromFirestore!(mockSnapshot(stored as Record<string, unknown>), {})).toEqual(doc);
  });

  it('team bevat het orgName-veld (issue #31 — leesbaar voor team-only leden zonder organizations/{orgId}-toegang)', () => {
    const doc: TeamDocument = {
      name: 'U23',
      orgName: 'Rotterdam Basketball',
      createdBy: 'uid-alice',
      createdAt: Timestamp.now(),
    };
    const stored = teamConverter.toFirestore(doc);
    expect(teamConverter.fromFirestore!(mockSnapshot(stored as Record<string, unknown>), {})).toEqual(doc);
  });

  it('teamMember bevat het uid-veld (issue #31-queryveld)', () => {
    const doc: TeamMemberDocument = {
      role: 'coach',
      email: 'carol@example.test',
      uid: 'uid-carol',
      addedAt: Timestamp.now(),
    };
    const stored = teamMemberConverter.toFirestore(doc);
    const roundtripped = teamMemberConverter.fromFirestore!(mockSnapshot(stored as Record<string, unknown>), {});
    expect(roundtripped).toEqual(doc);
    expect(roundtripped.uid).toBe('uid-carol');
  });

  it('settings', () => {
    const doc: SettingsDocument = {
      teamName: 'Fictief Team',
      logoUri: '',
      primaryColor: '#2563eb',
      accentColor: '#f97316',
      quarterCount: 4,
      periodLabel: '',
      useClassLimit: false,
      tag1Label: '',
      tag2Label: '',
      classBaseLimit: 14.5,
      maxBonus: 2.5,
      bonusTag1Only: 1.5,
      bonusTag2Only: 1.0,
      bonusBoth: 2.0,
      updatedAt: Timestamp.now(),
    };
    const stored = settingsConverter.toFirestore(doc);
    expect(settingsConverter.fromFirestore!(mockSnapshot(stored as Record<string, unknown>), {})).toEqual(doc);
  });

  it('roster', () => {
    const doc: RosterDocument = {
      players: [{ id: 1, nr: '7', naam: 'Fictief Speler', kl: '3.0', vrouw: false, jeugd: false }],
      updatedAt: Timestamp.now(),
    };
    const stored = rosterConverter.toFirestore(doc);
    expect(rosterConverter.fromFirestore!(mockSnapshot(stored as Record<string, unknown>), {})).toEqual(doc);
  });
});

// Review-opvolging #29 (P2): de converters waren type-projecties, geen
// runtime-decoders — `snapshot.data()` levert ongevalideerde `DocumentData`.
// Deze tests bewijzen dat malformed serverdata nu wordt geweigerd i.p.v.
// stilzwijgend als het getypte document te worden teruggegeven.
describe('documentcontracten: weigeren malformed serverdata', () => {
  const validMember: Record<string, unknown> = {
    role: 'organizationOwner',
    email: 'alice@example.test',
    uid: 'uid-alice',
    joinedAt: Timestamp.now(),
  };
  const validSettings: Record<string, unknown> = {
    teamName: 'Fictief Team',
    logoUri: '',
    primaryColor: '#2563eb',
    accentColor: '#f97316',
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
    tag1Label: '',
    tag2Label: '',
    classBaseLimit: 14.5,
    maxBonus: 2.5,
    bonusTag1Only: 1.5,
    bonusTag2Only: 1.0,
    bonusBoth: 2.0,
    updatedAt: Timestamp.now(),
  };
  const validRoster: Record<string, unknown> = {
    players: [{ id: 1, nr: '7', naam: 'Fictief Speler', kl: '3.0', vrouw: false, jeugd: false }],
    updatedAt: Timestamp.now(),
  };
  const validInvitation: Record<string, unknown> = {
    email: 'grace@example.test',
    role: 'viewer',
    status: 'pending',
    invitedBy: 'uid-bob',
    invitedAt: Timestamp.now(),
    acceptedAt: null,
  };
  const validTeamMember: Record<string, unknown> = {
    role: 'coach',
    email: 'carol@example.test',
    uid: 'uid-carol',
    addedAt: Timestamp.now(),
  };
  const validOrganization: Record<string, unknown> = {
    name: 'Fictieve Org',
    createdBy: 'uid-alice',
    createdAt: Timestamp.now(),
  };

  it('organizationMember: onbekende rol wordt geweigerd', () => {
    expect(() =>
      organizationMemberConverter.fromFirestore!(
        mockSnapshot({ ...validMember, role: 'superadmin' }),
        {},
      ),
    ).toThrow(DocumentValidationError);
  });

  it('organizationMember: niet-string uid wordt geweigerd (issue #28-queryveld)', () => {
    expect(() =>
      organizationMemberConverter.fromFirestore!(mockSnapshot({ ...validMember, uid: 12345 }), {}),
    ).toThrow(DocumentValidationError);
  });

  it('organizationMember: ontbrekend e-mailadres wordt geweigerd', () => {
    const { email: _email, ...withoutEmail } = validMember;
    expect(() => organizationMemberConverter.fromFirestore!(mockSnapshot(withoutEmail), {})).toThrow(
      DocumentValidationError,
    );
  });

  it('organizationMember: ongeldig e-mailadres (geen @) wordt geweigerd', () => {
    expect(() =>
      organizationMemberConverter.fromFirestore!(mockSnapshot({ ...validMember, email: 'geen-emailadres' }), {}),
    ).toThrow(DocumentValidationError);
  });

  it('invitation: onbekende status wordt geweigerd', () => {
    expect(() =>
      invitationConverter.fromFirestore!(mockSnapshot({ ...validInvitation, status: 'ingetrokken' }), {}),
    ).toThrow(DocumentValidationError);
  });

  it('invitation: ontbrekende invitedAt-timestamp wordt geweigerd', () => {
    const { invitedAt: _invitedAt, ...withoutInvitedAt } = validInvitation;
    expect(() => invitationConverter.fromFirestore!(mockSnapshot(withoutInvitedAt), {})).toThrow(
      DocumentValidationError,
    );
  });

  it('invitation: string in plaats van Timestamp voor invitedAt wordt geweigerd', () => {
    expect(() =>
      invitationConverter.fromFirestore!(mockSnapshot({ ...validInvitation, invitedAt: '2026-01-01' }), {}),
    ).toThrow(DocumentValidationError);
  });

  it('teamMember: onbekende rol wordt geweigerd', () => {
    expect(() =>
      teamMemberConverter.fromFirestore!(mockSnapshot({ ...validTeamMember, role: 'niet-bestaand' }), {}),
    ).toThrow(DocumentValidationError);
  });

  it('teamMember: niet-string uid wordt geweigerd (issue #31-queryveld)', () => {
    expect(() =>
      teamMemberConverter.fromFirestore!(mockSnapshot({ ...validTeamMember, uid: 12345 }), {}),
    ).toThrow(DocumentValidationError);
  });

  it('team: ontbrekende orgName wordt geweigerd (issue #31)', () => {
    const validTeam: Record<string, unknown> = {
      name: 'U23',
      orgName: 'Rotterdam Basketball',
      createdBy: 'uid-alice',
      createdAt: Timestamp.now(),
    };
    const { orgName: _orgName, ...withoutOrgName } = validTeam;
    expect(() => teamConverter.fromFirestore!(mockSnapshot(withoutOrgName), {})).toThrow(
      DocumentValidationError,
    );
  });

  it('organization: ontbrekende createdAt-timestamp wordt geweigerd', () => {
    const { createdAt: _createdAt, ...withoutCreatedAt } = validOrganization;
    expect(() => organizationConverter.fromFirestore!(mockSnapshot(withoutCreatedAt), {})).toThrow(
      DocumentValidationError,
    );
  });

  it('settings: niet-numerieke quarterCount wordt geweigerd', () => {
    expect(() =>
      settingsConverter.fromFirestore!(mockSnapshot({ ...validSettings, quarterCount: '4' }), {}),
    ).toThrow(DocumentValidationError);
  });

  it('settings: niet-boolean useClassLimit wordt geweigerd', () => {
    expect(() =>
      settingsConverter.fromFirestore!(mockSnapshot({ ...validSettings, useClassLimit: 'true' }), {}),
    ).toThrow(DocumentValidationError);
  });

  it('settings: ontbrekende updatedAt-timestamp wordt geweigerd', () => {
    const { updatedAt: _updatedAt, ...withoutUpdatedAt } = validSettings;
    expect(() => settingsConverter.fromFirestore!(mockSnapshot(withoutUpdatedAt), {})).toThrow(
      DocumentValidationError,
    );
  });

  it('roster: players die geen array is wordt geweigerd', () => {
    expect(() =>
      rosterConverter.fromFirestore!(mockSnapshot({ ...validRoster, players: 'niet-een-array' }), {}),
    ).toThrow(DocumentValidationError);
  });

  it('roster: speler-entry die geen object is wordt geweigerd', () => {
    expect(() =>
      rosterConverter.fromFirestore!(mockSnapshot({ ...validRoster, players: ['niet-een-object'] }), {}),
    ).toThrow(DocumentValidationError);
  });

  it('roster: speler met niet-numerieke id wordt geweigerd', () => {
    const malformedPlayer = { id: '1', nr: '7', naam: 'Fictief Speler', kl: '3.0', vrouw: false, jeugd: false };
    expect(() =>
      rosterConverter.fromFirestore!(mockSnapshot({ ...validRoster, players: [malformedPlayer] }), {}),
    ).toThrow(DocumentValidationError);
  });

  it('roster: speler met niet-boolean vrouw-vlag wordt geweigerd', () => {
    const malformedPlayer = { id: 1, nr: '7', naam: 'Fictief Speler', kl: '3.0', vrouw: 'nee', jeugd: false };
    expect(() =>
      rosterConverter.fromFirestore!(mockSnapshot({ ...validRoster, players: [malformedPlayer] }), {}),
    ).toThrow(DocumentValidationError);
  });
});

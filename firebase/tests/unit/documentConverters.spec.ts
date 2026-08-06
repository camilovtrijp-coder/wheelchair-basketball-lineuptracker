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

  it('team', () => {
    const doc: TeamDocument = { name: 'U23', createdBy: 'uid-alice', createdAt: Timestamp.now() };
    const stored = teamConverter.toFirestore(doc);
    expect(teamConverter.fromFirestore!(mockSnapshot(stored as Record<string, unknown>), {})).toEqual(doc);
  });

  it('teamMember', () => {
    const doc: TeamMemberDocument = { role: 'coach', email: 'carol@example.test', addedAt: Timestamp.now() };
    const stored = teamMemberConverter.toFirestore(doc);
    expect(teamMemberConverter.fromFirestore!(mockSnapshot(stored as Record<string, unknown>), {})).toEqual(doc);
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

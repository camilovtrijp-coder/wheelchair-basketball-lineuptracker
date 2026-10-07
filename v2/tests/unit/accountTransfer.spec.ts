// PR 8.3c-2b-iii — pure helpers voor de overdracht (docs/pr-8.3c-2b-plan.md §B.7/§B.8).
// Alleen fictieve uid's en adressen.
import { describe, expect, it } from 'vitest';
import {
  checkCompleteTarget,
  checkPromoteTarget,
  isFootprintEmpty,
  isOpenInvitationStatus,
  isOwnerRole,
  isReadyForMemberRemoval,
  isSameEmailAddress,
  normalizeEmailForMatch,
  splitTransferMembers,
  type TransferMember,
} from '../../src/domain/account/transfer';
import { INVITATION_STATUSES } from '../../src/domain/invitations/types';
import { ORGANIZATION_ROLES } from '../../src/domain/organizations/types';

const A = 'uid-fictief-a';
const B = 'uid-fictief-b';
const C = 'uid-fictief-c';
const D = 'uid-fictief-d';

const MEMBERS: TransferMember[] = [
  { uid: D, role: 'viewer', email: 'd@example.test' },
  { uid: A, role: 'organizationOwner', email: 'a@example.test' },
  { uid: C, role: 'organizationOwner', email: 'c@example.test' },
  { uid: B, role: 'coach', email: 'b@example.test' },
];

describe('isOwnerRole / isOpenInvitationStatus', () => {
  it('alleen organizationOwner is owner', () => {
    expect(ORGANIZATION_ROLES.filter(isOwnerRole)).toEqual(['organizationOwner']);
  });

  it('alleen pending en accepted zijn open (intrekbaar en nog claimbaar)', () => {
    expect(INVITATION_STATUSES.filter(isOpenInvitationStatus)).toEqual(['pending', 'accepted']);
  });
});

describe('e-mailvergelijking', () => {
  it('normaliseert spaties en hoofdletters', () => {
    expect(normalizeEmailForMatch('  Fictief.Lid@Example.TEST ')).toBe('fictief.lid@example.test');
  });

  it('matcht hetzelfde adres in een andere spelling, nooit een ander adres of een leeg adres', () => {
    expect(isSameEmailAddress('lid@example.test', 'LID@example.test')).toBe(true);
    expect(isSameEmailAddress('lid@example.test', 'lid2@example.test')).toBe(false);
    expect(isSameEmailAddress('lid@example.test', 'lid@example.test.evil')).toBe(false);
    expect(isSameEmailAddress('', '')).toBe(false);
    expect(isSameEmailAddress('  ', ' ')).toBe(false);
  });
});

describe('splitTransferMembers', () => {
  it('kandidaten = niet-owners; andere owners = owners; de aanroeper nooit; gesorteerd op uid', () => {
    expect(splitTransferMembers(MEMBERS, A)).toEqual({
      candidates: [
        { uid: B, role: 'coach', email: 'b@example.test' },
        { uid: D, role: 'viewer', email: 'd@example.test' },
      ],
      otherOwners: [{ uid: C, role: 'organizationOwner', email: 'c@example.test' }],
    });
  });

  it('een lone owner heeft geen andere owners', () => {
    const lone = MEMBERS.filter((member) => member.uid !== C);
    expect(splitTransferMembers(lone, A).otherOwners).toEqual([]);
  });

  it('wijzigt de invoer niet', () => {
    const copy = MEMBERS.map((member) => ({ ...member }));
    splitTransferMembers(MEMBERS, A);
    expect(MEMBERS).toEqual(copy);
  });
});

describe('checkPromoteTarget', () => {
  it('zichzelf → self, ook als de aanroeper in de lijst staat', () => {
    expect(checkPromoteTarget(MEMBERS, A, A)).toEqual({ ok: false, reason: 'self' });
  });

  it('geen lid → not-found', () => {
    expect(checkPromoteTarget(MEMBERS, A, 'uid-fictief-vreemd')).toEqual({
      ok: false,
      reason: 'not-found',
    });
  });

  it('niet-owner-lid → ok met de huidige rol als verwachte rol', () => {
    expect(checkPromoteTarget(MEMBERS, A, B)).toEqual({
      ok: true,
      target: { uid: B, role: 'coach', email: 'b@example.test' },
      alreadyOwner: false,
    });
  });

  it('al owner → ok, alreadyOwner (idempotent)', () => {
    expect(checkPromoteTarget(MEMBERS, A, C)).toMatchObject({ ok: true, alreadyOwner: true });
  });
});

describe('checkCompleteTarget', () => {
  it('zichzelf → self', () => {
    expect(checkCompleteTarget(MEMBERS, C, C)).toEqual({ ok: false, reason: 'self' });
  });

  it('geen lid (meer) → not-found', () => {
    expect(checkCompleteTarget(MEMBERS, C, 'uid-fictief-weg')).toEqual({
      ok: false,
      reason: 'not-found',
    });
  });

  it('een gewoon lid is geen overdracht → target-not-owner (B9: alleen andere owners)', () => {
    expect(checkCompleteTarget(MEMBERS, C, B)).toEqual({
      ok: false,
      reason: 'target-not-owner',
    });
  });

  it('andere owner → ok met diens e-mailadres uit de ledenlijst', () => {
    expect(checkCompleteTarget(MEMBERS, C, A)).toEqual({
      ok: true,
      target: { uid: A, role: 'organizationOwner', email: 'a@example.test' },
    });
  });
});

describe('footprint', () => {
  it('klaar voor de membership-delete alleen zonder teamMembers en open uitnodigingen', () => {
    expect(
      isReadyForMemberRemoval({ organizationMember: true, teamMemberships: 0, openInvitations: 0 }),
    ).toBe(true);
    expect(
      isReadyForMemberRemoval({ organizationMember: true, teamMemberships: 1, openInvitations: 0 }),
    ).toBe(false);
    expect(
      isReadyForMemberRemoval({ organizationMember: true, teamMemberships: 0, openInvitations: 1 }),
    ).toBe(false);
  });

  it('leeg alleen als ook het membership weg is', () => {
    expect(
      isFootprintEmpty({ organizationMember: false, teamMemberships: 0, openInvitations: 0 }),
    ).toBe(true);
    expect(
      isFootprintEmpty({ organizationMember: true, teamMemberships: 0, openInvitations: 0 }),
    ).toBe(false);
    expect(
      isFootprintEmpty({ organizationMember: false, teamMemberships: 2, openInvitations: 0 }),
    ).toBe(false);
    expect(
      isFootprintEmpty({ organizationMember: false, teamMemberships: 0, openInvitations: 3 }),
    ).toBe(false);
  });
});

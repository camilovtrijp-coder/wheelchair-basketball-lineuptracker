// PR 8.3c-2b-i — pure classificatie van één organisatie voor "organisatie verlaten"
// (docs/pr-8.3c-2b-plan.md §B.6). Fictieve uid's en organisaties; elke klasse uit
// ORGANIZATION_LEAVE_CLASSES heeft hier minstens één vaste, narekenbare invoer.
import { describe, expect, it } from 'vitest';
import {
  classifyOrganizationForLeave,
  countOtherOwners,
  groupInventoryByOrganization,
  isInventoryEmpty,
  isOpenInvitation,
  isSelfResolvable,
} from '../../src/domain/account/classify';
import {
  ORGANIZATION_LEAVE_CLASSES,
  type AccountInventory,
  type OrganizationFacts,
  type OrganizationLeaveClass,
  type OrganizationSlice,
} from '../../src/domain/account/types';
import type { OrganizationRole } from '../../src/domain/organizations/types';

const ME = 'uid-fictief-ik';
const OTHER = 'uid-fictief-ander';
const ORG = 'org-fictief-a';

function slice(overrides: Partial<OrganizationSlice> = {}): OrganizationSlice {
  return {
    organizationId: ORG,
    membership: { organizationId: ORG, role: 'coach' },
    teamMemberships: [],
    invitations: [],
    ...overrides,
  };
}

function facts(overrides: Partial<OrganizationFacts> = {}): OrganizationFacts {
  return {
    organizationId: ORG,
    exists: true,
    createdBy: OTHER,
    ownerUids: [OTHER],
    deletionRequestStatus: null,
    ...overrides,
  };
}

function asRole(role: OrganizationRole): OrganizationSlice {
  return slice({ membership: { organizationId: ORG, role } });
}

function classify(
  s: OrganizationSlice,
  f: OrganizationFacts | null = facts(),
  localUnsyncedWork = 0,
): OrganizationLeaveClass {
  return classifyOrganizationForLeave({ callerUid: ME, slice: s, facts: f, localUnsyncedWork });
}

describe('classifyOrganizationForLeave — elke klasse', () => {
  const seen = new Set<OrganizationLeaveClass>();
  const record = (value: OrganizationLeaveClass) => {
    seen.add(value);
    return value;
  };

  it.each(['organizationAdmin', 'coach', 'scorer', 'viewer'] as const)(
    'leave: een %s die niet de maker is',
    (role) => {
      expect(record(classify(asRole(role)))).toBe('leave');
    },
  );

  it('leave-team-only: alleen teamMembers-documenten, zonder feiten', () => {
    const s = slice({
      membership: null,
      teamMemberships: [{ organizationId: ORG, teamId: 'team-1', role: 'coach' }],
    });
    expect(record(classify(s, null))).toBe('leave-team-only');
  });

  it('invitations-only: geen membership en geen teamMembers, wel een uitnodiging', () => {
    const s = slice({
      membership: null,
      invitations: [
        { organizationId: ORG, invitationId: 'inv-1', status: 'claimed', role: 'viewer' },
      ],
    });
    expect(record(classify(s, null))).toBe('invitations-only');
  });

  it('owner-sole: owner zonder andere owner', () => {
    expect(record(classify(asRole('organizationOwner'), facts({ ownerUids: [ME] })))).toBe(
      'owner-sole',
    );
  });

  it('owner-awaiting-removal: owner met minstens één andere owner', () => {
    expect(record(classify(asRole('organizationOwner'), facts({ ownerUids: [ME, OTHER] })))).toBe(
      'owner-awaiting-removal',
    );
  });

  it('creator-needs-owner: een GEDEMOVEERDE maker (niet-owner) kan niet zelf vertrekken', () => {
    expect(record(classify(asRole('organizationAdmin'), facts({ createdBy: ME })))).toBe(
      'creator-needs-owner',
    );
    expect(classify(asRole('viewer'), facts({ createdBy: ME }))).toBe('creator-needs-owner');
  });

  it.each(['requested', 'executing'] as const)(
    'awaiting-organization-deletion: owner met verzoek %s',
    (status) => {
      expect(
        record(
          classify(
            asRole('organizationOwner'),
            facts({ ownerUids: [ME], deletionRequestStatus: status }),
          ),
        ),
      ).toBe('awaiting-organization-deletion');
    },
  );

  it.each(['failed', 'completed'] as const)(
    'organization-deletion-failed: owner met verzoek %s (runbookzaak)',
    (status) => {
      expect(
        record(
          classify(
            asRole('organizationOwner'),
            facts({ ownerUids: [ME, OTHER], deletionRequestStatus: status }),
          ),
        ),
      ).toBe('organization-deletion-failed');
    },
  );

  it('een geannuleerd verzoek telt niet: owner valt terug op owner-sole', () => {
    expect(
      classify(
        asRole('organizationOwner'),
        facts({ ownerUids: [ME], deletionRequestStatus: 'cancelled' }),
      ),
    ).toBe('owner-sole');
  });

  it('organization-unsupported: organisatie zonder (leesbare) createdBy', () => {
    expect(record(classify(asRole('coach'), facts({ createdBy: null })))).toBe(
      'organization-unsupported',
    );
  });

  it('organization-unsupported: een membership zonder feitenset valt dicht (nooit leave)', () => {
    expect(classify(asRole('coach'), null)).toBe('organization-unsupported');
  });

  it('organization-unsupported: feiten van een ANDERE organisatie worden niet geaccepteerd', () => {
    expect(classify(asRole('coach'), facts({ organizationId: 'org-fictief-b' }))).toBe(
      'organization-unsupported',
    );
  });

  it('organization-missing: membership zonder organisatiedocument (wees-membership)', () => {
    expect(
      record(classify(asRole('coach'), facts({ exists: false, createdBy: null, ownerUids: [] }))),
    ).toBe('organization-missing');
  });

  it('local-unsynced-work gaat vóór alles, ook vóór een team-only lid en een owner', () => {
    expect(record(classify(asRole('coach'), facts(), 1))).toBe('local-unsynced-work');
    expect(
      classify(
        slice({
          membership: null,
          teamMemberships: [{ organizationId: ORG, teamId: 'team-1', role: 'scorer' }],
        }),
        null,
        2,
      ),
    ).toBe('local-unsynced-work');
    expect(classify(asRole('organizationOwner'), facts({ ownerUids: [ME] }), 1)).toBe(
      'local-unsynced-work',
    );
  });

  it('een niet-owner bij een lopend verwijderverzoek mag gewoon vertrekken', () => {
    expect(classify(asRole('coach'), facts({ deletionRequestStatus: 'requested' }))).toBe('leave');
  });

  it('dekt alle klassen uit ORGANIZATION_LEAVE_CLASSES', () => {
    expect([...seen].sort()).toEqual([...ORGANIZATION_LEAVE_CLASSES].sort());
  });
});

describe('isSelfResolvable', () => {
  it('alleen leave, leave-team-only en invitations-only', () => {
    const resolvable = ORGANIZATION_LEAVE_CLASSES.filter(isSelfResolvable);
    expect(resolvable.sort()).toEqual(['invitations-only', 'leave', 'leave-team-only']);
  });
});

describe('countOtherOwners', () => {
  it('telt de aanroeper niet en telt dubbele uid’s één keer', () => {
    expect(countOtherOwners(facts({ ownerUids: [ME, OTHER, OTHER, 'uid-c'] }), ME)).toBe(2);
    expect(countOtherOwners(facts({ ownerUids: [ME] }), ME)).toBe(0);
  });
});

describe('isOpenInvitation', () => {
  it('pending en accepted zijn open; claimed en revoked niet', () => {
    expect(isOpenInvitation({ status: 'pending' })).toBe(true);
    expect(isOpenInvitation({ status: 'accepted' })).toBe(true);
    expect(isOpenInvitation({ status: 'claimed' })).toBe(false);
    expect(isOpenInvitation({ status: 'revoked' })).toBe(false);
  });
});

const INVENTORY: AccountInventory = {
  organizationMemberships: [
    { organizationId: 'org-a', role: 'coach' },
    { organizationId: 'org-b', role: 'organizationOwner' },
  ],
  teamMemberships: [
    { organizationId: 'org-a', teamId: 't1', role: 'coach' },
    { organizationId: 'org-a', teamId: 't2', role: 'scorer' },
    { organizationId: 'org-c', teamId: 't3', role: 'viewer' },
  ],
  invitations: [
    { organizationId: 'org-a', invitationId: 'i1', status: 'pending', role: 'organizationAdmin' },
    { organizationId: 'org-d', invitationId: 'i2', status: 'claimed', role: 'viewer' },
  ],
};

describe('groupInventoryByOrganization', () => {
  it('groepeert elk eigen document onder zijn organisatie', () => {
    const groups = groupInventoryByOrganization(INVENTORY);
    expect([...groups.keys()].sort()).toEqual(['org-a', 'org-b', 'org-c', 'org-d']);
    expect(groups.get('org-a')).toEqual({
      organizationId: 'org-a',
      membership: { organizationId: 'org-a', role: 'coach' },
      teamMemberships: [
        { organizationId: 'org-a', teamId: 't1', role: 'coach' },
        { organizationId: 'org-a', teamId: 't2', role: 'scorer' },
      ],
      invitations: [INVENTORY.invitations[0]],
    });
    expect(groups.get('org-c')?.membership).toBeNull();
    expect(groups.get('org-d')?.teamMemberships).toEqual([]);
  });

  it('een lege inventaris geeft een lege map', () => {
    expect(
      groupInventoryByOrganization({
        organizationMemberships: [],
        teamMemberships: [],
        invitations: [],
      }).size,
    ).toBe(0);
  });
});

describe('isInventoryEmpty', () => {
  const empty: AccountInventory = {
    organizationMemberships: [],
    teamMemberships: [],
    invitations: [],
  };

  it('zonder scope: alleen leeg als alle drie de lijsten leeg zijn', () => {
    expect(isInventoryEmpty(empty)).toBe(true);
    expect(isInventoryEmpty(INVENTORY)).toBe(false);
    expect(isInventoryEmpty({ ...empty, invitations: [INVENTORY.invitations[1]!] })).toBe(false);
    expect(isInventoryEmpty({ ...empty, teamMemberships: [INVENTORY.teamMemberships[2]!] })).toBe(
      false,
    );
  });

  it('met scope: kijkt alleen naar die organisatie', () => {
    expect(isInventoryEmpty(INVENTORY, { organizationId: 'org-z' })).toBe(true);
    expect(isInventoryEmpty(INVENTORY, { organizationId: 'org-a' })).toBe(false);
    expect(isInventoryEmpty(INVENTORY, { organizationId: 'org-c' })).toBe(false);
    expect(isInventoryEmpty(INVENTORY, { organizationId: 'org-d' })).toBe(false);
  });
});

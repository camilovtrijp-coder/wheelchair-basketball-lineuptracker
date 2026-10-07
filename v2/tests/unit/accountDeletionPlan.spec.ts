// PR 8.3c-2b-ii — buildAccountDeletionPlan (docs/pr-8.3c-2b-plan.md §B.6, §B.9 stap 3,
// §C.2). Puur; elke klasse en `canProceed` met vaste, handmatig narekenbare invoer.
// Alleen fictieve uid's en organisaties.
import { describe, expect, it } from 'vitest';
import { buildAccountDeletionPlan } from '../../src/domain/account/plan';
import type {
  AccountInventory,
  OrganizationFacts,
  OrganizationLeaveClass,
} from '../../src/domain/account/types';
import { ORGANIZATION_LEAVE_CLASSES } from '../../src/domain/account/types';

const ME = 'uid-fictief-ik';
const OWNER = 'uid-fictief-owner';
const OWNER_2 = 'uid-fictief-owner-2';

function facts(organizationId: string, overrides: Partial<OrganizationFacts> = {}) {
  return {
    organizationId,
    exists: true,
    createdBy: OWNER,
    ownerUids: [OWNER],
    deletionRequestStatus: null,
    ...overrides,
  } satisfies OrganizationFacts;
}

const EMPTY: AccountInventory = {
  organizationMemberships: [],
  teamMemberships: [],
  invitations: [],
};

/**
 * Eén inventaris met precies één organisatie per klasse uit §B.6. De org-ID is de
 * verwachte klasse, zodat het plan regel voor regel na te lopen is.
 */
function everyClass() {
  const inventory: AccountInventory = {
    organizationMemberships: [
      { organizationId: 'leave', role: 'coach' },
      { organizationId: 'owner-sole', role: 'organizationOwner' },
      { organizationId: 'owner-awaiting-removal', role: 'organizationOwner' },
      { organizationId: 'creator-needs-owner', role: 'organizationAdmin' },
      { organizationId: 'awaiting-organization-deletion', role: 'organizationOwner' },
      { organizationId: 'organization-deletion-failed', role: 'organizationOwner' },
      { organizationId: 'organization-unsupported', role: 'viewer' },
      { organizationId: 'organization-missing', role: 'scorer' },
      { organizationId: 'local-unsynced-work', role: 'coach' },
    ],
    teamMemberships: [
      { organizationId: 'leave', teamId: 't1', role: 'coach' },
      { organizationId: 'leave-team-only', teamId: 't2', role: 'scorer' },
    ],
    invitations: [
      {
        organizationId: 'invitations-only',
        invitationId: 'i1',
        status: 'claimed',
        role: 'viewer',
      },
      { organizationId: 'leave', invitationId: 'i2', status: 'pending', role: 'coach' },
    ],
  };
  const factsByOrganization = new Map<string, OrganizationFacts>([
    ['leave', facts('leave')],
    ['owner-sole', facts('owner-sole', { createdBy: ME, ownerUids: [ME] })],
    [
      'owner-awaiting-removal',
      facts('owner-awaiting-removal', { ownerUids: [ME, OWNER, OWNER_2] }),
    ],
    ['creator-needs-owner', facts('creator-needs-owner', { createdBy: ME })],
    [
      'awaiting-organization-deletion',
      facts('awaiting-organization-deletion', {
        ownerUids: [ME],
        deletionRequestStatus: 'requested',
      }),
    ],
    [
      'organization-deletion-failed',
      facts('organization-deletion-failed', { ownerUids: [ME], deletionRequestStatus: 'failed' }),
    ],
    ['organization-unsupported', facts('organization-unsupported', { createdBy: null })],
    ['organization-missing', facts('organization-missing', { exists: false, createdBy: null })],
    ['local-unsynced-work', facts('local-unsynced-work')],
  ]);
  return {
    inventory,
    factsByOrganization,
    localUnsyncedWorkByOrganization: new Map([['local-unsynced-work', 2]]),
  };
}

describe('buildAccountDeletionPlan', () => {
  it('lege inventaris → leeg plan, canProceed (alleen het Auth-account is nog over)', () => {
    expect(
      buildAccountDeletionPlan({
        callerUid: ME,
        inventory: EMPTY,
        factsByOrganization: new Map(),
        localUnsyncedWorkByOrganization: new Map(),
      }),
    ).toEqual({ organizations: [], invitationCount: 0, canProceed: true });
  });

  it('classificeert elke klasse uit §B.6, met otherOwnerCount en localUnsyncedWork waar relevant', () => {
    const plan = buildAccountDeletionPlan({ callerUid: ME, ...everyClass() });
    expect(plan.organizations).toEqual([
      { organizationId: 'leave', class: 'leave' },
      { organizationId: 'owner-sole', class: 'owner-sole', otherOwnerCount: 0 },
      {
        organizationId: 'owner-awaiting-removal',
        class: 'owner-awaiting-removal',
        otherOwnerCount: 2,
      },
      { organizationId: 'creator-needs-owner', class: 'creator-needs-owner' },
      { organizationId: 'awaiting-organization-deletion', class: 'awaiting-organization-deletion' },
      { organizationId: 'organization-deletion-failed', class: 'organization-deletion-failed' },
      { organizationId: 'organization-unsupported', class: 'organization-unsupported' },
      { organizationId: 'organization-missing', class: 'organization-missing' },
      { organizationId: 'local-unsynced-work', class: 'local-unsynced-work', localUnsyncedWork: 2 },
      { organizationId: 'leave-team-only', class: 'leave-team-only' },
      { organizationId: 'invitations-only', class: 'invitations-only' },
    ]);
    // Elke klasse komt precies één keer voor: de fixture dekt de hele unie.
    expect(new Set(plan.organizations.map((entry) => entry.class))).toEqual(
      new Set<OrganizationLeaveClass>(ORGANIZATION_LEAVE_CLASSES),
    );
    // Uitnodigingen tellen over ALLE organisaties en statussen (§B.9 stap 5).
    expect(plan.invitationCount).toBe(2);
    expect(plan.canProceed).toBe(false);
  });

  it.each<OrganizationLeaveClass>([
    'owner-sole',
    'owner-awaiting-removal',
    'creator-needs-owner',
    'awaiting-organization-deletion',
    'organization-deletion-failed',
    'organization-unsupported',
    'organization-missing',
    'local-unsynced-work',
  ])('één organisatie met %s naast oplosbare organisaties → canProceed false', (blocking) => {
    const all = everyClass();
    const keep = new Set<string>(['leave', 'leave-team-only', 'invitations-only', blocking]);
    const inventory: AccountInventory = {
      organizationMemberships: all.inventory.organizationMemberships.filter((m) =>
        keep.has(m.organizationId),
      ),
      teamMemberships: all.inventory.teamMemberships.filter((t) => keep.has(t.organizationId)),
      invitations: all.inventory.invitations.filter((i) => keep.has(i.organizationId)),
    };
    const plan = buildAccountDeletionPlan({ callerUid: ME, ...all, inventory });
    expect(plan.organizations.map((entry) => entry.class).sort()).toEqual(
      [...keep].sort() as OrganizationLeaveClass[],
    );
    expect(plan.canProceed).toBe(false);
  });

  it('alleen leave, leave-team-only en invitations-only → canProceed true', () => {
    const all = everyClass();
    const keep = new Set(['leave', 'leave-team-only', 'invitations-only']);
    const inventory: AccountInventory = {
      organizationMemberships: all.inventory.organizationMemberships.filter((m) =>
        keep.has(m.organizationId),
      ),
      teamMemberships: all.inventory.teamMemberships.filter((t) => keep.has(t.organizationId)),
      invitations: all.inventory.invitations,
    };
    const plan = buildAccountDeletionPlan({ callerUid: ME, ...all, inventory });
    expect(plan).toEqual({
      organizations: [
        { organizationId: 'leave', class: 'leave' },
        { organizationId: 'leave-team-only', class: 'leave-team-only' },
        { organizationId: 'invitations-only', class: 'invitations-only' },
      ],
      invitationCount: 2,
      canProceed: true,
    });
  });

  it('membership zonder feiten valt dicht op organization-unsupported (geen leave)', () => {
    const plan = buildAccountDeletionPlan({
      callerUid: ME,
      inventory: {
        ...EMPTY,
        organizationMemberships: [{ organizationId: 'org-x', role: 'coach' }],
      },
      factsByOrganization: new Map(),
      localUnsyncedWorkByOrganization: new Map(),
    });
    expect(plan).toEqual({
      organizations: [{ organizationId: 'org-x', class: 'organization-unsupported' }],
      invitationCount: 0,
      canProceed: false,
    });
  });

  it('lokaal onbevestigd werk blokkeert ook een organisatie met alleen uitnodigingen (fail closed)', () => {
    const plan = buildAccountDeletionPlan({
      callerUid: ME,
      inventory: {
        ...EMPTY,
        invitations: [
          { organizationId: 'org-y', invitationId: 'i', status: 'pending', role: 'viewer' },
        ],
      },
      factsByOrganization: new Map(),
      localUnsyncedWorkByOrganization: new Map([['org-y', 1]]),
    });
    expect(plan.organizations).toEqual([
      { organizationId: 'org-y', class: 'local-unsynced-work', localUnsyncedWork: 1 },
    ]);
    expect(plan.canProceed).toBe(false);
  });

  it('een telling voor een organisatie buiten de inventaris verandert niets', () => {
    const plan = buildAccountDeletionPlan({
      callerUid: ME,
      inventory: EMPTY,
      factsByOrganization: new Map(),
      localUnsyncedWorkByOrganization: new Map([['org-elders', 5]]),
    });
    expect(plan).toEqual({ organizations: [], invitationCount: 0, canProceed: true });
  });

  it('een owner telt zichzelf niet mee als andere owner', () => {
    const plan = buildAccountDeletionPlan({
      callerUid: ME,
      inventory: {
        ...EMPTY,
        organizationMemberships: [{ organizationId: 'org-z', role: 'organizationOwner' }],
      },
      factsByOrganization: new Map([['org-z', facts('org-z', { ownerUids: [ME, ME, OWNER] })]]),
      localUnsyncedWorkByOrganization: new Map(),
    });
    expect(plan.organizations).toEqual([
      { organizationId: 'org-z', class: 'owner-awaiting-removal', otherOwnerCount: 1 },
    ]);
  });
});

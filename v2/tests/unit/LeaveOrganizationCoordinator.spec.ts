// PR 8.3c-2b-i — LeaveOrganizationCoordinator (docs/pr-8.3c-2b-plan.md §C.1, §D).
// Een nep-gateway met een eigen in-memory "server" (fictieve uid's/organisaties): zo
// bewijzen we elke uitkomst, elke stapfout, de vaste schrijfvolgorde (teamMembers →
// uitnodigingen → per-organisatie-controle → organizationMembers als LAATSTE), het
// hervatten uit een verse inventaris en de idempotentie van een tweede leave().
import { describe, expect, it } from 'vitest';
import {
  LeaveOrganizationCoordinator,
  type LeaveOrganizationOutcome,
} from '../../src/application/account/LeaveOrganizationCoordinator';
import type { AccountReadError } from '../../src/application/account/AccountGateway';
import type { OrganizationFacts } from '../../src/domain/account/types';
import type { DeletionRequestStatus } from '../../src/domain/deletion/types';
import type { OrganizationRole } from '../../src/domain/organizations/types';
import { FakeAccountGateway, FakeProbe, type ServerState } from './support/accountFakes';

const ME = 'uid-fictief-coach';
const OTHER_OWNER = 'uid-fictief-owner';
const ORG_A = 'org-fictief-a';
const ORG_B = 'org-fictief-b';

function facts(
  overrides: Partial<Omit<OrganizationFacts, 'organizationId'>> = {},
): Omit<OrganizationFacts, 'organizationId'> {
  return {
    exists: true,
    createdBy: OTHER_OWNER,
    ownerUids: [OTHER_OWNER],
    deletionRequestStatus: null,
    ...overrides,
  };
}

/** Coach in org A (twee teams, vier eigen uitnodigingen) en viewer in org B. */
function standardState(): ServerState {
  return {
    memberships: new Map<string, OrganizationRole>([
      [ORG_A, 'coach'],
      [ORG_B, 'viewer'],
    ]),
    teams: [
      { organizationId: ORG_A, teamId: 'team-a1', role: 'coach' },
      { organizationId: ORG_A, teamId: 'team-a2', role: 'coach' },
      { organizationId: ORG_B, teamId: 'team-b1', role: 'viewer' },
    ],
    invitations: [
      {
        organizationId: ORG_A,
        invitationId: 'inv-pending',
        status: 'pending',
        role: 'organizationAdmin',
      },
      {
        organizationId: ORG_A,
        invitationId: 'inv-accepted',
        status: 'accepted',
        role: 'organizationOwner',
      },
      { organizationId: ORG_A, invitationId: 'inv-claimed', status: 'claimed', role: 'coach' },
      { organizationId: ORG_A, invitationId: 'inv-revoked', status: 'revoked', role: 'scorer' },
      { organizationId: ORG_B, invitationId: 'inv-b-pending', status: 'pending', role: 'coach' },
    ],
    facts: new Map([
      [ORG_A, facts()],
      [ORG_B, facts()],
    ]),
  };
}

function setup(state: ServerState = standardState(), probe = new FakeProbe()) {
  const gateway = new FakeAccountGateway(state, {
    uid: ME,
    email: 'coach@example.test',
    emailVerified: true,
  });
  const coordinator = new LeaveOrganizationCoordinator(gateway, probe);
  return { gateway, coordinator, state };
}

const HAPPY_CALLS = [
  'identity',
  'inventory+inv',
  `facts:${ORG_A}`,
  `deleteTeam:${ORG_A}/team-a1`,
  `deleteTeam:${ORG_A}/team-a2`,
  `deleteInvitation:${ORG_A}/inv-pending`,
  `deleteInvitation:${ORG_A}/inv-accepted`,
  'inventory+inv',
  `deleteMembership:${ORG_A}`,
  'inventory',
];

describe('LeaveOrganizationCoordinator — geslaagd vertrek', () => {
  it('volgt de vaste volgorde: teamMembers → open uitnodigingen → controle → membership LAATST → eindcontrole', async () => {
    const { gateway, coordinator, state } = setup();
    const outcome = await coordinator.leave(ORG_A);

    expect(outcome).toEqual({
      status: 'ok',
      removed: { teamMembers: 2, invitations: 2, organizationMember: true },
      organizationDeletionPending: false,
      invitationsChecked: true,
    });
    expect(gateway.calls).toEqual(HAPPY_CALLS);
    // Het membership is de allerlaatste write, en de eindcontrole komt daarná.
    const writes = gateway.writes();
    expect(writes.at(-1)).toBe(`deleteMembership:${ORG_A}`);
    expect(gateway.calls.lastIndexOf('inventory')).toBeGreaterThan(
      gateway.calls.indexOf(`deleteMembership:${ORG_A}`),
    );

    // B3: claimed/revoked blijven staan; org B is volledig onaangeroerd.
    expect(state.invitations.map((i) => i.invitationId).sort()).toEqual([
      'inv-b-pending',
      'inv-claimed',
      'inv-revoked',
    ]);
    expect(state.memberships.get(ORG_B)).toBe('viewer');
    expect(state.teams).toEqual([{ organizationId: ORG_B, teamId: 'team-b1', role: 'viewer' }]);
  });

  it('een tweede leave() na een geslaagde eerste is not-a-member, zonder één write', async () => {
    const { gateway, coordinator } = setup();
    await coordinator.leave(ORG_A);
    const writesAfterFirst = gateway.writes().length;

    expect(await coordinator.leave(ORG_A)).toEqual({ status: 'not-a-member' });
    expect(gateway.writes().length).toBe(writesAfterFirst);
  });

  it('team-only lid: geen feitenread, geen membership-delete, wel de eindcontrole', async () => {
    const state = standardState();
    state.memberships.delete(ORG_A);
    state.invitations = [];
    const { gateway, coordinator } = setup(state);

    expect(await coordinator.leave(ORG_A)).toEqual({
      status: 'ok',
      removed: { teamMembers: 2, invitations: 0, organizationMember: false },
      organizationDeletionPending: false,
      invitationsChecked: true,
    });
    expect(gateway.calls).not.toContain(`facts:${ORG_A}`);
    expect(gateway.writes()).toEqual([
      `deleteTeam:${ORG_A}/team-a1`,
      `deleteTeam:${ORG_A}/team-a2`,
    ]);
  });

  it('een niet-owner bij een lopend verwijderverzoek vertrekt gewoon, met de informatieve vlag', async () => {
    const state = standardState();
    state.facts.set(ORG_A, facts({ deletionRequestStatus: 'executing' }));
    const { coordinator } = setup(state);
    const outcome = await coordinator.leave(ORG_A);
    expect(outcome.status).toBe('ok');
    expect(outcome).toMatchObject({ organizationDeletionPending: true });
  });

  it('zonder geverifieerde e-mailclaim: geen uitnodigingsquery en geen uitnodigingsdelete', async () => {
    const { gateway, coordinator } = setup();
    gateway.identity = { uid: ME, email: 'coach@example.test', emailVerified: false };
    const outcome = await coordinator.leave(ORG_A);

    // Reviewbevinding A op 2b-i: de aanroeper ziet dat de uitnodigingen NIET bekeken zijn.
    expect(outcome).toMatchObject({
      status: 'ok',
      removed: { invitations: 0 },
      invitationsChecked: false,
    });
    expect(gateway.calls).not.toContain('inventory+inv');
    expect(gateway.writes().some((w) => w.startsWith('deleteInvitation'))).toBe(false);
  });

  it('zonder e-mailadres in het token: idem, geen uitnodigingsquery', async () => {
    const { gateway, coordinator } = setup();
    gateway.identity = { uid: ME, email: null, emailVerified: true };
    expect(await coordinator.leave(ORG_A)).toMatchObject({
      status: 'ok',
      invitationsChecked: false,
    });
    expect(gateway.calls).not.toContain('inventory+inv');
  });

  it('membership al weg vóór de laatste write (door een ander verwijderd): geen delete, wel ok', async () => {
    const { gateway, coordinator, state } = setup();
    gateway.hooks.set('inventory#2', () => state.memberships.delete(ORG_A));
    const outcome = await coordinator.leave(ORG_A);

    expect(outcome).toMatchObject({ status: 'ok', removed: { organizationMember: false } });
    expect(gateway.writes()).not.toContain(`deleteMembership:${ORG_A}`);
  });

  it('membership-delete meldt already-gone: geen fout, ok met organizationMember=false', async () => {
    const { gateway, coordinator, state } = setup();
    // Tussen de controle en de delete verdwijnt het membership; de gateway ziet dat bij
    // het teruglezen en meldt already-gone in plaats van een (Rules-)weigering.
    gateway.hooks.set('deleteMembership#1', () => state.memberships.delete(ORG_A));
    const outcome = await coordinator.leave(ORG_A);
    expect(outcome).toMatchObject({ status: 'ok', removed: { organizationMember: false } });
  });

  it('already-gone zonder dat het membership echt weg is, wordt door de eindcontrole gevangen', async () => {
    const { gateway, coordinator } = setup();
    gateway.failures.set('deleteMembership#1', { ok: true, outcome: 'already-gone' });
    expect(await coordinator.leave(ORG_A)).toEqual({ status: 'incomplete', stage: 'final-check' });
  });
});

describe('LeaveOrganizationCoordinator — preflight zonder enige write', () => {
  it.each<[AccountReadError, LeaveOrganizationOutcome]>([
    [{ code: 'offline' }, { status: 'offline' }],
    [{ code: 'timeout' }, { status: 'failed', reason: 'timeout' }],
    [
      { code: 'read-failed', detail: 'x' },
      { status: 'failed', reason: 'read-failed' },
    ],
  ])(
    'tokenverversing in de preflight faalt (%o) → %o, geen inventaris en geen write',
    async (error, expected) => {
      const { gateway, coordinator } = setup();
      gateway.failures.set('identity#1', { ok: false, error });
      expect(await coordinator.leave(ORG_A)).toEqual(expected);
      expect(gateway.calls).toEqual(['identity']);
    },
  );

  it('niet ingelogd → not-signed-in', async () => {
    const { gateway, coordinator } = setup();
    gateway.identity = null;
    expect(await coordinator.leave(ORG_A)).toEqual({ status: 'not-signed-in' });
    expect(gateway.calls).toEqual(['identity']);
  });

  it.each<[AccountReadError, LeaveOrganizationOutcome]>([
    [{ code: 'offline' }, { status: 'offline' }],
    [{ code: 'timeout' }, { status: 'failed', reason: 'timeout' }],
    [
      { code: 'read-failed', detail: 'x' },
      { status: 'failed', reason: 'read-failed' },
    ],
    [{ code: 'email-not-verified' }, { status: 'failed', reason: 'read-failed' }],
    [{ code: 'not-signed-in' }, { status: 'not-signed-in' }],
  ])('inventarisfout %o → %o, nooit "leeg"', async (error, expected) => {
    const { gateway, coordinator } = setup();
    gateway.failures.set('inventory#1', { ok: false, error });
    expect(await coordinator.leave(ORG_A)).toEqual(expected);
    expect(gateway.writes()).toEqual([]);
  });

  it.each<[AccountReadError, LeaveOrganizationOutcome]>([
    [{ code: 'offline' }, { status: 'offline' }],
    [{ code: 'timeout' }, { status: 'failed', reason: 'timeout' }],
    [
      { code: 'read-failed', detail: 'converter' },
      { status: 'failed', reason: 'read-failed' },
    ],
  ])('feitenfout %o → %o', async (error, expected) => {
    const { gateway, coordinator } = setup();
    gateway.failures.set('facts#1', { ok: false, error });
    expect(await coordinator.leave(ORG_A)).toEqual(expected);
    expect(gateway.writes()).toEqual([]);
  });

  it('cross-org: leave(org) zonder eigen document daar → not-a-member, nul writes, andere org intact', async () => {
    const { gateway, coordinator, state } = setup();
    expect(await coordinator.leave('org-fictief-vreemd')).toEqual({ status: 'not-a-member' });
    expect(gateway.writes()).toEqual([]);
    expect(gateway.calls).not.toContain('facts:org-fictief-vreemd');
    expect(state.memberships.size).toBe(2);
  });

  it('alleen eigen uitnodigingen in die organisatie → not-a-member, de uitnodigingen blijven', async () => {
    const state = standardState();
    state.memberships.delete(ORG_A);
    state.teams = state.teams.filter((t) => t.organizationId !== ORG_A);
    const { gateway, coordinator } = setup(state);
    expect(await coordinator.leave(ORG_A)).toEqual({ status: 'not-a-member' });
    expect(gateway.writes()).toEqual([]);
    expect(state.invitations.filter((i) => i.organizationId === ORG_A)).toHaveLength(4);
  });

  it.each<
    [
      string,
      OrganizationRole,
      Partial<Omit<OrganizationFacts, 'organizationId'>>,
      LeaveOrganizationOutcome,
    ]
  >([
    [
      'lone owner',
      'organizationOwner',
      { createdBy: ME, ownerUids: [ME] },
      { status: 'denied', reason: 'owner-sole', otherOwnerCount: 0 },
    ],
    [
      'owner met twee andere owners',
      'organizationOwner',
      { ownerUids: [ME, OTHER_OWNER, 'uid-fictief-derde'] },
      { status: 'denied', reason: 'owner-awaiting-removal', otherOwnerCount: 2 },
    ],
    [
      'gedemoveerde maker',
      'organizationAdmin',
      { createdBy: ME },
      { status: 'denied', reason: 'creator-needs-owner' },
    ],
    [
      'organisatie zonder createdBy',
      'coach',
      { createdBy: null },
      { status: 'denied', reason: 'organization-unsupported' },
    ],
    [
      'wees-membership',
      'coach',
      { exists: false, createdBy: null, ownerUids: [] },
      { status: 'denied', reason: 'organization-missing' },
    ],
    [
      'owner met lopend verwijderverzoek',
      'organizationOwner',
      { ownerUids: [ME], deletionRequestStatus: 'requested' as DeletionRequestStatus },
      { status: 'denied', reason: 'awaiting-organization-deletion' },
    ],
    [
      'owner met mislukt verwijderverzoek',
      'organizationOwner',
      { ownerUids: [ME], deletionRequestStatus: 'failed' as DeletionRequestStatus },
      { status: 'denied', reason: 'organization-deletion-failed' },
    ],
  ])(
    '%s → denied, en ook GEEN teamMembers-delete',
    async (_label, role, factOverrides, expected) => {
      const state = standardState();
      state.memberships.set(ORG_A, role);
      state.facts.set(ORG_A, facts(factOverrides));
      const { gateway, coordinator } = setup(state);

      expect(await coordinator.leave(ORG_A)).toEqual(expected);
      expect(gateway.writes()).toEqual([]);
      expect(state.teams.filter((t) => t.organizationId === ORG_A)).toHaveLength(2);
    },
  );

  it('onbevestigd lokaal werk voor org A blokkeert leave(A), niet leave(B)', async () => {
    const { gateway, coordinator } = setup(standardState(), new FakeProbe({ [ORG_A]: 3 }));
    expect(await coordinator.leave(ORG_A)).toEqual({
      status: 'blocked',
      reason: 'local-unsynced-work',
      count: 3,
    });
    expect(gateway.writes()).toEqual([]);

    expect((await coordinator.leave(ORG_B)).status).toBe('ok');
  });

  it('onbevestigd lokaal werk blokkeert ook een team-only lid', async () => {
    const state = standardState();
    state.memberships.delete(ORG_A);
    const { gateway, coordinator } = setup(state, new FakeProbe({ [ORG_A]: 1 }));
    expect(await coordinator.leave(ORG_A)).toMatchObject({ status: 'blocked', count: 1 });
    expect(gateway.writes()).toEqual([]);
  });
});

describe('LeaveOrganizationCoordinator — stapfouten stoppen de flow', () => {
  it('teamMembers-delete geweigerd → incomplete(team-members), daarna géén enkele write', async () => {
    const { gateway, coordinator } = setup();
    gateway.failures.set('deleteTeam#2', { ok: false, error: { code: 'rejected' } });
    expect(await coordinator.leave(ORG_A)).toEqual({
      status: 'incomplete',
      stage: 'team-members',
      error: { code: 'rejected' },
    });
    expect(gateway.writes()).toEqual([
      `deleteTeam:${ORG_A}/team-a1`,
      `deleteTeam:${ORG_A}/team-a2`,
    ]);
  });

  it('uitnodigingsdelete timeout → incomplete(invitations), membership blijft', async () => {
    const { gateway, coordinator, state } = setup();
    gateway.failures.set('deleteInvitation#1', { ok: false, error: { code: 'timeout' } });
    expect(await coordinator.leave(ORG_A)).toEqual({
      status: 'incomplete',
      stage: 'invitations',
      error: { code: 'timeout' },
    });
    expect(gateway.writes().some((w) => w.startsWith('deleteMembership'))).toBe(false);
    expect(state.memberships.has(ORG_A)).toBe(true);
  });

  it('per-organisatie-controle offline → incomplete(per-org-check) met de leesfout, geen membership-delete', async () => {
    const { gateway, coordinator } = setup();
    gateway.failures.set('inventory#2', { ok: false, error: { code: 'offline' } });
    expect(await coordinator.leave(ORG_A)).toEqual({
      status: 'incomplete',
      stage: 'per-org-check',
      error: { code: 'offline' },
    });
    expect(gateway.writes()).not.toContain(`deleteMembership:${ORG_A}`);
  });

  it('per-organisatie-controle vindt een nieuw teamMembers-document (R3) → incomplete, geen membership-delete', async () => {
    const { gateway, coordinator, state } = setup();
    gateway.hooks.set('inventory#2', () =>
      state.teams.push({ organizationId: ORG_A, teamId: 'team-a3', role: 'scorer' }),
    );
    expect(await coordinator.leave(ORG_A)).toEqual({
      status: 'incomplete',
      stage: 'per-org-check',
    });
    expect(gateway.writes()).not.toContain(`deleteMembership:${ORG_A}`);
  });

  it('per-organisatie-controle vindt een nieuwe open uitnodiging → incomplete; een nieuwe CLAIMED niet', async () => {
    const { gateway, coordinator, state } = setup();
    gateway.hooks.set('inventory#2', () =>
      state.invitations.push({
        organizationId: ORG_A,
        invitationId: 'inv-nieuw',
        status: 'pending',
        role: 'organizationOwner',
      }),
    );
    expect(await coordinator.leave(ORG_A)).toEqual({
      status: 'incomplete',
      stage: 'per-org-check',
    });

    const second = setup();
    second.gateway.hooks.set('inventory#2', () =>
      second.state.invitations.push({
        organizationId: ORG_A,
        invitationId: 'inv-oud',
        status: 'claimed',
        role: 'coach',
      }),
    );
    expect((await second.coordinator.leave(ORG_A)).status).toBe('ok');
  });

  it('membership-delete geweigerd (bijv. rol tijdens de flow owner geworden) → incomplete(organization-member)', async () => {
    const { gateway, coordinator } = setup();
    gateway.failures.set('deleteMembership#1', { ok: false, error: { code: 'rejected' } });
    expect(await coordinator.leave(ORG_A)).toEqual({
      status: 'incomplete',
      stage: 'organization-member',
      error: { code: 'rejected' },
    });
    expect(gateway.calls.at(-1)).toBe(`deleteMembership:${ORG_A}`);
  });

  it('eindcontrole vindt nog een eigen document (R3 ná de laatste delete) → incomplete(final-check)', async () => {
    const { gateway, coordinator, state } = setup();
    gateway.hooks.set('inventory#3', () =>
      state.teams.push({ organizationId: ORG_A, teamId: 'team-a9', role: 'viewer' }),
    );
    expect(await coordinator.leave(ORG_A)).toEqual({ status: 'incomplete', stage: 'final-check' });
  });

  it('eindcontrole kan niet van de server lezen → incomplete(final-check), nooit ok', async () => {
    const { gateway, coordinator } = setup();
    gateway.failures.set('inventory#3', { ok: false, error: { code: 'timeout' } });
    expect(await coordinator.leave(ORG_A)).toEqual({
      status: 'incomplete',
      stage: 'final-check',
      error: { code: 'timeout' },
    });
  });

  it('eindcontrole kijkt alleen naar deze organisatie: documenten in org B zijn geen fout', async () => {
    const { coordinator, state } = setup();
    expect((await coordinator.leave(ORG_A)).status).toBe('ok');
    expect(state.memberships.has(ORG_B)).toBe(true);
  });
});

describe('LeaveOrganizationCoordinator — hervatten en dubbele aanroepen', () => {
  it('na een fout op elke stap hervat een nieuwe leave() uit de verse inventaris, zonder dubbele delete', async () => {
    const failurePoints: [string, unknown][] = [
      ['deleteTeam#2', { ok: false, error: { code: 'timeout' } }],
      ['deleteInvitation#2', { ok: false, error: { code: 'offline' } }],
      ['inventory#2', { ok: false, error: { code: 'offline' } }],
      ['deleteMembership#1', { ok: false, error: { code: 'failed', detail: 'x' } }],
      ['inventory#3', { ok: false, error: { code: 'timeout' } }],
    ];
    for (const [key, failure] of failurePoints) {
      const { gateway, coordinator } = setup();
      gateway.failures.set(key, failure);
      expect((await coordinator.leave(ORG_A)).status, key).toBe('incomplete');
      const firstWrites = gateway.writes();

      const resumed = await coordinator.leave(ORG_A);
      // Een eindcontrole-fout ná de geslaagde membership-delete laat niets over:
      // de hervatting ziet de organisatie niet meer en meldt not-a-member.
      const expectedStatus = key === 'inventory#3' ? 'not-a-member' : 'ok';
      expect(resumed.status, key).toBe(expectedStatus);

      const resumedWrites = gateway.writes().slice(firstWrites.length);
      const succeededFirst = firstWrites.filter((_write, index) => {
        // De laatst geprobeerde write van de eerste run faalde (behalve bij een leesfout).
        const failedWrite = key.startsWith('delete') && index === firstWrites.length - 1;
        return !failedWrite;
      });
      for (const write of succeededFirst) {
        expect(resumedWrites, `${key}: ${write} niet opnieuw`).not.toContain(write);
      }
    }
  });

  it('twee gelijktijdige aanroepen voor dezelfde organisatie → de tweede is in-progress', async () => {
    const { gateway, coordinator } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = gateway.readIdentity.bind(gateway);
    gateway.readIdentity = async () => {
      await gate;
      return original();
    };

    const first = coordinator.leave(ORG_A);
    expect(await coordinator.leave(ORG_A)).toEqual({ status: 'in-progress' });
    release();
    expect((await first).status).toBe('ok');
    // Het slot is daarna vrij: een derde aanroep loopt gewoon (en is idempotent).
    expect(await coordinator.leave(ORG_A)).toEqual({ status: 'not-a-member' });
  });

  it('een lopende leave voor org A blokkeert een leave voor org B niet', async () => {
    const { gateway, coordinator } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = gateway.readIdentity.bind(gateway);
    let first = true;
    gateway.readIdentity = async () => {
      if (first) {
        first = false;
        await gate;
      }
      return original();
    };

    const leaveA = coordinator.leave(ORG_A);
    const leaveB = await coordinator.leave(ORG_B);
    expect(leaveB.status).toBe('ok');
    release();
    expect((await leaveA).status).toBe('ok');
  });

  it('het slot wordt ook na een fout vrijgegeven', async () => {
    const { gateway, coordinator } = setup();
    gateway.failures.set('inventory#1', { ok: false, error: { code: 'offline' } });
    expect(await coordinator.leave(ORG_A)).toEqual({ status: 'offline' });
    expect((await coordinator.leave(ORG_A)).status).toBe('ok');
  });

  it('het slot wordt vrijgegeven als de gateway gooit', async () => {
    const { gateway, coordinator } = setup();
    const original = gateway.readIdentity.bind(gateway);
    let calls = 0;
    gateway.readIdentity = async () => {
      calls += 1;
      if (calls === 1) throw new Error('onverwacht');
      return original();
    };
    await expect(coordinator.leave(ORG_A)).rejects.toThrow('onverwacht');
    expect((await coordinator.leave(ORG_A)).status).toBe('ok');
  });
});

// PR 8.3c-2b-iii — OwnershipTransferCoordinator (docs/pr-8.3c-2b-plan.md §B.7, §B.8, §C.3).
// Een nep-gateway met een eigen in-memory "server" die zich ook als de Rules gedraagt
// (alleen een owner promoveert of verwijdert een owner). Bewijst elke uitkomst, de vaste
// schrijfvolgorde (uitnodigingen → teamMembers → controle → membership LAATST →
// eindcontrole), hervatten na gedeeltelijke voortgang, rolwijzigingen tijdens de flow,
// het slot en dat een read-fout vóór de eerste write nooit een write oplevert.
// Alleen fictieve uid's, adressen en organisaties.
import { describe, expect, it } from 'vitest';
import {
  OwnershipTransferCoordinator,
  type CompleteTransferOutcome,
} from '../../src/application/account/OwnershipTransferCoordinator';
import type { TransferReadError } from '../../src/application/account/OwnershipTransferGateway';
import type { OrganizationRole } from '../../src/domain/organizations/types';
import { FakeOwnershipTransferGateway, type TransferServerState } from './support/accountFakes';

const A = 'uid-fictief-eigenaar-a';
const B = 'uid-fictief-nieuwe-b';
const C = 'uid-fictief-admin-c';
const D = 'uid-fictief-coach-d';
const ORG = 'org-fictief-1';
const ORG_OTHER = 'org-fictief-2';
const A_EMAIL = 'eigenaar-a@example.test';

function members(entries: [string, OrganizationRole, string][]) {
  return new Map(entries.map(([uid, role, email]) => [uid, { role, email }]));
}

/**
 * Org 1: A owner, B coach (kandidaat), C admin, D coach. A zit in twee teams, D in twee.
 * Uitnodigingen op A's adres: pending, accepted (andere spelling), claimed, revoked; plus
 * één op D's adres. Org 2: A is daar ook owner en heeft er een open uitnodiging.
 */
function state(bRole: OrganizationRole = 'coach'): TransferServerState {
  return {
    members: new Map([
      [
        ORG,
        members([
          [A, 'organizationOwner', A_EMAIL],
          [B, bRole, 'nieuwe-b@example.test'],
          [C, 'organizationAdmin', 'admin-c@example.test'],
          [D, 'coach', 'coach-d@example.test'],
        ]),
      ],
      [ORG_OTHER, members([[A, 'organizationOwner', A_EMAIL]])],
    ]),
    teams: new Map([
      [
        ORG,
        new Map([
          ['team-1', new Set([A, D])],
          ['team-2', new Set([A])],
          ['team-3', new Set([D])],
        ]),
      ],
      [ORG_OTHER, new Map([['team-x', new Set([A])]])],
    ]),
    invitations: [
      { organizationId: ORG, invitationId: 'inv-a-pending', email: A_EMAIL, status: 'pending' },
      {
        organizationId: ORG,
        invitationId: 'inv-a-accepted',
        email: 'Eigenaar-A@Example.test',
        status: 'accepted',
      },
      { organizationId: ORG, invitationId: 'inv-a-claimed', email: A_EMAIL, status: 'claimed' },
      { organizationId: ORG, invitationId: 'inv-a-revoked', email: A_EMAIL, status: 'revoked' },
      {
        organizationId: ORG,
        invitationId: 'inv-d',
        email: 'coach-d@example.test',
        status: 'pending',
      },
      { organizationId: ORG_OTHER, invitationId: 'inv-a-org2', email: A_EMAIL, status: 'pending' },
    ],
  };
}

function setup(caller: string | null, serverState: TransferServerState = state()) {
  const gateway = new FakeOwnershipTransferGateway(serverState, caller);
  return { gateway, coordinator: new OwnershipTransferCoordinator(gateway), state: serverState };
}

/** B is al owner (na stap 1) en rondt af. */
function setupB() {
  return setup(B, state('organizationOwner'));
}

function statusOf(serverState: TransferServerState, invitationId: string) {
  return serverState.invitations.find((i) => i.invitationId === invitationId)?.status;
}

const READ_FAILURES: [TransferReadError, unknown][] = [
  [{ code: 'not-signed-in' }, { status: 'not-signed-in' }],
  [{ code: 'offline' }, { status: 'offline' }],
  [{ code: 'timeout' }, { status: 'failed', reason: 'timeout' }],
  [
    { code: 'read-failed', detail: 'x' },
    { status: 'failed', reason: 'read-failed' },
  ],
];

describe('listTransferCandidates', () => {
  it('owner krijgt niet-owner-leden als kandidaten en andere owners apart; nul writes', async () => {
    const { gateway, coordinator } = setupB();
    expect(await coordinator.listTransferCandidates(ORG)).toEqual({
      status: 'ok',
      candidates: [
        { uid: C, role: 'organizationAdmin', email: 'admin-c@example.test' },
        { uid: D, role: 'coach', email: 'coach-d@example.test' },
      ],
      otherOwners: [{ uid: A, role: 'organizationOwner', email: A_EMAIL }],
    });
    expect(gateway.calls).toEqual([`caller:${ORG}`, `members:${ORG}`]);
    expect(gateway.writes()).toEqual([]);
  });

  it.each([
    [C, 'not-owner'],
    [D, 'not-owner'],
    ['uid-fictief-vreemd', 'not-a-member'],
  ])('%s → denied/%s zonder ledenlijst te lezen', async (caller, reason) => {
    const { gateway, coordinator } = setup(caller);
    expect(await coordinator.listTransferCandidates(ORG)).toEqual({ status: 'denied', reason });
    expect(gateway.calls).toEqual([`caller:${ORG}`]);
  });

  it('niet ingelogd → not-signed-in', async () => {
    const { coordinator } = setup(null);
    expect(await coordinator.listTransferCandidates(ORG)).toEqual({ status: 'not-signed-in' });
  });

  it.each(READ_FAILURES)('read-fout %j op de aanroeper → %j', async (error, expected) => {
    const { gateway, coordinator } = setup(A);
    gateway.failures.set('caller#1', { ok: false, error });
    expect(await coordinator.listTransferCandidates(ORG)).toEqual(expected);
  });

  it.each(READ_FAILURES)('read-fout %j op de ledenlijst → %j', async (error, expected) => {
    const { gateway, coordinator } = setup(A);
    gateway.failures.set('members#1', { ok: false, error });
    expect(await coordinator.listTransferCandidates(ORG)).toEqual(expected);
  });
});

describe('promote (stap 1, door owner A)', () => {
  it('maakt een niet-owner-lid owner: owner-check → verse ledenlijst → promotie met de huidige rol', async () => {
    const { gateway, coordinator, state: s } = setup(A);
    expect(await coordinator.promote(ORG, B)).toEqual({ status: 'ok', outcome: 'promoted' });
    expect(gateway.calls).toEqual([
      `caller:${ORG}`,
      `members:${ORG}`,
      `promote:${ORG}/${B}`,
      `write:promote:${ORG}/${B}`,
    ]);
    expect(s.members.get(ORG)?.get(B)?.role).toBe('organizationOwner');
    // A blijft owner: de overdracht is pas af als B A verwijdert.
    expect(s.members.get(ORG)?.get(A)?.role).toBe('organizationOwner');
  });

  it('idempotent: een tweede promote → already-owner zonder gateway-write', async () => {
    const { gateway, coordinator } = setup(A);
    await coordinator.promote(ORG, B);
    gateway.calls.length = 0;
    expect(await coordinator.promote(ORG, B)).toEqual({ status: 'ok', outcome: 'already-owner' });
    expect(gateway.calls).toEqual([`caller:${ORG}`, `members:${ORG}`]);
  });

  it('zichzelf → denied/self vóór elke verdere read', async () => {
    const { gateway, coordinator } = setup(A);
    expect(await coordinator.promote(ORG, A)).toEqual({ status: 'denied', reason: 'self' });
    expect(gateway.calls).toEqual([`caller:${ORG}`]);
  });

  it('een admin kan zichzelf of een ander niet promoveren (denied/not-owner, nul writes)', async () => {
    const { gateway, coordinator, state: s } = setup(C);
    expect(await coordinator.promote(ORG, C)).toEqual({ status: 'denied', reason: 'not-owner' });
    expect(await coordinator.promote(ORG, D)).toEqual({ status: 'denied', reason: 'not-owner' });
    expect(gateway.calls.filter((c) => c.startsWith('promote'))).toEqual([]);
    expect(s.members.get(ORG)?.get(C)?.role).toBe('organizationAdmin');
  });

  it('een coach of niet-lid → denied, nul writes', async () => {
    expect(await setup(D).coordinator.promote(ORG, D)).toEqual({
      status: 'denied',
      reason: 'not-owner',
    });
    expect(await setup('uid-fictief-vreemd').coordinator.promote(ORG, B)).toEqual({
      status: 'denied',
      reason: 'not-a-member',
    });
  });

  it('kandidaat geen lid → not-found, geen promote-aanroep', async () => {
    const { gateway, coordinator } = setup(A);
    expect(await coordinator.promote(ORG, 'uid-fictief-vreemd')).toEqual({ status: 'not-found' });
    expect(gateway.calls).toEqual([`caller:${ORG}`, `members:${ORG}`]);
  });

  it('kandidaat uit een ANDERE organisatie → not-found (lijst is per organisatie)', async () => {
    const { coordinator } = setup(A);
    expect(await coordinator.promote(ORG_OTHER, B)).toEqual({ status: 'not-found' });
  });

  it('rol van de kandidaat verandert tussen lezen en schrijven → rejected/target-changed, niets geschreven', async () => {
    const { gateway, coordinator, state: s } = setup(A);
    gateway.hooks.set('promote#1', () => {
      s.members.get(ORG)!.get(B)!.role = 'scorer';
    });
    expect(await coordinator.promote(ORG, B)).toEqual({
      status: 'rejected',
      reason: 'target-changed',
    });
    expect(gateway.writes()).toEqual([]);
    expect(s.members.get(ORG)?.get(B)?.role).toBe('scorer');
  });

  it('A wordt tijdens de flow gedemoveerd → rejected/permission-denied (Rules), B ongewijzigd', async () => {
    const { gateway, coordinator, state: s } = setup(A);
    gateway.hooks.set('promote#1', () => {
      s.members.get(ORG)!.get(A)!.role = 'organizationAdmin';
    });
    expect(await coordinator.promote(ORG, B)).toEqual({
      status: 'rejected',
      reason: 'permission-denied',
    });
    expect(s.members.get(ORG)?.get(B)?.role).toBe('coach');
  });

  it.each([
    [{ code: 'timeout' }, { status: 'timeout' }],
    [{ code: 'offline' }, { status: 'offline' }],
    [{ code: 'not-signed-in' }, { status: 'not-signed-in' }],
    [
      { code: 'failed', detail: 'x' },
      { status: 'failed', reason: 'write-failed' },
    ],
    [{ code: 'not-found' }, { status: 'not-found' }],
    [{ code: 'self-target' }, { status: 'denied', reason: 'self' }],
    [{ code: 'rejected' }, { status: 'rejected', reason: 'permission-denied' }],
    [
      { code: 'role-changed', actualRole: 'viewer' },
      { status: 'rejected', reason: 'target-changed' },
    ],
  ])('gatewayfout %j → %j', async (error, expected) => {
    const { gateway, coordinator } = setup(A);
    gateway.failures.set('promote#1', { ok: false, error });
    expect(await coordinator.promote(ORG, B)).toEqual(expected);
  });

  it('timeout en daarna opnieuw: de promotie landde alsnog → already-owner', async () => {
    const { gateway, coordinator, state: s } = setup(A);
    gateway.failures.set('promote#1', { ok: false, error: { code: 'timeout' } });
    gateway.hooks.set('promote#1', () => {
      s.members.get(ORG)!.get(B)!.role = 'organizationOwner';
    });
    expect(await coordinator.promote(ORG, B)).toEqual({ status: 'timeout' });
    expect(await coordinator.promote(ORG, B)).toEqual({ status: 'ok', outcome: 'already-owner' });
  });

  it.each(READ_FAILURES)(
    'offline/read-fout %j vóór de write → %j, geen promote',
    async (error, expected) => {
      const { gateway, coordinator } = setup(A);
      gateway.failures.set('members#1', { ok: false, error });
      expect(await coordinator.promote(ORG, B)).toEqual(expected);
      expect(gateway.calls.some((c) => c.startsWith('promote'))).toBe(false);
    },
  );
});

const COMPLETE_CALLS = [
  `caller:${ORG}`,
  `members:${ORG}`,
  `revoke:${ORG}/${A_EMAIL}`,
  `write:revoke:${ORG}/inv-a-pending`,
  `write:revoke:${ORG}/inv-a-accepted`,
  `removeTeams:${ORG}/${A}`,
  `write:removeTeam:${ORG}/team-1/${A}`,
  `write:removeTeam:${ORG}/team-2/${A}`,
  `footprint:${ORG}/${A}`,
  `removeMember:${ORG}/${A}`,
  `write:removeMember:${ORG}/${A}`,
  `footprint:${ORG}/${A}`,
];

const OK: CompleteTransferOutcome = {
  status: 'ok',
  revokedInvitations: 2,
  removedTeamMemberships: 2,
  organizationMember: 'deleted',
};

describe('completeTransfer (stap 2, door owner B)', () => {
  it('vaste volgorde: uitnodigingen → teamMembers → controle → membership LAATST → eindcontrole', async () => {
    const { gateway, coordinator, state: s } = setupB();
    expect(await coordinator.completeTransfer(ORG, A)).toEqual(OK);
    expect(gateway.calls).toEqual(COMPLETE_CALLS);
    expect(gateway.writes().at(-1)).toBe(`write:removeMember:${ORG}/${A}`);

    expect(s.members.get(ORG)?.has(A)).toBe(false);
    // Alleen A's OPEN uitnodigingen in deze organisatie; claimed/revoked en D's blijven.
    expect(statusOf(s, 'inv-a-pending')).toBe('revoked');
    expect(statusOf(s, 'inv-a-accepted')).toBe('revoked');
    expect(statusOf(s, 'inv-a-claimed')).toBe('claimed');
    expect(statusOf(s, 'inv-d')).toBe('pending');
    // D's teamMembers en de hele andere organisatie zijn onaangeroerd.
    expect([...(s.teams.get(ORG)?.get('team-1') ?? [])]).toEqual([D]);
    expect([...(s.teams.get(ORG)?.get('team-3') ?? [])]).toEqual([D]);
    expect(s.members.get(ORG_OTHER)?.get(A)?.role).toBe('organizationOwner');
    expect(statusOf(s, 'inv-a-org2')).toBe('pending');
    expect([...(s.teams.get(ORG_OTHER)?.get('team-x') ?? [])]).toEqual([A]);
  });

  it('het adres komt uit A’s membership (server), niet uit invoer', async () => {
    const { gateway, coordinator } = setupB();
    await coordinator.completeTransfer(ORG, A);
    expect(gateway.calls.filter((c) => c.startsWith('revoke:'))).toEqual([
      `revoke:${ORG}/${A_EMAIL}`,
    ]);
  });

  it('idempotent: een tweede aanroep na een geslaagde eerste → not-found, nul writes', async () => {
    const { gateway, coordinator } = setupB();
    await coordinator.completeTransfer(ORG, A);
    gateway.calls.length = 0;
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({ status: 'not-found' });
    expect(gateway.calls).toEqual([`caller:${ORG}`, `members:${ORG}`]);
  });

  it('volledige tweestapsflow: A promoveert B, B verwijdert A', async () => {
    const serverState = state();
    const asA = setup(A, serverState);
    expect(await asA.coordinator.promote(ORG, B)).toEqual({ status: 'ok', outcome: 'promoted' });
    // A kan de overdracht niet zelf afronden.
    expect(await asA.coordinator.completeTransfer(ORG, A)).toEqual({
      status: 'denied',
      reason: 'self',
    });
    const asB = setup(B, serverState);
    expect(await asB.coordinator.completeTransfer(ORG, A)).toEqual(OK);
    expect([...serverState.members.get(ORG)!.keys()].sort()).toEqual([B, C, D].sort());
  });

  it('zichzelf → denied/self, nul writes', async () => {
    const { gateway, coordinator } = setupB();
    expect(await coordinator.completeTransfer(ORG, B)).toEqual({
      status: 'denied',
      reason: 'self',
    });
    expect(gateway.calls).toEqual([`caller:${ORG}`]);
  });

  it('een niet-owner-doel is geen overdracht → denied/target-not-owner, nul writes', async () => {
    const { gateway, coordinator, state: s } = setupB();
    expect(await coordinator.completeTransfer(ORG, D)).toEqual({
      status: 'denied',
      reason: 'target-not-owner',
    });
    expect(gateway.writes()).toEqual([]);
    expect(s.members.get(ORG)?.has(D)).toBe(true);
  });

  it.each([
    [C, 'not-owner'],
    [D, 'not-owner'],
    ['uid-fictief-vreemd', 'not-a-member'],
  ])('aanroeper %s → denied/%s, geen enkele stap', async (caller, reason) => {
    const { gateway, coordinator, state: s } = setup(caller, state('organizationOwner'));
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({ status: 'denied', reason });
    expect(gateway.calls).toEqual([`caller:${ORG}`]);
    expect(s.members.get(ORG)?.get(A)?.role).toBe('organizationOwner');
  });

  it('B is (nog) niet gepromoveerd → denied/not-owner, A intact', async () => {
    const { coordinator, state: s } = setup(B);
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({
      status: 'denied',
      reason: 'not-owner',
    });
    expect(statusOf(s, 'inv-a-pending')).toBe('pending');
  });

  it('vorige owner geen lid → not-found', async () => {
    const { coordinator } = setupB();
    expect(await coordinator.completeTransfer(ORG, 'uid-fictief-weg')).toEqual({
      status: 'not-found',
    });
  });

  it.each(READ_FAILURES)(
    'read-fout %j vóór de eerste write → %j, nul writes',
    async (error, expected) => {
      for (const key of ['caller#1', 'members#1']) {
        const { gateway, coordinator } = setupB();
        gateway.failures.set(key, { ok: false, error });
        expect(await coordinator.completeTransfer(ORG, A)).toEqual(expected);
        expect(gateway.writes()).toEqual([]);
        expect(gateway.calls.some((c) => c.startsWith('revoke'))).toBe(false);
      }
    },
  );

  it('intrekken faalt halverwege (timeout) → incomplete(invitations), geen volgende write; hervatten maakt het af', async () => {
    const { gateway, coordinator, state: s } = setupB();
    gateway.hooks.set('revoke#1', () => {
      s.invitations.find((i) => i.invitationId === 'inv-a-pending')!.status = 'revoked';
    });
    gateway.failures.set('revoke#1', { ok: false, error: { code: 'timeout' }, revoked: 1 });
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({
      status: 'incomplete',
      stage: 'invitations',
      error: { code: 'timeout' },
    });
    expect(gateway.calls.some((c) => c.startsWith('removeTeams'))).toBe(false);
    expect(s.members.get(ORG)?.has(A)).toBe(true);

    expect(await coordinator.completeTransfer(ORG, A)).toEqual({ ...OK, revokedInvitations: 1 });
    expect(statusOf(s, 'inv-a-accepted')).toBe('revoked');
  });

  it('intrekken door Rules geweigerd → rejected(invitations), A intact', async () => {
    const { gateway, coordinator, state: s } = setupB();
    gateway.failures.set('revoke#1', { ok: false, error: { code: 'rejected' }, revoked: 0 });
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({
      status: 'rejected',
      stage: 'invitations',
      reason: 'permission-denied',
    });
    expect(s.members.get(ORG)?.has(A)).toBe(true);
  });

  it('teamMembers verwijderen faalt (offline) → incomplete(team-members), membership niet aangeraakt; hervatten', async () => {
    const { gateway, coordinator, state: s } = setupB();
    gateway.failures.set('removeTeams#1', { ok: false, error: { code: 'offline' }, removed: 0 });
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({
      status: 'incomplete',
      stage: 'team-members',
      error: { code: 'offline' },
    });
    expect(gateway.calls.some((c) => c.startsWith('removeMember'))).toBe(false);
    expect(s.members.get(ORG)?.has(A)).toBe(true);

    // Hervatten: de intrekkingen zijn al gedaan, dus 0 nieuwe.
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({ ...OK, revokedInvitations: 0 });
  });

  it('teamMembers door Rules geweigerd → rejected(team-members)', async () => {
    const { gateway, coordinator } = setupB();
    gateway.failures.set('removeTeams#1', { ok: false, error: { code: 'rejected' }, removed: 0 });
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({
      status: 'rejected',
      stage: 'team-members',
      reason: 'permission-denied',
    });
  });

  it('controle vóór de laatste write vindt een nieuw teamMembers-document (R3) → incomplete, membership blijft', async () => {
    const { gateway, coordinator, state: s } = setupB();
    gateway.hooks.set('footprint#1', () => {
      s.teams.get(ORG)!.get('team-3')!.add(A);
    });
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({
      status: 'incomplete',
      stage: 'pre-removal-check',
    });
    expect(gateway.calls.some((c) => c.startsWith('removeMember'))).toBe(false);
    expect(s.members.get(ORG)?.has(A)).toBe(true);
  });

  it('controle vóór de laatste write vindt een nieuwe open uitnodiging → incomplete', async () => {
    const { gateway, coordinator, state: s } = setupB();
    gateway.hooks.set('footprint#1', () => {
      s.invitations.push({
        organizationId: ORG,
        invitationId: 'inv-nieuw',
        email: A_EMAIL,
        status: 'pending',
      });
    });
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({
      status: 'incomplete',
      stage: 'pre-removal-check',
    });
    expect(s.members.get(ORG)?.has(A)).toBe(true);
  });

  it('controle vóór de laatste write faalt → incomplete met de leesfout', async () => {
    const { gateway, coordinator } = setupB();
    gateway.failures.set('footprint#1', { ok: false, error: { code: 'offline' } });
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({
      status: 'incomplete',
      stage: 'pre-removal-check',
      error: { code: 'offline' },
    });
    expect(gateway.calls.some((c) => c.startsWith('removeMember'))).toBe(false);
  });

  it('A wordt tijdens de flow gedemoveerd → rejected/target-changed, membership blijft', async () => {
    const { gateway, coordinator, state: s } = setupB();
    gateway.hooks.set('removeMember#1', () => {
      s.members.get(ORG)!.get(A)!.role = 'organizationAdmin';
    });
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({
      status: 'rejected',
      stage: 'organization-member',
      reason: 'target-changed',
    });
    expect(s.members.get(ORG)?.has(A)).toBe(true);
  });

  it('B verliest zijn ownerrol tijdens de flow → rejected/permission-denied, A blijft owner', async () => {
    const { gateway, coordinator, state: s } = setupB();
    gateway.hooks.set('removeMember#1', () => {
      s.members.get(ORG)!.get(B)!.role = 'organizationAdmin';
    });
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({
      status: 'rejected',
      stage: 'organization-member',
      reason: 'permission-denied',
    });
    expect(s.members.get(ORG)?.get(A)?.role).toBe('organizationOwner');
  });

  it('membership-delete timeout → incomplete; landt hij later alsnog, dan geeft hervatten not-found', async () => {
    const { gateway, coordinator, state: s } = setupB();
    gateway.failures.set('removeMember#1', { ok: false, error: { code: 'timeout' } });
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({
      status: 'incomplete',
      stage: 'organization-member',
      error: { code: 'timeout' },
    });
    expect(gateway.calls.at(-1)).toBe(`removeMember:${ORG}/${A}`);
    s.members.get(ORG)!.delete(A);
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({ status: 'not-found' });
  });

  it.each([[{ code: 'offline' }], [{ code: 'not-signed-in' }], [{ code: 'failed', detail: 'x' }]])(
    'membership-delete fout %j → incomplete(organization-member)',
    async (error) => {
      const { gateway, coordinator } = setupB();
      gateway.failures.set('removeMember#1', { ok: false, error });
      expect(await coordinator.completeTransfer(ORG, A)).toEqual({
        status: 'incomplete',
        stage: 'organization-member',
        error,
      });
    },
  );

  it('self-target uit de gateway → denied/self', async () => {
    const { gateway, coordinator } = setupB();
    gateway.failures.set('removeMember#1', { ok: false, error: { code: 'self-target' } });
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({
      status: 'denied',
      reason: 'self',
    });
  });

  it('membership tussendoor al weg (door een andere owner) → geen delete-poging, ok/already-gone', async () => {
    const { gateway, coordinator, state: s } = setupB();
    gateway.hooks.set('footprint#1', () => {
      s.members.get(ORG)!.delete(A);
    });
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({
      ...OK,
      organizationMember: 'already-gone',
    });
    expect(gateway.calls.some((c) => c.startsWith('removeMember'))).toBe(false);
  });

  it('eindcontrole vindt nog iets → incomplete(final-check)', async () => {
    const { gateway, coordinator, state: s } = setupB();
    gateway.hooks.set('footprint#2', () => {
      s.teams.get(ORG)!.get('team-2')!.add(A);
    });
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({
      status: 'incomplete',
      stage: 'final-check',
    });
  });

  it('eindcontrole faalt → incomplete(final-check) met de leesfout, nooit ok', async () => {
    const { gateway, coordinator } = setupB();
    gateway.failures.set('footprint#2', { ok: false, error: { code: 'timeout' } });
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({
      status: 'incomplete',
      stage: 'final-check',
      error: { code: 'timeout' },
    });
  });
});

describe('slot over beide schrijfmethoden', () => {
  it('twee gelijktijdige completeTransfer-aanroepen → één in-progress; daarna weer vrij', async () => {
    const { coordinator } = setupB();
    const [first, second] = await Promise.all([
      coordinator.completeTransfer(ORG, A),
      coordinator.completeTransfer(ORG, A),
    ]);
    expect(first).toEqual(OK);
    expect(second).toEqual({ status: 'in-progress' });
    expect(await coordinator.completeTransfer(ORG, A)).toEqual({ status: 'not-found' });
  });

  it('promote tijdens completeTransfer (ook in een andere organisatie) → in-progress', async () => {
    const { coordinator } = setupB();
    const [first, second] = await Promise.all([
      coordinator.completeTransfer(ORG, A),
      coordinator.promote(ORG_OTHER, B),
    ]);
    expect(first).toEqual(OK);
    expect(second).toEqual({ status: 'in-progress' });
  });

  it('het slot wordt ook na een fout vrijgegeven', async () => {
    const { gateway, coordinator } = setup(A);
    gateway.failures.set('caller#1', { ok: false, error: { code: 'offline' } });
    expect(await coordinator.promote(ORG, B)).toEqual({ status: 'offline' });
    expect(await coordinator.promote(ORG, B)).toEqual({ status: 'ok', outcome: 'promoted' });
  });

  it('listTransferCandidates (read-only) gebruikt het slot niet', async () => {
    const { coordinator } = setupB();
    const [done, list] = await Promise.all([
      coordinator.completeTransfer(ORG, A),
      coordinator.listTransferCandidates(ORG),
    ]);
    expect(done).toEqual(OK);
    expect(list).toMatchObject({ status: 'ok' });
  });
});

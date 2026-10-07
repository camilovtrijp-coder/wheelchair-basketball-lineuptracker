// PR 8.3c-2b-ii — AccountDeletionCoordinator (docs/pr-8.3c-2b-plan.md §B.9, §C.2, §D).
// Nep-poorten met een in-memory "server" (fictieve uid's, organisaties en wachtwoorden).
// Bewijst per methode elke uitkomst en elke stapfout, en de harde invarianten:
//   - geen enkele write vóór een geslaagde reauthenticatie (B2) en vóór een groen plan;
//   - `deleteUser` alleen direct na een LEGE eindpoort uit DEZELFDE aanroep;
//   - `deleted` alleen na een bevestigd `deleteUser`; onbekend is `auth-state-unknown`;
//   - hervatten uit een verse inventaris, zonder dubbele deletes.
import { describe, expect, it } from 'vitest';
import {
  AccountDeletionCoordinator,
  type AccountDeletionOutcome,
} from '../../src/application/account/AccountDeletionCoordinator';
import type {
  AccountAuthGateway,
  DeleteUserCode,
  DeleteUserResult,
  EmailClaimResult,
  ReauthResult,
} from '../../src/application/account/AccountAuthGateway';
import type { AccountReadError } from '../../src/application/account/AccountGateway';
import type { OrganizationFacts } from '../../src/domain/account/types';
import type { OrganizationRole } from '../../src/domain/organizations/types';
import { FakeAccountGateway, FakeProbe, type ServerState } from './support/accountFakes';

const ME = 'uid-fictief-vertrekker';
const MY_EMAIL = 'vertrekker@example.test';
const OTHER_OWNER = 'uid-fictief-owner';
const PASSWORD = 'fictief-wachtwoord-1';
const ORG_A = 'org-fictief-a';
const ORG_B = 'org-fictief-b';
const ORG_C = 'org-fictief-c';

type AuthMethod = 'claim' | 'reauth' | 'deleteUser';

/**
 * Nep-`AccountAuthGateway`. Schrijft in dezelfde aanroeplijst als de nep-gateway, zodat
 * de volgorde over Firestore- én Auth-aanroepen heen te controleren is.
 */
class FakeAccountAuthGateway implements AccountAuthGateway {
  claim: EmailClaimResult = { ok: true, uid: ME, email: MY_EMAIL, verified: true };
  deleted = false;
  readonly failures = new Map<string, unknown>();
  readonly hooks = new Map<string, () => void>();
  readonly guards: string[] = [];
  readonly passwords: string[] = [];
  private readonly counters = new Map<AuthMethod, number>();

  constructor(private readonly calls: string[]) {}

  private tick(method: AuthMethod): string {
    const n = (this.counters.get(method) ?? 0) + 1;
    this.counters.set(method, n);
    const key = `${method}#${n}`;
    this.hooks.get(key)?.();
    return key;
  }

  async readVerifiedEmailClaim(): Promise<EmailClaimResult> {
    const key = this.tick('claim');
    this.calls.push('claim');
    const failed = this.failures.get(key) as EmailClaimResult | undefined;
    if (failed) return failed;
    if (this.deleted) return { ok: false, code: 'not-signed-in' };
    return this.claim;
  }

  async reauthenticateWithPassword(
    password: string,
    guard: { expectedUid: string },
  ): Promise<ReauthResult> {
    const key = this.tick('reauth');
    this.calls.push('reauth');
    this.guards.push(guard.expectedUid);
    this.passwords.push(password);
    const failed = this.failures.get(key) as ReauthResult | undefined;
    if (failed) return failed;
    return password === PASSWORD ? { ok: true } : { ok: false, code: 'wrong-password' };
  }

  async deleteCurrentUser(guard: { expectedUid: string }): Promise<DeleteUserResult> {
    const key = this.tick('deleteUser');
    this.calls.push('deleteUser');
    this.guards.push(guard.expectedUid);
    const failed = this.failures.get(key) as DeleteUserResult | undefined;
    if (failed) return failed;
    this.deleted = true;
    return { ok: true };
  }
}

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

/**
 * Coach in org A (twee teams, een open en een geclaimde uitnodiging), team-only scorer in
 * org B, en alleen een (oude, geclaimde) uitnodiging in org C. Alles zelf op te lossen.
 */
function standardState(): ServerState {
  return {
    memberships: new Map<string, OrganizationRole>([[ORG_A, 'coach']]),
    teams: [
      { organizationId: ORG_A, teamId: 'team-a1', role: 'coach' },
      { organizationId: ORG_A, teamId: 'team-a2', role: 'coach' },
      { organizationId: ORG_B, teamId: 'team-b1', role: 'scorer' },
    ],
    invitations: [
      { organizationId: ORG_A, invitationId: 'inv-a-open', status: 'pending', role: 'coach' },
      { organizationId: ORG_A, invitationId: 'inv-a-claimed', status: 'claimed', role: 'coach' },
      { organizationId: ORG_C, invitationId: 'inv-c-claimed', status: 'claimed', role: 'viewer' },
    ],
    facts: new Map([[ORG_A, facts()]]),
  };
}

function emptyState(): ServerState {
  return { memberships: new Map(), teams: [], invitations: [], facts: new Map() };
}

function setup(state: ServerState = standardState(), probe = new FakeProbe()) {
  const gateway = new FakeAccountGateway(state, {
    uid: ME,
    email: MY_EMAIL,
    emailVerified: true,
  });
  const auth = new FakeAccountAuthGateway(gateway.calls);
  const coordinator = new AccountDeletionCoordinator(gateway, auth, probe);
  return { gateway, auth, coordinator, state };
}

const isWrite = (call: string) => call.startsWith('delete');

/**
 * Harde invariant (§B.9 stap 8/9, besluit B2): elke `deleteUser` volgt DIRECT op een
 * geslaagde, LEGE eindpoortread (drie queries, incl. uitnodigingen) — zonder andere
 * aanroep ertussen.
 */
function expectEveryDeleteUserDirectlyAfterGreenGate(gateway: FakeAccountGateway) {
  gateway.calls.forEach((call, index) => {
    if (call !== 'deleteUser') return;
    expect(gateway.calls[index - 1], 'aanroep vóór deleteUser').toBe('inventory+inv');
    expect(gateway.emptyInventoryAt.get(index - 1), 'eindpoort direct vóór deleteUser').toBe(true);
  });
}

const CLEAR_HAPPY_CALLS = [
  'claim',
  'inventory+inv',
  `facts:${ORG_A}`,
  'reauth',
  // org A: executeLeaveSteps (teamMembers → open uitnodiging → controle → membership → eindcontrole)
  `deleteTeam:${ORG_A}/team-a1`,
  `deleteTeam:${ORG_A}/team-a2`,
  `deleteInvitation:${ORG_A}/inv-a-open`,
  'inventory+inv',
  `deleteMembership:${ORG_A}`,
  'inventory',
  // org B (team-only): geen feitenread, geen membership
  `deleteTeam:${ORG_B}/team-b1`,
  'inventory+inv',
  'inventory',
  // stap 5: ALLE resterende eigen uitnodigingen, elke status
  'inventory+inv',
  `deleteInvitation:${ORG_A}/inv-a-claimed`,
  `deleteInvitation:${ORG_C}/inv-c-claimed`,
  // stap 6: harde eindpoort
  'inventory+inv',
];

describe('AccountDeletionCoordinator.assess() — read-only', () => {
  it('alles zelf op te lossen → ready-to-clear met het plan, zonder write of reauth', async () => {
    const { gateway, coordinator } = setup();
    expect(await coordinator.assess()).toEqual({
      status: 'ready-to-clear',
      plan: {
        organizations: [
          { organizationId: ORG_A, class: 'leave' },
          { organizationId: ORG_B, class: 'leave-team-only' },
          { organizationId: ORG_C, class: 'invitations-only' },
        ],
        invitationCount: 3,
        canProceed: true,
      },
    });
    expect(gateway.calls).toEqual(['claim', 'inventory+inv', `facts:${ORG_A}`]);
  });

  it('een lone owner → needs-action met otherOwnerCount 0, nul writes', async () => {
    const state = standardState();
    state.memberships.set(ORG_A, 'organizationOwner');
    state.facts.set(ORG_A, facts({ createdBy: ME, ownerUids: [ME] }));
    const { gateway, coordinator } = setup(state);
    const outcome = await coordinator.assess();
    expect(outcome).toMatchObject({
      status: 'needs-action',
      plan: {
        canProceed: false,
        organizations: [{ organizationId: ORG_A, class: 'owner-sole', otherOwnerCount: 0 }, {}, {}],
      },
    });
    expect(gateway.calls.some(isWrite)).toBe(false);
  });

  it('Firestore leeg, Auth-account aanwezig: afleidbaar als ready-for-auth-deletion (§B.4)', async () => {
    const { gateway, coordinator } = setup(emptyState());
    expect(await coordinator.assess()).toEqual({ status: 'ready-for-auth-deletion' });
    expect(gateway.calls).toEqual(['claim', 'inventory+inv']);
  });
});

describe('AccountDeletionCoordinator — voorwaarden (alle methoden), nul writes', () => {
  const methods = [
    ['assess', (c: AccountDeletionCoordinator) => c.assess()],
    ['clearFirestoreData', (c: AccountDeletionCoordinator) => c.clearFirestoreData(PASSWORD)],
    ['deleteAuthAccount', (c: AccountDeletionCoordinator) => c.deleteAuthAccount(PASSWORD)],
  ] as const;

  const cases: [string, EmailClaimResult, AccountDeletionOutcome][] = [
    ['niet ingelogd', { ok: false, code: 'not-signed-in' }, { status: 'not-signed-in' }],
    ['tokenverversing offline', { ok: false, code: 'network' }, { status: 'offline' }],
    [
      'sessie ongeldig (account weg?)',
      { ok: false, code: 'session-invalid' },
      { status: 'auth-state-unknown' },
    ],
    ['andere fout', { ok: false, code: 'other' }, { status: 'failed', reason: 'read-failed' }],
    [
      'email_verified false',
      { ok: true, uid: ME, email: MY_EMAIL, verified: false },
      { status: 'email-not-verified' },
    ],
    [
      'geen e-mailclaim',
      { ok: true, uid: ME, email: null, verified: true },
      { status: 'email-not-verified' },
    ],
  ];

  for (const [name, run] of methods) {
    it.each(cases)(`${name}: %s → %o`, async (_label, claim, expected) => {
      const { gateway, auth, coordinator } = setup();
      auth.claim = claim;
      expect(await run(coordinator)).toEqual(expected);
      expect(gateway.calls).toEqual(['claim']);
    });

    it.each<[AccountReadError, AccountDeletionOutcome]>([
      [{ code: 'offline' }, { status: 'offline' }],
      [{ code: 'timeout' }, { status: 'failed', reason: 'timeout' }],
      [
        { code: 'read-failed', detail: 'x' },
        { status: 'failed', reason: 'read-failed' },
      ],
      [{ code: 'email-not-verified' }, { status: 'email-not-verified' }],
      [{ code: 'not-signed-in' }, { status: 'not-signed-in' }],
    ])(`${name}: eerste serverread faalt (%o) → %o, geen write`, async (error, expected) => {
      const { gateway, coordinator } = setup();
      gateway.failures.set('inventory#1', { ok: false, error });
      expect(await run(coordinator)).toEqual(expected);
      expect(gateway.calls.some(isWrite)).toBe(false);
      expect(gateway.calls).not.toContain('deleteUser');
    });
  }

  it('feitenread faalt → failed/read-failed, geen reauth en geen write', async () => {
    const { gateway, coordinator } = setup();
    gateway.failures.set('facts#1', { ok: false, error: { code: 'read-failed', detail: 'x' } });
    expect(await coordinator.clearFirestoreData(PASSWORD)).toEqual({
      status: 'failed',
      reason: 'read-failed',
    });
    expect(gateway.calls).not.toContain('reauth');
    expect(gateway.calls.some(isWrite)).toBe(false);
  });
});

describe('AccountDeletionCoordinator.clearFirestoreData()', () => {
  it('volgorde: plan → reauth (B2) → per organisatie verlaten → alle uitnodigingen → eindpoort', async () => {
    const { gateway, auth, coordinator, state } = setup();
    expect(await coordinator.clearFirestoreData(PASSWORD)).toEqual({
      status: 'ready-for-auth-deletion',
    });
    expect(gateway.calls).toEqual(CLEAR_HAPPY_CALLS);
    // B2: de reauthenticatie gaat aan de EERSTE write vooraf.
    expect(gateway.calls.indexOf('reauth')).toBeLessThan(gateway.calls.findIndex(isWrite));
    expect(auth.guards).toEqual([ME]);
    // Nooit `deleteUser` vanuit clearFirestoreData.
    expect(gateway.calls).not.toContain('deleteUser');
    expect(state.memberships.size + state.teams.length + state.invitations.length).toBe(0);
  });

  it.each([
    ['owner-sole', 'organizationOwner', facts({ ownerUids: [ME], createdBy: ME })],
    ['owner-awaiting-removal', 'organizationOwner', facts({ ownerUids: [ME, OTHER_OWNER] })],
    ['creator-needs-owner', 'coach', facts({ createdBy: ME })],
    ['organization-unsupported', 'coach', facts({ createdBy: null })],
    ['organization-missing', 'coach', facts({ exists: false, createdBy: null })],
    [
      'awaiting-organization-deletion',
      'organizationOwner',
      facts({ ownerUids: [ME], deletionRequestStatus: 'requested' }),
    ],
    [
      'organization-deletion-failed',
      'organizationOwner',
      facts({ ownerUids: [ME], deletionRequestStatus: 'failed' }),
    ],
  ] as const)(
    'één niet-oplosbare organisatie (%s) → needs-action, GEEN reauth en GEEN enkele write',
    async (expectedClass, role, orgFacts) => {
      const state = standardState();
      state.memberships.set(ORG_A, role);
      state.facts.set(ORG_A, orgFacts);
      const { gateway, coordinator } = setup(state);
      const outcome = await coordinator.clearFirestoreData(PASSWORD);
      expect(outcome).toMatchObject({ status: 'needs-action', plan: { canProceed: false } });
      expect(outcome.status === 'needs-action' && outcome.plan.organizations[0]?.class).toBe(
        expectedClass,
      );
      expect(gateway.calls).not.toContain('reauth');
      expect(gateway.calls.some(isWrite)).toBe(false);
    },
  );

  it('lokaal onbevestigd werk in één organisatie blokkeert het geheel, nul writes', async () => {
    const { gateway, coordinator } = setup(standardState(), new FakeProbe({ [ORG_B]: 2 }));
    const outcome = await coordinator.clearFirestoreData(PASSWORD);
    expect(outcome).toMatchObject({
      status: 'needs-action',
      plan: {
        canProceed: false,
        organizations: [
          { organizationId: ORG_A, class: 'leave' },
          { organizationId: ORG_B, class: 'local-unsynced-work', localUnsyncedWork: 2 },
          { organizationId: ORG_C, class: 'invitations-only' },
        ],
      },
    });
    expect(gateway.calls).not.toContain('reauth');
    expect(gateway.calls.some(isWrite)).toBe(false);
  });

  it.each<[ReauthResult, AccountDeletionOutcome]>([
    [
      { ok: false, code: 'wrong-password' },
      { status: 'reauth-failed', reason: 'wrong-password' },
    ],
    [
      { ok: false, code: 'too-many-requests' },
      { status: 'reauth-failed', reason: 'too-many-requests' },
    ],
    [
      { ok: false, code: 'network' },
      { status: 'reauth-failed', reason: 'network' },
    ],
    [
      { ok: false, code: 'other' },
      { status: 'reauth-failed', reason: 'other' },
    ],
    [{ ok: false, code: 'not-signed-in' }, { status: 'not-signed-in' }],
    [{ ok: false, code: 'session-invalid' }, { status: 'auth-state-unknown' }],
  ])('reauth faalt (%o) → %o, NUL writes (B2)', async (failure, expected) => {
    const { gateway, auth, coordinator } = setup();
    auth.failures.set('reauth#1', failure);
    expect(await coordinator.clearFirestoreData(PASSWORD)).toEqual(expected);
    expect(gateway.calls.some(isWrite)).toBe(false);
  });

  it('verkeerd wachtwoord (echte vergelijking in de nep) → reauth-failed, nul writes', async () => {
    const { gateway, coordinator } = setup();
    expect(await coordinator.clearFirestoreData('fout-fictief')).toEqual({
      status: 'reauth-failed',
      reason: 'wrong-password',
    });
    expect(gateway.calls.some(isWrite)).toBe(false);
  });

  it('per-organisatiefout stopt met een precieze uitkomst en GEEN volgende write', async () => {
    const { gateway, coordinator, state } = setup();
    // De derde teamMembers-delete overall is de eerste (en enige) in org B.
    gateway.failures.set('deleteTeam#3', { ok: false, error: { code: 'timeout' } });
    expect(await coordinator.clearFirestoreData(PASSWORD)).toEqual({
      status: 'incomplete',
      stage: 'team-members',
      organizationId: ORG_B,
      error: { code: 'timeout' },
    });
    const callsAfterFailure = gateway.calls.slice(
      gateway.calls.lastIndexOf(`deleteTeam:${ORG_B}/team-b1`) + 1,
    );
    expect(callsAfterFailure).toEqual([]);
    // Org A is helemaal weg; org B en de niet-open uitnodigingen staan er nog.
    expect(state.memberships.has(ORG_A)).toBe(false);
    expect(state.teams).toEqual([{ organizationId: ORG_B, teamId: 'team-b1', role: 'scorer' }]);
    expect(state.invitations.map((i) => i.invitationId)).toEqual([
      'inv-a-claimed',
      'inv-c-claimed',
    ]);
  });

  it('hervat idempotent na gedeeltelijke voortgang: org A al verlaten, geen dubbele deletes', async () => {
    const { gateway, coordinator } = setup();
    gateway.failures.set('deleteTeam#3', { ok: false, error: { code: 'offline' } });
    await coordinator.clearFirestoreData(PASSWORD);
    const firstWrites = gateway.calls.filter(isWrite);
    gateway.calls.length = 0;

    expect(await coordinator.clearFirestoreData(PASSWORD)).toEqual({
      status: 'ready-for-auth-deletion',
    });
    const resumedWrites = gateway.calls.filter(isWrite);
    expect(resumedWrites).toEqual([
      `deleteTeam:${ORG_B}/team-b1`,
      `deleteInvitation:${ORG_A}/inv-a-claimed`,
      `deleteInvitation:${ORG_C}/inv-c-claimed`,
    ]);
    // Alles wat de eerste keer lukte (behalve de mislukte delete zelf) wordt niet herhaald.
    for (const write of firstWrites.filter((w) => w !== `deleteTeam:${ORG_B}/team-b1`)) {
      expect(resumedWrites).not.toContain(write);
    }
    // Ook de hervatting reauthenticeert eerst.
    expect(gateway.calls.indexOf('reauth')).toBeLessThan(gateway.calls.findIndex(isWrite));
  });

  it.each([
    ['deleteMembership#1', 'organization-member', ORG_A],
    ['deleteInvitation#1', 'invitations', ORG_A],
  ] as const)(
    'fout bij %s → incomplete(%s) in die organisatie, geen volgende write',
    async (failureKey, stage, organizationId) => {
      const { gateway, coordinator } = setup();
      gateway.failures.set(failureKey, { ok: false, error: { code: 'rejected' } });
      const outcome = await coordinator.clearFirestoreData(PASSWORD);
      expect(outcome).toEqual({
        status: 'incomplete',
        stage,
        organizationId,
        error: { code: 'rejected' },
      });
      const lastWrite = gateway.calls.filter(isWrite).at(-1);
      expect(gateway.calls.at(-1)).toBe(lastWrite);
    },
  );

  it('per-organisatiecontrole vindt nog een teamMembers-document → incomplete(per-org-check), geen membership-delete', async () => {
    const { gateway, coordinator, state } = setup();
    gateway.hooks.set('inventory#2', () =>
      state.teams.push({ organizationId: ORG_A, teamId: 'team-a3', role: 'coach' }),
    );
    expect(await coordinator.clearFirestoreData(PASSWORD)).toEqual({
      status: 'incomplete',
      stage: 'per-org-check',
      organizationId: ORG_A,
    });
    expect(gateway.calls).not.toContain(`deleteMembership:${ORG_A}`);
  });

  it('uitnodigingsstap: een delete faalt → incomplete(invitations) met die organisatie', async () => {
    const { gateway, coordinator } = setup();
    // 1 = open uitnodiging in org A (leave-stap), 2 = inv-a-claimed, 3 = inv-c-claimed
    gateway.failures.set('deleteInvitation#3', { ok: false, error: { code: 'timeout' } });
    expect(await coordinator.clearFirestoreData(PASSWORD)).toEqual({
      status: 'incomplete',
      stage: 'invitations',
      organizationId: ORG_C,
      error: { code: 'timeout' },
    });
    expect(gateway.calls.at(-1)).toBe(`deleteInvitation:${ORG_C}/inv-c-claimed`);
  });

  it('uitnodigingsstap: de verse read faalt → incomplete(invitations), geen uitnodigingsdelete', async () => {
    const { gateway, coordinator } = setup();
    // inventory#1 plan, #2/#3 org A, #4/#5 org B, #6 uitnodigingsread
    gateway.failures.set('inventory#6', { ok: false, error: { code: 'offline' } });
    expect(await coordinator.clearFirestoreData(PASSWORD)).toEqual({
      status: 'incomplete',
      stage: 'invitations',
      organizationId: null,
      error: { code: 'offline' },
    });
    expect(gateway.calls).not.toContain(`deleteInvitation:${ORG_C}/inv-c-claimed`);
  });

  it('eindpoort: na de uitnodigingen verschijnt een nieuwe (R3) → incomplete(final-gate) met restanten', async () => {
    const { gateway, coordinator, state } = setup();
    gateway.hooks.set('inventory#7', () =>
      state.invitations.push({
        organizationId: ORG_B,
        invitationId: 'inv-nieuw',
        status: 'pending',
        role: 'coach',
      }),
    );
    expect(await coordinator.clearFirestoreData(PASSWORD)).toEqual({
      status: 'incomplete',
      stage: 'final-gate',
      organizationId: null,
      remaining: { organizationMembers: 0, teamMembers: 0, invitations: 1 },
    });
  });

  it('eindpoort: read faalt → incomplete(final-gate) met de fout, nooit ready', async () => {
    const { gateway, coordinator } = setup();
    gateway.failures.set('inventory#7', { ok: false, error: { code: 'timeout' } });
    expect(await coordinator.clearFirestoreData(PASSWORD)).toEqual({
      status: 'incomplete',
      stage: 'final-gate',
      organizationId: null,
      error: { code: 'timeout' },
    });
  });

  it('alleen uitnodigingen (elke status, ook in organisaties zonder lidmaatschap) → alles weg', async () => {
    const state = emptyState();
    state.invitations.push(
      { organizationId: ORG_A, invitationId: 'i1', status: 'pending', role: 'viewer' },
      { organizationId: ORG_B, invitationId: 'i2', status: 'revoked', role: 'coach' },
      { organizationId: ORG_C, invitationId: 'i3', status: 'accepted', role: 'scorer' },
    );
    const { gateway, coordinator } = setup(state);
    expect(await coordinator.clearFirestoreData(PASSWORD)).toEqual({
      status: 'ready-for-auth-deletion',
    });
    expect(gateway.calls).toEqual([
      'claim',
      'inventory+inv',
      'reauth',
      'inventory+inv',
      `deleteInvitation:${ORG_A}/i1`,
      `deleteInvitation:${ORG_B}/i2`,
      `deleteInvitation:${ORG_C}/i3`,
      'inventory+inv',
    ]);
  });

  it('Firestore al leeg → ready-for-auth-deletion zonder reauth en zonder write', async () => {
    const { gateway, coordinator } = setup(emptyState());
    expect(await coordinator.clearFirestoreData(PASSWORD)).toEqual({
      status: 'ready-for-auth-deletion',
    });
    expect(gateway.calls).toEqual(['claim', 'inventory+inv']);
  });

  it('een niet-owner bij een lopend verwijderverzoek mag gewoon mee (geen blokkade)', async () => {
    const state = standardState();
    state.facts.set(ORG_A, facts({ deletionRequestStatus: 'executing' }));
    const { coordinator } = setup(state);
    expect(await coordinator.clearFirestoreData(PASSWORD)).toEqual({
      status: 'ready-for-auth-deletion',
    });
  });
});

describe('AccountDeletionCoordinator.deleteAuthAccount()', () => {
  async function clearedSetup() {
    const ctx = setup();
    expect(await ctx.coordinator.clearFirestoreData(PASSWORD)).toEqual({
      status: 'ready-for-auth-deletion',
    });
    ctx.gateway.calls.length = 0;
    ctx.gateway.emptyInventoryAt.clear();
    return ctx;
  }

  it('reauth → eindpoort 5′ DIRECT vóór deleteUser → deleted', async () => {
    const { gateway, auth, coordinator } = await clearedSetup();
    expect(await coordinator.deleteAuthAccount(PASSWORD)).toEqual({ status: 'deleted' });
    expect(gateway.calls).toEqual(['claim', 'reauth', 'inventory+inv', 'deleteUser']);
    expect(auth.guards.slice(-2)).toEqual([ME, ME]);
    expectEveryDeleteUserDirectlyAfterGreenGate(gateway);
  });

  it('volledige flow vanaf een niet-lege inventaris: clear → delete → deleted', async () => {
    const { gateway, coordinator } = setup();
    expect((await coordinator.clearFirestoreData(PASSWORD)).status).toBe('ready-for-auth-deletion');
    expect(await coordinator.deleteAuthAccount(PASSWORD)).toEqual({ status: 'deleted' });
    expectEveryDeleteUserDirectlyAfterGreenGate(gateway);
  });

  it('race na clearFirestoreData: nieuwe uitnodiging → incomplete(final-gate), GEEN deleteUser', async () => {
    const { gateway, coordinator, state } = await clearedSetup();
    state.invitations.push({
      organizationId: ORG_B,
      invitationId: 'inv-nieuw',
      status: 'pending',
      role: 'viewer',
    });
    expect(await coordinator.deleteAuthAccount(PASSWORD)).toEqual({
      status: 'incomplete',
      stage: 'final-gate',
      organizationId: null,
      remaining: { organizationMembers: 0, teamMembers: 0, invitations: 1 },
    });
    expect(gateway.calls).not.toContain('deleteUser');
  });

  it('race tijdens de reauth (owner voegt teamMembers toe) → de eindpoort vangt het, GEEN deleteUser', async () => {
    const { gateway, auth, coordinator, state } = await clearedSetup();
    auth.hooks.set('reauth#2', () =>
      state.teams.push({ organizationId: ORG_A, teamId: 'team-a9', role: 'coach' }),
    );
    expect(await coordinator.deleteAuthAccount(PASSWORD)).toMatchObject({
      status: 'incomplete',
      stage: 'final-gate',
      remaining: { teamMembers: 1 },
    });
    expect(gateway.calls).not.toContain('deleteUser');
  });

  it('een groene eindpoort uit clearFirestoreData telt niet: deleteAuthAccount leest zelf opnieuw', async () => {
    const { gateway, coordinator } = await clearedSetup();
    await coordinator.deleteAuthAccount(PASSWORD);
    const deleteIndex = gateway.calls.indexOf('deleteUser');
    expect(gateway.calls.slice(0, deleteIndex)).toContain('inventory+inv');
  });

  it.each<[AccountReadError, AccountDeletionOutcome]>([
    [{ code: 'offline' }, { status: 'offline' }],
    [{ code: 'timeout' }, { status: 'failed', reason: 'timeout' }],
    [
      { code: 'read-failed', detail: 'x' },
      { status: 'failed', reason: 'read-failed' },
    ],
  ])('eindpoortread faalt (%o) → %o, GEEN deleteUser', async (error, expected) => {
    const { gateway, coordinator } = await clearedSetup();
    gateway.failures.set('inventory#8', { ok: false, error });
    expect(await coordinator.deleteAuthAccount(PASSWORD)).toEqual(expected);
    expect(gateway.calls).not.toContain('deleteUser');
  });

  it.each<[ReauthResult, AccountDeletionOutcome]>([
    [
      { ok: false, code: 'wrong-password' },
      { status: 'reauth-failed', reason: 'wrong-password' },
    ],
    [
      { ok: false, code: 'too-many-requests' },
      { status: 'reauth-failed', reason: 'too-many-requests' },
    ],
    [
      { ok: false, code: 'network' },
      { status: 'reauth-failed', reason: 'network' },
    ],
    [{ ok: false, code: 'session-invalid' }, { status: 'auth-state-unknown' }],
  ])('reauth faalt (%o) → %o: geen eindpoort en GEEN deleteUser', async (failure, expected) => {
    const { gateway, auth, coordinator } = await clearedSetup();
    auth.failures.set('reauth#2', failure);
    expect(await coordinator.deleteAuthAccount(PASSWORD)).toEqual(expected);
    expect(gateway.calls).toEqual(['claim', 'reauth']);
  });

  it('verkeerd wachtwoord terwijl de sessie nog recent is: toch GEEN deleteUser (reauth verplicht)', async () => {
    const { gateway, coordinator } = await clearedSetup();
    expect(await coordinator.deleteAuthAccount('fout-fictief')).toEqual({
      status: 'reauth-failed',
      reason: 'wrong-password',
    });
    expect(gateway.calls).not.toContain('deleteUser');
  });

  it('requires-recent-login → opnieuw reauth → opnieuw eindpoort → deleteUser → deleted (B2)', async () => {
    const { gateway, auth, coordinator } = await clearedSetup();
    auth.failures.set('deleteUser#1', { ok: false, code: 'requires-recent-login' });
    expect(await coordinator.deleteAuthAccount(PASSWORD)).toEqual({ status: 'deleted' });
    expect(gateway.calls).toEqual([
      'claim',
      'reauth',
      'inventory+inv',
      'deleteUser',
      'reauth',
      'inventory+inv',
      'deleteUser',
    ]);
    expect(auth.passwords.slice(-2)).toEqual([PASSWORD, PASSWORD]);
    expectEveryDeleteUserDirectlyAfterGreenGate(gateway);
  });

  it('requires-recent-login twee keer → firestore-cleared-auth-present, precies twee pogingen', async () => {
    const { gateway, auth, coordinator } = await clearedSetup();
    auth.failures.set('deleteUser#1', { ok: false, code: 'requires-recent-login' });
    auth.failures.set('deleteUser#2', { ok: false, code: 'requires-recent-login' });
    expect(await coordinator.deleteAuthAccount(PASSWORD)).toEqual({
      status: 'firestore-cleared-auth-present',
      reason: 'requires-recent-login',
    });
    expect(gateway.calls.filter((c) => c === 'deleteUser')).toHaveLength(2);
    expectEveryDeleteUserDirectlyAfterGreenGate(gateway);
  });

  it('requires-recent-login, daarna faalt de tweede reauth → reauth-failed, geen tweede deleteUser', async () => {
    const { gateway, auth, coordinator } = await clearedSetup();
    auth.failures.set('deleteUser#1', { ok: false, code: 'requires-recent-login' });
    auth.failures.set('reauth#3', { ok: false, code: 'too-many-requests' });
    expect(await coordinator.deleteAuthAccount(PASSWORD)).toEqual({
      status: 'reauth-failed',
      reason: 'too-many-requests',
    });
    expect(gateway.calls.filter((c) => c === 'deleteUser')).toHaveLength(1);
  });

  it('requires-recent-login, en vóór de tweede poging verschijnt een document → GEEN tweede deleteUser', async () => {
    const { gateway, auth, coordinator, state } = await clearedSetup();
    auth.failures.set('deleteUser#1', { ok: false, code: 'requires-recent-login' });
    auth.hooks.set('reauth#3', () => state.memberships.set(ORG_B, 'viewer'));
    expect(await coordinator.deleteAuthAccount(PASSWORD)).toMatchObject({
      status: 'incomplete',
      stage: 'final-gate',
      remaining: { organizationMembers: 1 },
    });
    expect(gateway.calls.filter((c) => c === 'deleteUser')).toHaveLength(1);
  });

  it.each(['network', 'other'] as const)(
    'deleteUser %s, maar een verse tokenverversing bewijst dat het account nog bestaat → firestore-cleared-auth-present',
    async (code) => {
      const { gateway, auth, coordinator } = await clearedSetup();
      auth.failures.set('deleteUser#1', { ok: false, code });
      expect(await coordinator.deleteAuthAccount(PASSWORD)).toEqual({
        status: 'firestore-cleared-auth-present',
        reason: code,
      });
      expect(gateway.calls.slice(-2)).toEqual(['deleteUser', 'claim']);
    },
  );

  it('deleteUser timeout, maar een verse tokenverversing bewijst dat het account nog bestaat → firestore-cleared-auth-present (reden network)', async () => {
    const { gateway, auth, coordinator } = await clearedSetup();
    auth.failures.set('deleteUser#1', { ok: false, code: 'timeout' });
    expect(await coordinator.deleteAuthAccount(PASSWORD)).toEqual({
      status: 'firestore-cleared-auth-present',
      reason: 'network',
    });
    expect(gateway.calls.slice(-2)).toEqual(['deleteUser', 'claim']);
    expect(gateway.calls.filter((c) => c === 'deleteUser')).toHaveLength(1);
  });

  it.each<[DeleteUserCode, EmailClaimResult]>([
    ['timeout', { ok: false, code: 'session-invalid' }],
    ['timeout', { ok: false, code: 'network' }],
    ['timeout', { ok: false, code: 'not-signed-in' }],
    ['timeout', { ok: false, code: 'other' }],
    ['timeout', { ok: true, uid: 'uid-fictief-iemand-anders', email: null, verified: true }],
    ['network', { ok: false, code: 'session-invalid' }],
    ['network', { ok: false, code: 'network' }],
    ['network', { ok: false, code: 'not-signed-in' }],
    ['other', { ok: false, code: 'session-invalid' }],
    ['other', { ok: false, code: 'other' }],
    ['network', { ok: true, uid: 'uid-fictief-iemand-anders', email: null, verified: true }],
  ])(
    'deleteUser %s en de controle bewijst het bestaan NIET (%o) → auth-state-unknown, nooit deleted',
    async (code, probe) => {
      const { auth, coordinator } = await clearedSetup();
      auth.failures.set('deleteUser#1', { ok: false, code });
      auth.failures.set('claim#3', probe);
      expect(await coordinator.deleteAuthAccount(PASSWORD)).toEqual({
        status: 'auth-state-unknown',
      });
    },
  );

  it('deleteUser-antwoord kwijt (unknown-state) → auth-state-unknown, nooit deleted', async () => {
    const { auth, coordinator } = await clearedSetup();
    auth.failures.set('deleteUser#1', { ok: false, code: 'unknown-state' });
    expect(await coordinator.deleteAuthAccount(PASSWORD)).toEqual({ status: 'auth-state-unknown' });
  });

  it('sessie weg of van een ander account vlak vóór deleteUser → not-signed-in', async () => {
    const { auth, coordinator } = await clearedSetup();
    auth.failures.set('deleteUser#1', { ok: false, code: 'not-signed-in' });
    expect(await coordinator.deleteAuthAccount(PASSWORD)).toEqual({ status: 'not-signed-in' });
  });

  it.each<DeleteUserCode>([
    'requires-recent-login',
    'network',
    'not-signed-in',
    'timeout',
    'unknown-state',
    'other',
  ])('nooit deleted zolang deleteUser niet bevestigt (%s, elke poging)', async (code) => {
    const { auth, coordinator } = await clearedSetup();
    auth.failures.set('deleteUser#1', { ok: false, code });
    auth.failures.set('deleteUser#2', { ok: false, code });
    expect((await coordinator.deleteAuthAccount(PASSWORD)).status).not.toBe('deleted');
  });

  it('hervatting na verloren antwoord: het token is niet meer te verversen → auth-state-unknown', async () => {
    const { gateway, auth, coordinator } = await clearedSetup();
    auth.claim = { ok: false, code: 'session-invalid' };
    expect(await coordinator.deleteAuthAccount(PASSWORD)).toEqual({ status: 'auth-state-unknown' });
    expect(gateway.calls).toEqual(['claim']);
  });

  it('Firestore niet leeg en direct deleteAuthAccount → incomplete(final-gate), GEEN deleteUser', async () => {
    const { gateway, coordinator } = setup();
    expect(await coordinator.deleteAuthAccount(PASSWORD)).toEqual({
      status: 'incomplete',
      stage: 'final-gate',
      organizationId: null,
      remaining: { organizationMembers: 1, teamMembers: 3, invitations: 3 },
    });
    expect(gateway.calls).not.toContain('deleteUser');
    expect(gateway.calls.some(isWrite)).toBe(false);
  });
});

describe('AccountDeletionCoordinator — dubbele aanroep', () => {
  it('terwijl clearFirestoreData loopt: elke tweede aanroep → in-progress, zonder één aanroep', async () => {
    const { gateway, auth, coordinator } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = auth.readVerifiedEmailClaim.bind(auth);
    let first = true;
    auth.readVerifiedEmailClaim = async () => {
      if (first) {
        first = false;
        await gate;
      }
      return original();
    };

    const running = coordinator.clearFirestoreData(PASSWORD);
    expect(await coordinator.clearFirestoreData(PASSWORD)).toEqual({ status: 'in-progress' });
    expect(await coordinator.deleteAuthAccount(PASSWORD)).toEqual({ status: 'in-progress' });
    expect(await coordinator.assess()).toEqual({ status: 'in-progress' });
    release();
    expect(await running).toEqual({ status: 'ready-for-auth-deletion' });
    expect(gateway.calls.filter((c) => c === 'reauth')).toHaveLength(1);
    expect(gateway.calls).not.toContain('deleteUser');

    // Het slot is daarna vrij.
    expect(await coordinator.deleteAuthAccount(PASSWORD)).toEqual({ status: 'deleted' });
  });

  it('het slot wordt ook vrijgegeven als een poort gooit', async () => {
    const { auth, coordinator } = setup();
    const original = auth.readVerifiedEmailClaim.bind(auth);
    let calls = 0;
    auth.readVerifiedEmailClaim = async () => {
      calls += 1;
      if (calls === 1) throw new Error('onverwacht');
      return original();
    };
    await expect(coordinator.clearFirestoreData(PASSWORD)).rejects.toThrow('onverwacht');
    expect((await coordinator.assess()).status).toBe('ready-to-clear');
  });
});

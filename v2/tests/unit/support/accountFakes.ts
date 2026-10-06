// Gedeelde nep-poorten voor de account-coördinatortests (PR 8.3c-2b-i/ii). Verplaatst
// uit LeaveOrganizationCoordinator.spec.ts zodat AccountDeletionCoordinator.spec.ts
// dezelfde "server" gebruikt. Alleen fictieve uid's en organisaties.
import type {
  AccountGateway,
  AccountIdentity,
  FactsReadResult,
  IdentityReadResult,
  InventoryReadResult,
  SelfDeleteResult,
} from '../../../src/application/account/AccountGateway';
import type { LocalUnsyncedWorkProbe } from '../../../src/application/account/LocalUnsyncedWorkProbe';
import type { OrganizationFacts } from '../../../src/domain/account/types';
import type { InvitationStatus } from '../../../src/domain/invitations/types';
import type { OrganizationRole } from '../../../src/domain/organizations/types';

export interface ServerState {
  memberships: Map<string, OrganizationRole>;
  teams: { organizationId: string; teamId: string; role: OrganizationRole }[];
  invitations: {
    organizationId: string;
    invitationId: string;
    status: InvitationStatus;
    role: OrganizationRole;
  }[];
  facts: Map<string, Omit<OrganizationFacts, 'organizationId'>>;
}

export type Method =
  'inventory' | 'facts' | 'deleteTeam' | 'deleteInvitation' | 'deleteMembership' | 'identity';

/**
 * Nep-implementatie van de poort. Gedraagt zich als het gatewaycontract: reads komen
 * uit `state`, een delete van een document dat er niet (meer) is geeft `already-gone`.
 * `failures` laat de n-de aanroep van een methode een vaste uitkomst geven; `hooks`
 * laat de "server" tussendoor veranderen (bijv. een owner die een teamMembers-document
 * toevoegt — restrisico R3).
 */
export class FakeAccountGateway implements AccountGateway {
  readonly calls: string[] = [];
  readonly failures = new Map<string, unknown>();
  readonly hooks = new Map<string, () => void>();
  private readonly counters = new Map<Method, number>();

  constructor(
    readonly state: ServerState,
    public identity: AccountIdentity | null,
  ) {}

  private tick(method: Method): string {
    const n = (this.counters.get(method) ?? 0) + 1;
    this.counters.set(method, n);
    const key = `${method}#${n}`;
    this.hooks.get(key)?.();
    return key;
  }

  private failure<T>(key: string): T | undefined {
    return this.failures.get(key) as T | undefined;
  }

  async readIdentity(): Promise<IdentityReadResult> {
    const key = this.tick('identity');
    this.calls.push('identity');
    const failed = this.failure<IdentityReadResult>(key);
    if (failed) return failed;
    if (this.identity === null) return { ok: false, error: { code: 'not-signed-in' } };
    return { ok: true, identity: this.identity };
  }

  async readInventoryFromServer(options: {
    includeInvitations: boolean;
  }): Promise<InventoryReadResult> {
    const key = this.tick('inventory');
    this.calls.push(options.includeInvitations ? 'inventory+inv' : 'inventory');
    const failed = this.failure<InventoryReadResult>(key);
    if (failed) return failed;
    if (options.includeInvitations && !this.identity?.emailVerified) {
      return { ok: false, error: { code: 'email-not-verified' } };
    }
    return {
      ok: true,
      inventory: {
        organizationMemberships: [...this.state.memberships].map(([organizationId, role]) => ({
          organizationId,
          role,
        })),
        teamMemberships: this.state.teams.map((t) => ({ ...t })),
        invitations: options.includeInvitations
          ? this.state.invitations.map((i) => ({ ...i }))
          : [],
      },
    };
  }

  async readOrganizationFacts(organizationId: string): Promise<FactsReadResult> {
    const key = this.tick('facts');
    this.calls.push(`facts:${organizationId}`);
    const failed = this.failure<FactsReadResult>(key);
    if (failed) return failed;
    const facts = this.state.facts.get(organizationId);
    if (!facts) return { ok: false, error: { code: 'read-failed', detail: 'geen feiten' } };
    return { ok: true, facts: { organizationId, ...facts } };
  }

  async deleteOwnTeamMembership(ref: {
    organizationId: string;
    teamId: string;
  }): Promise<SelfDeleteResult> {
    const key = this.tick('deleteTeam');
    this.calls.push(`deleteTeam:${ref.organizationId}/${ref.teamId}`);
    const failed = this.failure<SelfDeleteResult>(key);
    if (failed) return failed;
    const index = this.state.teams.findIndex(
      (t) => t.organizationId === ref.organizationId && t.teamId === ref.teamId,
    );
    if (index < 0) return { ok: true, outcome: 'already-gone' };
    this.state.teams.splice(index, 1);
    return { ok: true, outcome: 'deleted' };
  }

  async deleteOwnInvitation(ref: {
    organizationId: string;
    invitationId: string;
  }): Promise<SelfDeleteResult> {
    const key = this.tick('deleteInvitation');
    this.calls.push(`deleteInvitation:${ref.organizationId}/${ref.invitationId}`);
    const failed = this.failure<SelfDeleteResult>(key);
    if (failed) return failed;
    const index = this.state.invitations.findIndex(
      (i) => i.organizationId === ref.organizationId && i.invitationId === ref.invitationId,
    );
    if (index < 0) return { ok: true, outcome: 'already-gone' };
    this.state.invitations.splice(index, 1);
    return { ok: true, outcome: 'deleted' };
  }

  async deleteOwnOrganizationMembership(organizationId: string): Promise<SelfDeleteResult> {
    const key = this.tick('deleteMembership');
    this.calls.push(`deleteMembership:${organizationId}`);
    const failed = this.failure<SelfDeleteResult>(key);
    if (failed) return failed;
    if (!this.state.memberships.has(organizationId)) return { ok: true, outcome: 'already-gone' };
    this.state.memberships.delete(organizationId);
    return { ok: true, outcome: 'deleted' };
  }

  writes(): string[] {
    return this.calls.filter((call) => call.startsWith('delete'));
  }
}

export class FakeProbe implements LocalUnsyncedWorkProbe {
  constructor(readonly counts: Record<string, number> = {}) {}
  countForOrganization(organizationId: string): number {
    return this.counts[organizationId] ?? 0;
  }
}

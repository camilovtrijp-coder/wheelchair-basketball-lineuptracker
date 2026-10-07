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
import type {
  CallerReadResult,
  FootprintReadResult,
  MembersReadResult,
  OwnershipTransferGateway,
  PromoteResult,
  RemoveMemberResult,
  RemoveTeamMembershipsResult,
  RevokeInvitationsResult,
} from '../../../src/application/account/OwnershipTransferGateway';
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
  /** Index in `calls` → of die (geslaagde) inventarisread helemaal leeg was. */
  readonly emptyInventoryAt = new Map<number, boolean>();

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
    const inventory = {
      organizationMemberships: [...this.state.memberships].map(([organizationId, role]) => ({
        organizationId,
        role,
      })),
      teamMemberships: this.state.teams.map((t) => ({ ...t })),
      invitations: options.includeInvitations ? this.state.invitations.map((i) => ({ ...i })) : [],
    };
    this.emptyInventoryAt.set(
      this.calls.length - 1,
      inventory.organizationMemberships.length === 0 &&
        inventory.teamMemberships.length === 0 &&
        inventory.invitations.length === 0,
    );
    return { ok: true, inventory };
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

// ---- PR 8.3c-2b-iii: overdracht ----

export interface TransferServerState {
  /** organizationId → uid → membership. */
  members: Map<string, Map<string, { role: OrganizationRole; email: string }>>;
  /** organizationId → teamId → uid's met een teamMembers-document. */
  teams: Map<string, Map<string, Set<string>>>;
  invitations: {
    organizationId: string;
    invitationId: string;
    email: string;
    status: InvitationStatus;
  }[];
}

export type TransferMethod =
  'caller' | 'members' | 'promote' | 'revoke' | 'removeTeams' | 'removeMember' | 'footprint';

/**
 * Nep-implementatie van `OwnershipTransferGateway` met een eigen "server". Gedraagt zich
 * als het gatewaycontract én als de Rules: alleen een owner promoveert of verwijdert een
 * owner-membership, owner/admin trekken in en verwijderen teamMembers, de eigen uid als
 * doel → `self-target`, een afwijkende rol → `role-changed` zonder write.
 * `failures`/`hooks` zoals bij `FakeAccountGateway` (sleutel `methode#n`).
 */
export class FakeOwnershipTransferGateway implements OwnershipTransferGateway {
  readonly calls: string[] = [];
  readonly failures = new Map<string, unknown>();
  readonly hooks = new Map<string, () => void>();
  private readonly counters = new Map<TransferMethod, number>();

  constructor(
    readonly state: TransferServerState,
    public callerUid: string | null,
  ) {}

  private tick(method: TransferMethod): string {
    const n = (this.counters.get(method) ?? 0) + 1;
    this.counters.set(method, n);
    const key = `${method}#${n}`;
    this.hooks.get(key)?.();
    return key;
  }

  private failure<T>(key: string): T | undefined {
    return this.failures.get(key) as T | undefined;
  }

  private org(organizationId: string) {
    let members = this.state.members.get(organizationId);
    if (!members) {
      members = new Map();
      this.state.members.set(organizationId, members);
    }
    return members;
  }

  private callerRole(organizationId: string): OrganizationRole | null {
    if (this.callerUid === null) return null;
    return this.org(organizationId).get(this.callerUid)?.role ?? null;
  }

  private isOwnerOrAdmin(organizationId: string): boolean {
    const role = this.callerRole(organizationId);
    return role === 'organizationOwner' || role === 'organizationAdmin';
  }

  private openInvitations(organizationId: string, email: string) {
    return this.state.invitations.filter(
      (invitation) =>
        invitation.organizationId === organizationId &&
        invitation.email.toLowerCase() === email.toLowerCase() &&
        (invitation.status === 'pending' || invitation.status === 'accepted'),
    );
  }

  async readCaller(organizationId: string): Promise<CallerReadResult> {
    const key = this.tick('caller');
    this.calls.push(`caller:${organizationId}`);
    const failed = this.failure<CallerReadResult>(key);
    if (failed) return failed;
    if (this.callerUid === null) return { ok: false, error: { code: 'not-signed-in' } };
    const role = this.callerRole(organizationId);
    return { ok: true, caller: role === null ? null : { uid: this.callerUid, role } };
  }

  async listOrganizationMembers(organizationId: string): Promise<MembersReadResult> {
    const key = this.tick('members');
    this.calls.push(`members:${organizationId}`);
    const failed = this.failure<MembersReadResult>(key);
    if (failed) return failed;
    if (this.callerRole(organizationId) === null) {
      return { ok: false, error: { code: 'read-failed', detail: 'permission-denied' } };
    }
    return {
      ok: true,
      members: [...this.org(organizationId)].map(([uid, member]) => ({ uid, ...member })),
    };
  }

  async promoteToOwner(
    organizationId: string,
    targetUid: string,
    expectedRole: OrganizationRole,
  ): Promise<PromoteResult> {
    const key = this.tick('promote');
    this.calls.push(`promote:${organizationId}/${targetUid}`);
    const failed = this.failure<PromoteResult>(key);
    if (failed) return failed;
    if (targetUid === this.callerUid) return { ok: false, error: { code: 'self-target' } };
    const target = this.org(organizationId).get(targetUid);
    if (!target) return { ok: false, error: { code: 'not-found' } };
    if (target.role === 'organizationOwner') return { ok: true, outcome: 'already-owner' };
    if (target.role !== expectedRole) {
      return { ok: false, error: { code: 'role-changed', actualRole: target.role } };
    }
    if (this.callerRole(organizationId) !== 'organizationOwner') {
      return { ok: false, error: { code: 'rejected' } };
    }
    target.role = 'organizationOwner';
    this.calls.push(`write:promote:${organizationId}/${targetUid}`);
    return { ok: true, outcome: 'promoted' };
  }

  async revokeOpenInvitationsForEmail(
    organizationId: string,
    email: string,
  ): Promise<RevokeInvitationsResult> {
    const key = this.tick('revoke');
    this.calls.push(`revoke:${organizationId}/${email}`);
    const failed = this.failure<RevokeInvitationsResult>(key);
    if (failed) return failed;
    if (!this.isOwnerOrAdmin(organizationId)) {
      return { ok: false, error: { code: 'failed', detail: 'permission-denied' }, revoked: 0 };
    }
    let revoked = 0;
    for (const invitation of this.openInvitations(organizationId, email)) {
      invitation.status = 'revoked';
      this.calls.push(`write:revoke:${organizationId}/${invitation.invitationId}`);
      revoked += 1;
    }
    return { ok: true, revoked, alreadyClosed: 0 };
  }

  async removeTeamMembershipsOf(
    organizationId: string,
    targetUid: string,
  ): Promise<RemoveTeamMembershipsResult> {
    const key = this.tick('removeTeams');
    this.calls.push(`removeTeams:${organizationId}/${targetUid}`);
    const failed = this.failure<RemoveTeamMembershipsResult>(key);
    if (failed) return failed;
    if (targetUid === this.callerUid) {
      return { ok: false, error: { code: 'self-target' }, removed: 0 };
    }
    if (!this.isOwnerOrAdmin(organizationId)) {
      return { ok: false, error: { code: 'rejected' }, removed: 0 };
    }
    let removed = 0;
    const teams = this.state.teams.get(organizationId) ?? new Map<string, Set<string>>();
    for (const [teamId, uids] of teams) {
      if (uids.delete(targetUid)) {
        this.calls.push(`write:removeTeam:${organizationId}/${teamId}/${targetUid}`);
        removed += 1;
      }
    }
    return { ok: true, removed };
  }

  async removeOrganizationMember(
    organizationId: string,
    targetUid: string,
    expectedRole: OrganizationRole,
  ): Promise<RemoveMemberResult> {
    const key = this.tick('removeMember');
    this.calls.push(`removeMember:${organizationId}/${targetUid}`);
    const failed = this.failure<RemoveMemberResult>(key);
    if (failed) return failed;
    if (targetUid === this.callerUid) return { ok: false, error: { code: 'self-target' } };
    const target = this.org(organizationId).get(targetUid);
    if (!target) return { ok: true, outcome: 'already-gone' };
    if (target.role !== expectedRole) {
      return { ok: false, error: { code: 'role-changed', actualRole: target.role } };
    }
    if (this.callerRole(organizationId) !== 'organizationOwner') {
      return { ok: false, error: { code: 'rejected' } };
    }
    this.org(organizationId).delete(targetUid);
    this.calls.push(`write:removeMember:${organizationId}/${targetUid}`);
    return { ok: true, outcome: 'deleted' };
  }

  async readMemberFootprint(
    organizationId: string,
    targetUid: string,
    email: string,
  ): Promise<FootprintReadResult> {
    const key = this.tick('footprint');
    this.calls.push(`footprint:${organizationId}/${targetUid}`);
    const failed = this.failure<FootprintReadResult>(key);
    if (failed) return failed;
    let teamMemberships = 0;
    const teams = this.state.teams.get(organizationId) ?? new Map<string, Set<string>>();
    for (const uids of teams.values()) {
      if (uids.has(targetUid)) teamMemberships += 1;
    }
    return {
      ok: true,
      footprint: {
        organizationMember: this.org(organizationId).has(targetUid),
        teamMemberships,
        openInvitations: this.openInvitations(organizationId, email).length,
      },
    };
  }

  /** Alleen de werkelijk uitgevoerde writes (geen aanroepen die niets schreven). */
  writes(): string[] {
    return this.calls.filter((call) => call.startsWith('write:'));
  }
}

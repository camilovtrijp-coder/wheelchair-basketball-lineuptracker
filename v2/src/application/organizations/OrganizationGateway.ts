import type { Invitation } from '../../domain/invitations/types';
import type { Membership, OrganizationRole, TeamSummary } from '../../domain/organizations/types';
import type { TeamAccess } from '../../domain/organizations/teamAccess';

export interface OperationResult<T = undefined> {
  ok: boolean;
  /** Firebase-foutcode (bijv. 'permission-denied'), voor screen-lokale foutmeldingen. */
  errorCode?: string;
  value?: T;
}

export interface OrganizationGateway {
  /** De enige toegestane query voor "al mijn organisaties" (zie firebase/docs/QUERY_CONTRACT.md). */
  listMyMemberships(): Promise<Membership[]>;
  createOrganizationWithOwner(name: string): Promise<OperationResult<{ orgId: string }>>;
  createTeam(orgId: string, name: string): Promise<OperationResult<{ teamId: string }>>;
  listTeams(orgId: string): Promise<TeamSummary[]>;
  getMyTeamAccess(orgId: string, teamId: string, orgRole: OrganizationRole): Promise<TeamAccess>;
  /** `null` als de uitnodiging niet bestaat, of niet leesbaar is voor de ingelogde gebruiker. */
  getInvitationByLink(orgId: string, invitationId: string): Promise<Invitation | null>;
  acceptInvitation(orgId: string, invitationId: string): Promise<OperationResult>;
  /**
   * Neemt de al opgehaalde uitnodiging (i.p.v. alleen orgId/invitationId): de
   * Rules eisen dat het nieuwe membership-document exact de rol en het
   * e-mailadres van de uitnodiging bevat, dus die moeten hier al bekend zijn.
   */
  claimInvitation(invitation: Invitation): Promise<OperationResult>;
}

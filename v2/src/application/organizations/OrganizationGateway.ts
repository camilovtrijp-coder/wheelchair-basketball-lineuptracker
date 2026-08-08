import type { Invitation } from '../../domain/invitations/types';
import type {
  Membership,
  OrganizationRole,
  TeamOnlyContext,
  TeamSummary,
} from '../../domain/organizations/types';
import type { TeamAccess } from '../../domain/organizations/teamAccess';

export interface OperationResult<T = undefined> {
  ok: boolean;
  /** Firebase-foutcode (bijv. 'permission-denied'), voor screen-lokale foutmeldingen. */
  errorCode?: string;
  value?: T;
}

/**
 * Resultaat van `validateSelectedTeam()`. `valid` bepaalt of de geselecteerde
 * context nog bruikbaar is (bestaat-team + aantoonbare toegang); `canManageTeamData`
 * geeft aan of deze gebruiker in de UI schrijfknoppen te zien krijgt. Worden in
 * dezelfde Firestore-read afgeleid (zie FirestoreOrganizationGateway.validateSelectedTeam).
 */
export interface TeamValidationResult {
  valid: boolean;
  canManageTeamData: boolean;
}

export interface OrganizationGateway {
  /** De enige toegestane query voor "al mijn organisatielidmaatschappen" (zie firebase/docs/QUERY_CONTRACT.md). */
  listMyMemberships(): Promise<Membership[]>;
  /**
   * De andere toegestane query (issue #31): teams waar deze gebruiker via een expliciet
   * `teamMembers`-document toegang toe heeft, ONAFHANKELIJK van `listMyMemberships()` —
   * nodig voor gebruikers zonder enig `organizationMembers`-document in die organisatie.
   */
  listMyTeamOnlyContexts(): Promise<TeamOnlyContext[]>;
  /**
   * `resumeOrgId`: geef het `orgId` uit een eerder mislukte poging door (zie `value` op een
   * `ok:false`-resultaat) om een weesorganisatie te herstellen i.p.v. een nieuwe aan te maken.
   */
  createOrganizationWithOwner(
    name: string,
    resumeOrgId?: string,
  ): Promise<OperationResult<{ orgId: string }>>;
  createTeam(orgId: string, name: string): Promise<OperationResult<{ teamId: string }>>;
  listTeams(orgId: string): Promise<TeamSummary[]>;
  /**
   * `orgRole` is `null` voor een team-only context (issue #31 — geen `organizationMembers`
   * in deze organisatie); zie `deriveTeamAccess()`.
   */
  getMyTeamAccess(
    orgId: string,
    teamId: string,
    orgRole: OrganizationRole | null,
  ): Promise<TeamAccess>;
  /**
   * Hervalideert een eerder gekozen (bijv. uit localStorage herstelde) context: bestaat het
   * team nog, en heeft deze gebruiker er nog aantoonbaar toegang toe (owner/admin impliciet,
   * anders een expliciet teamMembers-document)? `deriveAppState` gebruikt `valid` om ook
   * team-niveau-intrekking te detecteren — puur organisatielidmaatschap alleen (het eerdere
   * gedrag) miste een ingetrokken, verwijderd of via localStorage vervalst `teamId`.
   *
   * `canManageTeamData` wordt door AuthGate doorgegeven aan `App`/`SettingsPanel`/`RosterPanel`
   * om de UI-schrijfknoppen te hiden/disablen voor rollen die geen teamdata mogen bewerken
   * (spiegelt firestore.rules' canManageTeamData/teamRole exact — zie PR 5.4a). Wordt in
   * dezelfde call afgeleid als `valid` (uit dezelfde getMyTeamAccess()-read), dus zonder
   * extra Firestore-read.
   */
  validateSelectedTeam(
    orgId: string,
    teamId: string,
    orgRole: OrganizationRole | null,
  ): Promise<TeamValidationResult>;
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

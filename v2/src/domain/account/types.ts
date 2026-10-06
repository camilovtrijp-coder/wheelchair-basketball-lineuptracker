import type { DeletionRequestStatus } from '../deletion/types';
import type { InvitationStatus } from '../invitations/types';
import type { OrganizationRole } from '../organizations/types';

/**
 * PR 8.3c-2b-i (docs/pr-8.3c-2b-plan.md §C.1): domeinmodel van de eigen
 * lidmaatschaps- en uitnodigingsinventaris. Bewust GEEN Firebase-afhankelijkheid
 * (`domain/` importeert geen `firebase/*`) en GEEN uid of e-mail in de regels:
 * de inventaris komt altijd uit de drie eigen-identiteit-collectionGroup-queries
 * (firebase/docs/QUERY_CONTRACT.md), dus elke regel is per definitie "van mij".
 */
export interface OwnOrganizationMembershipRef {
  organizationId: string;
  role: OrganizationRole;
}

export interface OwnTeamMembershipRef {
  organizationId: string;
  teamId: string;
  role: OrganizationRole;
}

export interface OwnInvitationRef {
  organizationId: string;
  invitationId: string;
  status: InvitationStatus;
  role: OrganizationRole;
}

export interface AccountInventory {
  organizationMemberships: OwnOrganizationMembershipRef[];
  teamMemberships: OwnTeamMembershipRef[];
  /** Leeg wanneer niet opgevraagd (bijv. zonder geverifieerde e-mailclaim). */
  invitations: OwnInvitationRef[];
}

/**
 * Per-organisatiefeiten die de classificatie nodig heeft (§B.6). Alleen leesbaar
 * voor een organisatie waarin de gebruiker een `organizationMembers`-document heeft
 * (`isOrgMember`); voor een team-only lid of alleen-uitnodigingen is er geen feitenset.
 */
export interface OrganizationFacts {
  organizationId: string;
  /** `false` = membership zonder organisatiedocument (halve runbookwissing). */
  exists: boolean;
  /** Ruw gelezen, zonder converter: `null` als het veld ontbreekt of geen niet-lege string is. */
  createdBy: string | null;
  /** Uid's van ALLE owners, inclusief de aanroeper zelf als die owner is. */
  ownerUids: string[];
  /** `null` als er geen verwijderverzoek bestaat. */
  deletionRequestStatus: DeletionRequestStatus | null;
}

/** Alle eigen documenten in één organisatie, gegroepeerd uit een `AccountInventory`. */
export interface OrganizationSlice {
  organizationId: string;
  membership: OwnOrganizationMembershipRef | null;
  teamMemberships: OwnTeamMembershipRef[];
  invitations: OwnInvitationRef[];
}

export const ORGANIZATION_LEAVE_CLASSES = [
  'leave',
  'leave-team-only',
  'invitations-only',
  'owner-sole',
  'owner-awaiting-removal',
  'creator-needs-owner',
  'awaiting-organization-deletion',
  'organization-deletion-failed',
  'organization-unsupported',
  'organization-missing',
  'local-unsynced-work',
] as const;
export type OrganizationLeaveClass = (typeof ORGANIZATION_LEAVE_CLASSES)[number];

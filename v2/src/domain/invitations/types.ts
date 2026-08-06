import type { OrganizationRole } from '../organizations/types';

/** Moet gelijk blijven aan firebase/src/documents/invitation.ts' INVITATION_STATUSES — zie de toelichting in domain/organizations/types.ts over waarom domain/ geen packages importeert. */
export const INVITATION_STATUSES = ['pending', 'accepted', 'claimed', 'revoked'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** UI-gerichte weergave van organizations/{orgId}/invitations/{invitationId}. */
export interface Invitation {
  orgId: string;
  invitationId: string;
  email: string;
  role: OrganizationRole;
  status: InvitationStatus;
}

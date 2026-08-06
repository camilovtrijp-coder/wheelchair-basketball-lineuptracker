export type { InvitationStatus } from 'firebase-base/documents';

import type { InvitationStatus, OrganizationRole } from 'firebase-base/documents';

/** UI-gerichte weergave van organizations/{orgId}/invitations/{invitationId}. */
export interface Invitation {
  orgId: string;
  invitationId: string;
  email: string;
  role: OrganizationRole;
  status: InvitationStatus;
}

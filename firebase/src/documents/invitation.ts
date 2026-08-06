import type { FirestoreDataConverter, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';
import type { OrganizationRole } from './organizationMember.js';

export const INVITATION_STATUSES = ['pending', 'accepted', 'claimed', 'revoked'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** organizations/{orgId}/invitations/{invitationId} — zie ADR-003. */
export interface InvitationDocument {
  email: string;
  role: OrganizationRole;
  status: InvitationStatus;
  invitedBy: string;
  invitedAt: Timestamp;
  acceptedAt: Timestamp | null;
  claimedAt?: Timestamp;
}

export const invitationConverter: FirestoreDataConverter<InvitationDocument> = {
  toFirestore(invitation: InvitationDocument) {
    return invitation;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): InvitationDocument {
    const data = snapshot.data();
    return {
      email: data.email,
      role: data.role,
      status: data.status,
      invitedBy: data.invitedBy,
      invitedAt: data.invitedAt,
      acceptedAt: data.acceptedAt,
      claimedAt: data.claimedAt,
    };
  },
};

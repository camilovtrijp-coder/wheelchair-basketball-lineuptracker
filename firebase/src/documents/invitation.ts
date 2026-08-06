import type { FirestoreDataConverter, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';
import { ORGANIZATION_ROLES, type OrganizationRole } from './organizationMember.js';
import {
  assertEmail,
  assertNonEmptyString,
  assertNullableTimestamp,
  assertOneOf,
  assertOptionalTimestamp,
  assertTimestamp,
} from './validation.js';

const TYPE = 'invitation';

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
      email: assertEmail(TYPE, 'email', data.email),
      role: assertOneOf(TYPE, 'role', data.role, ORGANIZATION_ROLES),
      status: assertOneOf(TYPE, 'status', data.status, INVITATION_STATUSES),
      invitedBy: assertNonEmptyString(TYPE, 'invitedBy', data.invitedBy),
      invitedAt: assertTimestamp(TYPE, 'invitedAt', data.invitedAt),
      acceptedAt: assertNullableTimestamp(TYPE, 'acceptedAt', data.acceptedAt),
      claimedAt: assertOptionalTimestamp(TYPE, 'claimedAt', data.claimedAt),
    };
  },
};

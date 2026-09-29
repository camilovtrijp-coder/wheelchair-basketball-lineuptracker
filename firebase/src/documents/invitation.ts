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
  /**
   * PR 8.3c-1: servergebonden eindtijdstempel van een intrekking
   * (`firestore.rules`: `revokedAt == request.time`). Optioneel omdat
   * documenten van vóór 8.3c-1 het niet dragen; de bewaartermijn valt dan terug
   * op `invitedAt`. Zonder dit veld in de converter zou de organisatie-export
   * (8.3b) het stil weglaten.
   */
  revokedAt?: Timestamp;
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
      revokedAt: assertOptionalTimestamp(TYPE, 'revokedAt', data.revokedAt),
    };
  },
};

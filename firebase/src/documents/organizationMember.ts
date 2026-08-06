import type { FirestoreDataConverter, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';
import { assertEmail, assertNonEmptyString, assertOneOf, assertOptionalTimestamp } from './validation.js';

const TYPE = 'organizationMember';

export const ORGANIZATION_ROLES = [
  'organizationOwner',
  'organizationAdmin',
  'coach',
  'scorer',
  'viewer',
] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/**
 * organizations/{orgId}/organizationMembers/{uid}
 *
 * Document-ID is altijd de UID (ADR-003). Het `uid`-veld is een bewuste
 * denormalisatie t.b.v. issue #28: `firestore.rules` eist dat dit veld bij
 * create gelijk is aan de document-ID/`request.auth.uid`, zodat het veilig
 * bruikbaar is als filter in de enige toegestane `collectionGroup`-query
 * (zie firebase/docs/QUERY_CONTRACT.md). Zonder dit veld is "alle
 * organisaties van deze gebruiker" niet filterbaar over een onbekende
 * verzameling orgId's.
 */
export interface OrganizationMemberDocument {
  role: OrganizationRole;
  email: string;
  uid: string;
  joinedAt?: Timestamp;
  invitationId?: string;
}

export const organizationMemberConverter: FirestoreDataConverter<OrganizationMemberDocument> = {
  toFirestore(member: OrganizationMemberDocument) {
    return member;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): OrganizationMemberDocument {
    const data = snapshot.data();
    return {
      role: assertOneOf(TYPE, 'role', data.role, ORGANIZATION_ROLES),
      email: assertEmail(TYPE, 'email', data.email),
      uid: assertNonEmptyString(TYPE, 'uid', data.uid),
      joinedAt: assertOptionalTimestamp(TYPE, 'joinedAt', data.joinedAt),
      invitationId:
        data.invitationId === undefined ? undefined : assertNonEmptyString(TYPE, 'invitationId', data.invitationId),
    };
  },
};

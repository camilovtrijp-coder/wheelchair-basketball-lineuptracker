import type { FirestoreDataConverter, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';
import { ORGANIZATION_ROLES, type OrganizationRole } from './organizationMember.js';
import { assertEmail, assertOneOf, assertOptionalTimestamp } from './validation.js';

const TYPE = 'teamMember';

/**
 * organizations/{orgId}/teams/{teamId}/teamMembers/{uid}
 *
 * `role` is een gedenormaliseerde kopie t.o.v. `organizationMembers/{uid}.role`
 * voor org-brede rollen (zie firestore.rules-toelichting); dit document is
 * alleen aanwezig/leidend voor team-specifieke rollen (coach/scorer/viewer).
 */
export interface TeamMemberDocument {
  role: OrganizationRole;
  email: string;
  addedAt?: Timestamp;
}

export const teamMemberConverter: FirestoreDataConverter<TeamMemberDocument> = {
  toFirestore(member: TeamMemberDocument) {
    return member;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): TeamMemberDocument {
    const data = snapshot.data();
    return {
      role: assertOneOf(TYPE, 'role', data.role, ORGANIZATION_ROLES),
      email: assertEmail(TYPE, 'email', data.email),
      addedAt: assertOptionalTimestamp(TYPE, 'addedAt', data.addedAt),
    };
  },
};

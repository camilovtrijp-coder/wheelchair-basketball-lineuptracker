import type { FirestoreDataConverter, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';
import type { OrganizationRole } from './organizationMember.js';

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
      role: data.role,
      email: data.email,
      addedAt: data.addedAt,
    };
  },
};

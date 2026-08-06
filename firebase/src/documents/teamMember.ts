import type { FirestoreDataConverter, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';
import { ORGANIZATION_ROLES, type OrganizationRole } from './organizationMember.js';
import { assertEmail, assertNonEmptyString, assertOneOf, assertOptionalTimestamp } from './validation.js';

const TYPE = 'teamMember';

/**
 * organizations/{orgId}/teams/{teamId}/teamMembers/{uid}
 *
 * `role` is een gedenormaliseerde kopie t.o.v. `organizationMembers/{uid}.role`
 * voor org-brede rollen (zie firestore.rules-toelichting); dit document is
 * alleen aanwezig/leidend voor team-specifieke rollen (coach/scorer/viewer).
 *
 * Het `uid`-veld is dezelfde denormalisatie als `organizationMembers/{uid}.uid`
 * (issue #28) — nu ook hier nodig voor issue #31: "alle teams waar ik lid van
 * ben zonder organisatiemembership" is een `collectionGroup('teamMembers')`-
 * query, en die kan alleen veilig filteren op een veld dat `firestore.rules`
 * bij create afdwingt gelijk te zijn aan de document-ID/`request.auth.uid`.
 * Zie firebase/docs/QUERY_CONTRACT.md.
 */
export interface TeamMemberDocument {
  role: OrganizationRole;
  email: string;
  uid: string;
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
      uid: assertNonEmptyString(TYPE, 'uid', data.uid),
      addedAt: assertOptionalTimestamp(TYPE, 'addedAt', data.addedAt),
    };
  },
};

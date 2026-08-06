import type { FirestoreDataConverter, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';
import { assertNonEmptyString, assertTimestamp } from './validation.js';

const TYPE = 'organization';

/** organizations/{orgId} */
export interface OrganizationDocument {
  name: string;
  createdBy: string;
  createdAt: Timestamp;
}

export const organizationConverter: FirestoreDataConverter<OrganizationDocument> = {
  toFirestore(org: OrganizationDocument) {
    return org;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): OrganizationDocument {
    const data = snapshot.data();
    return {
      name: assertNonEmptyString(TYPE, 'name', data.name),
      createdBy: assertNonEmptyString(TYPE, 'createdBy', data.createdBy),
      createdAt: assertTimestamp(TYPE, 'createdAt', data.createdAt),
    };
  },
};

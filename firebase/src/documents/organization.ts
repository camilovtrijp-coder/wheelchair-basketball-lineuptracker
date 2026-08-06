import type { FirestoreDataConverter, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';

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
      name: data.name,
      createdBy: data.createdBy,
      createdAt: data.createdAt,
    };
  },
};

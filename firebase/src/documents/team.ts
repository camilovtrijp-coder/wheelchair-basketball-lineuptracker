import type { FirestoreDataConverter, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';

/** organizations/{orgId}/teams/{teamId} */
export interface TeamDocument {
  name: string;
  createdBy: string;
  createdAt: Timestamp;
}

export const teamConverter: FirestoreDataConverter<TeamDocument> = {
  toFirestore(team: TeamDocument) {
    return team;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot): TeamDocument {
    const data = snapshot.data();
    return {
      name: data.name,
      createdBy: data.createdBy,
      createdAt: data.createdAt,
    };
  },
};

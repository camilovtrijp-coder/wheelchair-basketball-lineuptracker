import type { FirestoreDataConverter, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';
import { assertNonEmptyString, assertTimestamp } from './validation.js';

const TYPE = 'team';

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
      name: assertNonEmptyString(TYPE, 'name', data.name),
      createdBy: assertNonEmptyString(TYPE, 'createdBy', data.createdBy),
      createdAt: assertTimestamp(TYPE, 'createdAt', data.createdAt),
    };
  },
};

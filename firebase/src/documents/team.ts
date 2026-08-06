import type { FirestoreDataConverter, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';
import { assertNonEmptyString, assertTimestamp } from './validation.js';

const TYPE = 'team';

/**
 * organizations/{orgId}/teams/{teamId}
 *
 * `orgName` is een bewuste denormalisatie (issue #31): een team-only lid (uitsluitend een
 * `teamMembers`-document, geen `organizationMembers`) mag de organisatie zelf niet lezen
 * (`organizations/{orgId}` blijft `allow read: if isOrgMember(orgId)`, bewust niet verbreed
 * naar alle ingelogde gebruikers) maar heeft via `canReadTeam` wél direct leestoegang tot dit
 * teamdocument. Zonder deze kopie zou de contextwisselaar voor zo'n gebruiker geen organisatie-
 * naam kunnen tonen. Geschreven bij team-create (zie createTeam()); niet bijgewerkt bij een
 * latere naamswijziging van de organisatie zelf — dat blijft buiten de scope van issue #31.
 */
export interface TeamDocument {
  name: string;
  orgName: string;
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
      orgName: assertNonEmptyString(TYPE, 'orgName', data.orgName),
      createdBy: assertNonEmptyString(TYPE, 'createdBy', data.createdBy),
      createdAt: assertTimestamp(TYPE, 'createdAt', data.createdAt),
    };
  },
};

// PR 8.3c-2b-i (docs/pr-8.3c-2b-plan.md §C.1): pure query- en padbouwers voor de eigen
// inventaris en de drie self-deletes. Bewust een eigen bestand ZONDER Auth en zonder
// converters: `FirestoreAccountGateway` gebruikt precies deze functies, en de
// Rules-test `firebase/tests/rules/account-gateway-queries.spec.ts` importeert ze om
// te bewijzen dat de ECHTE Security Rules de ECHTE queryvorm en paden beoordelen —
// zodat gateway en Rules niet ongemerkt uit elkaar kunnen lopen (zelfde patroon als
// `infrastructure/deletion/deletionRequestPayloads.ts`).
//
// Er komt GEEN nieuwe queryvorm bij: dit zijn exact de drie collectionGroup-queries uit
// firebase/docs/QUERY_CONTRACT.md. De uid/e-mail komen van de gateway uit de eigen
// Auth-sessie, nooit van een aanroeper buiten de infrastructuurlaag.
import {
  collectionGroup,
  doc,
  query,
  where,
  type DocumentReference,
  type Firestore,
  type Query,
} from 'firebase/firestore';

/** `collectionGroup('organizationMembers').where('uid', '==', eigenUid)` */
export function ownOrganizationMembershipsQuery(db: Firestore, uid: string): Query {
  return query(collectionGroup(db, 'organizationMembers'), where('uid', '==', uid));
}

/** `collectionGroup('teamMembers').where('uid', '==', eigenUid)` */
export function ownTeamMembershipsQuery(db: Firestore, uid: string): Query {
  return query(collectionGroup(db, 'teamMembers'), where('uid', '==', uid));
}

/** `collectionGroup('invitations').where('email', '==', eigenGeverifieerdEmail)` */
export function ownInvitationsQuery(db: Firestore, email: string): Query {
  return query(collectionGroup(db, 'invitations'), where('email', '==', email));
}

/** `organizations/{orgId}/teams/{teamId}/teamMembers/{eigenUid}` */
export function ownTeamMemberRef(
  db: Firestore,
  organizationId: string,
  teamId: string,
  uid: string,
): DocumentReference {
  return doc(db, 'organizations', organizationId, 'teams', teamId, 'teamMembers', uid);
}

/** `organizations/{orgId}/organizationMembers/{eigenUid}` */
export function ownOrganizationMemberRef(
  db: Firestore,
  organizationId: string,
  uid: string,
): DocumentReference {
  return doc(db, 'organizations', organizationId, 'organizationMembers', uid);
}

/** `organizations/{orgId}/invitations/{invitationId}` — van een EIGEN uitnodiging uit de inventaris. */
export function ownInvitationRef(
  db: Firestore,
  organizationId: string,
  invitationId: string,
): DocumentReference {
  return doc(db, 'organizations', organizationId, 'invitations', invitationId);
}

interface WithPath {
  ref: { path: string };
}

function segments(snapshot: WithPath): string[] {
  return snapshot.ref.path.split('/');
}

/**
 * De organisatie-ID uit het documentpad van een collectionGroup-resultaat
 * (`organizations/{orgId}/organizationMembers|invitations/{id}` of
 * `organizations/{orgId}/teams/{teamId}/teamMembers/{uid}`). `null` voor elk ander
 * pad: een collectionGroup-query matcht elke collectie met die naam, ook buiten
 * `organizations/`; de gateway behandelt `null` als leesfout (fail closed).
 */
export function organizationIdOf(snapshot: WithPath): string | null {
  const parts = segments(snapshot);
  if (parts[0] !== 'organizations' || !parts[1]) return null;
  if (parts.length === 4 && (parts[2] === 'organizationMembers' || parts[2] === 'invitations')) {
    return parts[1];
  }
  if (parts.length === 6 && parts[2] === 'teams' && parts[3] && parts[4] === 'teamMembers') {
    return parts[1];
  }
  return null;
}

/** De team-ID uit `organizations/{orgId}/teams/{teamId}/teamMembers/{uid}`, anders `null`. */
export function teamIdOf(snapshot: WithPath): string | null {
  const parts = segments(snapshot);
  if (
    parts.length === 6 &&
    parts[0] === 'organizations' &&
    parts[1] &&
    parts[2] === 'teams' &&
    parts[3] &&
    parts[4] === 'teamMembers'
  ) {
    return parts[3];
  }
  return null;
}

// PR 8.3c-2b-iii (docs/pr-8.3c-2b-plan.md §B.3, §C.3): pure pad- en payloadbouwers voor
// de overdracht van het eigenaarschap en het intrekken van uitnodigingen. Bewust een eigen
// bestand ZONDER Auth: `FirestoreOwnershipTransferGateway` bouwt ELK pad en elke patch via
// deze functies, en de Rules-/emulatortest
// `firebase/tests/rules/ownership-transfer-gateway.spec.ts` importeert ze om te bewijzen
// dat de ECHTE Rules precies deze paden en patches beoordelen (zelfde patroon als
// `accountQueries.ts` en `deletion/deletionRequestPayloads.ts`).
//
// Er komt GEEN nieuwe queryvorm bij: alleen ongefilterde listings van één organisatie
// (`organizationMembers`, `invitations`, `teams` — de bewezen 8.3b-exportvorm) en directe
// documentpaden. Geen collectionGroup-query.
import {
  collection,
  doc,
  serverTimestamp,
  type CollectionReference,
  type DocumentReference,
  type FieldValue,
  type Firestore,
} from 'firebase/firestore';

/** `organizations/{orgId}/organizationMembers` — ongefilterd, `isOrgMember(orgId)`. */
export function organizationMembersCollection(
  db: Firestore,
  organizationId: string,
): CollectionReference {
  return collection(db, 'organizations', organizationId, 'organizationMembers');
}

/** `organizations/{orgId}/organizationMembers/{uid}` */
export function organizationMemberRef(
  db: Firestore,
  organizationId: string,
  uid: string,
): DocumentReference {
  return doc(db, 'organizations', organizationId, 'organizationMembers', uid);
}

/** `organizations/{orgId}/invitations` — ongefilterd, `isOrgOwnerOrAdmin(orgId)`. */
export function organizationInvitationsCollection(
  db: Firestore,
  organizationId: string,
): CollectionReference {
  return collection(db, 'organizations', organizationId, 'invitations');
}

/** `organizations/{orgId}/invitations/{invitationId}` */
export function organizationInvitationRef(
  db: Firestore,
  organizationId: string,
  invitationId: string,
): DocumentReference {
  return doc(db, 'organizations', organizationId, 'invitations', invitationId);
}

/** `organizations/{orgId}/teams` — ongefilterd, `canReadTeam` via `isOrgMember(orgId)`. */
export function organizationTeamsCollection(
  db: Firestore,
  organizationId: string,
): CollectionReference {
  return collection(db, 'organizations', organizationId, 'teams');
}

/** `organizations/{orgId}/teams/{teamId}/teamMembers/{uid}` */
export function teamMemberRef(
  db: Firestore,
  organizationId: string,
  teamId: string,
  uid: string,
): DocumentReference {
  return doc(db, 'organizations', organizationId, 'teams', teamId, 'teamMembers', uid);
}

/**
 * Promotie: ALLEEN het veld `role`. De owner-updateregel eist een ongewijzigd `uid`-veld;
 * een partiële update laat `uid`, `email` en de rest ongemoeid.
 */
export function promoteToOwnerPatch(): { role: 'organizationOwner' } {
  return { role: 'organizationOwner' };
}

/**
 * Intrekken: precies `status` en `revokedAt` (Rules: `affectedKeys().hasOnly(['status',
 * 'revokedAt'])`, `revokedAt == request.time`, alleen vanuit `pending`/`accepted`).
 */
export function revokeInvitationPatch(): { status: 'revoked'; revokedAt: FieldValue } {
  return { status: 'revoked', revokedAt: serverTimestamp() };
}

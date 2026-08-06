import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import {
  invitationConverter,
  organizationConverter,
  organizationMemberConverter,
  teamConverter,
  teamMemberConverter,
} from 'firebase-base/documents';
import type { Invitation } from '../../domain/invitations/types';
import type { Membership, OrganizationRole, TeamSummary } from '../../domain/organizations/types';
import { deriveTeamAccess, type TeamAccess } from '../../domain/organizations/teamAccess';
import type {
  OperationResult,
  OrganizationGateway,
} from '../../application/organizations/OrganizationGateway';
import { firebaseErrorCode } from '../firebase/errors';

// Padopbouwers. Bewust ZONDER .withConverter() — die wordt alleen bij reads
// toegepast (zie de *_converter-imports), niet bij writes: serverTimestamp()
// retourneert een FieldValue, geen Timestamp, en zou dus niet door de
// leesgerichte converter-typen heen passen.
function orgRef(db: Firestore, orgId: string) {
  return doc(db, 'organizations', orgId);
}
function memberRef(db: Firestore, orgId: string, uid: string) {
  return doc(db, 'organizations', orgId, 'organizationMembers', uid);
}
function teamsCollectionRef(db: Firestore, orgId: string) {
  return collection(db, 'organizations', orgId, 'teams');
}
function teamMemberRef(db: Firestore, orgId: string, teamId: string, uid: string) {
  return doc(db, 'organizations', orgId, 'teams', teamId, 'teamMembers', uid);
}
function invitationRef(db: Firestore, orgId: string, invitationId: string) {
  return doc(db, 'organizations', orgId, 'invitations', invitationId);
}

function toOperationResult(error: unknown): OperationResult<never> {
  return { ok: false, errorCode: firebaseErrorCode(error) };
}

export class FirestoreOrganizationGateway implements OrganizationGateway {
  constructor(
    private readonly db: Firestore,
    private readonly ownUid: string,
    private readonly ownEmail: string,
  ) {}

  async listMyMemberships(): Promise<Membership[]> {
    // De enige toegestane query — exact zoals firebase/docs/QUERY_CONTRACT.md
    // voorschrijft. Elke andere vorm wordt door de Rules geweigerd.
    const membershipQuery = query(
      collectionGroup(this.db, 'organizationMembers'),
      where('uid', '==', this.ownUid),
    ).withConverter(organizationMemberConverter);
    const snapshot = await getDocs(membershipQuery);

    const memberships: Membership[] = [];
    for (const memberSnapshot of snapshot.docs) {
      const orgId = memberSnapshot.ref.parent.parent?.id;
      if (!orgId) continue;
      const orgSnapshot = await getDoc(orgRef(this.db, orgId).withConverter(organizationConverter));
      if (!orgSnapshot.exists()) continue;
      memberships.push({
        orgId,
        orgName: orgSnapshot.data().name,
        role: memberSnapshot.data().role,
      });
    }
    return memberships;
  }

  async createOrganizationWithOwner(name: string): Promise<OperationResult<{ orgId: string }>> {
    // Bewust GEEN writeBatch: firestore.rules' bootstrap-create-regel voor
    // organizationMembers gebruikt `get(orgRef)` (niet `getAfter()`) om
    // `createdBy` te controleren, en ziet daardoor alleen al vóór deze
    // aanvraag gecommitte documenten. Batchen van beide writes zou de
    // membership-create dus altijd laten falen. Zie
    // firebase/tests/rules/bootstrap-and-invitation-flow.spec.ts, waar
    // exact dezelfde twee sequentiële writes al bewezen zijn.
    try {
      const newOrgRef = doc(collection(this.db, 'organizations'));
      await setDoc(newOrgRef, { name, createdBy: this.ownUid, createdAt: serverTimestamp() });
      const newMemberRef = memberRef(this.db, newOrgRef.id, this.ownUid);
      await setDoc(newMemberRef, {
        role: 'organizationOwner' satisfies OrganizationRole,
        email: this.ownEmail,
        uid: this.ownUid,
        joinedAt: serverTimestamp(),
      });
      return { ok: true, value: { orgId: newOrgRef.id } };
    } catch (error) {
      return toOperationResult(error);
    }
  }

  async createTeam(orgId: string, name: string): Promise<OperationResult<{ teamId: string }>> {
    try {
      const newTeamRef = doc(teamsCollectionRef(this.db, orgId));
      await setDoc(newTeamRef, { name, createdBy: this.ownUid, createdAt: serverTimestamp() });
      return { ok: true, value: { teamId: newTeamRef.id } };
    } catch (error) {
      return toOperationResult(error);
    }
  }

  async listTeams(orgId: string): Promise<TeamSummary[]> {
    const snapshot = await getDocs(teamsCollectionRef(this.db, orgId).withConverter(teamConverter));
    return snapshot.docs.map((teamSnapshot) => ({
      teamId: teamSnapshot.id,
      name: teamSnapshot.data().name,
    }));
  }

  async getMyTeamAccess(
    orgId: string,
    teamId: string,
    orgRole: OrganizationRole,
  ): Promise<TeamAccess> {
    const snapshot = await getDoc(
      teamMemberRef(this.db, orgId, teamId, this.ownUid).withConverter(teamMemberConverter),
    );
    const teamMemberRole = snapshot.exists() ? snapshot.data().role : null;
    return deriveTeamAccess(orgRole, teamMemberRole);
  }

  async getInvitationByLink(orgId: string, invitationId: string): Promise<Invitation | null> {
    try {
      const snapshot = await getDoc(
        invitationRef(this.db, orgId, invitationId).withConverter(invitationConverter),
      );
      if (!snapshot.exists()) return null;
      const data = snapshot.data();
      return { orgId, invitationId, email: data.email, role: data.role, status: data.status };
    } catch {
      // Rules weigeren lezen even hard als "bestaat niet" — hier bewust niet onderscheiden
      // om niet te lekken of een invitationId geldig is voor een niet-geautoriseerde gebruiker.
      return null;
    }
  }

  async acceptInvitation(orgId: string, invitationId: string): Promise<OperationResult> {
    try {
      await updateDoc(invitationRef(this.db, orgId, invitationId), {
        status: 'accepted',
        acceptedAt: serverTimestamp(),
      });
      return { ok: true };
    } catch (error) {
      return toOperationResult(error);
    }
  }

  async claimInvitation(invitation: Invitation): Promise<OperationResult> {
    try {
      const batch = writeBatch(this.db);
      batch.set(memberRef(this.db, invitation.orgId, this.ownUid), {
        role: invitation.role,
        email: invitation.email,
        uid: this.ownUid,
        invitationId: invitation.invitationId,
        joinedAt: serverTimestamp(),
      });
      batch.update(invitationRef(this.db, invitation.orgId, invitation.invitationId), {
        status: 'claimed',
        claimedAt: serverTimestamp(),
      });
      await batch.commit();
      return { ok: true };
    } catch (error) {
      return toOperationResult(error);
    }
  }
}

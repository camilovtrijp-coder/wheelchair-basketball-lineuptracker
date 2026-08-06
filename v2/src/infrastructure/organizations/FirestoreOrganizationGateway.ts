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
function teamRef(db: Firestore, orgId: string, teamId: string) {
  return doc(db, 'organizations', orgId, 'teams', teamId);
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

  /**
   * `resumeOrgId` maakt dit herstelbaar i.p.v. atomair: de twee writes kunnen
   * niet gebatcht worden (zie hieronder), dus een mislukking tussen beide in
   * laat een organisatie zonder owner-membership achter — die kan de
   * gebruiker zelf niet meer opruimen (Rules eisen een membership om te
   * mogen verwijderen). Geef bij een retry het `orgId` uit een eerdere
   * mislukte poging door (zie `value` in het `OperationResult` hieronder,
   * ook bij `ok:false`) zodat alleen de ontbrekende membership-write
   * herhaald wordt i.p.v. een tweede, wees geworden organisatie aan te
   * maken. `setDoc` op hetzelfde pad is idempotent, dus herhaling van een
   * al geslaagde stap is altijd veilig.
   */
  async createOrganizationWithOwner(
    name: string,
    resumeOrgId?: string,
  ): Promise<OperationResult<{ orgId: string }>> {
    // Bewust GEEN writeBatch: firestore.rules' bootstrap-create-regel voor
    // organizationMembers gebruikt `get(orgRef)` (niet `getAfter()`) om
    // `createdBy` te controleren, en ziet daardoor alleen al vóór deze
    // aanvraag gecommitte documenten. Batchen van beide writes zou de
    // membership-create dus altijd laten falen. Zie
    // firebase/tests/rules/bootstrap-and-invitation-flow.spec.ts, waar
    // exact dezelfde twee sequentiële writes al bewezen zijn.
    let orgId = resumeOrgId;
    try {
      if (!orgId) {
        const newOrgRef = doc(collection(this.db, 'organizations'));
        await setDoc(newOrgRef, { name, createdBy: this.ownUid, createdAt: serverTimestamp() });
        orgId = newOrgRef.id;
      } else {
        // Hervatting: als de membership er al staat — bijv. omdat de vorige poging server-side
        // wél slaagde maar de bevestiging de client nooit bereikte (netwerkonderbreking net
        // daarna) — is er niets meer te doen. Rules zien een herhaalde `setDoc` op een reeds
        // bestaand document als een 'update' (geen matchende Rule voor het aanpassen van je
        // eigen membership), dus zonder deze check zou zo'n herhaling ten onrechte falen.
        // `getDoc` op een NOG NIET bestaand eigen membership-document wordt zelf ook geweigerd
        // (de leesregel `isOrgMember(orgId)` vereist dat het doc al bestaat om het te mogen
        // lezen — een kip-en-ei-situatie) — permission-denied betekent hier dus specifiek "dit
        // membership bestaat nog niet", niet "onbekende fout": val terug op de create-poging.
        try {
          const existingMember = await getDoc(memberRef(this.db, orgId, this.ownUid));
          if (existingMember.exists()) {
            return { ok: true, value: { orgId } };
          }
        } catch {
          // Bestaat nog niet — ga door naar de create-poging hieronder.
        }
      }
      const newMemberRef = memberRef(this.db, orgId, this.ownUid);
      await setDoc(newMemberRef, {
        role: 'organizationOwner' satisfies OrganizationRole,
        email: this.ownEmail,
        uid: this.ownUid,
        joinedAt: serverTimestamp(),
      });
      return { ok: true, value: { orgId } };
    } catch (error) {
      return { ...toOperationResult(error), value: orgId ? { orgId } : undefined };
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

  /**
   * Hervalideert een eerder gekozen (bijv. uit localStorage herstelde) context: bestaat het
   * team nog, en heeft deze gebruiker er nog aantoonbaar toegang toe (owner/admin impliciet,
   * anders een expliciet teamMembers-document)? `deriveAppState` gebruikt dit om ook
   * team-niveau-intrekking te detecteren — puur organisatielidmaatschap alleen (het eerdere
   * gedrag) miste een ingetrokken, verwijderd of via localStorage vervalst `teamId`.
   *
   * Bij een genuine online controle gooien deze reads nooit een fout: zodra het
   * organisatiemembership al bevestigd is (voorwaarde om deze functie aan te roepen), staat
   * `canReadTeam`/de eigen-membership-leesregel altijd toe — "bestaat niet (meer)" en "geen
   * expliciete teamMembers-rol" komen terug als een schone, foutloze `false`, niet als een
   * exception. Een exception hier betekent dus specifiek "geen (cache-)antwoord beschikbaar"
   * (bijv. offline zonder gecachete respons voor dit specifieke document) — dat NIET als
   * "ingetrokken" behandelen zou een eerder geldige, gecachete context bij elke offline reload
   * laten afketsen, in strijd met ADR-002's offline-first-uitgangspunt. Fail open (nog geldig
   * totdat het tegendeel online bewezen is), net als `listMyMemberships()`'s netwerkfout-pad
   * hierboven `memberships` op `null` laat i.p.v. op een lege lijst te zetten.
   */
  async validateSelectedTeam(
    orgId: string,
    teamId: string,
    orgRole: OrganizationRole,
  ): Promise<boolean> {
    try {
      const teamSnapshot = await getDoc(
        teamRef(this.db, orgId, teamId).withConverter(teamConverter),
      );
      if (!teamSnapshot.exists()) return false;
      const access = await this.getMyTeamAccess(orgId, teamId, orgRole);
      return access.isExplicitlyAuthorized;
    } catch {
      return true;
    }
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

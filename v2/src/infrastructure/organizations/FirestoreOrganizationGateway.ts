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
import type {
  Membership,
  OrganizationRole,
  TeamOnlyContext,
  TeamSummary,
} from '../../domain/organizations/types';
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
   * De andere toegestane query (issue #31): teams waar deze gebruiker via een expliciet
   * `teamMembers`-document toegang toe heeft, ONAFHANKELIJK van `organizationMembers` — nodig
   * voor gebruikers zonder enig `organizationMembers`-document in die organisatie (bijv. een
   * puur team-only coach/scorer/viewer). `memberSnapshot.ref.parent.parent` is direct de
   * `teams/{teamId}`-documentref (twee niveaus boven een `teamMembers`-document); die read is
   * toegestaan via `canReadTeam`'s `isTeamMember`-tak, ook zonder organizationMembers-document.
   * Organisatienaam komt van het gedenormaliseerde `orgName`-veld op het teamdocument, NIET van
   * een rechtstreekse `organizations/{orgId}`-read — die blijft `isOrgMember`-only (zie
   * firebase/docs/QUERY_CONTRACT.md).
   */
  async listMyTeamOnlyContexts(): Promise<TeamOnlyContext[]> {
    const teamMembershipQuery = query(
      collectionGroup(this.db, 'teamMembers'),
      where('uid', '==', this.ownUid),
    ).withConverter(teamMemberConverter);
    const snapshot = await getDocs(teamMembershipQuery);

    const contexts: TeamOnlyContext[] = [];
    for (const memberSnapshot of snapshot.docs) {
      const teamDocRef = memberSnapshot.ref.parent.parent;
      const orgId = teamDocRef?.parent.parent?.id;
      if (!teamDocRef || !orgId) continue;
      const teamSnapshot = await getDoc(teamDocRef.withConverter(teamConverter));
      if (!teamSnapshot.exists()) continue;
      contexts.push({
        orgId,
        orgName: teamSnapshot.data().orgName,
        teamId: teamDocRef.id,
        teamName: teamSnapshot.data().name,
        role: memberSnapshot.data().role,
      });
    }
    return contexts;
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
        // `doc()` genereert het ID client-side, synchroon — vóór de `await` toewijzen (i.p.v.
        // pas na een geslaagde write) is precies wat dit pad herstelbaar maakt: als de server de
        // write wél commit maar de bevestiging de client nooit bereikt (netwerkonderbreking net
        // daarna), reject de promise, maar `orgId` staat dan al vast en komt alsnog terug in
        // `value` via de catch hieronder — een retry kan zo hervatten i.p.v. een tweede,
        // wees geworden organisatie aan te maken.
        const newOrgRef = doc(collection(this.db, 'organizations'));
        orgId = newOrgRef.id;
        await setDoc(newOrgRef, { name, createdBy: this.ownUid, createdAt: serverTimestamp() });
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
      // Denormaliseer de organisatienaam op het teamdocument (issue #31): team-only leden
      // kunnen `organizations/{orgId}` niet lezen (die regel blijft bewust `isOrgMember`-only),
      // maar hebben via `canReadTeam` altijd al leestoegang tot hun eigen team.
      const orgSnapshot = await getDoc(orgRef(this.db, orgId).withConverter(organizationConverter));
      if (!orgSnapshot.exists()) {
        return { ok: false, errorCode: 'not-found' };
      }
      const newTeamRef = doc(teamsCollectionRef(this.db, orgId));
      await setDoc(newTeamRef, {
        name,
        orgName: orgSnapshot.data().name,
        createdBy: this.ownUid,
        createdAt: serverTimestamp(),
      });
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
    orgRole: OrganizationRole | null,
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
   * anders een expliciet teamMembers-document)? `deriveAppState` gebruikt `valid` om ook
   * team-niveau-intrekking te detecteren — puur organisatielidmaatschap alleen (het eerdere
   * gedrag) miste een ingetrokken, verwijderd of via localStorage vervalst `teamId`.
   * `canManageTeamData` wordt door AuthGate doorgegeven aan `App`/`SettingsPanel`/`RosterPanel`
   * om de UI-schrijfknoppen te hiden/disablen voor rollen die geen teamdata mogen bewerken
   * (spiegelt firestore.rules' canManageTeamData/teamRole exact — zie PR 5.4a).
   * `canWriteGameData` doet hetzelfde voor `GameSetupPanel`/`LiveTrackingPanel` (PR
   * 6.1-review, aug. 2026) — een `scorer` mag wél wedstrijdacties uitvoeren zonder
   * roster/instellingen te mogen bewerken. Beide worden in dezelfde call afgeleid als `valid`
   * (uit dezelfde getMyTeamAccess()-read), dus zonder extra Firestore-read.
   *
   * Bij een genuine online controle gooien deze reads nooit een fout: zodra het
   * organisatiemembership al bevestigd is (voorwaarde om deze functie aan te roepen), staat
   * `canReadTeam`/de eigen-membership-leesregel altijd toe — "bestaat niet (meer)" en "geen
   * expliciete teamMembers-rol" komen terug als een schone, foutloze `false`, niet als een
   * exception. Een exception hier betekent dus specifiek "geen (cache-)antwoord beschikbaar"
   * (bijv. offline zonder gecachete respons voor dit specifieke document) — dat NIET als
   * "ingetrokken" behandelen zou een eerder geldige, gecachete context bij elke offline reload
   * laten afketsen, in strijd met ADR-002's offline-first-uitgangspunt. Fail open voor `valid`
   * (nog geldig totdat het tegendeel online bewezen is), maar conservatief `false` voor
   * `canManageTeamData`/`canWriteGameData` — we verlenen geen UI-schrijftoegang als we de rol
   * niet kunnen bevestigen. De backend Rules handhaven de echte authorisatie sowieso; een
   * eventuele write-poging via een onjuist-positieve UI-state zou als `actie-nodig` eindigen.
   */
  async validateSelectedTeam(
    orgId: string,
    teamId: string,
    orgRole: OrganizationRole | null,
  ): Promise<{ valid: boolean; canManageTeamData: boolean; canWriteGameData: boolean }> {
    try {
      const teamSnapshot = await getDoc(
        teamRef(this.db, orgId, teamId).withConverter(teamConverter),
      );
      if (!teamSnapshot.exists()) {
        return { valid: false, canManageTeamData: false, canWriteGameData: false };
      }
      const access = await this.getMyTeamAccess(orgId, teamId, orgRole);
      return {
        valid: access.isExplicitlyAuthorized,
        canManageTeamData: access.canManageTeamData,
        canWriteGameData: access.canWriteGameData,
      };
    } catch {
      return { valid: true, canManageTeamData: false, canWriteGameData: false };
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

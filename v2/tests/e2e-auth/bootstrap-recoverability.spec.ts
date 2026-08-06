import { test, expect } from '@playwright/test';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  setDoc,
} from 'firebase/firestore';
import { FirestoreOrganizationGateway } from '../../src/infrastructure/organizations/FirestoreOrganizationGateway';
import { uniqueTestEmail } from './helpers';

// PR 5.2-reviewbevinding [P1]: org- en owner-membership-write kunnen niet gebatcht worden (zie
// FirestoreOrganizationGateway.createOrganizationWithOwner's toelichting — de bootstrap-Rules
// gebruiken get(), niet getAfter()), dus een mislukking tussen beide writes in laat een
// organisatie zonder membership achter. Zonder membership kan de gebruiker die organisatie
// zelf niet meer verwijderen (Rules eisen een membership om te mogen deleten) — een blijvende
// weesorganisatie. Deze test bewijst rechtstreeks tegen de gateway (geen browser-UI nodig) dat
// een resume met het bekende orgId zo'n orphan herstelt i.p.v. een tweede organisatie aan te
// maken, en dat herhaling van dezelfde resume-aanroep veilig is (idempotent).
test.describe('bootstrap van de eerste organisatie is herstelbaar na een gedeeltelijke mislukking', () => {
  test('een resumeOrgId herstelt een organisatie zonder membership i.p.v. een tweede aan te maken', async () => {
    const app = initializeApp(
      {
        projectId: 'demo-lineup-tracker-dev',
        apiKey: 'demo-key',
        authDomain: 'demo-lineup-tracker-dev.firebaseapp.com',
      },
      `bootstrap-recoverability-${Date.now()}`,
    );
    const auth = getAuth(app);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const db = getFirestore(app);
    connectFirestoreEmulator(db, '127.0.0.1', 8080);

    const email = uniqueTestEmail('bootstrap-resume');
    const password = 'Bootstrap123!';
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;

    const gateway = new FirestoreOrganizationGateway(db, uid, email);

    // Simuleert de precondite van een gedeeltelijk mislukte eerste poging: de organisatie
    // bestaat al (createdBy == deze gebruiker), maar de owner-membership ontbreekt nog —
    // exact wat overblijft als alleen de org-write slaagde en de membership-write faalde.
    const orphanOrgRef = doc(collection(db, 'organizations'));
    await setDoc(orphanOrgRef, { name: 'Orphan Org', createdBy: uid, createdAt: new Date() });

    const result = await gateway.createOrganizationWithOwner('Orphan Org', orphanOrgRef.id);
    expect(result.ok).toBe(true);
    expect(result.value?.orgId).toBe(orphanOrgRef.id);

    const memberSnapshot = await getDoc(
      doc(db, 'organizations', orphanOrgRef.id, 'organizationMembers', uid),
    );
    expect(memberSnapshot.exists()).toBe(true);
    expect(memberSnapshot.data()?.role).toBe('organizationOwner');

    // Herhaling van dezelfde resume-aanroep (bijv. een dubbelklik, of een retry na een trage/
    // tijdelijke netwerkfout ondanks dat de eerste poging al aankwam) moet veilig zijn: geen
    // tweede organisatie, geen fout — setDoc op hetzelfde pad is idempotent.
    const secondResult = await gateway.createOrganizationWithOwner('Orphan Org', orphanOrgRef.id);
    expect(secondResult.ok).toBe(true);
    expect(secondResult.value?.orgId).toBe(orphanOrgRef.id);
  });

  // Herreviewbevinding [P1] op 435239d: `orgId` werd pas ná de `await setDoc(...)` toegewezen,
  // dus als de ALLEREERSTE write zelf faalt (bijv. de servercommit lukt maar de bevestiging
  // gaat door een netwerkonderbreking verloren, of — zoals hier reproduceerbaar gemaakt — de
  // write wordt door Rules geweigerd) kreeg de aanroeper geen `orgId` terug om een retry op te
  // laten hervatten, en zou een volgende poging alsnog een tweede organisatie aanmaken. Deze
  // test forceert een deterministische, echte weigering van de EERSTE write (org-create-Rule
  // `createdBy == request.auth.uid`) door de gateway met een UID te construeren die niet
  // overeenkomt met de daadwerkelijk ingelogde gebruiker, en bewijst dat `orgId` desondanks al
  // in het resultaat zit (client-side gegenereerd vóór de write, niet pas erna).
  test('als de allereerste (org-create) write zelf faalt, staat het client-side gegenereerde orgId toch al in het resultaat', async () => {
    const app = initializeApp(
      {
        projectId: 'demo-lineup-tracker-dev',
        apiKey: 'demo-key',
        authDomain: 'demo-lineup-tracker-dev.firebaseapp.com',
      },
      `bootstrap-recoverability-firstwrite-${Date.now()}`,
    );
    const auth = getAuth(app);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const db = getFirestore(app);
    connectFirestoreEmulator(db, '127.0.0.1', 8080);

    const email = uniqueTestEmail('bootstrap-firstwrite');
    const password = 'Bootstrap123!';
    await createUserWithEmailAndPassword(auth, email, password);

    // Bewust een UID die niet overeenkomt met de echt ingelogde gebruiker: de org-create-Rule
    // (`request.resource.data.createdBy == request.auth.uid`) wijst de write dan gegarandeerd
    // af, ongeacht enige emulator-timing — een deterministische stand-in voor "de eerste write
    // faalt", zonder afhankelijk te zijn van een genuine netwerkonderbreking.
    const gateway = new FirestoreOrganizationGateway(db, 'uid-mismatched-not-the-real-user', email);
    const result = await gateway.createOrganizationWithOwner('Never Fully Created');

    expect(result.ok).toBe(false);
    expect(result.value?.orgId).toBeDefined();
  });
});

// Genuine tweede-client-lezer voor e2e-tests (PR 7.1c-reviewopvolging op
// PR #56): een onafhankelijke `firebase/app`-instantie met een eigen
// Auth-sessie (echte `signInWithEmailAndPassword` tegen de Auth-emulator),
// die via de ECHTE client-`firebase/firestore`-SDK leest — dus met
// firestore.rules gehandhaafd (`canReadTeam`), in tegenstelling tot
// `adminFixtures.ts`'s `adminDb()` die Rules bewust omzeilt. Draait in het
// Playwright Node-testproces (geen browser nodig) — de client-SDK's
// `firebase/app`/`firebase/auth`/`firebase/firestore` werken hier prima
// tegen de emulator; alleen `firebase-admin/auth` had het module-
// linkingprobleem dat adminFixtures.ts documenteert, niet deze pakketten.
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  terminate,
  type Firestore,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-lineup-tracker-dev';

let counter = 0;

export interface SecondClient {
  db: Firestore;
  close(): Promise<void>;
}

/**
 * Verbindt als een onafhankelijke, echt ingelogde tweede client (elk apart
 * apparaat/sessie krijgt een eigen genoemde FirebaseApp-instantie, zodat
 * meerdere tweede-clients in dezelfde testrun elkaar niet overschrijven).
 */
export async function connectAsSecondClient(
  email: string,
  password: string,
): Promise<SecondClient> {
  counter += 1;
  const app: FirebaseApp = initializeApp(
    { projectId: PROJECT_ID, apiKey: 'demo-key' },
    `second-client-${Date.now()}-${counter}`,
  );

  const auth = getAuth(app);
  connectAuthEmulator(
    auth,
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'}`,
    { disableWarnings: true },
  );
  await signInWithEmailAndPassword(auth, email, password);

  const [emulatorHost, emulatorPort] = (
    process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'
  ).split(':');
  const db = getFirestore(app);
  connectFirestoreEmulator(db, emulatorHost!, Number(emulatorPort));

  return {
    db,
    close: async () => {
      await terminate(db);
      await deleteApp(app);
    },
  };
}

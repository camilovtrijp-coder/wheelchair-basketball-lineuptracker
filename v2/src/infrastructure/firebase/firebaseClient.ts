// Firebase-clientbootstrap voor v2/. Draait in deze PR uitsluitend tegen de
// Firebase Emulator Suite (zelfde project-ID/poorten als firebase/firebase.json)
// — een echt GCP-/Firebase-project komt pas met PR 5.5 (Netlify-staging).
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  clearIndexedDbPersistence,
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentSingleTabManager,
  terminate,
  type Firestore,
  type FirestoreLocalCache,
} from 'firebase/firestore';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';

const FIREBASE_PROJECT_ID = 'demo-lineup-tracker-dev';
const EMULATOR_HOST = '127.0.0.1';
const FIRESTORE_EMULATOR_PORT = 8080;
const AUTH_EMULATOR_URL = 'http://127.0.0.1:9099';

let app: FirebaseApp | undefined;
let db: Firestore | undefined;
let auth: Auth | undefined;

/**
 * Zuivere, los-testbare vertaling van de vertrouwd-apparaatkeuze naar een
 * Firestore-cachemodus. `persistentSingleTabManager` per ADR-002
 * (productievoorkeur); alleen de spike gebruikte de multiple-tab-variant
 * omdat Web Locks in headless-Chromium-CI kon hangen.
 */
export function resolveLocalCacheMode(trusted: boolean): FirestoreLocalCache {
  return trusted
    ? persistentLocalCache({ tabManager: persistentSingleTabManager(undefined) })
    : memoryLocalCache();
}

function ensureApp(): FirebaseApp {
  if (app) return app;
  app = initializeApp({
    projectId: FIREBASE_PROJECT_ID,
    apiKey: 'demo-key',
    authDomain: `${FIREBASE_PROJECT_ID}.firebaseapp.com`,
  });
  return app;
}

function createFirestore(firebaseApp: FirebaseApp, trusted: boolean): Firestore {
  const firestore = initializeFirestore(firebaseApp, {
    localCache: resolveLocalCacheMode(trusted),
    experimentalForceLongPolling: true,
  });
  connectFirestoreEmulator(firestore, EMULATOR_HOST, FIRESTORE_EMULATOR_PORT);
  return firestore;
}

/**
 * Idempotente eerste initialisatie. De cachemodus staat vast tot een
 * volgende `reinitFirestoreForTrustLevel()` — moet dus vóór de eerste
 * Firestore-read bekend zijn (zie de vertrouwd-apparaatprompt).
 */
export function initFirebase(trusted: boolean): { db: Firestore; auth: Auth } {
  if (db && auth) return { db, auth };

  const firebaseApp = ensureApp();
  db = createFirestore(firebaseApp, trusted);

  auth = getAuth(firebaseApp);
  connectAuthEmulator(auth, AUTH_EMULATOR_URL, { disableWarnings: true });

  return { db, auth };
}

export function getFirebaseAuth(): Auth {
  if (!auth) {
    throw new Error('Firebase is niet geïnitialiseerd — roep eerst initFirebase() aan.');
  }
  return auth;
}

export function getFirestoreDb(): Firestore {
  if (!db) {
    throw new Error('Firebase is niet geïnitialiseerd — roep eerst initFirebase() aan.');
  }
  return db;
}

/** Herinitialiseert Firestore met een nieuwe cachemodus als de gebruiker later van keuze wisselt. */
export async function reinitFirestoreForTrustLevel(trusted: boolean): Promise<void> {
  if (!db || !app) return;
  await terminate(db);
  db = createFirestore(app, trusted);
}

/** Wist lokale Firestore-data; alleen aanroepen ná terminate() (bijv. bij uitloggen op een niet-vertrouwd apparaat). */
export async function wipeLocalFirebaseData(): Promise<void> {
  if (!db) return;
  await terminate(db);
  await clearIndexedDbPersistence(db);
  db = undefined;
}

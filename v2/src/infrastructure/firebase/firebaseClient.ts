// Firebase-clientbootstrap voor v2/. Zonder `VITE_DEPLOY_CONTEXT` (huidige CI/
// dev-gedrag, ongewijzigd) draait dit uitsluitend tegen de Firebase Emulator
// Suite (zelfde project-ID/poorten als firebase/firebase.json). Sinds PR 5.5a
// bestaat er ook een code-pad voor staging/productie (zie webConfig.ts) — een
// echt GCP-/Firebase-project en een echte deploy komen pas met PR 5.5b.
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
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import {
  resolveAppCheckConfig,
  resolveDeployContext,
  resolveEmulatorConfig,
  resolveWebConfig,
  type DeployContext,
} from './webConfig';
import { diagnostics } from '../diagnostics/diagnostics';

let app: FirebaseApp | undefined;
let db: Firestore | undefined;
let auth: Auth | undefined;
let appCheck: AppCheck | undefined;
// Gezet vóór ensureApp()/createFirestore() in initFirebase(), dus altijd al
// bekend als die later alsnog gooien (bijv. ontbrekende staging-env-var) —
// reinitFirestoreForTrustLevel() bewaakt zich in dat geval al via `!db`.
let activeContext: DeployContext | undefined;

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

function ensureApp(context: DeployContext): FirebaseApp {
  if (app) return app;
  app = initializeApp(resolveWebConfig(context));
  return app;
}

function ensureAppCheck(firebaseApp: FirebaseApp, context: DeployContext): void {
  if (appCheck) return;
  const config = resolveAppCheckConfig(context);
  if (!config.enabled || !config.recaptchaEnterpriseSiteKey) return;

  try {
    appCheck = initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaEnterpriseProvider(config.recaptchaEnterpriseSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
    diagnostics.record({ area: 'firebase', code: 'app-check-monitoring-enabled' });
  } catch {
    // Monitor-only: een initialisatiefout mag de offline-first app nog niet
    // blokkeren zolang enforcement bewust uitstaat. Alleen een vaste,
    // privacyveilige code bewaren; nooit het ruwe SDK-errorobject.
    diagnostics.record({ area: 'firebase', code: 'app-check-initialization-failed' });
  }
}

function createFirestore(
  firebaseApp: FirebaseApp,
  trusted: boolean,
  context: DeployContext,
): Firestore {
  const firestore = initializeFirestore(firebaseApp, {
    localCache: resolveLocalCacheMode(trusted),
    experimentalForceLongPolling: true,
  });
  const emulator = resolveEmulatorConfig(context);
  if (emulator) {
    connectFirestoreEmulator(firestore, emulator.host, emulator.firestorePort);
  }
  return firestore;
}

/**
 * Idempotente eerste initialisatie. De cachemodus staat vast tot een
 * volgende `reinitFirestoreForTrustLevel()` — moet dus vóór de eerste
 * Firestore-read bekend zijn (zie de vertrouwd-apparaatprompt). `context`
 * bepaalt of er een emulator wordt aangesloten (alleen `development`, de
 * default zonder `VITE_DEPLOY_CONTEXT`) en welke webconfig wordt gebruikt.
 */
export function initFirebase(
  trusted: boolean,
  context: DeployContext = resolveDeployContext(),
): { db: Firestore; auth: Auth } {
  if (db && auth) return { db, auth };
  activeContext = context;

  const firebaseApp = ensureApp(context);
  ensureAppCheck(firebaseApp, context);
  db = createFirestore(firebaseApp, trusted, context);

  auth = getAuth(firebaseApp);
  const emulator = resolveEmulatorConfig(context);
  if (emulator) {
    connectAuthEmulator(auth, emulator.authUrl, { disableWarnings: true });
  }

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
  if (!db || !app || !activeContext) return;
  await terminate(db);
  db = createFirestore(app, trusted, activeContext);
}

/** Wist lokale Firestore-data; alleen aanroepen ná terminate() (bijv. bij uitloggen op een niet-vertrouwd apparaat). */
export async function wipeLocalFirebaseData(): Promise<void> {
  if (!db) return;
  await terminate(db);
  await clearIndexedDbPersistence(db);
  db = undefined;
}

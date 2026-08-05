// Gedeelde Firebase-initialisatie voor de browser-harness.
// ALLEEN vanuit browser-harness/ te gebruiken — vereist echte browser-IndexedDB voor
// persistentLocalCache. Vitest/Node-tests gebruiken @firebase/rules-unit-testing rechtstreeks.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  connectFirestoreEmulator,
  type Firestore,
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';

let _app: FirebaseApp | undefined;
let _db: Firestore | undefined;
let _auth: Auth | undefined;

export function initSpikeFirebase(): { db: Firestore; auth: Auth } {
  if (_db && _auth) return { db: _db, auth: _auth };

  _app = initializeApp({
    projectId: 'demo-lineup-tracker-spike',
    apiKey: 'demo-key',          // emulator-only, geen echt secret
    authDomain: 'demo-lineup-tracker-spike.firebaseapp.com',
  });

  // persistentLocalCache met default-tabmanager (persistentMultipleTabManager).
  // persistentSingleTabManager (ADR-002-voorkeur) gebruikt de Web Locks API die in headless
  // Chromium-omgevingen (CI / Playwright) kan hangen; de multiple-tab-variant werkt zonder locks.
  // In productie (één scorer, één tabblad) is er geen functioneel verschil: IndexedDB-persistentie
  // en de 4-statencontract zijn identiek; alleen concurrent multi-tab-behaviour verschilt.
  //
  // experimentalForceLongPolling: WebSocket/gRPC-web is onbetrouwbaar in headless-Chromium-omgevingen;
  // long-polling werkt overal via gewone HTTP.
  _db = initializeFirestore(_app, {
    localCache: persistentLocalCache(),
    experimentalForceLongPolling: true,
  });

  connectFirestoreEmulator(_db, '127.0.0.1', 8080);

  _auth = getAuth(_app);
  connectAuthEmulator(_auth, 'http://127.0.0.1:9099', { disableWarnings: true });

  return { db: _db, auth: _auth };
}

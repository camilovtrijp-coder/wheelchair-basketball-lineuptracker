// Firebase Admin-toegang voor e2e-auth-tests, om buiten de UI om testdata te
// seeden/muteren (bijv. een membership intrekken terwijl de UI actief is) —
// zelfde aanpak als firebase/scripts/seed.ts. Omzeilt bewust Security Rules.
//
// Bewust GEEN `firebase-admin/auth`: die module laadt via jwks-rsa een
// jose-submodule op een manier die Playwright Test's eigen modulelader niet
// kan linken ("request for './jwe/compact/decrypt.js' is from a module not
// been linked"). firebase-admin/app + firebase-admin/firestore laden wél
// probleemloos; voor de enige benodigde Auth-operatie (uid opzoeken op
// e-mailadres) gebruiken we in plaats daarvan de Auth-emulator rechtstreeks
// via diens REST-API.
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { generateKeyPairSync } from 'crypto';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

const PROJECT_ID = 'demo-lineup-tracker-dev';

let app: App | undefined;

function ensureAdminApp(): App {
  if (app) return app;
  const existing = getApps()[0];
  if (existing) {
    app = existing;
    return app;
  }
  // Wegwerp-RSA-sleutelpaar; de emulator verifieert geen handtekeningen (zie seed.ts).
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  app = initializeApp({
    projectId: PROJECT_ID,
    credential: cert({
      projectId: PROJECT_ID,
      clientEmail: `e2e-auth-test@${PROJECT_ID}.iam.gserviceaccount.com`,
      privateKey: pem,
    }),
  });
  return app;
}

export function adminDb(): Firestore {
  return getFirestore(ensureAdminApp());
}

/**
 * Haalt de uid op van een al aangemaakte (via de UI geregistreerde) gebruiker.
 * `accounts:lookup` (het admin-achtige "zoek op e-mailadres") vereist een
 * idToken/service-account-bearer, ook op de emulator — `demo-key` alleen is
 * niet genoeg (400 MISSING_ID_TOKEN). `accounts:signInWithPassword` is wél
 * de gewone CLIENT-inlogendpoint en accepteert `key=demo-key` zoals de
 * browser-SDK dat ook doet; omdat we het wachtwoord al kennen (de test heeft
 * het net zelf gekozen bij signUp), is dit de eenvoudigste betrouwbare manier
 * om de uid te achterhalen zonder de kapotte firebase-admin/auth-import.
 */
export async function lookupUidByEmail(email: string, password: string): Promise<string> {
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!response.ok) {
    throw new Error(`accounts:signInWithPassword mislukt (${response.status}) voor ${email}`);
  }
  const data = (await response.json()) as { localId?: string };
  if (!data.localId) {
    throw new Error(`Geen uid teruggekregen voor ${email}`);
  }
  return data.localId;
}

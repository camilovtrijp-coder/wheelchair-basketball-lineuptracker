import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Gedeelde spies over drie los gemockte SDK-modules — vi.hoisted() zodat ze
// bestaan vóór de (gehoiste) vi.mock()-aanroepen ze gebruiken.
const {
  initializeApp,
  initializeFirestore,
  connectFirestoreEmulator,
  terminate,
  clearIndexedDbPersistence,
  memoryLocalCache,
  persistentLocalCache,
  persistentSingleTabManager,
  getAuth,
  connectAuthEmulator,
} = vi.hoisted(() => ({
  initializeApp: vi.fn(() => ({ name: 'fake-app' })),
  initializeFirestore: vi.fn(() => ({ name: 'fake-firestore' })),
  connectFirestoreEmulator: vi.fn(),
  terminate: vi.fn(async () => {}),
  clearIndexedDbPersistence: vi.fn(async () => {}),
  memoryLocalCache: vi.fn(() => ({ kind: 'memory' })),
  persistentLocalCache: vi.fn(() => ({ kind: 'persistent' })),
  persistentSingleTabManager: vi.fn(() => ({})),
  getAuth: vi.fn(() => ({ name: 'fake-auth' })),
  connectAuthEmulator: vi.fn(),
}));

vi.mock('firebase/app', () => ({ initializeApp }));
vi.mock('firebase/firestore', () => ({
  initializeFirestore,
  connectFirestoreEmulator,
  terminate,
  clearIndexedDbPersistence,
  memoryLocalCache,
  persistentLocalCache,
  persistentSingleTabManager,
}));
vi.mock('firebase/auth', () => ({ getAuth, connectAuthEmulator }));

/** Verse modulestate nodig omdat firebaseClient.ts app/db/auth/context module-globaal bijhoudt. */
async function freshFirebaseClient() {
  vi.resetModules();
  return import('../../src/infrastructure/firebase/firebaseClient');
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('infrastructure/firebase/firebaseClient — contextgedrag', () => {
  it('development: verbindt de emulator en gebruikt exact de oude, hardcoded webconfig (regressie op het default-pad)', async () => {
    const { initFirebase } = await freshFirebaseClient();
    initFirebase(false, 'development');

    expect(initializeApp).toHaveBeenCalledWith({
      projectId: 'demo-lineup-tracker-dev',
      apiKey: 'demo-key',
      authDomain: 'demo-lineup-tracker-dev.firebaseapp.com',
    });
    expect(connectFirestoreEmulator).toHaveBeenCalledWith(expect.anything(), '127.0.0.1', 8080);
    expect(connectAuthEmulator).toHaveBeenCalledWith(expect.anything(), 'http://127.0.0.1:9099', {
      disableWarnings: true,
    });
  });

  it('default-aanroep zonder context-argument (zoals main.tsx/AuthGate.tsx die gebruiken) blijft development', async () => {
    const { initFirebase } = await freshFirebaseClient();
    initFirebase(true);

    expect(initializeApp).toHaveBeenCalledWith({
      projectId: 'demo-lineup-tracker-dev',
      apiKey: 'demo-key',
      authDomain: 'demo-lineup-tracker-dev.firebaseapp.com',
    });
    expect(connectFirestoreEmulator).toHaveBeenCalled();
  });

  it('staging: verbindt geen enkele emulator en gebruikt de staging-webconfig uit env', async () => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID_STAGING', 'lineup-tracker-staging');
    vi.stubEnv('VITE_FIREBASE_API_KEY_STAGING', 'staging-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN_STAGING', 'lineup-tracker-staging.firebaseapp.com');

    const { initFirebase } = await freshFirebaseClient();
    initFirebase(false, 'staging');

    expect(initializeApp).toHaveBeenCalledWith({
      projectId: 'lineup-tracker-staging',
      apiKey: 'staging-key',
      authDomain: 'lineup-tracker-staging.firebaseapp.com',
    });
    expect(connectFirestoreEmulator).not.toHaveBeenCalled();
    expect(connectAuthEmulator).not.toHaveBeenCalled();
  });

  it('productie: verbindt geen enkele emulator en gebruikt de productie-webconfig uit env', async () => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID_PRODUCTION', 'lineup-tracker-prod');
    vi.stubEnv('VITE_FIREBASE_API_KEY_PRODUCTION', 'prod-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN_PRODUCTION', 'lineup-tracker-prod.firebaseapp.com');

    const { initFirebase } = await freshFirebaseClient();
    initFirebase(false, 'production');

    expect(connectFirestoreEmulator).not.toHaveBeenCalled();
    expect(connectAuthEmulator).not.toHaveBeenCalled();
  });

  it('reinitFirestoreForTrustLevel onthoudt de actieve context: geen onbedoelde emulator-connectie in staging', async () => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID_STAGING', 'lineup-tracker-staging');
    vi.stubEnv('VITE_FIREBASE_API_KEY_STAGING', 'staging-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN_STAGING', 'lineup-tracker-staging.firebaseapp.com');

    const { initFirebase, reinitFirestoreForTrustLevel } = await freshFirebaseClient();
    initFirebase(false, 'staging');
    connectFirestoreEmulator.mockClear();
    initializeFirestore.mockClear();

    await reinitFirestoreForTrustLevel(true);

    expect(initializeFirestore).toHaveBeenCalledTimes(1);
    expect(connectFirestoreEmulator).not.toHaveBeenCalled();
  });

  it('reinitFirestoreForTrustLevel verbindt de emulator opnieuw wanneer de actieve context development is', async () => {
    const { initFirebase, reinitFirestoreForTrustLevel } = await freshFirebaseClient();
    initFirebase(false, 'development');
    connectFirestoreEmulator.mockClear();

    await reinitFirestoreForTrustLevel(true);

    expect(connectFirestoreEmulator).toHaveBeenCalledWith(expect.anything(), '127.0.0.1', 8080);
  });

  it('reinitFirestoreForTrustLevel is een veilige no-op vóór een geslaagde initFirebase', async () => {
    const { reinitFirestoreForTrustLevel } = await freshFirebaseClient();

    await expect(reinitFirestoreForTrustLevel(true)).resolves.toBeUndefined();
    expect(initializeFirestore).not.toHaveBeenCalled();
  });
});

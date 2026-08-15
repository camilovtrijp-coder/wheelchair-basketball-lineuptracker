// Losstaande, puur-testbare guard (uitgelicht uit seed.ts, PR
// 5.5b-activatievoorbereiding review-opvolging): `seed.ts` zelf voert bij
// import meteen firebase-admin-initialisatie uit en is dus niet zonder
// neveneffecten in een unit-test te importeren. Deze functie draagt alleen
// de voorwaarde, zodat de veiligheidsclaim ("seed.ts weigert zonder
// emulator-env-vars") door een echte test beschermd wordt tegen regressie,
// in plaats van alleen handmatig geverifieerd te zijn.
export function assertEmulatorEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.FIRESTORE_EMULATOR_HOST || !env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      'seed.ts weigert te draaien: FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST zijn niet ' +
        'gezet. Dit script is uitsluitend voor de Firebase Emulator Suite (via `firebase emulators:exec` ' +
        'of `npm run verify`) en mag nooit tegen een echt project (staging/productie) draaien — zie ' +
        'docs/pr-5.5-handmatig-protocol.md voor hoe testaccounts/stagingdata dan wél worden aangemaakt.',
    );
  }
}

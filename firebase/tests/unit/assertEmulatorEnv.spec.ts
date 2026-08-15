import { describe, it, expect } from 'vitest';
import { assertEmulatorEnv } from '../../scripts/assertEmulatorEnv.js';

describe('scripts/assertEmulatorEnv (PR 5.5b-activatievoorbereiding, review-opvolging)', () => {
  it('gooit een fout als beide emulator-env-vars ontbreken', () => {
    expect(() => assertEmulatorEnv({})).toThrow(/weigert te draaien/);
  });

  it('gooit een fout als alleen FIRESTORE_EMULATOR_HOST ontbreekt', () => {
    expect(() =>
      assertEmulatorEnv({ FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }),
    ).toThrow(/weigert te draaien/);
  });

  it('gooit een fout als alleen FIREBASE_AUTH_EMULATOR_HOST ontbreekt', () => {
    expect(() => assertEmulatorEnv({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toThrow(
      /weigert te draaien/,
    );
  });

  it('gooit niet als beide emulator-env-vars gezet zijn', () => {
    expect(() =>
      assertEmulatorEnv({
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      }),
    ).not.toThrow();
  });

  it('verwijst in de foutmelding naar het documentatiealternatief voor stagingdata', () => {
    expect(() => assertEmulatorEnv({})).toThrow(/pr-5.5-handmatig-protocol\.md/);
  });
});

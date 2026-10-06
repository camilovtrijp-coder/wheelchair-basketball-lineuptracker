/**
 * PR 8.3c-2b-i (docs/pr-8.3c-2b-plan.md §B.11): gedeelde timeouthelper voor
 * Firestore-/Auth-aanroepen. Zelfde gedrag als de bestaande lokale kopieën in
 * `FirestoreDeletionRequestGateway`, `FirestoreGameCloudGateway` en
 * `FirestoreCloudMigrationRunGateway`; die blijven bewust ongemoeid (deduplicatie is
 * een losse opruimtaak, geen onderdeel van dit stuk).
 *
 * Let op: dit annuleert de onderliggende aanroep NIET. Een offline write blijft in de
 * wachtrij van Firestore staan en kan later alsnog slagen; de aanroeper krijgt
 * alleen op tijd een antwoord.
 */
export class FirebaseCallTimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`geen serverantwoord binnen ${ms}ms`);
    this.name = 'FirebaseCallTimeoutError';
  }
}

export function isFirebaseCallTimeout(error: unknown): error is FirebaseCallTimeoutError {
  return error instanceof FirebaseCallTimeoutError;
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new FirebaseCallTimeoutError(ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

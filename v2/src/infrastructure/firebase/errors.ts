/** Firebase Auth/Firestore SDK-fouten dragen een `.code` (bijv. 'auth/wrong-password', 'permission-denied'). */
export function firebaseErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return 'unknown';
}

// Firebase Auth-implementatie van AccountAuthGateway (PR 8.3c-2b-ii,
// docs/pr-8.3c-2b-plan.md §C.2, foutmapping §B.11).
//
// - De app kent alleen e-mail/wachtwoord als aanmeldmethode (`FirebaseAuthGateway`:
//   `signInWithEmailAndPassword`/`createUserWithEmailAndPassword`); reauthenticatie is
//   dus `reauthenticateWithCredential` met `EmailAuthProvider.credential(user.email, pw)`.
// - Het wachtwoord bestaat alleen als argument van één aanroep: het wordt niet bewaard,
//   niet gelogd en niet teruggegeven. Uitkomsten dragen alleen een code, nooit het
//   SDK-foutobject (Firebase-fouten kunnen in `customData` het e-mailadres dragen).
// - Elke aanroep heeft een eigen timeout. Een timeout op `deleteUser` betekent dat het
//   antwoord kwijt is terwijl het verzoek mogelijk wel is uitgevoerd: `timeout` (de
//   coördinator controleert daarna met een verse tokenverversing of het account bestaat).
import {
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
  type Auth,
} from 'firebase/auth';
import type {
  AccountAuthGateway,
  DeleteUserResult,
  EmailClaimResult,
  ReauthResult,
} from '../../application/account/AccountAuthGateway';
import { firebaseErrorCode } from '../firebase/errors';
import { isFirebaseCallTimeout, withTimeout } from '../firebase/withTimeout';

/** Auth-aanroepen gaan naar Google-endpoints en mogen iets langer duren dan een Firestore-read. */
export const ACCOUNT_AUTH_TIMEOUT_MS = 15000;

/** Het account bestaat niet meer, is uitgeschakeld of het token is ingetrokken. */
const SESSION_INVALID_CODES = new Set([
  'auth/user-token-expired',
  'auth/user-not-found',
  'auth/user-disabled',
  'auth/invalid-user-token',
]);

const WRONG_PASSWORD_CODES = new Set([
  'auth/wrong-password',
  'auth/invalid-credential',
  'auth/invalid-login-credentials',
]);

export class FirebaseAccountAuthGateway implements AccountAuthGateway {
  constructor(
    private readonly auth: Auth,
    private readonly timeoutMs: number = ACCOUNT_AUTH_TIMEOUT_MS,
  ) {}

  async readVerifiedEmailClaim(): Promise<EmailClaimResult> {
    const user = this.auth.currentUser;
    if (!user) return { ok: false, code: 'not-signed-in' };
    try {
      // Altijd verversen: de Rules lezen de claim uit het token, en een gecachet token
      // kan nog een oude `email_verified=false` dragen.
      const token = await withTimeout(user.getIdTokenResult(true), this.timeoutMs);
      // Wisselde de sessie tijdens de verversing (uitgelogd, of als iemand anders
      // ingelogd), dan horen `user.uid` en deze claims niet meer bij de huidige sessie:
      // geen uitkomst over een account dat niet meer is ingelogd (zelfde betekenis als de
      // expectedUid-guard van de andere twee methoden).
      if (this.auth.currentUser?.uid !== user.uid) return { ok: false, code: 'not-signed-in' };
      const email = token.claims.email;
      return {
        ok: true,
        uid: user.uid,
        email: typeof email === 'string' && email.length > 0 ? email : null,
        verified: token.claims.email_verified === true,
      };
    } catch (error) {
      if (isFirebaseCallTimeout(error)) return { ok: false, code: 'network' };
      const code = firebaseErrorCode(error);
      if (code === 'auth/network-request-failed') return { ok: false, code: 'network' };
      if (SESSION_INVALID_CODES.has(code)) return { ok: false, code: 'session-invalid' };
      return { ok: false, code: 'other' };
    }
  }

  async reauthenticateWithPassword(
    password: string,
    guard: { expectedUid: string },
  ): Promise<ReauthResult> {
    const user = this.auth.currentUser;
    if (!user || user.uid !== guard.expectedUid) return { ok: false, code: 'not-signed-in' };
    // Zonder e-mailadres op de sessie is er geen e-mail/wachtwoord-credential te maken;
    // de app kent geen andere aanmeldmethode.
    if (!user.email) return { ok: false, code: 'other' };
    try {
      await withTimeout(
        reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password)),
        this.timeoutMs,
      );
      return { ok: true };
    } catch (error) {
      if (isFirebaseCallTimeout(error)) return { ok: false, code: 'network' };
      const code = firebaseErrorCode(error);
      if (WRONG_PASSWORD_CODES.has(code)) return { ok: false, code: 'wrong-password' };
      if (code === 'auth/too-many-requests') return { ok: false, code: 'too-many-requests' };
      if (code === 'auth/network-request-failed') return { ok: false, code: 'network' };
      if (SESSION_INVALID_CODES.has(code)) return { ok: false, code: 'session-invalid' };
      return { ok: false, code: 'other' };
    }
  }

  async deleteCurrentUser(guard: { expectedUid: string }): Promise<DeleteUserResult> {
    const user = this.auth.currentUser;
    if (!user || user.uid !== guard.expectedUid) return { ok: false, code: 'not-signed-in' };
    try {
      await withTimeout(deleteUser(user), this.timeoutMs);
      return { ok: true };
    } catch (error) {
      // Geen antwoord binnen de timeout: het verzoek kan wel zijn uitgevoerd.
      if (isFirebaseCallTimeout(error)) return { ok: false, code: 'timeout' };
      const code = firebaseErrorCode(error);
      if (code === 'auth/requires-recent-login')
        return { ok: false, code: 'requires-recent-login' };
      if (code === 'auth/network-request-failed') return { ok: false, code: 'network' };
      if (SESSION_INVALID_CODES.has(code)) return { ok: false, code: 'unknown-state' };
      return { ok: false, code: 'other' };
    }
  }
}

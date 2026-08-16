import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from 'firebase/auth';
import type { AuthUser } from '../../domain/auth/types';
import type { AuthGateway, AuthResult } from '../../application/auth/AuthGateway';
import { firebaseErrorCode } from '../firebase/errors';

function toAuthUser(user: User): AuthUser {
  return { uid: user.uid, email: user.email, emailVerified: user.emailVerified };
}

export class FirebaseAuthGateway implements AuthGateway {
  constructor(private readonly auth: Auth) {}

  getCurrentUser(): AuthUser | null {
    const user = this.auth.currentUser;
    return user ? toAuthUser(user) : null;
  }

  subscribe(onChange: (user: AuthUser | null) => void): () => void {
    return onAuthStateChanged(this.auth, (user) => onChange(user ? toAuthUser(user) : null));
  }

  async signUp(email: string, password: string): Promise<AuthResult> {
    try {
      await createUserWithEmailAndPassword(this.auth, email, password);
      return { ok: true };
    } catch (error) {
      return { ok: false, errorCode: firebaseErrorCode(error) };
    }
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    try {
      await signInWithEmailAndPassword(this.auth, email, password);
      return { ok: true };
    } catch (error) {
      return { ok: false, errorCode: firebaseErrorCode(error) };
    }
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(this.auth);
  }

  async sendVerificationEmail(): Promise<boolean> {
    const user = this.auth.currentUser;
    if (!user) return false;
    try {
      await sendEmailVerification(user);
      return true;
    } catch {
      return false;
    }
  }

  async refreshIdToken(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) return;
    await user.getIdToken(true);
  }
}

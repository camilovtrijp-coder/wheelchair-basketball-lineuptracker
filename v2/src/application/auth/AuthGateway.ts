import type { AuthUser } from '../../domain/auth/types';

export interface AuthResult {
  ok: boolean;
  /** Firebase Auth-foutcode (bijv. 'auth/email-already-in-use'), voor screen-lokale foutmeldingen. */
  errorCode?: string;
}

export interface AuthGateway {
  getCurrentUser(): AuthUser | null;
  /** Retourneert een unsubscribe-functie. Vuurt ook direct bij aanroep met de huidige status. */
  subscribe(onChange: (user: AuthUser | null) => void): () => void;
  signUp(email: string, password: string): Promise<AuthResult>;
  signIn(email: string, password: string): Promise<AuthResult>;
  signOut(): Promise<void>;
  /** `false` als er geen ingelogde gebruiker is of het verzenden mislukte. */
  sendVerificationEmail(): Promise<boolean>;
}

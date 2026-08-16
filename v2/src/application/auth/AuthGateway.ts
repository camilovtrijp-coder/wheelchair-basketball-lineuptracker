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
  /**
   * Forceert een verse ID-token (JWT), inclusief bijgewerkte claims — met name
   * `email_verified`, waar firestore.rules op steunt (bijv. de accept-/claim-
   * regels voor uitnodigingen). Zonder dit blijft een al ingelogde sessie een
   * bij het inloggen gecachet token gebruiken totdat het van nature verloopt,
   * ook nadat `AuthUser.emailVerified` (client-side, uit een losse profielfetch)
   * al wél `true` is — de Rules zien dan nog steeds de oude, valse claim en
   * weigeren de write (PR 5.5c-bugfixes bug 4). No-op als niemand is ingelogd.
   */
  refreshIdToken(): Promise<void>;
}

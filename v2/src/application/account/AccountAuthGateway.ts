/**
 * PR 8.3c-2b-ii (docs/pr-8.3c-2b-plan.md §C.2, §B.11): application-poort voor de
 * Firebase Auth-kant van accountverwijdering. Bewust een APARTE poort naast
 * `AuthGateway`, zodat die poort en zijn mocks in alle App-tests ongewijzigd blijven.
 * Geïmplementeerd door `infrastructure/auth/FirebaseAccountAuthGateway.ts`.
 *
 * Identiteit is uitsluitend de ingelogde Auth-sessie; geen methode neemt een uid of
 * e-mailadres als bron. `expectedUid` is alleen een GUARD: de gateway weigert als de
 * sessie inmiddels van een ander account is (bijv. uitgelogd en als iemand anders
 * ingelogd terwijl de flow liep), zodat een reauth of `deleteUser` nooit een ander
 * account raakt dan het account waarvan de eindpoort zojuist leeg was.
 *
 * Het wachtwoord leeft alleen in de aanroep: het wordt nergens opgeslagen, gelogd of in
 * een uitkomst teruggegeven. Uitkomsten dragen alleen codes, nooit het SDK-foutobject
 * (dat kan het e-mailadres bevatten).
 */
export type EmailClaimResult =
  | { ok: true; uid: string; email: string | null; verified: boolean }
  | {
      ok: false;
      /**
       * `network`: geen verbinding of geen antwoord. `session-invalid`: het token is niet
       * meer te verversen omdat het account weg of uitgeschakeld is (of de sessie
       * ingetrokken) — na een `deleteUser` met onbekende afloop is dat precies het geval
       * dat "opnieuw inloggen beslist".
       */
      code: 'not-signed-in' | 'network' | 'session-invalid' | 'other';
    };

export type ReauthCode =
  | 'wrong-password'
  | 'too-many-requests'
  | 'network'
  | 'not-signed-in'
  | 'session-invalid'
  | 'other';

export type ReauthResult = { ok: true } | { ok: false; code: ReauthCode };

export type DeleteUserCode =
  /** Firebase eist een recentere login; er is NIETS verwijderd. */
  | 'requires-recent-login'
  /** `auth/network-request-failed`: het verzoek kan de server wel of niet bereikt hebben. */
  | 'network'
  /** Geen sessie (meer), of de sessie is van een ander account dan `expectedUid`; niets geprobeerd. */
  | 'not-signed-in'
  /** Het antwoord is kwijt (eigen timeout, of het token bestaat niet meer): afloop onbekend. */
  | 'unknown-state'
  | 'other';

export type DeleteUserResult = { ok: true } | { ok: false; code: DeleteUserCode };

export interface AccountAuthGateway {
  /**
   * Ververst het ID-token ALTIJD en leest de `email`/`email_verified`-claims daaruit
   * (waar Rules op steunen, niet `user.emailVerified`).
   */
  readVerifiedEmailClaim(): Promise<EmailClaimResult>;

  /** Reauthenticatie van de huidige sessie met e-mail (uit de sessie) en wachtwoord. */
  reauthenticateWithPassword(
    password: string,
    guard: { expectedUid: string },
  ): Promise<ReauthResult>;

  /** `deleteUser(currentUser)`. `ok: true` alleen na een bevestigend serverantwoord. */
  deleteCurrentUser(guard: { expectedUid: string }): Promise<DeleteUserResult>;
}

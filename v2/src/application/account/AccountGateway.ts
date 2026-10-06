import type { AccountInventory, OrganizationFacts } from '../../domain/account/types';

/**
 * PR 8.3c-2b-i (docs/pr-8.3c-2b-plan.md §B.3/§C.1): application-poort voor de eigen
 * lidmaatschaps- en uitnodigingsinventaris en de drie self-deletes. Geïmplementeerd
 * door `infrastructure/account/FirestoreAccountGateway.ts`.
 *
 * Geen enkele methode neemt een uid of e-mailadres aan: de identiteit is uitsluitend
 * de daadwerkelijk ingelogde Firebase Auth-sessie (dezelfde les als de
 * 8.3b-herreview over `callerUid`). Pad-onderdelen (`organizationId`, `teamId`,
 * `invitationId`) komen van de coördinator uit een VERSE server-inventaris, nooit
 * rechtstreeks uit de UI; Firestore Rules zijn de gezaghebbende grens.
 *
 * Alle reads komen van de SERVER (§B.5): offline faalt een read met `offline`, nooit
 * met een leeg resultaat uit de cache. Elke delete leest daarna terug.
 */
export interface AccountIdentity {
  uid: string;
  /** E-mailadres uit de token-claim (`request.auth.token.email`), of `null`. */
  email: string | null;
  /** De `email_verified`-claim uit het ID-token — waar Rules op steunen, niet `user.emailVerified`. */
  emailVerified: boolean;
}

export type AccountReadError =
  | { code: 'not-signed-in' }
  | { code: 'email-not-verified' }
  | { code: 'offline' }
  | { code: 'timeout' }
  | { code: 'read-failed'; detail: unknown };

/**
 * Uitkomst van `readIdentity()`. Een mislukte tokenverversing is GEEN "niet ingelogd":
 * offline geeft `offline`, zodat de aanroeper "geen verbinding" kan melden.
 */
export type IdentityReadResult =
  | { ok: true; identity: AccountIdentity }
  | {
      ok: false;
      error: Exclude<AccountReadError, { code: 'email-not-verified' }>;
    };

export type InventoryReadResult =
  { ok: true; inventory: AccountInventory } | { ok: false; error: AccountReadError };

export type FactsReadResult =
  { ok: true; facts: OrganizationFacts } | { ok: false; error: AccountReadError };

export type SelfDeleteError =
  /** Rules weigerden de delete en het document staat er (volgens een server-readback) nog. */
  | { code: 'rejected' }
  /**
   * Geen serverantwoord binnen de timeout. Een offline delete staat in de wachtrij van
   * Firestore en kan LATER alsnog landen; de volgende verse inventaris toont de werkelijke
   * toestand.
   */
  | { code: 'timeout' }
  | { code: 'offline' }
  | { code: 'not-signed-in' }
  | { code: 'failed'; detail: unknown };

export type SelfDeleteResult =
  /**
   * `deleted`: deze aanroep heeft het document verwijderd en de server bevestigt dat het
   * weg is. `already-gone`: het document was er (volgens de server) al niet meer — geen
   * fout, want een delete op een al verwijderd document wordt door Rules geweigerd (A1).
   */
  { ok: true; outcome: 'deleted' | 'already-gone' } | { ok: false; error: SelfDeleteError };

export interface AccountGateway {
  /**
   * uid/e-mail en `email_verified` uit de huidige Auth-sessie en een VERS ververst
   * ID-token (reviewbevinding A op 2b-i: een gecachet token met een verouderde
   * `email_verified=false` zou de uitnodigingsstap stil overslaan). Geen invoer. Dit is
   * de preflight van elke flow; de flow heeft daarna toch netwerk nodig.
   */
  readIdentity(): Promise<IdentityReadResult>;

  /**
   * De drie collectionGroup-queries uit firebase/docs/QUERY_CONTRACT.md, ALTIJD van de
   * server. `includeInvitations` vereist een geverifieerde e-mailclaim; anders
   * `email-not-verified` zonder query.
   */
  readInventoryFromServer(options: { includeInvitations: boolean }): Promise<InventoryReadResult>;

  /** Per-organisatiefeiten (§B.6), van de server. Alleen zinvol bij een eigen membership. */
  readOrganizationFacts(organizationId: string): Promise<FactsReadResult>;

  /** Verwijdert `organizations/{orgId}/teams/{teamId}/teamMembers/{eigen uid}`. */
  deleteOwnTeamMembership(ref: {
    organizationId: string;
    teamId: string;
  }): Promise<SelfDeleteResult>;

  /** Verwijdert een eigen uitnodiging (token-e-mail == `email`, `email_verified`). */
  deleteOwnInvitation(ref: {
    organizationId: string;
    invitationId: string;
  }): Promise<SelfDeleteResult>;

  /** Verwijdert `organizations/{orgId}/organizationMembers/{eigen uid}`. */
  deleteOwnOrganizationMembership(organizationId: string): Promise<SelfDeleteResult>;
}

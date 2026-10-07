import type { MemberFootprint, TransferMember } from '../../domain/account/transfer';
import type { OrganizationRole } from '../../domain/organizations/types';

/**
 * PR 8.3c-2b-iii (docs/pr-8.3c-2b-plan.md §B.7, §B.8, §C.3): application-poort voor de
 * overdracht van het eigenaarschap en het intrekken van openstaande uitnodigingen.
 * Geïmplementeerd door `infrastructure/account/FirestoreOwnershipTransferGateway.ts`.
 *
 * Anders dan `AccountGateway` schrijft deze poort op ANDERMANS documenten. Daarom:
 * - de AANROEPER komt nooit uit een parameter: `readCaller()` leest uid uit de
 *   Auth-sessie en de rol uit het eigen `organizationMembers`-document, van de server;
 * - `targetUid`/`email` zijn noodzakelijk parameters (het gaat om een ánder), maar elke
 *   schrijfmethode weigert de eigen uid als doel (`self-target`, geen write), en de
 *   coördinator haalt doel en e-mailadres uit een verse server-lezing van de ledenlijst;
 * - rolgevoelige writes (promoveren, membership verwijderen) dragen de VERWACHTE huidige
 *   rol als voorwaarde, atomair gecontroleerd (`role-changed`, geen write);
 * - Firestore Rules blijven de gezaghebbende grens; elke write wordt van de server
 *   teruggelezen en een Rules-weigering wordt met een readback geclassificeerd.
 *
 * Alle reads komen van de SERVER (§B.5): offline faalt een read met `offline`, nooit met
 * een resultaat uit de persistente cache.
 */
export type TransferReadError =
  | { code: 'not-signed-in' }
  | { code: 'offline' }
  | { code: 'timeout' }
  | { code: 'read-failed'; detail: unknown };

export interface TransferCaller {
  uid: string;
  role: OrganizationRole;
}

export type CallerReadResult =
  /** `caller: null` = ingelogd, maar (volgens de server) geen lid van deze organisatie. */
  { ok: true; caller: TransferCaller | null } | { ok: false; error: TransferReadError };

export type MembersReadResult =
  { ok: true; members: TransferMember[] } | { ok: false; error: TransferReadError };

export type FootprintReadResult =
  { ok: true; footprint: MemberFootprint } | { ok: false; error: TransferReadError };

export type TransferWriteError =
  /**
   * Er is NIETS geschreven: Rules weigerden de write en een server-readback toont dat er
   * niets veranderd is, of die readback werd zelf geweigerd (de aanroeper is geen lid
   * meer), of de transactie las het eigen membership van de aanroeper zonder ownerrol
   * (reviewbevinding A op #108: twee owners die elkaar tegelijk verwijderen).
   */
  | { code: 'rejected' }
  /** De rol van het doel week af van de verwachte rol; er is NIETS geschreven. */
  | { code: 'role-changed'; actualRole: OrganizationRole }
  /** Het doel is (volgens de server) geen lid; er is niets geschreven. */
  | { code: 'not-found' }
  /** Het doel is de aanroeper zelf; er is niets geschreven. */
  | { code: 'self-target' }
  /**
   * Geen serverantwoord binnen de timeout. Een write kan in de wachtrij van Firestore
   * staan en LATER alsnog landen; de volgende verse lezing toont de werkelijke toestand.
   * Bij promoveren en membership verwijderen volgt eerst één server-readback van het doel:
   * staat het al in de bedoelde eindtoestand, dan is de uitkomst `ok` in plaats hiervan.
   */
  | { code: 'timeout' }
  | { code: 'offline' }
  | { code: 'not-signed-in' }
  | { code: 'failed'; detail: unknown };

export type PromoteResult =
  { ok: true; outcome: 'promoted' | 'already-owner' } | { ok: false; error: TransferWriteError };

export type RevokeInvitationsResult =
  /**
   * `alreadyClosed`: tussendoor door een ander ingetrokken/geclaimd (Rules weigerden,
   * readback: niet meer open). `skippedMalformed`: uitnodigingen in deze organisatie zonder
   * leesbaar `email`-veld, overgeslagen (niet aan een adres toe te wijzen; Rules laten ze
   * door niemand accepteren of claimen). Een uitnodiging OP het doeladres met een
   * onleesbare status blokkeert wel (fail closed, `failed`).
   */
  | { ok: true; revoked: number; alreadyClosed: number; skippedMalformed: number }
  /** `revoked`: zoveel zijn er VÓÓR de fout al ingetrokken (en teruggelezen). */
  | { ok: false; error: TransferWriteError; revoked: number };

export type RemoveTeamMembershipsResult =
  { ok: true; removed: number } | { ok: false; error: TransferWriteError; removed: number };

export type RemoveMemberResult =
  { ok: true; outcome: 'deleted' | 'already-gone' } | { ok: false; error: TransferWriteError };

export interface OwnershipTransferGateway {
  /** De aanroeper uit de Auth-sessie + diens EIGEN membership, van de server. Geen invoer. */
  readCaller(organizationId: string): Promise<CallerReadResult>;

  /** Ongefilterde ledenlijst van één organisatie (bewezen 8.3b-vorm), van de server. */
  listOrganizationMembers(organizationId: string): Promise<MembersReadResult>;

  /**
   * Zet de rol van `targetUid` op `organizationOwner`, alleen als de huidige rol (atomair
   * gelezen) `expectedRole` is. Al owner → `already-owner` zonder write. Readback na de write.
   */
  promoteToOwner(
    organizationId: string,
    targetUid: string,
    expectedRole: OrganizationRole,
  ): Promise<PromoteResult>;

  /**
   * Trekt elke `pending`/`accepted` uitnodiging op `email` in DEZE organisatie in
   * (status `revoked` + servergebonden `revokedAt`). Herbruikbaar: een toekomstige
   * ledenbeheer-UI MOET dit aanroepen bij demotie of verwijdering (§B.7 punt 3, R1).
   * Raakt nooit een andere organisatie, een ander adres of een `claimed`/`revoked`
   * uitnodiging. Elke intrekking wordt van de server teruggelezen.
   */
  revokeOpenInvitationsForEmail(
    organizationId: string,
    email: string,
  ): Promise<RevokeInvitationsResult>;

  /** Verwijdert `teams/{teamId}/teamMembers/{targetUid}` in elk team van deze organisatie. */
  removeTeamMembershipsOf(
    organizationId: string,
    targetUid: string,
  ): Promise<RemoveTeamMembershipsResult>;

  /**
   * Verwijdert `organizationMembers/{targetUid}`, alleen als de huidige rol (atomair
   * gelezen) `expectedRole` is. Al weg → `already-gone`. Readback na de delete.
   */
  removeOrganizationMember(
    organizationId: string,
    targetUid: string,
    expectedRole: OrganizationRole,
  ): Promise<RemoveMemberResult>;

  /** Wat er van `targetUid`/`email` in deze organisatie nog op de server staat. */
  readMemberFootprint(
    organizationId: string,
    targetUid: string,
    email: string,
  ): Promise<FootprintReadResult>;
}

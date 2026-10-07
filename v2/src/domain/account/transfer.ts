import type { InvitationStatus } from '../invitations/types';
import type { OrganizationRole } from '../organizations/types';

/**
 * PR 8.3c-2b-iii (docs/pr-8.3c-2b-plan.md §B.7, §B.8, §C.3): pure helpers voor de
 * tweestaps-overdracht van het eigenaarschap en het intrekken van openstaande
 * uitnodigingen. Geen Firebase-afhankelijkheid; de coördinator voedt deze functies met
 * een VERSE server-lezing van de ledenlijst.
 *
 * Overdracht = owner A promoveert lid B tot owner (Rules: owner wijzigt andermans
 * membership) → B verwijdert A (Rules: owner verwijdert andermans membership). Er komt
 * GEEN nieuwe bevoegdheid bij; de app maakt bestaande Rules-bevoegdheden zichtbaar.
 */
export interface TransferMember {
  uid: string;
  role: OrganizationRole;
  /** Uit het `organizationMembers`-document (server-read), nooit uit invoer. */
  email: string;
}

export interface TransferMemberSplit {
  /** Niet-owner-leden behalve de aanroeper: wie A kan promoveren (stap 1). */
  candidates: TransferMember[];
  /** Andere owners behalve de aanroeper: wie B kan verwijderen (stap 2, besluit B9). */
  otherOwners: TransferMember[];
}

export function isOwnerRole(role: OrganizationRole): boolean {
  return role === 'organizationOwner';
}

/** `pending`/`accepted`: de enige statussen die Rules laten intrekken en die nog te claimen zijn. */
export function isOpenInvitationStatus(status: InvitationStatus): boolean {
  return status === 'pending' || status === 'accepted';
}

/**
 * Vergelijkingsvorm van een e-mailadres: getrimd en in kleine letters. Bewust RUIMER dan
 * de Rules (die exact vergelijken met de token-e-mail): bij het intrekken is "te veel"
 * (hetzelfde adres in een andere spelling, restrisico R5) veiliger dan "te weinig".
 */
export function normalizeEmailForMatch(email: string): string {
  return email.trim().toLowerCase();
}

export function isSameEmailAddress(a: string, b: string): boolean {
  const left = normalizeEmailForMatch(a);
  return left.length > 0 && left === normalizeEmailForMatch(b);
}

/** Verdeelt een verse ledenlijst in promoveerbare kandidaten en andere owners. */
export function splitTransferMembers(
  members: readonly TransferMember[],
  callerUid: string,
): TransferMemberSplit {
  const others = members.filter((member) => member.uid !== callerUid);
  const byUid = (a: TransferMember, b: TransferMember) => a.uid.localeCompare(b.uid);
  return {
    candidates: others.filter((member) => !isOwnerRole(member.role)).sort(byUid),
    otherOwners: others.filter((member) => isOwnerRole(member.role)).sort(byUid),
  };
}

export type PromoteTargetCheck =
  | { ok: true; target: TransferMember; alreadyOwner: boolean }
  | { ok: false; reason: 'self' | 'not-found' };

/** Stap 1 (A): alleen een bestaand lid dat niet de aanroeper zelf is. */
export function checkPromoteTarget(
  members: readonly TransferMember[],
  callerUid: string,
  targetUid: string,
): PromoteTargetCheck {
  if (targetUid === callerUid) return { ok: false, reason: 'self' };
  const target = members.find((member) => member.uid === targetUid);
  if (target === undefined) return { ok: false, reason: 'not-found' };
  return { ok: true, target, alreadyOwner: isOwnerRole(target.role) };
}

export type CompleteTargetCheck =
  | { ok: true; target: TransferMember }
  | { ok: false; reason: 'self' | 'not-found' | 'target-not-owner' };

/**
 * Stap 2 (B): alleen een ANDERE owner (besluit B9: "andere eigenaar verwijderen", alleen
 * op andere owners). Een gewoon lid verwijderen is ledenbeheer en valt buiten 2b-iii.
 */
export function checkCompleteTarget(
  members: readonly TransferMember[],
  callerUid: string,
  previousOwnerUid: string,
): CompleteTargetCheck {
  if (previousOwnerUid === callerUid) return { ok: false, reason: 'self' };
  const target = members.find((member) => member.uid === previousOwnerUid);
  if (target === undefined) return { ok: false, reason: 'not-found' };
  if (!isOwnerRole(target.role)) return { ok: false, reason: 'target-not-owner' };
  return { ok: true, target };
}

/** Wat er van een lid in één organisatie (nog) op de server staat. */
export interface MemberFootprint {
  organizationMember: boolean;
  teamMemberships: number;
  openInvitations: number;
}

/** Klaar voor de laatste write (het membership): geen teamMembers en geen open uitnodiging meer. */
export function isReadyForMemberRemoval(footprint: MemberFootprint): boolean {
  return footprint.teamMemberships === 0 && footprint.openInvitations === 0;
}

export function isFootprintEmpty(footprint: MemberFootprint): boolean {
  return !footprint.organizationMember && isReadyForMemberRemoval(footprint);
}

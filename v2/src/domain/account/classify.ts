import type {
  AccountInventory,
  OrganizationFacts,
  OrganizationLeaveClass,
  OrganizationSlice,
  OwnInvitationRef,
} from './types';

/**
 * PR 8.3c-2b-i (docs/pr-8.3c-2b-plan.md §B.6/§C.1): pure classificatie van één
 * organisatie voor "organisatie verlaten" (en later accountverwijdering, 2b-ii).
 * Geen I/O, geen Firebase: alles wat telt komt binnen als argument, zodat elke
 * klasse met vaste, handmatig narekenbare invoer te testen is.
 */

function sliceFor(map: Map<string, OrganizationSlice>, organizationId: string): OrganizationSlice {
  let slice = map.get(organizationId);
  if (slice === undefined) {
    slice = { organizationId, membership: null, teamMemberships: [], invitations: [] };
    map.set(organizationId, slice);
  }
  return slice;
}

/**
 * Groepeert de eigen inventaris per organisatie. Een organisatie verschijnt zodra
 * er één eigen document in staat (membership, teamMembers-document of uitnodiging).
 * Een tweede membership-regel voor dezelfde organisatie kan niet bestaan (document-ID
 * is de eigen uid); mocht een inventaris er toch twee bevatten, dan wint de eerste.
 */
export function groupInventoryByOrganization(
  inventory: AccountInventory,
): Map<string, OrganizationSlice> {
  const map = new Map<string, OrganizationSlice>();
  for (const membership of inventory.organizationMemberships) {
    const slice = sliceFor(map, membership.organizationId);
    if (slice.membership === null) slice.membership = membership;
  }
  for (const team of inventory.teamMemberships) {
    sliceFor(map, team.organizationId).teamMemberships.push(team);
  }
  for (const invitation of inventory.invitations) {
    sliceFor(map, invitation.organizationId).invitations.push(invitation);
  }
  return map;
}

/** `pending`/`accepted`: een uitnodiging die nog geaccepteerd of geclaimd kan worden. */
export function isOpenInvitation(invitation: Pick<OwnInvitationRef, 'status'>): boolean {
  return invitation.status === 'pending' || invitation.status === 'accepted';
}

/**
 * Classificeert één organisatie, in de vaste volgorde van §B.6. De volgorde is
 * betekenisvol: een blokkade die de gebruiker niet zelf kan oplossen gaat altijd
 * vóór een klasse die wel zelf op te lossen is, en elke onzekerheid (ontbrekende
 * feiten bij een membership, onbekende maker) valt dicht op een niet-zelf-oplosbare
 * klasse.
 */
export function classifyOrganizationForLeave(input: {
  callerUid: string;
  slice: OrganizationSlice;
  facts: OrganizationFacts | null;
  localUnsyncedWork: number;
}): OrganizationLeaveClass {
  const { callerUid, slice, facts, localUnsyncedWork } = input;

  if (localUnsyncedWork > 0) return 'local-unsynced-work';

  if (slice.membership === null) {
    if (slice.teamMemberships.length > 0) return 'leave-team-only';
    return 'invitations-only';
  }

  // Een membership zonder feiten is een programmeerfout of een mislukte read die niet
  // als zodanig is gemeld: dicht, nooit "leave".
  if (facts === null || facts.organizationId !== slice.organizationId) {
    return 'organization-unsupported';
  }
  if (!facts.exists) return 'organization-missing';
  if (facts.createdBy === null) return 'organization-unsupported';

  if (slice.membership.role === 'organizationOwner') {
    const status = facts.deletionRequestStatus;
    // `completed` met een nog bestaand membership is een onafgemaakte wissing:
    // net als `failed` een runbookzaak.
    if (status === 'failed' || status === 'completed') return 'organization-deletion-failed';
    if (status === 'requested' || status === 'executing') return 'awaiting-organization-deletion';
    return countOtherOwners(facts, callerUid) === 0 ? 'owner-sole' : 'owner-awaiting-removal';
  }

  // Rules weigeren de self-delete van de maker, ook als die gedemoveerd is
  // (besluitrecord §8.6 punt 1): een owner of admin moet hem verwijderen.
  if (facts.createdBy === callerUid) return 'creator-needs-owner';

  return 'leave';
}

/** Aantal ANDERE owners dan de aanroeper (dubbele uid's tellen één keer). */
export function countOtherOwners(facts: OrganizationFacts, callerUid: string): number {
  return new Set(facts.ownerUids.filter((uid) => uid !== callerUid)).size;
}

/**
 * Of de gebruiker deze klasse zelf kan afhandelen zonder een ander (owner, runbook)
 * of zonder eerst lokaal werk te synchroniseren. `invitations-only` is alleen in de
 * accountverwijderflow (2b-ii) een eigen stap; bij "organisatie verlaten" is er dan
 * geen lidmaatschap om te verlaten.
 */
export function isSelfResolvable(organizationClass: OrganizationLeaveClass): boolean {
  return (
    organizationClass === 'leave' ||
    organizationClass === 'leave-team-only' ||
    organizationClass === 'invitations-only'
  );
}

/**
 * `true` als de inventaris (binnen `scope`: alleen die organisatie) geen enkel eigen
 * document meer bevat. Een LEGE inventaris bewijst alleen iets als ze van de server
 * komt (§B.5); deze functie kijkt uitsluitend naar de inhoud.
 */
export function isInventoryEmpty(
  inventory: AccountInventory,
  scope?: { organizationId: string },
): boolean {
  const inScope = (entry: { organizationId: string }) =>
    scope === undefined || entry.organizationId === scope.organizationId;
  return (
    !inventory.organizationMemberships.some(inScope) &&
    !inventory.teamMemberships.some(inScope) &&
    !inventory.invitations.some(inScope)
  );
}

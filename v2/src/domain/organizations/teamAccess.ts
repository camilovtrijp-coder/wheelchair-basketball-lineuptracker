import type { OrganizationRole } from './types';

export interface TeamAccess {
  effectiveRole: OrganizationRole;
  canManageTeamData: boolean;
  /**
   * Of deze gebruiker wedstrijdacties mag uitvoeren (opzetten/scoren/wisselen)
   * — apart van `canManageTeamData`, want ADR-003 kent `scorer` expliciet
   * "wedstrijdacties schrijven, roster niet beheren" toe (spiegelt ADR-002's
   * single-writer-model). Vóór deze toevoeging deelde de wedstrijd-UI
   * dezelfde bevoegdheid als roster/instellingen, waardoor een scorer nergens
   * kon scoren — zie de externe review van PR 6.1 (aug. 2026).
   */
  canWriteGameData: boolean;
  /**
   * Of dit specifieke team getoond/geselecteerd mag worden als context: owner/admin
   * (impliciet elk team) of een expliciet teamMembers-document. Puur organisatielidmaatschap
   * zonder van beide (bijv. een org-viewer zonder teamMembers-document) geeft `effectiveRole`
   * via de orgrol-fallback hierboven — dat blijft correct voor "welke rol zou ik hebben als ik
   * hier toegang toe had", maar mag niet gebruikt worden om te bepalen OF een team getoond of
   * geactiveerd mag worden (zie PR 5.2-review: contextwisselaar toonde anders elk team van de
   * organisatie aan elk lid, en verborg team-only leden nergens expliciet voor).
   */
  isExplicitlyAuthorized: boolean;
}

const OWNER_OR_ADMIN: ReadonlySet<OrganizationRole> = new Set([
  'organizationOwner',
  'organizationAdmin',
]);

/**
 * Spiegelt firestore.rules' canManageTeamData/teamRole exact: org owner/admin
 * hebben impliciete volledige toegang tot elk team in hun organisatie zonder
 * teamMembers-document; coach/scorer/viewer hebben alleen een teamspecifieke
 * rol via een expliciet teamMembers-document, en alleen 'coach' mag
 * roster/instellingen schrijven (zie firebase/firestore.rules,
 * canManageTeamData). `canWriteGameData` is een aparte, ruimere bevoegdheid
 * (owner/admin/coach/scorer) voor wedstrijdacties — wedstrijddata heeft nog
 * geen Firestore-rules-tegenhanger (games/-paden zijn default-deny tot Fase
 * 7), dus dit veld is vooralsnog uitsluitend een lokale UI-poort.
 *
 * `orgRole` is `null` voor een team-only gebruiker (issue #31): iemand met
 * uitsluitend een `teamMembers`-document, geen `organizationMembers` in deze
 * organisatie. Zo iemand kan nooit owner/admin zijn (dat vereist per definitie
 * een organizationMembers-document), dus `isOwnerOrAdmin` is dan altijd false
 * en `effectiveRole` valt terug op `teamMemberRole`. De `?? 'viewer'`-fallback
 * op `effectiveRole` is puur defensief: bij geldig gebruik is `teamMemberRole`
 * altijd gezet zodra `orgRole` `null` is (een team-only context bestaat per
 * definitie via een gevonden teamMembers-document) — die combinatie mag hier
 * dus nooit voorkomen, maar een expliciete, veilige fallback is beter dan een
 * onveilige cast als dat toch een keer misgaat.
 */
export function deriveTeamAccess(
  orgRole: OrganizationRole | null,
  teamMemberRole: OrganizationRole | null,
): TeamAccess {
  const isOwnerOrAdmin = orgRole !== null && OWNER_OR_ADMIN.has(orgRole);
  return {
    effectiveRole: (isOwnerOrAdmin ? orgRole : (teamMemberRole ?? orgRole)) ?? 'viewer',
    canManageTeamData: isOwnerOrAdmin || teamMemberRole === 'coach',
    canWriteGameData: isOwnerOrAdmin || teamMemberRole === 'coach' || teamMemberRole === 'scorer',
    isExplicitlyAuthorized: isOwnerOrAdmin || teamMemberRole !== null,
  };
}

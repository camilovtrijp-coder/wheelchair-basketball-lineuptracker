import type { OrganizationRole } from './types';

export interface TeamAccess {
  effectiveRole: OrganizationRole;
  canManageTeamData: boolean;
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
 * rol via een expliciet teamMembers-document, en alleen 'coach' mag er
 * schrijven (zie firebase/firestore.rules, canManageTeamData).
 */
export function deriveTeamAccess(
  orgRole: OrganizationRole,
  teamMemberRole: OrganizationRole | null,
): TeamAccess {
  const isOwnerOrAdmin = OWNER_OR_ADMIN.has(orgRole);
  return {
    effectiveRole: isOwnerOrAdmin ? orgRole : (teamMemberRole ?? orgRole),
    canManageTeamData: isOwnerOrAdmin || teamMemberRole === 'coach',
    isExplicitlyAuthorized: isOwnerOrAdmin || teamMemberRole !== null,
  };
}

import type { OrganizationRole } from './types';

export interface TeamAccess {
  effectiveRole: OrganizationRole;
  canManageTeamData: boolean;
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
  };
}

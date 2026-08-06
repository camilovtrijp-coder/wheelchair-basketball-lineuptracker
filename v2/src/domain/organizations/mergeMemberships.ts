import type { Membership, TeamOnlyContext } from './types';

/**
 * Combineert de twee toegestane membershipbronnen (issue #31) tot één lijst voor de
 * contextwisselaar: organisatieniveau-lidmaatschappen (`listMyMemberships()`) plus
 * organisaties waar de gebruiker uitsluitend via één of meer `teamMembers`-documenten
 * toegang toe heeft (`listMyTeamOnlyContexts()`), zonder eigen `organizationMembers`-
 * document. Een orgId met al een organisatieniveau-lidmaatschap wordt niet gedupliceerd —
 * die gebruiker ziet zijn teams al via de normale `listTeams()`/`getMyTeamAccess()`-weg
 * (zie ContextSwitcher). Meerdere team-only contexten in dezelfde organisatie (bijv. twee
 * teams) leveren precies één samengevoegde organisatie-entry op.
 */
export function mergeMemberships(
  orgMemberships: Membership[],
  teamOnlyContexts: TeamOnlyContext[],
): Membership[] {
  const orgIds = new Set(orgMemberships.map((m) => m.orgId));
  const teamOnlyOrgs = new Map<string, Membership>();
  for (const context of teamOnlyContexts) {
    if (orgIds.has(context.orgId) || teamOnlyOrgs.has(context.orgId)) continue;
    teamOnlyOrgs.set(context.orgId, {
      orgId: context.orgId,
      orgName: context.orgName,
      role: null,
    });
  }
  return [...orgMemberships, ...teamOnlyOrgs.values()];
}

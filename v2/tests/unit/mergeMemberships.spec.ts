import { describe, it, expect } from 'vitest';
import { mergeMemberships } from '../../src/domain/organizations/mergeMemberships';
import type { Membership, TeamOnlyContext } from '../../src/domain/organizations/types';

describe('domain/organizations/mergeMemberships', () => {
  it('geeft de organisatieniveau-lidmaatschappen ongewijzigd terug zonder team-only contexten', () => {
    const orgMemberships: Membership[] = [
      { orgId: 'org-a', orgName: 'Org A', role: 'organizationOwner' },
    ];
    expect(mergeMemberships(orgMemberships, [])).toEqual(orgMemberships);
  });

  it('voegt een organisatie die alleen via teamMembers bereikbaar is toe met role: null', () => {
    const orgMemberships: Membership[] = [];
    const teamOnlyContexts: TeamOnlyContext[] = [
      { orgId: 'org-b', orgName: 'Org B', teamId: 'team-1', teamName: 'Team 1', role: 'coach' },
    ];
    expect(mergeMemberships(orgMemberships, teamOnlyContexts)).toEqual([
      { orgId: 'org-b', orgName: 'Org B', role: null },
    ]);
  });

  it('dupliceert een organisatie niet als er al een organisatieniveau-lidmaatschap voor bestaat', () => {
    const orgMemberships: Membership[] = [{ orgId: 'org-a', orgName: 'Org A', role: 'viewer' }];
    const teamOnlyContexts: TeamOnlyContext[] = [
      { orgId: 'org-a', orgName: 'Org A', teamId: 'team-1', teamName: 'Team 1', role: 'coach' },
    ];
    expect(mergeMemberships(orgMemberships, teamOnlyContexts)).toEqual(orgMemberships);
  });

  it('voegt meerdere team-only contexten in dezelfde organisatie samen tot precies één entry', () => {
    const teamOnlyContexts: TeamOnlyContext[] = [
      { orgId: 'org-c', orgName: 'Org C', teamId: 'team-1', teamName: 'Team 1', role: 'coach' },
      { orgId: 'org-c', orgName: 'Org C', teamId: 'team-2', teamName: 'Team 2', role: 'viewer' },
    ];
    expect(mergeMemberships([], teamOnlyContexts)).toEqual([
      { orgId: 'org-c', orgName: 'Org C', role: null },
    ]);
  });
});

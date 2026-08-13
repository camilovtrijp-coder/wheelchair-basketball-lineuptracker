// @vitest-environment jsdom
//
// Enige component-render-test in de suite (vandaar de losse jsdom-environment-pragma i.p.v.
// vitest.config.ts globaal op jsdom te zetten — dat zou alle 118 overige, pure-logica-tests
// onnodig vertragen). Bewijst een echte race-conditie die alleen via een gerenderde component
// met controleerbare, uitgestelde promises reproduceerbaar is (geen pure functie om te testen).
import { describe, it, expect } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';
import { ContextSwitcher } from '../../src/ui/context/ContextSwitcher';
import type { OrganizationGateway } from '../../src/application/organizations/OrganizationGateway';
import type { Membership, TeamSummary } from '../../src/domain/organizations/types';
import type { TeamAccess } from '../../src/domain/organizations/teamAccess';

/**
 * Fake gateway waarvan `listTeams()` bewust NIET automatisch resolvet — de test bepaalt zelf,
 * per orgId, wanneer (en in welke volgorde) elk antwoord binnenkomt, om de PR 5.2-reviewbevinding
 * [P2] te reproduceren: een laat antwoord van een inmiddels ingeklapte organisatie mag de
 * gedeelde teams/teamAccess-state van een net geopende ANDERE organisatie niet overschrijven.
 */
class DeferredTeamsGateway implements OrganizationGateway {
  private readonly resolvers = new Map<string, (teams: TeamSummary[]) => void>();

  listTeams(orgId: string): Promise<TeamSummary[]> {
    return new Promise((resolve) => this.resolvers.set(orgId, resolve));
  }

  resolveTeams(orgId: string, teams: TeamSummary[]): void {
    const resolve = this.resolvers.get(orgId);
    if (!resolve) throw new Error(`Geen pending listTeams()-aanvraag voor ${orgId}`);
    resolve(teams);
  }

  async getMyTeamAccess(): Promise<TeamAccess> {
    return {
      effectiveRole: 'organizationOwner',
      canManageTeamData: true,
      canWriteGameData: true,
      isExplicitlyAuthorized: true,
    };
  }

  listMyMemberships(): never {
    throw new Error('niet gebruikt in deze test');
  }
  listMyTeamOnlyContexts(): never {
    throw new Error('niet gebruikt in deze test');
  }
  createOrganizationWithOwner(): never {
    throw new Error('niet gebruikt in deze test');
  }
  createTeam(): never {
    throw new Error('niet gebruikt in deze test');
  }
  validateSelectedTeam(): never {
    throw new Error('niet gebruikt in deze test');
  }
  getInvitationByLink(): never {
    throw new Error('niet gebruikt in deze test');
  }
  acceptInvitation(): never {
    throw new Error('niet gebruikt in deze test');
  }
  claimInvitation(): never {
    throw new Error('niet gebruikt in deze test');
  }
}

const orgA: Membership = { orgId: 'org-a', orgName: 'Org A', role: 'organizationOwner' };
const orgB: Membership = { orgId: 'org-b', orgName: 'Org B', role: 'organizationOwner' };

describe('ui/context/ContextSwitcher — race tussen verouderde en actuele teamresponses', () => {
  it('een laat antwoord van een ingeklapte organisatie overschrijft niet de state van de net geopende organisatie', async () => {
    const gateway = new DeferredTeamsGateway();
    const { getByTestId, queryByTestId } = render(
      <ContextSwitcher
        lang="nl"
        memberships={[orgA, orgB]}
        teamOnlyContexts={[]}
        organizationGateway={gateway}
        onSelect={() => {}}
      />,
    );

    // Org A openen (start een pending listTeams('org-a')), dan vóór het antwoord al naar org B
    // wisselen (start een pending listTeams('org-b')) — precies het scenario uit de bevinding.
    fireEvent.click(getByTestId('context-org-org-a'));
    fireEvent.click(getByTestId('context-org-org-b'));

    // Org B (het laatst geopende, actuele request) antwoordt EERST.
    gateway.resolveTeams('org-b', [{ teamId: 'team-b1', name: 'Team B1' }]);
    await waitFor(() => expect(queryByTestId('context-team-team-b1')).toBeTruthy());

    // Org A's VEROUDERDE antwoord komt daarna alsnog binnen.
    gateway.resolveTeams('org-a', [{ teamId: 'team-a1', name: 'Team A1' }]);
    // Geef een eventuele (foutieve) state-update de kans om door te komen vóór de assertie.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(queryByTestId('context-team-team-b1')).toBeTruthy();
    expect(queryByTestId('context-team-team-a1')).toBeNull();
  });
});

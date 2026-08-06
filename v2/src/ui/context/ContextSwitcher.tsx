import { useState } from 'preact/hooks';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import type { Membership, SelectedContext, TeamSummary } from '../../domain/organizations/types';
import type { OrganizationGateway } from '../../application/organizations/OrganizationGateway';
import { type TeamAccess } from '../../domain/organizations/teamAccess';

export interface ContextSwitcherProps {
  lang: Lang;
  memberships: Membership[];
  organizationGateway: OrganizationGateway;
  onSelect: (context: SelectedContext) => void;
}

function t(lang: Lang, key: StringKey): string {
  return translate(lang, key);
}

export function ContextSwitcher({
  lang,
  memberships,
  organizationGateway,
  onSelect,
}: ContextSwitcherProps) {
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [teamAccess, setTeamAccess] = useState<Record<string, TeamAccess>>({});
  const [loadingTeams, setLoadingTeams] = useState(false);

  async function handleExpand(membership: Membership) {
    if (expandedOrgId === membership.orgId) {
      setExpandedOrgId(null);
      return;
    }
    setExpandedOrgId(membership.orgId);
    setTeams(null);
    setLoadingTeams(true);
    const teamList = await organizationGateway.listTeams(membership.orgId);
    const accessEntries = await Promise.all(
      teamList.map(async (team) => {
        const access = await organizationGateway.getMyTeamAccess(
          membership.orgId,
          team.teamId,
          membership.role,
        );
        return [team.teamId, access] as const;
      }),
    );
    setTeamAccess(Object.fromEntries(accessEntries));
    setTeams(teamList);
    setLoadingTeams(false);
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">{t(lang, 'contextSwitcherTitle')}</h1>
      </header>
      <main className="app-main">
        <ul className="context-switcher__orgs">
          {memberships.map((membership) => (
            <li key={membership.orgId} className="context-switcher__org">
              <button
                type="button"
                data-testid={`context-org-${membership.orgId}`}
                onClick={() => void handleExpand(membership)}
              >
                {membership.orgName}
              </button>
              {expandedOrgId === membership.orgId ? (
                loadingTeams ? (
                  <p>{t(lang, 'contextSwitcherTeamsLoading')}</p>
                ) : (
                  <ul className="context-switcher__teams">
                    {(teams ?? []).map((team) => (
                      <li key={team.teamId}>
                        <button
                          type="button"
                          data-testid={`context-team-${team.teamId}`}
                          onClick={() => onSelect({ orgId: membership.orgId, teamId: team.teamId })}
                        >
                          {team.name} — {teamAccess[team.teamId]?.effectiveRole ?? membership.role}
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

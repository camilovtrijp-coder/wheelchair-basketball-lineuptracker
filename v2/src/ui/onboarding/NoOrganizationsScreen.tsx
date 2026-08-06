import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import type { OrganizationGateway } from '../../application/organizations/OrganizationGateway';

export interface NoOrganizationsScreenProps {
  lang: Lang;
  /** Waarom de gebruiker hier is: verse registratie zonder org, of alle memberships kwijt. */
  reason: 'fresh-signup' | 'lost-all-memberships';
  organizationGateway: OrganizationGateway;
  onCreated: () => void;
}

function t(lang: Lang, key: StringKey): string {
  return translate(lang, key);
}

export function NoOrganizationsScreen({
  lang,
  reason,
  organizationGateway,
  onCreated,
}: NoOrganizationsScreenProps) {
  const [orgName, setOrgName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title =
    reason === 'fresh-signup'
      ? t(lang, 'onboardingFreshSignupTitle')
      : t(lang, 'onboardingLostMembershipsTitle');
  const body =
    reason === 'fresh-signup'
      ? t(lang, 'onboardingFreshSignupBody')
      : t(lang, 'onboardingLostMembershipsBody');

  async function handleSubmit(event: JSX.TargetedEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const orgResult = await organizationGateway.createOrganizationWithOwner(orgName.trim());
    if (!orgResult.ok || !orgResult.value) {
      setSubmitting(false);
      setError(t(lang, 'authGenericError'));
      return;
    }

    const teamResult = await organizationGateway.createTeam(orgResult.value.orgId, teamName.trim());
    setSubmitting(false);
    if (!teamResult.ok) {
      setError(t(lang, 'authGenericError'));
      return;
    }

    onCreated();
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">{title}</h1>
      </header>
      <main className="app-main">
        <p data-testid="no-organizations-body">{body}</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-form__field">
            {t(lang, 'onboardingOrgNameLabel')}
            <input
              required
              value={orgName}
              data-testid="onboarding-org-name"
              onInput={(event) => setOrgName((event.target as HTMLInputElement).value)}
            />
          </label>
          <label className="auth-form__field">
            {t(lang, 'onboardingTeamNameLabel')}
            <input
              required
              value={teamName}
              data-testid="onboarding-team-name"
              onInput={(event) => setTeamName((event.target as HTMLInputElement).value)}
            />
          </label>
          {error ? (
            <p className="auth-form__error" role="alert" data-testid="onboarding-error">
              {error}
            </p>
          ) : null}
          <button type="submit" data-testid="onboarding-submit" disabled={submitting}>
            {t(lang, 'onboardingCreateBtn')}
          </button>
        </form>
      </main>
    </div>
  );
}

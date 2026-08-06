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
  // Onthoudt voortgang tussen pogingen zodat een retry na een gedeeltelijke mislukking de
  // al geslaagde stappen niet herhaalt: anders maakt een retry na een mislukte createTeam()
  // een TWEEDE organisatie aan (de eerste, met een geldige owner-membership, blijft dan als
  // duplicaat achter), en zonder `bootstrapOrgId` kan een mislukte membership-write ná een
  // geslaagde org-write nooit meer hersteld worden (de gebruiker kan die wees-organisatie
  // zonder membership niet zelf verwijderen — Rules eisen daarvoor een membership).
  const [bootstrapOrgId, setBootstrapOrgId] = useState<string | null>(null);
  const [orgReady, setOrgReady] = useState(false);

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

    let orgId = bootstrapOrgId;
    if (!orgReady) {
      const orgResult = await organizationGateway.createOrganizationWithOwner(
        orgName.trim(),
        orgId ?? undefined,
      );
      if (!orgResult.ok || !orgResult.value) {
        setSubmitting(false);
        setError(t(lang, 'authGenericError'));
        // Als de organisatie zelf al bestaat (alleen de membership-write mislukte), onthouden
        // we het orgId zodat een volgende poging dat hervat i.p.v. een tweede, wees geworden
        // organisatie aan te maken.
        if (orgResult.value) setBootstrapOrgId(orgResult.value.orgId);
        return;
      }
      orgId = orgResult.value.orgId;
      setBootstrapOrgId(orgId);
      setOrgReady(true);
    }

    const teamResult = await organizationGateway.createTeam(orgId!, teamName.trim());
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

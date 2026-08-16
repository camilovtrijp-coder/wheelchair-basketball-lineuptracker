import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { translate, type Lang, type StringKey } from '../../i18n/strings';
import type {
  OperationResult,
  OrganizationGateway,
} from '../../application/organizations/OrganizationGateway';
import { browserStorage } from '../../i18n/browserStorage';
import {
  clearBootstrapOrgId,
  readBootstrapOrgId,
  writeBootstrapOrgId,
} from '../../infrastructure/onboarding/bootstrapProgress';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `createTeam()`'s Rule (`isOrgOwnerOrAdmin`) doet een verse server-side lezing van het
 * owner-membership-document dat `createOrganizationWithOwner()` zojuist heeft weggeschreven.
 * Ondanks dat die eerdere write al door de client als bevestigd is teruggekregen, is empirisch
 * bevestigd dat de daaropvolgende `createTeam()`-aanroep hier soms nog een `permission-denied`
 * op kan lopen — een kort venster waarin de Rule-engine het net geschreven document nog niet
 * ziet (des te waarschijnlijker nu een live `subscribeMyMemberships()`-abonnement extra
 * leesverkeer genereert in exact datzelfde venster, PR 5.5c-bugfixes bug 6/9). Een paar keer
 * kort opnieuw proberen is goedkoper en betrouwbaarder dan de gebruiker een generieke foutmelding
 * te tonen voor iets dat een fractie van een seconde later gewoon lukt.
 */
async function createTeamWithRetry(
  gateway: OrganizationGateway,
  orgId: string,
  name: string,
): Promise<OperationResult<{ teamId: string }>> {
  let result = await gateway.createTeam(orgId, name);
  for (const backoffMs of [200, 500, 1000]) {
    if (result.ok || result.errorCode !== 'permission-denied') break;
    await delay(backoffMs);
    result = await gateway.createTeam(orgId, name);
  }
  return result;
}

export interface NoOrganizationsScreenProps {
  lang: Lang;
  /** Waarom de gebruiker hier is: verse registratie zonder org, of alle memberships kwijt. */
  reason: 'fresh-signup' | 'lost-all-memberships';
  organizationGateway: OrganizationGateway;
  /**
   * Meldt AuthGate wanneer de org+team-aanmaakflow bezig is (`true`) resp. afgerond of gestopt
   * is (`false`). Nodig omdat het live `subscribeMyMemberships()`-abonnement (PR 5.5c-bugfixes
   * bug 9) de contextwisselaar al toont zodra de EERSTE van de twee schrijfacties (de
   * organisatie/membership) lokaal geëchood is — dus mogelijk vóórdat `createTeam()` hieronder
   * zelfs maar gestart is. Zolang deze flag `true` is, blijft AuthGate dit scherm tonen, ook als
   * de afgeleide state intussen al 'context-switcher' zou zijn.
   */
  onBootstrapInFlightChange: (inFlight: boolean) => void;
}

function t(lang: Lang, key: StringKey): string {
  return translate(lang, key);
}

export function NoOrganizationsScreen({
  lang,
  reason,
  organizationGateway,
  onBootstrapInFlightChange,
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
  // Gepersisteerd (niet alleen componentstate) zodat dit ook een reload/crash halverwege de
  // onboarding-flow overleeft — puur in-memory state zou dan alsnog een tweede organisatie
  // toestaan. `orgReady` blijft bewust wél puur componentstate: na een reload weten we niet
  // zeker of de membership-write destijds slaagde, en `createOrganizationWithOwner()`'s
  // resumepad controleert dat zelf al veilig/idempotent (zie de gateway-toelichting).
  const [bootstrapOrgId, setBootstrapOrgId] = useState<string | null>(() =>
    readBootstrapOrgId(browserStorage),
  );
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
    // Vóór de eerste write al aanzetten: het live subscribeMyMemberships()-abonnement in
    // AuthGate kan al op de (nog te starten) membership-write reageren zodra die lokaal
    // geëchood wordt — deze flag moet dus al aanstaan vóórdat die write onderweg is, niet pas
    // erna.
    onBootstrapInFlightChange(true);

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
        // we het orgId zodat een volgende poging — ook na een reload/crash — dat hervat i.p.v.
        // een tweede, wees geworden organisatie aan te maken.
        if (orgResult.value) {
          setBootstrapOrgId(orgResult.value.orgId);
          writeBootstrapOrgId(browserStorage, orgResult.value.orgId);
        }
        onBootstrapInFlightChange(false);
        return;
      }
      orgId = orgResult.value.orgId;
      setBootstrapOrgId(orgId);
      writeBootstrapOrgId(browserStorage, orgId);
      setOrgReady(true);
    }

    const teamResult = await createTeamWithRetry(organizationGateway, orgId!, teamName.trim());
    setSubmitting(false);
    if (!teamResult.ok) {
      setError(t(lang, 'authGenericError'));
      onBootstrapInFlightChange(false);
      return;
    }

    clearBootstrapOrgId(browserStorage);
    // Het net aangemaakte membership komt vanzelf door via het live
    // subscribeMyMemberships()-abonnement (PR 5.5c-bugfixes bug 9) — nu het team ook
    // bestaat, mag AuthGate de contextwisselaar tonen.
    onBootstrapInFlightChange(false);
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

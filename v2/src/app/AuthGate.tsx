import { useEffect, useMemo, useState } from 'preact/hooks';
import { browserStorage } from '../i18n/browserStorage';
import { readLang, writeLang } from '../i18n/persistence';
import { resolveInitialLang } from '../i18n/detect';
import type { Lang } from '../i18n/strings';
import type { AuthGateway, AuthResult } from '../application/auth/AuthGateway';
import type { OrganizationGateway } from '../application/organizations/OrganizationGateway';
import type { AuthUser } from '../domain/auth/types';
import type { Membership, SelectedContext, TeamOnlyContext } from '../domain/organizations/types';
import { deriveAppState } from '../domain/organizations/deriveAppState';
import { mergeMemberships } from '../domain/organizations/mergeMemberships';
import { readTrustedDevice, writeTrustedDevice } from '../infrastructure/device/trustedDevice';
import {
  clearSelectedContext,
  readSelectedContext,
  writeSelectedContext,
} from '../infrastructure/context/selectedContext';
import {
  clearInvitationLinkFromUrl,
  parseInvitationLink,
  type InvitationLinkParams,
} from '../infrastructure/invitations/invitationLink';
import {
  getFirestoreDb,
  initFirebase,
  reinitFirestoreForTrustLevel,
  wipeLocalFirebaseData,
} from '../infrastructure/firebase/firebaseClient';
import { FirestoreOrganizationGateway } from '../infrastructure/organizations/FirestoreOrganizationGateway';
import { selectRepositories } from '../infrastructure/repositories/selectRepositories';
import { resolveAppRepositories } from '../infrastructure/repositories/resolveAppRepositories';
import { useSyncStatus } from '../application/sync/useSyncStatus';
import { downloadPendingPayload } from '../infrastructure/sync/exportPendingPayload';
import { LoginScreen } from '../ui/auth/LoginScreen';
import { SignupScreen } from '../ui/auth/SignupScreen';
import { TrustedDevicePrompt } from '../ui/auth/TrustedDevicePrompt';
import { LoadingScreen } from '../ui/status/LoadingScreen';
import { OfflineUncachedScreen } from '../ui/status/OfflineUncachedScreen';
import { ContextRevokedScreen } from '../ui/status/ContextRevokedScreen';
import { NoOrganizationsScreen } from '../ui/onboarding/NoOrganizationsScreen';
import { ContextSwitcher } from '../ui/context/ContextSwitcher';
import { SessionBar } from '../ui/context/SessionBar';
import { ActionNeededPanel } from '../ui/sync/ActionNeededPanel';
import { AcceptInvitationScreen } from '../ui/invitations/AcceptInvitationScreen';
import { translate } from '../i18n/strings';
import { App } from './App';

function initialLang(): Lang {
  const stored = readLang(browserStorage);
  return resolveInitialLang(
    typeof navigator !== 'undefined' ? navigator.language : undefined,
    stored,
  );
}

function initialOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

function initialInvitationLink(): InvitationLinkParams | null {
  return typeof window === 'undefined' ? null : parseInvitationLink(window.location.search);
}

export interface AuthGateProps {
  authGateway: AuthGateway;
}

type AuthFormMode = 'login' | 'signup';

/**
 * Zit vóór de bestaande, ongewijzigde `App` en beslist — via
 * `deriveAppState()` — of die getoond mag worden. Beheert een eigen `lang`-
 * status omdat login/signup-schermen gerenderd worden vóórdat `App` (met
 * zijn eigen `lang`-status) bestaat.
 */
export function AuthGate({ authGateway }: AuthGateProps) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [online, setOnline] = useState<boolean>(initialOnline);
  const [authLoading, setAuthLoading] = useState(true);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [mode, setMode] = useState<AuthFormMode>('login');
  const [trustedDeviceAnswered, setTrustedDeviceAnswered] = useState(
    () => readTrustedDevice(browserStorage) !== null,
  );
  const [organizationGateway, setOrganizationGateway] = useState<OrganizationGateway | null>(null);
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [teamOnlyContexts, setTeamOnlyContexts] = useState<TeamOnlyContext[]>([]);
  const [membershipsRefreshKey, setMembershipsRefreshKey] = useState(0);
  const [justSignedUp, setJustSignedUp] = useState(false);
  const [selectedContext, setSelectedContext] = useState<SelectedContext | null>(() =>
    readSelectedContext(browserStorage),
  );
  const [selectedContextTeamValid, setSelectedContextTeamValid] = useState<boolean | null>(null);
  const [pendingInvitationLink, setPendingInvitationLink] = useState<InvitationLinkParams | null>(
    initialInvitationLink,
  );

  useEffect(() => {
    document.documentElement.lang = lang;
    writeLang(browserStorage, lang);
  }, [lang]);

  useEffect(() => {
    function handleOnline() {
      setOnline(true);
    }
    function handleOffline() {
      setOnline(false);
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    return authGateway.subscribe((user) => {
      setAuthUser(user);
      setAuthLoading(false);
      // Zonder deze reset blijft een eerder gekozen 'signup'-modus staan na
      // uitloggen, waardoor herinloggen per ongeluk een nieuw account met
      // hetzelfde e-mailadres probeert aan te maken (auth/email-already-in-use).
      if (user === null) {
        setMode('login');
      }
    });
  }, [authGateway]);

  useEffect(() => {
    if (!authUser || !trustedDeviceAnswered) {
      setOrganizationGateway(null);
      setMemberships(null);
      setTeamOnlyContexts([]);
      return;
    }
    const gateway = new FirestoreOrganizationGateway(
      getFirestoreDb(),
      authUser.uid,
      authUser.email ?? '',
    );
    setOrganizationGateway(gateway);
    let cancelled = false;
    // Beide toegestane membershipbronnen (issue #31) samen ophalen en pas daarna samenvoegen —
    // net als bij de enkele query hieronder blijft `memberships` bij een netwerkfout op `null`
    // staan ("nog niet geladen"/ongecacht), i.p.v. een onvolledige gedeeltelijke lijst te tonen.
    Promise.all([gateway.listMyMemberships(), gateway.listMyTeamOnlyContexts()])
      .then(([orgMemberships, teamOnly]) => {
        if (cancelled) return;
        setMemberships(mergeMemberships(orgMemberships, teamOnly));
        setTeamOnlyContexts(teamOnly);
      })
      .catch(() => {
        // Netwerkfout: memberships blijft null ("nog niet geladen"/ongecacht).
      });
    return () => {
      cancelled = true;
    };
  }, [authUser, trustedDeviceAnswered, membershipsRefreshKey]);

  // Hervalideert de TEAM-kant van een geselecteerde context (zie deriveAppState's
  // selectedContextTeamValid): puur organisatielidmaatschap miste een ingetrokken,
  // verwijderd of via localStorage vervalst teamId. Draait opnieuw zodra de context
  // wisselt of memberships verversen (bijv. na een reload).
  useEffect(() => {
    if (!organizationGateway || !selectedContext || !memberships) {
      setSelectedContextTeamValid(null);
      return;
    }
    const membership = memberships.find((m) => m.orgId === selectedContext.orgId);
    if (!membership) {
      setSelectedContextTeamValid(null);
      return;
    }
    setSelectedContextTeamValid(null);
    let cancelled = false;
    organizationGateway
      .validateSelectedTeam(selectedContext.orgId, selectedContext.teamId, membership.role)
      .then((valid) => {
        if (!cancelled) setSelectedContextTeamValid(valid);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationGateway, selectedContext, memberships]);

  async function handleSignUp(email: string, password: string): Promise<AuthResult> {
    const result = await authGateway.signUp(email, password);
    if (result.ok) {
      setJustSignedUp(true);
    }
    return result;
  }

  async function handleTrustedDeviceAnswer(trusted: boolean) {
    writeTrustedDevice(browserStorage, trusted);
    await reinitFirestoreForTrustLevel(trusted);
    setTrustedDeviceAnswered(true);
  }

  async function handleSignOut() {
    // Vertrouwd-apparaatkeuze is een apparaateigenschap, geen sessie-eigenschap
    // — die blijft bewust staan na uitloggen (zie infrastructure/device/trustedDevice.ts).
    const trusted = readTrustedDevice(browserStorage) ?? false;
    await authGateway.signOut();
    if (!trusted) {
      await wipeLocalFirebaseData();
      // Firestore moet weer bruikbaar zijn voor een eventuele volgende login in dezelfde sessie.
      initFirebase(false);
    }
  }

  function handleSelectContext(context: SelectedContext) {
    writeSelectedContext(browserStorage, context);
    setSelectedContext(context);
  }

  function handleBackToSwitcher() {
    clearSelectedContext(browserStorage);
    setSelectedContext(null);
  }

  function handleInvitationDismiss() {
    clearInvitationLinkFromUrl();
    setPendingInvitationLink(null);
  }

  function handleInvitationResolved() {
    clearInvitationLinkFromUrl();
    setPendingInvitationLink(null);
    // Nieuw membership erbij: forceer een verse listMyMemberships()-call zodat
    // de contextwisselaar de zojuist geclaimde organisatie direct toont.
    setMembershipsRefreshKey((key) => key + 1);
  }

  // Alleen relevant in de 'active'-state hieronder, maar als Hook vóór elke
  // early return berekend (Rules of Hooks). getFirestoreDb() mag pas worden
  // aangeroepen zodra Firebase gegarandeerd geïnitialiseerd is — dezelfde
  // guard als de organizationGateway-effect hierboven — anders crasht een
  // render vóór inloggen. Zonder authUser/trustedDeviceAnswered blijft de
  // keuze dus altijd 'local', ongeacht wat selectRepositories() zelf al
  // afdwingt (zie docs/pr-5.3-plan.md §C/5.3c-1).
  const repositories = useMemo(() => {
    if (!authUser || !trustedDeviceAnswered) {
      return resolveAppRepositories({ kind: 'local' }, browserStorage);
    }
    const trustedDevice = readTrustedDevice(browserStorage) ?? false;
    return resolveAppRepositories(
      selectRepositories({
        authUser,
        selectedContext,
        trustedDevice,
        firestoreDb: getFirestoreDb(),
      }),
      browserStorage,
    );
  }, [authUser, trustedDeviceAnswered, selectedContext]);

  // Hook, dus onvoorwaardelijk vóór elke early return (Rules of Hooks) — net
  // als `repositories` hierboven. Zonder cloud-context blijft `pending` altijd
  // leeg en `status` op 'gesynchroniseerd' staan; App/SessionBar tonen 'm dan
  // toch niet (mode !== 'cloud'), zie hieronder.
  const syncStatus = useSyncStatus(repositories);

  if (authLoading) {
    return <LoadingScreen lang={lang} />;
  }

  if (authUser && trustedDeviceAnswered && pendingInvitationLink && organizationGateway) {
    return (
      <AcceptInvitationScreen
        lang={lang}
        authUser={authUser}
        link={pendingInvitationLink}
        organizationGateway={organizationGateway}
        onResolved={handleInvitationResolved}
        onDismiss={handleInvitationDismiss}
        onResendVerification={() => authGateway.sendVerificationEmail()}
      />
    );
  }

  const appState = deriveAppState({
    online,
    authUser,
    trustedDeviceAnswered,
    memberships,
    selectedContext,
    selectedContextTeamValid,
    hasEverHadMemberships: !justSignedUp,
  });

  switch (appState.kind) {
    case 'not-logged-in': {
      const invitationBanner = pendingInvitationLink
        ? translate(lang, 'invitationLoginHint')
        : undefined;
      return mode === 'login' ? (
        <LoginScreen
          lang={lang}
          onSwitchLang={setLang}
          onSubmit={(email, password) => authGateway.signIn(email, password)}
          onSwitchToSignup={() => setMode('signup')}
          banner={invitationBanner}
        />
      ) : (
        <SignupScreen
          lang={lang}
          onSwitchLang={setLang}
          onSubmit={handleSignUp}
          onSwitchToLogin={() => setMode('login')}
          banner={invitationBanner}
        />
      );
    }

    case 'trusted-device-prompt':
      return <TrustedDevicePrompt lang={lang} onAnswer={handleTrustedDeviceAnswer} />;

    case 'loading':
      return <LoadingScreen lang={lang} />;

    case 'uncached-offline':
      return <OfflineUncachedScreen lang={lang} />;

    case 'no-organizations':
      return (
        <NoOrganizationsScreen
          lang={lang}
          reason={appState.reason}
          organizationGateway={organizationGateway!}
          onCreated={() => setMembershipsRefreshKey((key) => key + 1)}
        />
      );

    case 'context-switcher':
      return (
        <ContextSwitcher
          lang={lang}
          memberships={memberships!}
          teamOnlyContexts={teamOnlyContexts}
          organizationGateway={organizationGateway!}
          onSelect={handleSelectContext}
        />
      );

    case 'selected-context-revoked':
      return <ContextRevokedScreen lang={lang} onBackToSwitcher={handleBackToSwitcher} />;

    case 'active':
      return (
        <>
          <SessionBar
            lang={lang}
            onSignOut={handleSignOut}
            onSwitchContext={handleBackToSwitcher}
            syncStatus={repositories.mode === 'cloud' ? syncStatus.status : undefined}
          />
          {repositories.mode === 'cloud' && syncStatus.pending.length > 0 ? (
            <ActionNeededPanel
              lang={lang}
              pending={syncStatus.pending}
              onRetry={syncStatus.retry}
              onDismiss={syncStatus.dismiss}
              onExport={(kind) => {
                const item = syncStatus.pending.find((p) => p.kind === kind);
                if (item) downloadPendingPayload(item);
              }}
            />
          ) : null}
          <App repositories={repositories} syncStatus={syncStatus} />
        </>
      );
  }
}

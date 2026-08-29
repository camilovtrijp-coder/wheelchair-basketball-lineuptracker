import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { browserStorage, listBrowserStorageKeys } from '../i18n/browserStorage';
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
import { clearLocalDeviceData } from '../infrastructure/device/clearLocalDeviceData';
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
  const [justSignedUp, setJustSignedUp] = useState(false);
  const [selectedContext, setSelectedContext] = useState<SelectedContext | null>(() =>
    readSelectedContext(browserStorage),
  );
  const [selectedContextTeamValid, setSelectedContextTeamValid] = useState<boolean | null>(null);
  // PR 5.4a: rol-grens in de UI. Wordt in hetzelfde effect als selectedContextTeamValid
  // berekend (uit dezelfde validateSelectedTeam()-call), dus zonder extra Firestore-read.
  // `null` = nog aan het evalueren; in de 'active'-state wordt dit doorgegeven aan
  // <App canWrite=... /> zodat SettingsPanel/RosterPanel de schrijfknoppen hiden/disablen.
  const [selectedContextCanWrite, setSelectedContextCanWrite] = useState<boolean | null>(null);
  // PR 6.1-review (aug. 2026): aparte, ruimere bevoegdheid voor de wedstrijd-UI
  // (owner/admin/coach/scorer) — zie domain/organizations/teamAccess.ts,
  // `canWriteGameData`. Berekend in hetzelfde effect/dezelfde call als
  // selectedContextCanWrite hierboven, dus zonder extra Firestore-read.
  const [selectedContextCanWriteGame, setSelectedContextCanWriteGame] = useState<boolean | null>(
    null,
  );
  const [pendingInvitationLink, setPendingInvitationLink] = useState<InvitationLinkParams | null>(
    initialInvitationLink,
  );
  // Zie NoOrganizationsScreenProps.onBootstrapInFlightChange: houdt dat scherm zichtbaar
  // zolang de org+team-aanmaakflow bezig is, ook als het live subscribeMyMemberships()-
  // abonnement de afgeleide state al naar 'context-switcher' laat springen op basis van
  // alleen de (eerdere) membership-write.
  const [bootstrapInFlight, setBootstrapInFlight] = useState(false);
  const lastNoOrganizationsReason = useRef<'fresh-signup' | 'lost-all-memberships'>('fresh-signup');
  // Zie de toelichting bij het membership-abonnement hieronder: laat de subscribeMyMemberships/
  // subscribeMyTeamOnlyContexts-effect lezen of er al een context actief gekozen is, zonder dat
  // effect zelf opnieuw te hoeven laten draaien bij elke contextwissel.
  const selectedContextRef = useRef<SelectedContext | null>(selectedContext);
  useEffect(() => {
    selectedContextRef.current = selectedContext;
  }, [selectedContext]);

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
    // Beide toegestane membershipbronnen (issue #31) live volgen en pas samenvoegen zodra
    // beide minstens één keer geleverd hebben (PR 5.5c-bugfixes bug 6/9): `onSnapshot`
    // i.p.v. een eenmalige fetch levert bij een offline paginaherlaad direct de gecachete
    // lijst (i.p.v. `memberships` op `null` te laten staan), en een net aangemaakt/geclaimd
    // membership komt via Firestores lokale-schrijf-echo meteen door.
    //
    // Bevriest zodra een context al actief gekozen is (op één uitzondering na, zie
    // hasPublishedOnce hieronder): elke wijziging in het lidmaatschap/de teamrol van de
    // gebruiker terwijl die al actief in een context zit — intrekking, maar bijv. ook een
    // live rolverlaging (game-sync-real-rules-rejection.spec.ts) — mag niet live de sessie
    // verstoren (canWrite/canWriteGame herberekenen, of de hele app naar een ander scherm laten
    // springen). Dat blijft, zoals vóór dit live-abonnement, pas zichtbaar via een afgewezen
    // write of een expliciete reload (action-needed-panel.spec.ts, backup-cloud-reject.spec.ts,
    // game-sync-real-rules-rejection.spec.ts, en de reload-gebaseerde
    // revoke-access-isolation.spec.ts/team-level-authorization.spec.ts/team-only-membership.spec.ts).
    // Een reload maakt dit effect opnieuw aan (verse maps, `hasPublishedOnce` weer `false`), dus
    // wijzigingen blijven daar wél meteen zichtbaar.
    const seenMemberships = new Map<string, Membership>();
    const seenTeamOnly = new Map<string, TeamOnlyContext>();
    let membershipsLoaded = false;
    let teamOnlyLoaded = false;
    // De EERSTE publicatie moet altijd doorkomen, ook als er (uit localStorage herstelde) al
    // een selectedContext is — anders blijft de app bij een reload met een reeds gekozen
    // context voor altijd op 'loading'/'uncached-offline' hangen (PR 5.5c-bugfixes bug 6).
    let hasPublishedOnce = false;
    function publish() {
      if (!membershipsLoaded || !teamOnlyLoaded) return;
      if (hasPublishedOnce && selectedContextRef.current !== null) return;
      hasPublishedOnce = true;
      const teamOnly = Array.from(seenTeamOnly.values());
      setMemberships(mergeMemberships(Array.from(seenMemberships.values()), teamOnly));
      setTeamOnlyContexts(teamOnly);
    }
    const unsubscribeMemberships = gateway.subscribeMyMemberships((result) => {
      for (const membership of result) {
        seenMemberships.set(membership.orgId, membership);
      }
      membershipsLoaded = true;
      publish();
    });
    const unsubscribeTeamOnly = gateway.subscribeMyTeamOnlyContexts((result) => {
      for (const context of result) {
        seenTeamOnly.set(context.teamId, context);
      }
      teamOnlyLoaded = true;
      publish();
    });
    return () => {
      unsubscribeMemberships();
      unsubscribeTeamOnly();
    };
  }, [authUser, trustedDeviceAnswered]);

  // Hervalideert de TEAM-kant van een geselecteerde context (zie deriveAppState's
  // selectedContextTeamValid): puur organisatielidmaatschap miste een ingetrokken,
  // verwijderd of via localStorage vervalst teamId. Levert daarnaast canManageTeamData
  // (PR 5.4a) — dezelfde call, geen extra Firestore-read — die de UI gebruikt om
  // schrijfknoppen te hiden/disablen voor rollen die geen teamdata mogen bewerken.
  // Draait opnieuw zodra de context wisselt of memberships verversen (bijv. na een reload).
  useEffect(() => {
    if (!organizationGateway || !selectedContext || !memberships) {
      setSelectedContextTeamValid(null);
      setSelectedContextCanWrite(null);
      setSelectedContextCanWriteGame(null);
      return;
    }
    const membership = memberships.find((m) => m.orgId === selectedContext.orgId);
    if (!membership) {
      setSelectedContextTeamValid(null);
      setSelectedContextCanWrite(null);
      setSelectedContextCanWriteGame(null);
      return;
    }
    setSelectedContextTeamValid(null);
    setSelectedContextCanWrite(null);
    setSelectedContextCanWriteGame(null);
    let cancelled = false;
    organizationGateway
      .validateSelectedTeam(selectedContext.orgId, selectedContext.teamId, membership.role)
      .then((result) => {
        if (cancelled) return;
        setSelectedContextTeamValid(result.valid);
        setSelectedContextCanWrite(result.canManageTeamData);
        setSelectedContextCanWriteGame(result.canWriteGameData);
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
      // listBrowserStorageKeys() i.p.v. alleen de huidige context: dit
      // apparaat kan eerder AL een andere org/team gebruikt hebben (§B punt
      // 5, na de externe review op PR #84) — clearLocalDeviceData() wist
      // die dan mee, niet alleen de sessie die nu wordt afgesloten.
      clearLocalDeviceData(browserStorage, listBrowserStorageKeys());
    }
  }

  /**
   * PR 8.2c (docs/pr-8.2-plan.md §B punt 5, tweede subpunt): herroepbare
   * vertrouwd-apparaat-instelling, aangeroepen vanuit `SessionBar`. Bij een
   * wissel naar onvertrouwd triggert dit dezelfde wis-/herinitialisatie-
   * logica als `handleSignOut()`'s onvertrouwd-apparaatpad. De actieve
   * `organizationGateway`/`repositories` (en hun Firestore-abonnementen)
   * zijn al gebouwd op de OUDE cachemodus/db-instantie — i.p.v. die live te
   * proberen vervangen (breekbaar, zie `reinitFirestoreForTrustLevel()`'s
   * `terminate()`) herlaadt dit de pagina; `main.tsx` initialiseert Firebase
   * daarna vanaf nul met de nieuwe, net weggeschreven trustedDevice-waarde
   * (zelfde patroon als de PWA-update-reload in `PwaUpdateAdapter.ts`).
   */
  async function handleChangeTrustedDevice(trusted: boolean) {
    const wasTrusted = readTrustedDevice(browserStorage) ?? false;
    if (trusted === wasTrusted) return;
    writeTrustedDevice(browserStorage, trusted);
    if (!trusted) {
      await wipeLocalFirebaseData();
      clearLocalDeviceData(browserStorage, listBrowserStorageKeys());
    }
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  function handleSelectContext(context: SelectedContext) {
    writeSelectedContext(browserStorage, context);
    setSelectedContext(context);
  }

  /**
   * PR 7.3a (docs/pr-7.3-plan.md §B/§C 7.3a werk 4): "Vergrendel organisatie/
   * teamcontext zodra een wedstrijd tracking/claim heeft; navigeren mag,
   * maar wisselen naar een andere context vereist eerst stoppen of expliciet
   * loslaten volgens het protocol." `App` meldt de actuele lockstatus via
   * `onGameLockChange` (zie `app/App.tsx`) — een `true` waarde blokkeert
   * `handleBackToSwitcher()` hieronder in plaats van de context stil te
   * wissen/wissen. Er bestaat in 7.3a nog geen "expliciet loslaten"-actie
   * (dat is 7.3c-scope, de overname-/recovery-flow); tot die tijd is de
   * enige uitweg de wedstrijd zelf afronden.
   */
  const [gameLocked, setGameLocked] = useState(false);
  const [switchBlockedNotice, setSwitchBlockedNotice] = useState(false);
  useEffect(() => {
    if (!gameLocked) setSwitchBlockedNotice(false);
  }, [gameLocked]);

  function handleBackToSwitcher() {
    if (gameLocked) {
      setSwitchBlockedNotice(true);
      return;
    }
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
    // Het net geclaimde membership komt vanzelf door via het live
    // subscribeMyMemberships()-abonnement (zie de organizationGateway-effect
    // hierboven) — geen handmatige refresh meer nodig.
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
        storage: browserStorage,
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
        onRefreshIdToken={() => authGateway.refreshIdToken()}
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

  // Zie de toelichting bij bootstrapInFlight hierboven: het live membership-abonnement mag de
  // org+team-aanmaakflow niet preemptief afbreken zodra alleen de membership-write lokaal
  // geëchood is — createTeam() kan op dat moment nog steeds bezig zijn, en zonder deze gate
  // zou de contextwisselaar een organisatie zonder enig team tonen (ContextSwitcher's
  // listTeams() is geen live abonnement, dus dat team zou daar nooit meer vanzelf verschijnen).
  if (bootstrapInFlight && appState.kind !== 'no-organizations') {
    return (
      <NoOrganizationsScreen
        lang={lang}
        reason={lastNoOrganizationsReason.current}
        organizationGateway={organizationGateway!}
        onBootstrapInFlightChange={setBootstrapInFlight}
      />
    );
  }

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
      lastNoOrganizationsReason.current = appState.reason;
      return (
        <NoOrganizationsScreen
          lang={lang}
          reason={appState.reason}
          organizationGateway={organizationGateway!}
          onBootstrapInFlightChange={setBootstrapInFlight}
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
            syncFromCache={repositories.mode === 'cloud' ? syncStatus.fromCache : undefined}
            email={authUser?.email}
            trustedDevice={readTrustedDevice(browserStorage) ?? false}
            onChangeTrustedDevice={handleChangeTrustedDevice}
          />
          {switchBlockedNotice ? (
            <p className="settings-error" role="alert" data-testid="context-switch-locked-notice">
              {translate(lang, 'contextSwitchLockedWhileTracking')}{' '}
              <button
                type="button"
                data-testid="context-switch-locked-dismiss"
                onClick={() => setSwitchBlockedNotice(false)}
              >
                {translate(lang, 'contextSwitchLockedDismiss')}
              </button>
            </p>
          ) : null}
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
          <App
            repositories={repositories}
            syncStatus={syncStatus}
            canWrite={selectedContextCanWrite ?? false}
            canWriteGame={selectedContextCanWriteGame ?? false}
            organizationId={selectedContext?.orgId ?? ''}
            teamId={selectedContext?.teamId ?? ''}
            organizationName={
              memberships?.find((m) => m.orgId === selectedContext?.orgId)?.orgName ??
              selectedContext?.orgId ??
              ''
            }
            onGameLockChange={setGameLocked}
            // PR 7.4c: dezelfde membership-lookup als organizationName
            // hierboven, geen extra Firestore-read — bepaalt of
            // `MigrationPanel` (bulkmigratie) getoond wordt.
            organizationRole={
              memberships?.find((m) => m.orgId === selectedContext?.orgId)?.role ?? null
            }
          />
        </>
      );
  }
}

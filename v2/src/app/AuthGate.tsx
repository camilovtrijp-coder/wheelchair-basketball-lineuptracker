import { useEffect, useState } from 'preact/hooks';
import { browserStorage } from '../i18n/browserStorage';
import { readLang, writeLang } from '../i18n/persistence';
import { resolveInitialLang } from '../i18n/detect';
import type { Lang } from '../i18n/strings';
import type { AuthGateway, AuthResult } from '../application/auth/AuthGateway';
import type { OrganizationGateway } from '../application/organizations/OrganizationGateway';
import type { AuthUser } from '../domain/auth/types';
import type { Membership, SelectedContext } from '../domain/organizations/types';
import { deriveAppState } from '../domain/organizations/deriveAppState';
import { readTrustedDevice, writeTrustedDevice } from '../infrastructure/device/trustedDevice';
import {
  clearSelectedContext,
  readSelectedContext,
  writeSelectedContext,
} from '../infrastructure/context/selectedContext';
import {
  getFirestoreDb,
  initFirebase,
  reinitFirestoreForTrustLevel,
  wipeLocalFirebaseData,
} from '../infrastructure/firebase/firebaseClient';
import { FirestoreOrganizationGateway } from '../infrastructure/organizations/FirestoreOrganizationGateway';
import { LoginScreen } from '../ui/auth/LoginScreen';
import { SignupScreen } from '../ui/auth/SignupScreen';
import { TrustedDevicePrompt } from '../ui/auth/TrustedDevicePrompt';
import { LoadingScreen } from '../ui/status/LoadingScreen';
import { OfflineUncachedScreen } from '../ui/status/OfflineUncachedScreen';
import { ContextRevokedScreen } from '../ui/status/ContextRevokedScreen';
import { NoOrganizationsScreen } from '../ui/onboarding/NoOrganizationsScreen';
import { ContextSwitcher } from '../ui/context/ContextSwitcher';
import { SessionBar } from '../ui/context/SessionBar';
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
  const [membershipsRefreshKey, setMembershipsRefreshKey] = useState(0);
  const [justSignedUp, setJustSignedUp] = useState(false);
  const [selectedContext, setSelectedContext] = useState<SelectedContext | null>(() =>
    readSelectedContext(browserStorage),
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
      return;
    }
    const gateway = new FirestoreOrganizationGateway(
      getFirestoreDb(),
      authUser.uid,
      authUser.email ?? '',
    );
    setOrganizationGateway(gateway);
    let cancelled = false;
    gateway
      .listMyMemberships()
      .then((result) => {
        if (!cancelled) setMemberships(result);
      })
      .catch(() => {
        // Netwerkfout: memberships blijft null ("nog niet geladen"/ongecacht).
      });
    return () => {
      cancelled = true;
    };
  }, [authUser, trustedDeviceAnswered, membershipsRefreshKey]);

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

  if (authLoading) {
    return <LoadingScreen lang={lang} />;
  }

  const appState = deriveAppState({
    online,
    authUser,
    trustedDeviceAnswered,
    memberships,
    selectedContext,
    hasEverHadMemberships: !justSignedUp,
  });

  switch (appState.kind) {
    case 'not-logged-in':
      return mode === 'login' ? (
        <LoginScreen
          lang={lang}
          onSwitchLang={setLang}
          onSubmit={(email, password) => authGateway.signIn(email, password)}
          onSwitchToSignup={() => setMode('signup')}
        />
      ) : (
        <SignupScreen
          lang={lang}
          onSwitchLang={setLang}
          onSubmit={handleSignUp}
          onSwitchToLogin={() => setMode('login')}
        />
      );

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
          />
          <App />
        </>
      );
  }
}

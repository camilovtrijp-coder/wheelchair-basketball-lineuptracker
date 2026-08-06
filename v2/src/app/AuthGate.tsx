import { useEffect, useState } from 'preact/hooks';
import { browserStorage } from '../i18n/browserStorage';
import { readLang, writeLang } from '../i18n/persistence';
import { resolveInitialLang } from '../i18n/detect';
import type { Lang } from '../i18n/strings';
import type { AuthGateway, AuthResult } from '../application/auth/AuthGateway';
import type { OrganizationGateway } from '../application/organizations/OrganizationGateway';
import type { AuthUser } from '../domain/auth/types';
import type { Membership } from '../domain/organizations/types';
import { deriveAppState } from '../domain/organizations/deriveAppState';
import { readTrustedDevice, writeTrustedDevice } from '../infrastructure/device/trustedDevice';
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
import { SignOutBar } from '../ui/auth/SignOutBar';
import { LoadingScreen } from '../ui/status/LoadingScreen';
import { NoOrganizationsScreen } from '../ui/onboarding/NoOrganizationsScreen';
import { App } from './App';

function initialLang(): Lang {
  const stored = readLang(browserStorage);
  return resolveInitialLang(
    typeof navigator !== 'undefined' ? navigator.language : undefined,
    stored,
  );
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
 *
 * `selectedContext` wordt hier nog niet gemodelleerd (dat is stap 7, de
 * echte contextwisselaar met rol per team en offline/ingetrokken-status).
 * Tot die tijd is elke membership voldoende om door te gaan naar `App`
 * (`context-switcher`/`selected-context-revoked`/`active` renderen hier dus
 * allemaal hetzelfde) — bewust een tijdelijke vereenvoudiging, zie stap 7.
 */
export function AuthGate({ authGateway }: AuthGateProps) {
  const [lang, setLang] = useState<Lang>(initialLang);
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

  useEffect(() => {
    document.documentElement.lang = lang;
    writeLang(browserStorage, lang);
  }, [lang]);

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

  if (authLoading) {
    return <LoadingScreen lang={lang} />;
  }

  const appState = deriveAppState({
    online: true, // stap 7 koppelt echte navigator.onLine-detectie
    authUser,
    trustedDeviceAnswered,
    memberships,
    selectedContext: null, // stap 7 voegt echte contextselectie toe
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
    case 'uncached-offline':
      // Stap 7 onderscheidt deze twee met een expliciete "vraagt om netwerk"-melding.
      return <LoadingScreen lang={lang} />;

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
    case 'selected-context-revoked':
    case 'active':
      return (
        <>
          <SignOutBar lang={lang} onSignOut={handleSignOut} />
          <App />
        </>
      );
  }
}

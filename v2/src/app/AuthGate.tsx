import { useEffect, useState } from 'preact/hooks';
import { browserStorage } from '../i18n/browserStorage';
import { readLang, writeLang } from '../i18n/persistence';
import { resolveInitialLang } from '../i18n/detect';
import type { Lang } from '../i18n/strings';
import type { AuthGateway } from '../application/auth/AuthGateway';
import type { AuthUser } from '../domain/auth/types';
import { readTrustedDevice, writeTrustedDevice } from '../infrastructure/device/trustedDevice';
import {
  initFirebase,
  reinitFirestoreForTrustLevel,
  wipeLocalFirebaseData,
} from '../infrastructure/firebase/firebaseClient';
import { LoginScreen } from '../ui/auth/LoginScreen';
import { SignupScreen } from '../ui/auth/SignupScreen';
import { TrustedDevicePrompt } from '../ui/auth/TrustedDevicePrompt';
import { SignOutBar } from '../ui/auth/SignOutBar';
import { LoadingScreen } from '../ui/status/LoadingScreen';
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
 * Zit vóór de bestaande, ongewijzigde `App` en beslist of die getoond mag
 * worden. Beheert een eigen `lang`-status omdat login/signup-schermen
 * gerenderd worden vóórdat `App` (met zijn eigen `lang`-status) bestaat.
 *
 * Toont nu sessieherstel, login/signup en de vertrouwd-apparaatprompt.
 * Onboarding-bootstrap, lege-status en contextwisselaar uit latere stappen
 * worden hiertussen ingevoegd, vóór het renderen van `App`.
 */
export function AuthGate({ authGateway }: AuthGateProps) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [authLoading, setAuthLoading] = useState(true);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [mode, setMode] = useState<AuthFormMode>('login');
  const [trustedDeviceAnswered, setTrustedDeviceAnswered] = useState(
    () => readTrustedDevice(browserStorage) !== null,
  );

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

  if (authUser === null) {
    return mode === 'login' ? (
      <LoginScreen
        lang={lang}
        onSwitchLang={setLang}
        authGateway={authGateway}
        onSwitchToSignup={() => setMode('signup')}
      />
    ) : (
      <SignupScreen
        lang={lang}
        onSwitchLang={setLang}
        authGateway={authGateway}
        onSwitchToLogin={() => setMode('login')}
      />
    );
  }

  if (!trustedDeviceAnswered) {
    return <TrustedDevicePrompt lang={lang} onAnswer={handleTrustedDeviceAnswer} />;
  }

  return (
    <>
      <SignOutBar lang={lang} onSignOut={handleSignOut} />
      <App />
    </>
  );
}

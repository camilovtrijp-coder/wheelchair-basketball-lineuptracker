import { useEffect, useState } from 'preact/hooks';
import { browserStorage } from '../i18n/browserStorage';
import { readLang, writeLang } from '../i18n/persistence';
import { resolveInitialLang } from '../i18n/detect';
import type { Lang } from '../i18n/strings';
import type { AuthGateway } from '../application/auth/AuthGateway';
import type { AuthUser } from '../domain/auth/types';
import { LoginScreen } from '../ui/auth/LoginScreen';
import { SignupScreen } from '../ui/auth/SignupScreen';
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
 * Toont nu alleen sessieherstel en login/signup. Latere stappen in deze PR
 * voegen de vertrouwd-apparaatprompt, onboarding-bootstrap, lege-status en
 * contextwisselaar toe tussen "ingelogd" en het renderen van `App`.
 */
export function AuthGate({ authGateway }: AuthGateProps) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [authLoading, setAuthLoading] = useState(true);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [mode, setMode] = useState<AuthFormMode>('login');

  useEffect(() => {
    document.documentElement.lang = lang;
    writeLang(browserStorage, lang);
  }, [lang]);

  useEffect(() => {
    return authGateway.subscribe((user) => {
      setAuthUser(user);
      setAuthLoading(false);
    });
  }, [authGateway]);

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

  return <App />;
}

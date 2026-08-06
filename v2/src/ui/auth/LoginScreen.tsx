import type { Lang } from '../../i18n/strings';
import type { AuthGateway } from '../../application/auth/AuthGateway';
import { AuthForm } from './AuthForm';

export interface LoginScreenProps {
  lang: Lang;
  onSwitchLang: (lang: Lang) => void;
  authGateway: AuthGateway;
  onSwitchToSignup: () => void;
}

export function LoginScreen({
  lang,
  onSwitchLang,
  authGateway,
  onSwitchToSignup,
}: LoginScreenProps) {
  return (
    <AuthForm
      lang={lang}
      onSwitchLang={onSwitchLang}
      mode="login"
      onSubmit={(email, password) => authGateway.signIn(email, password)}
      onSwitchMode={onSwitchToSignup}
    />
  );
}

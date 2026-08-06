import type { Lang } from '../../i18n/strings';
import type { AuthGateway } from '../../application/auth/AuthGateway';
import { AuthForm } from './AuthForm';

export interface SignupScreenProps {
  lang: Lang;
  onSwitchLang: (lang: Lang) => void;
  authGateway: AuthGateway;
  onSwitchToLogin: () => void;
}

export function SignupScreen({
  lang,
  onSwitchLang,
  authGateway,
  onSwitchToLogin,
}: SignupScreenProps) {
  return (
    <AuthForm
      lang={lang}
      onSwitchLang={onSwitchLang}
      mode="signup"
      onSubmit={(email, password) => authGateway.signUp(email, password)}
      onSwitchMode={onSwitchToLogin}
    />
  );
}

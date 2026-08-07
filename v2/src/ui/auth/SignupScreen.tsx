import type { Lang } from '../../i18n/strings';
import type { AuthResult } from '../../application/auth/AuthGateway';
import { AuthForm } from './AuthForm';

export interface SignupScreenProps {
  lang: Lang;
  onSwitchLang: (lang: Lang) => void;
  onSubmit: (email: string, password: string) => Promise<AuthResult>;
  onSwitchToLogin: () => void;
  banner?: string;
}

export function SignupScreen({
  lang,
  onSwitchLang,
  onSubmit,
  onSwitchToLogin,
  banner,
}: SignupScreenProps) {
  return (
    <AuthForm
      lang={lang}
      onSwitchLang={onSwitchLang}
      mode="signup"
      onSubmit={onSubmit}
      onSwitchMode={onSwitchToLogin}
      banner={banner}
    />
  );
}

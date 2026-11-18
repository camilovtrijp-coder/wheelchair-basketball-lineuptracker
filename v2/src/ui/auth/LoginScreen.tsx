import type { Lang } from '../../i18n/strings';
import type { AuthResult } from '../../application/auth/AuthGateway';
import { AuthForm } from './AuthForm';

export interface LoginScreenProps {
  lang: Lang;
  onSwitchLang: (lang: Lang) => void;
  onSubmit: (email: string, password: string) => Promise<AuthResult>;
  onResetPassword: (email: string) => Promise<AuthResult>;
  onSwitchToSignup: () => void;
  banner?: string;
}

export function LoginScreen({
  lang,
  onSwitchLang,
  onSubmit,
  onResetPassword,
  onSwitchToSignup,
  banner,
}: LoginScreenProps) {
  return (
    <AuthForm
      lang={lang}
      onSwitchLang={onSwitchLang}
      mode="login"
      onSubmit={onSubmit}
      onResetPassword={onResetPassword}
      onSwitchMode={onSwitchToSignup}
      banner={banner}
    />
  );
}

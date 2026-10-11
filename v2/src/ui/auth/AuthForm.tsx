import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { SUPPORTED_LANGS, translate, type Lang, type StringKey } from '../../i18n/strings';
import type { AuthResult } from '../../application/auth/AuthGateway';
import { authErrorMessage } from './authErrors';

export type AuthFormMode = 'login' | 'signup';

export interface AuthFormProps {
  lang: Lang;
  onSwitchLang: (lang: Lang) => void;
  mode: AuthFormMode;
  onSubmit: (email: string, password: string) => Promise<AuthResult>;
  onResetPassword?: (email: string) => Promise<AuthResult>;
  onSwitchMode: () => void;
  /** Bijv. gebruikt om aan te geven dat er een uitnodiging wacht op dit inlog-/registratiemoment. */
  banner?: string;
}

function t(lang: Lang, key: StringKey): string {
  return translate(lang, key);
}

export function AuthForm({
  lang,
  onSwitchLang,
  mode,
  onSubmit,
  onResetPassword,
  onSwitchMode,
  banner,
}: AuthFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  let emailInput: HTMLInputElement | null = null;

  const other: Lang = lang === SUPPORTED_LANGS[0] ? SUPPORTED_LANGS[1] : SUPPORTED_LANGS[0];
  const otherLabel = t(lang, other === 'en' ? 'switchToEn' : 'switchToNl');

  async function handleSubmit(event: JSX.TargetedEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await onSubmit(email, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(authErrorMessage(lang, result.errorCode));
    }
  }

  async function handlePasswordReset() {
    if (!onResetPassword || submitting) return;
    setError(null);
    setResetSent(false);
    if (!emailInput?.checkValidity()) {
      setError(t(lang, 'authInvalidEmailError'));
      emailInput?.focus();
      return;
    }
    setSubmitting(true);
    const result = await onResetPassword(email.trim());
    setSubmitting(false);
    if (result.ok) setResetSent(true);
    else setError(t(lang, 'authResetFailed'));
  }

  const title = mode === 'login' ? t(lang, 'authLoginTitle') : t(lang, 'authSignupTitle');
  const submitLabel = mode === 'login' ? t(lang, 'authLoginBtn') : t(lang, 'authSignupBtn');
  const switchPrompt =
    mode === 'login' ? t(lang, 'authSwitchToSignupPrompt') : t(lang, 'authSwitchToLoginPrompt');
  const switchLabel =
    mode === 'login' ? t(lang, 'authSwitchToSignupBtn') : t(lang, 'authSwitchToLoginBtn');

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">{title}</h1>
        <div className="app-header__actions">
          <button
            type="button"
            aria-label={otherLabel}
            data-testid="lang-switch"
            onClick={() => onSwitchLang(other)}
          >
            {other.toUpperCase()}
          </button>
        </div>
      </header>
      <main className="app-main">
        {banner ? (
          <p className="auth-form__banner" data-testid="auth-invitation-banner">
            {banner}
          </p>
        ) : null}
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-form__field">
            {t(lang, 'authEmailLabel')}
            <input
              type="email"
              ref={(element) => {
                emailInput = element;
              }}
              required
              autoComplete="email"
              value={email}
              data-testid="auth-email"
              onInput={(event) => {
                setEmail((event.target as HTMLInputElement).value);
                setResetSent(false);
              }}
            />
          </label>
          <label className="auth-form__field">
            {t(lang, 'authPasswordLabel')}
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              data-testid="auth-password"
              onInput={(event) => setPassword((event.target as HTMLInputElement).value)}
            />
          </label>
          {error ? (
            <p className="auth-form__error" role="alert" data-testid="auth-error">
              {error}
            </p>
          ) : null}
          {resetSent ? (
            <p role="status" data-testid="auth-reset-sent">
              {t(lang, 'authResetEmailSent')}
            </p>
          ) : null}
          <button type="submit" data-testid="auth-submit" disabled={submitting}>
            {submitLabel}
          </button>
          {mode === 'login' && onResetPassword ? (
            <button
              type="button"
              data-testid="auth-reset-password"
              disabled={submitting}
              onClick={handlePasswordReset}
            >
              {t(lang, 'authForgotPasswordBtn')}
            </button>
          ) : null}
        </form>
        <p className="auth-form__switch">
          {switchPrompt}{' '}
          <button type="button" data-testid="auth-switch-mode" onClick={onSwitchMode}>
            {switchLabel}
          </button>
        </p>
      </main>
    </div>
  );
}

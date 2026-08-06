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
  onSwitchMode: () => void;
}

function t(lang: Lang, key: StringKey): string {
  return translate(lang, key);
}

export function AuthForm({ lang, onSwitchLang, mode, onSubmit, onSwitchMode }: AuthFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-form__field">
            {t(lang, 'authEmailLabel')}
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              data-testid="auth-email"
              onInput={(event) => setEmail((event.target as HTMLInputElement).value)}
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
          <button type="submit" data-testid="auth-submit" disabled={submitting}>
            {submitLabel}
          </button>
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

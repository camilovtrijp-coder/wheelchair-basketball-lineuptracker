import { translate, type Lang } from '../../i18n/strings';

export interface SignOutBarProps {
  lang: Lang;
  onSignOut: () => void;
}

/**
 * Dunne balk náást (niet in) `App` — zo blijft `App.tsx` zelf ongewijzigd
 * terwijl er toch een uitlogknop beschikbaar is zodra er een actieve sessie is.
 */
export function SignOutBar({ lang, onSignOut }: SignOutBarProps) {
  return (
    <div className="session-bar">
      <button type="button" data-testid="sign-out" onClick={onSignOut}>
        {translate(lang, 'authSignOutBtn')}
      </button>
    </div>
  );
}

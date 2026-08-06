import { translate, type Lang } from '../../i18n/strings';

export interface ContextRevokedScreenProps {
  lang: Lang;
  onBackToSwitcher: () => void;
}

export function ContextRevokedScreen({ lang, onBackToSwitcher }: ContextRevokedScreenProps) {
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">{translate(lang, 'stateContextRevokedTitle')}</h1>
      </header>
      <main className="app-main">
        <p data-testid="context-revoked-body">{translate(lang, 'stateContextRevokedBody')}</p>
        <button type="button" data-testid="context-revoked-back" onClick={onBackToSwitcher}>
          {translate(lang, 'stateContextRevokedBackBtn')}
        </button>
      </main>
    </div>
  );
}

import { translate, type Lang } from '../../i18n/strings';

export interface TrustedDevicePromptProps {
  lang: Lang;
  onAnswer: (trusted: boolean) => void;
}

export function TrustedDevicePrompt({ lang, onAnswer }: TrustedDevicePromptProps) {
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">{translate(lang, 'trustedDevicePromptTitle')}</h1>
      </header>
      <main className="app-main">
        <p>{translate(lang, 'trustedDevicePromptBody')}</p>
        <div className="trusted-device-prompt__actions">
          <button type="button" data-testid="trusted-device-yes" onClick={() => onAnswer(true)}>
            {translate(lang, 'trustedDeviceYesBtn')}
          </button>
          <button type="button" data-testid="trusted-device-no" onClick={() => onAnswer(false)}>
            {translate(lang, 'trustedDeviceNoBtn')}
          </button>
        </div>
      </main>
    </div>
  );
}

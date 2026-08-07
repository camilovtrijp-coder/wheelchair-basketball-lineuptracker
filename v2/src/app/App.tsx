import { useEffect, useState } from 'preact/hooks';
import { browserStorage } from '../i18n/browserStorage';
import { readLang, writeLang } from '../i18n/persistence';
import { resolveInitialLang } from '../i18n/detect';
import { SUPPORTED_LANGS, translate, type Lang, type StringKey } from '../i18n/strings';
import { LocalStorageSettingsRepository } from '../infrastructure/settings/LocalStorageSettingsRepository';
import { getSettings } from '../application/settings/usecases';
import type { Settings } from '../domain/settings/types';
import { SettingsPanel } from '../ui/settings/SettingsPanel';
import { LocalStorageRosterRepository } from '../infrastructure/roster/LocalStorageRosterRepository';
import { getRoster } from '../application/roster/usecases';
import type { Roster } from '../domain/roster/types';
import { RosterPanel } from '../ui/roster/RosterPanel';

type Tab = 'settings' | 'roster';

function initialLang(): Lang {
  const stored = readLang(browserStorage);
  return resolveInitialLang(
    typeof navigator !== 'undefined' ? navigator.language : undefined,
    stored,
  );
}

function tFor(lang: Lang): (key: StringKey) => string {
  return (key) => translate(lang, key);
}

const settingsRepo = new LocalStorageSettingsRepository(browserStorage);
const rosterRepo = new LocalStorageRosterRepository(browserStorage);

export function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [tab, setTab] = useState<Tab>('settings');
  const [settings, setSettings] = useState<Settings & Record<string, unknown>>(() =>
    getSettings(settingsRepo),
  );
  const [roster, setRoster] = useState<Roster>(() => getRoster(rosterRepo));

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = (settings.teamName as string) || translate(lang, 'appNameFallback');
    writeLang(browserStorage, lang);
  }, [lang, settings.teamName]);

  const t = tFor(lang);
  const other: Lang = lang === SUPPORTED_LANGS[0] ? SUPPORTED_LANGS[1] : SUPPORTED_LANGS[0];
  const otherLabel = t(other === 'en' ? 'switchToEn' : 'switchToNl');
  const tag1Label = (settings.tag1Label as string) || t('toggleTag1Default');
  const tag2Label = (settings.tag2Label as string) || t('toggleTag2Default');

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          {(settings.teamName as string) || translate(lang, 'appNameFallback')}
        </h1>
        <div className="app-header__actions">
          <button
            type="button"
            aria-label={otherLabel}
            data-testid="lang-switch"
            onClick={() => setLang(other)}
          >
            {other.toUpperCase()}
          </button>
        </div>
      </header>

      <nav className="app-nav" aria-label={t('settingsTitle')}>
        <button
          type="button"
          className={`app-nav__tab${tab === 'settings' ? ' app-nav__tab--active' : ''}`}
          aria-current={tab === 'settings' ? 'page' : undefined}
          data-testid="nav-settings"
          onClick={() => setTab('settings')}
        >
          {t('settingsTitle')}
        </button>
        <button
          type="button"
          className={`app-nav__tab${tab === 'roster' ? ' app-nav__tab--active' : ''}`}
          aria-current={tab === 'roster' ? 'page' : undefined}
          data-testid="nav-roster"
          onClick={() => setTab('roster')}
        >
          {t('rosterTitle')}
        </button>
      </nav>

      <main className="app-main">
        {tab === 'settings' ? (
          <SettingsPanel
            lang={lang}
            repo={settingsRepo}
            storage={browserStorage}
            settings={settings}
            onSettingsChange={setSettings}
          />
        ) : (
          <RosterPanel
            lang={lang}
            repo={rosterRepo}
            storage={browserStorage}
            roster={roster}
            onRosterChange={setRoster}
            useClassLimit={settings.useClassLimit === true}
            tag1Label={tag1Label}
            tag2Label={tag2Label}
          />
        )}
      </main>
    </div>
  );
}

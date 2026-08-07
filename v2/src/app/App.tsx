import { useEffect, useState } from 'preact/hooks';
import { browserStorage } from '../i18n/browserStorage';
import { readLang, writeLang } from '../i18n/persistence';
import { resolveInitialLang } from '../i18n/detect';
import { SUPPORTED_LANGS, translate, type Lang, type StringKey } from '../i18n/strings';
import { LocalStorageSettingsRepository } from '../infrastructure/settings/LocalStorageSettingsRepository';
import {
  getSettingsAsync,
  migrateLocalStorageToCloud as migrateSettingsToCloud,
  resetSettingsAsync,
} from '../application/settings/usecases';
import type { Settings } from '../domain/settings/types';
import { SettingsPanel } from '../ui/settings/SettingsPanel';
import { LocalStorageRosterRepository } from '../infrastructure/roster/LocalStorageRosterRepository';
import {
  getRosterAsync,
  migrateLocalStorageToCloud as migrateRosterToCloud,
} from '../application/roster/usecases';
import type { Roster } from '../domain/roster/types';
import { RosterPanel } from '../ui/roster/RosterPanel';
import { LoadingScreen } from '../ui/status/LoadingScreen';
import type { ResolvedAppRepositories } from '../infrastructure/repositories/resolveAppRepositories';
import type { SyncStatusApi } from '../application/sync/useSyncStatus';

export interface AppProps {
  repositories: ResolvedAppRepositories;
  /**
   * Sync-status/opslaan-laag (PR 5.3c-2), door AuthGate berekend en
   * gedeeld met SessionBar/ActionNeededPanel. App gebruikt uitsluitend
   * saveSettings/saveRoster (i.p.v. de kale usecases) en onSettingsSync/
   * onRosterSync, zodat een geweigerde write in de pending-lijst van
   * useSyncStatus belandt — zie application/sync/useSyncStatus.ts.
   */
  syncStatus: SyncStatusApi;
}

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

// Blijft uitsluitend de leesbron voor de eenmalige v1→cloud-import
// (migrateLocalStorageToCloud); het daadwerkelijke schrijfpad loopt altijd
// via `repositories` (5.3c-1) — deze twee instanties worden nooit meer
// gebruikt om settings/roster op te slaan of te lezen voor weergave.
const v1SettingsRepo = new LocalStorageSettingsRepository(browserStorage);
const v1RosterRepo = new LocalStorageRosterRepository(browserStorage);

export function App({ repositories, syncStatus }: AppProps) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [tab, setTab] = useState<Tab>('settings');
  const [settings, setSettings] = useState<(Settings & Record<string, unknown>) | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    setRoster(null);

    // read() geeft altijd meteen een bruikbare eerste waarde (defaults/lege
    // roster voor een team zonder document); subscribe() levert daarna live
    // updates. Zonder deze read()-stap zou een cloud-team zonder bestaand
    // Firestore-document nooit een eerste emissie krijgen (de adapters
    // emitten bewust niet voor een niet-bestaand document, zie
    // FirestoreSettingsRepository/FirestoreRosterRepository) en zou App
    // eindeloos op LoadingScreen blijven staan.
    Promise.all([repositories.settings.read(), repositories.roster.read()]).then(([s, r]) => {
      if (cancelled) return;
      setSettings(s);
      setRoster(r);
    });

    const unsubSettings = repositories.settings.subscribe((s, sync) => {
      if (!cancelled) {
        setSettings(s);
        syncStatus.onSettingsSync(sync);
      }
    });
    const unsubRoster = repositories.roster.subscribe((r, sync) => {
      if (!cancelled) {
        setRoster(r);
        syncStatus.onRosterSync(sync);
      }
    });

    return () => {
      cancelled = true;
      unsubSettings();
      unsubRoster();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncStatus.onSettingsSync/onRosterSync zijn stabiele state-setter-wrappers uit useSyncStatus; alleen `repositories` mag dit effect laten her-abonneren (contextwissel).
  }, [repositories]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = (settings?.teamName as string) || translate(lang, 'appNameFallback');
    writeLang(browserStorage, lang);
  }, [lang, settings?.teamName]);

  if (settings === null || roster === null) {
    return <LoadingScreen lang={lang} />;
  }

  const t = tFor(lang);
  const other: Lang = lang === SUPPORTED_LANGS[0] ? SUPPORTED_LANGS[1] : SUPPORTED_LANGS[0];
  const otherLabel = t(other === 'en' ? 'switchToEn' : 'switchToNl');
  const tag1Label = (settings.tag1Label as string) || t('toggleTag1Default');
  const tag2Label = (settings.tag2Label as string) || t('toggleTag2Default');

  async function handleCloudMigrateSettings() {
    return migrateSettingsToCloud(v1SettingsRepo, repositories.settings, browserStorage);
  }

  async function handleCloudMigrateRoster() {
    return migrateRosterToCloud(v1RosterRepo, repositories.roster, browserStorage);
  }

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
            storage={browserStorage}
            settings={settings}
            onSettingsChange={setSettings}
            onSave={syncStatus.saveSettings}
            onReset={() => resetSettingsAsync(repositories.settings)}
            onRefresh={() => getSettingsAsync(repositories.settings)}
            onCloudMigrate={repositories.mode === 'cloud' ? handleCloudMigrateSettings : undefined}
          />
        ) : (
          <RosterPanel
            lang={lang}
            storage={browserStorage}
            roster={roster}
            onRosterChange={setRoster}
            onSave={syncStatus.saveRoster}
            onRefresh={() => getRosterAsync(repositories.roster)}
            useClassLimit={settings.useClassLimit === true}
            tag1Label={tag1Label}
            tag2Label={tag2Label}
            onCloudMigrate={repositories.mode === 'cloud' ? handleCloudMigrateRoster : undefined}
          />
        )}
      </main>
    </div>
  );
}

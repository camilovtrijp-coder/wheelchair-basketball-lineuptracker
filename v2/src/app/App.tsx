import { useEffect, useState } from 'preact/hooks';
import { browserStorage } from '../i18n/browserStorage';
import { readLang, writeLang } from '../i18n/persistence';
import { resolveInitialLang } from '../i18n/detect';
import { SUPPORTED_LANGS, translate, type Lang, type StringKey } from '../i18n/strings';
import { LocalStorageSettingsRepository } from '../infrastructure/settings/LocalStorageSettingsRepository';
import {
  getSettingsAsync,
  migrateLocalStorageToCloud as migrateSettingsToCloud,
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
import { OfflineUncachedScreen } from '../ui/status/OfflineUncachedScreen';
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

// PR 5.3d-vervolgonderzoek: hoelang een van de vier onderstaande stappen
// (settings-read, roster-read, settings-listener, roster-listener) mag
// uitblijven voordat 'm als "stalled" gerapporteerd wordt op LoadingScreen.
// Puur diagnostisch — er wordt niets afgebroken of vervangen na de
// time-out, alleen zichtbaar gemaakt WELKE stap nog niet is afgerond, zodat
// "LoadingScreen blijft staan" niet langer automatisch aan Promise.all()
// wordt toegeschreven zonder onderscheid tussen de vier mogelijke oorzaken.
const STEP_STALL_TIMEOUT_MS = 8000;

export function App({ repositories, syncStatus }: AppProps) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [tab, setTab] = useState<Tab>('settings');
  const [settings, setSettings] = useState<(Settings & Record<string, unknown>) | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [stalledSteps, setStalledSteps] = useState<string[]>([]);
  // Criterium 4 (issue #27 / docs/pr-5.3-plan.md §C/5.3d): een werkelijk
  // nooit-gecachete context mag offline nooit als een leeg team getoond
  // worden. read() valt terug op getDoc() wanneer getDocFromCache() faalt
  // (geen cache) — als getDoc() zelf óók faalt (offline, niets gecacht),
  // reject de Promise; zonder deze state zou dat ofwel een onbeperkte
  // LoadingScreen-hang zijn (nooit gevangen rejection) ofwel stilzwijgend
  // een leeg team tonen. subscribe()'s onError-pad krijgt dezelfde
  // afhandeling voor het geval de listener zelf faalt.
  const [uncachedOffline, setUncachedOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    setRoster(null);
    setStalledSteps([]);
    setUncachedOffline(false);

    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    function armStallTimer(step: string) {
      timers.set(
        step,
        setTimeout(() => {
          if (cancelled) return;
          setStalledSteps((prev) => (prev.includes(step) ? prev : [...prev, step]));
        }, STEP_STALL_TIMEOUT_MS),
      );
    }
    function disarmStallTimer(step: string) {
      const timer = timers.get(step);
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.delete(step);
      }
      setStalledSteps((prev) => (prev.includes(step) ? prev.filter((s) => s !== step) : prev));
    }

    // read() geeft altijd meteen een bruikbare eerste waarde (defaults/lege
    // roster voor een team zonder document); subscribe() levert daarna live
    // updates. Zonder deze read()-stap zou een cloud-team zonder bestaand
    // Firestore-document nooit een eerste emissie krijgen (de adapters
    // emitten bewust niet voor een niet-bestaand document, zie
    // FirestoreSettingsRepository/FirestoreRosterRepository) en zou App
    // eindeloos op LoadingScreen blijven staan. read() en subscribe() lopen
    // bewust onafhankelijk (geen Promise.all): één vastzittende stap mag de
    // andere drie niet blokkeren, en elke stap draagt zijn eigen
    // stall-timer, zodat een blijvende LoadingScreen precies aanwijst welke
    // stap het is.
    function markUncachedOffline(step: string) {
      if (cancelled) return;
      disarmStallTimer(step);
      setUncachedOffline(true);
    }

    armStallTimer('settings-read');
    repositories.settings.read().then(
      (s) => {
        if (cancelled) return;
        disarmStallTimer('settings-read');
        setSettings(s);
      },
      () => markUncachedOffline('settings-read'),
    );

    armStallTimer('roster-read');
    repositories.roster.read().then(
      (r) => {
        if (cancelled) return;
        disarmStallTimer('roster-read');
        setRoster(r);
      },
      () => markUncachedOffline('roster-read'),
    );

    armStallTimer('settings-listener');
    const unsubSettings = repositories.settings.subscribe(
      (s, sync) => {
        if (cancelled) return;
        disarmStallTimer('settings-listener');
        setSettings(s);
        syncStatus.onSettingsSync(sync);
      },
      () => markUncachedOffline('settings-listener'),
    );

    armStallTimer('roster-listener');
    const unsubRoster = repositories.roster.subscribe(
      (r, sync) => {
        if (cancelled) return;
        disarmStallTimer('roster-listener');
        setRoster(r);
        syncStatus.onRosterSync(sync);
      },
      () => markUncachedOffline('roster-listener'),
    );

    return () => {
      cancelled = true;
      for (const timer of timers.values()) clearTimeout(timer);
      unsubSettings();
      unsubRoster();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncStatus.onSettingsSync/onRosterSync zijn met useCallback([]) gememoized in useSyncStatus, dus stabiel over renders; alleen `repositories` mag dit effect laten her-abonneren (contextwissel).
  }, [repositories]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = (settings?.teamName as string) || translate(lang, 'appNameFallback');
    writeLang(browserStorage, lang);
  }, [lang, settings?.teamName]);

  if (uncachedOffline && (settings === null || roster === null)) {
    return <OfflineUncachedScreen lang={lang} />;
  }

  if (settings === null || roster === null) {
    return <LoadingScreen lang={lang} stalledSteps={stalledSteps} />;
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
            onReset={syncStatus.resetSettings}
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

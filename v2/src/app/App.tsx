import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { browserStorage, strictReadBrowserStorage } from '../i18n/browserStorage';
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
import { LocalStorageGameRepository } from '../infrastructure/game/LocalStorageGameRepository';
import { LocalStorageCompletedGameRepository } from '../infrastructure/game/LocalStorageCompletedGameRepository';
import { createGameFromRoster } from '../domain/game/setup';
import { finishGame } from '../domain/game/finish';
import type { ActiveGame, CompletedGame } from '../domain/game/types';
import { GameSetupPanel } from '../ui/game/GameSetupPanel';
import { LiveTrackingPanel } from '../ui/game/LiveTrackingPanel';
import { V1MigrationPrompt } from '../ui/game/V1MigrationPrompt';
import { HistoryPanel } from '../ui/game/HistoryPanel';
import { StatsPanel } from '../ui/stats/StatsPanel';
import { TrendsPanel } from '../ui/trends/TrendsPanel';

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
  /**
   * PR 5.4a: of deze gebruiker teamdata mag bewerken in de UI. Wordt door AuthGate
   * berekend uit dezelfde validateSelectedTeam()-call als `selectedContextTeamValid`
   * (geen extra Firestore-read), en doorgegeven aan SettingsPanel/RosterPanel om de
   * schrijfknoppen te hiden/disablen voor rollen die `canManageTeamData === false` hebben
   * (spiegelt firestore.rules exact). AuthGate rendert `App` uitsluitend in de
   * 'active'-state (een gevalideerde cloud-teamcontext), dus deze prop is in de
   * praktijk altijd de cloud-berekening uit `selectedContextCanWrite`.
   */
  canWrite: boolean;
  /**
   * PR 6.1-review (aug. 2026): aparte, ruimere bevoegdheid voor de wedstrijd-UI
   * (owner/admin/coach/scorer — zie domain/organizations/teamAccess.ts,
   * `canWriteGameData`). Vóór deze toevoeging deelde `GameSetupPanel`/
   * `LiveTrackingPanel` dezelfde `canWrite` als Settings/Roster, waardoor een
   * scorer nergens kon scoren. Door AuthGate berekend uit dezelfde
   * validateSelectedTeam()-call als `canWrite` (geen extra Firestore-read).
   */
  canWriteGame: boolean;
  /**
   * Actieve organisatie/teamcontext (PR 5.2, AuthGate's `selectedContext`),
   * doorgegeven zodat een nieuwe wedstrijdopzet (PR 6.1) er verplicht mee
   * getagd en onder een eigen sleutel opgeslagen kan worden — zie
   * infrastructure/game/LocalStorageGameRepository.ts. Wedstrijddata is in
   * PR 6.1 nog uitsluitend lokaal (geen Firestore-adapter); cloud-sync komt
   * pas met PR 7.1.
   */
  organizationId: string;
  teamId: string;
  /**
   * PR 6.1-review (aug. 2026): weergavenaam van de actieve organisatie —
   * uitsluitend gebruikt door `V1MigrationPrompt` om een ondubbelzinnig doel
   * te tonen (organisatie + team, niet alleen teamnaam). Zonder de
   * organisatienaam zou een bevestigingsvraag bij gelijknamige teams in twee
   * verschillende organisaties niet te onderscheiden zijn — precies de
   * situatie waarin deze prompt de gebruiker moet kunnen vertrouwen. Valt in
   * AuthGate terug op `organizationId` als er (nog) geen membershipnaam
   * bekend is.
   */
  organizationName: string;
}

type Tab = 'settings' | 'roster' | 'game' | 'history' | 'stats' | 'trends';

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

export function App({
  repositories,
  syncStatus,
  canWrite,
  canWriteGame,
  organizationId,
  teamId,
  organizationName,
}: AppProps) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [tab, setTab] = useState<Tab>('settings');
  const [settings, setSettings] = useState<(Settings & Record<string, unknown>) | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [settingsUpdatedAt, setSettingsUpdatedAt] = useState<number | undefined>(undefined);
  const [rosterUpdatedAt, setRosterUpdatedAt] = useState<number | undefined>(undefined);
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
  // PR 5.4a: een listener die NA de initiële load faalt (settings of roster niet
  // meer null, dus markUncachedOffline slaat niet aan) wordt hier vastgelegd en
  // levert een niet-blokkerende "Verbinding weggevallen"-indicator op. Wordt
  // automatisch gereset door de volgende succesvolle onNext-emit (canonieke
  // Firestore-SDK-gedraging: onError wordt één keer aangeroepen, daarna hervat
  // de listener bij de volgende serververbinding).
  const [listenerError, setListenerError] = useState<'settings' | 'roster' | null>(null);
  // PR 5.4a: de onError-callbacks van subscribe() worden asynchroon aangeroepen,
  // ver na het moment waarop dit effect zijn closure vastlegde. Om te beslissen
  // of een fout "vóór of ná de eerste load" viel, vergelijken we niet met de
  // gesloten-over `settings`/`roster` (stale), maar met refs die de actuele
  // state spiegelen — bijgewerkt in elke onNext en in de read()-handlers.
  const settingsLoadedRef = useRef(false);
  const rosterLoadedRef = useRef(false);

  // PR 6.1: wedstrijdopzet. Lokaal-only (nog geen Firestore-adapter, zie
  // GameRepository.ts) en per organisatie/team-context opgeslagen, zodat een
  // contextwissel de opzet van een ander team niet overschrijft of verliest.
  const gameRepo = useMemo(
    () => new LocalStorageGameRepository(browserStorage, organizationId, teamId),
    [organizationId, teamId],
  );
  const [game, setGame] = useState<ActiveGame | null>(null);
  const [gameSaveError, setGameSaveError] = useState(false);
  // PR 6.1-review (aug. 2026): een gedetecteerde, nog niet bevestigde
  // v1-actieve-wedstrijd (zie GameRepository.detectV1Migration()) — v1 kende
  // geen organisatie/teamcontext, dus dit team wordt pas een echt v2-`game`
  // ná expliciete bevestiging door de gebruiker (handleConfirmV1Migration),
  // nooit automatisch. Zie ui/game/V1MigrationPrompt.tsx.
  const [v1MigrationCandidate, setV1MigrationCandidate] = useState<ActiveGame | null>(null);

  // PR 6.3: afgeronde wedstrijden. Lokaal-only en per organisatie/team-context
  // opgeslagen, net als de actieve wedstrijd (zie
  // infrastructure/game/LocalStorageCompletedGameRepository.ts). Vóór de
  // resume-check hieronder gedeclareerd: die heeft `completedGameRepo` nodig
  // om te herkennen of een opgeslagen 'tracking'-wedstrijd al gearchiveerd is.
  //
  // Gebruikt bewust `strictReadBrowserStorage` i.p.v. de gedeelde
  // `browserStorage` (externe PR-6.3-review, aug. 2026): `browserStorage`
  // vertaalt élke `getItem()`-fout naar `null`, wat voor deze repository een
  // echte readfout niet meer te onderscheiden zou maken van "nog geen
  // historie" — en `add()`/`remove()` zouden zo'n readfout dan alsnog als
  // lege lijst behandelen en de bestaande historie overschrijven. Zie
  // `i18n/browserStorage.ts` voor het volledige contract.
  const completedGameRepo = useMemo(
    () => new LocalStorageCompletedGameRepository(strictReadBrowserStorage, organizationId, teamId),
    [organizationId, teamId],
  );
  const [completedGames, setCompletedGames] = useState<CompletedGame[]>([]);
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);
  // PR 6.5 §C.2/§F: het wedstrijdfilter is gedeeld tussen Stats en Trends —
  // één "welke wedstrijden tellen mee"-instelling voor de hele app, i.p.v.
  // twee aparte filters die uit de pas kunnen lopen (v1-pariteit). `null` =
  // "alles" (zie `domain/stats/types.ts` `StatsFilter.gameIds`).
  const [statsGameIds, setStatsGameIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    setCompletedGames(completedGameRepo.list());
    setHistoryOpenId(null);
    // Externe PR-6.5-review (aug. 2026): zonder deze reset bleef een
    // wedstrijdselectie uit team A's `AnalysisGame.id`-verzameling actief na
    // een contextwissel naar team B (dezelfde `App`-instance krijgt alleen
    // nieuwe props, geen remount). Team B's wedstrijd-ID's komen daar niet in
    // voor, dus Stats/Trends toonden dan ten onrechte "0 wedstrijden" i.p.v.
    // het v1-standaardgedrag "alles geselecteerd" (`null`).
    setStatsGameIds(null);
  }, [completedGameRepo]);

  // Spiegelt v1's init() precies: een opgeslagen wedstrijd wordt alleen
  // hervat wanneer ze al écht gestart is (`phase === 'tracking'`) — v1:
  // "if (saved && saved.players && (saved.phase === 'tracking' ||
  // (saved.segments && saved.segments.length > 0))) state =
  // Object.assign(freshState(), saved)". Een nog-niet-gestarte opzet
  // (`phase === 'setup'`) wordt bewust GENEGEERD bij het laden, ook al staat
  // ze in de opslag — de opzet hieronder herderived 'm dan vers vanaf de
  // actuele roster. Reden: tot "Start wedstrijd" is geklikt is een opzet
  // laag-risico en mag een reload gewoon de huidige teamsamenstelling tonen;
  // ná start (fase 'tracking') mag niets meer verloren gaan. Zonder een eigen
  // v2-wedstrijd wordt daarnaast gekeken of er een niet-bevestigde
  // v1-migratie klaarstaat voor dit team (zie hierboven).
  //
  // Externe PR-6.3-review (aug. 2026): een `stored` wedstrijd die al eerder
  // succesvol is afgerond (haar ID staat als `sourceGameId` op een
  // `CompletedGame`) mag NOOIT als 'tracking' hervat worden, ook al staat ze
  // nog onder de actieve-gamesleutel — dat kan gebeuren als de reset naar een
  // verse opzet na het afronden (zie `handleFinishGame`) niet is gelukt of de
  // app tussentijds crashte. Zonder deze check zou de gebruiker dezelfde
  // wedstrijd een tweede keer kunnen afronden, met een dubbele `CompletedGame`
  // als gevolg. In plaats daarvan wordt zo'n stale wedstrijd hier behandeld
  // als "geen actieve wedstrijd" — het effect hieronder herderived dan alsnog
  // een verse opzet.
  useEffect(() => {
    const stored = gameRepo.read();
    const alreadyArchived =
      stored !== null && completedGameRepo.list().some((g) => g.sourceGameId === stored.id);
    if (stored && stored.phase === 'tracking' && !alreadyArchived) {
      setGame(stored);
      setV1MigrationCandidate(null);
    } else {
      setGame(null);
      setV1MigrationCandidate(gameRepo.detectV1Migration());
    }
    setGameSaveError(false);
  }, [gameRepo, completedGameRepo]);

  // Spiegelt v1's freshState(): zodra er geen (te hervatten) wedstrijd is,
  // geen onbevestigd v1-migratievoorstel openstaat, en team/instellingen
  // geladen zijn, wordt een opzet vers vanaf de actuele roster afgeleid —
  // ook zonder expliciete "nieuwe wedstrijd"-actie. Draait bewust NIET terwijl
  // `v1MigrationCandidate` nog openstaat: anders zou deze een verse opzet
  // aanmaken en opslaan onder de v2-sleutel, waarna een latere reload de
  // v1-migratie niet meer als "nog te bevestigen" zou herkennen (de v2-sleutel
  // is dan niet meer leeg) — het voorstel zou zo onherroepelijk verdwijnen
  // zonder dat de gebruiker ooit iets bevestigd heeft.
  useEffect(() => {
    if (game !== null || v1MigrationCandidate !== null || settings === null || roster === null) {
      return;
    }
    const fresh = createGameFromRoster(roster, organizationId, teamId, settings.classBaseLimit);
    setGame(fresh);
    gameRepo.write(fresh);
  }, [game, v1MigrationCandidate, settings, roster, gameRepo, organizationId, teamId]);

  function handleGameChange(next: ActiveGame) {
    setGame(next);
    setGameSaveError(!gameRepo.write(next));
  }

  function handleConfirmV1Migration() {
    if (v1MigrationCandidate === null) return;
    const ok = gameRepo.confirmV1Migration(v1MigrationCandidate);
    setGameSaveError(!ok);
    if (ok) {
      setGame(v1MigrationCandidate);
      setV1MigrationCandidate(null);
    }
  }

  /**
   * v1: `finishGame()`. Bevriest de actieve wedstrijd tot een onveranderlijke
   * `CompletedGame` met de op dit moment geldende instellingen (settings is
   * hier altijd geladen — deze knop is alleen bereikbaar via
   * LiveTrackingPanel, dat zelf al `settings`/`roster !== null` vereist om
   * gerenderd te worden).
   *
   * Externe PR-6.3-review (aug. 2026), twee robuustheidsfixes t.o.v. de
   * eerste versie:
   * 1. Idempotent tegen een herhaalde poging: als deze `game.id` al eerder
   *    gearchiveerd is (bijv. na een crash vóór de reset hieronder, gevolgd
   *    door een tweede klik op "Afronden" — zie de resume-guard hierboven),
   *    wordt er geen tweede `CompletedGame` aangemaakt; het bestaande
   *    archiefitem wordt hergebruikt.
   * 2. De reset naar een verse opzet gebeurt hier synchroon en gecontroleerd
   *    (`gameRepo.write(fresh)`), niet meer impliciet via `setGame(null)` +
   *    het herderive-effect hierboven — anders zou een crash tussen het
   *    archiveren en die impliciete reset de zojuist afgeronde wedstrijd nog
   *    als 'tracking' laten staan onder de actieve-gamesleutel.
   */
  function handleFinishGame() {
    if (game === null || settings === null || roster === null) return;

    const alreadyArchived = completedGames.find((g) => g.sourceGameId === game.id);
    let archived = alreadyArchived ?? null;
    if (archived === null) {
      const completed = finishGame(game, {
        quarterCount: settings.quarterCount as number,
        periodLabel: settings.periodLabel as string,
        useClassLimit: settings.useClassLimit === true,
      });
      if (completed === null) return;
      if (!completedGameRepo.add(completed)) {
        setGameSaveError(true);
        return;
      }
      archived = completed;
      setCompletedGames((prev) => [completed, ...prev]);
    }

    const fresh = createGameFromRoster(roster, organizationId, teamId, settings.classBaseLimit);
    const resetOk = gameRepo.write(fresh);
    setGameSaveError(!resetOk);
    setGame(resetOk ? fresh : null);
    setHistoryOpenId(archived.id);
    setTab('history');
  }

  function handleDeleteCompletedGame(id: string) {
    const ok = completedGameRepo.remove(id);
    setGameSaveError(!ok);
    if (!ok) return;
    setCompletedGames((prev) => prev.filter((g) => g.id !== id));
    setHistoryOpenId((prev) => (prev === id ? null : prev));
  }

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    setRoster(null);
    setSettingsUpdatedAt(undefined);
    setRosterUpdatedAt(undefined);
    setStalledSteps([]);
    setUncachedOffline(false);
    setListenerError(null);
    settingsLoadedRef.current = false;
    rosterLoadedRef.current = false;

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
        settingsLoadedRef.current = true;
      },
      () => markUncachedOffline('settings-read'),
    );

    armStallTimer('roster-read');
    repositories.roster.read().then(
      (r) => {
        if (cancelled) return;
        disarmStallTimer('roster-read');
        setRoster(r);
        rosterLoadedRef.current = true;
      },
      () => markUncachedOffline('roster-read'),
    );

    armStallTimer('settings-listener');
    const unsubSettings = repositories.settings.subscribe(
      (s, sync, updatedAt) => {
        if (cancelled) return;
        disarmStallTimer('settings-listener');
        setSettings(s);
        setSettingsUpdatedAt(updatedAt);
        settingsLoadedRef.current = true;
        syncStatus.onSettingsSync(sync);
        // PR 5.4a: een geslaagde listener-emit ruimt een eventuele eerdere
        // listener-foutmelding op (canonieke Firestore-gedraging: onError
        // wordt één keer aangeroepen, daarna hervat de listener).
        setListenerError((prev) => (prev === 'settings' ? null : prev));
      },
      () => {
        // PR 5.4a: onderscheid tussen pre-load en post-load fout. Tijdens de
        // eerste load (settings nog niet geladen) gedragen we ons als voorheen
        // (markUncachedOffline → OfflineUncachedScreen). Na een geslaagde
        // eerste load toont een listener-fout alleen de niet-blokkerende
        // indicator — de data op het scherm blijft de laatst geziene waarde.
        // settingsLoadedRef ipv de gesloten-over `settings` (stale closure).
        if (cancelled) return;
        disarmStallTimer('settings-listener');
        if (!settingsLoadedRef.current) {
          setUncachedOffline(true);
        } else {
          setListenerError('settings');
        }
      },
    );

    armStallTimer('roster-listener');
    const unsubRoster = repositories.roster.subscribe(
      (r, sync, updatedAt) => {
        if (cancelled) return;
        disarmStallTimer('roster-listener');
        setRoster(r);
        setRosterUpdatedAt(updatedAt);
        rosterLoadedRef.current = true;
        syncStatus.onRosterSync(sync);
        setListenerError((prev) => (prev === 'roster' ? null : prev));
      },
      () => {
        if (cancelled) return;
        disarmStallTimer('roster-listener');
        if (!rosterLoadedRef.current) {
          setUncachedOffline(true);
        } else {
          setListenerError('roster');
        }
      },
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
        <button
          type="button"
          className={`app-nav__tab${tab === 'game' ? ' app-nav__tab--active' : ''}`}
          aria-current={tab === 'game' ? 'page' : undefined}
          data-testid="nav-game"
          onClick={() => setTab('game')}
        >
          {t('gameTitle')}
        </button>
        <button
          type="button"
          className={`app-nav__tab${tab === 'history' ? ' app-nav__tab--active' : ''}`}
          aria-current={tab === 'history' ? 'page' : undefined}
          data-testid="nav-history"
          onClick={() => setTab('history')}
        >
          {t('historyTitle')}
        </button>
        <button
          type="button"
          className={`app-nav__tab${tab === 'stats' ? ' app-nav__tab--active' : ''}`}
          aria-current={tab === 'stats' ? 'page' : undefined}
          data-testid="nav-stats"
          onClick={() => setTab('stats')}
        >
          {t('statsTitle')}
        </button>
        <button
          type="button"
          className={`app-nav__tab${tab === 'trends' ? ' app-nav__tab--active' : ''}`}
          aria-current={tab === 'trends' ? 'page' : undefined}
          data-testid="nav-trends"
          onClick={() => setTab('trends')}
        >
          {t('trendsTitle')}
        </button>
      </nav>

      <main className="app-main">
        {repositories.mode === 'cloud' && listenerError !== null ? (
          <p
            className="listener-error-indicator"
            data-testid="listener-error-indicator"
            role="status"
            aria-live="polite"
          >
            {t('listenerErrorIndicator')}
          </p>
        ) : null}
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
            canWrite={canWrite}
            updatedAt={settingsUpdatedAt}
          />
        ) : tab === 'roster' ? (
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
            canWrite={canWrite}
            updatedAt={rosterUpdatedAt}
          />
        ) : tab === 'history' ? (
          <HistoryPanel
            lang={lang}
            games={completedGames}
            teamName={(settings.teamName as string) || ''}
            openId={historyOpenId}
            onOpenChange={setHistoryOpenId}
            onDeleteGame={handleDeleteCompletedGame}
            // Externe PR-6.3-review (aug. 2026): verwijderen van historie is een
            // beheeractie (ADR-003: "wedstrijden beheren" is coach/owner/admin),
            // geen live wedstrijdactie — dus `canWrite` (== canManageTeamData),
            // niet de bredere `canWriteGame` (die ook 'scorer' toelaat).
            canWrite={canWrite}
            saveError={gameSaveError}
          />
        ) : tab === 'stats' ? (
          // PR 6.4: Stats-tab. Lees-only — geen write-flow, geen extra
          // Firestore-reads (zie docs/pr-6.4-plan.md §D.6.4b). Daarom
          // bewust NIET onder de `canWrite`-poort: alle geautoriseerde
          // teamlezers (inclusief 'viewer') mogen de statistieken
          // bekijken.
          <StatsPanel
            lang={lang}
            repository={completedGameRepo}
            activeGame={game}
            roster={roster}
            gameIds={statsGameIds}
            onGameIdsChange={setStatsGameIds}
          />
        ) : tab === 'trends' ? (
          // PR 6.5: Trends-tab. Zelfde lees-only redenering als Stats
          // (docs/pr-6.5-plan.md §D 6.5c) — geen `canWrite`-poort, en deelt
          // het wedstrijdfilter (`statsGameIds`) met Stats.
          <TrendsPanel
            lang={lang}
            repository={completedGameRepo}
            activeGame={game}
            roster={roster}
            gameIds={statsGameIds}
            onGameIdsChange={setStatsGameIds}
          />
        ) : v1MigrationCandidate !== null ? (
          <V1MigrationPrompt
            lang={lang}
            game={v1MigrationCandidate}
            organizationName={organizationName || organizationId}
            teamName={(settings.teamName as string) || teamId}
            canWrite={canWriteGame}
            saveError={gameSaveError}
            onConfirm={handleConfirmV1Migration}
          />
        ) : game?.phase === 'tracking' ? (
          <LiveTrackingPanel
            lang={lang}
            game={game}
            quarterCount={settings.quarterCount as number}
            periodLabel={settings.periodLabel as string}
            classification={{
              useClassLimit: settings.useClassLimit === true,
              classBaseLimit: settings.classBaseLimit as number,
              maxBonus: settings.maxBonus as number,
              bonusTag1Only: settings.bonusTag1Only as number,
              bonusTag2Only: settings.bonusTag2Only as number,
              bonusBoth: settings.bonusBoth as number,
            }}
            teamName={(settings.teamName as string) || ''}
            tag1Label={tag1Label}
            tag2Label={tag2Label}
            onGameChange={handleGameChange}
            onFinishGame={handleFinishGame}
            canWrite={canWriteGame}
            saveError={gameSaveError}
          />
        ) : (
          <GameSetupPanel
            lang={lang}
            game={game}
            useClassLimit={settings.useClassLimit === true}
            onGameChange={handleGameChange}
            onGoToRoster={() => setTab('roster')}
            canWrite={canWriteGame}
            saveError={gameSaveError}
          />
        )}
      </main>
    </div>
  );
}

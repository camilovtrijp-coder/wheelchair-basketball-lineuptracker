import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
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
import type { CompletedGameRepository } from '../application/game/CompletedGameRepository';
import { LocalStoragePendingFinalizeRepository } from '../infrastructure/game/LocalStoragePendingFinalizeRepository';
import { LocalStorageLangRepository } from '../infrastructure/i18n/LocalStorageLangRepository';
import {
  createGameFromRoster,
  startBlockReason,
  syncGamePlayersWithRoster,
} from '../domain/game/setup';
import { finishGame } from '../domain/game/finish';
import type { ActiveGame, CompletedGame } from '../domain/game/types';
import type { CloudClaimStatus } from '../domain/game/writerClaim';
import { GameSetupPanel } from '../ui/game/GameSetupPanel';
import { LiveTrackingPanel } from '../ui/game/LiveTrackingPanel';
import { V1MigrationPrompt } from '../ui/game/V1MigrationPrompt';
import { HistoryPanel } from '../ui/game/HistoryPanel';
import { StatsPanel } from '../ui/stats/StatsPanel';
import { TrendsPanel } from '../ui/trends/TrendsPanel';
import { BackupPanel } from '../ui/backup/BackupPanel';
import { SyncStatusIndicator } from '../ui/sync/SyncStatusIndicator';
import type { SyncState, SyncStatus } from '../domain/syncState';

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
   * infrastructure/game/LocalStorageGameRepository.ts. Wedstrijddata blijft
   * altijd eerst lokaal (PR 6.1); PR 7.1c voegt daarnaast een optionele
   * cloud-sync toe via `repositories.gameSync` (alleen actief in cloud-modus).
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
  /**
   * PR 7.3a (docs/pr-7.3-plan.md §C 7.3a werk 4): meldt AuthGate of de
   * organisatie/teamcontext op dit moment vergrendeld is — `true` zodra deze
   * wedstrijd tracking heeft (`phase === 'tracking'`) OF een serverbevestigde
   * cloudwriterclaim draagt (`cloudClaim.kind === 'confirmed'`, ook nog
   * tijdens `'setup'` na een geslaagde pre-game-claim). AuthGate blokkeert
   * dan `handleBackToSwitcher()` — navigeren binnen de app blijft wél
   * toegestaan, alleen een contextWISSEL vereist eerst stoppen/loslaten.
   * Optioneel zodat bestaande tests/call sites zonder deze prop blijven
   * werken (geen lock-gedrag als de aanroeper 'm niet leest).
   */
  onGameLockChange?: (locked: boolean) => void;
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
const langRepo = new LocalStorageLangRepository(browserStorage);

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
  onGameLockChange,
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

  // PR 6.1: wedstrijdopzet, per organisatie/team-context opgeslagen zodat een
  // contextwissel de opzet van een ander team niet overschrijft of verliest.
  // `gameRepo` (GameRepository.ts) blijft de enige, synchrone bron van
  // waarheid — PR 7.1c voegt daar een async, fire-and-forget cloud-sync
  // bovenop toe (zie `runGameSync` hieronder), geen vervanging.
  const gameRepo = useMemo(
    () => new LocalStorageGameRepository(browserStorage, organizationId, teamId),
    [organizationId, teamId],
  );
  const [game, setGame] = useState<ActiveGame | null>(null);
  // Meespiegeld op elke render (i.p.v. als effect-dependency) zodat het
  // hieronder staande roster-synceffect uitsluitend op een echte
  // roster-wijziging reageert — niet op elke `game`-wijziging (dat zou een
  // lus riskeren: de sync zelf roept ook `setGame()` aan) en niet op een
  // participate/start-toggle die niets met de roster te maken heeft.
  const gameForRosterSyncRef = useRef<ActiveGame | null>(null);
  gameForRosterSyncRef.current = game;
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
  const localCompletedGameRepo = useMemo(
    () => new LocalStorageCompletedGameRepository(strictReadBrowserStorage, organizationId, teamId),
    [organizationId, teamId],
  );
  // PR 7.2b (docs/pr-7.2-plan.md §C 7.2b): in cloud-modus levert
  // `repositories.completedGames` een `CompositeCompletedGameRepository` die
  // dezelfde lokale sleutel samenvoegt met een live cloudquery (zie
  // `selectRepositories.ts`) — zelfde `null`-in-lokale-modus-patroon als
  // `repositories.gameSync`/`gameWriterContext` hierboven. Elke bestaande
  // aanroeper (`add`/`remove`/`list`/`safeList`, `StatsPanel`/`TrendsPanel`)
  // blijft ongewijzigd: beide varianten implementeren dezelfde
  // `CompletedGameRepository`-poort.
  const completedGameRepo: CompletedGameRepository =
    repositories.completedGames ?? localCompletedGameRepo;
  // PR 7.2a, P1-fix (externe review PR #61, tweede ronde): duurzame outbox
  // voor `GameSyncCoordinator.finalize()`'s invoer — zie
  // `application/game/PendingFinalizeRepository.ts`. Gebruikt bewust
  // `strictReadBrowserStorage` (niet de gedeelde `browserStorage`):
  // `handleFinishGame()` behandelt een mislukte outbox-write als een echte
  // precondition vóór het actieve-wedstrijdslot gereset wordt (zie daar) —
  // met de niet-strikte `browserStorage` was een onbeschikbare/falende
  // storage-GETTER een stille no-op die `writeAll()` alsnog als geslaagd
  // (`true`) liet zien, waardoor precies die precondition-check de mislukking
  // niet had kunnen detecteren.
  const pendingFinalizeRepo = useMemo(
    () =>
      new LocalStoragePendingFinalizeRepository(strictReadBrowserStorage, organizationId, teamId),
    [organizationId, teamId],
  );
  const [completedGames, setCompletedGames] = useState<CompletedGame[]>([]);
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);
  // PR 7.2a, P1-fix (externe review PR #61, derde ronde): zie
  // `handleDeleteCompletedGame` hieronder — toont waarom een verwijderpoging
  // is geblokkeerd (nog geen serverbevestiging) zonder de eerder gestelde
  // `gameSaveError`-banner te misbruiken (dat is specifiek "opslaan is
  // mislukt", geen "actie geblokkeerd").
  const [deleteBlocked, setDeleteBlocked] = useState(false);
  /** PR 7.2c: los van `gameSaveError` — een mislukte tombstone-verwijderpoging
   * (Rules, revisiemismatch, netwerk), geen mislukte lokale opslag. */
  const [deleteError, setDeleteError] = useState(false);
  /** PR 7.2c, externe review op PR #65 (P1): aantal wedstrijden dat dit
   * apparaat ZOJUIST als getombstoned leerde terwijl het zelf nog een
   * niet-getombstoned lokale kopie had (zie `CompositeCompletedGameRepository`'s
   * "Niet stil"-docstring). Transiënt, puur in-sessie — geen aparte
   * opslag/persisted state nodig; de gebruiker bevestigt de banner (of
   * navigeert weg en terug) om 'm te wissen. */
  const [tombstoneNoticeCount, setTombstoneNoticeCount] = useState(0);
  // PR 7.2b: cloudkant van de historie-lijst-actualiteit — los van
  // `finalizeStatuses` (dat is per-item, alleen voor door DIT apparaat
  // afgeronde wedstrijden). `null` = nog geen enkele cloud-snapshot
  // binnengekomen sinds de laatste contextwissel/(re)mount; blijft `null` in
  // lokale modus (het `completedGameRepo.subscribe`-effect hieronder is dan
  // een no-op, zie de `typeof ... === 'function'`-guard).
  const [completedGamesCloudSync, setCompletedGamesCloudSync] = useState<SyncState | null>(null);
  // PR 7.2b: `true` wanneer de laatste cloud-historiequery is afgewezen
  // (Rules-afwijzing, ingetrokken membership) — een aparte banner, want een
  // leesfout op de cloudkant mag NOOIT gelijk getoond worden aan "geen
  // wedstrijden" (plan §C 7.2b werk 4) terwijl de lokale historie (die
  // `completedGames` hieronder intussen nog steeds toont) verder gewoon
  // bruikbaar blijft.
  const [completedGamesCloudError, setCompletedGamesCloudError] = useState(false);
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
    setCompletedGamesCloudSync(null);
    setCompletedGamesCloudError(false);
  }, [completedGameRepo]);

  // PR 7.2b: abonneert op cloud-gedreven historie-updates (bijv. een
  // wedstrijd die op een ANDER apparaat is afgerond) — de effect hierboven
  // ziet zulke updates niet, die draait alleen bij een contextwissel.
  // `completedGameRepo.subscribe` bestaat alleen op de cloud-composite (zie
  // `application/game/CompletedGameRepository.ts`'s poort-docstring); in
  // lokale modus is dit een no-op. De eerste `onNext`-aanroep is synchroon
  // en levert dezelfde data als de `.list()`-aanroep hierboven al zette —
  // onschuldig dubbel, geen zichtbare flicker.
  useEffect(() => {
    if (typeof completedGameRepo.subscribe !== 'function') return undefined;
    return completedGameRepo.subscribe(
      (result, cloudSync, removedByCloudTombstone) => {
        setCompletedGames(result.games);
        setCompletedGamesCloudSync(cloudSync);
        if (result.status !== 'error') setCompletedGamesCloudError(false);
        // PR 7.2c, externe review op PR #65 (P1): dit apparaat leerde
        // ZOJUIST dat een teamgenoot een wedstrijd verwijderde die híer nog
        // als lokale kopie stond — nooit stilzwijgend laten verdwijnen, zie
        // `CompositeCompletedGameRepository`'s "Niet stil"-docstring.
        if (removedByCloudTombstone && removedByCloudTombstone.length > 0) {
          setTombstoneNoticeCount((prev) => prev + removedByCloudTombstone.length);
        }
      },
      () => {
        // Externe review op PR #64: een oude, mogelijk 'gesynchroniseerd'-
        // `completedGamesCloudSync` bleef hier eerder onaangeroerd staan bij
        // een cloudfout (bijv. een ingetrokken membership) — de UI toonde dan
        // tegelijk de foutbanner ÉN een verouderde groene syncindicator.
        // `null` is hier correct, niet misleidend: sinds de laatste succesvolle
        // snapshot is de actualiteit van de cloudkant per definitie onbekend.
        setCompletedGamesCloudError(true);
        setCompletedGamesCloudSync(null);
      },
    );
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

  // PR 5.5c-bugfixes bug 1: het effect hierboven derived de opzet maar één
  // keer, bij `game === null` — een latere roster-wijziging (naam, rugnummer,
  // nieuwe/verwijderde speler) binnen dezelfde sessie bereikte de Wedstrijd-
  // tab daarna nooit meer zonder herladen. Dit effect houdt `game.players`
  // synchroon met de roster zolang de opzet nog in `'setup'`-fase is (ná
  // `'tracking'` — de wedstrijd is dan al gestart — blijft dit effect bewust
  // buiten werking, zie `syncGamePlayersWithRoster()`).
  //
  // Bewust gedebounced (i.p.v. direct bij elke `roster`-wijziging): `roster`
  // verandert ook bij elke toetsaanslag in RosterPanel (`onRosterChange`,
  // vóór een expliciete save), niet alleen bij een daadwerkelijk opgeslagen
  // wijziging. Zonder debounce riep dit effect `setGame()` bij elke
  // toetsaanslag aan — een extra App-brede re-render per toetsaanslag die,
  // empirisch bevestigd tegen de echte browser, kon interfereren met een
  // vlak daarna plaatsvindende invoerhandeling op een ANDERE gecontroleerde
  // input (Preact's controlled-input-reconciliatie kan die dan terugzetten
  // naar de oude waarde — een race, geen dataverlies, maar wel een reëel
  // UI-risico). Synced pas nadat de roster 400ms stabiel is gebleven.
  useEffect(() => {
    const timer = setTimeout(() => {
      const current = gameForRosterSyncRef.current;
      if (current === null || current.phase !== 'setup' || roster === null) return;
      const synced = syncGamePlayersWithRoster(current, roster);
      if (synced === current) return;
      setGame(synced);
      gameRepo.write(synced);
    }, 400);
    return () => clearTimeout(timer);
  }, [roster, gameRepo]);

  function handleGameChange(next: ActiveGame) {
    setGame(next);
    setGameSaveError(!gameRepo.write(next));
  }

  /**
   * PR 7.1c: wedstrijd-cloud-sync (docs/pr-7.1-plan.md §C 7.1c). Lokaal
   * schrijven (`gameRepo.write()` hierboven) blijft altijd de bron van
   * waarheid en gebeurt synchroon/blokkerend; deze sync is bewust
   * fire-and-forget bovenop dat lokale schrijfpad — een trage of mislukte
   * cloud-sync mag de live scorebediening nooit blokkeren (zelfde
   * grondprincipe als settings/roster se write(), zie domain/syncState.ts).
   * `repositories.gameSync`/`gameWriterContext` zijn `null` in lokale modus
   * (resolveAppRepositories.ts) — dan gebeurt hier letterlijk niets, dus
   * geen enkele Firestore/Auth-aanroep in lokale modus (acceptatiecriterium
   * 5, docs/pr-7.1-plan.md §C 7.1c).
   *
   * `latestGameRef` + de in-flight/queued-vlaggen voorkomen twee dingen: (1)
   * twee overlappende `sync()`-aanroepen op dezelfde wedstrijd (elke actie
   * tijdens live scoren zou anders een eigen sync-cyclus starten), en (2) een
   * queued retry die per ongeluk een VEROUDERDE snapshot verstuurt — de
   * queued aanroep leest `latestGameRef.current` pas op het moment dat hij
   * daadwerkelijk start, nooit een snapshot die op queue-tijdstip vastligt.
   */
  const [gameSyncStatus, setGameSyncStatus] = useState<SyncStatus>('lokaal-beschikbaar');
  const latestGameRef = useRef<ActiveGame | null>(null);
  const gameSyncInFlightRef = useRef(false);
  const gameSyncQueuedRef = useRef(false);
  latestGameRef.current = game;

  const runGameSync = useCallback(() => {
    const coordinator = repositories.gameSync;
    const writerContext = repositories.gameWriterContext;
    if (!coordinator || !writerContext) return;
    const current = latestGameRef.current;
    if (!current || current.phase !== 'tracking') return;
    if (gameSyncInFlightRef.current) {
      gameSyncQueuedRef.current = true;
      return;
    }
    gameSyncInFlightRef.current = true;
    setGameSyncStatus('wacht-op-synchronisatie');
    coordinator
      .sync(current, writerContext)
      .then(
        (checkpoint) =>
          setGameSyncStatus(checkpoint.status === 'idle' ? 'gesynchroniseerd' : 'actie-nodig'),
        () => setGameSyncStatus('actie-nodig'),
      )
      .finally(() => {
        gameSyncInFlightRef.current = false;
        if (gameSyncQueuedRef.current) {
          gameSyncQueuedRef.current = false;
          runGameSync();
        }
      });
  }, [repositories.gameSync, repositories.gameWriterContext]);

  useEffect(() => {
    setGameSyncStatus('lokaal-beschikbaar');
  }, [game?.id]);

  useEffect(() => {
    runGameSync();
  }, [game, runGameSync]);

  // Reconnect-trigger: een sync die tijdens offline in 'actie-nodig' bleef
  // steken, probeert hierdoor opnieuw zodra de browser weer online komt —
  // zonder te wachten op de eerstvolgende live wedstrijdactie.
  useEffect(() => {
    function handleOnline() {
      runGameSync();
    }
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [runGameSync]);

  /**
   * PR 7.3a (docs/pr-7.3-plan.md §B/§C 7.3a werk 3): pre-game-gate —
   * verkrijgt/bevestigt de writerclaim VÓÓR tip-off ("Een cloudwedstrijd
   * krijgt vóór tip-off een serverbevestigde writerclaim"). Draait alleen
   * terwijl (a) `game.phase === 'setup'`, (b) de roster al startbaar is
   * (`startBlockReason(game) === null` — dezelfde voorwaarde als
   * `GameSetupPanel`'s startknop) ÉN (c) de gebruiker daadwerkelijk op het
   * Wedstrijd-tabblad staat, in cloud-modus.
   *
   * Voorwaarde (c) is net zo essentieel als (b): App.tsx derived altijd een
   * verse 'setup'-opzet zodra settings/roster geladen zijn, ook zonder dat de
   * gebruiker ooit het Wedstrijd-tabblad bezocht — en na het afronden van een
   * wedstrijd schakelt de app automatisch naar Historie terwijl er alweer een
   * verse, vaak DIRECT startbare opzet klaarstaat (dezelfde roster als
   * daarvoor). Zonder de tab-gate zou zo'n net-afgeronde sessie de
   * organisatie/teamcontext (zie `onGameLockChange` hieronder) opnieuw
   * vergrendelen vóórdat de gebruiker ooit weer naar het Wedstrijd-tabblad
   * keek — precies zichtbaar geworden via twee falende
   * `test:e2e:auth`-scenario's op PR #66 (contextwissel vóór ooit het
   * Wedstrijd-tabblad bezocht te hebben, en contextwissel na het afronden van
   * een wedstrijd). `repositories.gameSync`/`gameWriterContext` zijn `null`
   * in alleen-lokale modus (net als `runGameSync` hierboven), dus dan blijft
   * dit `'not-required'` zonder enige Firestore/Auth-aanroep — alleen-lokale
   * modus blijft zonder claim of netwerk werken. `GameSetupPanel`'s
   * startknop blijft geblokkeerd (`domain/game/writerClaim.ts`
   * `gameStartBlockReason()`) totdat dit `'confirmed'` wordt. `claimAttempt`
   * is een handmatige retry-trigger (de "Opnieuw proberen"-knop bij
   * `'blocked'`).
   *
   * `claimReadiness` is een primitieve dependency (string|null, geen object)
   * die alleen wijzigt zodra de roster-startbaarheid zelf verandert (bijv. de
   * 5e deelnemer gekozen) — niet bij elke ongerelateerde veldwijziging
   * (opponent/competition/clockDown), wat het effect anders bij elke
   * toetsaanslag opnieuw zou triggeren.
   */
  const [cloudClaim, setCloudClaim] = useState<CloudClaimStatus>({ kind: 'not-required' });
  const [claimAttempt, setClaimAttempt] = useState(0);
  const claimInFlightRef = useRef(false);
  /** Welk `game.id` het huidige `cloudClaim` (indien `'confirmed'`) daadwerkelijk dekt. */
  const confirmedForGameIdRef = useRef<string | null>(null);
  const claimReadiness =
    game !== null && game.phase === 'setup' ? startBlockReason(game) : 'no-game';

  useEffect(() => {
    const coordinator = repositories.gameSync;
    const writerContext = repositories.gameWriterContext;
    if (!coordinator || !writerContext) {
      setCloudClaim({ kind: 'not-required' });
      return;
    }
    const current = latestGameRef.current;
    if (!current || current.phase !== 'setup') return;
    if (tab !== 'game' || startBlockReason(current) !== null) {
      // Nog niet startbaar (roster-reden) of de gebruiker staat niet op het
      // Wedstrijd-tabblad — geen claimpoging. Een AL bevestigde claim blijft
      // alleen behouden als 'm nog over DEZE wedstrijd gaat (bijv. de
      // gebruiker togglet de roster kortstondig terug naar niet-startbaar
      // ná een geslaagde claim, vóór het klikken op "Start") — nooit stil
      // overerven naar een NIEUWE wedstrijd (bijv. de verse opzet na het
      // afronden van de vorige, PR #66-review): dat zou de context blijven
      // vergrendelen voor een wedstrijd die nooit geclaimd is. Ook nooit stil
      // terugvallen op `'not-required'` — dat zou de cloud-claim-eis omzeilen
      // op precies het eerste render-frame waarop beide alsnog voldaan raken.
      setCloudClaim((prev) =>
        prev.kind === 'confirmed' && confirmedForGameIdRef.current === current.id
          ? prev
          : { kind: 'pending' },
      );
      return;
    }
    if (claimInFlightRef.current) return;
    claimInFlightRef.current = true;
    setCloudClaim({ kind: 'pending' });
    coordinator
      .ensureWriterClaim(current, writerContext)
      .then(
        (status) => {
          confirmedForGameIdRef.current = status.kind === 'confirmed' ? current.id : null;
          setCloudClaim(status);
        },
        () => setCloudClaim({ kind: 'blocked', code: 'unknown' }),
      )
      .finally(() => {
        claimInFlightRef.current = false;
      });
  }, [
    repositories.gameSync,
    repositories.gameWriterContext,
    game?.id,
    game?.phase,
    tab,
    claimReadiness,
    claimAttempt,
  ]);

  function handleRetryClaim() {
    setClaimAttempt((n) => n + 1);
  }

  /**
   * PR 7.3a (docs/pr-7.3-plan.md §C 7.3a werk 4): meldt AuthGate de
   * contextlockstatus zodra die verandert — zie `AppProps.onGameLockChange`.
   * Vergrendeld zodra deze wedstrijd tracking heeft óf al een bevestigde
   * cloudclaim draagt (die claim kan al vóór `phase === 'tracking'`
   * bestaan, tijdens de pre-game-gate). Los van `game?.id` als dependency:
   * een contextwissel na afronden (`game` wordt een verse `'setup'`-opzet
   * zonder claim) moet de lock weer meteen opheffen.
   */
  useEffect(() => {
    const locked = game?.phase === 'tracking' || cloudClaim.kind === 'confirmed';
    onGameLockChange?.(locked);
  }, [game?.phase, cloudClaim, onGameLockChange]);

  /**
   * PR 7.2a (docs/pr-7.2-plan.md §C 7.2a werk 4): per-`CompletedGame.id`
   * cloudsyncstatus voor de Historie-lijst. `pendingFinalizesRef` is de
   * in-memory spiegel (voor de in-flight/retry-guard hieronder) van
   * `pendingFinalizeRepo` — de DUURZAME bron (P1-fix, externe review PR
   * #61): elke nog-niet-bevestigde afronding staat ook op
   * `pendingFinalizeRepo`, geschreven vóórdat het actieve-wedstrijdslot naar
   * een verse opzet wordt gereset (zie `handleFinishGame` hieronder). Zo
   * overleeft het `(ActiveGame, CompletedGame)`-paar dat `finalize()` nodig
   * heeft een paginareload/crash — het "hervat-op-load"-effect verderop leest
   * `pendingFinalizeRepo.list()` bij elke (her)start.
   */
  const [finalizeStatuses, setFinalizeStatuses] = useState<Record<string, SyncStatus>>({});
  const pendingFinalizesRef = useRef(
    new Map<string, { game: ActiveGame; completed: CompletedGame }>(),
  );
  // PR 7.2a, P1-fix (externe review PR #61, derde ronde): `runFinalize()`
  // wordt vanuit drie onafhankelijke plekken voor hetzelfde `completed.id`
  // aangeroepen — `handleFinishGame()`, het hervat-op-load-effect hieronder,
  // en de online-reconnect-handler — en die konden elkaar zonder guard
  // overlappen (bijv. een online-event terwijl de eerste
  // `coordinator.finalize()`-aanroep nog loopt). Twee gelijktijdige cycli
  // racen dan op dezelfde revisie: als de eerste slaagt (en de outbox al
  // verwijdert) terwijl de tweede nog loopt, kan die tweede alsnog laat
  // falen en de status terugzetten naar `actie-nodig` — zonder dat er nog
  // een outbox-entry is om vandaan te hervatten. Spiegelt daarom exact het
  // bestaande in-flight/queued-patroon van `runGameSync` hierboven: een
  // aanroep tijdens een lopende cyclus voor hetzelfde ID wordt niet genegeerd
  // maar gemarkeerd voor precies één hernieuwde poging zodra de lopende
  // cyclus afrondt — nooit twee gelijktijdige gateway-aanroepen voor
  // hetzelfde ID.
  const finalizeInFlightRef = useRef(new Set<string>());
  const finalizeQueuedRef = useRef(new Set<string>());

  const runFinalize = useCallback(
    (finishedGame: ActiveGame, completed: CompletedGame) => {
      const coordinator = repositories.gameSync;
      const writerContext = repositories.gameWriterContext;
      if (!coordinator || !writerContext) return;
      pendingFinalizesRef.current.set(completed.id, { game: finishedGame, completed });
      if (finalizeInFlightRef.current.has(completed.id)) {
        finalizeQueuedRef.current.add(completed.id);
        return;
      }
      finalizeInFlightRef.current.add(completed.id);
      setFinalizeStatuses((prev) => ({ ...prev, [completed.id]: 'wacht-op-synchronisatie' }));
      coordinator
        .finalize(finishedGame, completed, writerContext)
        .then(
          (checkpoint) => {
            if (checkpoint.status === 'idle') {
              pendingFinalizesRef.current.delete(completed.id);
              pendingFinalizeRepo.remove(completed.id);
            }
            setFinalizeStatuses((prev) => ({
              ...prev,
              [completed.id]: checkpoint.status === 'idle' ? 'gesynchroniseerd' : 'actie-nodig',
            }));
          },
          () => setFinalizeStatuses((prev) => ({ ...prev, [completed.id]: 'actie-nodig' })),
        )
        .finally(() => {
          finalizeInFlightRef.current.delete(completed.id);
          if (finalizeQueuedRef.current.delete(completed.id)) {
            const queued = pendingFinalizesRef.current.get(completed.id);
            if (queued) runFinalize(queued.game, queued.completed);
          }
        });
    },
    [repositories.gameSync, repositories.gameWriterContext, pendingFinalizeRepo],
  );

  // Hervat-op-load (P1-fix, externe review PR #61): elke nog openstaande
  // afronding in de duurzame outbox opnieuw aanbieden aan finalize() — dit
  // is de daadwerkelijke reload-/crashherstel-route. Draait bij elke nieuwe
  // organisatie/teamcontext (nieuwe `pendingFinalizeRepo`-instantie) en bij
  // elke wijziging van de cloud-repositories (bijv. terug online/opnieuw
  // geauthenticeerd) — `runFinalize` zelf is al idempotent tegen een
  // dubbele aanroep op dezelfde wedstrijd (`GameSyncCoordinator.finalize()`'s
  // eigen lokale/server-kortsluiting).
  useEffect(() => {
    if (!repositories.gameSync) return;
    for (const entry of pendingFinalizeRepo.list()) {
      runFinalize(entry.game, entry.completed);
    }
  }, [pendingFinalizeRepo, repositories.gameSync, runFinalize]);

  // Ververst de volledige statuskaart wanneer de historielijst zelf wijzigt
  // (initieel laden, verwijderen, back-up-import) — behalve voor items die
  // `runFinalize` momenteel aan het afhandelen is (`wacht-op-
  // synchronisatie`/`actie-nodig` uit een in-flight of net mislukte poging
  // blijft staan tot die `finalize()`-aanroep zelf resolvet, i.p.v. hier
  // voortijdig overschreven te worden door een verouderde checkpointlezing).
  useEffect(() => {
    const coordinator = repositories.gameSync;
    if (!coordinator) {
      setFinalizeStatuses({});
      return;
    }
    // PR 7.2b: `completedGames` kan nu ook cloud-only items bevatten — een
    // wedstrijd die op een ANDER apparaat is afgerond en hier nooit lokaal
    // is opgeslagen (zie `CompositeCompletedGameRepository`). Zo'n item
    // heeft geen lokaal checkpoint; `readFinalizeStatus()` leest UITSLUITEND
    // het lokale checkpoint en zou dan ten onrechte 'lokaal-beschikbaar'
    // teruggeven (misleidend voor een wedstrijd die per definitie alleen via
    // een geslaagde serverquery zichtbaar werd). Zulke items zijn per
    // constructie al 'gesynchroniseerd'.
    const localIds = new Set(localCompletedGameRepo.list().map((g) => g.id));
    setFinalizeStatuses((prev) => {
      const next: Record<string, SyncStatus> = {};
      for (const g of completedGames) {
        if (!localIds.has(g.id)) {
          next[g.id] = 'gesynchroniseerd';
          continue;
        }
        next[g.id] = pendingFinalizesRef.current.has(g.id)
          ? (prev[g.id] ?? 'wacht-op-synchronisatie')
          : coordinator.readFinalizeStatus(g.sourceGameId, organizationId, teamId, g.id);
      }
      return next;
    });
  }, [completedGames, repositories.gameSync, organizationId, teamId, localCompletedGameRepo]);

  useEffect(() => {
    function handleOnline() {
      for (const { game: g, completed: c } of pendingFinalizesRef.current.values()) {
        runFinalize(g, c);
      }
    }
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [runFinalize]);

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

    // PR 7.2a, P1-fix (externe review PR #61, tweede ronde): de duurzame
    // outbox-write (`pendingFinalizeRepo`, met dezelfde `game` — nog met
    // zijn volledige `actions`-log — waaruit `archived` zojuist is
    // afgeleid) is nu een ECHTE precondition vóór de reset hieronder, exact
    // zoals `completedGameRepo.add()` hierboven al is: mislukt de write
    // (strikte storage — een echt falende/onbeschikbare backing store is
    // hier detecteerbaar, geen stille no-op meer, zie de instantiatie
    // hierboven), dan stopt deze functie HIER. Het actieve-wedstrijdslot
    // blijft dan ongemoeid — het blijft zelf de laatste, volledige
    // bronactielog — en de gebruiker ziet de foutmelding en kan "Afronden"
    // gewoon opnieuw proberen (`alreadyArchived` hierboven maakt een retry
    // idempotent, er ontstaat nooit een tweede `CompletedGame`). Zonder deze
    // precondition zou de reset hieronder de enige retrybron alsnog kunnen
    // vernietigen terwijl de outbox 'm niet duurzaam heeft overgenomen.
    // Alleen relevant in cloud-modus — lokale modus heeft niets om te syncen.
    if (repositories.gameSync && !pendingFinalizeRepo.add({ game, completed: archived })) {
      setGameSaveError(true);
      return;
    }
    // Fire-and-forget cloud-finalize; `runFinalize` is zelf een no-op in
    // lokale modus.
    runFinalize(game, archived);

    const fresh = createGameFromRoster(roster, organizationId, teamId, settings.classBaseLimit);
    const resetOk = gameRepo.write(fresh);
    setGameSaveError(!resetOk);
    setGame(resetOk ? fresh : null);
    setHistoryOpenId(archived.id);
    setTab('history');
  }

  /**
   * PR 7.2a, P1-fix (externe review PR #61, derde ronde): in cloud-modus is
   * een nog niet server-bevestigde afronding voor `id` uitsluitend nog te
   * vinden via de lokale `CompletedGame` en de duurzame `pendingFinalizeRepo`.
   * Vóór serverbevestiging verwijderen zou dus de enige retrybron vernietigen
   * — in strijd met 7.2a's acceptatiecriterium "geen bronverwijdering" — of,
   * als de fire-and-forget cloudfinalize ondertussen alsnog slaagt, een
   * orphan cloudsnapshot zonder lokaal tegenhanger achterlaten. Dat pad
   * blijft dus geblokkeerd (`'not-synced'` hieronder).
   *
   * PR 7.2c: zodra de wedstrijd WÉL server-bevestigd is (`gesynchroniseerd`
   * of cloud-only), gaat verwijderen voortaan via
   * `CompositeCompletedGameRepository.tombstone()` — een server-side
   * `deletedAt`/`deletedBy`-fieldpatch (firestore.rules staat dit nu toe voor
   * owner/admin/coach, zie firestore.rules' `completedGames`-update-regel),
   * niet meer alleen een lokale `remove()` die de eerstvolgende cloud-
   * snapshot-update ongedaan zou maken. `finalizeStatuses[id]` is
   * `undefined` vlak na afronden totdat het statuseffect hierboven voor het
   * eerst draait; `tombstone()` valt in dat geval simpelweg terug op
   * `'not-synced'` (het item heeft dan sowieso nog geen cloud-tegenhanger).
   */
  async function handleDeleteCompletedGame(id: string) {
    const writerContext = repositories.gameWriterContext;
    if (repositories.gameSync && writerContext) {
      if (!completedGameRepo.tombstone) {
        setDeleteBlocked(true);
        return;
      }
      const result = await completedGameRepo.tombstone(id, writerContext.authorUid);
      if (result === 'not-synced') {
        setDeleteBlocked(true);
        setDeleteError(false);
        return;
      }
      if (result === 'error') {
        setDeleteBlocked(false);
        setDeleteError(true);
        return;
      }
      setDeleteBlocked(false);
      setDeleteError(false);
      setCompletedGames((prev) => prev.filter((g) => g.id !== id));
      setHistoryOpenId((prev) => (prev === id ? null : prev));
      pendingFinalizesRef.current.delete(id);
      pendingFinalizeRepo.remove(id);
      setFinalizeStatuses((prev) => {
        if (!(id in prev)) return prev;
        const { [id]: _removed, ...rest } = prev;
        void _removed;
        return rest;
      });
      return;
    }
    setDeleteBlocked(false);
    setDeleteError(false);
    const ok = completedGameRepo.remove(id);
    setGameSaveError(!ok);
    if (!ok) return;
    setCompletedGames((prev) => prev.filter((g) => g.id !== id));
    setHistoryOpenId((prev) => (prev === id ? null : prev));
    pendingFinalizesRef.current.delete(id);
    pendingFinalizeRepo.remove(id);
    setFinalizeStatuses((prev) => {
      if (!(id in prev)) return prev;
      const { [id]: _removed, ...rest } = prev;
      void _removed;
      return rest;
    });
  }

  /**
   * PR 6.6: ververst alle vier live App-states nadat `BackupPanel` een
   * import heeft afgerond — de coordinator schrijft rechtstreeks naar de
   * repositories/localStorage, buiten React om, dus zonder deze herlezing
   * zou de UI de oude waarden blijven tonen tot een volgende toevallige
   * her-render.
   */
  async function handleBackupImported() {
    setSettings(await getSettingsAsync(repositories.settings));
    setRoster(await getRosterAsync(repositories.roster));
    setGame(gameRepo.read());
    setCompletedGames(completedGameRepo.list());
    setHistoryOpenId(null);
    setStatsGameIds(null);
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
        {/* PR 7.1c: alleen zichtbaar tijdens een lopende cloud-wedstrijd — een
         * bekeken opzet of afgeronde historie heeft geen actieve sync-cyclus
         * (zie runGameSync hierboven, die dan sowieso niets doet). */}
        {repositories.mode === 'cloud' && game !== null && game.phase === 'tracking' ? (
          <SyncStatusIndicator
            lang={lang}
            status={gameSyncStatus}
            testId="game-sync-status-indicator"
          />
        ) : null}
        {tab === 'settings' ? (
          <>
            <SettingsPanel
              lang={lang}
              storage={browserStorage}
              settings={settings}
              onSettingsChange={setSettings}
              onSave={syncStatus.saveSettings}
              onReset={syncStatus.resetSettings}
              onRefresh={() => getSettingsAsync(repositories.settings)}
              onCloudMigrate={
                repositories.mode === 'cloud' ? handleCloudMigrateSettings : undefined
              }
              canWrite={canWrite}
              updatedAt={settingsUpdatedAt}
            />
            {/* PR 6.6: back-up-sectie, eigenaarsbesluit §E.4 — zelfde
             * bevoegdheidsgrens als Settings/Roster (`canWrite` ==
             * `canManageTeamData`), geen apart capabilitycontract nodig. */}
            <BackupPanel
              lang={lang}
              canWrite={canWrite}
              organizationId={organizationId}
              teamId={teamId}
              organizationName={organizationName || organizationId}
              teamName={(settings.teamName as string) || teamId}
              settings={settings}
              roster={roster}
              settingsRosterMode={repositories.mode}
              settingsRepo={repositories.settings}
              rosterRepo={repositories.roster}
              gameRepo={gameRepo}
              completedGameRepo={completedGameRepo}
              langRepo={langRepo}
              setLang={setLang}
              onImported={() => void handleBackupImported()}
            />
          </>
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
            onOpenChange={(id) => {
              setHistoryOpenId(id);
              setDeleteBlocked(false);
              setDeleteError(false);
            }}
            onDeleteGame={handleDeleteCompletedGame}
            // Externe PR-6.3-review (aug. 2026): verwijderen van historie is een
            // beheeractie (ADR-003: "wedstrijden beheren" is coach/owner/admin),
            // geen live wedstrijdactie — dus `canWrite` (== canManageTeamData),
            // niet de bredere `canWriteGame` (die ook 'scorer' toelaat).
            canWrite={canWrite}
            saveError={gameSaveError}
            deleteBlocked={deleteBlocked}
            deleteError={deleteError}
            tombstoneNoticeCount={repositories.gameSync ? tombstoneNoticeCount : undefined}
            onDismissTombstoneNotice={() => setTombstoneNoticeCount(0)}
            syncStatuses={repositories.gameSync ? finalizeStatuses : undefined}
            cloudSync={repositories.gameSync ? completedGamesCloudSync : undefined}
            cloudReadError={repositories.gameSync ? completedGamesCloudError : undefined}
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
            cloudClaim={cloudClaim}
            onRetryClaim={handleRetryClaim}
          />
        )}
      </main>
    </div>
  );
}

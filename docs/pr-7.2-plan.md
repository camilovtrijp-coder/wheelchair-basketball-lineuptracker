# Voorbereidingsplan PR 7.2 — afgeronde wedstrijden synchroniseren

Status: goedgekeurde bouwrichting; start na 7.1a–7.1c. PR 7.2a gemerged
(#61). PR 7.2b geïmplementeerd. PR 7.2c geïmplementeerd (zie
`docs/IMPLEMENTATION_PLAN.md` §17-statustabel voor het volledige overzicht
van geraakte bestanden en testdekking) — verwijderen is nu een toegestane
tombstone-fieldpatch, rolgebonden via firestore.rules, met resurrectie-
preventie en emulator-e2e-bewijs.

## A. Doel en grenzen

PR 7.2 maakt afgeronde wedstrijden veilig beschikbaar op een tweede apparaat.
De lokale afgeronde wedstrijd blijft tijdens fase 7 behouden. Cloudsync is
idempotent, contextgebonden en zichtbaar herstelbaar; een historie-item is na
afronding inhoudelijk onveranderlijk.

Niet in scope: live scorer-overname (7.3), bulkimport van bestaande gebruikers
(7.4), harde verwijdering of automatische tombstone-purge (8.3).

## B. Vastgelegde bouwkeuzes

- `CompletedGame.id` is de cloud-snapshot-ID; `sourceGameId` koppelt de snapshot
  aan het actieve `gameId` en voorkomt dubbel afronden.
- Actions blijven de reproduceerbare historische bron. Het completed
  parentdocument is een bevroren, leesgeoptimaliseerde snapshot voor Historie,
  Stats, Trends, CSV en tweede-apparaatweergave.
- Een completed snapshot mag alleen ontstaan als de bijbehorende actionset en
  parentstatus serverbevestigd of aantoonbaar hervatbaar zijn. Geen vals succes
  op alleen lokale Firestore-acceptatie.
- Verwijderen wordt een tombstone met `deletedAt`, `deletedBy` en revisie. In
  fase 7 worden tombstones niet automatisch gepurged; PR 8.3 stelt pas een
  definitieve bewaartermijn en beheerproces vast.
- Cloudhistorie wordt via een repositoryadapter aangeboden. Stats/Trends/UI
  blijven afhankelijk van application-poorten en krijgen expliciete
  `loading`/`cache`/`error`/`missing`-semantiek.

## C. Sub-PR's

### 7.2a — idempotent afronden en uploadstatus

1. Voeg een pure completed-snapshotprojectie toe die de bestaande
   `finishGame()`-uitkomst byte-/semantisch behoudt.
2. Breid `GameSyncCoordinator` uit met een hervatbare finalize-flow:
   actions uploaden/readback → snapshot schrijven/readback → parentstatus
   `completed` patchen → lokaal checkpoint bevestigen.
3. Gebruik `CompletedGame.id` en `sourceGameId` als dubbele guard. Een retry na
   crash of timeout maakt geen tweede snapshot.
4. Toon per wedstrijd `lokaal`, `wacht op synchronisatie`, `gesynchroniseerd`
   of `actie nodig`; lokale export blijft altijd beschikbaar.
5. Test crash/fout na iedere stap, dezelfde finalize tweemaal, afwijkende
   bestaande payload, revoked membership en herstel na reload.

Acceptatie: geen duplicaten, geen bronverwijdering en geen succesmelding vóór
serverreadback; CSV en lokale historie blijven gelijk.

### 7.2b — cloudhistorie en tweede apparaat

1. Voeg `CloudCompletedGameRepository` of een samengestelde
   `CompletedGameRepository` toe achter de bestaande poort; documenteer bewust
   hoe lokale pending items met serveritems op ID worden samengevoegd.
2. Query alleen binnen actieve organisatie/teamcontext, standaard nieuwste
   eerst, met een begrensde paginagrootte. Voeg alleen de bewezen index toe.
3. Laat Historie, Stats en Trends dezelfde samengestelde bron gebruiken zonder
   directe Firestore-imports of afwijkende berekeningen.
4. Toon cache-/serveractualiteit en maak een leesfout nooit gelijk aan lege
   historie.
5. Test apparaat B, contextwissel, gelijknamige teams, offline cached history,
   ongecachete context en corrupt/malformed serverdocument.

Acceptatie: apparaat B ziet dezelfde inhoud; cross-org data lekt niet; alle
afgeleide waarden blijven handmatig narekenbaar uit dezelfde fixture.

**Geïmplementeerd** (zie `docs/IMPLEMENTATION_PLAN.md` §17-statustabel voor
het volledige bestandenoverzicht):

- `FirestoreCompletedGameRepository` (nieuw): read-only cloudbron,
  `organizations/{orgId}/teams/{teamId}/completedGames`-query begrensd op
  orgId/teamId, `orderBy('date','desc')`, vaste bovengrens
  (`COMPLETED_GAMES_QUERY_LIMIT`), geen nieuwe index nodig.
- `CompositeCompletedGameRepository` (nieuw): voegt lokaal ∪ cloud samen
  achter de bestaande `CompletedGameRepository`-poort — gededupliceerd op
  `CompletedGame.id` (lokale versie wint bij een botsing, zelfde ID als het
  Firestore-documentnaam-ID uit `GameSyncCoordinator.finalize()`),
  hersorteerd op datum. `add`/`remove`/`replaceAll` delegeren naar lokaal;
  cloudschrijven blijft uitsluitend via `GameSyncCoordinator`. Poort kreeg
  een optionele `subscribe()` (`CompletedGameRepository.ts`) zodat App.tsx op
  cloud-pushes kan reageren zonder dat Stats/Trends/HistoryPanel wijzigen.
- `selectRepositories.ts`/`resolveAppRepositories.ts`: bouwen de composite in
  cloud-modus; `null` in lokale modus (zelfde patroon als `gameSync`).
- `app/App.tsx`: gebruikt `repositories.completedGames`, abonneert op
  cloud-pushes voor `completedGames`-state, en scherpt `handleDeleteCompletedGame`
  aan — verwijderen in cloud-modus blijft nu volledig geblokkeerd (was:
  toegestaan zodra `gesynchroniseerd`), omdat een cloud-only/gesynchroniseerd
  item anders via de eerstvolgende cloud-snapshot-update vanzelf terug zou
  keren (firestore.rules staat nog geen `update`/`delete` toe op
  `completedGames` — dat is PR 7.2c). `deleteBlockedPendingSync`-tekst is
  hierop aangepast (belooft niet langer dat verwijderen na sync alsnog lukt).
- `HistoryPanel`: nieuwe `cloudReadError`-banner (nooit gelijk aan "geen
  wedstrijden") en een lijstbrede `cloudSync`-indicator (cache-/
  serveractualiteit, plan-werk 4).
- Emulator-e2e (`game-sync-second-client-completed-history.spec.ts`, echte
  Rules via `openSecondDevice()`): bewijst dat een op apparaat A afgeronde
  wedstrijd zonder reload op apparaat B verschijnt via de echte Historie-UI.
  **Zijvondst tijdens het schrijven van deze test**: `GameSyncCoordinator
  .finalize()` roept intern `sync()` aan, volledig los van `app/App.tsx`'s
  eigen `gameSyncInFlightRef`-serialisatie voor de live trackingsync — een
  'Afronden'-klik vlak na een score-/segmentactie (vóórdat die actie's eigen
  sync-cyclus server-bevestigd is) laat zo twee gelijktijdige
  `patchSnapshot()`-aanroepen op dezelfde verwachte `revision` racen; de
  verliezer wordt terecht door firestore.rules' optimistische-
  concurrencycheck afgewezen en het checkpoint valt op `actie-nodig`. Dit is
  een bestaande coordinator-brede racevoorwaarde (PR 7.1c/7.2a-scope, geen
  7.2b-regressie) — nooit eerder zichtbaar omdat geen bestaande e2e-test ooit
  een live actie direct liet volgen door 'Afronden' zonder eerst op
  `gesynchroniseerd` te wachten. De nieuwe test ontwijkt 'm door dezelfde
  wacht-tussen-acties-conventie als de rest van de suite te volgen; een
  eventuele coordinator-brede mutex (bijv. `finalize()` via dezelfde
  in-flight/queued-serialisatie als `runGameSync()` laten lopen) is nog niet
  opgelost en verdient een eigen, gerichte PR.
- 7.2b-uitbreiding op `readFinalizeStatus`-gebruik: een cloud-only item
  (nooit lokaal op dit apparaat opgeslagen) wordt in `finalizeStatuses`
  direct als `gesynchroniseerd` behandeld — `readFinalizeStatus()` leest
  uitsluitend het lokale checkpoint en zou anders ten onrechte
  `lokaal-beschikbaar` teruggeven voor een wedstrijd die per definitie alleen
  via een geslaagde serverquery zichtbaar werd.

**Externe review, eerste ronde (PR #64)** — twee code-bevindingen, beide
opgelost:

- P1: `FirestoreCompletedGameRepository.subscribe()` liet `d.data()` (de
  converter) ongevangen; een malformed/corrupt cloud-document crashte zo de
  `onSnapshot`-succescallback in plaats van via `onError` te lopen, waardoor
  de bedoelde cloudfoutbanner onterecht kon wegblijven. Opgelost: `d.data()`
  in try/catch, routeert naar `onError`.
- P2: een cloudfout liet de oude, mogelijk `'gesynchroniseerd'`
  `completedGamesCloudSync` onaangeroerd staan naast de nieuwe foutbanner —
  tegenstrijdige UI. Opgelost: `App.tsx` reset 'm naar `null` bij een
  cloudfout; `HistoryPanel` toont de syncindicator bovendien nooit meer
  tegelijk met `cloudReadError` (defense-in-depth).
- Daarnaast: unit-testdekking toegevoegd voor gelijknamige teams, offline
  gecachte historie (`fromCache`-doorgifte) en ongecachete context/cloudfout
  — via `FakeCloudSource`/`FakeLocalRepo`, niet tegen de echte emulator.

**Externe review, tweede ronde (PR #64)** — terechte kanttekening dat de
eerste ronde het acceptatiepoort-werk 5 alleen met unit-testfakes had
gedekt, niet met echte Firestore-/Playwright-tests. Drie nieuwe
emulator-e2e-bestanden tegen de échte Firestore-/Auth-emulator lossen dit
op, met één genuanceerde bevinding onderweg:

- `tests/e2e-auth/completed-history-offline-cache.spec.ts`:
  1. Server-bevestigde historie overleeft een volledige offline reload
     (`context.setOffline(true)` + `page.reload()`), met een eerlijke
     `'lokaal-beschikbaar'`-syncindicator (nooit het misleidende
     `'gesynchroniseerd'` van vóór het offline gaan).
  2. **Bevinding**: het door de reviewer beschreven scenario ("settings/
     roster gecachet, Historie-tab nog nooit bezocht, offline") bleek bij
     het schrijven van de test NIET reproduceerbaar — `app/App.tsx`
     abonneert de completedGames-cloudquery in een `useEffect` die
     uitsluitend van de organisatie/teamcontext afhangt, niet van welk
     tabblad open staat, dus start 'm altijd GELIJKTIJDIG met settings/
     roster. Er bestaat dus geen bereikbare toestand waarin settings/roster
     wél gecachet zijn maar completedGames niet. De test bewijst dit nu
     positief: een wedstrijd die vóór het eerste bezoek al op de server
     staat (Admin-geseed) is na een simpel team-bezoek — zonder ooit de
     Historie-tab te openen — al offline beschikbaar.
  3. Het WEL bereikbare "nooit-gecachete-context"-equivalent (team zelf nog
     nooit geopend) is exact gate #27 criterium 4
     (`offline-reload-cache-write-second-client.spec.ts`); hier expliciet
     herbevestigd vanuit de completedGames-hoek: `OfflineUncachedScreen`
     blokkeert de Historie-tab volledig, ook als er een echte
     serverwedstrijd (Admin-geseed) bestaat die anders misleidend als "geen
     wedstrijden" getoond had kunnen worden.
- `tests/e2e-auth/completed-history-same-named-teams-switch.spec.ts`: één
  apparaat wisselt tussen twee volledig gescheiden teams met IDENTIEKE naam
  (verschillende orgId/teamId) — bewijst dat elke context uitsluitend zijn
  eigen historie toont, nooit stale data van het andere team, ook niet
  kortstondig tijdens de wissel.
- `finishGameWithOneSegment()`/`readCompletedGameId()` geëxtraheerd naar
  `gameSyncFixtures.ts` zodat de drie completedGames-e2e-bestanden ze delen.

**Externe review, derde ronde (PR #64)** — terechte false-positive-bevinding:
de eerste offline-cachetest rondde de wedstrijd op DEZELFDE browser af
(`finishGameWithOneSegment()` + `readCompletedGameId()` uit localStorage),
dus kon na de offline reload volledig uit `LocalStorageCompletedGameRepository`
komen zonder dat Firestore's `persistentLocalCache` ook maar iets had
gecachet — de test bewees dus niet wat 'ie beweerde te bewijzen. Opgelost:
de test seedt nu een cloud-only wedstrijd via de Admin SDK (nooit via deze
browser afgerond, dus per definitie niet in localStorage), bevestigt
expliciet vóór én ná de offline reload dat het ID afwezig blijft in de
lokale `completedGames`-opslag, wacht online eerst op een server-bevestigd
(`'gesynchroniseerd'`) zichtbaar item, en toont pas dán aan dat het na een
volledige offline reload nog zichtbaar is met een eerlijke
`'lokaal-beschikbaar'`-indicator. Dat sluit de door de reviewer genoemde
false-positive uit: als deze test slaagt, kan dat onmogelijk via de lokale
repository alleen.

### 7.2c — tombstones en pilotbewijs

1. Implementeer verwijderen als toegestane tombstone-fieldpatch; de bevroren
   wedstrijdinhoud blijft onveranderd. Conform ADR-003 mogen owner, admin en
   coach dit; scorer mag wedstrijdacties schrijven maar geen afgeronde historie
   verwijderen en viewer blijft read-only.
2. Synchroniseer tombstones naar andere apparaten en voorkom resurrectie door
   een offline client met een oudere snapshot.
3. Leg het fase-7-bewaarbesluit vast: geen automatische purge vóór 8.3;
   tombstones blijven exporteerbaar/auditbaar.
4. Meet emulator-reads/writes voor upload, history-query, tweede device en
   delete. Vergelijk later op staging met de 5.5c-baseline.
5. Voer twee-device-e2e uit voor upload, offline reload, tombstone, late retry,
   contextisolatie en rule-reject.

Acceptatie: een verwijderd item keert niet terug, een late client verliest zijn
lokale bron niet stil en de zichtbare status verklaart wat herstel vraagt.

**Geïmplementeerd** (zie `docs/IMPLEMENTATION_PLAN.md` §17-statustabel voor
het volledige bestandenoverzicht):

- `firestore.rules`: `completedGameKeys()`/`isValidCompletedGamePayload()`
  uitgebreid met `revision`/`deletedAt`/`deletedBy` (create eist `revision==0`,
  `deletedAt==null`, `deletedBy==null`). Nieuwe `allow update` op
  `completedGames/{completedGameId}` — uitsluitend `canManageTeamData`
  (owner/admin/coach, bewust NIET de ruimere `canWriteGameData`: scorer mag
  wedstrijdacties schrijven maar geen afgeronde historie verwijderen), alleen
  als `resource.data.deletedAt == null` (geen dubbele tombstone, geen
  undelete-pad), `diff(...).affectedKeys().hasOnly(['deletedAt','deletedBy',
  'revision'])` (bevroren inhoud blijft byte-identiek), `deletedBy ==
  request.auth.uid`, en `revision == resource.data.revision + 1`
  (optimistische concurrency, zelfde contract als de `games`-paden). `allow
  delete` blijft `false` — een tombstone is en blijft een fieldpatch, nooit
  een hard delete.
- `CompletedGame` (domain) / `CompletedGameDocument` (Firestore): nieuwe
  velden `revision: number`, `deletedAt: string | null` (Timestamp op de
  Firestore-kant), `deletedBy: string | null`. `finishGame()`,
  `migrateV1CompletedGame()` en backup-import (`BackupCoordinator.
  writeCompletedGamesSection()`) normaliseren deze naar hun aanmaak-default
  voor bestaande/oudere payloads (backward-compatibel, geen migratiepad
  nodig).
- `GameCloudGateway.tombstoneCompletedGame()` (nieuw) +
  `FirestoreGameCloudGateway`-implementatie: niet-transactionele
  `updateDoc()` (net als `patchSnapshot()`) — rules dwingen concurrency/
  eenmaligheid al af.
- `CompositeCompletedGameRepository`: nieuwe async `tombstone(id, deletedBy)`
  (`'ok' | 'not-synced' | 'error'`) — vindt de cloud-revisie, roept de
  gateway aan, ruimt bij succes de lokale kopie proactief op.
  Resurrectie-preventie in `mergeGames()`: een cloud-item met `deletedAt !=
  null` wordt ALTIJD uit de zichtbare lijst gefilterd, ook als er nog een
  niet-getombstoned lokale kopie bestaat; het cloud-`subscribe()`-abonnement
  ruimt zo'n lokale kopie bovendien proactief op zodra de tombstone
  binnenkomt, zodat een laat/offline apparaat dat de tombstone nog niet kende
  'm bij het eerste online moment leert i.p.v. het item te blijven
  "resurrecten".
- `app/App.tsx` `handleDeleteCompletedGame()`: niet meer onvoorwaardelijk
  geblokkeerd in cloud-modus. Nog niet server-bevestigd → nog steeds
  geblokkeerd (`deleteBlocked`, tekst aangepast: belooft nu expliciet "wacht
  tot synchronisatie voltooid is"). Wél server-bevestigd → roept
  `tombstone()` aan; een afgewezen/gefaalde patch toont een nieuwe, aparte
  `deleteError`-banner (los van `deleteBlocked` en `saveError`) en laat het
  lokale item ongemoeid.
- Bewaarbesluit (werk 3): geen automatische purge vóór PR 8.3 — een
  getombstoned document wordt nooit hard verwijderd, blijft dus
  auditeerbaar/exporteerbaar via de server zelf (Firebase Console/Admin SDK).
  Er is bewust GEEN nieuwe app-UI voor het exporteren/beheren van tombstones
  in deze PR — dat is samen met het definitieve bewaarproces PR 8.3-scope.
- Reads/writes-meting (werk 4): nieuw
  `firebase/tests/rules/pilot-reads-writes-completed-games.spec.ts` (losstaand
  van het PR 5.4c-bestand, andere collecties/scenario's) meet tegen de echte
  emulator: afronden (finalize-batch) = 2 writes; cloudhistoriequery op twee
  apparaten = 2 reads (1 per apparaat, 1 document elk); tombstone-delete = 1
  write. Emulatorproxy, geen Firestore-factuurmeting (Rules-interne reads/
  listener-reconnects niet inbegrepen, zelfde beperking als de PR 5.4c-meting)
  — vergelijking met de 5.5c-staging-baseline blijft een handmatige
  staging-stap (zie `docs/pr-5.5-handmatig-protocol.md`), niet geautomatiseerd
  hier.
- Emulator-e2e (werk 5): nieuwe
  `tests/e2e-auth/game-sync-second-client-tombstone.spec.ts` (echte Rules via
  `openSecondDevice()`) bewijst de volledige cyclus: apparaat A rondt af en
  verwijdert via de echte 'Verwijderen'-knop (coach-rol); een Admin-SDK-lezing
  bevestigt server-kant `deletedAt`/`deletedBy` gezet en de bevroren
  score/segmenten ongewijzigd; apparaat B, GEOPEND NA de tombstone, ziet het
  item nooit (resurrectie-preventie, ook via de echte UI/query, niet alleen
  de unit-testfakes). "Upload", "offline reload" en "contextisolatie" bleven
  al gedekt door de bestaande 7.2b-e2e-specs (ongewijzigd, blijven groen: 58
  specs in `test:e2e:auth`). "Rule-reject" voor tombstonen is uitputtend
  gedekt op Rules-niveau (12 nieuwe tests in
  `firebase/tests/rules/completed-games.spec.ts`: owner/coach mogen,
  scorer/viewer/cross-org niet, geen namens-een-ander, geen extra
  velden, geen verouderde revisie, geen dubbele tombstone, geen undelete, nog
  steeds onverwijderbaar, viewer kan een getombstoned item nog lezen) — een
  losse e2e-rule-reject-test voor tombstonen specifiek is bewust niet
  toegevoegd (de bestaande `game-sync-real-rules-rejection.spec.ts` dekt al
  het algemene patroon "live rolverlaging → echte Rules-afwijzing" voor
  wedstrijddata). "Late retry" (een laat/offline apparaat dat de tombstone
  na reconnect leert) is bewezen op unit-niveau
  (`CompositeCompletedGameRepository.spec.ts`'s resurrectie-preventietests
  met een gecontroleerde `FakeCloudSource`) — geen apart tweede-apparaat-
  e2e-scenario hiervoor, want het mechanisme (cloud-tombstone wint altijd in
  `mergeGames()`, ongeacht lokale staat) is identiek aan wat de nieuwe
  tombstone-e2e voor apparaat B al bewijst.
- Tests: firebase — 12 nieuwe rules-tests in `completed-games.spec.ts` (33
  totaal in dat bestand), 1 nieuwe converter-test in `documentConverters.spec.ts`
  (70 totaal), nieuw `pilot-reads-writes-completed-games.spec.ts` (3 tests) —
  volledige `firebase-base`-rules-suite 189 tests groen tegen de echte
  emulator. v2 — nieuwe/uitgebreide tests in `CompositeCompletedGameRepository
  .spec.ts` (tombstone()-gedrag + resurrectie-preventie), `HistoryPanel
  .spec.tsx` (deleteError-banner), nieuw `AppTombstoneDelete.spec.tsx` (3
  DOM-gedreven App-tests: succesvolle tombstone, afgewezen patch, nog-niet-
  gesynchroniseerd-blokkade), plus fixture-updates in alle bestaande tests die
  een `CompletedGame`/`CompletedGameDocument`-literal bouwen — volledige
  v2-suite (662 tests), typecheck, eslint, prettier en productiebuild groen.
  Volledige `test:e2e:auth`-suite (58 specs, inclusief de nieuwe tombstone-e2e)
  groen tegen de echte Firebase Auth-/Firestore-emulator.

## D. Stopregels

- Geen harde delete of automatische purge zonder PR 8.3-besluit.
- Geen cloudbrede onbegrensde history-query.
- Geen edit-API voor afgeronde kerninhoud.
- Stop wanneer action-derived historie en completed snapshot semantisch
  verschillen; corrigeer eerst projectie/validatie, niet de berekeningen.

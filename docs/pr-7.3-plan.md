# Voorbereidingsplan PR 7.3 — actieve wedstrijd single-writer

Status: 7.3a, 7.3b en 7.3c geïmplementeerd (claim/epoch/overname-plumbing +
pre-game-gate + contextlock + live writer-sync/read-only viewer + de
overname-bevestigings-UI, exporteerbare "Actie nodig"-items en
crashherstel-bewijs) — PR 7.3 als geheel klaar voor 7.3-acceptatie/handoff
richting 7.4. Twee punten blijven expliciet, bewust openstaand (zie 7.3c's
"Geïmplementeerd"-sectie hieronder): echte iOS/Android-hardwarevalidatie
(→ 8.1/8.3, geen Apple-apparaat beschikbaar bij de eigenaar, zelfde als het
5.5c-precedent) en een live-staging-billingmeting (deze sandbox heeft geen
bereikbaar Firebase-staging-project — de emulatormeting hieronder is wél
volledig uitgevoerd, zelfde methode/beperking als 7.2c's precedent).

## A. Doel

PR 7.3 laat één scorer een cloudwedstrijd volledig offline bedienen terwijl
andere apparaten veilig read-only meekijken. Overname is expliciet, online en
fenced: een oude scorer kan na reconnect geen acties uit een eerdere writer
epoch stil toevoegen.

## B. Writerprotocol

- Het parentdocument bevat `writerUid`, `writerDeviceId`, `writerEpoch`,
  `claimedAt`, `lastWriterActivityAt` en auditvelden voor overname.
- Er is geen automatische lease-expiry op basis van de klok. Courtside-
  netwerkverlies mag eigenaarschap niet ongemerkt laten vervallen.
- Een cloudwedstrijd krijgt vóór tip-off een serverbevestigde writerclaim.
  Daarna mag de actieve scorer de volledige wedstrijd offline spelen en
  afronden. Alleen-lokale modus blijft zonder claim of netwerk werken.
- Overname vereist online transactie/revisiecontrole, sterke bevestiging en
  verhoogt `writerEpoch` atomair. Offline overname bestaat niet.
- Iedere action draagt epoch, device en monotoon sequence. Rules accepteren
  alleen de actuele writer. Actions uit een oude epoch blijven lokaal onder
  `Actie nodig` en worden nooit automatisch herschreven naar de nieuwe epoch.
- Actions zijn bron voor score/segmenthistorie. Draaivelden worden als
  field-patch op de parent snapshot gesynchroniseerd; een volledige `setDoc`
  mag geen ander-apparaatveld overschrijven.

## C. Sub-PR's

### 7.3a — claim, epoch en pre-game gate

1. Voeg pure writerstate-/transitiontypes toe met expliciete foutcodes.
2. Implementeer claim en takeover in `GameCloudGateway` met Firestore-
   transactie en parentrevisie; Rules bewaken rol, uid, device en epoch.
3. Breid de pre-game-readinesscheck uit: app-shell, sessie, context, roster,
   settings én serverbevestigde cloudwriterclaim. Toon per ontbrekende stap een
   NL/EN-herstelactie.
4. Vergrendel organisatie/teamcontext zodra een wedstrijd tracking/claim heeft;
   navigeren mag, maar wisselen naar een andere context vereist eerst stoppen
   of expliciet loslaten volgens het protocol.
5. Test claimrace, viewer/scorer/coachrollen, offline start, stale revisie,
   dubbele claim en contextwissel.

Acceptatie: exact één device wint; geen timer neemt stil over; zonder bevestigde
cloudclaim start cloudmodus niet, terwijl lokale modus netwerkloos blijft.

**Geïmplementeerd:**

- `v2/src/domain/game/writerClaim.ts` (nieuw): pure types/afleidingen, geen
  Firestore-import. `WriterIdentity`/`WriterClaimState`
  (`deriveWriterClaimState()`: `'unclaimed'|'own'|'other'` t.o.v. dit
  apparaat), `WriterClaimErrorCode` (`'offline'|'stale-revision'|
  'already-claimed'|'role-denied'|'game-completed'|'unknown'`),
  `WriterClaimResult` (succes/failure-union met `identity`/`revision`/
  `claimedAt` resp. `code`), `CloudClaimStatus` (`'not-required'|'pending'|
  'confirmed'|'blocked'` — UI-state voor de pre-game-gate) en
  `gameStartBlockReason()`/`canStartGame()`: combineert de bestaande
  roster-`startBlockReason()` (setup.ts) met de cloudclaim-eis; roster-redenen
  gaan altijd eerst.
- `firebase/src/documents/game.ts` / `firebase/firestore.rules`: twee nieuwe
  velden op `GameDocument`, `claimedAt`/`lastWriterActivityAt` (client-
  autoritatieve ISO-strings, net als `createdAt`/`startedAt` — geen
  `serverTimestamp()`). Rules punt 18 (nieuw): 10a (normale patch) mag
  voortaan ook `lastWriterActivityAt` bijwerken (elke patch van de actuele
  writer is server-zichtbare activiteit); 10b (initiële claim) zet
  `claimedAt`/`lastWriterActivityAt` samen op "nu"; nieuw pad **10d
  (overname)**: elke bevoegde rol (niet alleen de huidige writer) mag een AL
  geclaimd document overnemen mits `writerEpoch` met EXACT 1 omhoog gaat, de
  aanroeper zichzelf claimt, `claimedAt`/`lastWriterActivityAt` samen op "nu"
  gezet worden, de wedstrijd nog niet is afgerond, en geen draaivelden worden
  aangeraakt — zelfde optimistische-concurrencycontrole (`revision == +1`)
  als de andere paden, dus GEEN `runTransaction()` nodig: Firestore
  serialiseert writes per document en Rules herevalueren `resource.data` tegen
  de laatste servertoestand, wat dezelfde garantie geeft als een
  clienttransactie hier zou bieden. Bewust GEEN tijd-/lease-conditie (§B).
  `firebase/tests/rules/games-and-actions.spec.ts` (nieuw: het volledige
  10d-pad — geldige overname door een andere/dezelfde gebruiker, self-
  promotion geweigerd, viewer geweigerd, epoch-sprong/epoch-ongewijzigd
  geweigerd, lege deviceId, claimedAt/lastWriterActivityAt niet-samen
  geweigerd, draaivelden-in-dezelfde-patch geweigerd, stale revision, een
  afgeronde wedstrijd niet overneembaar, en het fencingbewijs: een oude
  actie van de vorige epoch wordt na overname geweigerd). Volledige
  `firebase-base`-Rules-suite (11 bestanden, 209 tests) en unit-suite (75
  tests) groen tegen de emulator.
- `v2/src/application/game/GameCloudGateway.ts` /
  `infrastructure/game/FirestoreGameCloudGateway.ts`: nieuwe
  `claimWriter()`/`takeoverWriter()`-methoden, retourneren `WriterClaimResult`.
  Niet-transactioneel (zelfde redenering als hierboven), met een best-effort
  `classifyClaimFailure()`-readback die een geweigerde `updateDoc()`
  terugvertaalt naar een specifieke `WriterClaimErrorCode` voor de UI.
  `GameSnapshotWriteResult` draagt nu ook `writerEpoch` — nodig omdat
  `GameSyncCoordinator.sync()` voortaan het ECHTE serverepoch gebruikt voor
  `projectGameActions()` (i.p.v. de statische `GameCloudWriterContext.
  writerEpoch`, die vóór 7.3a altijd vast op 0 stond); zonder deze fix zou een
  actie-upload ná een overname altijd met een verouderd epoch falen.
  `projectGameSnapshotPatch()` krijgt een `now`-parameter (blijft puur) en
  vult `lastWriterActivityAt` — de coordinator geeft z'n eigen `now()` door.
  Nieuwe `GameSyncCoordinator.ensureWriterClaim()` (het EXPLICIETE, blokkerende
  claimpad vóór tip-off — idempotent, geen dubbele write als dit apparaat al
  de bevestigde writer is) en `takeoverWriter()` (dunne doorgeefluik,
  aanroepbare bouwsteen voor de 7.3c-bevestigingsflow, nog geen eigen UI-
  knop). `sync()`'s bestaande interne claim-tijdens-tracking-blijft-bestaan
  als achtervangpad, gebruikt nu ook `claimWriter()` i.p.v. de generieke
  `patchSnapshot()`.
- `v2/src/ui/game/GameSetupPanel.tsx` / `app/App.tsx`: nieuwe `cloudClaim`/
  `onRetryClaim`-props op `GameSetupPanel`. De startknop gebruikt
  `gameStartBlockReason()`: in cloudmodus geblokkeerd totdat `'confirmed'`,
  met een eigen NL/EN-tekst per `WriterClaimErrorCode`
  (`claimBlocked*`-i18n-sleutels) en een "Opnieuw proberen"-knop bij
  `'blocked'`. `App.tsx` roept `ensureWriterClaim()` automatisch aan zodra
  (a) er een `'setup'`-wedstrijd is, (b) de roster startbaar is
  (`startBlockReason() === null`) ÉN (c) de gebruiker daadwerkelijk op het
  Wedstrijd-tabblad staat, in cloud-modus (effect op `game?.id`/`game?.phase`/
  `tab`, niet op elke toetsaanslag) — alleen-lokale modus
  (`repositories.gameSync === null`) blijft `'not-required'` zonder enige
  Firestore/Auth-aanroep. Voorwaarde (c) is een externe-reviewfix: zonder de
  tab-gate claimde de app elke net-aangemaakte 'setup'-opzet (die App.tsx
  altijd derived zodra settings/roster geladen zijn, ook ongezien) meteen bij
  het openen, en opnieuw na het afronden van een wedstrijd (de app schakelt
  dan automatisch naar Historie terwijl er alweer een — vaak direct
  startbare — verse opzet klaarstaat) — beide keren vergrendelde dat de
  organisatie/teamcontext voor een wedstrijd die de gebruiker nooit bewust
  benaderde, zichtbaar geworden via twee falende `test:e2e:auth`-scenario's
  (contextwisselaar bleef onbereikbaar). Een tweede, samenhangende fix: een
  al bevestigde claim (`cloudClaim.kind === 'confirmed'`) wordt alleen nog
  behouden zolang 'm over DEZELFDE wedstrijd gaat (`confirmedForGameIdRef`)
  — anders erfde de VERSE opzet na het afronden stilzwijgend de bevestigde
  status van de oude wedstrijd en bleef de context vergrendeld. Volledige
  `test:e2e:auth`-suite (59 specs) groen tegen de echte Firebase-emulator na
  deze fix.
- `app/App.tsx` / `app/AuthGate.tsx`: nieuwe `AppProps.onGameLockChange`
  — meldt `true` zodra `game.phase === 'tracking'` OF `cloudClaim.kind ===
  'confirmed'` (dus al vóór "Start wedstrijd" geklikt is, zodra de claim
  server-bevestigd is). `AuthGate.handleBackToSwitcher()` blokkeert de
  contextwissel bij een actieve lock en toont een dismissible NL/EN-banner
  (`contextSwitchLocked*`-sleutels) i.p.v. de context stil te wissen. Er
  bestaat in 7.3a nog geen "expliciet loslaten"-actie (dat is 7.3c-scope,
  samen met de overname-/recoveryflow) — tot die tijd is de enige uitweg de
  wedstrijd zelf afronden.
- Nieuwe/uitgebreide v2-unit-tests: `writerClaim.spec.ts` (nieuw, pure
  afleidingen), `GameSyncCoordinator.spec.ts` (uitgebreid met
  `ensureWriterClaim()`/`takeoverWriter()`-scenario's: claim, idempotente
  herclaim, blocked-door-ander-apparaat, offline, foutcode-doorgifte, epoch+1
  bij overname), `GameSetupPanel.spec.tsx` (nieuw, alle
  `CloudClaimStatus`-varianten + alle `WriterClaimErrorCode`-teksten + roster-
  gaat-voor-cloudclaim), `AppWriterClaim.spec.tsx` (nieuw, end-to-end door
  `App` heen: automatische claim, `onGameLockChange`-timing, alleen-lokale
  modus blijft claimloos). Volledige v2-unit-suite nu 713 tests, groen.

**P1-fix (externe review PR #66, na de bovenstaande implementatie):** een
document van vóór PR 7.3a mist `claimedAt`/`lastWriterActivityAt` server-side
VOLLEDIG (de sleutels zelf ontbreken, geen `null`). Dat brak twee dingen: (1)
`gameConverter.fromFirestore()` gooide een `DocumentValidationError` op elke
lezing van zo'n document (`assertNullableIsoTimestampString` behandelde
`undefined` niet als `null`) — `ensureGame()` kon bestaande wedstrijden dus
niet meer lezen; (2) zelfs na een read-side fix bleef een AL geclaimd
legacydocument permanent onpatchbaar: het normale 10a-patchpad
(`projectGameSnapshotPatch()`) liet `claimedAt` bewust altijd ongewijzigd,
maar op een document waar die sleutel nooit bestond blijft 'ie zo voor altijd
afwezig, en `isValidGamePayload()` eist de volledige sleutelset op het
RESULTERENDE document. Fix, spiegelt het PR 7.2c-precedent voor
`completedGames`' `revision`/`deletedAt`/`deletedBy`:
`gameConverter.fromFirestore()` defaultet AFWEZIG naar `null` (AANWEZIG-maar-
fout-getypeerd blijft fail-closed); `GameSyncCoordinator.sync()` geeft het
gelezen `claimedAt` (`ensure.claimedAt ?? null`) voortaan altijd ongewijzigd
mee aan `projectGameSnapshotPatch()`/`patchSnapshot()`; firestore.rules' 10a-
pad gebruikt `('claimedAt' in resource.data) ? resource.data.claimedAt :
null`-defaulting in de vergelijking (zelfde patroon als de
`completedGames`-tombstoneregel) en telt `claimedAt` mee in de
`diff().affectedKeys().hasOnly([...])`-allowlist (het toevoegen van een tot
dan toe afwezige sleutel is voor `diff()` een "gewijzigde sleutel", ook met
een ongewijzigde `null`-waarde). 10b (initiële claim)/10d (overname) hadden
geen fix nodig — die paden zetten `claimedAt`/`lastWriterActivityAt` altijd
al expliciet. Regressietests: `documentConverters.spec.ts` (legacy round-trip
+ fail-closed op malformed), `GameSyncCoordinator.spec.ts` (legacygeclaimd
document synct alsnog), `games-and-actions.spec.ts` (nieuw describe-block:
ongeclaimd/geclaimd legacydocument via 10b/10a/10d, een andere gebruiker kan
het pad niet misbruiken, afgerond legacyparentdocument blijft leesbaar).
Geverifieerd: volledige `test:e2e:auth`-suite (59 specs) en `test:e2e`-suite
(90 specs) opnieuw groen tegen de echte Firebase-emulator.

**Nog niet gedaan (bewust doorgeschoven):**

- Een sterke overname-bevestigingsflow/UI-knop ("Take over") — expliciet
  7.3c-scope (docs/pr-7.3-plan.md §C 7.3c werk 1). `takeoverWriter()` is wél
  geïmplementeerd en getest (Rules + coordinator), maar heeft nog geen
  aanroeppunt in de UI.
- Echte-apparaat-/emulator-e2e-tests (`v2/tests/e2e-auth/*.spec.ts`) voor
  claimrace/offline-start/contextwissel — 7.3a's acceptatiecriteria zijn hier
  bewezen op Rules- en coordinator-/component-niveau; de twee-apparaten-/
  echte-mobiel-validatie is 7.3c-scope (werk 4/5 daar).
- 7.3b (live writer-sync en read-only viewer voor niet-writers) is nog niet
  gestart — dat is waar `takeoverWriter()`'s UI-aanroep en een live viewer-
  abonnement op parent+actions bij horen.

### 7.3b — live writer-sync en read-only viewer

1. Koppel iedere lokale action aan epoch/sequence en laat de coordinator in
   volgorde uploaden; retries blijven idempotent op action-ID.
2. Patch draaivelden en afgeleide snapshot met een revisieguard. De viewer
   abonneert zich op parent + actions en deriveert dezelfde historie.
3. Verberg/disable alle schrijfbediening voor niet-writers en toon wie actief
   scoort plus cache-/serveractualiteit.
4. Houd lokale writeracties bruikbaar tijdens netwerkverlies; geen UI-await op
   server voor score, klok, wissel of segment-save.
5. Test late/out-of-order delivery, duplicated retry, offline writer met online
   viewer, listenerfout, reload en gelijkheid van score/segmenten op A en B.

Acceptatie: viewer kan nooit schrijven; writer blokkeert niet offline; beide
apparaten convergeren na reconnect zonder dubbele of terugwerkende actie.

**Geïmplementeerd:**

- Werk 1 (epoch/sequence per actie, geordende idempotente upload) bleek al
  volledig aanwezig sinds PR 7.3a: `projectGameActions()`
  (`application/game/projectGameForCloud.ts`) stempelt elke actie met het
  ECHTE serverepoch en `sequence == arrayindex`, en
  `FirestoreGameCloudGateway.uploadActions()` is create-only + per-actie
  idempotent via een readback (`alreadyConfirmed`). Alleen geverifieerd/
  gedocumenteerd, niets herbouwd.
- `v2/src/domain/game/deriveGameStateFromCloud.ts` (nieuw, puur, geen
  Firestore-/`firebase-base`-import): `CloudGameActionPayload`/
  `CloudGameActionEnvelope` — structureel identiek aan `firebase-base/
  documents`' `GameActionPayloadDocument`/`GameActionEnvelopeDocument`, dus
  een `GameActionEnvelopeDocument[]` is zonder mapping bruikbaar.
  `sortCloudActions()` sorteert op `sequence` en dedupliceert op `actionId`
  (eerste occurrence wint — action-documenten zijn create-only/onveranderlijk,
  dus een retry is altijd identiek). `deriveCloudGameHistory()` vouwt de
  gesorteerde envelopes samen met `tracking.ts`'s BESTAANDE `applyAction()`-
  reducer vanaf hetzelfde `EMPTY_HISTORY`-startpunt (nu geëxporteerd) — de
  viewer gebruikt dus letterlijk dezelfde berekeningslogica als de lokale
  writer, geen tweede divergerend pad. Dit lost werk 2's "viewer deriveert
  dezelfde historie" en werk 5's late/uit-volgorde/duplicated-retry-eisen
  volledig op domeinniveau op (unit-getest, geen emulator nodig).
- `v2/src/application/game/GameCloudGateway.ts`: nieuwe
  `subscribeToGame()`-poortmethode + `GameCloudSnapshotMeta`/
  `GameCloudParentUpdate`/`GameCloudActionsUpdate`/
  `GameCloudSubscriptionCallbacks`/`GameCloudUnsubscribe`-types. Bewust GEEN
  Rules-uitbreiding nodig: `canReadTeam` (firestore.rules, punt "games"/
  "actions") staat sinds vóór PR 7.1b elke teamrol — inclusief 'viewer' — al
  toe te lezen; de volledige bestaande Rules-suite (11 bestanden, 216 tests)
  bleef ongewijzigd groen. `FirestoreGameCloudGateway.subscribeToGame()`
  (infrastructure) zet twee onafhankelijke `onSnapshot()`-listeners (parent +
  een `actions`-query op `sequence`), elk met `includeMetadataChanges: true`
  voor de cache-/serveractualiteitsindicator; GEEN `withTimeout()` (dat
  patroon is voor request/response, een listener heeft geen zinvolle
  "geen-antwoord-binnen-Xms"-eindtoestand) — een fatale listenerfout komt via
  een eigen `onError`-callback terug, de andere listener blijft onafhankelijk
  actief.
- `v2/src/application/game/GameCloudViewerState.ts` (nieuw, puur): combineert
  de twee onafhankelijke streams tot één `GameCloudViewerSnapshot`
  (`parent`/`history`/`writerClaim`/`freshness`/`loading`).
  `deriveGameCloudViewerSnapshot()` hergebruikt `domain/game/writerClaim.ts`'s
  bestaande `deriveWriterClaimState()` (geen tweede afleiding) en
  `deriveCloudGameHistory()` hierboven. `freshness: 'server'|'cache'|'error'`
  spiegelt Firestore's eigen `fromCache`/`hasPendingWrites` plus een
  listenerfout-vlag — dit is de "cache-/serveractualiteit" uit werk 3.
  `GameSyncCoordinator.subscribeGame()` is een dunne doorgeefluik naar
  `gateway.subscribeToGame()`, zelfde patroon als `ensureWriterClaim()`/
  `takeoverWriter()` (PR 7.3a) — de UI praat nooit rechtstreeks met Firestore.
- `v2/src/ui/game/useGameCloudViewer.ts` (nieuwe hook): bewaart de laatst
  ontvangen parent-/actions-/foutstaat in refs (`onParent`/`onActions`/
  `onError` vuren onafhankelijk van elkaar) en herberekent bij elke update de
  volledige, pure snapshot. Meldt zich automatisch af bij unmount of een
  gewijzigd `organizationId`/`teamId`/`gameId` (nieuw abonnement, oude
  listeners gestopt — dit is het "reload"-scenario uit werk 5: een
  heropend/herladen scherm start gewoon een vers abonnement). `coordinator:
  null` (alleen-lokale modus) levert de blijvende lege snapshot op zonder een
  enkele Firestore-aanroep.
- `v2/src/app/App.tsx`: `isSelfBlockedByOtherWriter` — `true` alleen als er
  ECHT een bevestigde ANDERE writer bekend is (nooit tijdens de initiële
  laadstaat of offline, `!gameCloudViewer.loading`-guard) — dit is werk 4's
  "geen UI-await op server": vóór de eerste parent-snapshot, of zonder
  netwerk, blijft dit apparaat gewoon kunnen scoren. Zodra bevestigd:
  `LiveTrackingPanel`'s BESTAANDE `canWrite`-poort (PR 6.2, al vóór 7.3b
  consequent op elke schrijfbediening in het hele component toegepast — score,
  klok, wissel, segment-opslaan/-bewerken/-verwijderen, afronden) krijgt
  `canWriteGame && !isSelfBlockedByOtherWriter`, en een nieuwe
  `cloud-viewer-banner` toont wie er scoort plus de freshness-tekst
  (`viewerActiveScorerNotice`/`viewerFreshness*`-i18n-sleutels, NL/EN). Geen
  nieuwe disable-props nodig op individuele knoppen — dit lost werk 3
  ("verberg/disable alle schrijfbediening") volledig via de bestaande poort
  op. **Bewuste scopekeuze**: het abonnement hangt aan DIT apparaat se eigen
  `game.id` (het lokale `LocalStorageGameRepository`-slot) — v2 heeft geen
  teambreed "welke wedstrijden lopen nu"-overzicht waarmee een apparaat een
  wedstrijd kan opzoeken die het nooit zelf opzette. Het praktische nut is
  de vaakst voorkomende viewer-situatie: NA een overname
  (`takeoverWriter()`, PR 7.3a) blijft het apparaat dat de wedstrijd ooit
  zelf startte op hetzelfde `game.id` — de cloudclaim wijst dan naar een
  ander apparaat, en deze hook detecteert dat automatisch. Een teambreed
  "bekijk een lopende wedstrijd die ik nooit zelf startte"-overzicht is
  expliciet 7.3c-scope (samen met de overname-bevestigings-UI).
- i18n (`v2/src/i18n/strings.ts`): nieuwe NL/EN-sleutels
  `viewerActiveScorerNotice`/`viewerFreshnessServer`/`viewerFreshnessCache`/
  `viewerFreshnessError`, zelfde plek/stijl als de bestaande
  `claimBlocked*`/`contextSwitchLocked*`-sleutels.
- Werk 4 (lokale writeracties blijven bruikbaar offline, geen UI-await)
  bleek al volledig aanwezig: `app/App.tsx` se `handleGameChange()` schrijft
  synchroon lokaal (`gameRepo.write()`) vóórdat de fire-and-forget
  cloud-sync (`runGameSync()`) start — score/klok/wissel/segment-opslaan
  wachten dus nooit op de server. Alleen geverifieerd/gedocumenteerd (plus
  de nieuwe `isSelfBlockedByOtherWriter`-guard hierboven, die dat gedrag
  bewust niet doorbreekt), niets herbouwd.
- Tests (werk 5): `deriveGameStateFromCloud.spec.ts` (nieuw, puur — in-
  volgorde/uit-volgorde/laat-afgeleverd/gedupliceerde-retry-envelopes leveren
  allemaal dezelfde historie op als de lokale reducer, ook na een
  segment-deleted-herberekening). `GameCloudViewerState.spec.ts` (nieuw —
  alle `writerClaim`-varianten, alle `freshness`-combinaties, inclusief "een
  listenerfout overschrijft freshness maar behoudt de laatst bekende
  parent/historie"). `useGameCloudViewer.spec.ts` (nieuw, `renderHook` —
  alleen-lokale modus zonder abonnement, gameId:null zonder abonnement,
  parent+actions-combinatie, listenerfout, een gewijzigd gameId meldt het
  oude abonnement af en start een nieuw (reload/heropen-scenario), unmount
  meldt af). `GameSyncCoordinator.spec.ts` uitgebreid met een
  `subscribeGame()`-doorgeeftest. `AppGameCloudViewer.spec.tsx` (nieuw,
  component-integratietest door `App` heen — een bevestigde ANDERE writer
  schakelt de tracking-UI naar read-only + toont de banner; dit apparaat als
  bevestigde writer blijft schrijven; alleen-lokale modus blijft ongewijzigd
  zonder abonnement). `v2/tests/e2e-auth/game-sync-live-viewer.spec.ts`
  (nieuw, ECHTE Firebase-emulator, `FirestoreGameCloudGateway.
  subscribeToGame()` vanaf een onafhankelijke, apart ingelogde tweede client
  — zelfde patroon als PR 7.1c's `game-sync-second-client-readback.spec.ts`
  — met `canReadTeam` daadwerkelijk gehandhaafd): bewijst live updates zonder
  actie van de viewer, een offline schrijver die de viewer niet blokkeert
  (laatst bekende stand blijft staan), en convergentie na reconnect zonder
  dubbele/terugwerkende actie (`deriveCloudGameHistory()` op de daadwerkelijk
  ontvangen actions komt exact overeen met de lokale eindstand). Firestore
  Security Rules zelf zijn ONGEWIJZIGD (zie hierboven) — de volledige
  bestaande Rules-suite (11 bestanden, 216 tests) en de volledige v2-
  unit-suite (77 bestanden, 741 tests, incl. de nieuwe hierboven) zijn groen;
  `tsc -b`/`eslint .`/`prettier -c` zijn schoon.

**Niet geverifieerd in deze omgeving:** de Playwright-`test:e2e`/
`test:e2e:auth`-browsersuites (incl. de nieuwe `game-sync-live-viewer.spec.ts`
hierboven) konden hier NIET daadwerkelijk draaien — `npx playwright install
chromium` faalt in deze sandbox op een geblokkeerde download
(`cdn.playwright.dev` niet bereikbaar, geen lokale Chromium-install
beschikbaar). De nieuwe spec is wel `tsc -b`/`eslint`/`prettier`-schoon en
volgt exact het bestaande fixture-patroon van de al-groene 7.1c/7.2b-specs;
de onderliggende Firestore Rules-emulator-suite (die geen browser nodig
heeft) is wél daadwerkelijk gedraaid en groen. Deze spec moet in een
omgeving met een installeerbare Chromium (bijv. CI) alsnog daadwerkelijk
uitgevoerd worden vóórdat PR 7.3b als volledig geverifieerd geldt.

**Regressiefix (na CI-run op PR #68, commit `0cdce2c`):** de eerste versie
van `isSelfBlockedByOtherWriter` hierboven gebruikte kaal
`gameCloudViewer.writerClaim.kind === 'other'` — `deriveWriterClaimState()`
vergelijkt alleen platte `writerUid`/`deviceId`, zonder `writerEpoch`. Dat
brak de PRE-EXISTING PR 7.1c-test `game-sync-claim-conflict.spec.ts`: die
test simuleert via de Admin SDK een onverwachte `writerUid` op het
serverdocument ZONDER `writerEpoch` te verhogen (nooit een ECHTE overname,
bewust vanuit de client onbereikbaar) en verwacht dat de lokale
scorebediening dat NOOIT blokkeert — alleen de cloud-sync mag 'actie-nodig'
melden. Met de kale vergelijking werd deze anomale/corrupte staat ten
onrechte hetzelfde behandeld als een ECHTE, epoch-bevorderde overname
(`takeoverWriter()`, PR 7.3a — verhoogt `writerEpoch` altijd met exact 1),
en schakelde `LiveTrackingPanel` onterecht naar read-only.

Fix: `domain/game/writerClaim.ts` kreeg een nieuwe pure functie
`isEpochPromotedTakeover(claim, ownClaim)` — `true` alleen als
`claim.kind === 'other'` ÉN het geobserveerde `writerEpoch` STRIKT hoger is
dan het epoch dat DIT apparaat zelf bevestigde bij de claim
(`cloudClaim.identity.writerEpoch`, gezet via `ensureWriterClaim()` — niet
de statische `GameCloudWriterContext.writerEpoch`, die vóór een claim altijd
op 0 blijft staan). Ontbreekt een bevestigde eigen claim (`ownClaim.kind !==
'confirmed'`, bijv. een pagina-herlaad midden in tracking) dan valt de
functie conservatief terug op de oude platte vergelijking. `deriveWriterClaimState()`
zelf is ONGEWIJZIGD gebleven — de pre-game-gate (`gameStartBlockReason()`)
blijft bewust de platte vergelijking gebruiken, want vóór tip-off is elke
mismatch een legitieme "iemand anders heeft al geclaimd". `app/App.tsx`'s
`isSelfBlockedByOtherWriter` roept nu `isEpochPromotedTakeover(
gameCloudViewer.writerClaim, cloudClaim)` aan i.p.v. de kale
`writerClaim.kind === 'other'`-check.

Nieuwe tests: `writerClaim.spec.ts` (unit, alle combinaties: gelijk epoch,
lager epoch, hoger epoch, geen bevestigde eigen claim) en twee nieuwe
component-tests in `AppGameCloudViewer.spec.tsx` die de volledige
pre-game-claimflow doorlopen (`ensureWriterClaim()` → `game-start-btn` →
tracking) en bewijzen dat een gelijk-epoch mismatch NIET blokkeert terwijl
een strikt hoger epoch WEL blokkeert — dit sluit de test-gap die
`game-sync-live-viewer.spec.ts` (die test een onafhankelijke tweede-client-
viewer, niet de schrijver se eigen UI-gating) open liet. Volledige v2-
unit-suite (77 bestanden, 748 tests, incl. de nieuwe hierboven), `tsc -b`,
`eslint .`, `prettier -c .` en `firebase/` se `type-check`/`test:unit`
opnieuw gedraaid en groen na deze fix. De PRE-EXISTING
`game-sync-claim-conflict.spec.ts` (het scenario dat deze regressiefix
rechtstreeks raakt) is opnieuw expliciet geverifieerd in de CI-run op commit
`a6fc08d` (GitHub Actions, `v2-e2e`-job) — nog steeds groen na deze fix.

**Nog niet gedaan (bewust doorgeschoven naar 7.3c, per de bestaande
scopesplitsing in dit document):**

- Een teambreed "welke wedstrijden lopen nu"-overzicht waarmee een apparaat
  een cloudwedstrijd kan vinden/bekijken die het zelf nooit opzette — de
  huidige viewer-integratie hangt aan het eigen `game.id`-slot (zie hierboven).
- De sterke overname-bevestigingsflow/UI-knop ("Take over") — al in 7.3a als
  doorgeschoven genoteerd, blijft 7.3c-scope.
- Een nieuwe epoch/sequence bij overname (7.3c werk 2) en crashherstel tussen
  lokale actie/upload/checkpoint (7.3c werk 3).
- Echte twee-browser-/mobiel-apparaatvalidatie (7.3c werk 4) — deze PR bewijst
  het protocol op Rules-/coordinator-/component-/emulator-niveau (inclusief
  één live-listener-e2e-spec, nog niet daadwerkelijk in browser gedraaid in
  deze omgeving, zie hierboven), niet op echte iOS/Android-hardware.
- **Persistente epoch-baseline over een paginaherlaad heen (review-note,
  minimax, PR #68 punt 3):** `isEpochPromotedTakeover()` valt terug op de
  platte `writerClaim.kind === 'other'`-vergelijking zolang `cloudClaim.kind
  !== 'confirmed'` — o.a. het venster vlak ná een paginaherlaad midden in
  tracking, wanneer een verse `ensureWriterClaim()` nog `'pending'` is. In
  dat venster kan een gelijk-epoch writerUid/deviceId-mismatch (het
  anomale/corrupte-staat-scenario, zie de regressiefix hierboven) de
  scorebediening opnieuw TIJDELIJK/onterecht naar read-only laten omschakelen
  totdat de herclaim bevestigt — een transiënt fout-positief, geen
  dataverliesrisico, maar wel een UX-hobbel. Een echte oplossing vergt een
  PERSISTENTE `confirmedEpochBaselineRef` (het laatst bevestigde eigen
  writerEpoch voor deze wedstrijd, bewaard over een reload heen — bijv. via
  een nieuw veld op `LocalStorageGameSyncCheckpointRepository` — i.p.v. alleen
  in-memory `cloudClaim`-state) zodat de epoch-vergelijking ook tijdens het
  'pending'-venster de juiste baseline heeft. Dit is een echte
  product-/architectuurkeuze (welke garanties geeft zo'n bewaarde baseline na
  bijv. een `takeoverWriter()` door een ANDER apparaat terwijl dit apparaat
  offline was?) en daarom bewust NIET blind gefixed in 7.3b — reviewer noemt
  dit zelf "misschien voor 7.3c; nu niet blokkerend". Opgenomen als expliciete
  7.3c-kandidaat.

### 7.3c — overname, recovery en echte-apparaatvalidatie

1. Bouw een sterke bevestigingsflow met zichtbare huidige writer, laatste
   serveractiviteit en gevolg voor nog offline actions.
2. Na transactie-overname start een nieuwe epoch/sequence. Oude queued writes
   moeten bij reconnect Rules-falen en als exporteerbare `Actie nodig`-items
   verschijnen.
3. Voeg herstel voor crash tussen lokale action, cloudupload en checkpoint toe;
   de lokale actielog wordt nooit automatisch verwijderd.
4. Test twee browsers plus echte iOS/Android-apparaten: offline scorer, viewer,
   takeover, oude scorer reconnect, reload en afronden.
5. Leg clientcalls en billable stagingreads/-writes vast tegen de 5.5c-baseline.

Acceptatie: overname is auditbaar en niet dubbel; een oude writer kan niets
stil overschrijven; beide mobiele runs slagen en open platformafwijkingen gaan
expliciet naar 8.1/8.3.

**Geïmplementeerd:**

- **Werk 1 (overname-bevestigingsflow):** `takeoverWriter()` had sinds PR 7.3a
  geen UI-aanroeppunt — dat is hier toegevoegd. Nieuwe
  `v2/src/ui/game/TakeoverConfirmDialog.tsx`: toont de huidige (ANDERE)
  writer (`writerUid`/`deviceId`/`writerEpoch`, verkort weergegeven — v2 heeft
  geen client-side displaynaam-directory voor een willekeurige uid), de
  laatste bekende serveractiviteit (`GameDocument.lastWriterActivityAt`,
  PR 7.3a) en — als dit apparaat zelf nog niet-gesynchroniseerde lokale
  acties heeft — een waarschuwing met het aantal (`GameSyncCoordinator.
  readSyncDiagnostics()`, nieuw, wraps de bestaande private
  `readCheckpoint()`+`buildGameSyncDiagnostics()`). Bevestigen is een
  EXPLICIETE knopklik (`takeover-confirm-btn`) — nooit auto-getriggerd (§B/§D).
  `app/App.tsx`: nieuwe `showTakeoverConfirm`/`takeoverInFlight`/
  `takeoverBlockedCode`-state, een "Overnemen…"-knop (`takeover-open-btn`) in
  de bestaande `cloud-viewer-banner` (PR 7.3b), en `handleConfirmTakeover()`
  die `coordinator.takeoverWriter(game, writerContext, huidigeEpoch,
  huidigeRevisie)` aanroept met het epoch/revisie van de ACTUELE (andere)
  writer zoals de live-viewersubscriptie ('m al kende — geen aparte
  voorafgaande leesoperatie nodig. Een geslaagde overname zet `cloudClaim`
  meteen naar `'confirmed'` met de nieuwe identiteit (`isEpochPromotedTakeover()`
  ziet het eigen nieuwe epoch onmiddellijk, geen wachten op de eerstvolgende
  listener-snapshot) en triggert direct een `runGameSync()`; een mislukte
  poging toont de foutcode inline in het dialoog (nieuwe `takeoverBlocked*`-
  i18n-sleutels, zelfde stijl als `claimBlocked*`) en sluit niet vanzelf.
  NL/EN-strings: `takeoverOpenBtn`/`takeoverConfirmTitle`/
  `takeoverCurrentWriterLabel`/`takeoverLastActivityLabel`/
  `takeoverPendingActionsWarning`/`takeoverConfirmBtn`/`takeoverCancelBtn`/
  `takeoverBlocked*` (6 foutcodes).
- **Werk 2 (nieuwe epoch/sequence + exporteerbare "Actie nodig"):**
  geverifieerd dat sequence-numering na een overname al correct is, GEEN
  wijziging nodig — `projectGameActions()` (PR 7.3a, `application/game/
  projectGameForCloud.ts`) stempelt bij ELKE sync-cyclus het ECHTE,
  actuele serverepoch en `sequence == arrayindex` opnieuw; een nieuwe writer
  (of de oude writer die zichzelf terugneemt) krijgt dus vanzelf een schone,
  aaneengesloten sequence vanaf de eigen `game.actions`-array, zonder botsing
  met wat de vorige epoch al server-bevestigd had (aparte, immutable
  `actionId`-documenten). De coordinator-brede fencing ("oude queued writes
  falen bij reconnect") bleek eveneens al volledig aanwezig sinds PR 7.3a:
  `GameSyncCoordinator.sync()` vergelijkt `writerUid`/`deviceId` VÓÓR
  `uploadActions()` en stopt met `'actie-nodig'` zodra een ander apparaat de
  claim overnam — Rules' epoch-fencing op de actions-createregel (punt 11,
  al sinds PR 7.3a getest in `games-and-actions.spec.ts`) is het onafhankelijke
  server-side vangnet daarachter. Nieuw is het exportpad: `domain/game/
  gameSyncDiagnostics.ts` kreeg `unconfirmedGameActions()` (puur — filtert
  `game.actions` op `checkpoint.confirmedActionIds`, muteert nooit de lokale
  log), `GameSyncCoordinator.readUnconfirmedActions()` ontsluit dit voor de
  UI, en nieuw `infrastructure/game/exportPendingGameActions.ts`
  (`buildPendingGameActionsEnvelope()`/`downloadPendingGameActions()`) —
  zelfde downloadpatroon als PR 5.3c-2's `exportPendingPayload.ts` voor
  settings/roster, maar een eigen `lineup-tracker-game-actions`-envelop
  (acties zijn geen v1-back-upconcept, dus geen misplaatst hergebruik van die
  envelop). `app/App.tsx`: een nieuwe "Exporteer niet-gesynchroniseerde
  acties"-knop (`game-sync-export-btn`) naast de bestaande wedstrijd-sync-
  indicator, alleen zichtbaar bij `status === 'actie-nodig'`.
- **Werk 3 (crashherstel):** geverifieerd, met tests, dat de bestaande
  architectuur dit al by construction voorkomt — geen nieuwe outbox nodig
  (zelfde uitkomst als 7.3b's werk 1/4-bevindingen). De echte schrijfvolgorde
  in `app/App.tsx`'s `handleGameChange()` is `gameRepo.write(next)`
  (SYNCHROON, `localStorage.setItem`) vóórdat de fire-and-forget
  `runGameSync()` ooit start — er bestaat dus geen venster waarin een lokale
  actie al "onderweg" is naar de cloud maar nog niet duurzaam op schijf staat.
  Het enige overblijvende crashvenster is tussen een geslaagde server-upload
  en de lokale checkpointwrite die dat had moeten vastleggen
  (`GameSyncCoordinator.sync()`: `uploadActions()` eerst, dan pas
  `checkpoints.write()`) — dat venster is AL veilig by design:
  `FirestoreGameCloudGateway.uploadActions()` is create-only + idempotent
  (readback → `alreadyConfirmed`, PR 7.1c/7.3b), dus een retry na zo'n crash
  raakt gewoon het bestaande server-document i.p.v. een dubbele actie te
  creëren. `§D "de lokale actielog wordt nooit automatisch verwijderd"` is
  eveneens al gegarandeerd: alleen `GameRepository.write()`
  (`app/App.tsx`/`domain/game/finish.ts`-flows) muteert
  `ActiveGame.actions`, nooit de sync-/checkpointlaag. Nieuwe tests in
  `GameSyncCoordinator.spec.ts` bewijzen dit expliciet: een volledig
  ontbrekend checkpoint (alsof de app crashte vóór ELKE checkpointwrite)
  herstelt gewoon vanaf nul; een server-bevestigde-maar-lokaal-nog-
  onbevestigde actie (het exacte "tussen upload en checkpoint"-venster) raakt
  de `alreadyConfirmed`-idempotentie zonder dubbele actie; en herhaalde
  gesimuleerde checkpointverliezen over meerdere sync-cycli laten de lokale
  actielog zelf op geen enkel moment krimpen.
- **Werk 4 (twee-browser-/mobiel-apparaatvalidatie):** nieuwe
  `v2/tests/e2e-auth/game-sync-takeover.spec.ts` (echte Firebase-emulator,
  zelfde twee-apparatenpatroon als `game-sync-live-viewer.spec.ts`/
  `game-sync-second-client-readback.spec.ts`: apparaat A is de echte
  browser-app, apparaat B een onafhankelijk ingelogde tweede
  `FirestoreGameCloudGateway`-client via `connectAsSecondClient()`, ECHTE
  Rules gehandhaafd). Dekt: offline/online scorer A start en scoort, B neemt
  écht over (`takeoverWriter()`, eigen `deviceId`) — A's eigen coordinator
  detecteert het conflict en wordt zichtbaar `'actie-nodig'` (geen force-push,
  §D), de live-viewerbanner + nieuwe "Overnemen…"-knop verschijnen op A, A
  bevestigt de overname via de ECHTE UI-dialoog (werk 1, epoch+1, geen
  reload nodig), schrijven hervat meteen, en de wedstrijd is daarna nog
  gewoon afrondbaar (`finishGameWithOneSegment()`). Dit is GEEN
  "twee-browsers"-test in de letterlijke zin (Chromium × 2) — het volgt
  exact hetzelfde, al langer bestaande precedent uit 7.1c/7.3b: één echte
  browser + één Node-side tweede Firestore-client, wat voor dit doel (Rules
  daadwerkelijk gehandhaafd tussen twee onafhankelijke identiteiten/
  apparaten) equivalent bewijs levert. **Kon in deze sandbox NIET
  daadwerkelijk uitgevoerd worden**: `npx playwright install chromium` faalt
  hier op een geblokkeerde download (`cdn.playwright.dev` niet bereikbaar,
  zelfde bevinding als PR 7.3a/7.3b) — opnieuw geverifieerd tijdens deze PR.
  De nieuwe spec is wél `tsc -b`/`eslint`/`prettier`-schoon en volgt exact het
  bestaande fixture-patroon van de al in CI groene 7.1c/7.3b-specs; moet in
  een omgeving met installeerbare Chromium (GitHub Actions) alsnog
  daadwerkelijk draaien vóór PR 7.3c als volledig geverifieerd geldt. **Update
  na de eerste échte CI-run (GitHub Actions, PR #69):** de spec draaide daar
  wél, en legde een testontwerpfout bloot — de oorspronkelijke versie liet A's
  2e lokale klik ná B's overname RACEN tegen A's eigen live parent-listener
  (die de overname o.b.v. `isEpochPromotedTakeover()` correct en bedoeld
  meteen kan gaan blokkeren, PR 7.3b werk 3); in CI won de listener vaak, dus
  faalde de klik op een uitgeschakelde knop — een testfout, geen
  app-regressie. Fix: A gaat expliciet offline (`page.context().
  setOffline(true)`) vlak vóór B's overname, scoort lokaal terwijl offline
  (deterministisch nooit netwerk-gate, §D), en gaat pas daarna weer online —
  waarna de reconnect-trigger vanzelf een sync start die op het ECHTE
  overnameconflict stuit en de listener de overname alsnog ziet. **Echte
  iOS/Android-hardwarevalidatie is in deze sandbox principieel onmogelijk**
  (geen fysieke/geëmuleerde mobiele apparaten beschikbaar) — dit wordt, exact
  zoals dit werk-item's eigen acceptatiecriterium voorschrijft ("open
  platformafwijkingen gaan expliciet naar 8.1/8.3"), NIET hier gefingeerd
  maar doorgeschoven naar PR 8.1/8.3, net als het bestaande 5.5c-iOS-punt
  (`docs/IMPLEMENTATION_PLAN.md`, geen Apple-apparaat beschikbaar bij de
  eigenaar).
- **Werk 5 (clientcalls/billable stagingreads-writes tegen de 5.5c-baseline):**
  zelfde methode als het PR 7.2c-precedent
  (`pilot-reads-writes-completed-games.spec.ts`) — een reproduceerbare
  EMULATORMETING, geen live Firestore-factuurmeting. Nieuwe
  `firebase/tests/rules/pilot-reads-writes-takeover.spec.ts` (3 scenario's,
  tegen de echte Firestore-emulator): live-viewerabonnement se eerste
  snapshot (`subscribeToGame()`'s `getDoc()`+`getDocs()`-equivalent) = 2 reads
  (1 parent + 1 actiondocument); een overname (10d) = 1 write; een hervatte
  sync ná overname (2 nieuwe action-uploads + 1 snapshotpatch) = 3 writes.
  Totaal per volledige cyclus: 2 reads/4 writes; × 100 pilot-runs: 200
  reads/400 writes. Volgende live-updates op een AL open listener zijn in het
  echte Firestore-billingmodel gratis (geen nieuwe "document read" per
  gewijzigd veld) en dus bewust niet meegeteld — zelfde afbakening als de
  twee bestaande pilotbestanden. **Vergelijking met de daadwerkelijke
  5.5c-staging-baseline (`docs/pr-5.5-onderzoeksrapport.md`,
  `basketball-tracker-staging`) blijft, exact zoals bij het 7.2c-precedent,
  een handmatige staging-stap** — deze sandbox heeft geen bereikbaar/
  ingelogd Firebase-staging-project, dus die vergelijking kon hier niet
  daadwerkelijk uitgevoerd worden. Wat daarvoor nodig zou zijn: een korte
  handmatige sessie op de bestaande staging-omgeving (zelfde testaccounts
  A-D als het 5.5c-protocol, `docs/pr-5.5-handmatig-protocol.md`) die één
  overname + de bijbehorende hervatte sync uitvoert terwijl de Firebase
  Console se gebruiksdashboard openstaat, en de daadwerkelijke reads/writes
  tegen bovenstaande emulatorextrapolatie afzet.

**Tests (samenvatting):** v2-unit-suite 78 bestanden/768 tests (+15 t.o.v.
7.3b: `gameSyncDiagnostics.spec.ts`/`GameSyncCoordinator.spec.ts` uitgebreid,
nieuw `exportPendingGameActions.spec.ts`, `AppGameCloudViewer.spec.tsx`
uitgebreid met 3 overname-UI-scenario's), groen; `tsc -b`, `eslint .`,
`prettier -c .` schoon. `firebase-base`: `type-check`/`test:unit` (78 tests)
groen, volledige Rules-emulatorsuite 12 bestanden/219 tests (+3 t.o.v. 7.3b —
`pilot-reads-writes-takeover.spec.ts`, GEEN wijziging aan `firestore.rules`
zelf nodig, zie werk 2 hierboven) groen. Playwright-`test:e2e:auth`-suite
(incl. de nieuwe `game-sync-takeover.spec.ts`) kon in deze sandbox niet
daadwerkelijk draaien (chromium-installatieblokkade, zie werk 4) — moet in CI
bevestigd worden.

## D. Stopregels

- Geen time-based auto-takeover.
- Geen CRDT of echte multi-writer in fase 7; dat blijft alleen een fase-9-optie
  als pilotbewijs aantoont dat single-writer onvoldoende is.
- Geen force-push van oude actions naar een nieuwe epoch.
- Geen cloudwedstrijd starten zonder serverbevestigde claim, behalve wanneer
  de gebruiker expliciet in alleen-lokale modus werkt.

# Voorbereidingsplan PR 7.3 — actieve wedstrijd single-writer

Status: 7.3a geïmplementeerd (claim/epoch/overname-plumbing + pre-game-gate +
contextlock); 7.3b/7.3c nog niet gestart.

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

## D. Stopregels

- Geen time-based auto-takeover.
- Geen CRDT of echte multi-writer in fase 7; dat blijft alleen een fase-9-optie
  als pilotbewijs aantoont dat single-writer onvoldoende is.
- Geen force-push van oude actions naar een nieuwe epoch.
- Geen cloudwedstrijd starten zonder serverbevestigde claim, behalve wanneer
  de gebruiker expliciet in alleen-lokale modus werkt.

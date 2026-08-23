# Voorbereidingsplan PR 7.4 — bestaande gebruiker naar cloud

Status: 7.4a (inventarisatie, mapping en preview) en 7.4b (hervatbare
migratiecoordinator) geïmplementeerd — zie "Geïmplementeerd" onder §C 7.4a/
7.4b. 7.4c (migratie-UI en volledige e2e) nog niet gestart.

## A. Doel en relatie met PR 6.6

PR 7.4 hergebruikt PR 6.6's fail-closed validatie, preview, herstelback-up,
contextbevestiging en rollbackjournal, maar schrijft bestaande lokale team- en
wedstrijddata gecontroleerd naar de cloud. De lokale bron blijft behouden.

Deze PR is geen tweede algemene back-upimporter. Hij migreert een vooraf
geïnventariseerde lokale broncontext naar exact één bevestigde cloudcontext en
kan veilig worden hervat.

## B. Vastgelegde bouwkeuzes

- Alleen `organizationOwner`, `organizationAdmin` en `coach` mogen bulk-
  migreren. `scorer` mag wedstrijden bedienen via 7.3 maar niet een heel team
  migreren of bulk verwijderen; `viewer` blijft read-only.
- Een actieve wedstrijd in `tracking` wordt niet bulk gemigreerd. Die wordt via
  het 7.3-writerprotocol expliciet geadopteerd, zodat er eerst één geldige
  writerclaim bestaat. Een setup zonder bevestigde acties mag alleen na
  afzonderlijke previewbeslissing mee.
- IDs zijn deterministisch: bestaande v2-UUID's blijven gelijk; legacybron
  gebruikt bronfingerprint + bron-ID + doelcontext. Retry maakt geen duplicaat.
- Migratie gebruikt een cloud `migrationRun`-manifest met hash, doelcontext,
  aantallen, status en per-itemcheckpoint. Alleen een volledig bevestigde run
  wordt als voltooid gepresenteerd.
- Rollback betekent: lokale bron onaangeraakt; nog niet zichtbare clouditems
  stoppen, en reeds geschreven migratie-items worden veilig gecompenseerd of
  getombstoned. Geen harde delete en geen vals “alles teruggedraaid” wanneer een
  compensatie faalt.

## C. Sub-PR's

### 7.4a — inventarisatie, mapping en preview

1. Inventariseer settings, roster, actieve game en completed games per lokale
   broncontext met strikte readresultaten; corrupte of onduidelijke data stopt
   vóór iedere cloudwrite.
2. Bouw een pure `CloudMigrationPreview` met bron-/doel-ID's en namen,
   aantallen, bestemmingen, duplicaten/conflicten, trackinggame-status,
   benodigde writes en waarschuwingen.
3. Maak deterministische mappings en payloadhashes; dezelfde bron/doelcombinatie
   levert exact hetzelfde manifest.
4. Controleer capability en context zowel bij preview als vlak voor bevestiging;
   een rol- of contextwissel maakt de preview ongeldig.
5. Test gelijknamige teams in meerdere organisaties, lege/partiële/corrupte
   bron, bestaande clouditems, dubbele IDs en actieve trackinggame.

Acceptatie: nul writes vóór bevestiging; bron en doel zijn ondubbelzinnig; een
scorer/viewer krijgt geen bulkactie.

**Geïmplementeerd:**

- `v2/src/domain/migration/` (nieuw, volledig puur — geen Firebase-/storage-
  import in dit hele package, geverifieerd via `tsc -b`+`eslint`):
  - `fingerprint.ts`: `stableStringify()` (alfabetisch gesorteerde
    objectsleutels, arrays behouden hun volgorde) + `fnv1a()` (32-bit,
    hex) → `payloadHash()`. Bewust geen `crypto.subtle` (geen
    beveiligingsdoel, alleen "is dit gewijzigd sinds de vorige preview",
    zie de docstring). `deriveExistingUuidMigrationId()`/
    `deriveLegacyMigrationId()`: de twee helften van §B se ID-contract,
    zie de ontwerpbeslissing hieronder.
  - `capability.ts`: `canBulkMigrate(role)` — eigen allowlist
    (`organizationOwner`/`organizationAdmin`/`coach`), bewust NIET
    hergebruikt van `domain/organizations/teamAccess.ts`'s
    `canManageTeamData` (zelfde rollen vandaag, ander CONCEPT — zie
    docstring). `computeMigrationContextFingerprint()`/
    `isPreviewStillValid()`: bindt een preview aan
    `(doel-org, doel-team, rol)`; elke wissel maakt 'm ongeldig (werk 4).
  - `payload.ts`: canonicale hashpayloads per sectie
    (`settingsPayloadHash`/`rosterPayloadHash`/`activeGamePayloadHash`/
    `completedGamePayloadHash`), sluiten bewust `organizationId`/`teamId`/
    `revision`/`id` uit zodat identieke inhoud in bron- én doelcontext
    dezelfde hash geeft. `activeGameCloudPayloadHash()` +
    `ActiveGameCloudPayloadFields` (lokale structural type, geen
    `firebase-base`-import in domain/) laat de infrastructuurlaag een
    cloud-`GameDocument` met exact dezelfde formule hashen.
  - `inventory.ts`: `buildLocalMigrationInventory()` hergebruikt
    ONGEWIJZIGD de bestaande `domain/backup/validate.ts`-sectievalidators
    (`validateSettingsSection`/`validateRosterSection`/
    `validateActiveGameSection`/`validateCompletedGamesSection`) — dezelfde
    fail-closed strengheid als een back-up-import, geen tweede
    validatiecopie. Voegt daarbovenop een context-matchcontrole toe
    (`organizationId`/`teamId` op elk `activeGame`/`completedGame`-item
    moet exact de opgevraagde broncontext zijn) — spiegelt
    `LocalStorageGameRepository`'s eigen contextcontrole, maar STRIKTER
    dan `LocalStorageCompletedGameRepository.readAll()`'s stille
    per-item-filter (die is prima voor de Historie-UI, niet voor een
    migratie die moet weten welke org/team iets straks ontvangt): een
    mismatch maakt de HELE sectie `'corrupt'`. `hasCorruptSection()` is de
    harde stop die `preview.ts` gebruikt.
  - `preview.ts`: `buildCloudMigrationPreview()`, de pure kern. Volgorde:
    (1) `canBulkMigrate()` — scorer/viewer krijgen een `allowed:false`/
    `denialReason:'roleDenied'`-preview zonder één item; (2)
    `hasCorruptSection()` — corrupte bron stopt vóór er één item gebouwd
    wordt (`denialReason:'corruptSource'`); (3) pas dan itembouw. Een
    `phase:'tracking'`-actieve wedstrijd wordt NOOIT als bulkitem geteld
    (apart gerapporteerd via `trackingGame`, actie
    `'excludedTrackingGame'`); `phase:'setup'` staat wél in `items` maar
    met actie `'needsSeparateDecision'` — geen van beide telt mee in
    `requiredWrites` (§B). Elk item vergelijkt zijn lokale payloadhash
    tegen `existingCloud` (aangeleverd, niet zelf gelezen) →
    `'create'`/`'alreadyPresentIdentical'`/`'conflict'`. `manifestHash`
    dekt alles behalve `builtAt` (unit-getest: hetzelfde bron/doelpaar op
    een ander moment gebouwd geeft identiek `manifestHash`+`items`).
  - `types.ts`: `CloudMigrationPreview` en alle bijbehorende types. Bewust
    GEEN hergebruik van `domain/backup`'s `ImportPreview` (ander doel, zie
    docstring: PR 7.4 "is geen tweede algemene back-upimporter").
- **Ontwerpbeslissing (ID-determinisme, §B)**: elke lokale bron die de
  huidige inventarisatie kan opleveren draagt al een stabiel v2-UUID
  (`ActiveGame.id`/`CompletedGame.id`) of is een singleton-document
  (settings/roster, vaste padnaam `'current'`) — de "bestaande v2-UUID's
  blijven gelijk"-tak van §B geldt dus voor ELKE huidige broncontext; een
  v1-blob levert nooit rechtstreeks aan deze pijplijn (die gaat eerst door
  `domain/game/v1Migration.ts`, vóórdat 'ie ooit een `ActiveGame` wordt).
  `deriveLegacyMigrationId()` (§B's "legacybron gebruikt bronfingerprint +
  bron-ID + doelcontext"-tak) is daarom voor 7.4a dode code voor de huidige
  broncontexten — wél volledig geïmplementeerd en getest (determinisme,
  contextgevoeligheid, stabiliteit ondanks content-wijziging) als
  herbruikbaar primitief voor 7.4b/een toekomstige niet-UUID-bron, i.p.v.
  twee ID-schema's in één functie te vermengen.
- `v2/src/application/migration/CloudMigrationInventoryGateway.ts` (nieuw):
  application-poort, uitsluitend lezen (`readTargetSnapshot()`) — geen
  enkele write. Geïmplementeerd door:
  - `v2/src/infrastructure/migration/FirestoreCloudMigrationInventoryGateway.ts`:
    elke Firestore-aanroep aan `withTimeout()` gebonden (zelfde patroon/
    reden als `FirestoreGameCloudGateway.ts`). `completedGames` gebruikt
    gebatchte `documentId() in [...]`-queries (max. 30 ID's per batch, de
    Firestore-SDK-limiet) i.p.v. N losse `getDoc()`-aanroepen. Hergebruikt
    `completedGameFromDocument()` (al geëxporteerd door
    `FirestoreCompletedGameRepository.ts`, PR 7.2b) — geen tweede
    documentmapping.
  - `v2/src/infrastructure/migration/collectLocalMigrationInventory.ts`
    (nieuw): infrastructure-rand rond `inventory.ts` — doet UITSLUITEND
    storage-read/`JSON.parse`, geen validatie (die blijft exclusief
    domeinlaag). Settings/roster gebruiken de bestaande GLOBALE sleutels
    (`SETTINGS_STORAGE_KEY`/`ROSTER_STORAGE_KEY` — geen per-org/team-
    scoping, zie `domain/settings/types.ts`/`domain/roster/types.ts`);
    activeGame/completedGames de bestaande per-org/team-sleutels
    (`activeGameStorageKey()`/`completedGamesStorageKey()`, hergebruikt
    ONGEWIJZIGD uit `infrastructure/game/`).
- **Firestore Rules**: GEEN wijziging nodig. `canReadTeam` staat
  settings/roster/games/completedGames-lezen al vóór PR 7.4a voor elke
  teamrol (inclusief `viewer`) toe (firestore.rules regels 605/627/633/
  639/831, bevestigd via de volledige Rules-emulatorsuite: 12 bestanden,
  219 tests, ongewijzigd groen na deze PR).
- **Bewust NIET gebouwd (buiten scope van 7.4a)**: geen App.tsx-wiring/UI
  (het plan zegt expliciet "7.4a heeft waarschijnlijk geen UI" — dat is
  7.4c-scope), geen daadwerkelijke cloudwrite-coordinator (7.4b), geen
  Rules-wijziging (niet nodig, zie hierboven).
- Tests (allemaal nieuw, `v2/tests/unit/migration{Fingerprint,Capability,
  Inventory,Preview}.spec.ts`, 36 tests): determinisme (identiek
  `manifestHash`/`items` bij hergebouwde preview op een ander moment),
  rolweigering (`scorer`/`viewer` → `allowed:false` zonder items; owner/
  admin/coach → toegestaan), corrupte-brondata-stop (vóór itembouw),
  contextfingerprint-ongeldigmaking bij team-/rolwissel, lege/partiële
  bron, dubbele `completedGame`-ID's (via de hergebruikte back-up-
  validator), context-mismatch-detectie, bestaand-identiek-item
  (`alreadyPresentIdentical`), bestaand-afwijkend-item (`conflict`, nooit
  stilzwijgend overwriten), trackinggame-uitsluiting (`tracking` nooit
  bulk, `setup` wel zichtbaar maar met `needsSeparateDecision`), en
  gelijknamige teams over organisatiegrenzen (zichtbare waarschuwing, maar
  bron/doel blijven ondubbelzinnig via organizationId/teamId).
- **Testresultaten**: v2 `vitest run` 82 bestanden/805 tests groen (36
  nieuw); v2 `tsc -b` + `eslint .` + `prettier -c .` schoon; firebase
  `npm run verify` (type-check + 78 unit-tests + volledige Rules-
  emulatorsuite, 12 bestanden/219 tests) ongewijzigd groen. Playwright
  e2e/emulator-Playwright-suites NIET lokaal uitgevoerd: `npx playwright
  install chromium` faalt in deze sandbox met `403` op
  `cdn.playwright.dev` (geblokkeerde CDN) — zelfde bekende sandboxbeperking
  als bij elke eerdere PR in deze reeks (7.2c/7.3a/7.3b/7.3c).

### 7.4b — hervatbare migratiecoordinator

1. Maak eerst een downloadbare lokale herstelback-up en daarna een
   `migrationRun` met immutable manifest/hash.
2. Schrijf in begrensde stappen via de bestaande cloudgateways; na elke stap
   serverreadback en checkpoint. Respecteer batchlimieten en ondersteun reload/
   crash zonder opnieuw beginnen.
3. Hergebruik settings/roster-contracten uit 5.3, completed-gameflow uit 7.2 en
   writeradoptie uit 7.3. Maak geen tweede afwijkend Firestorepad.
4. Detecteer semantisch gelijke bestaande items als bevestigd; afwijkende
   payload onder dezelfde ID is een zichtbaar conflict, nooit een overwrite.
5. Rapporteer `running`, `paused`, `actionNeeded`, `completed` en
   `compensationFailed`; verwijder de lokale bron nooit automatisch.

Acceptatie: retry/reload is idempotent; gedeeltelijke fout meldt nooit succes;
context- of Rules-afwijzing blijft herstelbaar en exporteerbaar.

**Geïmplementeerd:**

- `v2/src/domain/migration/run.ts` (nieuw, puur): de vijf-statusverzameling
  (`MigrationRunStatus`) en de per-item-statusverzameling
  (`MigrationRunItemStatus`: `pending`/`confirmed`/`conflict`/`failed`/
  `compensated`/`compensationFailed`). `createMigrationRun()` bouwt een verse
  run uit een `allowed: true`-preview — neemt UITSLUITEND items mee met
  actie `create`/`alreadyPresentIdentical`/`conflict`
  (`excludedTrackingGame`/`needsSeparateDecision` horen nooit tot een
  bulkrun, §D: "Geen trackinggame via bulkpad om de writerclaim heen").
  `alreadyPresentIdentical` start meteen als `confirmed` (werk 4: "Detecteer
  semantisch gelijke bestaande items als bevestigd", geen write), `conflict`
  start meteen als `conflict` (nooit een write-poging). `runId` is bewust
  altijd `preview.manifestHash` — dezelfde preview levert dus altijd
  dezelfde run-ID op (§B "Retry maakt geen duplicaat" ook op runniveau
  toegepast). `deriveSettledMigrationRunStatus()` is de ENIGE plek die
  `status` mag berekenen (nooit los van de itemset gezet): `'running'`
  bestaat expliciet NIET als opgeslagen waarde — dat is een transiënte
  live-status, uitsluitend zichtbaar terwijl een coordinator-aanroep
  in-flight is. Volgorde: `rollbackRequested` domineert alles
  (`compensationFailed` als een compensatie faalde, anders altijd `paused`
  — NOOIT `completed`, zie §B "geen vals 'alles teruggedraaid'"); dan
  `conflict`/`failed` → `actionNeeded`; dan alles `confirmed` → `completed`;
  anders `paused`.
- `v2/src/domain/migration/recoveryBackup.ts` (nieuw, puur): werk 1's
  "downloadbare lokale herstelback-up" hergebruikt LETTERLIJK PR 6.6's
  back-upformaat (`domain/backup/export.ts` `buildBackupPayload()` +
  `infrastructure/backup/downloadBackupFile.ts`, ongewijzigd) i.p.v. een
  tweede exportformaat — de herstelback-up is een gewone, met de bestaande
  back-upflow importeerbare v2-back-up. `buildMigrationRecoveryBackupData()`
  neemt uitsluitend `status: 'ok'`-secties mee (een `'corrupt'`-sectie
  bereikt dit nooit, `preview.ts` weigert de hele preview al eerder).
- `v2/src/domain/migration/preview.ts`: `resolveAction()` GEËXPORTEERD
  (was module-privaat in 7.4a) — `MigrationCoordinator` hergebruikt exact
  dezelfde create/alreadyPresentIdentical/conflict-formule voor de
  "vlak voor bevestiging"-recheck, geen tweede implementatie.
- `v2/src/application/migration/` (nieuw):
  - `MigrationRunRepository.ts`: lokale poort, sleutel = DOELcontext
    (spiegelt `GameSyncCheckpointRepository`/`PendingFinalizeRepository`'s
    synchrone boolean-faalcontract).
  - `CloudMigrationRunGateway.ts`: cloudpoort voor het manifest —
    `ensureRun()` (create-only kernvelden) + `patchRunCheckpoint()`
    (revisie-bewaakte checkpointpatch), spiegelt `GameCloudGateway`'s
    `ensureGame()`/`patchSnapshot()`-paar.
  - `MigrationWriteGateway.ts`: poort voor de daadwerkelijke itemwrite —
    `writeSettings()`/`writeRoster()`/`writeCompletedGame()`/
    `compensateCompletedGame()`. De implementatie componeert UITSLUITEND
    bestaande gateways (werk 3-eis: "Maak geen tweede afwijkend
    Firestorepad").
  - `projectMigratedGameForCloud.ts`: `projectMigratedGameParentSnapshot()`
    bouwt een synthetische `games/{sourceGameId}`-parentsnapshot uit een
    reeds-bevroren `CompletedGame` — nodig omdat firestore.rules'
    `completedGames`-createregel (punt 16/17) een `games/{sourceGameId}`-
    document met de aanroeper als writer eist, ook al bestaat de
    bijbehorende `ActiveGame` allang niet meer lokaal. `phase: 'tracking'`
    (een afgeronde wedstrijd heeft per definitie getrackt), score/
    segmentcount 1:1 van de bevroren `CompletedGame` (geen `deriveGameHistory()`-
    herberekening — er is geen actielog meer).
  - `MigrationCoordinator.ts`: de orkestrator zelf, mirrort
    `GameSyncCoordinator`'s opzet volledig.
    - `prepareRun(preview, createdBy)`: hervat een bestaande lokale run met
      hetzelfde `manifestHash`, of bouwt een verse run
      (`runId === manifestHash`) en `ensureRun()`t 'm op de cloud
      (best-effort — zie hieronder). Een bestaande, nog niet afgeronde run
      onder een ANDER manifest voor dezelfde doelcontext wordt nooit
      stilzwijgend vervangen (`blockedByExistingRunId`).
    - `runMigration(run, local, writer, currentContext)`: (1)
      capability-/contextrecheck (`isPreviewStillValid()`) — bij mismatch
      worden alle nog-herprobeerbare items `failed` met een zichtbare
      reden, nooit stil genegeerd; (2) een VERSE
      `CloudMigrationInventoryGateway.readTargetSnapshot()`-lezing +
      herclassificatie van elk nog niet bevestigd item via `resolveAction()`
      (werk 4's "vlak voor bevestiging"-recheck); (3) itemsgewijs schrijven
      met server-readback + checkpoint per stap (lokaal ÉN cloud, zie
      ontwerpbeslissing hieronder), stopt bij de eerste ECHTE fout
      (netwerk/Rules-afwijzing) — een gedetecteerd `conflict` blokkeert
      alleen dát item, niet de andere (onafhankelijke domeinobjecten).
      Veilig herhaaldelijk aan te roepen: `isMigrationRunItemRetryable()`
      slaat alle al-afgehandelde items over.
    - `abortAndCompensate(run, deletedBy)`: zet `rollbackRequested` (stopt
      onmiddellijk verdere writes), compenseert daarna elk al geschreven
      (`confirmed`) `completedGame`-item via
      `tombstoneCompletedGame()` (PR 7.2c-precedent, hergebruikt).
      Settings/roster blijven bewust ONGECOMPENSEERD — zie ontwerpbeslissing
      hieronder.
- `v2/src/infrastructure/migration/` (uitgebreid):
  - `LocalStorageMigrationRunRepository.ts`: fail-closed shape-check +
    contextvalidatie, spiegelt `LocalStorageGameSyncCheckpointRepository`.
  - `FirestoreCloudMigrationRunGateway.ts`: bewaart
    `organizations/{orgId}/teams/{teamId}/migrationRuns/{runId}`. Elke
    aanroep aan `withTimeout()` gebonden (zelfde patroon als
    `FirestoreGameCloudGateway.ts`).
  - `FirestoreMigrationWriteGateway.ts`: componeert
    `FirestoreSettingsRepository`/`FirestoreRosterRepository` (settings/
    roster, wacht op hun `settled`-Promise voor een echte server-
    bevestiging) en `GameCloudGateway.ensureGame()`/`claimWriter()`/
    `finalizeCompletedGame()`/`tombstoneCompletedGame()` (completedGame +
    compensatie) — GEEN nieuwe rauwe `setDoc()`/`updateDoc()` op een nieuw
    pad, exact werk 3's eis.
- **Firestore Rules** (`firebase/firestore.rules`, nieuw pad
  `migrationRuns/{runId}`, zusje van `games/{gameId}`): lezen voor elk
  teamlid (`canReadTeam`, zelfde precedent als settings/roster/games/
  completedGames); create/update alleen voor bulkmigratie-rollen
  (`canManageTeamData` — vandaag exact `canBulkMigrate()`'s allowlist,
  zie `domain/migration/capability.ts`'s docstring voor waarom dit toch
  aparte predikaten blijven); create-only kernvelden (manifestHash/source/
  target/callerRole/contextFingerprint/createdBy/createdAt blijven
  onveranderlijk bij een update); optimistische concurrency op `revision`
  (spiegelt `games`); `rollbackRequested` mag alleen `false → true`, nooit
  terug; geen hard delete (auditbewijs, spiegelt completedGames' tombstone-
  in-plaats-van-delete). Nieuwe suite `firebase/tests/rules/migration-
  runs.spec.ts` (8 tests: rolgebaseerde create/read, `createdBy`-eis,
  cross-org-isolatie, kernveld-immutabiliteit, revisie-concurrency,
  eenrichtings-`rollbackRequested`, geen delete) — volledige Rules-suite
  blijft groen (13 bestanden/227 tests, was 12/219).
- **Ontwerpbeslissing — lokaal-vs-cloud manifest-split** (§B: "Migratie
  gebruikt een cloud `migrationRun`-manifest..."): een `MigrationRun`
  bestaat in TWEE vormen. De LOKALE kopie
  (`MigrationRunRepository`/`LocalStorageMigrationRunRepository`) is de
  offline-hervatbare bron — spiegelt exact `GameSyncCheckpoint`/
  `PendingFinalizeRepository`'s rol: reload/crash zonder netwerk mag nooit
  de voortgang kwijtraken. De CLOUD-kopie
  (`CloudMigrationRunGateway`/`FirestoreCloudMigrationRunGateway`) is het
  audit-/cross-apparaatbewijs — "een volledig bevestigde run" (§B)
  impliceert een serverbron, niet uitsluitend een lokale claim.
  `MigrationCoordinator.persist()` schrijft na elke itemstap naar BEIDE
  (eerst lokaal — de bron van waarheid voor hervatten — dan best-effort
  naar de cloud). Cloud-checkpointpersistentie is BEWUST best-effort: de
  daadwerkelijke voortgang zit in settings/roster/completedGames zelf
  (via `MigrationWriteGateway`), niet in het manifest — een tijdelijk
  falende cloud-patch blokkeert de migratie zelf niet, een latere
  `persist()`-aanroep probeert opnieuw (eerst `ensureRun()` als er nog
  nooit een geslaagde cloud-create was, herkenbaar aan `cloudRevision < 0`).
- **Ontwerpbeslissing — settings/roster hebben géén Firestore-optimistische-
  concurrency** (anders dan games/completedGames): firestore.rules'
  bestaande `settings`/`roster`-paden (PR 5.3) kennen geen revisie-/
  create-only-eis, dus een `setDoc()` overschrijft onvoorwaardelijk. Om
  werk 4's "nooit een overwrite" bij een conflict tóch waar te maken, doet
  `runMigration()` VLAK VOOR elke schrijfronde een verse
  `readTargetSnapshot()` en herclassificeert elk nog niet bevestigd item —
  pas een verse `create`-classificatie leidt tot een write. Dit sluit het
  racevenster niet volledig (er blijft een klein venster tussen recheck en
  de write open, zolang firestore.rules zelf geen concurrency-veld voor
  settings/roster afdwingt), maar dat is een BESTAAND gat uit PR 5.3, geen
  nieuw gat van 7.4b — bewust niet "gefixed" met een Rules-wijziging buiten
  scope (een cross-cutting wijziging aan settings/roster's schrijfcontract
  raakt elke bestaande aanroeper, niet alleen migratie). `completedGames`
  zelf zijn wél volledig race-veilig: firestore.rules' create-only-regel
  (punt 16/17, `getAfter()`-binding) beschermt daar al onvoorwaardelijk
  tegen een overwrite, ongeacht deze recheck.
- **Ontwerpbeslissing — rollback/compensatiescope** (§B: "reeds geschreven
  migratie-items worden veilig gecompenseerd of getombstoned"): alleen
  `completedGame`-items worden daadwerkelijk gecompenseerd (tombstone,
  PR 7.2c-precedent hergebruikt via `MigrationWriteGateway
  .compensateCompletedGame()`). Settings/roster blijven bewust
  ONGECOMPENSEERD — ze zijn SINGLETON-documenten (`settings/current`/
  `roster/current`), geen append-only geschiedenis zoals `completedGames`.
  "Compenseren" zou moeten betekenen: terug naar de staat vóór deze
  migratie — maar die is voor een bestaande-gebruikersmigratie (§A: een
  team dat lokaal-only was) typisch "nog niet aanwezig", en er bestaat
  sowieso geen Rules-toegestaan delete-pad voor settings/roster. Reversie
  naar "weer afwezig" zou bovendien, als een ander teamlid inmiddels op de
  net-aangemaakte settings/roster verder werkt, een ECHTE wijziging ongedaan
  maken — riskanter dan laten staan. §B eist "veilig gecompenseerd OF
  getombstoned", niet "elk itemtype letterlijk ongedaan maken" — voor deze
  twee itemtypes is "stoppen, laten staan, zichtbaar documenteren in het
  manifest" de veiligere lezing. Een rollback-run wordt daarom NOOIT
  `completed` gerapporteerd (`deriveSettledMigrationRunStatus()`, zie
  boven) — de opgeslagen status blijft `paused` (of `compensationFailed`
  als de completedGame-tombstone zelf faalt), nooit een vals "alles
  teruggedraaid".
- **Werk item 5 — "lokale bron nooit automatisch verwijderd"**: geen enkel
  bestand in 7.4b importeert een verwijder-/clear-methode van
  settings/roster/activeGame/completedGame-lokale-repositories. De enige
  `clear()` in deze PR (`MigrationRunRepository.clear()`) ruimt UITSLUITEND
  het lokale RUN-checkpoint op, wordt door `MigrationCoordinator` zelf
  NERGENS aangeroepen (expliciet gereserveerd voor een toekomstige 7.4c-
  "nieuwe migratie starten"-actie), en raakt nooit de gemigreerde
  brondata zelf. Bewezen via `migrationCoordinator.spec.ts`'s
  "lokale bron blijft onaangeraakt"-test (het meegegeven
  `MigrationLocalSource`-object wordt na een volledige `runMigration()`
  byte-voor-byte ongewijzigd teruggevonden).
- **Bewust NIET gebouwd (buiten scope van 7.4b)**: geen App.tsx-wiring/UI
  (7.4c-scope, plan §C 7.4c werk 1), geen `activeGame`-migratiepad (§D:
  "Geen trackinggame via bulkpad om de writerclaim heen" —
  `createMigrationRun()` neemt `activeGame`-items nooit mee, `writeItem()`
  bewaakt dit defensief nogmaals), geen volledige race-sluiting voor
  settings/roster-conflicten (zie ontwerpbeslissing hierboven — een
  bestaand PR-5.3-gat, geen nieuw 7.4b-gat).
- Tests: `v2/tests/unit/migrationRun.spec.ts` (11 tests, domeinlaag:
  run-opbouw uit preview, statusderivatie inclusief rollback-/
  compensatiedominantie, item-predikaten) en
  `v2/tests/unit/migrationCoordinator.spec.ts` (9 tests, application-laag
  met fakes voor alle vier poorten: happy path, hervatten na een mislukte
  stap zonder al-bevestigde items opnieuw te schrijven, idempotente
  herhaalde aanroep op een voltooide run, vlak-voor-bevestiging-conflict
  zonder write, reeds-bekend-conflict-vanaf-het-begin, rollback +
  compensatie, compensationFailed bij een mislukte tombstone-poging,
  contextwissel blokkeert zichtbaar, lokale bron blijft onaangeraakt).
- **Testresultaten**: v2 `vitest run` 84 bestanden/825 tests groen (20
  nieuw); v2 `tsc -b` + `eslint .` + `prettier -c .` schoon; firebase
  `npm run verify` (type-check + unit-tests + volledige Rules-emulatorsuite,
  13 bestanden/227 tests, 8 nieuw) groen. Playwright e2e NIET lokaal
  uitgevoerd: `npx playwright install chromium` faalt nog steeds met `403`
  op `cdn.playwright.dev` (geblokkeerde CDN in deze sandbox) — zelfde
  bekende beperking als bij elke eerdere PR in deze reeks. Niet gemist:
  7.4b heeft geen UI (dat is expliciet 7.4c-scope), dus er is niets om
  end-to-end te bevestigen vóór die PR.

### 7.4c — migratie-UI en volledige e2e

1. Voeg een NL/EN-flow toe: inventariseren → preview → herstelback-up → sterke
   bevestiging → voortgang → readback/resultaat → retry/export.
2. Toon per onderdeel lokaal/cloud, aantallen, conflictstatus en of een actieve
   wedstrijd via 7.3 moet worden overgenomen.
3. Houd knoppen toegankelijk op 320 px, toetsenbord en screenreader; voorkom
   dubbel bevestigen tijdens een lopende run.
4. E2e-matrix: alle rollen, lokale modus zonder netwerkcall, contextwissel,
   crash/reload per stap, serverreject, bestaande gelijke/afwijkende payload,
   dubbele retry en echte inhoud van herstelback-up.
5. Pilot op staging met fictieve data; leg writes/reads en open risico's vast.

Acceptatie: gebruiker kan de migratie vooraf begrijpen, veilig hervatten en
lokale data blijven gebruiken; clouddata is na readback op apparaat B gelijk.

## D. Stopregels en faseoverdracht

- Geen automatische migratie bij login of appstart.
- Geen stil verwijderen van lokale keys, games of back-ups.
- Geen trackinggame via bulkpad om de writerclaim heen.
- Geen productie-cutover; na 7.4 volgt eerst fase-7-acceptatie en fase 8
  hardening/security/privacy/kosten.

# Voorbereidingsplan PR 7.4 — bestaande gebruiker naar cloud

Status: 7.4a (inventarisatie, mapping en preview) geïmplementeerd — zie
"Geïmplementeerd" onder §C 7.4a. 7.4b (hervatbare migratiecoordinator) en
7.4c (migratie-UI en volledige e2e) nog niet gestart.

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

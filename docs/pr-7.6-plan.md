# Voorbereidingsplan PR 7.6 — cloudkoppeling van de correctie

Status: **goedgekeurd door de eigenaar op 2026-10-31 (alle aanbevelingen uit
§H zijn overgenomen)**. Er is nog geen code gewijzigd; implementatie volgt per
sub-PR op een eigen branch. Vervolg op PR 7.5 (`docs/pr-7.5-plan.md`;
7.5a/b/c zitten in PR #132). Dit plan raakt geen statistiekberekening, geen
CSV-contract en geen bestaande `localStorage`-key.

## A. Doel en grenzen

In cloudmodus (`repositories.gameSync` aanwezig) kan een coach, admin of owner
een segment van een afgeronde wedstrijd corrigeren, ziet per wedstrijd wat de
synchronisatie doet, kan een mislukte upload herstellen en kan bij een
conflict de lokale versie bewust verwerpen. De correctie werkt zonder netwerk;
upload volgt zodra het kan.

Niet in scope: lineup corrigeren, segmenten toevoegen of verwijderen,
automatische samenvoeging bij conflicten, correcties meenemen in de
cloudmigratie (blijft geblokkeerd, zie `docs/pr-7.5-plan.md` §I), bewaarbeleid
van het logboek (PR 8.3), publiceren van Rules of deployen.

## B. Huidige werking (bevestigd in de code)

- `App.tsx` geeft `onCorrectGame` alleen door als er **geen** `repositories.gameSync`
  is (`repositories.gameSync ? undefined : handleCorrectCompletedGame`).
  `correctedBy` wordt nergens doorgegeven, dus het logitem heeft `by: null`.
- `handleCorrectCompletedGame` roept `completedGameRepo.update()` aan en leest
  daarna `list()`. `CompositeCompletedGameRepository.update()` schrijft eerst
  lokaal, neemt een cloud-only wedstrijd eerst lokaal op en uploadt daarna één
  correctie per server-snapshot (alleen correcties die op dit apparaat via
  `update()` of een bewuste `retryCorrectionUploads()` zijn goedgekeurd).
- De composite biedt `correctionSyncStatus(id)` (`null` = nooit gecorrigeerd;
  anders `lokaal-beschikbaar`, `wacht-op-synchronisatie`, `gesynchroniseerd`,
  `actie-nodig` of `conflict`) en `retryCorrectionUploads()`. Beide zijn
  optioneel op de poort en nergens in de UI aangesloten.
- `HistoryPanel` toont per wedstrijd één `SyncStatusIndicator` op basis van
  `syncStatuses` (de afrondstatus, `finalizeStatuses` in `App`). Het type
  `SyncStatus` kent geen `conflict`.
- Verwijderen in cloudmodus gaat via `tombstone()` en verbergt de wedstrijd
  voor het hele team. Er is geen actie om alleen de lokale kopie te verwerpen.
- Een afronding die nog niet server-bevestigd is, uploadt de snapshot uit de
  outbox (volgens de Opus-review van PR 7.5). Aanname, nog te verifiëren in
  7.6a: die snapshot bevat een correctie die er daarna bij komt niet.
- Rules: de updatetak voor correcties eist `canManageTeamData`; `by` mag `null`
  zijn of de eigen uid, niet die van een ander.

## C. Risico's

| Gebied | Risico | Beheersing |
|---|---|---|
| Datalek tussen teams | Cloudquery of status toont andere org/team | Geen nieuwe queries; bestaande org/team-scope blijft; test met twee contexten |
| Dataverlies | "Lokale versie verwerpen" wist een correctie die nog niet geüpload is | Sterke bevestiging met uitleg; alleen de lokale kopie, nooit een tombstone; cloudversie komt terug via de samenvoeging |
| Vals succes | Status zegt "gesynchroniseerd" vóór serverbevestiging | Bestaande `hasPendingWrites`-guard blijft; e2e met offline/online |
| Offline | Corrigeren mag niet op netwerk wachten | Lokaal eerst (bestaand); geen blokkade op connectiviteit |
| Afronding nog niet bevestigd | Correctie vóór cloud-snapshot gebruikt de oude outbox-snapshot | Corrigeren uitzetten tot de afronding server-bevestigd is (§D.5) |
| Andere gebruiker op hetzelfde apparaat | Correctie met `by = A` wordt door B geüpload en door Rules geweigerd | Status `actie-nodig` met uitleg en de keuze "lokale versie verwerpen" |
| Rules niet gepubliceerd | UI draait vóór de Rules | Upload faalt veilig met `permission-denied` → `actie-nodig`; lokale data blijft; uitrolvolgorde blijft Rules eerst |
| i18n | Nieuwe teksten | NL én EN, bestaande pariteitstests |
| CSV/statistiek | Geen wijziging | Geen wijziging aan rekenfuncties; regressietest blijft |

## D. Voorgestelde ontwerpkeuzes

### D.1 Correctie aanzetten in cloudmodus

`onCorrectGame` wordt in cloudmodus doorgegeven wanneer er een
`gameWriterContext` is. `correctedBy = gameWriterContext.authorUid`; in lokale
modus blijft `by = null`. Rolgating blijft `canWrite` (owner/admin/coach); er
komt geen nieuwe rollogica.

### D.2 Eén status per wedstrijd

`CorrectionSyncStatus` (= `SyncStatus | 'conflict'`) wordt opgehaald via
`completedGameRepo.correctionSyncStatus?.(id)` voor gecorrigeerde wedstrijden
en ververst bij elke notificatie van de composite (die roept `notify()` al aan
bij elke statuswijziging). `HistoryPanel` toont per wedstrijd één indicator:
de correctiestatus zolang die niet `gesynchroniseerd` of `null` is, anders de
afrondstatus. `SyncStatusIndicator` krijgt een zesde toestand `conflict` met
eigen tekst en stijl; het domeintype `SyncStatus` (ADR-002, vier toestanden)
blijft ongewijzigd.

### D.3 Herstelacties

- `actie-nodig` of `lokaal-beschikbaar` met een lokaal voorlopende correctie:
  knop **"Opnieuw proberen"** → `retryCorrectionUploads()` (bewuste actie).
- `conflict` (uiteengelopen logs of revisie): geen automatische oplossing.
  Melding "Deze wedstrijd is ondertussen op een ander apparaat gewijzigd". Twee
  keuzes: **annuleren** (niets doen, de wedstrijd blijft zoals hij is) of
  **"Mijn lokale versie verwerpen"**.
- Nieuw op de poort en de composite: `discardLocalCorrection?(id): boolean`.
  Verwijdert alleen de lokale kopie (`local.remove(id)`), wist de status en
  notificeert. De cloudversie verschijnt daarna via de bestaande samenvoeging
  weer als cloud-only wedstrijd. Het is nooit een tombstone en raakt de cloud
  niet. De gebruiker kan daarna opnieuw corrigeren.
- Bevestiging vóór verwerpen met expliciete tekst over wat verloren gaat
  (de lokale correctie die niet geüpload is).

### D.4 Wat de gebruiker ziet

- Na bevestigen: badge "Gecorrigeerd", status "Wacht op synchronisatie", en na
  serverbevestiging "Gesynchroniseerd". Offline blijft het "Wacht op
  synchronisatie" met de hint dat de wijziging veilig lokaal staat.
- Het logboek toont per correctie tijdstip, vóór/ná en, in cloudmodus, wie
  corrigeerde (alleen uid-gebaseerd; er worden geen e-mailadressen of namen
  getoond, zie §F).
- Nieuwe tekstsleutels (NL én EN): `syncStatusConflict`,
  `correctionConflictMessage`, `correctionRetry`, `correctionDiscardLocal`,
  `correctionDiscardConfirm`, `correctionWaitingForFinalize`,
  `correctionPendingOffline`, `correctionActionNeededHint`.

### D.5 Afronding nog niet server-bevestigd

Zolang `finalizeStatuses[id]` niet `gesynchroniseerd` is (en de wedstrijd
geen cloud-tegenhanger heeft), is corrigeren uitgeschakeld met de uitleg
"Wacht tot de wedstrijd is gesynchroniseerd". Reden: de afronding uploadt de
outbox-snapshot, mogelijk zonder de correctie; combineren vraagt extra
herstelpaden zonder dat het een echt gebruiksscenario oplost. Een cloud-only
wedstrijd (op een ander apparaat afgerond) mag wél gecorrigeerd worden; dat pad
is al gebouwd en getest in 7.5c.

### D.6 Rules en `by`

Geen Rules-wijziging nodig. `by` blijft `null` of de eigen uid. Strenger
maken (alleen de eigen uid) zou lokaal gemaakte correcties van vóór het
inloggen onuploadbaar maken; het audit-verlies van een `null` is bewust
geaccepteerd. Dit staat als besluit in §H.

## E. Uitvoeringsplan (kleine sub-PR's, eigen branch en draft-PR)

### 7.6a — UI-koppeling en status (geen Rules)

1. `App.tsx`: `onCorrectGame` ook in cloudmodus, `correctedBy`, uitzetten tot
   de afronding bevestigd is (§D.5), statussen per wedstrijd uit
   `correctionSyncStatus` met herrenderen bij notificaties.
2. `HistoryPanel` + `SyncStatusIndicator`: één indicator per wedstrijd, de
   toestand `conflict`, hints en de knop "Opnieuw proberen".
3. i18n NL + EN voor alle nieuwe teksten; pariteitstests.
4. Tests: component- en App-tests met een nepcomposite voor elke status
   (wacht, gesynchroniseerd, actie nodig, conflict, lokaal beschikbaar),
   rolgating, uitgeschakeld tijdens afronding, lokale modus ongewijzigd.

### 7.6b — conflict en "lokale versie verwerpen"

1. `discardLocalCorrection?()` op de poort en de composite (alleen lokaal).
2. UI: conflictmelding, bevestiging, uitvoeren; de cloudversie verschijnt weer.
3. Tests: verwerpen laat de cloud en alle andere wedstrijden ongemoeid, is geen
   tombstone, de wedstrijd keert terug als cloud-only, daarna is corrigeren
   weer mogelijk; verwerpen zonder cloudkopie wordt geweigerd (anders raakt de
   gebruiker de enige kopie kwijt).

### 7.6c — tweede-apparaat-e2e (Playwright-auth, Emulator Suite)

Fictieve data, twee browsercontexten met dezelfde organisatie en hetzelfde team:
1. A corrigeert, B ziet de gecorrigeerde wedstrijd en badge binnen de
   verwachte tijd; CSV en Stats van B tonen de nieuwe waarden.
2. A corrigeert offline, sluit af, komt online: correctie wordt geüpload en
   staat één keer in het log (geen dubbele logregel).
3. A en B corrigeren dezelfde wedstrijd tegelijk: de tweede krijgt `conflict`;
   "lokale versie verwerpen" levert de versie van de eerste terug.
4. Scorer/viewer zien geen aantikbare segmenten en kunnen via de Rules niet
   schrijven (bestaande negatieve emulatortests blijven groen).
5. Cross-org: een gebruiker van een andere organisatie ziet niets.

## F. Privacy en veiligheid

Geen nieuwe externe gegevensoverdracht, geen analytics, geen nieuwe
Firestore-queries buiten de bestaande team-scoped lijst. In het logboek komt
alleen de uid; er worden geen e-mailadressen of spelersnamen getoond of
gelogd. Geen secrets in code, tests of logs.

## G. Acceptatiecriteria

- Een coach corrigeert in cloudmodus en ziet de status doorlopen tot
  "Gesynchroniseerd"; apparaat B toont dezelfde gecorrigeerde wedstrijd.
- Offline corrigeren werkt en wordt na reconnect precies één keer geüpload.
- Een conflict overschrijft nooit stil; de gebruiker kan bewust kiezen en
  verliest niets in de cloud.
- Scorer en viewer kunnen niet corrigeren (UI én Rules).
- Statistiek en CSV zijn ongewijzigd; alle nieuwe tekst bestaat in NL en EN.
- Alle tests groen, inclusief Emulator Suite en Playwright (nieuw + bestaand).

## H. Besluiten (genomen door de eigenaar, 2026-10-31)

Alle aanbevelingen zijn goedgekeurd: (1) corrigeren uitzetten tot de afronding
gesynchroniseerd is; (2) `by` blijft `null` of de eigen uid, geen Rules-wijziging;
(3) lokale versie verwerpen is alleen lokaal, met bevestiging, en niet zonder
cloudkopie; (4) drie sub-PR's (7.6a, 7.6b, 7.6c); (5) de UI mag meeliften met
de volgende release, terwijl Rules eerst publiceren de aanbevolen eerste stap
blijft.

Oorspronkelijke vraagstelling:

1. **Afronding nog niet bevestigd:** corrigeren uitzetten tot de wedstrijd
   gesynchroniseerd is (aanbevolen), of de combinatie ondersteunen?
2. **`by` in de cloud:** `null` blijven toestaan (aanbevolen) of strikt de eigen
   uid eisen (vraagt een Rules-wijziging en maakt oudere lokale correcties
   onuploadbaar)?
3. **Verwerpen van de lokale versie:** akkoord met alleen een lokale
   verwijdering plus sterke bevestiging (aanbevolen)?
4. **Splitsing:** 7.6a, b en c als aparte PR's (aanbevolen) of één PR?
5. **Uitrol:** akkoord dat de UI mag meeliften met de volgende release omdat
   uploaden zonder gepubliceerde Rules veilig faalt (`actie-nodig`, lokale data
   blijft), terwijl Rules publiceren de aanbevolen eerste stap blijft?

## H2. Status 7.6a (geïmplementeerd)

- **Aanname §B bevestigd.** De outbox (`pendingFinalizeRepo`) bewaart het
  `(ActiveGame, CompletedGame)`-paar van het moment van afronden; `update()` op
  de afgeronde-wedstrijdenrepository raakt de outbox nooit. Een correctie
  voordat de afronding server-bevestigd is zit dus niet in de snapshot die
  `finalize()` uploadt. Vastgelegd in
  `tests/unit/pendingFinalizeSnapshotIndependence.spec.ts`.
- **Blokkade (§D.5) in de code.** `App` blokkeert corrigeren voor een wedstrijd
  zolang `finalizeStatuses[id]` bestaat en niet `gesynchroniseerd` is. Het
  bestaande statuseffect zet een wedstrijd zonder lokale kopie (op een ander
  apparaat afgerond) altijd op `gesynchroniseerd`; die blijft dus corrigeerbaar.
  Een lokale wedstrijd zonder bevestigd checkpoint (`lokaal-beschikbaar`) is ook
  geblokkeerd: ze heeft geen cloudkopie om tegen te corrigeren.
- **Logboek.** Het logboek toont `by` nergens (ook niet in lokale modus), dus
  er is geen nieuwe uid-weergave toegevoegd en er worden geen e-mailadressen of
  namen getoond. `by` wordt alleen opgeslagen (uid in cloudmodus, `null` lokaal).
- **Nog niet in 7.6a:** `discardLocalCorrection` en de verwerp-knop (7.6b), de
  Playwright-auth-e2e voor twee apparaten (7.6c).

## I. Open risico's

- Echte-apparaat- en staging-verificatie blijft nodig; de sandbox dekt alleen
  de Emulator Suite.
- Een tweede gebruiker op hetzelfde apparaat kan een correctie van de eerste
  niet uploaden (Rules weigeren een vreemde `by`); dat eindigt in `actie-nodig`
  met de keuze te verwerpen. Een betere oplossing vraagt een Rules-besluit.
- `corrections[].id`-uniciteit blijft in Rules niet afdwingbaar.

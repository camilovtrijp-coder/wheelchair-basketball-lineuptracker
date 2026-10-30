# Voorbereidingsplan PR 7.5 — correctie van een afgeronde wedstrijd

Status: **goedgekeurd door de eigenaar op 2026-10-30 (alle aanbevelingen uit §H
zijn overgenomen, zie §H)**. Implementatie loopt per sub-PR op een eigen
branch. Dit plan wijkt bewust af van "afgeronde wedstrijd standaard
onveranderlijk" (`docs/IMPLEMENTATION_PLAN.md` §11 PR 6.3, §12 PR 7.1/7.2) en
vraagt daarom een expliciet besluit (zie §H) voordat 7.5a start.

## A. Aanleiding en doel

Een coach registreerde na afronden een verkeerde segmenttijd en kan dat nu niet
herstellen: Historie toont alleen detail, export en verwijderen. Verwijderen en
opnieuw invoeren verliest de oorspronkelijke gegevens.

Doel: een bevoegd teamlid kan in Historie **één segment van een afgeronde
wedstrijd corrigeren**:

1. tijd (kwart, begin- en eindtijd; duur wordt herberekend) — de aanleiding;
2. score voor/tegen van dat segment;
3. turnovers van dat segment.

Niet in scope: opstelling (lineup) van een segment wijzigen, segmenten
toevoegen of verwijderen, speler-/teamgegevens of tegenstander/datum
wijzigen, tweede-apparaat-conflictoplossing voor gelijktijdige correcties
buiten een duidelijke weigering (zie §D.4).

## B. Huidige werking (bevestigd in de code)

- `CompletedGame` (`v2/src/domain/game/types.ts`) is een bevroren snapshot:
  `segments`, `scoreFor`, `scoreAgainst` komen uit `deriveGameHistory()` bij
  `finishGame()` (`domain/game/finish.ts`).
- `CompletedGameRepository` kent alleen `add`, `remove`, `replaceAll` (en
  `tombstone` in de cloudvariant) — geen `update`. `HistoryPanel` heeft geen
  bewerkpad.
- Cloud: `completedGames/{id}` is create-only; `allow update` staat alleen een
  tombstone-patch toe (`deletedAt`/`deletedBy`/`revision`, +1) voor
  owner/admin/coach (`firebase/firestore.rules`, punt 18).
- Een **lopende** wedstrijd kan wél segmenten bewerken via de actie
  `segment-edited` (`tracking.ts`, `LiveTrackingPanel.openEditSegment`);
  `recalcRunningScore()` houdt score/turnovers consistent.
- Stats, Trends en CSV lezen rechtstreeks `CompletedGame.segments`
  (`computeLineupStats`, `computePlayerTrends`, `turnoverSummary`,
  `csv.ts`). Ze hebben geen eigen cache: een gewijzigd segment werkt dus
  automatisch door, mits de bron klopt.
- Samenvoegen lokaal ∪ cloud (`CompositeCompletedGameRepository`) laat bij een
  ID-botsing **de lokale versie winnen**. Dat is precies het risico voor een
  correctie (zie §D.3).

## C. Risico's

| Gebied | Risico | Beheersing |
|---|---|---|
| localStorage | Bestaande keys/data mogen niet breken; een nieuw veld op `CompletedGame` moet optioneel zijn voor oude data | Alleen optionele velden; geen key-wijziging; oude data blijft geldig zonder migratie |
| Statistieken | Gewijzigde segmentwaarden veranderen afgeleide stats | Geen wijziging aan rekenfuncties; vaste, handmatig narekenbare fixture met vóór/ná-waarden |
| CSV | Nederlands CSV-contract moet byte-exact blijven | Geen kolomwijziging; test dat CSV van een ongewijzigde wedstrijd identiek blijft en een gecorrigeerde de nieuwe segmentwaarden bevat |
| Back-up/import | `validateCompletedGame*` moet nieuwe optionele velden accepteren én een oude back-up blijven laden | Validator uitbreiden; round-trip- en oude-back-uptest |
| Offline | Correctie moet zonder netwerk kunnen; cloud is bijzaak | Lokaal eerst, upload hervatbaar (zelfde patroon als finalize) |
| Sync | Lokaal-wint-merge kan een correctie van apparaat A ongedaan maken op apparaat B | Revisie-gestuurde merge (§D.3) |
| Rules | Een update-pad op `completedGames` mag niet gebruikt worden om inhoud willekeurig te herschrijven of een rol te verruimen | Strikte allowlist + invarianten + negatieve emulatortests (§F) |
| i18n | Nieuwe zichtbare tekst moet NL én EN hebben | Typed `StringKey`; bestaande tests dwingen pariteit af |
| Audit | Origineel gaat verloren bij overschrijven | Append-only correctiegeschiedenis (§D.2) |

## D. Voorgestelde ontwerpkeuzes

### D.1 Wat wordt gecorrigeerd

Eén segment per correctie, geïdentificeerd op `Segment.id` (niet op
arrayindex, net als `segment-edited`). Bewerkbare velden: `quarter`,
`beginSec`, `endSec`, `pf`, `pa`, `tov`. `durSec` wordt herberekend en
`lineup`, `classSum`, `allowed`, `over` blijven ongewijzigd (lineup valt buiten
scope, dus classificatiesom blijft correct).

Validatie hergebruikt de live-regels: duur > 0 (met `clockDown` van de
wedstrijd — **let op:** `clockDown` staat niet op `CompletedGame`; zie open
vraag §H.4), `tov` ≥ 0 geheel, `pf`/`pa` ≥ 0 en binnen `MAX_SCORE`, kwart
binnen `quarterCount`.

### D.2 Opslag: bewerken in-place + append-only correctielog (aanbevolen)

`CompletedGame` krijgt twee optionele velden:

- `revision` bestaat al (nu alleen voor tombstones); een correctie verhoogt
  deze met exact 1.
- `corrections?: CompletedGameCorrection[]` — begrensd (bijv. max. 50),
  elk item: `id` (UUID), `segmentId`, `at`, `by` (uid/`null` lokaal),
  `before` en `after` (alleen de zes bewerkbare velden). Hiermee blijft het
  origineel altijd reconstrueerbaar en is de wijziging controleerbaar in de UI
  ("gecorrigeerd op … door …").

Na een correctie zijn `segments[i]`, `scoreFor`, `scoreAgainst` en
`revision` bijgewerkt. Score blijft consistent met `recalcRunningScore`:
`scoreFor' = scoreFor + (nieuwe pf − oude pf)` (idem tegen), zodat punten die
bij afronden buiten een segment vielen onaangetast blijven.

**Bewuste afwijking lokaal vs. cloud (review 7.5a):** de lokale `update()`
accepteert een revisie "strikt hoger dan opgeslagen" (niet exact +1). Dat is
nodig om in 7.5c een cloudkopie toe te passen die meerdere correcties voorloopt;
de cloud-Rules eisen wél exact +1. Lokaal moet het log altijd een
voorvoegsel-uitbreiding zijn; de nieuwe items worden via `correctSegment()`
afgespeeld en segmenten, `scoreFor` en `scoreAgainst` moeten daarmee exact
overeenkomen. Het cloud-logitem draagt in 7.5c een extra cloud-only veld
`segmentIndex`; de lokale validatie negeert dat veld.

Alternatief **append-only subcollectie** `completedGames/{id}/corrections/*`
met afleiding bij het lezen: zuiverder, maar iedere lijst-/stats-/CSV-read moet
dan een extra query doen en de offline-cachegarantie van 7.2b wordt zwaarder.
Niet aanbevolen voor deze omvang; wel een optie als besluit D1 anders uitvalt.

### D.3 Sync en conflicten

- Lokaal: nieuwe functie `correctSegment(game, segmentId, patch, by)` in
  `domain/game/` (puur) en een `update(game)`-methode op
  `CompletedGameRepository` die uitsluitend de correctie-velden vervangt
  (geen algemene edit-API; `CompletedGame.id` en `sourceGameId` blijven
  onveranderlijk). Een lokaal pad zonder cloudcontext werkt volledig offline.
- Cloud: een tweede, expliciet smalle `allow update`-tak op `completedGames`
  (naast de tombstone-tak). Voorwaarden: `canManageTeamData` (owner/admin/
  coach — scorer en viewer niet), niet getombstoned, diff beperkt tot
  `segments`, `scoreFor`, `scoreAgainst`, `corrections`, `revision`,
  `correctedAt`; `revision` exact +1; `players`, `date`, `sourceGameId`,
  `organizationId`, `teamId` onaangeroerd; `corrections` groeit met exact één
  item dat naar de gewijzigde `segmentId` verwijst; `correctedAt ==
  request.time`. Eén `updateDoc` is atomisch; geen batch nodig.
- Merge: `CompositeCompletedGameRepository.mergeGames()` kiest bij een
  ID-botsing nu altijd lokaal. Dat wordt: **hogere `revision` wint**; bij
  gelijke revisie lokaal (huidig gedrag, inhoudelijk identiek). Een
  tombstone blijft altijd winnen (ongewijzigd).
- Idempotentie: dezelfde correctie tweemaal uploaden (retry) levert geen
  dubbele logregel; bepaald via `corrections[].id`. Upload hervat na crash
  zoals de finalize-flow (pending-status, geen vals succes vóór
  serverreadback).

### D.4 Gelijktijdige correcties

Twee apparaten corrigeren dezelfde wedstrijd tegelijk: de tweede `updateDoc`
faalt op de revisiecontrole. De UI toont "wedstrijd is ondertussen gewijzigd —
ververs en probeer opnieuw"; geen automatische samenvoeging. Dit is bewust
simpel; correcties zijn zeldzaam en door een handvol coaches.

### D.5 UX

- `HistoryPanel`-detail: segmentrijen worden aantikbaar (alleen voor rollen
  die dit mogen, `canWrite`-achtig; viewer ziet niets veranderen).
- Bewerkscherm hergebruikt de bestaande live-bewerkmodal-componenten
  (focus-trap, kwart/tijd/score/turnover-velden) zonder lineup-selectie.
- Vóór opslaan een bevestiging met vóór/ná-samenvatting (tijd, score,
  turnovers, wijziging in eindscore).
- Na opslaan: badge "Gecorrigeerd" op de wedstrijd, en een uitklapbare
  lijst "Correcties" met tijdstip en vóór/ná.
- Nieuwe tekstsleutels NL + EN (o.a. `correctSegmentTitle`,
  `correctionSaved`, `correctionConflict`, `correctedBadge`,
  `correctionsHistory`, `confirmCorrectSegment`).
- Sync-statusindicator hergebruiken: `lokaal` → `wacht op synchronisatie`
  → `gesynchroniseerd` / `actie nodig`.

## E. Uitvoeringsplan (kleine, afzonderlijke sub-PR's)

### 7.5a — domein en lokale opslag (geen cloud, geen UI)

1. `CompletedGameCorrection`-type en optioneel `corrections` op `CompletedGame`.
2. Pure `correctSegment()` + validatie + scoreafleiding (`domain/game/`).
3. `CompletedGameRepository.update()` + `LocalStorageCompletedGameRepository`.
4. Back-upvalidatie en `strings`-typing zo nodig; geen key- of
   schemaversie-wijziging (optioneel veld).
5. Tests: vaste fixture met handmatig nagerekende getallen (§G), ongewijzigde
   CSV, oude back-up laadt, ongeldige invoer (duur ≤ 0, tov < 0, onbekend
   segment, ander team) wordt geweigerd en laat opslag ongemoeid.

Acceptatie: stats/trends/CSV van een niet-gecorrigeerde wedstrijd
byte-identiek; correctie wijzigt exact de verwachte afgeleide waarden.

### 7.5b — UI in Historie (lokaal werkend, NL + EN)

Bewerkscherm, bevestiging, badge, correctielijst, foutmeldingen,
toegankelijkheid (focus-trap, labels), mobiele weergave. Tests: component- en
e2e-flow "correctie na afronden" in beide talen, offline.

### 7.5c — cloud: Rules, gateway, merge

Rules-tak (§D.3), `GameCloudGateway.correctCompletedGame()` (revisiecontrole,
idempotent), revisiegestuurde merge, hervatbare upload/status. Emulatortests
(§F). Tweede-apparaat-e2e met fictieve data.

Elke sub-PR eigen branch, eigen review; 7.5c start pas na akkoord op 7.5a/b.

## F. Testplan Firestore Rules (emulator, 7.5c)

Positief: owner/admin/coach corrigeert segmenttijd/score/turnovers met
revisie +1 en een passend logitem.
Negatief (alle moeten falen): scorer en viewer; gebruiker uit andere
organisatie/team; revisie niet +1; getombstoned document; wijziging van
`players`/`date`/`sourceGameId`/`organizationId`/`teamId`; extra of
ontbrekend veld; `corrections` verkleinen of meer dan één item toevoegen;
`correctedAt` ≠ `request.time`; lid dat zichzelf een rol geeft (bestaande
`self-promotion`-suite blijft groen); bestaande tombstone-tests blijven groen.
Queries blijven expliciet org-/teamgescoped.

## G. Vaste testfixture (handmatig narekenbaar)

Fictieve wedstrijd, 2 segmenten:

- S1: Q1 begin 10:00 → eind 7:00 (klok omlaag), duur 180 s, pf 6, pa 4, tov 2
- S2: Q1 begin 7:00 → eind 3:00, duur 240 s, pf 8, pa 6, tov 1
- Totaal: 14 – 10, 3 turnovers, 420 s.

Correctie S1: eind 7:00 → 5:00 (duur 300 s), pf 6 → 9, tov 2 → 3.
Verwacht: S1 duur 300 s; eindscore 17 – 10 (+3 voor); turnovers totaal 4
(was 3); totale speeltijd 540 s (was 420 s); turnovers per 10 min =
4 / 9 min × 10 = 4,4 (was 3 / 7 min × 10 = 4,3). De
berekeningen zelf (`computeLineupStats` e.d.) worden niet gewijzigd, alleen
de invoer.

## H. Besluiten (genomen door de eigenaar, 2026-10-30)

Alle aanbevelingen hieronder zijn goedgekeurd: (1) uitzondering akkoord;
(2) owner/admin/coach; (3) in-place + begrensd correctielog;
(4) `clockDown` afleiden uit het bestaand segment; (5) lineup buiten scope;
(6) bewaarbeleid naar PR 8.3.

Oorspronkelijke vraagstelling:

1. **Beleidswijziging:** akkoord dat "afgeronde wedstrijd onveranderlijk" een
   gecontroleerde uitzondering krijgt (alleen tijd/score/turnovers, met
   logboek)? (Aanbeveling: ja.)
2. **Wie mag corrigeren:** owner/admin/coach zoals verwijderen (aanbevolen),
   of ook scorer?
3. **Opslagmodel:** in-place + begrensd correctielog (aanbevolen) of
   append-only subcollectie.
4. **`clockDown`:** `CompletedGame` bewaart niet of de klok aftelde. Voor een
   correcte duurberekening is ofwel een nieuw optioneel veld nodig (alleen
   voor nieuwe wedstrijden), ofwel afleiding uit het bestaande segment
   (`beginSec > endSec` ⇒ aftellend). Aanbeveling: afleiden uit het
   bestaande segment; geen datacontractwijziging.
5. **Lineup corrigeren:** buiten scope in 7.5 (aanbevolen) of toevoegen?
6. **Bewaarbeleid** voor het correctielog hoort bij PR 8.3 (privacy/
   bewaartermijnen); tot dan blijft het log staan, zonder spelersnamen
   (alleen segment-ID en getallen).

## I. Open risico's

- Echte-apparaat- en staging-verificatie van de cloudtak kan niet in de
  sandbox; die blijft, net als bij 7.3/7.4, expliciet open voor
  fase-7-acceptatie.
- Een bestaande, oude client zonder dit schema leest `corrections` niet; dat is
  geen probleem voor lezen, maar een oude client met lokaal-wint-merge kan een
  nieuwere cloudcorrectie tijdelijk verbergen tot ververs. Mitigatie: de
  revisiegestuurde merge uit 7.5c is vereist vóór cloudcorrecties worden
  uitgerold.
- Een correctie wijzigt historische stats achteraf; dat is bedoeld, maar wordt
  zichtbaar gemaakt via de "Gecorrigeerd"-badge.
- Gecorrigeerde wedstrijden worden bij cloudmigratie voorlopig geblokkeerd; meenemen van het log vraagt een create-Rules-wijziging en een eigen sub-PR.

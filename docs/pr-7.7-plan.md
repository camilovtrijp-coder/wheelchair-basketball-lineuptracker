# PR 7.7 — lineup van een segment corrigeren in Historie (voorstel)

**Status: besluiten op de open vragen genomen (2026-11-22, zie §F);
uitvoering per sub-PR gestart (7.7a = PR #156, 7.7b en 7.7c in uitvoering).**
Dit plan breidt de goedgekeurde uitzondering van PR 7.5 uit
("afgeronde wedstrijd is standaard onveranderlijk") en raakt het datacontract
van het correctielog en de Firestore Rules. Volgens `AGENTS.md` mag de
implementatie pas starten na een expliciet besluit op de open vragen in §F.

## A. Aanleiding en doel

Een coach merkt na het indienen van een wedstrijd dat in één segment een
speler verkeerd is vastgelegd (iemand wilde nog wisselen). Nu kan Historie
alleen kwart, begin-/eindtijd, score en turnovers corrigeren
(`docs/pr-7.5-plan.md`: "lineup buiten scope", open vraag 5).

Doel: een bevoegd teamlid kan in het scherm "Segment corrigeren" ook de
**vijf spelers van dat segment** aanpassen, ook nadat de wedstrijd is
afgerond. Alles wat uit de lineup volgt (speeltijd per speler, +/- per speler
en lineup, lineupcode, classificatiesom, Stats, Trends, CSV) is dan
automatisch consistent.

Niet in scope: segmenten toevoegen/verwijderen of splitsen, de spelerslijst
van de wedstrijd (`players`) wijzigen, tegenstander/datum wijzigen.

## B. Huidige werking

- `correctSegment()` (`v2/src/domain/game/correction.ts`) wijzigt zes velden
  (`quarter`, `beginSec`, `endSec`, `pf`, `pa`, `tov`), herberekent `durSec`,
  de eindscore en `revision`, en voegt één item toe aan het begrensde
  correctielog (`CompletedGame.corrections`, max. 50). `lineup`, `classSum`,
  `allowed` en `over` blijven bewust ongewijzigd.
- `CorrectSegmentDialog` toont de zes velden en een bevestigingsstap; opslag
  loopt via `CompositeCompletedGameRepository` (lokaal eerst, cloud daarna
  met lineage-controle).
- De Firestore Rules (`firebase/firestore.rules`, `isValidCorrectedSegment`)
  staan alleen een wijziging van die zes velden (+ `durSec`) toe en eisen dat
  alle andere segmenten byte-gelijk blijven.
- `Segment.lineup` is een lijst van precies 5 `GamePlayer.id`'s uit
  `CompletedGame.players` (de spelersnaam/klasse-snapshot van de wedstrijd).

## C. Voorstel

1. **Domein** (`correction.ts`, `types.ts`): `CorrectableSegmentFields` krijgt
   een zevende veld `lineup: string[]`. Validatie: exact 5 unieke ID's, alle
   aanwezig in `game.players`; volgorde is niet betekenisvol (er wordt voor
   vergelijking en lineupcode gesorteerd, zoals elders in v2). `classSum`,
   `allowed` en `over` worden herberekend uit het spelerssnapshot — zie
   open vraag 2. Alleen een gewijzigde lineup telt als wijziging van dat veld.
2. **Correctielog**: `before`/`after` bevatten ook `lineup` (alleen
   speler-ID's, geen namen — blijft in lijn met §H.6 van het 7.5-plan).
   Bestaande logitems zonder `lineup` blijven geldig (veld optioneel in
   `before`/`after` bij het inlezen; nieuwe items schrijven het altijd).
3. **UI** (`CorrectSegmentDialog`): een lineup-blok met de 5 huidige spelers
   als tegels en een keuze uit de overige deelnemers van de wedstrijd (alleen
   spelers uit `game.players` die `participate` waren). Toont live de
   classificatiesom/limiet en waarschuwt bij overschrijding, zonder te
   blokkeren (zelfde gedrag als live). De bevestigingsstap toont "voor →
   na" inclusief de gewisselde spelers (namen alleen in de UI).
4. **Cloud**: `completedGame.ts` (document-converter) en
   `firestore.rules` accepteren `lineup` in `before`/`after` en laten
   `lineup`, `classSum`, `allowed`, `over` van het aangewezen segment
   wijzigen; alle andere segmenten blijven byte-gelijk. Rules blijven beperkt
   tot owner/admin/coach en worden positief en negatief getest in de
   Emulator Suite (incl. "lineup met spelers die niet in `players` staan",
   "lineup met != 5 of dubbele spelers", "andere segmenten ongewijzigd",
   "viewer/speler mag niet"). **Uitrolvolgorde zoals 7.5:** eerst Rules
   publiceren, daarna pas clients met deze correctie.
5. **Geen wijziging** van statistiekberekeningen, CSV-contract,
   `localStorage`-keys of bestaande opgeslagen data. Stats, Trends,
   lineupoverzicht en CSV lezen `segments` en volgen dus vanzelf; dat wordt
   met tests bevestigd, niet aangepast.

## D. Risico's

- **Opslag**: nieuwe wedstrijden/correcties schrijven een extra veld in het
  log; oudere data blijft leesbaar (veld optioneel). Geen nieuwe
  `localStorage`-keys. Een oudere app-versie die een gecorrigeerde
  wedstrijd met `lineup` in het log leest, moet dat negeren of fail-closed
  afhandelen — controleren in de converter-tests.
- **CSV**: kolomindeling ongewijzigd; alleen de waarden van het gecorrigeerde
  segment (lineupcode, spelers, klassesom) veranderen. Fictieve
  CSV-fixture met handmatig nagerekende verwachting.
- **Offline**: correctie werkt lokaal zonder netwerk; cloudupload volgt via
  de bestaande wachtrij/lineage-logica van 7.5c.
- **Vertalingen**: nieuwe teksten (lineup-blok, foutmeldingen
  `invalid-lineup`, waarschuwingen) in NL en EN; bestaande testen op
  sleutelpariteit blijven gelden.
- **Statistieken**: geen formules gewijzigd, maar uitkomsten voor die
  wedstrijd veranderen na een lineupcorrectie (bedoeld). Tests met vaste,
  handmatig narekenbare getallen: vóór/na-speeltijd en +/- per speler voor
  een wisseling in één segment.
- **Rules-complexiteit**: Firestore beperkt tot 1000 expressie-evaluaties per
  request; een lijstvergelijking van 5 ID's moet compact blijven
  (`hasAll`/`size`-controles, `let`-bindings).

## E. Uitvoeringsplan (sub-PR's, na akkoord)

- **7.7a — domein + lokaal**: `lineup` in `correctSegment()`/log/replay,
  herberekening klassesom, unit-tests (incl. oracle-getallen, `no-change`,
  dubbele/onbekende spelers, oud log zonder `lineup`).
- **7.7b — UI**: lineup-blok in `CorrectSegmentDialog` + bevestiging, NL/EN,
  component-tests, e2e-spec voor Historie ("wissel speler in segment, zie
  nieuwe speeltijd in Stats").
- **7.7c — cloud + Rules**: converter, Rules, Emulator-tests positief en
  negatief, lineage/merge-tests. Alleen na besluit op vraag 1.

Per sub-PR: eigen branch, drafts-PR, relevante tests (`vitest`, e2e,
Emulator Suite voor 7.7c) en rapportage van gewijzigde bestanden en open
risico's. Echte-apparaat- en staging-verificatie van de cloudtak blijft
(net als 7.3–7.5) handmatig open.

## F. Besluiten van de eigenaar (2026-11-22)

1. **Cloud direct meenemen: ja** (7.7c hoort bij dit traject).
2. **Classificatiesom: variant A.** `classSum` wordt herberekend uit de
   spelersklassen in het snapshot en `allowed` wordt bijgesteld met het
   bonusverschil volgens de *huidige* instellingen (alleen als `useClassLimit`
   aan stond); `over` volgt daaruit. Bekend gevolg: zijn de instellingen
   sinds de wedstrijd gewijzigd, dan kan `allowed` afwijken van de toenmalige
   grens.
3. **Alleen spelers die meededen** (`participate`) zijn kiesbaar.
4. Bewaartermijn correctielog: ongewijzigd (max. 50 items, bij PR 8.3).

## G. Afwijking van §C.2 bij uitvoering (7.7a)

`lineup` en `allowed` staan alleen in `before`/`after` van een logitem als de
lineup in die correctie wijzigt (niet "altijd"). Zo houden correcties van
alleen tijd, score of turnovers exact de oude logvorm en blijven de bestaande
Rules en oudere clients werken tot 7.7c is uitgerold. `allowed` wordt
meegelogd zodat het terugspelen van het log deterministisch is, onafhankelijk
van latere instellingen.

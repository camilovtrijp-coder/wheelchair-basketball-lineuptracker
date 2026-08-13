# Voorbereidingsplan PR 6.4 — statistieken

Status: voorbereid vóór implementatie. Dit document geeft nog geen toestemming
om buiten PR 6.4 te bouwen. Controleer vóór de eerste codewijziging opnieuw de
dan gemergede head van `main` en werk alleen afwijkende bestandspaden/types bij.

## A. Doel en ingangspoorten

PR 6.4 brengt het v1-Stats-tabblad naar v2: lineupcombinaties van één tot vijf
spelers, ON/OFF-plus/min, speeltijd, per-10-minutennormalisatie en de bestaande
wedstrijd- en spelerfilters. Alle totalen blijven rechtstreeks afleidbaar uit
wedstrijdsnapshots en segmenten.

Start de implementatie pas wanneer:

1. PR 6.3 is gemerged en `CompletedGame`, `CompletedGameRepository` en de
   per-organisatie/team-opslag op de actuele `main` zijn gecontroleerd;
2. een leesfout/corrupte opslag expliciet te onderscheiden is van een werkelijk
   lege historie; Stats mag `[]` nooit zonder status als bewijs voor “geen
   wedstrijden” gebruiken;
3. de exacte v1-algoritmen in `index.html` (`statsScopeGames()` tot en met
   `computeCombos()`) en Voorbeeld 4 uit de compatibiliteitsmatrix opnieuw zijn
   vergeleken met dit plan.

**Reality-check na merge PR 6.3 (`main` `3e09b69`, 2026-08-13): OPEN
prerequisite voor 6.4.** `CompletedGameRepository.list()` retourneert nog alleen
`CompletedGame[]`; `LocalStorageCompletedGameRepository.list()` reduceert een
read-/parsefout daardoor voor de aanroeper tot `[]`. Daarnaast behandelt
`strictReadBrowserStorage` een falende of niet-beschikbare storage-getter nog als
`null`/no-op, ook al worden fouten van een verkregen `Storage.getItem()` wel
doorgegeven. Vóór de Stats-UI moet een expliciet leesresultaat worden ingevoerd
dat minimaal `ok`, `missing` en `error` onderscheidt, en mutaties mogen bij
`error` of unavailable nooit schrijven of succes melden. Voeg adaptertests toe
voor zowel een tijdelijk falende getter (volgende getter-call werkt) als blijvend
unavailable. Dit is een begrensde ingangsfix voor 6.4, geen toestemming om
andere PR-6.3-functionaliteit opnieuw te ontwerpen.
De technische follow-up staat inmiddels in draft-PR #49; deze poort blijft OPEN
totdat die PR onafhankelijk is herreviewd, exact-head-CI groen is en de fix naar
`main` is gemerged.

## B. Scope

| In scope | Niet in scope |
|---|---|
| Pure berekening van combinaties, ON/OFF, punten en speeltijd | Trends en grafieken (PR 6.5) |
| Afgeronde wedstrijden plus lopende wedstrijd met segmenten | Cloudsync van wedstrijden (PR 7.1/7.2) |
| Combinatiegrootte 1–5, sortering en per-10-toggle | Een cloudbrede rapportage-/aggregatielaag |
| Wedstrijdfilter en spelerfilter “op/af/geen” | Historische statistieken bewerken of cachen als waarheid |
| Mobiele NL/EN-UI met lege, fout- en geen-resultatenstatus | Nieuwe statistiekdefinities of gewijzigde v1-formules |
| Vastleggen van het aantal Firestore-reads voor deze flow | Organisatie-overstijgende analyses |

## C. Vastgelegde berekeningscontracten

### C.1 Analysebron

- Een application-laag bouwt één `AnalysisGame[]` uit:
  - `CompletedGameRepository` voor de historie (nieuwste eerst);
  - de actuele `ActiveGame` uitsluitend wanneer `deriveGameHistory()` minstens
    één segment oplevert, gemarkeerd als `isCurrent`/voorlopig.
- UI-componenten lezen geen `localStorage` of Firestore rechtstreeks.
- Score, segmenten en minuten worden telkens uit de bronsegmenten afgeleid.
  Een eventuele memo/cache is alleen een optimalisatie en nooit de canonieke
  bron of de enige opgeslagen totalenlaag.
- Analyse blijft beperkt tot de geselecteerde organisatie/teamcontext.

### C.2 Stabiele speleridentiteit

`GamePlayer.id` is per wedstrijd een nieuwe UUID en kan daarom niet gebruikt
worden om dezelfde speler over meerdere wedstrijden te groeperen. PR 6.4
normaliseert iedere segment-lineup via de spelersnapshot van die wedstrijd naar
`GamePlayer.rosterId`. Combinaties, filters en sleutels gebruiken vervolgens de
gesorteerde `rosterId`-waarden. Een onbekende segmentreferentie maakt die
wedstrijd/het segment PARTIAL of ongeldig; ze mag niet stil als een andere
speler worden meegeteld.

Voor labels geldt: actuele rostergegevens indien de speler nog bestaat, anders
de nieuwste bruikbare historische spelersnapshot, en pas daarna `#?` als veilige
fallback. Historische berekeningen blijven dus bestaan na een rosterwijziging.

### C.3 Exact v1-gedrag

1. Pas eerst de wedstrijdselectie en daarna de spelerfilters toe.
2. Een “moet op”-speler moet in iedere meegenomen segment-lineup staan; een
   “moet af”-speler mag er niet in staan.
3. Genereer alleen combinaties die in minstens één gefilterd segment samen op
   het veld stonden.
4. Tel voor zo'n combinatie ON wanneer alle leden op het veld staan en OFF
   wanneer dat niet zo is, maar uitsluitend in wedstrijden waarin alle leden
   in de wedstrijdspelersnapshot aanwezig zijn.
5. Bewaar `onSec/onPF/onPA/offSec/offPF/offPA`; toon ON/OFF-plus/min als
   `PF - PA`.
6. Per 10 minuten verandert alleen de getoonde plus/min:
   `pm * 600 / seconds` wanneer `seconds > 0`. Ruwe totalen blijven gelijk.
7. Sorteer standaard aflopend op getoonde ON-plus/min en ondersteun dezelfde
   richtingtoggle als v1. Leg een stabiele tweede sortering op de combinatiekey
   vast om flikkerende volgorde bij gelijke waarden te voorkomen.
8. De actieve wedstrijd verschijnt als afzonderlijke voorlopige selectie en
   mag nooit met een afgeronde wedstrijd-ID botsen.

## D. Voorgestelde laag- en bestandsindeling

### 6.4a — domain

- `v2/src/domain/stats/types.ts`: `AnalysisGame`, `StatsFilter`,
  `LineupCombinationStats` en expliciete data-/validiteitsstatus.
- `v2/src/domain/stats/computeLineupStats.ts`: pure normalisatie, filters,
  combinatiegeneratie en aggregatie.
- `v2/src/domain/stats/format.ts`: alleen pure weergavewaarden; geen
  bronberekeningen in componenten.

### 6.4b — application

- `v2/src/application/stats/buildAnalysisScope.ts`: combineert historie en de
  afgeleide actieve wedstrijd en bewaakt context/provenance.
- Deel de wedstrijdselectie zodanig met PR 6.5 dat Stats en Trends later exact
  dezelfde selectie kunnen gebruiken; geen dubbele, uit elkaar lopende state.
- Voeg geen Firestore-query toe. Noteer in het PR-bewijs expliciet: aantal extra
  Firestore-reads door Stats op de lokale PR-6.3-bron = 0. Als de actuele
  repository bij start inmiddels wel cloud leest, leg querypad, documentaantal
  en Emulator-meting vast voordat implementatie verdergaat.

### 6.4c — UI

- `v2/src/ui/stats/StatsPanel.tsx` plus kleine filtercomponenten.
- Nieuwe Stats-tab in `App.tsx`.
- Controls voor grootte 1–5, sortering, per 10 minuten, wedstrijden en
  op/af-spelerfilters.
- Lege historie, opslag-/parsefout, PARTIAL-data en “geen combinaties voor dit
  filter” krijgen verschillende boodschappen. Alle zichtbare tekst is NL/EN.
- Alle geautoriseerde teamlezers mogen Stats bekijken; deze flow schrijft geen
  teamdata en hergebruikt dus geen schrijfbevoegdheid als leespoort.

## E. Testplan

Minimale pure fixtures:

1. `product-compatibility-matrix.md` Voorbeeld 4: speler #1 = 540 seconden,
   totale plus/min +6 en per 10 minuten +6,7.
2. Eén handmatig narekenbare twee-wedstrijdenfixture voor combinaties 1–5 met
   ON én OFF-minuten en punten.
3. Twee wedstrijden waarin dezelfde `rosterId` verschillende game-player-UUID's
   heeft: één gecombineerde speler/combinatie, geen duplicaat.
4. Een speler die niet in de wedstrijdsnapshot zat levert in die wedstrijd geen
   OFF-data voor een combinatie met die speler.
5. Moet-op, moet-af, gecombineerde filters en een leeg resultaat.
6. Actieve wedstrijd met segmenten telt voorlopig mee; zonder segmenten niet.
7. `seconds === 0`, gelijke sorteerwaarden, negatieve/decimale plus/min en
   onbekende spelerreferenties.
8. Een read-/parsefout toont een fout/PARTIAL-status en nooit de gewone
   “nog geen wedstrijddata”-melding.

Playwright dekt minimaal: tab openen, combinatiegrootte wijzigen, per-10-toggle,
beide filters, actieve wedstrijd als voorlopig item, mobiel 320 px en NL/EN.
Volledige v1-regressie, v2-unit, relevante v2-e2e, typecheck, lint, format en
build blijven groen.

## F. Acceptatiecriteria en stopregels

- Uitkomsten voor de vaste fixtures zijn handmatig narekenbaar en gelijk aan v1.
- Geen aggregaatcache is nodig om een uitkomst opnieuw te berekenen.
- Geen nieuwe Firestore-query of rapportagecollectie zonder apart besluit.
- Geen cross-team-data en geen directe opslagtoegang vanuit UI.
- Bij een verschil tussen dit plan en de gemergede PR-6.3-contracten: stop,
  documenteer het verschil en actualiseer eerst dit plan.

Aanbevolen volgorde: 6.4a pure berekeningen → 6.4b scope/application → 6.4c UI
en e2e. PR 6.5 begint pas nadat de reken- en selectielaag van 6.4 stabiel is.

# Voorbereidingsplan PR 6.5 — trends

Status: voorbereid vóór implementatie. Herijk bestandspaden en types tegen de
gemergede PR 6.4 voordat code wordt geschreven; de formules en datastatussen
hieronder zijn de functionele grens.

## A. Doel en afhankelijkheden

PR 6.5 bouwt chronologische spelertrends op dezelfde wedstrijdselectie als
Stats: gemiddelde speeltijd en plus/min per deelnemende wedstrijd, een
plus/min-lijngrafiek, een speeltijdstaafgrafiek en een uitklapbare
wedstrijdlijst. De actieve wedstrijd is een herkenbaar voorlopig laatste punt.

Startvoorwaarden:

1. PR 6.3 is gemerged en historie kan veilig als leeg/fout/PARTIAL worden gelezen.
2. PR 6.4 is gemerged met één gedeelde `AnalysisGame`-bron, stabiele
   `rosterId`-identiteit en gedeelde wedstrijdselectie.
3. De v1-functies `trendsScopeGames()` tot en met `renderTrendsTab()` en
   Voorbeeld 4 zijn opnieuw gecontroleerd.

## B. Scope

| In scope | Niet in scope |
|---|---|
| Trends per huidige roster-speler die daadwerkelijk speelde | Organisatie-/teamoverstijgende dashboards |
| Oud → nieuw, actuele wedstrijd als voorlopig laatste punt | Voorspellende analyses of benchmarks |
| Gemiddelde minuten en plus/min per deelnemende wedstrijd | Nieuwe statistiekdefinities |
| Per-10-toggle, sortering en gedeeld wedstrijdfilter | Eigen, afwijkend Trends-wedstrijdfilter |
| Toegankelijke lijn-/staafvisualisatie en wedstrijdlijst | Externe chart-/analyticsdienst |
| Leeg, PARTIAL, lokaal/cache en fout zichtbaar onderscheiden | Wedstrijddata naar Firestore synchroniseren |

## C. Vastgelegde trendcontracten

### C.1 Spelers en punten

- Gebruik `rosterId` als identiteit; nooit de per-wedstrijd-UUID.
- Spiegelt v1: alleen spelers uit de actuele teamroster worden als kaarten
  getoond. Een verwijderde historische speler blijft in brondata bestaan maar
  krijgt zonder actuele roster-entry geen eigen trendkaart. Leg dit expliciet
  vast in een test zodat dit later niet onbedoeld verandert.
- Een speler krijgt voor een wedstrijd alleen een datapunt als die in minstens
  één geldig segment op het veld stond. Een wedstrijd waarin de speler niet
  meedeed telt niet mee in de deler.
- Per punt: `sec = som(durSec)` en `pm = som(pf - pa)` van de segmenten waarin
  de speler op het veld stond.

### C.2 Volgorde, gemiddelden en per 10 minuten

- Afgeronde wedstrijden komen chronologisch oud → nieuw. Gebruik datum en een
  stabiele tweede sleutel/opslagvolgorde bij gelijke of ongeldige datums.
- De actuele wedstrijd staat, indien zij geldige segmenten heeft en door het
  gedeelde filter is geselecteerd, altijd als laatste en draagt
  `provisional: true`.
- Gemiddelde minuten = totale seconden / 60 / aantal gespeelde wedstrijden.
- Normale gemiddelde plus/min = som van punt-plus/min / aantal gespeelde
  wedstrijden.
- Spiegelt het subtiele v1-gedrag bij “per 10”: normaliseer ieder wedstrijdpunt
  eerst met `pm * 600 / sec` en neem daarna het gemiddelde van die waarden.
  Dit is niet hetzelfde als één normalisatie over alle samengevoegde seconden.
- De uitklaplijst toont altijd de ruwe minuten en ruwe plus/min per wedstrijd,
  zoals v1; de toggle beïnvloedt kaartgemiddelde en plus/min-grafiek.
- Sorteercyclus: rugnummer → gemiddelde minuten → gemiddelde plus/min. Bij
  gelijke waarden volgt een stabiele rugnummer/rosterId-sortering.

### C.3 Visualisaties en dataherkomst

- Maak pure chart-viewmodels (coördinaten, schaal, nul-as en balkpercentages)
  los van Preact/DOM; de UI rekent geen statistiek opnieuw uit.
- Plus/min gebruikt een symmetrische schaal rond nul met een minimumrange van 1.
- Speeltijdbalken gebruiken één gedeeld maximum over alle zichtbare spelers en
  wedstrijden, zodat kaarten vergelijkbaar blijven.
- Een punt en kaart hebben altijd een tekstalternatief; kleur is nooit het enige
  onderscheid. SVG krijgt een toegankelijke naam en de uitklaplijst bevat de
  exacte waarden.
- Dataherkomst is expliciet: `local-complete`, `cache`, `partial` of `error`, met
  daarnaast per actief punt `provisional`. In fase 6 is lokale data canoniek en
  wordt geen kunstmatige cloudcache gebouwd; de statusvorm moet alleen voorkomen
  dat een latere cache als volledige serverdata wordt voorgesteld.

## D. Voorgestelde laag- en bestandsindeling

### 6.5a — domain

- `v2/src/domain/trends/computePlayerTrends.ts`: pure punten, gemiddelden,
  sortering en shared maximum.
- `v2/src/domain/trends/chartModels.ts`: pure lijn-/balkmodellen.
- Hergebruik `AnalysisGame` en de filterselectie uit PR 6.4; geen tweede
  normalisatie- of repositorypad.

### 6.5b — application

- Een kleine usecase bouwt de trendviewmodels uit de gedeelde analysescope.
- De selectie-ID's blijven in een gedeelde state boven Stats en Trends, zodat
  een wijziging op één tab onmiddellijk op de andere geldt (v1-pariteit).
- Propageer bronstatus en waarschuwingen zonder ze naar `[]` te reduceren.

### 6.5c — UI

- `v2/src/ui/trends/TrendsPanel.tsx` met kleine toegankelijke chartcomponenten.
- Nieuwe Trends-tab in `App.tsx`.
- Controls voor per 10, gedeeld wedstrijdfilter en sortering; kaarten kunnen de
  wedstrijdlijst uit-/inklappen.
- Specifieke UI voor geen data, fout, PARTIAL/cache en voorlopige actuele data.
- NL/EN voor alle zichtbare tekst; mobiel bruikbaar vanaf 320 px zonder
  horizontale pagina-scroll.

## E. Testplan

Pure tests:

1. Voorbeeld 4: 9:00 totaal, gemiddeld 4:30 en gemiddeld +3,0 over twee
   deelnemende wedstrijden; de per-10-berekening wordt afzonderlijk exact
   vastgelegd volgens het per-punt-v1-contract.
2. Dezelfde `rosterId` met verschillende game-player-UUID's vormt één trend.
3. Niet meegedaan = geen punt en niet in deler; nul plus/min blijft wel een punt.
4. Afgerond oud → nieuw en actieve wedstrijd altijd voorlopig als laatste.
5. Wedstrijdfilter is identiek aan Stats en blijft gedeeld bij tabwissel.
6. Rugnummer/minuten/plus-min-sortering met stabiele ties.
7. Symmetrische plus/min-schaal, één punt, alle nullen/negatieven en gedeeld
   minutenmaximum.
8. Verwijderde historische speler wordt niet als kaart getoond; onbekende
   referentie levert PARTIAL in plaats van een stille verkeerde trend.
9. `local-complete`, `cache`, `partial`, `error` en `provisional` blijven in het
   viewmodel onderscheidbaar.

Playwright dekt minimaal: kaart/gemiddelden, beide grafieken plus
tekstalternatief, per-10-toggle, sorteer-cyclus, gedeeld filter, uitklaplijst,
voorlopig actief punt, NL/EN en 320 px. Volledige v1-regressie, v2-unit,
relevante e2e, typecheck, lint, format en build blijven groen.

## F. Acceptatiecriteria en stopregels

- De v1-formules, chronologie en deelnamedeler zijn met vaste fixtures bewezen.
- Stats en Trends gebruiken aantoonbaar dezelfde wedstrijdselectie en identiteit.
- Geen externe chart-, analytics- of rapportageservice.
- Fout/PARTIAL/cache wordt nooit als gewone lege of volledige data gepresenteerd.
- Als PR 6.4 een ander identiteits- of selectiecontract oplevert: eerst dit plan
  herijken; geen adapterlaag bouwen die twee definities naast elkaar laat bestaan.

Aanbevolen volgorde: 6.5a pure trend-/chartmodellen → 6.5b gedeelde state →
6.5c UI/e2e.

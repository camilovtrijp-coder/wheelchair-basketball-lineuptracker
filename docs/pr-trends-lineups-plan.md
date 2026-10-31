# Onderzoeks- en voorbereidingsplan — Trends: lineup- en spelersinzichten

Status: **goedgekeurd door de eigenaar op 2026-10-31** (besluiten in §I). Alle
stappen T1 tot en met T7 worden gebouwd, per stap op een eigen branch,
daarna Opus-review met Sonnet-fixes en één bundel-PR naar `main` (één build).
**Afwijking van het advies in dit plan:** de eigenaar houdt **groen en rood** als
kleuren (geen blauw/oranje). De symbolen ▲ ● ▼ en tekst blijven daarbij verplicht:
kleur is nooit de enige aanwijzing. Waar dit plan "blauw/oranje" noemt, geldt dus
groen/rood met symbolen.


Status: **goedgekeurd door de eigenaar op 2026-10-31** (was: onderzoek en plan, nog niet
goedgekeurd). Dit plan zelf wijzigt geen code; de uitvoering staat in §H.
Gebaseerd op `origin/main` `69d267c` (PR 7.6). Dit plan wijzigt geen
bestaande statistiekberekening, geen CSV-contract en geen `localStorage`-key.
Alle nieuwe berekeningen zijn **additief** en krijgen eerst een vaste,
handmatig narekenbare fixture (§F).

Legenda in dit document: **[feit]** = bevestigd in de code (bestand:regel),
**[afleiding]** = conclusie uit code of bronnen, **[advies]** = aanbeveling.

## 0. Samenvatting en aanbeveling

De vraag "+/- per lineup, net als turnovers per lineup" is eenvoudig en veilig
te bouwen: alle data staat al in de segmenten en `computeLineupStats` levert de
totalen al. Het echte risico zit niet in de berekening maar in de **presentatie
van kleine steekproeven**. De huidige turnoverranglijst zet nu al lineups met
2–3 minuten bovenaan als "beste" (§B.4). Wie daar +/- naast zet zonder drempel,
laat een lineup met 3 minuten en +4 zien als "+13,3 per 10 min" en dus als
beste lineup.

Top-5 prioriteiten [advies]:

1. **Lineups: +/- per 10 min** met minuten naast elke waarde, een
   minimumminutendrempel (standaard 5:00) en een aparte groep "te weinig data"
   (Must).
2. **Punten voor en tegen per 10 min per lineup**, aanval en verdediging los
   van +/- (Must, in dezelfde rij of als metriekschakelaar).
3. **Pagina-indeling met een segmentbediening** Overzicht | Lineups |
   Spelers | Kwarten en een vaste filterbalk (Should, nodig zodra er meer dan
   twee lineupsecties zijn).
4. **On/off per speler** (+/- per 10 met en zonder die speler, met
   off-minuten erbij) op de spelerkaart (Should).
5. **Per kwart** (team +/-, PF/PA per 10 en minuten per speler per kwart)
   voor patronen als een zwak vierde kwart en de belasting per speler (Should).

Bewust niet: ORtg/DRtg per 100 possessions, schot- of reboundstatistiek,
individuele turnovers en tegenstanderlineups. Die data bestaat niet (§B.5).

## A. Context en grenzen

- Vraag van de eigenaar: (1) +/- per lineup zoals turnovers per lineup;
  (2) welke andere inzichten waardevol zijn voor lineup- en spelersanalyse,
  ook specifiek voor rolstoelbasketbal; (3) of de pagina anders moet;
  (4) een plan.
- Roadmappositie [feit]: Trends (PR 6.5) en de turnoveranalyse (#129) zijn
  gemerged. `docs/IMPLEMENTATION_PLAN.md` §18 sluit "wijziging van historische
  statistiekdefinities" uit, en §11/PR 6.5 noemt "nieuwe statistiekdefinities"
  expliciet buiten scope. **Nieuwe, additieve definities vallen dus buiten
  elke goedgekeurde fase. De eigenaar moet ze eerst als producttrack goedkeuren
  (besluit H.1).**
- Projectregels die gelden: NL én EN, offline/PWA, geen backend/analytics/
  tracking, fictieve data, één taak per PR, geen wijziging aan bestaande
  berekeningen zonder vaste tests.

## B. Huidige werking en datagrenzen (bevestigd in de code)

### B.1 Databron

- `Segment` [feit, `v2/src/domain/game/types.ts:36-58`]: `quarter`,
  `beginSec`, `endSec`, `durSec`, `lineup` (5 × `GamePlayer.id`), `pf`, `pa`,
  `classSum`, `allowed`, `over`, optioneel `tov` (eigen teamturnovers,
  ontbrekend = 0).
- `GamePlayer` [feit, `types.ts:8-20`]: `rosterId` (stabiele identiteit),
  `nr`, `naam`, `kl` (string), `vrouw`, `jeugd`, `participate`, `start`.
- `CompletedGame` [feit, `types.ts:184-245`] bevat `quarterCount` en
  `useClassLimit`, maar geen actielog en geen `clockDown`. `AnalysisGame`
  [feit, `v2/src/domain/stats/types.ts:17-27`] neemt alleen `id`, `opponent`,
  `competition`, `date`, `players`, `segments`, `score*` en `isCurrent` over.
  `useClassLimit` en `quarterCount` gaan dus verloren in de analysescope
  (`v2/src/application/stats/buildAnalysisScope.ts:86-98`).
- Classificatie [feit]: `isOverLimit` geeft `over = sum > allowed + 0.001`
  (`v2/src/domain/game/tracking.ts:63-72`). `allowed = limiet + min(maxBonus,
  som bonus)`. De standaardwaarden zijn `classBaseLimit 14.5`, `maxBonus 2.5`,
  tag1 (vrouw) `1.5`, tag2 (jeugd) `1.0`, beide `2.0`
  (`v2/src/domain/settings/types.ts:52-67`). Met `useClassLimit = false` (de
  standaard) zijn `classSum`, `allowed` en `over` altijd `0/0/false`
  (`tracking.ts:44-61`).
  [afleiding] De app-standaard van 14,5 wijkt af van het internationale
  IWBF-maximum van 14,0. Nationale competities hanteren soms andere grenzen
  (zie bronnen §J). Analyses mogen daarom alleen `allowed` en `over` uit het
  segment gebruiken, nooit een hardgecodeerde 14,0.

### B.2 Tab Statistieken (PR 6.4)

[feit] `computeLineupStats` (`v2/src/domain/stats/computeLineupStats.ts:53-162`):

- wedstrijdfilter → spelerfilter (moet op/af) → combinaties van grootte 1–5
  die ooit samen op het veld stonden;
- per combinatie `onSec/onPF/onPA/offSec/offPF/offPA/onTov/offTov`;
- OFF telt alleen in wedstrijden waarin alle leden in de spelerssnapshot
  zaten;
- de sleutel is de numeriek gesorteerde `rosterId`-lijst (`:104-111`);
- PARTIAL-segmenten worden volledig uitgesloten;
- sortering op getoonde ON-+/- (raw of per 10), daarna op de sleutel.

De UI (`v2/src/ui/stats/StatsPanel.tsx`) toont een kaart per combinatie met
Tijd, Pnt, Teg, "Met hen" en "Zonder hen" (+/-) en de turnoverpillen. Er is
**geen minimumminutendrempel, geen limiet** en geen vergelijking met het
teamgemiddelde.

### B.3 Tab Trends (PR 6.5 + turnovers)

[feit]

- `computePlayerTrends` (`v2/src/domain/trends/computePlayerTrends.ts:22-137`):
  per rosterspeler en per wedstrijd `sec`, `pm` en `tov`. De gemiddelden zijn
  per wedstrijd, en bij per 10 wordt **per punt eerst genormaliseerd en
  daarna gemiddeld** (v1-contract, `:144-153`).
- `computeTurnoverSummary` (`v2/src/domain/trends/turnoverSummary.ts:36-61`):
  teamtotaal over alle segmenten, inclusief PARTIAL.
- `computeLineupTurnoverRanking` (`turnoverSummary.ts:95-129`):
  1. hergebruikt `computeLineupStats` met `comboSize: 5`;
  2. `onSec > 0`;
  3. `per10 = onTov*600/onSec`;
  4. de toon is `good` bij `per10 ≤ tijdgewogen gemiddelde`, anders `bad`;
  5. sortering oplopend, daarna op de sleutel `rosterIds.join(',')`;
  6. limiet 10 (`:82`).
- UI (`v2/src/ui/trends/TrendsPanel.tsx`):
  - chips Per 10 / Wedstrijden (n) / Sorteer (`:127-155`);
  - `TurnoverSummaryBanner` (`:350-369`);
  - `LineupTurnoverCard` (`:371-428`): het label bestaat uit rugnummers,
    oplopend gesorteerd (`:393-396`), met `· M:SS`;
  - per speler een `PlayerTrendCard` (`:217-348`) met tegels +/-, Turnovers
    en MIN, een +/- lijngrafiek, minutenbalken en een uitklaplijst.
- De wedstrijdselectie `gameIds` wordt gedeeld met Statistieken via `App.tsx`.
  `per10` en de sortering zijn per tab.

### B.4 Problemen die nu al zichtbaar zijn [afleiding]

1. **Geen steekproefbewaking in de lineupranglijst.** Een lineup van 2:00
   zonder turnover staat bovenaan als "beste". In de fixture van §F komen de
   lineups van 2:00 en 3:00 vóór de lineup van 25:00.
2. De chip "Per 10 min" heeft geen effect op de lineupranglijst. Die is altijd
   per 10. Dat is inconsistent voor de gebruiker.
3. Kleur als enige codering: `trends-tov-row__v--good/bad` zijn alleen groen
   en rood (`v2/src/styles/turnovers-analysis.css:121-127`). Het getal staat
   er wel bij, maar "goed of slecht" is alleen kleur.
4. Overlap: Statistieken met grootte 5 toont dezelfde lineups met +/-, maar
   zonder ranglijst. Trends toont lineups alleen voor turnovers.
5. De pagina is één lange scroll. Met 12 spelers zijn dat 12 kaarten met
   twee grafieken, onder een lineupsectie die nog gaat groeien.

### B.5 Wat de data NIET bevat → wat we niet mogen claimen

| Ontbreekt | Gevolg |
|---|---|
| Possessions/balbezit | Geen ORtg/DRtg/Net Rating per 100. "Per 10 min" is een tijdproxy: een lineup tegen een snelle tegenstander lijkt aanvallend beter. Noem het "+/- per 10 min", nooit "rating" |
| Schoten, vrije worpen, rebounds, assists, fouten | Geen eFG%, TS%, reboundpercentages of four factors. In de afgeronde wedstrijd zitten alleen `pf/pa` per segment |
| Turnovers per speler | `tov` is van het team terwijl de speler op het veld stond (zie het commentaar in `trends/types.ts:36-41`). Nooit "turnovers van Anouk" |
| Tegenstanderlineups en hun classificatie | Geen matchup- of tegenstand-correctie |
| Tijdstempel per score | Alleen het segmenttotaal. Geen runs binnen een segment |
| `clockDown` in `CompletedGame` | De speelrichting van de klok is alleen af te leiden uit `beginSec > endSec` per segment |
| Kwaliteit van de tegenstander | Een +20 tegen een zwakke ploeg telt even zwaar. Alleen filteren op wedstrijd/competitie kan |

## C. Domeinkennis: wat is gangbaar en betrouwbaar

- **Lineup-+/- en net rating zijn gangbaar maar zeer ruisgevoelig.**
  NBA-analisten noemen honderden minuten (± 550 possessions voor de aanval en
  850 voor de verdediging) voordat een lineup-rating "stabiliseert". Raw
  lineupcijfers met weinig minuten voorspellen nauwelijks iets
  ([The Ringer](https://www.theringer.com/2023/4/13/23681148/2023-nba-playoff-preview-how-to-use-and-not-use-lineup-data),
  [BBall Index](https://www.bball-index.com/making-more-reliable-lineup-data/),
  [Squared2020](https://squared2020.com/2019/04/23/the-randomness-of-ratings/)).
  Een gangbaar antwoord is **regressie naar het gemiddelde (shrinkage)**
  ([L-RAPM, arXiv 2601.15000](https://arxiv.org/html/2601.15000v1)).
  [afleiding] Een amateurteam haalt in een seizoen zelden meer dan 60 minuten
  met één exacte lineup. Elke lineupwaarde in deze app is dus **beschrijvend
  ("wat gebeurde er"), niet voorspellend**. Duo's en trio's halen sneller
  minuten en zijn daardoor stabieler.
- **On/off** (team-+/- met versus zonder een speler) is gangbaar, maar
  verstoord door wie er met en tegen de speler speelde. In
  rolstoelbasketbal wordt dat versterkt: de classificatiesom dwingt
  combinaties af (een 4,5 speelt vaak naast een 1,0). On/off van een
  laagpunter weerspiegelt dus vooral de lineups die het puntenmaximum toelaat.
- **Rolstoelbasketbal**:
  - spelersklassen 1,0–4,5;
  - maximaal 14,0 punten op het veld (internationaal);
  - toeslagen voor vrouwen in gemengde competities;
  - vier kwarten van 10 minuten
  ([IWBF via Wikipedia](https://en.wikipedia.org/wiki/1_point_player),
  [British Wheelchair Basketball](https://britishwheelchairbasketball.co.uk/our-sport/classification/),
  [Frontiers in Physiology 2018](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2018.00568/pdf)).
  Onderzoek naar lineups op de Paralympische Spelen van Tokio vergelijkt
  "lineuptypes" naar puntverdeling. Lineups met vooral middenpunters
  (2,0–3,5) presteerden beter, vooral bij langere speeltijd. In gelijk
  opgaande wedstrijden scheidden turnovers winnaars van verliezers
  ([PMC10657994](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10657994/),
  [JOHK](https://johk.pl/?p=9671),
  [arXiv 2310.03417](https://arxiv.org/pdf/2310.03417)).
  [afleiding] Daaruit volgen twee inzichten die bij deze app passen:
  - **lineuptype/classificatieprofiel** (som, benutting van het maximum,
    aantal laag- of hoogpunters) in plaats van alleen exacte vijftallen. Dat
    groepeert kleine steekproeven tot bruikbare groepen;
  - **turnovers naast +/-**.
- De vermoeidheid van het rijden met de rolstoel maakt **minuten per kwart en
  stintlengte** relevant voor wisselbeleid [afleiding, geen bron die een norm
  geeft].
- Toegankelijkheid: kleur mag nooit de enige drager van betekenis zijn
  ([WCAG 2.1 SC 1.4.1](https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html)).
  Rood/groen is de meest voorkomende kleurenblindheidsas.

Netwerknoot: `iwbf.org` was in deze sessie niet bereikbaar, dus de
IWBF-reglementtekst is niet rechtstreeks gelezen. De cijfers hierboven komen
uit secundaire bronnen. **Neem geen IWBF-getal hard op in de code**: gebruik
de instellingen en `Segment.allowed`.

## D. Inzichtencatalogus

Afkortingen: `s` = seconden, per 10 = `x*600/s`, Data = berekenbaar uit de
bestaande segmentdata. Drempels zie §E.

| # | Inzicht | Wat het toont | Berekening | Data | Betrouwbaarheid / drempel | Nut | Moeite | Advies | Motivatie |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **+/- per lineup (5)** | Ranglijst van vijftallen op +/- per 10, met minuten | `computeLineupStats(size 5)`: `pm=onPF-onPA`, `pm*600/onSec` | ja | Laag. Drempel 5:00, minuten altijd zichtbaar, groep "te weinig data" | hoog | S | **Must** | Gevraagd. Hergebruik van bestaande totalen |
| 2 | **PF/PA per 10 per lineup** | Aanval en verdediging apart | `onPF*600/onSec`, `onPA*600/onSec` | ja | Idem #1 | hoog | S | **Must** | Laat zien waarom een lineup +/- haalt ("scoort veel" of "houdt tegen") |
| 3 | Turnovers per 10 per lineup | Bestaand | bestaand `computeLineupTurnoverRanking` | ja | Krijgt dezelfde drempel en groep (alleen presentatie) | hoog | S | **Must** (drempel toevoegen) | Consistent met #1; nu misleidend (§B.4) |
| 4 | Vergelijking met het teamgemiddelde | Per lineup Δ t.o.v. de team-+/- per 10 in dezelfde selectie | `lineupPer10 − teamPm*600/teamSec` | ja | Idem | midden | S | **Should** | Geeft context ("beter dan ons gemiddelde"), vervangt de arbitraire nul |
| 5 | Gedempte waarde (shrinkage) | Waarde "alsof de lineup nog K min gelijk speelde" | `pm*600/(onSec+K)`, K = 600 s | ja | Vermindert ruis, maar is een modelkeuze | midden | S | **Could** | Uitlegbaar en eerlijk. Pas na feedback op #1, en alleen als secundair getal of als sorteeroptie |
| 6 | **On/off per speler** | +/- per 10 met en zonder de speler, plus het verschil | `computeLineupStats(size 1)`: on/off per 10 en `on−off` | ja | Off-minuten zijn vaak klein. Drempel op beide kanten, "n.v.t." bij 0 off | hoog | S | **Should** | Bestaat al in Statistieken (grootte 1), maar daar zonder context. Hoort op de spelerkaart |
| 7 | Duo's/trio's | Beste en slechtste combinaties van 2 of 3 spelers | `computeLineupStats(size 2/3)` | ja | Beter dan 5-tallen (meer minuten). Drempel 10:00 | midden | S | **Could** | Staat al in Statistieken. In Trends alleen als top/bottom 3 boven de drempel |
| 8 | **Per kwart (team)** | +/-, PF/PA per 10 en minuten per kwart | groeperen op `segment.quarter` | ja | Redelijk (±10 min per kwart per wedstrijd) | hoog | S | **Should** | Beantwoordt "zakken we in Q4 in?" |
| 9 | Minuten per kwart per speler | Belasting en rustmomenten | som `durSec` per (speler, kwart) / aantal wedstrijden | ja | Goed (minuten zijn exact) | hoog | M | **Should** | Wisselbeleid en vermoeidheid (rolstoel) |
| 10 | Start- en sluitlineup | Prestatie van het eerste segment van Q1 en het laatste van Q4 | eerste/laatste segment per kwart, gesorteerd op kwart en verstreken tijd (§F.3) | deels | Zeer klein per wedstrijd. Alleen totaal over wedstrijden | midden | M | **Could** | Coaches vragen ernaar, maar de steekproef is minimaal |
| 11 | Stint- en wisselpatronen | Gemiddelde stintlengte per speler, aantal wissels per kwart | opeenvolgende segmenten met dezelfde speler binnen een kwart samenvoegen | deels | Een segmentgrens is niet altijd een wissel (ook een kwarteinde of een tussentijdse opslag) | midden | M | **Could** | Nuttig voor belasting. Definitie moet eerst vast (besluit H.6) |
| 12 | Classificatieprofiel | +/- per 10 per groep: "vol" (`allowed−classSum ≤ 0,5`), "ruimte" (> 0,5), "over" | uit `classSum/allowed/over` | ja, alleen als `useClassLimit` | Groepen bundelen minuten → stabieler | midden | M | **Should** (alleen met klassegrens) | Rolstoelspecifiek. Groepen zijn betrouwbaarder dan exacte lineups |
| 13 | Over-de-limiet-tijd | Minuten en segmenten met `over = true` per wedstrijd | som `durSec` waar `over` | ja | Exact | midden | S | **Should** (als datakwaliteit/regelcheck) | Internationaal is dit een technische fout. In de data is het vaak een invoerfout |
| 14 | Mix: aantal laag- en hoogpunters | +/- per 10 naar aantal spelers ≤ 1,5 of ≥ 4,0 | `parseFloat(kl)` uit de spelerssnapshot | ja (kl is een string) | Groepen. Let op: `kl` kan leeg of ongeldig zijn | laag–midden | M | **Could** | Sluit aan bij de "lineuptype"-literatuur. Hangt nauw samen met #12 |
| 15 | Laatste n wedstrijden | Snelfilter "laatste 3/5" | `gameIds` = de n nieuwste afgeronde wedstrijden | ja | n.v.t. | hoog | S | **Should** | Vormtrend. Hergebruikt het gedeelde filter (wijzigt ook Statistieken, besluit H.5) |
| 16 | "Deze wedstrijd" (courtside) | Snelfilter op de lopende wedstrijd | `gameIds = {current.id}` | ja | Zeer klein. Toon alleen minuten en +/-, geen ranglijstoordeel | hoog | S | **Should** | Het enige wat courtside bij een time-out telt |
| 17 | Consistentie over wedstrijden | Per lineup of speler: hoeveel wedstrijden positief | per wedstrijd een `pm`-teken tellen | ja | Klein n. Toon "3/5 wedstrijden +", geen SD | midden | S | **Could** | Beter leesbaar dan variantie |
| 18 | Spreiding/variantie (SD) | SD van de +/- per wedstrijd | | ja | Te weinig wedstrijden → schijnprecisie | laag | S | **Won't** | Misleidend bij n < 10 |
| 19 | Context van de stand ("clutch", stand gelijk ±5) | +/- in Q4 bij een kleine marge | cumulatieve marge vóór het segment | deels (vergt een betrouwbare volgorde) | Zeer klein | laag | M | **Won't (nu)** | Volgorde en steekproef te zwak |
| 20 | ORtg/DRtg/possessions, schoten, rebounds, TO per speler, tegenstanderlineups | | | **nee** | | – | L | **Won't** | Vergt nieuwe invoer in de live-flow, dus een datacontractwijziging |
| 21 | Datakwaliteitswaarschuwingen | PARTIAL-segmenten, segmenten van 0 s, kwarten zonder segmenten, totaal ≠ 4×10 min, wedstrijden zonder `tov` | uit de segmenten | ja | Exact | midden | S | **Should** | Voorkomt verkeerde conclusies ("Q3 ontbreekt in 2 wedstrijden") |

## E. Statistische eerlijkheid

1. **Definitie van een lineup** [advies, consistent met de bestaande code]:
   - "lineup" = exact de 5 spelers van een segment;
   - de sleutel is de **numeriek gesorteerde `rosterId`-lijst**, zoals
     `computeLineupStats` (`:104-111`) en de turnoverranglijst
     (`turnoverSummary.ts:124-127`) al doen;
   - de wisselvolgorde doet er dus niet toe: elk segment met dezelfde vijf
     telt mee in dezelfde rij, over wedstrijden heen;
   - het label bestaat uit rugnummers, oplopend (`TrendsPanel.tsx:393-396`);
   - de rugnummers komen uit de actuele roster, anders uit de nieuwste
     snapshot;
   - duo's en trio's = combinaties via dezelfde functie;
   - PARTIAL-segmenten blijven uitgesloten.
2. **Drempel**:
   - standaard `minSec = 300` (5:00) voor vijftallen, 600 voor duo's en trio's
     en voor de off-kant van on/off;
   - de coach kan de drempel kiezen via een chip: 0 / 3 / 5 / 10 min (besluit
     H.3);
   - rijen onder de drempel komen **niet** in de ranglijst, maar in een
     ingeklapte groep "Te weinig data (n)", gesorteerd op minuten aflopend.
     Daar staan het ruwe totaal (bijv. "+4 in 3:00"), **geen
     per-10-waarde** en geen toon.
3. **Altijd minuten naast elke waarde**, met hetzelfde visuele gewicht als het
   label ("9-11-13-14-15 · 6:00").
4. **Sortering**:
   - primair de getoonde waarde (per 10 boven de drempel);
   - tiebreaker 1: **minuten aflopend** (meer bewijs eerst);
   - tiebreaker 2: de canonieke sleutel.
   Dit is anders dan de huidige turnoverranglijst, die direct op de sleutel
   valt. Voor die ranglijst geldt het alleen in de nieuwe presentatielaag; de
   bestaande functie blijft ongewijzigd.
5. **Geen schijnprecisie**: één decimaal voor per 10, gehele getallen voor
   totalen. Geen percentages, geen SD, geen "significant".
6. **Toon** (beter/slechter):
   - alleen boven de drempel;
   - relatief aan het tijdgewogen teamgemiddelde van dezelfde selectie, zoals
     de bestaande turnovertoon;
   - een vierde toon "rond gemiddelde" bij |Δ| < 0,5 per 10 (besluit H.4;
     **besluit eigenaar: groen/rood met ▲ ● ▼, zie §I.4**);
   - altijd tekst of een symbool erbij (▲ beter / ▼ slechter / ● rond
     gemiddelde) plus een patroon of dikte, nooit alleen rood of groen.
7. **Vaste uitleg** onder elke lineupsectie (NL/EN): "Beschrijvend: wat
   gebeurde er met deze vijf op het veld. Minder dan 5 minuten zegt bijna
   niets. Per 10 min is geen balbezitcorrectie."
8. **Shrinkage** (Could): `pm*600/(onSec+600)`, de waarde "alsof de lineup nog
   10 minuten gelijk speelde". Alleen als secundaire waarde of sorteeroptie,
   met uitleg. Geen prior op het teamgemiddelde: dat is moeilijker uit te
   leggen en geeft lineups van een sterk team kunstmatig een plus.
9. **Per 10 en het gemiddelde van wedstrijden**: de lineupwaarden zijn
   tijdgewogen (`som pm*600 / som sec`), anders dan de v1-per-punt-regel van
   de spelertrends. Benoem dat in de code en de tests. Wijzig het
   spelertrendcontract niet.

## F. Berekeningsontwerp en vaste fixture

### F.1 Nieuwe pure functies (alle additief)

Bestand `v2/src/domain/trends/lineupInsights.ts` (nieuw):

```ts
export interface LineupRow {
  rosterIds: number[];            // gesorteerde sleutel (zoals computeLineupStats)
  seconds: number;                // onSec
  pf: number; pa: number; pm: number; tov: number;
  games: number;                  // aantal wedstrijden met ≥1 segment van deze lineup
  pmPer10: number; pfPer10: number; paPer10: number; tovPer10: number;
  dampedPmPer10: number;          // pm*600/(seconds+DAMP_SEC)
  deltaVsTeamPer10: number;       // pmPer10 − team.pmPer10
  qualified: boolean;             // seconds >= minSec
}
export interface LineupInsights {
  rows: LineupRow[];              // gekwalificeerd, gesorteerd (zie §E.4)
  belowThreshold: LineupRow[];    // seconds desc, daarna sleutel
  team: { seconds: number; pm: number; pmPer10: number | null; pfPer10: number | null; paPer10: number | null };
  partialSegments: number;
}
export type LineupMetric = 'pm' | 'pf' | 'pa' | 'tov';
export function computeLineupInsights(
  games: AnalysisGame[], gameIds: Set<string> | null,
  opts: { size: 2|3|5; minSec: number; metric: LineupMetric; limit?: number },
): LineupInsights;
export function computeOnOffImpact(
  games: AnalysisGame[], gameIds: Set<string> | null, roster: readonly RosterPlayer[], minSec: number,
): OnOffRow[]; // {rosterId,onSec,onPm,onPer10,offSec,offPm,offPer10|null,diffPer10|null,qualified}
export function computeQuarterSplits(games: AnalysisGame[], gameIds: Set<string> | null): QuarterRow[];
// {quarter, seconds, pf, pa, pm, pmPer10|null, pfPer10|null, paPer10|null, games}
export function computePlayerQuarterMinutes(...): Map<rosterId, {quarter, avgSec}[]>;
export function computeClassProfile(...): ClassBucketRow[]; // alleen games met useClassLimit
export function computeDataQualityWarnings(...): DataQualityWarning[];
```

- Hergebruik: `computeLineupStats` voor de totalen (sizes 1/2/3/5),
  `turnoverRatePer10` en `fmtSeconds`/`fmtPlusMinus`.
- Nodig: `games` (het aantal wedstrijden per lineup). Dat geeft
  `computeLineupStats` niet. Voorstel: de bestaande private
  `normalizeSegmentLineup` **alleen exporteren**, zonder
  gedragswijziging, en een kleine eigen pass doen. Zo is er geen tweede
  normalisatiepad.
- `AnalysisGame` krijgt een **optioneel** `useClassLimit?: boolean`, gevuld
  in `toAnalysisGame` en voor de actieve wedstrijd uit de instellingen. Dit is
  additief en geen opslagwijziging. Bestaande fixtures blijven geldig.
- Er komt geen nieuwe opslag, geen cache en geen CSV-veld. Alles wordt
  berekend uit de segmenten.

### F.2 Vaste fixture (fictief, handmatig narekenbaar)

Spelers (in beide wedstrijden in de snapshot): rosterId = rugnummer = 1–7
(`gp(n)`-stijl uit `turnoversTrendsCompute.spec.ts`). Lineups:
L1 = 1-2-3-4-5, L2 = 1-2-3-4-6, L3 = 1-2-3-6-7, L4 = 1-2-3-5-7.
`allowed = 14.0` in alle segmenten; `useClassLimit = true`.

| Seg | Wedstrijd (datum) | Kwart | Lineup | s | pf | pa | tov | classSum | over |
|---|---|---|---|---|---|---|---|---|---|
| A1 | A (2026-09-05) | 1 | L1 | 600 | 10 | 6 | 2 | 14.0 | nee |
| A2 | A | 2 | L2 | 420 | 6 | 8 | 3 | 13.5 | nee |
| A3 | A | 2 | L3 | 180 | 4 | 0 | 0 | 12.5 | nee |
| A4 | A | 4 | L1 | 600 | 8 | 12 | 1 | 14.0 | nee |
| B1 | B (2026-09-12) | 1 | L1 | 300 | 6 | 4 | 1 | 14.0 | nee |
| B2 | B | 1 | L2 | 300 | 4 | 4 | 2 | 13.5 | nee |
| B3 | B | 4 | L2 | 480 | 10 | 7 | 2 | 13.5 | nee |
| B4 | B | 4 | L4 | 120 | 2 | 0 | 0 | 14.5 | **ja** |

Optionele derde wedstrijd C: alleen voor filtertests, bijv.
`gameIds = {B}`. Niet nodig voor de getallen hieronder.

**Team (A+B)**: 3000 s (50:00), PF 50, PA 41, +/- +9, per 10 **+1,8**;
PF/10 10,0, PA/10 8,2; tov 11, tov/10 **2,2**.

**Lineups (size 5, minSec = 300)**:

| Lineup | s | PF | PA | +/- | +/-/10 | PF/10 | PA/10 | tov | tov/10 | games | Δ team | gedempt (K = 600) | gekwalificeerd |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| L1 | 1500 (25:00) | 24 | 22 | +2 | **+0,8** | 9,6 | 8,8 | 4 | 1,6 | 2 | −1,0 | 1200/2100 = **+0,571** | ja |
| L2 | 1200 (20:00) | 20 | 19 | +1 | **+0,5** | 10,0 | 9,5 | 7 | 3,5 | 2 | −1,3 | 600/1800 = **+0,333** | ja |
| L3 | 180 (3:00) | 4 | 0 | +4 | (13,333) | – | – | 0 | 0 | 1 | – | 2400/780 = 3,077 | **nee** |
| L4 | 120 (2:00) | 2 | 0 | +2 | (10,0) | – | – | 0 | 0 | 1 | – | 1200/720 = 1,667 | **nee** |

- Verwachte `rows` (metric `pm`): [L1, L2].
- Verwachte `belowThreshold`: [L3 (180 s), L4 (120 s)].
- Met `minSec = 0` is de volgorde L3 (13,3), L4 (10,0), L1, L2. Dit is het
  bewijs waarom de drempel nodig is.
- Controle: de som van de seconden is 3000 en de som van de +/- is +9 (gelijk
  aan het team).
- Regressie op de bestaande ranglijst (moet ongewijzigd blijven):
  `computeLineupTurnoverRanking` geeft `averagePer10 = 2,2` en de volgorde
  L4 (0, sleutel "1,2,3,5,7"), L3 (0), L1 (1,6, good), L2 (3,5, bad).

**On/off (size 1, minSec = 300 aan beide kanten)**:

| Speler | on s | on +/- | on/10 | off s | off +/- | off/10 | verschil/10 |
|---|---|---|---|---|---|---|---|
| 1, 2, 3 | 3000 | +9 | 1,8 | 0 | 0 | n.v.t. (null) | n.v.t. |
| 4 | 2700 | +3 | 0,667 | 300 | +6 | 12,0 | −11,333 (off-kant net op de drempel) |
| 5 | 1620 | +4 | 1,481 | 1380 | +5 | 2,174 | −0,692 |
| 6 | 1380 | +5 | 2,174 | 1620 | +4 | 1,481 | +0,692 |
| 7 | 300 | +6 | 12,0 | 2700 | +3 | 0,667 | +11,333 |

Testgevallen hieruit:

- verschuif de drempel naar 600: dan zijn speler 4 (off) en speler 7 (on) niet
  gekwalificeerd;
- spelers 1–3 hebben geen off-minuten, dus `offPer10 = null` en de UI toont
  "speelde alles".

**Per kwart**:

| Kwart | s | PF | PA | +/- | +/-/10 | PF/10 | PA/10 | wedstrijden |
|---|---|---|---|---|---|---|---|---|
| 1 | 1200 | 20 | 14 | +6 | +3,0 | 10,0 | 7,0 | 2 |
| 2 | 600 | 10 | 8 | +2 | +2,0 | 10,0 | 8,0 | 1 |
| 3 | 0 | 0 | 0 | 0 | null ("geen data") | null | null | 0 |
| 4 | 1200 | 20 | 19 | +1 | +0,5 | 10,0 | 9,5 | 2 |

Datakwaliteit: Q3 heeft in A en B geen segmenten, en A en B hebben elk minder
dan 2400 s → waarschuwing "kwart zonder data" en "speeltijd < 40:00".

**Minuten per kwart, speler 4**:

- Q1: A1 600 + B1 300 + B2 300 = 1200 s over 2 wedstrijden, dus gemiddeld
  600 s;
- Q2: A2 420 s, deler 2 wedstrijden (de deelnamedeler is per speler het aantal
  wedstrijden waarin hij speelde, net als bij de trends), dus 210 s;
- Q4: A4 600 + B3 480 = 1080, dus 540 s.

**Classificatieprofiel** (slack = allowed − classSum):

| Groep | segmenten | s | +/- | +/-/10 |
|---|---|---|---|---|
| over (slack < 0) | B4 | 120 | +2 | (onder drempel) |
| vol (0 ≤ slack ≤ 0,5) | A1, A2, A4, B1, B2, B3 | 2700 | +3 | +0,667 |
| ruimte (> 0,5) | A3 | 180 | +4 | (onder drempel) |

**Over de limiet**: wedstrijd B heeft 120 s in 1 segment (B4); wedstrijd A
heeft 0.

Rekenvoorbeeld voor de reviewer: L1 +/-/10 = (10−6 + 8−12 + 6−4) × 600 / 1500
= 2 × 0,4 = 0,8.

### F.3 Volgorde binnen een kwart (alleen voor #10/#11)

[feit] `CompletedGame` heeft geen `clockDown`. Een correctie (PR 7.5) mag
`quarter` en `beginSec` aanpassen, dus de arrayvolgorde is niet gegarandeerd
chronologisch [afleiding]. Voorstel: de verstreken tijd per segment is
`beginSec > endSec ? 600 − beginSec : beginSec`, en sorteren gebeurt op
(kwart, verstreken tijd, arrayindex). Dit hoort bij een aparte sub-PR met
eigen tests.

## G. Informatiearchitectuur

### G.1 Taakverdeling tussen de tabs [advies]

- **Statistieken = verkenner**: alle combinaties 1–5, de on/off-filters "moet
  op/af", ruwe ON/OFF-totalen, geen oordeel. Blijft ongewijzigd.
- **Trends = inzichten**: gerangschikt, met drempel, vergeleken met het
  teamgemiddelde, over tijd (per wedstrijd en per kwart), plus het
  spelersprofiel.
- Elke lineuprij in Trends kan later (Could) een link "Details in
  Statistieken" krijgen, die Statistieken opent met grootte 5 en die spelers
  als "moet op".
- Overweeg de tabnaam "Trends" → "Analyse" / "Analysis" (besluit H.2).

### G.2 Alternatieven

| | A. Segmentbediening (4 weergaven) | B. Eén lange pagina, inklapbare secties | C. Twee niveaus: Team / Spelers |
|---|---|---|---|
| Courtside | Eén scherm per vraag, weinig scrollen | Veel scrollen, secties raken uit beeld | Redelijk |
| Schaalbaarheid | Goed, nieuwe inzichten krijgen een eigen weergave | Wordt steeds langer | Lineups en kwarten concurreren binnen Team |
| Complexiteit | M (state voor de weergave, toegankelijke tabs) | S | M |
| Risico | Inhoud "verstopt" achter tabs | Overzicht verdwijnt | Halfslachtig |

**Aanbeveling: A**:

- een segmentbediening (`role="tablist"`, pijltjestoetsen) met Overzicht |
  Lineups | Spelers | Kwarten;
- eronder een vaste (sticky) filterbalk;
- de laatst gekozen weergave onthouden per apparaat (alleen een UI-voorkeur in
  een nieuwe, aparte key, zie besluit H.7; of geen opslag).

### G.3 Wireframes

Mobiel (±390 px), weergave **Lineups**:

```
┌──────────────────────────────────────┐
│ Trends                                │
│[Overzicht][Lineups][Spelers][Kwarten] │  ← tablist, 44px hoog
├──────────────────────────────────────┤
│ Wedstrijden (5) ▾ │ Laatste 5 │ Min 5′ │  ← sticky filterbalk
├──────────────────────────────────────┤
│ Metriek: [+/-][Voor/Tegen][TO]        │  ← segmentknoppen
│ Per 10 min · tijdgewogen · team +1.8  │
│                                       │
│ 4-9-11-13-15            25:00 · 2 wd  │
│ ▲ +0.8   │━━━━━━━━│                  │  ← divergerende balk rond 0
│ Voor 9.6 · Tegen 8.8 · TO 1.6         │
│                                       │
│ 4-9-11-13-14            20:00 · 2 wd  │
│ ● +0.5   │━━━━━│                     │
│ Voor 10.0 · Tegen 9.5 · TO 3.5        │
│                                       │
│ ▸ Te weinig data (2) — onder 5:00     │  ← ingeklapt
│   4-9-13-14-15  3:00  +4 (totaal)     │
│   4-9-11-14-15  2:00  +2 (totaal)     │
│                                       │
│ ⓘ Beschrijvend; < 5 min zegt weinig;  │
│   per 10 min ≠ per balbezit.          │
└──────────────────────────────────────┘
```

Mobiel, **Overzicht** (courtside, met het snelfilter "Deze wedstrijd"):

```
┌──────────────────────────────────────┐
│ [Deze wedstrijd][Laatste 5][Alles]    │
│ ┌────────────┐┌────────────┐          │
│ │ +/- team   ││ TO         │          │
│ │ +9 · +1.8/10││ 11 · 2.2/10│          │
│ └────────────┘└────────────┘          │
│ Beste lineup (≥5′): 4-9-11-13-15 +0.8 │
│ Zwakste kwart: Q4 +0.5/10 (20:00)     │
│ ⚠ Q3 zonder segmenten in 2 wedstr.    │
│ ⚠ 2:00 boven de klassegrens (wd B)    │
└──────────────────────────────────────┘
```

Mobiel, **Spelers** (compacte rij per speler, uitklappen geeft de huidige
kaart met grafieken):

```
│ #4 Anouk    MIN 22.5  +/- +3  on/off −11.3* ▸│
│ #6 Fictief  MIN 11.5  +/- +5  on/off  +0.7  ▸│
│ * off-kant 5:00 — net op de drempel          │
```

Mobiel, **Kwarten**: per kwart een rij met minuten, +/-/10, Voor/Tegen per
10, en daaronder een heatmap-tabel speler × kwart met gemiddelde minuten. De
getallen staan in de cellen en de kleur is alleen versterking.

Desktop (≥ 960 px):

```
┌───────────────────────────────────────────────────────────────┐
│ [Overzicht][Lineups][Spelers][Kwarten]   Wedstr.(5) Laatste5 Min5′│
├───────────────────────────────┬───────────────────────────────┤
│ Lineups (+/- per 10)          │ Lineups: Voor / Tegen / TO     │
│ ... gesorteerde rijen ...     │ ... tabel met alle kolommen ...│
├───────────────────────────────┴───────────────────────────────┤
│ Te weinig data (2) ▸                                           │
└───────────────────────────────────────────────────────────────┘
```

### G.4 Ontwerpeisen

- **Courtside**:
  - waarde ≥ 1,25 rem en vet; tikdoelen ≥ 44 px;
  - hoog contrast op het bestaande donkere thema, via de
    `--lt-color-*`-tokens en contrasttests zoals `statsTrendsTokenContrast.spec.ts`;
  - geen hover-only informatie.
- **Kleur nooit alleen**: symbolen ▲/●/▼ plus de tekst "beter/rond/slechter"
  in de toegankelijke naam. De balk onder de drempel is gearceerd of grijs.
  Bij voorkeur blauw/oranje in plaats van groen/rood (besluit H.4).
  **Besluit eigenaar (2026-10-31): groen/rood blijft, met symbolen ▲ ● ▼ en tekst
  (zie §I.4); blauw/oranje wordt niet ingevoerd.**
- **Tabelalternatief**: de rijen zijn een `<ol>` met een volledige
  toegankelijke naam per rij ("Lineup 4, 9, 11, 13, 15: plus 0,8 per 10
  minuten in 25 minuten, 2 wedstrijden, beter dan gemiddeld"). De balken zijn
  `aria-hidden`. Op desktop is er een echte `<table>`.
- **i18n**:
  - alle nieuwe teksten in NL en EN onder `trends*`-keys, met een
    pariteitscheck via `tests/unit/i18n.spec.ts`;
  - "Te weinig data" / "Too little data", "Deze wedstrijd" / "This game";
  - getalnotatie volgt de bestaande `fmtPlusMinus` (een punt als decimaal);
    niet wijzigen in deze track.
- **Offline en performance**:
  - alles wordt lokaal berekend en per `useMemo` op (scope, filter)
    gememoiseerd;
  - een berekening van grootte 2/3 alleen als die weergave open is;
  - [afleiding] 50 wedstrijden × 30 segmenten × 10 duo's ≈ 15k
    combinatie-entries. Dat is acceptabel, maar `computeLineupStats` loopt per
    combinatie over alle entries (O(combo × entries)). Meet het in de PR
    (benchmark-unit met 100 fictieve wedstrijden) en lazy-render de weergaven.

## H. Uitvoeringsplan (kleine sub-PR's, eigen branch, draft-PR)

Elke sub-PR doet het volgende:

- beschrijft de huidige werking en de risico's;
- laat bestaande berekeningen en hun tests ongewijzigd;
- raakt geen CSV- of `localStorage`-contract;
- voegt geen backend en geen tracking toe;
- laat de v2-unit-, typecheck-, lint-, format- en buildcontroles groen
  draaien.

### T1 — domein: lineup-inzichten (+/-, PF/PA, drempel) [Must]

- **Scope**:
  - `domain/trends/lineupInsights.ts` met `computeLineupInsights`;
  - export van `normalizeSegmentLineup`, zonder gedragswijziging;
  - `tests/unit/trendsLineupInsights.spec.ts` met de fixture uit §F.2.
- **Tests**:
  - alle lineupwaarden uit §F.2;
  - de drempelgrens (`seconds === minSec` telt mee);
  - de sortering met de tiebreaker minuten;
  - een lege scope;
  - PARTIAL;
  - het wedstrijdfilter;
  - de actieve wedstrijd telt mee als voorlopig;
  - **regressietest**: `computeLineupTurnoverRanking` en `computeLineupStats`
    geven exact dezelfde output als vóór de PR.
- **Risico's**: geen opslag, geen CSV, geen i18n.
- **Acceptatie**: de getallen uit §F.2 worden exact geasserteerd en er wordt
  geen bestaande test aangepast.

### T2 — UI: lineupkaart +/- en Voor/Tegen in de huidige pagina [Must]

- **Scope**:
  - in `TrendsPanel` een nieuwe kaart "Lineups: +/- per 10 min" met de
    metriekschakelaar +/- | Voor/Tegen, minuten, het aantal wedstrijden, de
    groep "te weinig data" en de toon met symbool;
  - de bestaande turnoverkaart krijgt dezelfde drempel en groep. Dit is
    presentatie: de functie blijft ongewijzigd, er wordt gefilterd in de
    viewmodel-laag `buildTrendViewModels`;
  - de chip "Min 5′".
- **Risico's**: i18n (nieuwe keys), contrast (nieuwe tokens) en bestaande
  e2e-testid's (`trends-tov-lineup-*` behouden).
- **Tests**:
  - component (Vitest + Testing Library): rijen, de ingeklapte groep, de
    toegankelijke naam en de symbolen;
  - de contrasttest voor de nieuwe toon-tokens;
  - e2e `tests/e2e/trends.spec.ts` uitbreiden met de lineupkaart, NL/EN en
    320 px. De e2e vereist de Firebase-emulator: draai die in CI.
- **Acceptatie**:
  - de lineup van 3:00 staat niet in de ranglijst;
  - minuten zijn zichtbaar;
  - geen informatie uitsluitend via kleur;
  - geen horizontale scroll op 320 px.

### T3 — herindeling: segmentbediening en sticky filterbalk [Should]

- **Scope**:
  - Overzicht | Lineups | Spelers | Kwarten (Kwarten mag eerst leeg blijven
    of verborgen tot T5);
  - de spelerkaarten worden compacte rijen die uitklappen tot de bestaande
    kaart;
  - de snelfilters "Laatste 5" en "Deze wedstrijd" (gedeelde `gameIds`,
    besluit H.5).
- **Risico's**:
  - bestaande e2e-selectors (`trends-card-*`, `trends-list`) moeten blijven
    werken, of worden bewust gemigreerd;
  - de focus- en toetsenbordvolgorde (PR 8.2-infrastructuur, axe-baseline);
  - de UI-voorkeur voor de laatst gekozen weergave: geen opslag, of een nieuwe
    aparte key (besluit H.7). Nooit een bestaande key hergebruiken.
- **Tests**:
  - component: tablist-toetsenbord, sticky balk;
  - e2e: navigatie, axe, NL/EN, 320 en 375 px, en offline (de service worker
    blijft werken).
- **Acceptatie**:
  - elke bestaande informatie blijft bereikbaar;
  - axe zonder nieuwe overtredingen;
  - de spelertrendgetallen zijn ongewijzigd.

#### Uitvoeringsnotitie T2 + T3 (gebouwd op `ccr-trends-ui1-indeling`)

- `TrendsPanel.tsx` is nu de schil (tablist + vaste filterbalk + gekozen
  weergave). Elke weergave staat in een eigen bestand in `v2/src/ui/trends/`
  (`OverviewView`, `LineupsView`, `PlayersView`, `QuartersView`) en krijgt
  dezelfde `TrendsViewProps` (zie `trendsShared.ts`), zodat vervolgstappen
  parallel één bestand kunnen uitbreiden. Elke weergave heeft gemarkeerde
  uitbreidingsplekken (`// T4: ...`, `// T5: ...`, `// T6: ...`, `// T7: ...`).
- Vertalingen staan in `v2/src/i18n/trendsStrings.ts` (spread in `strings.ts`),
  met een blok per weergave.
- Afwijkingen van het plan: de weergave Kwarten is al zichtbaar met een lege
  staat; de lineup-ranglijst en de bestaande turnoverkaart delen de drempel
  (standaard 5:00, niet opgeslagen); de spelerrijen klappen uit tot de
  bestaande kaart, dus de oude kaarttestids (`trends-totalpm-*`, ...) zijn
  pas na uitklappen aanwezig en de e2e is daarop gemigreerd.

### T4 — on/off per speler [Should]

- **Scope**: `computeOnOffImpact` + tests (§F.2 on/off), tonen in de rij en
  kaart onder Spelers, met de off-minuten en "n.v.t.".
- **Acceptatie**: spelers 1–3 tonen "speelde alles" en de drempel geldt voor
  beide kanten.

### T5 — kwarten en minuten per kwart [Should]

- **Scope**: `computeQuarterSplits` en `computePlayerQuarterMinutes` + tests,
  plus de weergave Kwarten. Het aantal kwarten volgt `quarterCount`; dat
  vergt een optioneel veld op `AnalysisGame` (additief).

### T6 — classificatie en datakwaliteit [Should, alleen met klassegrens]

- **Scope**:
  - een optioneel `useClassLimit` op `AnalysisGame`;
  - `computeClassProfile`, de over-de-limiet-tijd en
    `computeDataQualityWarnings`, met tests;
  - de waarschuwingen in Overzicht.
- **Risico**: `kl` is een string, dus ongeldige waarden moeten worden
  overgeslagen en geteld.

### T7 — optioneel (Could)

- shrinkage als sorteeroptie;
- duo's en trio's top/bottom 3;
- start- en sluitlineup;
- stintlengte (na besluit H.6 en een eigen volgordetest §F.3);
- consistentie "x/n wedstrijden +";
- een deeplink naar Statistieken.

Volgorde: T1 → T2 (levert de vraag van de eigenaar op) → T3 → T4/T5 →
T6 → T7.

## I. Besluiten (genomen door de eigenaar, 2026-10-31)

1. **Producttrack goedgekeurd:** T1 tot en met T7, inclusief de Could-onderdelen
   hieronder, met uitzondering van wat in 10 en 11 is uitgesloten.
2. **Tabnaam:** "Trends" blijft.
3. **Drempel:** standaard 5:00, gemeten als het **totaal van een lineup over alle
   gekozen wedstrijden** (niet per wedstrijd). Voor duo's, trio's en de off-kant
   van on/off 10:00. Instelbaar via een chip (uit/3/5/10 min); de keuze wordt niet
   opgeslagen. Lineups eronder staan in een uitklapmenu "Te weinig data" met het
   ruwe totaal en zonder waarde per 10 minuten.
4. **Kleuren:** **groen en rood blijven**, met ▲ ● ▼ en tekst erbij (zie de status
   bovenaan). Een toon "rond gemiddelde" bij |Δ| < 0,5 per 10 minuten blijft.
5. **Snelfilters** "Laatste n" en "Deze wedstrijd": **gedeeld filter**, dus ook
   Statistieken verandert mee. De chip maakt dat zichtbaar.
6. **Stint:** aaneengesloten tijd op het veld **binnen één kwart**.
7. **Laatst gekozen weergave onthouden:** geen opslag.
8. **Gedempte waarde (shrinkage):** alleen als **sorteeroptie**, met uitleg.
9. **Bestaande turnoverranglijst** krijgt dezelfde drempel en dezelfde groep "Te
   weinig data" (alleen presentatie; de functie blijft ongewijzigd).
10. **Klassegrens met bonus:** het team gebruikt dit, dus T6 wordt gebouwd.
    Gebruik uitsluitend `Segment.allowed`, `classSum` en `over`. Drie groepen op de
    ruimte `allowed − classSum`: **op de grens** (0 tot en met 0,5), **ruimte
    over** (meer dan 0,5), **over de grens** (kleiner dan 0).
11. **Mix van laag- en hoogpunters (#14):** nu niet.
12. **Uitvoering:** elke stap als aparte branch, daarna een Opus-review met
    Sonnet-fixes, daarna bundelen in één PR naar `main` (één productiebuild).

## Status bundel

Gebouwd (branch-per-stap, daarna Opus-review en Sonnet-fixes; één bundel-PR):

- T1 domein: lineup-inzichten (+/-, PF/PA, drempel); T2 lineupkaart met +/- en
  Voor/Tegen; T3 segmentbediening Overzicht | Lineups | Spelers | Kwarten met
  sticky filterbalk (per 10 min, Wedstrijden (n), drempel, snelfilters "Laatste 5"
  en "Deze wedstrijd" op het gedeelde wedstrijdfilter); T4 on/off per speler;
  T5 kwarten en minuten per kwart; T6 classificatieprofiel, tijd over de limiet en
  datakwaliteit; T7 (Could-onderdelen volgens §I).
- Review-fixes set A: het gedeelde wedstrijdfilter wordt na afronden, weggooien of
  verwijderen opgeschoond (`sanitizeGameSelection` + `useSanitizedGameIds`, in
  Trends én Statistieken; `handleFinishGame` vertaalt de selectie meteen); de
  uitleg bij "Deze wedstrijd" is zichtbaar en toetsenbord-bereikbaar
  (`aria-disabled` + zichtbare hint); het classificatieprofiel hangt niet meer af van
  de huidige instelling `useClassLimit` maar van `classLimitGames > 0`.

Open punten:

- **Prestatie bij zeer veel wedstrijden** is niet gemeten (alle inzichten worden in
  de browser herberekend bij elke filterwijziging).
- **De hoge sticky filterbalk op 320 px** moet nog op een echte telefoon worden
  beoordeeld (neemt veel schermhoogte in).
- **Dubbele turnovercijfers bij PARTIAL-segmenten**: bij segmenten met een
  onvolledige lineup (PARTIAL) komen twee turnovercijfers voor die niet gelijk zijn;
  nog te beoordelen of dit uitleg of een aparte regel nodig heeft.
- **`classSum = 0` telt als ruimte** (allowed − classSum is dan het volle `allowed`):
  segmenten zonder ingevulde klassesom komen daardoor in "ruimte over".

## J. Open vragen en risico's

- **Misleiding blijft mogelijk**, ook met een drempel: 5 minuten is
  statistisch nog steeds ruis (§C). De uitleg en de minuten moeten altijd
  zichtbaar blijven.
- **Tempo/pace**: "per 10 min" bevoordeelt lineups in snelle wedstrijden.
  Dat is niet op te lossen zonder possessions (Won't #20).
- **Volgorde van segmenten** na een correctie (PR 7.5) is niet gegarandeerd.
  Dat raakt alleen #10, #11 en #19.
- **IWBF-regels** zijn niet rechtstreeks geverifieerd (`iwbf.org` niet
  bereikbaar in deze sessie). Het plan leunt bewust op de instellingen en
  `Segment.allowed`.
- **Performance** bij veel wedstrijden en combinatiegrootte 2/3: meten in
  T1/T7.
- **e2e** vereist de Firebase-emulator (zoals bij eerdere PR's); verificatie
  loopt via CI.
- Open vraag aan de eigenaar: speelt het team met klassegrens aan
  (`useClassLimit`) en met welke grens en toeslagen? Dat bepaalt of T6 nut
  heeft.
- Open vraag: hoeveel wedstrijden per seizoen en hoeveel unieke vijftallen
  zijn er typisch? Een export of screenshot met fictieve namen helpt om de
  standaarddrempel te kiezen.

Bronnen (domeinkennis; er is geen data van derden overgenomen):

- The Ringer — lineupdata: <https://www.theringer.com/2023/4/13/23681148/2023-nba-playoff-preview-how-to-use-and-not-use-lineup-data>
- BBall Index — betrouwbaardere lineupdata: <https://www.bball-index.com/making-more-reliable-lineup-data/>
- Squared2020 — ruis in ratings: <https://squared2020.com/2019/04/23/the-randomness-of-ratings/>
- L-RAPM (shrinkage met priors): <https://arxiv.org/html/2601.15000v1>
- Women's WB-lineupanalyse, Tokio 2020: <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10657994/>
- Lineuptypes in Paralympisch mannen-WB: <https://johk.pl/?p=9671>
- Datagedreven teamsamenstelling WB: <https://arxiv.org/pdf/2310.03417>
- Classificatie (secundair): <https://en.wikipedia.org/wiki/1_point_player>,
  <https://britishwheelchairbasketball.co.uk/our-sport/classification/>,
  <https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2018.00568/pdf>
- WCAG 2.1 SC 1.4.1 Use of Color: <https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html>

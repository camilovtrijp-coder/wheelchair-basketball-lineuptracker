# Bouwplan — wedstrijdscherm "Rustig" en wisselflow-verbeteringen

Bron: testbevindingen en mockup van 16 november 2026 (test op staging, Snel-scherm
met Wisselschema). De registratie klopte; de knelpunten zitten in de bediening
tijdens de wedstrijd. Dit plan vertaalt de checklist uit dat document naar
afgebakende PR's, met de technische besluiten die nodig zijn.

Uitgangspunt van de eigenaar: Klassiek, Compact en Snel blijven ongewijzigd
bestaan. "Rustig" komt erbij als vierde variant (deel 1). Gedragswijzigingen
die voor alle varianten gelden, staan in deel 2.

## 0. Voorwaarde

Afgerond: Snel staat op `main` (PR #143, squash-merge 9 november 2026,
inclusief de fixes voor de wisseltijd van het lopende blok en voor "Wedstrijd
afronden"). Rustig hergebruikt de wielen, schemakaart en `rotationPlan` van
Snel. Alle branches hieronder starten vanaf `main`.

## 1. Technische kern: "eerst wisselen, tijd achteraf"

Huidige werking: een wissel (`confirmSwap` → `commitSegment`) legt het open
segment vast met een `endSec`. De duur moet groter zijn dan 0, en de punten
tot dat moment gaan naar de oude lineup. Het volgende segment begint op
diezelfde `endSec`.

Besluit (geen wijziging aan het datacontract):

- **Wissel uitvoeren** legt het segment direct vast met een *voorlopige*
  eindtijd. De score- en turnovertoewijzing klopt meteen, alleen de tijd is
  voorlopig.
- Voorlopige tijd: de geplande wisseltijd uit het schema als die er is.
  Anders de tijd van de vorige wissel + 1:00, begrensd tot het einde van het
  kwart. Let op: letterlijk "de tijd van de vorige wissel" geeft een duur van
  0 s, en die weigert het domein.
- **Tijd bevestigen** (−10 s / +10 s / typen / "Klopt") past via de bestaande
  `segment-edited`-actie de `endSec` van dat segment aan, en tegelijk de
  `beginSec` van het open segment. Dat gebeurt in één nieuw domeincommando
  `confirmSwapTime` met grenzen: het segment moet langer dan 0 s duren en de
  tijd moet vóór de huidige tijd liggen.
- Welke segmenten nog een onbevestigde tijd hebben, is UI-toestand van dit
  apparaat. Die komt onder een eigen nieuwe localStorage-key (patroon van
  `rotationPlanStore`) en dus niet in `ActiveGame`, CSV of de cloud. Gevolg:
  een tweede apparaat ziet de voorlopige tijd als gewone tijd. Dat is
  acceptabel, want er is maar één schrijver.
- Meerdere onbevestigde wissels kunnen op een rij staan. De kaart toont dan
  "2 tijden nog bevestigen", oudste eerst. Bevestigen kan op elk moment
  (spelonderbreking, time-out). Bij **Einde kwart** vraagt de app de open
  bevestigingen eerst (met "Klopt allemaal" als snelle uitweg). Na de
  wedstrijd hoeft er dus niets meer open te staan.
- Typen: een `mm:ss`-invoer naast het wiel, omdat het wiel in stappen van
  30 s werkt.

### Wissel met terugwerkende kracht (besluit eigenaar)

Voor een wissel die je pas later opmerkt. Je kiest de kloktijd in het verleden
waarop de wissel echt plaatsvond. De app toont de scores en turnovers die
sinds de vorige wissel zijn ingevoerd, in de volgorde van invoer. Je tikt de
grens aan: wat ervoor lag, telt voor de oude lineup; wat erna kwam, voor de
nieuwe.

Technisch is dit een gesplitst `commitSegment`: één segment met de oude
lineup over [begin, gekozen tijd] met de gekozen deel-pf/pa/tov. Daarna loopt
het open segment verder met de nieuwe lineup. Een kloktijd voor scores is er
niet (de actie-`at` is een wandkloktijd), daarom kies je de grens in de lijst.
Er is geen datacontractwijziging nodig.

Risico's: tijdsvolgorde over meerdere voorlopige segmenten, het afsluiten van
het kwart met open bevestigingen, en herladen tijdens een open bevestiging.
Alle drie krijgen unit-tests op domeinniveau.

## 2. Ongedaan maken

Eén knop naast Turnover draait de laatste live actie terug:

| Laatste actie | Terugdraaien |
|---|---|
| score-delta | tegengestelde `score-delta` |
| turnover-delta | tegengestelde `turnover-delta` |
| wissel (segment-saved) | `segment-deleted` + `onCourt` en `beginSec` terug naar vóór de wissel |

Het actielog is append-only. Ongedaan maken voegt dus een compenserende actie
toe en verwijdert niets. Voor de wissel moet worden geverifieerd dat
`deriveGameHistory` na `segment-deleted` de segmentstartstand goed terugzet;
dat krijgt een eigen test vóór de UI-bouw.

Besluit eigenaar: **alleen de laatste actie**. Na een terugdraaiing gaat de
knop uit tot er een nieuwe actie is. De melding zegt wat er is teruggedraaid
(bijv. "Wissel Frank ↔ Henk teruggedraaid"). Dieper corrigeren gaat via
Segmenten.

## 3. PR-volgorde

Elke PR is een eigen sessie en branch, met NL- en EN-teksten en gerichte unit-
en e2e-tests.

| PR | Inhoud | Deel/checklist |
|---|---|---|
| R0 | Snel mergen naar `main`: **afgerond** (PR #143) | voorwaarde |
| R0b | Snel: Wisselschema als eerste knop in de schakelaar. Het scherm opent op het schema tot het eerste segment is vastgelegd, daarna (ook na herladen) op Wedstrijd. Afgeleid uit `segments.length`, geen nieuwe opslag. Rustig neemt hetzelfde gedrag over in R2. | besluit 8 |
| R1 | Domein: `confirmSwapTime`, `undoLastAction`, wissel met terugwerkende kracht, opslag van onbevestigde tijden + tests. Geen UI. | 2, 3 |
| R2 | Variant "Rustig" (vaste slot-indeling, schemakaart/hulpkaart/tijdkaart in één slot, klassesom onder bankspelers, waarschuwen-maar-toestaan, bottombar "Segmenten (n)" + "Einde kwart", ongedaan-knop). Vierde optie in de schakelaar, `parseGameScreen` uitgebreid. | 1, 3, 4, 5, 7 |
| R3 | Bevestigscherm bij start van elk kwart (veld / schema / zelf samenstellen, verschillen gemarkeerd, klassesom per optie). `closeQuarter.nextOnCourt` bestaat al, dus vooral UI. Per variant inpassen. | 8 |
| R4 | Wisselschema: "Schema wissen", bevestiging bij "Zelfde als vorige wedstrijd" en "Rest van het schema aanpassen" (met overzicht van de wijzigingen), Starters-blok aanpasbaar, plan naast uitvoering. | 9 |
| R5 | Statistieken: lopende lineup live bovenaan ("lopend · voorlopig"), per 10 min naast het totaal (er bestaat al een per10-schakelaar voor turnovers; nu naast elkaar tonen), "zonder hen" met eigen tijdsbasis, markering bij weinig minuten (< 5:00). Eerst handmatig narekenbare tests. | 10 |
| R6 | Opruimen: "Segment verwijderen" apart zetten en laten bevestigen, na herladen terug naar de lopende wedstrijd (nu `useState<Tab>('settings')` in `App.tsx`), V/F-notatie gelijktrekken, HTTP 400 onderzoeken (eerst reproduceren). | 11 |
| R7 | Speeltijd per speler als aan/uit-optie in Rustig. Geen "Vorige vijf" (besluit eigenaar). | 6 |
| R8 | Lineup-overzicht na de wedstrijd: per lineup lengte, +/- en TO, in het formaat van het game plan (klassesom met F/J-bonus). Afgeleid uit bestaande segmenten, alleen weergave. | extra |

R1 → R2 is het kritieke pad voor de volgende wedstrijdtest. R3 t/m R6 zijn
onafhankelijk van R2 en kunnen parallel lopen, mits ze niet in dezelfde
bestanden komen (R3 raakt alle varianten, dus niet tegelijk met R2).

## 4. Aandachtspunten per variant (deel 2)

- **Compact** heeft al "lineup kiezen bij kwart afsluiten" (commit 99c811d).
  R3 sluit daarop aan en vervangt het niet.
- **Klassiek en Compact** zijn niet getest. Bij R3 en R6 per variant nagaan of
  de bevinding daar ook speelt, zonder layoutwijzigingen buiten het nodige.

## 5. Besluiten (Q&A 16 november 2026)

1. Voorlopige tijd buiten het schema: **vorige wissel + 1:00**, begrensd tot
   het einde van het kwart.
2. Tijd bevestigen: **bij een spelonderbreking, in een time-out of bij einde
   kwart**. Einde kwart vraagt alle open tijden.
3. Ongedaan maken: **alleen de laatste actie**.
4. Vergeten wissel: **wissel met terugwerkende kracht** (zie §1).
5. Uitvallers (5 fouten, blessure): **geen markering**; de coach onthoudt dit
   zelf.
6. Drempel "weinig minuten": **5:00**.
7. Extra's in deze ronde: **speeltijd per speler** (R7) en **lineup-overzicht
   na de wedstrijd** (R8). Niet nu: "Vorige vijf", wake lock, offline-status,
   assistent op een tweede apparaat.
8. Wisselschema eerst (Snel en Rustig): **eerste knop in de schakelaar**. Het
   scherm opent erop **tot het eerste segment**, daarna op Wedstrijd.

## 5b. Wedstrijdscenario's (testbasis voor R1–R3)

Deze scenario's komen terug als e2e-tests met fictieve spelers. Het game plan
van de eigenaar (drie lineups met klassesom en F/J-bonus, schema per kwart)
dient als model voor de vorm, niet voor de namen.

| # | Scenario | Verwacht gedrag |
|---|---|---|
| S1 | Wissel volgens schema op de geplande tijd | Eén tik "Wissel uitvoeren"; tijd = schematijd, meteen bevestigd |
| S2 | Wissel volgens schema, maar eerder of later | Voorlopig op schematijd; bijstellen met −10s/+10s/typen |
| S3 | Andere speler dan gepland ("Frank voor Henk") | "Eerst aanpassen", klassesom onder de bankspelers, voorlopige tijd |
| S4 | Twee tot vijf spelers tegelijk in een time-out | Meerdere wissels in één concept, één segmentgrens |
| S5 | Verplichte wissel (blessure, stoelpech, 5 fouten) waardoor de klassegrens wordt overschreden | Waarschuwen, maar wel toestaan |
| S6 | Twee wissels snel na elkaar, nog geen tijd bevestigd | Kaart "2 tijden nog bevestigen", volgorde blijft geldig |
| S7 | Verkeerde speler ingetikt | Ongedaan maken zet de vorige vijf en segmentstart terug |
| S8 | Score te laat ingevoerd, na de wissel | Ongedaan maken van de wissel, of correctie via Segmenten |
| S9 | Wissel vergeten, minuten later opgemerkt | Wissel met terugwerkende kracht, scoregrens kiezen |
| S10 | Einde kwart met open tijdbevestigingen | Eerst bevestigen of "Klopt allemaal", daarna het keuzescherm (R3) |
| S11 | Nieuw kwart met een andere lineup dan het schema | Keuzescherm veld / schema / zelf samenstellen |
| S12 | Verlenging | Zelfde flow; het schema heeft geen blok, dus de voorlopige tijd wordt vorige wissel + 1:00 |
| S13 | App herladen of offline midden in een kwart | Wedstrijd opent weer, open tijdbevestigingen blijven staan |

## 6. Niet in scope

- Geen testmodus (besluit eigenaar). De testwedstrijd "TEST 2 (claude,
  verwijderen)" verwijdert de eigenaar zelf.
- Geen wijziging aan het CSV-contract, bestaande localStorage-keys of
  statistiekberekeningen zonder narekenbare tests.
- Wisselschema blijft lokaal op het apparaat.

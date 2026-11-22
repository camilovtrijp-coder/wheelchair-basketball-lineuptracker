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

## 7. Uitvoering: alles klaarzetten voor review

Werkwijze: elke PR bouwt een eigen Sonnet-sessie in een eigen worktree en
branch. De reviewsessie (Opus) controleert elke oplevering tegen dit bouwplan.
Gevonden punten gaan terug naar dezelfde bouwsessie, die ze oplost. Daarna
opent de bouwsessie een **draft-PR**. Er wordt niets gemerged of gedeployed
zonder akkoord van de eigenaar.

### Golven

| Golf | PR's | Basis-branch | Waarom |
|---|---|---|---|
| 0 | R0b | `main` | Klein, door de reviewsessie zelf gebouwd |
| 1 | R1, R4, R5, R6, R8 (parallel) | `main` | Raken verschillende bestanden |
| 2 | R2 | branch van R1 (gestapeld) | Rustig gebruikt het domein van R1 |
| 3 | R3, daarna R7 | branch van R2 (gestapeld) | R3 raakt alle varianten; R7 zit in Rustig |

Gestapelde PR's (R2 op R1, R3/R7 op R2) wijzen in GitHub naar de branch eronder.
Zo laat elke PR alleen zijn eigen wijziging zien. Na het mergen van de
onderliggende PR wordt de basis `main`.

### Afspraken per bouwsessie

1. Lees `AGENTS.md`, `README.md` en dit bouwplan:
   `git show origin/feature/wisselschema-eerst:docs/wedstrijdscherm-rustig-bouwplan.md`,
   zolang R0b nog niet op `main` staat.
2. Bouw alleen de eigen PR uit §3, met de besluiten uit §5 en de relevante
   scenario's uit §5b als tests. Gebruik fictieve spelers.
3. Raak geen bestaande localStorage-keys, het CSV-contract of
   statistiekberekeningen zonder handmatig narekenbare tests. Teksten in NL en EN.
4. Draai `tsc -b`, `eslint .`, `vitest run` en de relevante Playwright-specs
   in `v2/`.
5. Commit op de eigen branch en push. Rapporteer de gewijzigde bestanden,
   testresultaten en open risico's. Open nog geen PR; dat gebeurt na de review.
6. Twijfel over scope of een datacontract: stoppen en de vraag melden, niet
   zelf beslissen.

### Ochtendcheck voor de eigenaar

- Overzicht in de reviewsessie: per PR de status (gebouwd, gereviewd,
  draft-PR open, of vastgelopen) en de punten die een besluit nodig hebben.
- Per draft-PR: de CI-status in GitHub, en een Netlify-preview als die voor
  PR's aanstaat.
- Golf 2 en 3 starten pas na de review van de golf ervoor. Afhankelijk van
  de bouwtijd staan die 's ochtends mogelijk nog open.

## 8. R9 — scorebediening (Rustig)

**Wat.** Aanpassingen aan het scherm Rustig en aan de opzetpagina, op basis van een door de eigenaar goedgekeurde interactieve mockup:

- **Ongedaan maken is uit Rustig verwijderd** (knop en "ongedaan"-link in de melding). Het wordt vervangen door **−1**: een vierde, smallere knop naast +1/+2/+3 bij beide scores (gewone `score-delta` van −1; uit bij 0) en een eigen −1 naast Turnover (`turnover-delta` van −1; uit als het segmentaantal 0 is). De −1-knoppen hebben in beide thema's witte tekst op een donkere knop (donker: `surface-alt`, licht: `muted`; alleen bestaande tokens). Een verkeerde wissel of score corrigeer je voortaan via Segmenten. De domeinfuncties (`undoLastAction`, `lastUndoableAction`, de undo-blokkade in `swapFlowStore`) en de andere schermen blijven ongewijzigd; alleen de ongebruikte Rustig-teksten zijn vervallen.
- **Turnover** is weer rood (turnover-token), ca. 48 px hoog, met het aantal van het **huidige segment** op de knop (`game.turnovers - game.segStartTurnovers`). Het label "dit segment" heeft geen opacity (contrast in het lichte thema); de rij heeft iets lucht tot "Huidige vijf" (mockup).
- **Regel "Dit segment"** onder de stand, uit `openSegmentSummary` (ongewijzigd).
- **Balk "Huidige vijf"** toont ook het kwart (`Q{n}`); de statistiekregel houdt +/-, TO (rood) en klassesom.
- **Melding na een wissel** staat in het vaste vak (slot, `role="status"`) onder de vijf, niet meer in een eigen regel. Er is dus geen lege ruimte meer tussen Turnover en "Huidige vijf". De melding staat alleen in de rustige stand van het vak (waar anders de hint staat): hulpkaart, wisselkaart, tijdkaart en schemakaart gaan altijd voor, zodat je direct na een wissel de tijd kunt bevestigen ("eerst wisselen, tijd achteraf"). Na Klopt blijft de melding kort staan; hij verdwijnt 8 seconden na de wissel, na een tik erop, of zodra je een score of turnover invoert.
- **Scorekeuzelijst**: tik op het cijfer opent onder de twee scorekaarten een raster 0 t/m `MAX_SCORE` (150), met de huidige score gemarkeerd en in beeld. Kiezen zet de score via `setScore` (een `score-set`; het open segment verwerkt het verschil) en sluit de lijst. Sluiten kan ook met "Sluiten", Escape of buiten tikken. Toegankelijk als listbox (`aria-haspopup`, `aria-expanded`, `role="option"`, `aria-selected`, één tabstop op de huidige optie, focus naar de huidige optie en terug naar het cijfer, pijltjestoetsen). Alleen-lezen: alle knoppen uit.
- **Uitwedstrijd verhuist naar de opzetpagina** (schakelaar bij Tegenstander/Competitie, met korte uitleg). Rustig heeft geen eigen schakelaar meer en leest de voorkeur alleen. Het is dezelfde lokale voorkeur als in Snel en Compact (`compactAwayPreference.ts`, per apparaat en wedstrijd-ID, nooit op `ActiveGame`). Snel en Compact houden hun eigen schakelaar op het wedstrijdscherm.

**Waarom.** Besluit van de eigenaar na een interactieve mockup: een −1 naast elke teller is directer dan één niveau Ongedaan maken, en de turnover-teller per segment en de segmentregel tonen wat er in het open segment staat zonder naar Segmenten te gaan.

**Geen wijziging** aan datacontract, CSV, localStorage-keys of statistiekformules. De −1-knop in Rustig gebruikt dezelfde score-delta als Snel.

**Opmerking.** De opzetpagina bewaart een niet-gestarte wedstrijd niet over een herlaadmoment (v1-pariteit); na herladen hoort de schakelaar dus bij een nieuw wedstrijd-ID. Vanaf het starten blijft het ID gelijk.

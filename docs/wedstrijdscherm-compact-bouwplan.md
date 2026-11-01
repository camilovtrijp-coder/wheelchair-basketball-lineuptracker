# Bouwplan voor Claude — compact wedstrijdscherm

Datum: 1 november 2026. Status: overdracht en uitvoeringsvoorstel; productcode nog niet geïmplementeerd.

## Start hier

Lees achtereenvolgens `AGENTS.md`, `README.md`, `docs/IMPLEMENTATION_PLAN.md`, dit document, ADR-000 en de relevante actuele productcode/tests. Werk uitsluitend in deze afzonderlijke v2-repository. De productie-repository valt volledig buiten scope. Werk niet op main en behandel één hieronder afgebakend werkpakket per sessie/PR.

De eigenaar heeft het compacte ontwerp interactief beoordeeld en vraagt nu om dit bouwplan voor latere uitvoering door Claude. Dit document geeft geen opdracht tot merge, deployment, hostingwijzigingen of productie-cutover. Bij wijziging van datacontract of architectuur eerst een besluit vragen. Koppel het werk bij implementatie aan de bestaande roadmap: verbetering van PR 6.2/6.3, te valideren binnen 8.4. Claim niet dat bestaande acceptatiepoorten daarmee gesloten zijn.

## Besluiten eigenaar en reviewbevindingen (1 november 2026)

Na een Opus-review tegen de code (`3ff1aa5`) heeft de eigenaar onderstaande besluiten genomen. Waar de rest van dit document hiervan afwijkt, gelden deze besluiten.

| # | Onderwerp | Besluit |
| --- | --- | --- |
| 1 | Klokgrens | Maximaal 10:00 (0–600 s) afdwingen in de gedeelde functies en Compact. Klassiek wordt in dezelfde PR gelijkgetrokken (nu staat live 10:59 toe). |
| 2 | Segmentpunten | Weigeren: punten per kant 0–150 en eindstand niet onder de beginstand van het segment. Geldt ook voor bewerken. |
| 3 | Wissel op 0 s | Weigeren met melding als de stand is gewijzigd; anders blijft de bestaande semantiek (geen leeg segment). Open turnovers gaan bij zo'n wissel naar de nieuwe lineup (bewuste keuze, te testen in C2b). |
| 4 | Afronden met open punten/turnovers | Waarschuwen en keuze laten: laatste segment vastleggen of bewust afronden. Geldt voor Klassiek en Compact. |
| 5 | Uitwedstrijd | Lokaal per wedstrijd-ID, per apparaat, onder één nieuwe foutbestendige key. Geen wijziging van wedstrijdobject, datacontract of sync. |
| 6 | Wisselconcept | Alleen UI-state. Bij herladen vervalt het concept; de huidige lineup blijft actief. Klassiek houdt zijn bestaande opgeslagen `pendingSwapLineup`. |
| 7 | Schakelaar Klassiek/Compact | Apparaatmenu (SessionBar, patroon van `infrastructure/theme/theme.ts`), ook voor scorers; alleen-lezen blijft alleen-lezen. Niet in het opgeslagen formulier van `SettingsPanel`. |
| 8 | Werkpakketten | Herindeling C1, C2a, C2b, C3, C4 (zie onder). |

Reviewbevindingen die het plan corrigeert:

- Er zijn geen use-cases voor live registratie; `application/game/usecases.ts` bevat alleen `getActiveGame` en `saveActiveGame`. De logica zit in de handlers van `LiveTrackingPanel.tsx`.
- De claim "tijd maximaal 10:00" in `functiebehoud.md` klopt niet voor de live-flow (10:59 mogelijk; alleen `correction.ts` dwingt 0–600 af).
- `finishGame` neemt open punten mee in de eindscore, open turnovers niet.
- `handleFinishGame` in `App.tsx` leest `game` uit een oude closure; "laatste segment vastleggen en afronden" kan het laatste segment missen. Dit is uit de code afgeleid en moet in C3 met een test worden bevestigd. Oplossing: afronden met meegegeven actuele gamestand.
- "Kwart afsluiten" is geen domeinactie (segment opslaan plus kwartkeuze in één overgang) en rondt nooit automatisch af, ook niet in het laatste kwart (de mockup doet dat wel).
- Begin- en eindstand per segment worden niet opgeslagen; definieer ze als cumulatieve som van `pf`/`pa` in arrayvolgorde, consistent met `recalcRunningScore`.
- Lineupvolgorde bij wissels volgt `swapOnCourt` (positie behouden), niet achteraan toevoegen zoals de mockup.
- Sla een score-actie zonder waardeverandering over (geen overbodige actie of sync).
- De mockup gebruikt `window.openai.setWidgetState`, arrayindex voor bewerken en hardgecodeerde vier kwarten; deze zijn uitdrukkelijk uitgesloten als gedragsbron.

## Referenties en herkomst

- Interactieve testsite: https://lineup-wedstrijd-testdemo.camilovt.chatgpt.site/
- Vastgelegde referentie: Sites-versie **6**, broncommit `0985efefdd2a1bb3ae1ef019b2dd71b780246455` van de aparte demo, geverifieerd met Sites op 1 november 2026.
- Site-ID: `appgprj_6ae70aeef7d08191a7bf6df0a79d4875`.
- Versie-ID: `appgprj_6ae70aeef7d08191a7bf6df0a79d4875~appgver_47cc6c9622308191b203e5703a00969e`.
- Vastgelegde bestanden: [referentie-uitleg](references/wedstrijd-compact-v6/README.md), [zelfstandig te openen demo](references/wedstrijd-compact-v6/demo.html), [leesbare mockupbron](references/wedstrijd-compact-v6/mockup.html).
- [Functiebehoud](references/wedstrijd-compact-v6/functiebehoud.md).

De URL kan later wijzigen. Bij afwijkingen geldt de vastgelegde versie als ontwerpgrondslag; actuele v2-domeincontracten blijven leidend voor data en berekeningen. Beide demo-bestanden bevatten uitsluitend fictieve spelers. Gebruik geen screenshots met echte spelersdata in Git.

## Huidige werking en risico's

Beoordelingsbasis van de v2-code: `origin/main` op `3ff1aa52bb75be6320b3034298f378fa2bd804d3` (PR #139). De lokale werkbranch kan ouder zijn. Controleer bij start de actuele v2-main en diff; bouw niet blind op de huidige werkbranch.

`LiveTrackingPanel.tsx` combineert scoreknoppen, turnovers, vloer/bank, wisselbevestiging, tijdvelden, segmentlijst en bewerken. `tracking.ts` leidt score en segmenten af uit acties. Bij wisselen bewaart `pendingSwapLineup` de oude lineup; bevestiging sluit daarmee het segment. Bewerken/verwijderen herberekent de score met behoud van open scoredelta's en turnovers. `finish.ts` maakt een CompletedGame; de bestaande application/App-flow verzorgt opslag en sync.

Belangrijkste risico's: score aan de verkeerde lineup toekennen; open wijzigingen verliezen bij schermwisseling; gedeeltelijke score-/segmentopslag; ongewenste wijziging van CSV of synccontract; verschil tussen klassiek en compact; ontbrekende NL/EN-teksten. Behoud localStorage-keys, Nederlandse CSV, berekeningen, offline PWA, rol-/writerbeveiliging en bestaande opslagfoutmeldingen. Geen nieuwe backend of netwerkpad.

## Gewenste bediening

### Hoofdscherm

1. Toon vijf actieve spelers compact naast elkaar, met rugnummer en naam. Op tablet mag de inhoud ruimer zijn; op telefoon blijven namen en acties leesbaar zonder horizontale scroll. Classificatiesom, bonus/categorieën en overschrijdingswaarschuwing moeten beschikbaar blijven.
2. Toon kwart/periode en begintijd van de actieve lineup. Gebruik de ingestelde periodenaam, periodeaantal en klokrichting.
3. Toon turnovers van het open segment prominent; wedstrijdtotaal secundair. +1 en correctie blijven direct bereikbaar.
4. Toon compacte stand met een kleine checkbox/schakelaar Uitwedstrijd. Uit: eigen team links. Aan: tegenstander links. Draai uitsluitend presentatie/invoervolgorde om; `for`/`against`, CSV en plus/min blijven aan het eigen team gekoppeld.
5. Stand bijwerken, Wisselen, Kwart/periode afsluiten en Segment opslaan zonder wissel zijn beschikbaar. Behoud bestaande +1/+2/+3/−1-scorebediening, eventueel via een compact uitklapbaar bedieningsdeel.
6. Omdat stand ook pas bij een segmentgrens wordt ingevoerd: label tussentijdse stand als laatst vastgelegd; presenteer een afgeleide plus/min niet als actueel als de score niet is bijgewerkt. Geen automatisch lopende stopwatch toevoegen.

### Wisselen

1. Open een concept; toon Eruit en Erin als grids van vijf kolommen, met rugnummer en naam. Bankspelers boven vijf lopen door naar de volgende rij.
2. Ondersteun meerdere wissels op één tijdstip, selectie opheffen en annuleren. De huidige lineup blijft actief totdat bevestigd is. Gebruik bestaande snapshot-/hervatsemantiek; introduceer geen tweede persistent wedstrijdmodel.
3. Vraag resterende kloktijd bij aftellen, gespeelde kloktijd bij optellen. Minuten en seconden zijn aparte numerieke velden. Rechts in ieder veld staat een dropdown met scrollbare waarden. Zowel typen als kiezen werkt; seconden worden als twee cijfers getoond. Verberg geen noodzakelijke validatiefouten.
4. Ook eigen score en tegenstanderscore hebben typen plus dropdown. Gebruik de **actuele v2-grenzen** (beoordelingsbasis: MAX_SCORE=150, minuten maximaal 10), niet de 999 uit de demo.
5. Controle toont beginstand, eindstand, punten van het segment, eigen turnovers, begin/eind en duur. Onder de titel **Nieuwe lineup** staan de vijf voorgestelde spelers met rugnummer én naam.
6. Opslaan en bevestigen sluit het oude segment af en activeert de nieuwe lineup op dezelfde tijd/stand. Turnovers van het nieuwe segment beginnen op 0; het wedstrijdtotaal blijft behouden.
7. Bij nul seconden: bestaande v2-semantiek behouden; geen leeg segment toevoegen. Bij ongeldige tijd/score/selectie geen gedeeltelijke commit.
8. Bij annuleren blijven score/lineup/segmenten gelijk aan vóór openen; eventueel al vóór openen geregistreerde acties blijven behouden.

### Segmenten en afronden

- Toon kwart, begin/eind, duur, lineup, begin/eindstand, segmentpunten, plus/min en turnovers.
- Kleine knop **Bewerken** direct naast kwart en tijden, op dezelfde kopregel. Houd een bruikbaar touchdoel; laat de rij op zeer smalle schermen netjes omlopen.
- Bewerken ondersteunt kwart, begin/eind, precies vijf spelers, punten voor/tegen en turnovers. Verwijderen vraagt bevestiging. Gebruik bestaande segment-ID's en edit/delete-acties, geen arrayindex als productidentiteit.
- Herbereken score en turnovers via bestaande functies; behoud delta's van het open segment. Wijzig tijdgrenzen van andere segmenten of actuele lineup niet stilzwijgend na historische correctie.
- Onder het segmentoverzicht staat **Wedstrijd afronden**, ook bereikbaar als het overzicht is ingeklapt.
- Bied vóór afronden de keuze laatste segment vastleggen of bevestigen dat alle gespeelde tijd al vastligt. Signaleer nog niet in een segment opgenomen punten/turnovers. Leid uit gelijke score niet af dat er geen ongeregistreerde speeltijd is.
- Gebruik de bestaande finish-, CompletedGame-, historie- en syncflow. Geen aparte demo-opslag, nieuwe afrond-ID's of directe Firestore-writes vanuit de UI. Behoud validatie, bevestiging, opslagfouten, herstel/retry en bescherming tegen dubbele afronding. Toon pas succes als het bestaande opslagpad dit toestaat; onderscheid lokale opslag en cloudsynchronisatie.

## Klassiek / Compact

Voorgestelde tijdelijke instelling: Instellingen → Wedstrijdscherm → Klassiek / Compact (NL/EN). Klassiek blijft aanvankelijk standaard. Per apparaat bewaren, nooit als wedstrijdveld of cloudinstelling. Gebruik de bestaande lokale UI-voorkeurenvoorziening als die past; anders één afzonderlijke, getypeerde en foutbestendige voorkeurskey, zonder bestaande keys te wijzigen. Ongeldige/ontbrekende voorkeur valt terug op Klassiek.

Beide schermen gebruiken dezelfde ActiveGame, use-cases, repository en synccoordinator. Geen kopieën van wedstrijden of wederzijdse migratie. Schermwisseling alleen als geen onbevestigde wissel, modalbewerking of afrondactie actief is; laat eerst bevestigen/annuleren. Alleen-lezen blijft in beide schermen alleen-lezen. Herladen moet dezelfde wedstrijd hervatten.

## Technische aanknopingspunten

Controleer deze paden op actuele main vóór implementatie:

- `v2/src/ui/game/LiveTrackingPanel.tsx` — klassiek scherm, bestaande guards en segmenteditor.
- `v2/src/app/App.tsx` — aansturing wedstrijd, afronden, toegang en sync.
- `v2/src/domain/game/{types,tracking,finish}.ts` — model, grenzen, reducers, segment- en finishlogica.
- `v2/src/application/game/` — use-cases en repository/coordinator-ports.
- `v2/src/ui/settings/`, `v2/src/i18n/strings.ts`, `v2/src/styles/` — instelling, vertalingen, stijl.
- `v2/tests/unit/gameTracking.spec.ts`, `gameFinish.spec.ts`, `gameRepository.spec.ts`.
- `v2/tests/e2e/game-tracking.spec.ts`, `game-history.spec.ts`, `game-sync-local-mode-no-network.spec.ts`, relevante a11y/mobile- en `e2e-auth`-tests.

Nieuwe Compact-component en gedeelde controls mogen worden toegevoegd binnen ADR-000. Hergebruik pure domeinfuncties; kopieer geen demo-reducer of demo-CSS als applicatiearchitectuur. Score invoeren + segment opslaan moet via één coherente state-overgang op de laatste game-state gebeuren; geen opeenvolgende callbacks op een verouderde snapshot. Respecteer bestaande pending-writes en single-writer-guards.

## Kleine werkpakketten — één per sessie/PR

1. **C1 — gedeelde functies (pure extractie).** Geen zichtbare wijziging, geen instelling. Nieuwe pure, geteste functies in `domain/game` (of `application/game`), zoals `commitSegment(game, {endSec, scoreFor?, scoreAgainst?, newOnCourt?})`, `closeQuarter` en `discardSwaps`, door Klassiek gebruikt. Bevat besluiten 1–3 (klokgrens 0–600, punten 0–150 en niet onder beginstand, 0-secondenwissel met scorewijziging weigeren) en de afleiding van begin-/eindstand. Unit-tests op de rekenvoorbeelden A–F. Score invoeren + segment opslaan gebeurt in één state-overgang op de laatste game-state.
2. **C2a — compact hoofdscherm.** Vijf spelers, kwart/begintijd, turnovers, stand bijwerken, Uitwedstrijd (lokaal per wedstrijd-ID). Nog niet selecteerbaar.
3. **C2b — wissel- en segmentdialoog plus instelling.** Begeleide meervoudige wissels, tijd-/scoredropdowns, losse segmenten, kwart afsluiten (nooit automatisch afronden). Pas hier de schakelaar Klassiek/Compact in het apparaatmenu (standaard Klassiek, key volgens het patroon van `theme.ts`, schermwisselguard). Compact is pas hier selecteerbaar.
4. **C3 — correcties en afronden.** Compact segmentoverzicht/editor/verwijderen op segment-ID, afrondwaarschuwing voor open punten/turnovers (beide schermen), App-wijziging voor afronden met actuele gamestand en terugkoppeling van het opslag-/syncresultaat, zonder regressie van Klassiek. Een afgeronde wedstrijd is achteraf te corrigeren via de correctieflow van PR 7.5/7.6; gebruik die, geen eigen pad.
5. **C4 — acceptatie.** Pariteit, mobiele/a11y-, offline- en relevante syncchecks; daarna praktijkproef op Android telefoon en tablet. Pas na eigenaarbesluit Compact standaard maken; Klassiek verwijderen is een afzonderlijke taak.

Aanvullend te raadplegen tests: `LiveTurnovers.spec.tsx`, `turnoverTracking.spec.ts`, `AppFinalizeResume.spec.tsx`, `AppWriterClaim.spec.tsx`, `e2e/mobile.spec.ts`, `e2e/a11y-*.spec.ts`, `e2e/i18n.spec.ts` en `e2e-auth/game-sync-offline-reconnect`, `-live-viewer` en `-claim-conflict`.

Begin elke sessie met huidige werking, risico's en klein plan. Eindig met gewijzigde bestanden, exact geteste commit, resultaten en open risico's. Maak geen merge-/deployclaims op basis van alleen een PR-beschrijving of deze demo.

## Handmatig narekenbare acceptatie

Fictieve spelers: #4 Alex, #7 Sam, #9 Robin, #11 Kim, #13 Dani; bank #6 Bo, #12 Noa, #15 Jules. Vergelijk scenario onafhankelijk in Klassiek en Compact, niet door beide schrijvers tegelijk dezelfde wedstrijd te laten aanpassen.

| Stap | Actie | Verwachting |
| --- | --- | --- |
| A | Start Q1 aftellend 10:00, lineup 4/7/9/11/13, stand 0–0 | Zelfde uitgangstoestand |
| B | Registreer 2 turnovers; bij 6:30 stand 8–6; wissel 7→12 | Oud segment: 210 s, 8–6, +2, TO 2; nieuwe lineup 4/9/11/13/12, TO 0 |
| C | Bij 3:00 stand 12–10, TO 1; wissel 4→6 en 11→15 samen | Segment: 210 s, 4–4, 0, TO 1; één segment voor beide wissels |
| D | Sluit Q1 op 0:00, stand 16–12, TO 0 | Segment: 180 s, 4–2, +2, TO 0; totaal 600 lineupseconden, 3000 spelerseconden, +4, TO 3 |
| E | Open Q2: voeg 2 eigen punten en 1 TO toe; bewerk eerste segment naar 9–6, TO 3 | Totaal 19–12, TO 5; open delta +2 en open TO 1 blijven behouden |
| F | Verwijder in afzonderlijke test het eerste segment na D | Totaal 8–6, +2, TO 1; resterende tijden/lineups ongewijzigd |
| G | Uitwedstrijd aan/uit, NL/EN, beide invoermethoden | Alleen presentatie omgedraaid; eigen plus/min, CSV en opslag identiek |
| H | Rond af met laatste segment; open de details in Historie en corrigeer achteraf via de correctieflow (PR 7.5/7.6) | Geen ontbrekend/dubbel segment; identieke score, tijden, TO en stats |

Aanvullend verplicht: nulsecondeswissel, annuleren na meerdere keuzes, minuten/seconden buiten bereik, absolute scorecorrectie, opgetelde klok, classificatieoverschrijding, ontbrekende `tov` als 0, toetsenbord/focus, opslagfout en read-only. Test 375×667 en circa 320px breed, plus tablet; geen horizontale scroll of onbereikbare acties. Test offline volledige wedstrijd en herladen vóór/na wisselbevestiging; reconnect mag geen dubbele acties/afronding geven. Test terugschakelen na Compact-wijzigingen en opnieuw laden.

Gebruik de actuele scripts uit `v2/package.json`: unit, lint, format:check, build en relevante Playwright-suites; voer emulatorafhankelijke checks met de bestaande testinfrastructuur uit. Op Windows vereist `SW_BUILD_TARGET=classic` in de build een geschikte shell/ondersteunde aanpak; een shellfout is geen geslaagde build. Leg niet-uitgevoerde controles expliciet vast.

## Startprompt voor Claude

> Lees AGENTS.md, README.md, docs/IMPLEMENTATION_PLAN.md en docs/wedstrijdscherm-compact-bouwplan.md. Open de gelinkte testsite of de vaste lokale demo als gedragsreferentie. Vergelijk eerst de actuele v2-code met het plan. Stel de concrete uitvoering van alleen werkpakket C1 (gedeelde functies, geen zichtbare wijziging) voor en benoem de afhankelijkheid van C2b voordat Compact selecteerbaar wordt. Behoud domein-, opslag-, CSV-, offline- en synccontracten. Bouw nog geen andere werkpakketten en merge of deploy niets. Rapporteer eventuele verschillen of noodzakelijke besluiten vóór implementatie.

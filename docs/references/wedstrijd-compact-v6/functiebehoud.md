# Functiebehoud wedstrijdregistratie

Gecontroleerd op 1 november 2026 tegen de opgehaalde `origin/main` van de afzonderlijke v2-repository (`3ff1aa5`). Bronnen: `v2/src/ui/game/LiveTrackingPanel.tsx`, `v2/src/domain/game/tracking.ts` en `v2/tests/e2e/game-tracking.spec.ts`. Dit is een broncodevergelijking, geen volledige regressietest van de v2-app.

## Werkend in de aangepaste testdemo

- Actieve vijf spelers, eigen team/tegenstander en thuis/uit-volgorde.
- Turnovers toevoegen en corrigeren, afzonderlijk voor open segment en wedstrijdtotaal.
- Meerdere wissels samen kiezen, annuleren en bevestigen met kloktijd en stand.
- Vorige lineup opslaan bij wisselen; eindtijd wordt begintijd van het volgende segment.
- Los segment opslaan zonder wisselen en kwart afsluiten.
- Minuten en seconden apart invoeren, met numeriek telefoontoetsenbord; seconden 0–59 en tijd maximaal 10:00 (demo). Let op: de bestaande live-UI van v2 laat nu 10:59 toe; per eigenaarbesluit wordt 10:00 de grens, zie het bouwplan.
- Segmentoverzicht met lineup, kwart, begin/eind, duur, scores, plus/min en turnovers.
- Segment achteraf bewerken: kwart, begin/eind, vijf spelers, punten voor/tegen en turnovers.
- Segment verwijderen na bevestiging.
- Bij bewerken/verwijderen totalen opnieuw berekenen; punten en turnovers van het open segment behouden. Een historische tijdcorrectie verandert niet automatisch de tijden van andere segmenten of de actieve lineup, overeenkomstig de bestaande bewerkflow.
- Nederlandse en Engelse labels.

## Verplicht behouden bij implementatie in de echte v2-app

De demo is een interactieprototype. Onderstaande bestaande mogelijkheden zijn geen volledige functionaliteit van de demo en mogen bij implementatie niet verdwijnen:

- Score +1/+2/+3, −1-correctie en absolute score-invoer met bestaande grenswaarden.
- Speler selecteren vanaf vloer óf bank; selectie opheffen en wissels terugdraaien.
- Wissel op nul seconden zonder leeg segment (in de demo vereisen nieuwe segmenten nu een positieve duur).
- Configureerbare periodes en op-/aftellende klok; begin- en eindtijd kunnen corrigeren. De demo gebruikt vier aftellende kwarten van tien minuten.
- Classificatie, categorieën/bonus, toegestane limiet en waarschuwingen, ook bij segmentbewerking. De demo heeft uitsluitend fictieve spelers zonder classificatieconfiguratie.
- Wedstrijd afronden volgens de bestaande validatie en bevestiging, historie, statistieken en trends.
- Nederlandse CSV-kolommen en betekenis, back-ups, bestaande opslagkeys en opgeslagen wedstrijden.
- Offline gebruik, herladen/hervatten, PWA en bestaande cloudsync/single-writer-beveiliging.
- Alleen-lezenbediening en zichtbare foutmelding bij mislukte opslag.
- Toetsenbordbediening, focusbeheer en bruikbaarheid op telefoon en tablet.

> Notitie (eigenaarsbesluit 9/10, bouwplan): in het Compact-scherm van v2 vervallen de score-knoppen +1/+2/+3/−1 en de score-dropdowns van het hoofdscherm; de stand wordt alleen via de dialogen (Segment opslaan, Wisselen, Kwart afsluiten) bijgewerkt. De lijst 'Verplicht behouden' geldt daarom voor Klassiek; Compact dekt de scoreinvoer via de dialogen (typen en dropdown, grenzen 0–150).

## Acceptatie voor een toekomstige v2-PR

Gebruik de bestaande v2-tests als regressiebasis. Voeg handmatig narekenbare scenario's toe voor meerdere gelijktijdige wissels, nulsecondeswissel, scorecorrectie vóór/na opslaan, segmentbewerking en -verwijdering met open scoredelta, op-/aftellen, kwartovergang, classificatie, NL/EN, thuis/uit en offline herladen. Valideer dezelfde score, turnovers, speeltijd, plus/min en CSV vóór en na de wijziging.

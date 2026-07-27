# Lineup Tracker

Een mobiele, offline bruikbare lineuptracker voor teamsporten met wisselspelers en segmenten (kwarten/helften/periodes). De tracker registreert per segment:

- de spelers op het veld (standaard 5);
- begin- en eindtijd;
- punten voor en tegen;
- plus/minus;
- speeltijd per speler;
- optioneel: classificatiesom, bonus en toegestane klassegrens (instelbaar, standaard uit);
- een vaste lineupcode voor herkenning in bv. Airtable.

## Tabbladen

Onderin de app zitten vijf tabbladen:

- **Team** — alleen de spelerslijst: rugnummer, naam en (indien gewenst) classificatie/categorieën. Sorteert automatisch op rugnummer. Hier kun je geen wedstrijd starten; dat kan alleen op Wedstrijd.
- **Wedstrijd** — vóór de wedstrijd: kies per speler uit de teamlijst of die "meedoet" met deze wedstrijd (een speler die niet meedoet blijft gewoon in de teamlijst staan, maar is niet selecteerbaar als starter/bank), wie start, vul de tegenstander en eventueel de competitie/toernooi in, en start de wedstrijd. Tijdens de wedstrijd: score, wissels, segmenten vastleggen. "Wedstrijd afronden" slaat de wedstrijd op in de geschiedenis en start een nieuwe, lege wedstrijd (iedereen doet dan weer standaard mee); "Alleen CSV exporteren" exporteert zonder af te ronden.
- **Stats** — lineup-combinatiestatistieken (1 t/m 5 spelers) met +/- terwijl de combinatie op/af de vloer stond, optioneel genormaliseerd per 10 minuten, met filters op wedstrijd (met tegenstander/competitie erbij) en op spelers (verplicht op/af de vloer).
- **Trends** — per speler die minstens één keer meespeelde: gemiddelde speeltijd en +/- per wedstrijd, een lijngrafiek van het +/- per wedstrijd en een staafgrafiek van de speeltijd per wedstrijd (chronologisch, inclusief de lopende wedstrijd als voorlopig laatste punt), plus een lijst per wedstrijd. Ook hier is +/- optioneel per 10 minuten te bekijken. Wedstrijden waarin een speler niet meedeed tellen niet mee voor die speler.
- **Historie** — overzicht van afgeronde wedstrijden (met datum en competitie/toernooi indien ingevuld); tik voor het segmentoverzicht en CSV-export van die wedstrijd, of verwijder een wedstrijd.

## Starten

Open `index.html` in een moderne browser (lokaal, of via de gepubliceerde Netlify-URL — zie hieronder). Er is geen installatie, server of externe afhankelijkheid nodig.

1. Stel via het instellingenscherm (⚙, rechtsboven) je teamnaam, logo, kleuren, aantal periodes en — indien gewenst — het klassegrens-systeem in.
2. Voer op het tabblad Team de spelers en rugnummers in (de lijst start leeg; er staat geen teamdata in de broncode).
3. Ga naar het tabblad Wedstrijd: zet spelers die niet meedoen op "niet meedoen", kies eventueel precies vijf starters (zonder selectie worden de vijf laagste rugnummers van de deelnemende spelers gekozen) en vul de tegenstander in.
4. Start de wedstrijd.
5. Registreer scores, wissels en speeltijden per segment.
6. Rond de wedstrijd af — deze komt dan in Historie te staan en de combinatiestats op Stats worden bijgewerkt.

De interface is beschikbaar in het Nederlands en Engels; wissel via de taalknop (EN/NL) rechtsboven. De CSV-export blijft altijd Nederlands, om compatibel te blijven met de voorbeeld-Airtable-importworkflow (zie Documentatie hieronder).

## Instellingen

Via het instellingenscherm is per team/klant aanpasbaar:
- Teamnaam en logo
- Primaire kleur en accentkleur (tegenstander)
- Aantal periodes en de naam daarvan (bv. "Kwart", "Helft", "Periode")
- Of het klassegrens-/bonussysteem gebruikt wordt, en zo ja: de labels en getallen daarvan

Instellingen worden apart van de wedstrijdstatus opgeslagen en overleven een taalwissel of een nieuwe wedstrijd.

## Gegevensopslag

De actuele wedstrijd, de spelerslijst, de instellingen én de afgeronde wedstrijden (geschiedenis) worden opgeslagen in `localStorage` van de gebruikte browser. Daardoor kan een onderbroken wedstrijd op hetzelfde apparaat en in dezelfde browser worden hervat, en blijven eerdere wedstrijden bewaard voor Historie en Stats.

Let op: de gegevens verdwijnen wanneer browseropslag wordt gewist. Er worden geen gegevens naar een externe server verzonden — er is dus ook geen synchronisatie tussen coaches of apparaten.

Maak daarom regelmatig een back-up: instellingenscherm (⚙) → "Exporteer alle data" downloadt één JSON-bestand met spelerslijst, instellingen en wedstrijdgeschiedenis. Via "Importeer back-up" zet je zo'n bestand weer terug (overschrijft alle huidige data op dat toestel na bevestiging) — handig bij een nieuw toestel of na een gewiste browseropslag.

## Publicatie (Netlify)

Bij elke push naar `main` wordt `index.html` automatisch gepubliceerd via Netlify (zie `netlify.toml` — de repo blijft privé, alleen het HTML-bestand wordt gepubliceerd). De gepubliceerde site bevat geen teamdata — spelersnamen, classificaties en teaminstellingen worden door elke gebruiker zelf ingevoerd en blijven lokaal in de browser van dat toestel.

## Documentatie

[docs/airtable-import-workflow.md](docs/airtable-import-workflow.md) is een **voorbeeld**-workflow voor het koppelen van de CSV-export aan een eigen Airtable-base (met placeholder-ID's, niet aan een specifieke klant gebonden).

## Privacy

De tracker zelf bevat geen spelersdata of teaminstellingen in de broncode — die vult elke gebruiker zelf in en blijven lokaal op dat toestel. Als je zelf een eigen Airtable-koppeling (of vergelijkbare integratie) opzet op basis van de voorbeeld-documentatie, houd je eigen interne aantekeningen daarover (met echte base-ID's en spelersdata) apart en privé.

## Testing

De applicatie wordt functioneel gedekt door Playwright end-to-end tests op basis van een lokale HTTP webserver.

### Testcommando's

```bash
# Draai alle e2e-tests in headless mode
npm run test:e2e

# Draai e2e-tests in de interactieve Playwright UI
npm run test:e2e:ui
```

De testsuite controleert automatisch 10 scenario-groepen (teamopzet, score & segmenten, wissels, segmentcorrectie, historie, stats, trends, back-up/herstel, en instellingen/taal). Alle tests maken uitsluitend gebruik van fictieve testdata.


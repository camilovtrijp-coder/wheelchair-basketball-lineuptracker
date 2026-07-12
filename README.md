# ROBA Stats Tracker

Een mobiele, offline bruikbare lineuptracker voor wedstrijden van ROBA. De tracker registreert per segment:

- de vijf spelers op het veld;
- begin- en eindtijd;
- punten voor en tegen;
- plus/minus;
- speeltijd per speler;
- classificatiesom, bonus en toegestane klassegrens;
- een vaste lineupcode voor herkenning in Airtable.

## Starten

Open `index.html` in een moderne browser. Er is geen installatie, server of externe afhankelijkheid nodig.

1. Controleer de spelers, rugnummers en classificaties.
2. Selecteer eventueel precies vijf starters. Zonder selectie worden de vijf laagste rugnummers gekozen.
3. Start de wedstrijd.
4. Registreer scores, wissels en speeltijden per segment.
5. Rond de wedstrijd af en kopieer de export voor verwerking in Airtable.

## Gegevensopslag

De actuele wedstrijd wordt opgeslagen in `localStorage` van de gebruikte browser. Daardoor kan een onderbroken wedstrijd op hetzelfde apparaat en in dezelfde browser worden hervat.

Let op: de gegevens verdwijnen wanneer browseropslag wordt gewist. Er worden geen gegevens naar een externe server verzonden.

## Documentatie

De interne workflow voor verwerking van de export in Airtable staat in [docs/airtable-import-workflow.md](docs/airtable-import-workflow.md).

## Privacy

De tracker en documentatie bevatten spelersnamen, classificaties en andere teaminformatie. Houd de repository privé en beperk toegang tot personen die deze gegevens nodig hebben.

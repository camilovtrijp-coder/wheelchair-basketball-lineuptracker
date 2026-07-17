# Lineup Tracker

Een mobiele, offline bruikbare lineuptracker voor teamsporten met wisselspelers en segmenten (kwarten/helften/periodes). De tracker registreert per segment:

- de spelers op het veld (standaard 5);
- begin- en eindtijd;
- punten voor en tegen;
- plus/minus;
- speeltijd per speler;
- optioneel: classificatiesom, bonus en toegestane klassegrens (instelbaar, standaard uit);
- een vaste lineupcode voor herkenning in bv. Airtable.

## Starten

Open `index.html` in een moderne browser (lokaal, of via de gepubliceerde Netlify-URL — zie hieronder). Er is geen installatie, server of externe afhankelijkheid nodig.

1. Stel via het instellingenscherm (⚙, rechtsboven) je teamnaam, logo, kleuren, aantal periodes en — indien gewenst — het klassegrens-systeem in.
2. Voer de spelers en rugnummers in (de lijst start leeg; er staat geen teamdata in de broncode).
3. Selecteer eventueel precies vijf starters. Zonder selectie worden de vijf laagste rugnummers gekozen.
4. Start de wedstrijd.
5. Registreer scores, wissels en speeltijden per segment.
6. Rond de wedstrijd af en kopieer de export voor verdere verwerking (bv. in Airtable).

De interface is beschikbaar in het Nederlands en Engels; wissel via de taalknop (EN/NL) rechtsboven. De CSV-export blijft altijd Nederlands, om compatibel te blijven met de voorbeeld-Airtable-importworkflow (zie Documentatie hieronder).

## Instellingen

Via het instellingenscherm is per team/klant aanpasbaar:
- Teamnaam en logo
- Primaire kleur en accentkleur (tegenstander)
- Aantal periodes en de naam daarvan (bv. "Kwart", "Helft", "Periode")
- Of het klassegrens-/bonussysteem gebruikt wordt, en zo ja: de labels en getallen daarvan

Instellingen worden apart van de wedstrijdstatus opgeslagen en overleven een taalwissel of een nieuwe wedstrijd.

## Gegevensopslag

De actuele wedstrijd en de instellingen worden opgeslagen in `localStorage` van de gebruikte browser. Daardoor kan een onderbroken wedstrijd op hetzelfde apparaat en in dezelfde browser worden hervat.

Let op: de gegevens verdwijnen wanneer browseropslag wordt gewist. Er worden geen gegevens naar een externe server verzonden.

## Publicatie (Netlify)

Bij elke push naar `main` wordt `index.html` automatisch gepubliceerd via Netlify (zie `netlify.toml` — de repo blijft privé, alleen het HTML-bestand wordt gepubliceerd). De gepubliceerde site bevat geen teamdata — spelersnamen, classificaties en teaminstellingen worden door elke gebruiker zelf ingevoerd en blijven lokaal in de browser van dat toestel.

## Documentatie

[docs/airtable-import-workflow.md](docs/airtable-import-workflow.md) is een **voorbeeld**-workflow voor het koppelen van de CSV-export aan een eigen Airtable-base (met placeholder-ID's, niet aan een specifieke klant gebonden).

## Privacy

De tracker zelf bevat geen spelersdata of teaminstellingen in de broncode — die vult elke gebruiker zelf in en blijven lokaal op dat toestel. Als je zelf een eigen Airtable-koppeling (of vergelijkbare integratie) opzet op basis van de voorbeeld-documentatie, houd je eigen interne aantekeningen daarover (met echte base-ID's en spelersdata) apart en privé.

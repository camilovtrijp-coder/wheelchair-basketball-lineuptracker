# Papieren scoreformulier (back-up bij uitval van de app)

Een afdrukbaar A4-formulier (liggend) om een wedstrijd op papier bij te houden, zodat
je het achteraf in de app kunt invoeren. Het formulier volgt het segmentmodel van de app:
één regel = één segment (vijf spelers, begin- en eindklok, punten voor/tegen, turnovers).

- `scoreformulier.pdf` — direct afdrukbaar: 1 voorblad + 3 logbladen (48 segmenten).
- `scoreformulier.html` — bron; open in een browser en print (liggend, A4, schaal 100%).
  Meer logbladen nodig? Print de logbladen opnieuw of pas `PAGES` in het script aan.

Het formulier bevat alleen lege velden: geen spelers- of klantgegevens. Het raakt de app,
`localStorage` en het CSV-contract niet. Het PDF-bestand is gegenereerd uit de HTML; maak het
opnieuw met Chromium/Playwright (`page.pdf({ format: 'A4', landscape: true, preferCSSPageSize: true })`)
na een wijziging in de HTML.

## Invullen

1. Voorblad: tegenstander, datum, aantal periodes, klokrichting en spelers (rugnummer, naam,
   evt. klasse). Kruis "Doet mee" en de vijf starters aan.
2. Logblad: begin een regel zodra een opstelling op het veld komt. Bij elke wissel of einde
   periode sluit je de regel met de eindklok; de nieuwe regel begint op diezelfde tijd.
3. Noteer scores per kant en tel ze aan het eind van de regel op naar **Voor** en **Tegen**.
   **Eindstand** is de cumulatieve stand en dient als controle.

## Overnemen in de app

Tabblad **Wedstrijd**: kies dezelfde spelers en starters en voer per regel opstelling,
Begin/Eind, punten voor/tegen in en tik **Segment opslaan**. Corrigeren kan via
**Segment bewerken**. Vergelijk de eindstand in de app met die op papier voordat je afrondt.

# Papieren scoreformulier (back-up bij uitval van de app)

Een afdrukbaar A4-formulier (liggend) om een wedstrijd op papier bij te houden, zodat
je het achteraf in de app kunt invoeren. Het formulier volgt het segmentmodel van de app:
één regel = één segment (vijf spelers, begin- en eindklok, begin- en eindstand, turnovers).

- `scoreformulier.pdf` — direct afdrukbaar: 1 voorblad + 1 logblad (18 segmenten).
- `scoreformulier.html` — bron; open in een browser en print (liggend, A4, schaal 100%).
  Meer segmenten nodig? Print het logblad opnieuw of pas `PAGES`/`ROWS` in het script aan.

Het formulier bevat alleen lege velden: geen spelers- of klantgegevens. Het raakt de app,
`localStorage` en het CSV-contract niet. Het PDF-bestand is gegenereerd uit de HTML; maak het
opnieuw met Chromium/Playwright (`page.pdf({ format: 'A4', landscape: true, preferCSSPageSize: true })`)
na een wijziging in de HTML.

## Invullen

1. Voorblad: tegenstander, datum, aantal periodes, klokrichting en spelers (rugnummer, naam,
   evt. klasse). Kruis "Doet mee" en de vijf starters aan.
2. Logblad: begin een regel zodra een opstelling op het veld komt. Bij elke wissel of einde
   periode sluit je de regel met de eindklok; de nieuwe regel begint op diezelfde tijd.
3. Noteer de **begin stand** en **eind stand** (wij – zij) per regel; de begin stand is de eind
   stand van de regel erboven. Turf turnovers in het grote TO-vak.

## Overnemen in de app

Tabblad **Wedstrijd**: kies dezelfde spelers en starters en voer per regel opstelling,
Begin/Eind en punten voor/tegen (eind stand min begin stand) in en tik **Segment opslaan**. Corrigeren kan via
**Segment bewerken**. Vergelijk de stand in de app met je laatste eind stand op papier voordat je afrondt.

# ROBA Wedstrijd-Import Workflow — naslagdocument

> Dit document is zelfstandig leesbaar: het is bedoeld om te gebruiken in een ander Claude-project (bv. "coach/trainer ROBA") zonder de oorspronkelijke chatgeschiedenis erbij. Laatste update: 5 juli 2026.

## 1. Doel

Een nieuwe wedstrijd — geëxporteerd vanuit `roba-tracker.html` — volledig en gecontroleerd verwerken in de Airtable-base **"ROBA Statistieken 2026-2027"**, inclusief lineup-herkenning over wedstrijden heen.

## 2. Vereiste toegang

- Airtable MCP-connector moet actief zijn in de Claude-omgeving waar dit gebruikt wordt.
- Base-ID: **`appAwImm9clLyZn7y`**
- **Controleer bij aanvang altijd eerst met `list_tables_for_base` of onderstaande veld-IDs nog kloppen** — dit document kan verouderen als er sindsdien handmatig velden zijn toegevoegd/gewijzigd in Airtable.

## 3. Tabellen en belangrijkste veld-IDs (peildatum 5 juli 2026)

### Wedstrijden — `tblXOQwBG8WeTH1VW`
| Veld | ID | Type |
|---|---|---|
| Naam | fldgEXkjo1mJovWSL | tekst (primair) |
| Datum | fld9v80uKi8hNSLHx | date |
| Tegenstander | fldnk8cO9ultzBmqW | tekst |
| Punten voor | fldIyQFYHJRkOnxbW | number |
| Punten tegen | fldbwSDE1UO1cBklm | number |
| Scoreverschil, Resultaat | fld5GpQCvYvOyeFBX, fldgbUUvJ9p2orVBv | formule (automatisch) |
| Totaal lineup-minuten, Totaal speler-minuten | fldZ7UvQFPh02vKfr, fldUOO7LPQIHV0mgG | rollup (automatisch) |
| Aantal spelerregels (nieuw) | fldWP5L1jXFSsezt0 | count (automatisch) |
| Punten Rollup (from Wedstrijdstatistieken) | fld1o3nHIdvEYPW8c | rollup = COUNTA van ingevulde Punten (automatisch) |
| Lineup-minuten check, Speler-minuten check, Punteninvoer status, Wedstrijddata status | fldWlnIrkPdTxlx0v, fldZF3b9L9IvwOvUZ, fldar5gaZNkpY9fKJ, fldi14f9xHrihJGEV | formule (automatisch) |

⚠️ Er staat ook nog een **oud, kapot veld "Aantal spelerregels"** (fldFqrCylvYBVqEoW, type formule) dat systematisch fout rekent (geeft "1" i.p.v. het echte aantal). Niet gebruiken — gebruik "Aantal spelerregels (nieuw)".

### Opstellingen — `tblhz6oBdyoHNmGcD`
| Veld | ID | Type |
|---|---|---|
| Naam | fldOY4eKAWpgkJp0E | tekst (primair) — vrij invulbaar label, bv. "Q1a: Speler #nr \| Speler #nr \| ..." |
| Tijd op vloer (min) | fldjXmaJFuXoWmCad | number |
| Punten voor / tegen | fldOP0g0q9mS3kt3Y / fldNB8vd9pDAtGWCv | number |
| Spelers | fld8FiZHMYTe492Na | link → Spelers (5 spelers) |
| Wedstrijd | fldpd3G2Lk1gm894T | link → Wedstrijden |
| Lineup | fldNTwZRSpxsArXlZ | link → Lineups |
| Lineup code | fldi2hcWbgfREc8fB | tekst, bv. "0-7-8-11-15" (rugnummers oplopend, `-` gescheiden) |
| +/-, Som classificatie, Som bonus, Effectieve bonus, Toegestane grens, Binnen klassegrens?, +/- per minuut, Datakwaliteit, Punten voor/tegen per minuut, +/- per 10 minuten, Lineup advies, Analysewaarde | diverse | formule/rollup (automatisch) |

### Wedstrijdstatistieken — `tblL04VIhBFH2afCA`
| Veld | ID | Type |
|---|---|---|
| Statregel | fldSN2kpzJK84FIjH | tekst (primair), bv. "Voornaam Achternaam — Wedstrijdnaam" |
| Punten | fldZbjKjL58Nm6J4f | number — **leeg laten tot boxscore binnen is, NOOIT leeg laten als iemand écht 0 scoorde (zie §6)** |
| Speeltijd (min) | fldbnxwXhCTqVhw98 | number |
| Speler | fldriKVSfaOvNk8ER | link → Spelers |
| Wedstrijd | fldjeqYWdxEv3Fxy7 | link → Wedstrijden |
| Punten per minuut, Puntenstatus, Speeltijd %, Speeltijd categorie, Scorend rendement | diverse | formule (automatisch) |

### Lineups — `tbl76emTM3OgqSBin`
| Veld | ID | Type |
|---|---|---|
| Lineup naam | fldFA35qvNFJt4glW | tekst (primair) — vrije tekst, huidige conventie: opstellingsnaam overnemen uit Opstellingen |
| Spelers | fld7JyuCn2NzKc2uP | link → Spelers (5 spelers) |
| Lineup code | fldJaHVjlvlKQFIUa | tekst — **canonieke identiteit, zelfde format als Opstellingen.Lineup code** |
| Opstellingen | fldnDYKFMOZwfQRMm | link (inverse, komt automatisch mee) |
| Totaal minuten, Totaal punten voor/tegen, Totaal +/-, Som classificatie, Som bonus | rollups | automatisch, sommeert over alle gekoppelde Opstellingen/Spelers |
| Aantal stints, Aantal spelers | counts | automatisch |

### Spelers — `tbl7gMVANRpO3vnuP`
Bevat: Naam, Rugnummer, Classificatie, Geslacht, U19 (jeugdbonus), Bonus (formule), Weergavenaam (tracker). **Rugnummer is de sleutel voor Lineup code-berekening.**

## 4. Stap-voor-stap: nieuwe wedstrijd verwerken

### Stap 0 — Rekencheck vóór je iets in Airtable zet
Reken bij minstens 2-3 steekproef-opstellingen handmatig na of Som classificatie, Bonus, Toegestane grens en Binnen klassegrens? kloppen met wat de tracker zelf al aangeeft in de CSV. Klopt dit niet, zoek eerst uit waarom (verkeerde speler-classificatie? typefout in CSV?) vóórdat je verder gaat.

Bonus-logica: Vrouw + geen U19 = 1,5 · Vrouw + U19 = 2,0 · Man + geen U19 = 0 · Man + U19 = 1,0. Klassegrens: 14,5 + bonus (bonus gemaximeerd op 2,5).

### Stap 1 — Wedstrijd-record aanmaken
Naam, Datum, Tegenstander. Punten voor/tegen: als de tracker geen aparte eindstand geeft, mag je de som van alle segment-scores gebruiken — **flag dit expliciet aan Camilo als "afgeleid, niet apart bevestigd."**

### Stap 2 — Opstellingen-records aanmaken
Eén record per CSV-rij. Vul: Naam (label met kwart + spelers+rugnummers), Tijd op vloer, Punten voor/tegen, Spelers (linken op basis van Weergavenaam → Spelers-record), Wedstrijd (link), **Lineup code** (staat al in de CSV als de tracker-versie van 5 juli 2026 of later is gebruikt — zo niet, zelf berekenen: rugnummers van de 5 spelers oplopend sorteren, met `-` verbinden).

### Stap 3 — Wedstrijdstatistieken-records aanmaken
Eén record per speler. Vul Speeltijd (min), Speler (link), Wedstrijd (link). **Punten leeg laten** — komt achteraf uit de boxscore. Statregel = "Volledige naam — Wedstrijdnaam".

### Stap 4 — Lineup-matching (kern van dit proces)
Voor elke **unieke** Lineup code in deze wedstrijd (let op: dezelfde 5 spelers kunnen meerdere keren in één wedstrijd voorkomen — dat zijn dan meerdere Opstellingen-records die naar dezelfde Lineup moeten linken):

1. Zoek in de Lineups-tabel of deze Lineup code al bestaat (`search_records` op de code, of `list` en filteren).
2. **Bestaat al** → link het Lineup-record aan alle bijbehorende Opstellingen-records via het "Lineup"-veld.
3. **Bestaat nog niet** → maak een nieuw Lineups-record (Lineup naam = een van de Opstellingen-namen die deze code gebruikt; Lineup code; Spelers = dezelfde 5 spelerlinks), en link dat aan alle bijbehorende Opstellingen-records.

**Er bestaat ook een Airtable-Automation** (in de interface, tabblad "Automations", genaamd "Automation 1") die dit proces automatisch zou moeten doen bij het aanmaken van een Opstellingen-record. **Status op 5 juli 2026: gebouwd maar nog op OFF, nog niet end-to-end in productie bevestigd.** Check de actuele AAN/UIT-status voordat je aanneemt dat matching automatisch gaat — zolang die niet aantoonbaar correct en AAN staat, blijf je dit **handmatig via de API** doen zoals hierboven, niet er blind op vertrouwen.

### Stap 5 — Verificatie na afloop
- Tel: totaal lineup-minuten moet 40 zijn (of het aantal gespeelde minuten van een volledige wedstrijd), totaal speler-minuten moet 5× dat getal zijn.
- Check Wedstrijddata status op het Wedstrijd-record — moet "Compleet" worden zodra score + lineups + (later) punten kloppen.
- Rapporteer aan Camilo: welke lineups nieuw zijn aangemaakt, welke hergebruikt (en tel op of de rollup-totalen van een hergebruikte lineup kloppen met de som van de losse wedstrijden).

## 5. Testdata die al in de base staat (voor context, niet opnieuw aanmaken)

Er staan momenteel 3 testwedstrijden ("Test wedstrijd", "Test wedstrijd 2", "Test wedstrijd 3") met bijbehorende Opstellingen/Wedstrijdstatistieken/Lineups. Dit is **bewust testdata**, nog niet opgeschoond — hou hier rekening mee bij eventuele seizoensgemiddelden (testdata vervuilt die nog).

## 6. Bekende technische beperkingen (Airtable API/MCP-tool, niet oplosbaar door anders te vragen)

- **Rollup-, Count- en Lookup-velden kunnen niet via de API worden aangemaakt.** Camilo moet die altijd zelf handmatig toevoegen in de Airtable-UI; de AI kan wel de formules erbovenop bouwen zodra de rollup/count bestaat.
- **Nieuwe tabellen toevoegen aan een bestaande base kan niet via de API.** Alleen tabellen aanmaken bij het aanmaken van een gloednieuwe base werkt. Camilo maakt een lege tabel (naam + 1 primair veld) aan, de AI vult de rest.
- **Een base of interface hernoemen kan niet via de API.** Handmatig in de UI.
- **Decimale opmaak van formulevelden (bv. "toon 1 decimaal") kan niet via de API worden ingesteld** — een waarde kan intern correct 1,5 zijn maar in de Airtable-grid afgerond tonen als "2" als het weergaveformat niet handmatig is aangepast. Verwar dit niet met een rekenfout: check eerst de ruwe waarde via de API voor je een formule verdenkt.
- **Elementen aan een bestaande Interface-pagina toevoegen kan niet** — alleen complete pagina's aanmaken/verwijderen. Een pagina uitbreiden vereist verwijderen + volledig opnieuw opbouwen (vraag hiervoor altijd expliciete bevestiging, want destructief).
- **Airtable-Automations (het "Run a script"-actietype) vereisen een betaald plan.** No-code alternatief (Find records + Conditional Actions + Create/Update record) werkt wel op het gratis plan (100 automation-runs/maand) — dat is ook hoe de huidige Lineup-matching-automation is gebouwd.
- **`{veld} = BLANK()` in een formule kan een letterlijke 0 ten onrechte als "leeg" behandelen.** Gebruik in plaats daarvan `{veld} & "" = ""` om een echte lege waarde van een 0 te onderscheiden. Dit is al gecorrigeerd in Puntenstatus, Scorend rendement en Punten per minuut — pas dezelfde aanpak toe bij nieuwe formules die "is dit veld ingevuld" moeten checken.
- **Nooit een spelersregel leeg laten als iemand écht 0 punten scoorde** — vul altijd een letterlijke 0 in, anders is niet te onderscheiden of het "nog niet ingevoerd" of "echt nul" betekent.

## 7. AVG/privacy

Spelersnamen, classificatie (gezondheidsgegeven) en geslacht/leeftijd-gerelateerde data staan in deze base en de bijbehorende Interface. Beperk toegang tot wie het echt nodig heeft (Share-instellingen in Airtable, door Camilo zelf te beheren — geen API-tool voor beschikbaar).

## 8. Openstaande/lopende zaken (peildatum 5 juli 2026)

- Airtable-workspace draait op een **Team-trial** ("6 dagen resterend" op 5 juli) — na afloop valt dit terug naar het gratis plan. Onbevestigd of de gebouwde automation daarna nog werkt; dit moet opnieuw getest worden na de terugval.
- De Lineup-matching-automation staat nog op **OFF**.
- 11-juli-taak in Todoist (Excel 26 wedstrijden + statistiekvoorkeuren) staat nog open, los van dit alles.

## 9. Gebruik voor "Test wedstrijd 4"

Volg §4 stap voor stap. Verwacht bij de rekencheck (§Stap 0) geen verrassingen als de brondata intern consistent is (totaal lineup-minuten = totaal wedstrijdduur, totaal speler-minuten = 5× dat getal). Rapporteer aan het eind expliciet: welke lineups hergebruikt zijn (en of de opgetelde rollup-waarden kloppen met de som van de eerdere wedstrijden), en welke nieuw zijn.

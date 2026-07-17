# Wedstrijd-Import Workflow — voorbeeld/naslagdocument

> **Dit is een voorbeeldopzet**, gebaseerd op hoe één klant (met een fictieve base en verzonnen veld-ID's hieronder) de CSV-export van `index.html` in zijn eigen Airtable-base heeft gekoppeld. Het toont het pátroon — vervang alle `<...>`-placeholders door de echte base-/tabel-/veld-ID's van je eigen Airtable-omgeving. Dit document is zelfstandig leesbaar: bedoeld om te gebruiken in een ander Claude-project (bv. "coach/trainer-assistent") zonder de oorspronkelijke chatgeschiedenis erbij.

## 1. Doel

Een nieuwe wedstrijd — geëxporteerd vanuit `index.html` — volledig en gecontroleerd verwerken in je eigen Airtable-base, inclusief lineup-herkenning over wedstrijden heen.

## 2. Vereiste toegang

- Airtable MCP-connector moet actief zijn in de Claude-omgeving waar dit gebruikt wordt.
- Base-ID: `<jouw-base-id>`
- **Controleer bij aanvang altijd eerst met `list_tables_for_base` of onderstaande veld-ID's nog kloppen** — dit document kan verouderen als er sindsdien handmatig velden zijn toegevoegd/gewijzigd in Airtable.

## 3. Tabellen en veld-structuur (voorbeeld)

Onderstaande tabel-/veldnamen zijn een illustratief schema — de kolomnamen komen overeen met wat de tracker exporteert (zie README), maar elke klant maakt zijn eigen tabellen/velden aan en vult daar zijn eigen ID's voor in.

### Wedstrijden — `<table-id-wedstrijden>`
| Veld | ID | Type |
|---|---|---|
| Naam | `<field-id-naam>` | tekst (primair) |
| Datum | `<field-id-datum>` | date |
| Tegenstander | `<field-id-tegenstander>` | tekst |
| Punten voor | `<field-id-punten-voor>` | number |
| Punten tegen | `<field-id-punten-tegen>` | number |
| Scoreverschil, Resultaat | `<field-id-scoreverschil>`, `<field-id-resultaat>` | formule (automatisch) |
| Totaal lineup-minuten, Totaal speler-minuten | `<field-id-lineup-min>`, `<field-id-speler-min>` | rollup (automatisch) |
| Aantal spelerregels | `<field-id-aantal-spelerregels>` | count (automatisch) |
| Punten Rollup (from Wedstrijdstatistieken) | `<field-id-punten-rollup>` | rollup = COUNTA van ingevulde Punten (automatisch) |
| Lineup-minuten check, Speler-minuten check, Punteninvoer status, Wedstrijddata status | diverse | formule (automatisch) |

⚠️ Let op bij eigen formulevelden op deze plek: een verkeerd opgezette count/rollup kan systematisch fout rekenen zonder dat dat direct opvalt (bv. altijd "1" teruggeven i.p.v. het echte aantal). Controleer een nieuw formuleveld altijd eerst tegen een handmatige steekproef voordat je het vertrouwt.

### Opstellingen — `<table-id-opstellingen>`
| Veld | ID | Type |
|---|---|---|
| Naam | `<field-id-naam>` | tekst (primair) — vrij invulbaar label, bv. "Q1a: Speler #nr \| Speler #nr \| ..." |
| Tijd op vloer (min) | `<field-id-tijd-op-vloer>` | number |
| Punten voor / tegen | `<field-id-punten-voor>` / `<field-id-punten-tegen>` | number |
| Spelers | `<field-id-spelers>` | link → Spelers (5 spelers) |
| Wedstrijd | `<field-id-wedstrijd>` | link → Wedstrijden |
| Lineup | `<field-id-lineup>` | link → Lineups |
| Lineup code | `<field-id-lineup-code>` | tekst, bv. "0-7-8-11-15" (rugnummers oplopend, `-` gescheiden) |
| +/-, Som classificatie, Som bonus, Effectieve bonus, Toegestane grens, Binnen klassegrens?, +/- per minuut, Datakwaliteit, Punten voor/tegen per minuut, +/- per 10 minuten, Lineup advies, Analysewaarde | diverse | formule/rollup (automatisch) — **alleen relevant als je in de tracker-instellingen (⚙) het klassegrens-systeem hebt aangezet; anders staan deze kolommen niet eens in de CSV-export** |

### Wedstrijdstatistieken — `<table-id-wedstrijdstatistieken>`
| Veld | ID | Type |
|---|---|---|
| Statregel | `<field-id-statregel>` | tekst (primair), bv. "Voornaam Achternaam — Wedstrijdnaam" |
| Punten | `<field-id-punten>` | number — **leeg laten tot boxscore binnen is, NOOIT leeg laten als iemand écht 0 scoorde (zie §6)** |
| Speeltijd (min) | `<field-id-speeltijd>` | number |
| Speler | `<field-id-speler>` | link → Spelers |
| Wedstrijd | `<field-id-wedstrijd>` | link → Wedstrijden |
| Punten per minuut, Puntenstatus, Speeltijd %, Speeltijd categorie, Scorend rendement | diverse | formule (automatisch) |

### Lineups — `<table-id-lineups>`
| Veld | ID | Type |
|---|---|---|
| Lineup naam | `<field-id-lineup-naam>` | tekst (primair) — vrije tekst, conventie: opstellingsnaam overnemen uit Opstellingen |
| Spelers | `<field-id-spelers>` | link → Spelers (5 spelers) |
| Lineup code | `<field-id-lineup-code>` | tekst — **canonieke identiteit, zelfde format als Opstellingen.Lineup code** |
| Opstellingen | `<field-id-opstellingen>` | link (inverse, komt automatisch mee) |
| Totaal minuten, Totaal punten voor/tegen, Totaal +/-, Som classificatie, Som bonus | rollups | automatisch, sommeert over alle gekoppelde Opstellingen/Spelers |
| Aantal stints, Aantal spelers | counts | automatisch |

### Spelers — `<table-id-spelers>`
Bevat: Naam, Rugnummer, Classificatie, Geslacht, U19 (jeugdbonus), Bonus (formule), Weergavenaam (tracker) — de classificatie-/bonusvelden zijn alleen nodig als je het klassegrens-systeem gebruikt. **Rugnummer is de sleutel voor Lineup code-berekening**, ongeacht of je classificatie gebruikt.

## 4. Stap-voor-stap: nieuwe wedstrijd verwerken

### Stap 0 — Rekencheck vóór je iets in Airtable zet
Als je het klassegrens-systeem gebruikt: reken bij minstens 2-3 steekproef-opstellingen handmatig na of Som classificatie, Bonus, Toegestane grens en Binnen klassegrens? kloppen met wat de tracker zelf al aangeeft in de CSV. Klopt dit niet, zoek eerst uit waarom (verkeerde speler-classificatie? typefout in CSV?) vóórdat je verder gaat.

**Voorbeeldformule** (jouw competitie/instellingen kunnen hier volledig van afwijken — dit zijn instelbare waarden in de tracker, geen vaste regel): Categorie 1 + geen categorie 2 = 1,5 · beide categorieën = 2,0 · geen van beide = 0 · alleen categorie 2 = 1,0. Klassegrens: basiswaarde + bonus (bonus gemaximeerd op een ingestelde grens).

### Stap 1 — Wedstrijd-record aanmaken
Naam, Datum, Tegenstander. Punten voor/tegen: als de tracker geen aparte eindstand geeft, mag je de som van alle segment-scores gebruiken — **flag dit expliciet aan de baseowner als "afgeleid, niet apart bevestigd."**

### Stap 2 — Opstellingen-records aanmaken
Eén record per CSV-rij. Vul: Naam (label met periode + spelers+rugnummers), Tijd op vloer, Punten voor/tegen, Spelers (linken op basis van Weergavenaam → Spelers-record), Wedstrijd (link), **Lineup code** (staat al in de CSV — rugnummers van de 5 spelers oplopend gesorteerd, met `-` verbonden).

### Stap 3 — Wedstrijdstatistieken-records aanmaken
Eén record per speler. Vul Speeltijd (min), Speler (link), Wedstrijd (link). **Punten leeg laten** — komt achteraf uit de boxscore. Statregel = "Volledige naam — Wedstrijdnaam".

### Stap 4 — Lineup-matching (kern van dit proces)
Voor elke **unieke** Lineup code in deze wedstrijd (let op: dezelfde 5 spelers kunnen meerdere keren in één wedstrijd voorkomen — dat zijn dan meerdere Opstellingen-records die naar dezelfde Lineup moeten linken):

1. Zoek in de Lineups-tabel of deze Lineup code al bestaat (`search_records` op de code, of `list` en filteren).
2. **Bestaat al** → link het Lineup-record aan alle bijbehorende Opstellingen-records via het "Lineup"-veld.
3. **Bestaat nog niet** → maak een nieuw Lineups-record (Lineup naam = een van de Opstellingen-namen die deze code gebruikt; Lineup code; Spelers = dezelfde 5 spelerlinks), en link dat aan alle bijbehorende Opstellingen-records.

Dit proces kan (deels) geautomatiseerd worden met een Airtable-Automation (Find records + Conditional Actions + Create/Update record). Check altijd de actuele AAN/UIT-status van zo'n automation voordat je aanneemt dat matching automatisch gaat — zolang die niet aantoonbaar correct en AAN staat, doe je dit **handmatig via de API** zoals hierboven, niet er blind op vertrouwen.

### Stap 5 — Verificatie na afloop
- Tel: totaal lineup-minuten moet gelijk zijn aan het aantal gespeelde minuten van een volledige wedstrijd; totaal speler-minuten moet 5× dat getal zijn.
- Check de statusvelden op het Wedstrijd-record — moet "Compleet" (of jouw eigen equivalent) worden zodra score + lineups + (later) punten kloppen.
- Rapporteer aan de baseowner: welke lineups nieuw zijn aangemaakt, welke hergebruikt (en tel op of de rollup-totalen van een hergebruikte lineup kloppen met de som van de losse wedstrijden).

## 5. Bekende technische beperkingen (Airtable API/MCP-tool, niet oplosbaar door anders te vragen)

- **Rollup-, Count- en Lookup-velden kunnen niet via de API worden aangemaakt.** De baseowner moet die altijd zelf handmatig toevoegen in de Airtable-UI; de AI kan wel de formules erbovenop bouwen zodra de rollup/count bestaat.
- **Nieuwe tabellen toevoegen aan een bestaande base kan niet via de API.** Alleen tabellen aanmaken bij het aanmaken van een gloednieuwe base werkt. De baseowner maakt een lege tabel (naam + 1 primair veld) aan, de AI vult de rest.
- **Een base of interface hernoemen kan niet via de API.** Handmatig in de UI.
- **Decimale opmaak van formulevelden (bv. "toon 1 decimaal") kan niet via de API worden ingesteld** — een waarde kan intern correct 1,5 zijn maar in de Airtable-grid afgerond tonen als "2" als het weergaveformat niet handmatig is aangepast. Verwar dit niet met een rekenfout: check eerst de ruwe waarde via de API voor je een formule verdenkt.
- **Elementen aan een bestaande Interface-pagina toevoegen kan niet** — alleen complete pagina's aanmaken/verwijderen. Een pagina uitbreiden vereist verwijderen + volledig opnieuw opbouwen (vraag hiervoor altijd expliciete bevestiging, want destructief).
- **Airtable-Automations (het "Run a script"-actietype) vereisen een betaald plan.** No-code alternatief (Find records + Conditional Actions + Create/Update record) werkt wel op het gratis plan (100 automation-runs/maand).
- **`{veld} = BLANK()` in een formule kan een letterlijke 0 ten onrechte als "leeg" behandelen.** Gebruik in plaats daarvan `{veld} & "" = ""` om een echte lege waarde van een 0 te onderscheiden bij formules die "is dit veld ingevuld" moeten checken.
- **Nooit een spelersregel leeg laten als iemand écht 0 punten scoorde** — vul altijd een letterlijke 0 in, anders is niet te onderscheiden of het "nog niet ingevoerd" of "echt nul" betekent.

## 6. AVG/privacy

Spelersnamen, classificatie (kan als gezondheidsgegeven gelden) en geslacht/leeftijd-gerelateerde data kunnen in jouw base en bijbehorende Interface terechtkomen. Beperk toegang tot wie het echt nodig heeft (Share-instellingen in Airtable, door de baseowner zelf te beheren — geen API-tool voor beschikbaar).

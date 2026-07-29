# Current State — Lineup Tracker

**Datum**: 29 juli 2026  
**Basis**: `main` op commit `3e8e512`

## Overzicht

De Lineup Tracker is een mobiele PWA voor het registreren van lineups, segmenten en statistieken in wheelchair basketball. De app draait volledig lokaal in de browser zonder backend.

## Architectuur

- **Enkel bestand**: Alle HTML, CSS en JavaScript staat in `index.html` (2326 regels)
- **Geen build-stap**: Direct openen in browser mogelijk
- **PWA**: Service worker (`sw.js`) voor offline caching
- **Talen**: Nederlands en Engels via `STRINGS` object
- **Opslag**: `localStorage` voor alle data

## localStorage Keys

| Key | Inhoud | Doel |
|-----|--------|------|
| `lineup-tracker-v1` | Actieve wedstrijd state | Huidige wedstrijd hervatten |
| `lineup-tracker-roster` | Spelerslijst | Team data bewaren |
| `lineup-tracker-games` | Afgeronde wedstrijden | Historie, stats, trends |
| `lineup-tracker-settings` | Instellingen | Teamnaam, kleuren, classificatie |
| `lineup-tracker-lang` | Taalvoorkeur | `nl` of `en` |

## Data Structuren

### Settings
```javascript
{
  teamName: "",              // Teamnaam voor display
  logoUri: "",               // Base64 data URI van logo
  primaryColor: "#2563eb",   // Primaire kleur (hex)
  accentColor: "#f97316",    // Accentkleur tegenstander (hex)
  quarterCount: 4,           // Aantal periodes
  periodLabel: "",           // Naam periode (bv. "Kwart")
  useClassLimit: false,      // Classificatiesysteem aan/uit
  tag1Label: "",             // Label categorie 1 (bv. "Vrouw")
  tag2Label: "",             // Label categorie 2 (bv. "Jeugd")
  classBaseLimit: 14.5,      // Basis classificatie limiet
  maxBonus: 2.5,             // Maximale bonus
  bonusTag1Only: 1.5,        // Bonus alleen categorie 1
  bonusTag2Only: 1.0,        // Bonus alleen categorie 2
  bonusBoth: 2.0             // Bonus beide categorieën
}
```

### Player (roster)
```javascript
{
  id: 1,           // Uniek ID (number)
  nr: "7",         // Rugnummer (string)
  naam: "Jan",     // Naam (string)
  kl: "3.0",       // Classificatie (string, decimal)
  vrouw: false,    // Categorie 1 (boolean)
  jeugd: false     // Categorie 2 (boolean)
}
```

### Player (state, met wedstrijd-velden)
```javascript
{
  id: 1,
  nr: "7",
  naam: "Jan",
  kl: "3.0",
  vrouw: false,
  jeugd: false,
  start: false,       // Starter voor deze wedstrijd
  participate: true   // Doet mee deze wedstrijd
}
```

### State (actieve wedstrijd)
```javascript
{
  phase: "setup",           // "setup" | "tracking"
  players: [],              // Player[] met start/participate
  clockDown: true,          // Klok telt af (10:00 → 0:00)
  limitStr: "14.5",         // Classificatie limiet (string)
  nextId: 13,               // Volgend player ID
  onCourt: [],              // number[] - player IDs op het veld
  selected: null,           // { id, where: "court"|"bank" } | null
  segments: [],             // Segment[]
  curQuarter: 1,            // Huidig kwart
  opponent: "",             // Tegenstander
  competition: "",          // Competitie/toernooi
  beginMin: 10,             // Segment begin minuten
  beginSec: 0,              // Segment begin seconden
  endMin: 10,               // Segment eind minuten
  endSec: 0,                // Segment eind seconden
  scoreFor: 0,              // Cumulatieve score eigen team
  scoreAgainst: 0,          // Cumulatieve score tegenstander
  segStartFor: 0,           // Score bij segment start (eigen)
  segStartAgainst: 0,       // Score bij segment start (tegen)
  savedAt: null             // Timestamp laatste opslag
}
```

### Segment
```javascript
{
  quarter: 1,               // Kwart nummer
  beginSec: 600,            // Begin in seconden (absoluut)
  endSec: 480,              // Eind in seconden (absoluut)
  durSec: 120,              // Duur in seconden
  lineup: [1, 3, 5, 7, 9],  // Player IDs op het veld
  pf: 8,                    // Punten voor (eigen team)
  pa: 6,                    // Punten tegen (tegenstander)
  classSum: 13.5,           // Som classificaties
  allowed: 16.0,            // Toegestane limiet (incl. bonus)
  over: false               // Over limiet?
}
```

### Game (historie)
```javascript
{
  id: "g1722268800000",     // Uniek ID ("g" + timestamp)
  opponent: "Team B",       // Tegenstander
  competition: "Competitie",// Competitie/toernooi
  date: "2026-07-29T10:00:00.000Z", // ISO datum
  players: [],              // Player[] snapshot
  segments: [],             // Segment[]
  scoreFor: 45,             // Eindscore eigen team
  scoreAgainst: 38,         // Eindscore tegenstander
  quarterCount: 4,          // Aantal periodes
  periodLabel: "Kwart",     // Naam periode
  useClassLimit: true       // Classificatie gebruikt
}
```

### Backup
```javascript
{
  type: "lineup-tracker-backup",
  version: 1,
  exportedAt: "2026-07-29T10:00:00.000Z",
  data: {
    "lineup-tracker-v1": {},    // State object
    "lineup-tracker-roster": [], // Player[]
    "lineup-tracker-games": [],  // Game[]
    "lineup-tracker-settings": {}, // Settings object
    "lineup-tracker-lang": "nl"  // "nl" | "en"
  }
}
```

## Match Lifecycle

### Fase 1: Setup
- Spelers toevoegen/aanpassen op Team tabblad
- Op Wedstrijd tabblad: deelnemers kiezen, starters selecteren
- Tegenstander en competitie invullen
- Classificatie limiet instellen (optioneel)
- Klok richting kiezen (op/af)

### Fase 2: Tracking
- 5 spelers op het veld (automatisch of handmatig gekozen)
- Segmenten registreren: begin/eind tijd, punten voor/tegen
- Wissels uitvoeren (meerdere achter elkaar mogelijk)
- Segmenten bewerken/verwijderen
- Score cumulatief bijhouden

### Fase 3: Finish
- Wedstrijd afronden → opslaan in historie
- Nieuwe lege wedstrijd starten
- CSV export beschikbaar

### Hervatten
- Bij herladen: saved state detecteren
- Resume modal toont aantal segmenten en tijdstip
- Keuze: hervatten of nieuwe wedstrijd

## Berekeningen

### Score
```javascript
// Cumulatieve score = som van alle segment pf/pa
scoreFor = segments.reduce((sum, s) => sum + s.pf, 0);
scoreAgainst = segments.reduce((sum, s) => sum + s.pa, 0);
```

**Voorbeeld**: 3 segmenten met pf=[8, 12, 6] → scoreFor = 26

### Plus/Minus per segment
```javascript
pm = segment.pf - segment.pa;
```

**Voorbeeld**: pf=8, pa=6 → pm = +2

### Speeltijd per speler
```javascript
// Som van durSec voor alle segmenten waarin speler speelde
playerSeconds = segments
  .filter(s => s.lineup.includes(playerId))
  .reduce((sum, s) => sum + s.durSec, 0);
```

**Voorbeeld**: Speler speelt in segment 1 (120s) en segment 3 (180s) → 300 seconden = 5:00

### Lineup Code
```javascript
// Gesorteerde rugnummers joined met "-"
lineupCode = lineup
  .map(id => playerById(id).nr)
  .sort((a, b) => parseInt(a) - parseInt(b))
  .join("-");
```

**Voorbeeld**: Lineup met rugnummers [7, 3, 9, 1, 5] → "1-3-5-7-9"

### Classificatie Som
```javascript
// Som van kl waarden van spelers op het veld
classSum = lineup.reduce((sum, id) => sum + parseFloat(playerById(id).kl), 0);
```

**Voorbeeld**: 5 spelers met kl=[3.0, 2.5, 3.5, 2.0, 3.0] → 14.0

### Classificatie Bonus
```javascript
// Bonus op basis van vrouw/jeugd tags
bonus = lineup.reduce((sum, id) => sum + playerBonus(playerById(id)), 0);
bonus = Math.min(maxBonus, bonus);

function playerBonus(p) {
  if (p.vrouw && p.jeugd) return bonusBoth;      // 2.0
  if (p.vrouw) return bonusTag1Only;              // 1.5
  if (p.jeugd) return bonusTag2Only;              // 1.0
  return 0;
}
```

**Voorbeeld**: 2 vrouwen (1 met jeugd) → bonus = min(2.5, 2.0 + 1.5) = 2.5

### Toegestane Limiet
```javascript
allowed = classBaseLimit + bonus;
```

**Voorbeeld**: 14.5 + 2.5 = 17.0

### Stats +/- per 10 minuten
```javascript
// Genormaliseerd plus/minus per 10 minuten speeltijd
pmPer10 = (pm * 600) / seconds;
```

**Voorbeeld**: pm=+5 in 180 seconden → (5 * 600) / 180 = +16.7 per 10 min

## Impliciete Aannames

1. **5 spelers op het veld**: Hard-coded, niet configureerbaar
2. **Rugnummers uniek**: Warning bij duplicaten, maar niet geblokkeerd
3. **Segmenten opeenvolgend**: Geen overlapping mogelijk
4. **Clock direction consistent**: Niet per kwart wisselbaar
5. **Player IDs stabiel**: Eenmaal aangemaakt, niet wijzigbaar
6. **Geschiedenis onwijzigbaar**: Afgeronde wedstrijden niet aanpasbaar
7. **CSV altijd Nederlands**: Interface taal heeft geen invloed op export
8. **MAX_SCORE = 150**: Harde limiet voor score selectie
9. **MAX_MIN = 10**: Harde limiet voor tijd selectie

## Risico's

### Data Verlies
1. **Speler verwijderen**: Als speler in lopende wedstrijd speelde, worden lineup data onherkenbaar
2. **Browser cache wissen**: Alle data verloren zonder back-up
3. **Import zonder validatie**: Ongeldige JSON overschrijft bestaande data
4. **Geen schema versie**: Migratie bij structuurwijziging niet mogelijk

### Berekeningen
1. **Segment bewerken**: Score wordt herberekend, maar live score niet aangepast
2. **Wissels op 0 seconden**: Segment wordt overgeslagen (correct gedrag)
3. **Classificatie limiet**: Warning bij overschrijding, maar niet geblokkeerd

### Offline
1. **Service worker**: Cache kan verouderen bij update
2. **Geen sync**: Data alleen lokaal, geen multi-device ondersteuning
3. **localStorage limiet**: ~5-10MB afhankelijk van browser

## Tabbladen

### Team
- Spelerslijst beheren (rugnummer, naam, classificatie, categorieën)
- Automatisch sorteren op rugnummer
- Warning bij dubbele rugnummers

### Wedstrijd
- **Pre-game**: Deelnemers kiezen, starters selecteren, tegenstander invullen
- **Live**: Score bijhouden, segmenten registreren, wissels uitvoeren
- **Post-game**: Wedstrijd afronden, CSV exporteren

### Stats
- Lineup combinaties (1-5 spelers)
- Plus/minus met ON/OFF vergelijking
- Filters: wedstrijden, spelers (moet op/moet af)
- Optioneel per 10 minuten genormaliseerd

### Trends
- Per speler: gemiddelde speeltijd en +/-
- Lijngrafiek: +/- per wedstrijd
- Staafgrafiek: speeltijd per wedstrijd
- Chronologisch (oud → nieuw, lopende wedstrijd als laatste)

### Historie
- Overzicht afgeronde wedstrijden
- Detailweergave met segmenten
- CSV export per wedstrijd
- Wedstrijd verwijderen

## Instellingen

### Club
- Teamnaam
- Logo (base64 data URI)
- Primaire kleur (10 presets + custom)
- Accentkleur (tegenstander)

### Wedstrijd
- Aantal periodes (1-12)
- Naam periode (bv. "Kwart", "Helft")

### Classificatie
- Systeem aan/uit
- Labels categorie 1 en 2
- Basis limiet
- Maximale bonus
- Bonus per categorie

### Back-up
- Export alle data (JSON)
- Import back-up (overschrijft alles)

## Niet-Onderhandelbaar

1. **localStorage compatibiliteit**: Bestaande keys en datastructuur behouden
2. **CSV contract**: Nederlandse kolomnamen en waarden vast
3. **Offline first**: PWA moet zonder netwerk werken
4. **Geen backend**: Geen externe data verzending
5. **Talen**: Nederlands en Engels verplicht
6. **Mobiel first**: Touchbediening en smalle schermen
7. **Geen echte spelersdata**: Fictieve data in tests en screenshots

# Data Contracts — Lineup Tracker

**Datum**: 29 juli 2026  
**Basis**: `main` op commit `3e8e512`

## Overzicht

Dit document beschrijft de data-contracten van de Lineup Tracker: CSV-export formaten, JSON-back-up structuur, en localStorage schema's. Deze contracten zijn onderhandelbaar voor v2, maar moeten expliciet worden gemigreerd.

## CSV Contracten

De CSV-export is altijd in het Nederlands, ongeacht de interface-taal. Dit is essentieel voor de Airtable-import workflow.

### Segments CSV

Eén CSV-bestand bevat twee secties: opstellingen (+/-) en speeltijd per speler.

#### Sectie 1: Opstellingen (+/-)

**Header (zonder classificatie)**:
```
Opstelling,Kwart,Begin,Eind,Speeltijd,Seconden,Punten voor,Punten tegen,Plusminus,Lineup code
```

**Header (met classificatie)**:
```
Opstelling,Kwart,Begin,Eind,Speeltijd,Seconden,Punten voor,Punten tegen,Plusminus,Som classificatie,Toegestane grens,Binnen klassegrens,Lineup code
```

**Velden**:
| Kolom | Type | Beschrijving | Voorbeeld |
|-------|------|--------------|-----------|
| Opstelling | string | Spelers gescheiden door " \| " | `"Jan #7 \| Piet #3 \| ..."` |
| Kwart | number | Kwart nummer | `1` |
| Begin | string | Begin tijd (M:SS) | `"10:00"` |
| Eind | string | Eind tijd (M:SS) | `"8:00"` |
| Speeltijd | string | Duur (M:SS) | `"2:00"` |
| Seconden | number | Duur in seconden | `120` |
| Punten voor | number | Punten eigen team | `8` |
| Punten tegen | number | Punten tegenstander | `6` |
| Plusminus | number | pf - pa | `2` |
| Som classificatie | number | Som classificaties (optioneel) | `13.5` |
| Toegestane grens | number | Limiet incl. bonus (optioneel) | `16.0` |
| Binnen klassegrens | string | "OK" of "Te hoog" (optioneel) | `"OK"` |
| Lineup code | string | Gesorteerde rugnummers | `"3-5-7-9-11"` |

**Voorbeeld rij (zonder classificatie)**:
```csv
"Jan #7 | Piet #3 | Kees #5 | Jan #9 | Tom #11",1,10:00,8:00,2:00,120,8,6,2,3-5-7-9-11
```

**Voorbeeld rij (met classificatie)**:
```csv
"Jan #7 | Piet #3 | Kees #5 | Jan #9 | Tom #11",1,10:00,8:00,2:00,120,8,6,2,13.5,16.0,OK,3-5-7-9-11
```

**Berekeningen**:
- `Plusminus = Punten voor - Punten tegen`
- `Speeltijd = Begin - Eind` (als clockDown=true)
- `Lineup code = sort([nr1, nr2, nr3, nr4, nr5]).join("-")`

#### Sectie 2: Speeltijd per speler

**Header (zonder classificatie)**:
```
Speler,Nummer,Speeltijd,Seconden,Aantal beurten
```

**Header (met classificatie)**:
```
Speler,Nummer,Classificatie,Geslacht,Jeugd U19,Speeltijd,Seconden,Aantal beurten
```

**Velden**:
| Kolom | Type | Beschrijving | Voorbeeld |
|-------|------|--------------|-----------|
| Speler | string | Naam | `"Jan"` |
| Nummer | string | Rugnummer | `"7"` |
| Classificatie | string | Classificatie waarde (optioneel) | `"3.0"` |
| Geslacht | string | "Vrouw" of "Man" (optioneel) | `"Man"` |
| Jeugd U19 | string | "Ja" of "Nee" (optioneel) | `"Nee"` |
| Speeltijd | string | Totale speeltijd (M:SS) | `"12:30"` |
| Seconden | number | Totale speeltijd in seconden | `750` |
| Aantal beurten | number | Aantal segmenten gespeeld | `5` |

**Voorbeeld rij (zonder classificatie)**:
```csv
Jan,7,12:30,750,5
```

**Voorbeeld rij (met classificatie)**:
```csv
Jan,7,3.0,Man,Nee,12:30,750,5
```

**Berekeningen**:
- `Speeltijd = som(durSec) voor alle segmenten waarin speler speelde`
- `Aantal beurten = count(segmenten) waarin speler speelde`

### CSV Bestandsnaam

**Lopende wedstrijd**:
```
{teamnaam}-{YYYYMMDD}-{HHmm}.csv
```

**Historie wedstrijd**:
```
{tegenstander}-{YYYYMMDD}-{HHmm}.csv
```

**Voorbeelden**:
- `my-team-20260729-1430.csv`
- `team-b-20260715-1000.csv`

### CSV Combinatie

Het volledige CSV-bestand combineert beide secties:
```
Opstellingen (+/- en classificatie)
{segments CSV}

Speeltijd per speler
{minutes CSV}
```

## JSON Back-up Contract

### Structuur

```json
{
  "type": "lineup-tracker-backup",
  "version": 1,
  "exportedAt": "2026-07-29T10:00:00.000Z",
  "data": {
    "lineup-tracker-v1": { /* State object */ },
    "lineup-tracker-roster": [ /* Player[] */ ],
    "lineup-tracker-games": [ /* Game[] */ ],
    "lineup-tracker-settings": { /* Settings object */ },
    "lineup-tracker-lang": "nl"
  }
}
```

### Velden

| Veld | Type | Beschrijving |
|------|------|--------------|
| type | string | Vast: `"lineup-tracker-backup"` |
| version | number | Back-up format versie (huidig: 1) |
| exportedAt | string | ISO 8601 timestamp |
| data | object | Bevat alle localStorage keys |

### data.lineup-tracker-v1

Actieve wedstrijd state. Zie `current-state.md` voor volledige structuur.

**Aanwezig als**: Er een lopende of opgeslagen wedstrijd is.

### data.lineup-tracker-roster

Array van players (zonder `start` en `participate` velden).

```json
[
  {
    "id": 1,
    "nr": "7",
    "naam": "Jan",
    "kl": "3.0",
    "vrouw": false,
    "jeugd": false
  }
]
```

### data.lineup-tracker-games

Array van afgeronde wedstrijden.

```json
[
  {
    "id": "g1722268800000",
    "opponent": "Team B",
    "competition": "Competitie",
    "date": "2026-07-29T10:00:00.000Z",
    "players": [ /* Player[] */ ],
    "segments": [ /* Segment[] */ ],
    "scoreFor": 45,
    "scoreAgainst": 38,
    "quarterCount": 4,
    "periodLabel": "Kwart",
    "useClassLimit": true
  }
]
```

### data.lineup-tracker-settings

Settings object. Zie `current-state.md` voor volledige structuur.

### data.lineup-tracker-lang

Taalvoorkeur: `"nl"` of `"en"`.

### Bestandsnaam

```
{teamnaam}-backup-{YYYYMM}.json
```

**Voorbeeld**: `my-team-backup-202607.json`

## localStorage Schema

### lineup-tracker-v1

**Type**: JSON object (State)

**Aanwezig**: Altijd (ook als lege state)

**Inhoud**: Actieve wedstrijd state

**Lege state**:
```json
{
  "phase": "setup",
  "players": [],
  "clockDown": true,
  "limitStr": "14.5",
  "nextId": 1,
  "onCourt": [],
  "selected": null,
  "segments": [],
  "curQuarter": 1,
  "opponent": "",
  "competition": "",
  "beginMin": 10,
  "beginSec": 0,
  "endMin": 10,
  "endSec": 0,
  "scoreFor": 0,
  "scoreAgainst": 0,
  "segStartFor": 0,
  "segStartAgainst": 0,
  "savedAt": null
}
```

### lineup-tracker-roster

**Type**: JSON array (Player[])

**Aanwezig**: Altijd (ook als lege array)

**Inhoud**: Spelerslijst (zonder `start` en `participate`)

### lineup-tracker-games

**Type**: JSON array (Game[])

**Aanwezig**: Altijd (ook als lege array)

**Inhoud**: Afgeronde wedstrijden

### lineup-tracker-settings

**Type**: JSON object (Settings)

**Aanwezig**: Altijd (ook als lege object met defaults)

**Inhoud**: Instellingen

### lineup-tracker-lang

**Type**: String

**Aanwezig**: Optioneel (default: `"nl"`)

**Inhoud**: `"nl"` of `"en"`

## Migratie Overwegingen

### Huidige Situatie

1. **Schema versie**: localStorage key `lineup-tracker-schema-version` (sinds PR 2.1) bevat het huidige schema (1). Ontbrekende key wordt als versie 1 gelezen.
2. **Back-up versie**: JSON back-up heeft `version: 1` (sinds PR 2.1 gebruikt door import om toekomstige versies veilig te weigeren).
3. **Validatie**: Import weigert structureel ongeldige `payload.data` (sinds PR 1.7), toekomstige `version` (sinds PR 2.1), en inhoudelijke fouten in collecties/velden/referenties (sinds PR 2.2). Foutmeldingen in NL en EN.
4. **Migratie**: `migrateBackup(data, fromVersion, toVersion)` (sinds PR 2.3) loopt automatisch tijdens import voor back-ups met `version < SCHEMA_VERSION`. Per overgang is één functie in `MIGRATIONS` geregistreerd; bij ontbrekende of falende migratie wordt de import afgewezen zonder `localStorage` te muteren. Foutmelding in NL en EN.

### V2 Vereisten

1. **Schema versie**: aanwezig in zowel localStorage (`lineup-tracker-schema-version`) als in elke back-up payload.
2. **Validatie**: structureel (PR 1.7) + versie (PR 2.1); diepgaande veld-/referentie-validatie volgt in PR 2.2.
3. **Migratie functie**: `migrate(data, fromVersion, toVersion)` (PR 2.3).
4. **Backward compatibility**: back-ups zonder `version` worden als versie 1 gelezen.
5. **Forward compatibility**: back-ups met `version > 1` worden veilig geweigerd met de bestaande `importBackupInvalid` melding.

### Migratie Strategie

```javascript
function migrate(data, fromVersion, toVersion) {
  if (fromVersion === toVersion) return data;
  
  // Opeenvolgende migraties
  if (fromVersion === 1 && toVersion >= 2) {
    data = migrateV1toV2(data);
    fromVersion = 2;
  }
  
  if (fromVersion === 2 && toVersion >= 3) {
    data = migrateV2toV3(data);
    fromVersion = 3;
  }
  
  // ... enzovoort
  
  return data;
}
```

## Relaties tussen Data

### Player ID Referenties

1. **Roster → State**: `state.players` bevat players met `id`
2. **State → Segments**: `segment.lineup` bevat player IDs
3. **State → Games**: `game.players` bevat player snapshot
4. **Games → Segments**: `game.segments` bevat player IDs

### Snapshot Strategie

Bij het afronden van een wedstrijd wordt de spelerslijst gekopieerd:
```javascript
game.players = state.players.map(p => ({
  id: p.id,
  nr: p.nr,
  naam: p.naam,
  kl: p.kl,
  vrouw: p.vrouw,
  jeugd: p.jeugd
}));
```

**Doel**: Historische wedstrijden blijven correct zelfs als spelers worden aangepast.

### Risico: Speler Verwijderen

Als een speler wordt verwijderd die in de lopende wedstrijd speelde:
- `segment.lineup` bevat nog steeds het oude player ID
- `playerById(id)` returns `null`
- Lineup wordt onherkenbaar in CSV en UI

**Oplossing in v2**: Soft delete of snapshot validatie.

## Type Definites (voor TypeScript migratie)

```typescript
interface Settings {
  teamName: string;
  logoUri: string;
  primaryColor: string;
  accentColor: string;
  quarterCount: number;
  periodLabel: string;
  useClassLimit: boolean;
  tag1Label: string;
  tag2Label: string;
  classBaseLimit: number;
  maxBonus: number;
  bonusTag1Only: number;
  bonusTag2Only: number;
  bonusBoth: number;
}

interface Player {
  id: number;
  nr: string;
  naam: string;
  kl: string;
  vrouw: boolean;
  jeugd: boolean;
}

interface PlayerWithMatchState extends Player {
  start: boolean;
  participate: boolean;
}

interface Segment {
  quarter: number;
  beginSec: number;
  endSec: number;
  durSec: number;
  lineup: number[];
  pf: number;
  pa: number;
  classSum: number;
  allowed: number;
  over: boolean;
}

interface State {
  phase: "setup" | "tracking";
  players: PlayerWithMatchState[];
  clockDown: boolean;
  limitStr: string;
  nextId: number;
  onCourt: number[];
  selected: { id: number; where: "court" | "bank" } | null;
  segments: Segment[];
  curQuarter: number;
  opponent: string;
  competition: string;
  beginMin: number;
  beginSec: number;
  endMin: number;
  endSec: number;
  scoreFor: number;
  scoreAgainst: number;
  segStartFor: number;
  segStartAgainst: number;
  savedAt: number | null;
}

interface Game {
  id: string;
  opponent: string;
  competition: string;
  date: string;
  players: Player[];
  segments: Segment[];
  scoreFor: number;
  scoreAgainst: number;
  quarterCount: number;
  periodLabel: string;
  useClassLimit: boolean;
}

interface Backup {
  type: "lineup-tracker-backup";
  version: number;
  exportedAt: string;
  data: {
    "lineup-tracker-v1"?: State;
    "lineup-tracker-roster"?: Player[];
    "lineup-tracker-games"?: Game[];
    "lineup-tracker-settings"?: Settings;
    "lineup-tracker-lang"?: "nl" | "en";
  };
}
```

## Validatie Regels (voor v2)

### Back-up Import

De importvolgorde in `handleImportBackupFile` is:
1. **Type check**: `payload.type === "lineup-tracker-backup"` (sinds PR 1.7)
2. **Structurele data-check**: `payload.data` is een plain object (geen array/string/number/null) (sinds PR 1.7)
3. **Version check**: ontbrekende `version` wordt als 1 gelezen; `version > currentVersion` wordt geweigerd (sinds PR 2.1)
4. **Migratie** (sinds PR 2.3): indien `version < SCHEMA_VERSION` wordt `migrateBackup(payload.data, version, SCHEMA_VERSION)` aangeroepen. Bij ontbrekende of falende migratie wordt de import afgewezen met `importBackupMigrationFailed`. Geen `localStorage`-mutatie.
5. **Inhoudelijke validatie** (sinds PR 2.2):
   - `data: {}` (geen herkenbare velden) → afgewezen
   - **Roster**: moet een array zijn; elk element is een object met verplichte velden `id` (number), `nr` (string), `naam` (string), `kl` (string), `vrouw` (boolean), `jeugd` (boolean); geen dubbele `id`s
   - **Games**: moet een array zijn; elk element is een object met verplichte velden `id`, `opponent`, `competition`, `date`, `players`, `segments`, `scoreFor`, `scoreAgainst`, `quarterCount`, `periodLabel`, `useClassLimit`; `game.players[i].id` is verplicht; `segment.lineup` mag alleen IDs bevatten die voorkomen in `game.players` (referentie-check)
   - **Settings**: moet een object zijn; bekende sleutels aanwezig; `useClassLimit` is boolean; `quarterCount`, `classBaseLimit`, `maxBonus`, `bonus*` zijn numbers (geen bereik-checks)
   - **Lang**: `"nl"` of `"en"`
6. **Bevestigingsdialoog**
7. **Schrijf naar localStorage + `SCHEMA_VERSION_KEY` + reload**

Bij validatiefouten: eerste foutmelding wordt getoond plus samenvatting van het aantal overige fouten, in de actieve interfacetaal. Geen `localStorage`-mutatie, geen reload.

#### Migratiecontract (PR 2.3)

- `MIGRATIONS` is een object met sleutels = `fromVersion` en waarden = `(data) => data`.
- De sleutel 1 is de migratie van v1 naar v2. Zolang `SCHEMA_VERSION === 1` is dit een no-op; bij een toekomstige `SCHEMA_VERSION = 2` moet deze entry de echte transformatie bevatten.
- `migrateBackup(data, fromVersion, toVersion)` loopt stapsgewijs van `fromVersion` tot `toVersion` en past per overgang de geregistreerde functie toe.
- Elke migratie moet een **nieuw plain object** retourneren en mag het input-object niet muteren.
- Retourneert `null` bij: niet-plain-object invoer, ontbrekende migratie, runtime-fout in een migratie, of een non-object resultaat.
- De importflow gebruikt `null` als signaal om de import af te wijzen met `importBackupMigrationFailed`.

### Segment Validatie (toekomstig, PR 2.3+)

1. **DurSec > 0**: Segment moet positieve duur hebben
2. **Lineup length = 5**: Precies 5 spelers
3. **Player IDs bestaan**: Alle IDs in roster
4. **PF/PA >= 0**: Niet-negatieve punten
5. **Begin/Eind consistent**: Afhankelijk van clockDown

### Player Validatie (toekomstig, PR 2.3+)

1. **ID uniek**: Geen dubbele IDs (gedeeltelijk afgedwongen in PR 2.2)
2. **Nr niet leeg**: Rugnummer verplicht
3. **Naam niet leeg**: Naam verplicht (voor geldige spelers)
4. **Kl numeriek**: Classificatie is decimal string

## Onzekerheden

1. **Clock direction per kwart**: Kan dit wisselen? (Huidig: nee)
2. **Player ID generatie**: Altijd oplopend? (Huidig: ja, `nextId++`)
3. **Segment overlapping**: Nooit toegestaan? (Huidig: correct)
4. **Game editing**: Afgeronde wedstrijden aanpasbaar? (Huidig: nee)
5. **Multi-device sync**: Hoe om te gaan met conflicts? (Huidig: niet van toepassing)

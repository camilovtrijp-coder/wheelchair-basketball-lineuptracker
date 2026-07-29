# Product Compatibility Matrix — Lineup Tracker

**Datum**: 29 juli 2026  
**Basis**: `main` op commit `3e8e512`

## Overzicht

Deze matrix beschrijft welke functionaliteit de v2 moet behouden, wijzigen of bewust laten vervallen ten opzichte van de huidige productie-app. Dit dient als referentie voor de compatibiliteitscontrole tijdens de migratie.

## Legenda

- **Behouden**: Functionaliteit moet exact hetzelfde werken in v2
- **Wijzigen**: Functionaliteit wordt verbeterd, maar kerngedrag blijft
- **Vervallen**: Functionaliteit wordt bewust verwijderd in v2
- **Nieuw**: Functionaliteit wordt toegevoegd in v2

## Tabbladen

### Team Tabblad

| Functionaliteit | Status | Opmerking |
|-----------------|--------|-----------|
| Spelerslijst tonen | Behouden | Automatisch gesorteerd op rugnummer |
| Speler toevoegen | Behouden | Lege rij met automatisch ID |
| Speler verwijderen | Behouden | Confirmatie dialog, warning bij actieve wedstrijd |
| Rugnummer wijzigen | Behouden | Direct sorteren na blur |
| Naam wijzigen | Behouden | Direct opslaan |
| Classificatie wijzigen | Behouden | Alleen zichtbaar als systeem aan |
| Categorie toggles | Behouden | Vrouw/Jeugd, alleen zichtbaar als systeem aan |
| Dubbele rugnummers warning | Behouden | Rood randje, warning banner |
| Leeg team | Behouden | "Nog geen spelers" melding |

### Wedstrijd Tabblad - Pre-Game

| Functionaliteit | Status | Opmerking |
|-----------------|--------|-----------|
| Deelnemers kiezen | Behouden | Toggle "Meedoen" per speler |
| Starters kiezen | Behouden | Toggle "Start" per deelnemer |
| Automatische starters | Behouden | 5 laagste rugnummers als geen keuze |
| Tegenstander invullen | Behouden | Optioneel tekstveld |
| Competitie invullen | Behouden | Optioneel tekstveld |
| Classificatie limiet | Behouden | Alleen zichtbaar als systeem aan |
| Klok richting | Behouden | Toggle op/af (10:00 → 0:00 of 0:00 → 10:00) |
| Start wedstrijd knop | Behouden | Disabled als niet 5 spelers/deelnemers |
| Validatie: 5 spelers | Behouden | Error bij <5 spelers met naam |
| Validatie: 5 deelnemers | Behouden | Error bij <5 deelnemers |
| Validatie: unieke rugnummers | Behouden | Error bij dubbele rugnummers |
| Validatie: 0 of 5 starters | Behouden | Error bij 1-4 starters |

### Wedstrijd Tabblad - Live

| Functionaliteit | Status | Opmerking |
|-----------------|--------|-----------|
| Score eigen team | Behouden | Select + knoppen (+1, +2, +3, -1) |
| Score tegenstander | Behouden | Select + knoppen (+1, +2, +3, -1) |
| Segment delta tonen | Behouden | "+X" naast teamnaam |
| Spelers op het veld (5) | Behouden | Grid met chips |
| Spelers op de bank | Behouden | Grid met chips |
| Wissel modus | Behouden | Tik speler, dan andere speler |
| Meerdere wissels | Behouden | Achter elkaar mogelijk |
| Wissel bevestigen | Behouden | "Klaar met wisselen" → kloktijd modal |
| Wissel annuleren | Behouden | "Annuleer" knop |
| Segment registreren | Behouden | Kwart, begin, eind, opslaan |
| Segment duur tonen | Behouden | "Speeltijd dit segment: M:SS" |
| Segmenten lijst | Behouden | Klikbaar om te bewerken |
| Segment bewerken | Behouden | Modal met alle velden |
| Segment verwijderen | Behouden | Confirmatie, score herberekenen |
| Classificatie som | Behouden | Som + limiet + warning |
| Classificatie bar | Behouden | Visuele indicator (groen/rood) |
| Kwart selectie | Behouden | Knoppen 1-4 (of meer) |
| Reset wedstrijd | Behouden | Confirmatie dialog |
| Wedstrijd afronden | Behouden | Opslaan in historie, nieuwe wedstrijd |
| CSV export | Behouden | Downloaden of delen |
| Lineup standing +/- | Behouden | Cumulatief +/- onder teamnaam |

### Stats Tabblad

| Functionaliteit | Status | Opmerking |
|-----------------|--------|-----------|
| Lineup combinaties | Behouden | 1-5 spelers selectie |
| Plus/minus berekening | Behouden | ON/OFF verschil |
| Per 10 minuten | Behouden | Toggle voor normalisatie |
| Sorteer richting | Behouden | Oplopend/aflopend |
| Filter wedstrijden | Behouden | Multi-select modal |
| Filter spelers | Behouden | Moet op/moet af/geen filter |
| Lopende wedstrijd | Behouden | Telt mee als "Huidige wedstrijd" |
| Leeg state | Behouden | "Nog geen wedstrijddata" melding |
| Geen combinaties | Behouden | "Geen combinaties gevonden" melding |
| Combo kaart | Behouden | Tijd, Pnt, Teg, Met hen, Zonder hen |

### Trends Tabblad

| Functionaliteit | Status | Opmerking |
|-----------------|--------|-----------|
| Per speler kaart | Behouden | Gemiddelde tijd en +/- |
| Lijngrafiek +/- | Behouden | SVG chart per wedstrijd |
| Staafgrafiek tijd | Behouden | SVG chart per wedstrijd |
| Per 10 minuten | Behouden | Toggle voor normalisatie |
| Sorteer optie | Behouden | Nr/Min/+/- cycling |
| Filter wedstrijden | Behouden | Gedeeld met Stats tab |
| Wedstrijden tonen | Behouden | Uitklapbare lijst per speler |
| Chronologische volgorde | Behouden | Oud → nieuw, lopende als laatste |
| Leeg state | Behouden | "Nog geen wedstrijddata" melding |
| Shared max tijd | Behouden | Vergelijkbare balkhoogte tussen spelers |

### Historie Tabblad

| Functionaliteit | Status | Opmerking |
|-----------------|--------|-----------|
| Wedstrijden overzicht | Behouden | Lijst met tegenstander, datum, score |
| Wedstrijd detail | Behouden | Segmenten lijst met +/- |
| Wedstrijd verwijderen | Behouden | Confirmatie dialog |
| CSV export per wedstrijd | Behouden | Downloaden of delen |
| Leeg state | Behouden | "Nog geen afgeronde wedstrijden" melding |
| Score kleur | Behouden | Groen/rood/grijs op basis van +/- |

## Instellingen

| Functionaliteit | Status | Opmerking |
|-----------------|--------|-----------|
| Teamnaam | Behouden | Tekstveld |
| Logo upload | Behouden | File input, base64 opslag |
| Logo verwijderen | Behouden | Reset naar default icon |
| Primaire kleur | Behouden | 10 presets + custom picker |
| Accentkleur | Behouden | 10 presets + custom picker |
| Aantal periodes | Behouden | Number input (1-12) |
| Naam periode | Behouden | Tekstveld (bv. "Kwart") |
| Classificatie systeem | Behouden | Toggle aan/uit |
| Labels categorieën | Behouden | Tekstvelden |
| Basis limiet | Behouden | Number input (decimal) |
| Maximale bonus | Behouden | Number input (decimal) |
| Bonus per categorie | Behouden | Number inputs (decimal) |
| Standaardinstellingen | Behouden | Reset knop met confirmatie |
| Back-up export | Behouden | JSON download |
| Back-up import | Behouden | JSON upload met confirmatie |

## Data Opslag

| Functionaliteit | Status | Opmerking |
|-----------------|--------|-----------|
| localStorage actief | Behouden | Alle data lokaal |
| Auto-save | Behouden | Bij elke wijziging |
| Resume modal | Behouden | Bij herladen met opgeslagen wedstrijd |
| Hervatten wedstrijd | Behouden | State herstellen |
| Nieuwe wedstrijd | Behouden | State wissen na confirmatie |
| Back-up export | Behouden | Alle localStorage keys |
| Back-up import | Behouden | Overschrijft alle data |
| Service worker | Behouden | Offline caching |

## CSV Export

| Functionaliteit | Status | Opmerking |
|-----------------|--------|-----------|
| Nederlands altijd | Behouden | Onafhankelijk van interface taal |
| Segments sectie | Behouden | Opstellingen (+/-) |
| Minutes sectie | Behouden | Speeltijd per speler |
| Classificatie kolommen | Behouden | Alleen als systeem aan |
| Lineup code | Behouden | Gesorteerde rugnummers |
| Bestandsnaam format | Behouden | `{team}-{YYYYMMDD}-{HHmm}.csv` |
| Share/download | Behouden | Web Share API of download |

## i18n (Internationalization)

| Functionaliteit | Status | Opmerking |
|-----------------|--------|-----------|
| Nederlands | Behouden | Default taal |
| Engels | Behouden | Toggle knop |
| CSV altijd NL | Behouden | Hardcoded Nederlands |
| Alle UI teksten | Behouden | Vertaald via STRINGS object |
| Datum/tijd format | Behouden | Locale-afhankelijk |

## PWA

| Functionaliteit | Status | Opmerking |
|-----------------|--------|-----------|
| Manifest | Behouden | Installable |
| Service worker | Behouden | Offline app shell |
| Iconen | Behouden | 192x192 PNG |
| Theme color | Behouden | Dynamisch op basis van primaryColor |
| Apple touch icon | Behouden | iOS ondersteuning |

## Nieuw in v2 (voorgesteld)

| Functionaliteit | Status | Opmerking |
|-----------------|--------|-----------|
| Schema versie | Nieuw | Migratie ondersteuning |
| Back-up validatie | Nieuw | Type checking bij import |
| TypeScript types | Nieuw | Type safety |
| Modulaire architectuur | Nieuw | Domain/UI/Infrastructure scheiding |
| Cloud sync | Nieuw | Fase 4+ (optioneel) |
| Multi-device | Nieuw | Fase 6+ (optioneel) |
| Verbeterde tests | Nieuw | Deterministische Playwright tests |

## Bewust Niet in v2

| Functionaliteit | Status | Opmerking |
|-----------------|--------|-----------|
| Backend in fase 0-3 | Vervallen | Eerst lokale stabiliteit |
| Analytics/tracking | Vervallen | Privacy first |
| Echte spelersdata | Vervallen | Alleen fictieve data in tests |
| Netlify-specifiek | Vervallen | Platform-neutraal |
| Automatische deploy | Vervallen | Expliciete cutover nodig |

## Compatibiliteits Checklist

Voor iedere v2 release moet worden gecontroleerd:

### Data Compatibiliteit
- [ ] Bestaande localStorage data is leesbaar
- [ ] Back-up import werkt met oude exports
- [ ] CSV export is identiek voor dezelfde data
- [ ] Alle localStorage keys zijn behouden

### Functionaliteit Compatibiliteit
- [ ] Alle tabbladen werken hetzelfde
- [ ] Alle instellingen zijn beschikbaar
- [ ] Alle berekeningen geven dezelfde resultaten
- [ ] Alle validaties zijn behouden

### UI Compatibiliteit
- [ ] Nederlandse interface werkt
- [ ] Engelse interface werkt
- [ ] Mobiele weergave werkt
- [ ] Touchbediening werkt
- [ ] PWA installatie werkt

### Edge Cases
- [ ] Hervatten van opgeslagen wedstrijd
- [ ] Import van oude back-up
- [ ] Verwijderen van speler met historie
- [ ] Segment bewerken met score herberekening
- [ ] Wissels op 0 seconden

## Handmatig Narekenbare Voorbeelden

### Voorbeeld 1: Eenvoudige Wedstrijd

**Setup**:
- 5 spelers: #1 (3.0), #2 (2.5), #3 (3.5), #4 (2.0), #5 (3.0)
- Tegenstander: Team B
- 2 kwarten, clockDown

**Segment 1** (Q1, 10:00 → 7:00):
- Lineup: #1, #2, #3, #4, #5
- Duur: 3:00 = 180 seconden
- Punten voor: 8
- Punten tegen: 6
- Plusminus: +2

**Segment 2** (Q1, 7:00 → 4:00):
- Lineup: #1, #2, #3, #4, #5
- Duur: 3:00 = 180 seconden
- Punten voor: 6
- Punten tegen: 8
- Plusminus: -2

**Segment 3** (Q2, 10:00 → 6:00):
- Lineup: #1, #2, #3, #4, #5
- Duur: 4:00 = 240 seconden
- Punten voor: 10
- Punten tegen: 4
- Plusminus: +6

**Verwachte resultaten**:
- Totale score: 24 - 18 = +6
- Totale speeltijd per speler: 10:00 (600 seconden)
- Lineup code: "1-2-3-4-5" (alle segmenten)

### Voorbeeld 2: Classificatie Systeem

**Setup**:
- Speler #1: kl=3.0, vrouw=true, jeugd=false
- Speler #2: kl=2.5, vrouw=false, jeugd=true
- Speler #3: kl=3.5, vrouw=true, jeugd=true
- Speler #4: kl=2.0, vrouw=false, jeugd=false
- Speler #5: kl=3.0, vrouw=false, jeugd=false
- classBaseLimit: 14.5
- maxBonus: 2.5
- bonusTag1Only: 1.5
- bonusTag2Only: 1.0
- bonusBoth: 2.0

**Berekeningen**:
- Classificatie som: 3.0 + 2.5 + 3.5 + 2.0 + 3.0 = 14.0
- Bonus:
  - Speler #1: vrouw → +1.5
  - Speler #2: jeugd → +1.0
  - Speler #3: vrouw + jeugd → +2.0
  - Speler #4: geen → +0
  - Speler #5: geen → +0
  - Totaal: 4.5, maar maxBonus = 2.5 → bonus = 2.5
- Toegestane limiet: 14.5 + 2.5 = 17.0
- Binnen limiet: 14.0 ≤ 17.0 → OK

### Voorbeeld 3: Wissels

**Setup**:
- Start: #1, #2, #3, #4, #5 op het veld
- Bank: #6, #7, #8, #9, #10

**Actie 1**: Tik #2 (veld) → #2 geselecteerd
**Actie 2**: Tik #6 (bank) → wissel #2 ↔ #6
- Veld nu: #1, #6, #3, #4, #5
- pendingSwapLineup = [#1, #2, #3, #4, #5]

**Actie 3**: Tik #3 (veld) → #3 geselecteerd
**Actie 4**: Tik #7 (bank) → wissel #3 ↔ #7
- Veld nu: #1, #6, #7, #4, #5
- pendingSwapLineup blijft [#1, #2, #3, #4, #5]

**Actie 5**: "Klaar met wisselen" → kloktijd modal
- Tijd: 8:00
- Segment opslaan met pendingSwapLineup [#1, #2, #3, #4, #5]
- Duur: 10:00 → 8:00 = 2:00
- Nieuw segment start met huidige lineup [#1, #6, #7, #4, #5]

**Verwachte resultaten**:
- Segment 1: lineup [#1, #2, #3, #4, #5], duur 2:00
- Segment 2 start met lineup [#1, #6, #7, #4, #5]

### Voorbeeld 4: Stats Berekening

**Setup**:
- 2 wedstrijden in historie
- Speler #1 speelt in beide wedstrijden

**Wedstrijd A**:
- Segment 1: #1 speelt, 3:00, pf=8, pa=6 → pm=+2
- Segment 2: #1 speelt, 2:00, pf=6, pa=8 → pm=-2
- Segment 3: #1 speelt niet

**Wedstrijd B**:
- Segment 1: #1 speelt, 4:00, pf=10, pa=4 → pm=+6
- Segment 2: #1 speelt niet

**Berekeningen voor speler #1**:
- Totale speeltijd: 3:00 + 2:00 + 4:00 = 9:00 (540 seconden)
- Totale pm: +2 + (-2) + 6 = +6
- Gemiddelde tijd per wedstrijd: 9:00 / 2 = 4:30
- Gemiddelde pm per wedstrijd: +6 / 2 = +3.0
- Per 10 min pm: (6 * 600) / 540 = +6.7

## Risico's en Open Vragen

### Risico's
1. **CSV exacte matching**: Whitespace en quoting moeten identiek zijn
2. **localStorage migratie**: Oude data moet leesbaar blijven
3. **Berekeningsconsistentie**: Floating point fouten voorkomen
4. **Snapshot integriteit**: Historische spelers data behouden

### Open Vragen
1. **Clock direction per kwart**: Moet dit wisselbaar zijn?
2. **Segment overlapping**: Nooit toegestaan of configurable?
3. **Game editing**: Afgeronde wedstrijden aanpasbaar maken?
4. **Player deletion**: Soft delete implementeren?
5. **Multi-device conflicts**: Hoe om te gaan met gelijktijdige edits?

## Conclusie

De huidige app heeft een stabiele functionaliteit die grotendeels behouden moet blijven in v2. De belangrijkste wijzigingen zijn:
1. Modulaire architectuur voor onderhoudbaarheid
2. TypeScript voor type safety
3. Verbeterde tests voor regressie preventie
4. Schema versie voor migratie
5. Optionele cloud sync (fase 4+)

De kern van de app (wedstrijd registratie, berekeningen, CSV export) moet exact hetzelfde blijven werken om bestaande gebruikers niet te verwarren.

/**
 * Vertalingen van de weergave Spelers: on/off per speler (T4) en stints (T7).
 * Eigen bestand met eigen prefix `trendsPlayers*`; `strings.ts` spreidt
 * `trendsPlayersNl`/`trendsPlayersEn` in `nl` en `en`, dus de pariteitstest in
 * `tests/unit/i18n.spec.ts` dekt dit bestand ook.
 *
 * Plaatshouders: `{naam}`, `{on}`, `{off}`, `{time}`, enz. worden in de UI
 * ingevuld. Getalnotatie (decimale punt) volgt `domain/stats/format.ts`.
 */

export const trendsPlayersNl = {
  // ---- On/off ----
  trendsPlayersOnOffTitle: 'Op en af het veld',
  trendsPlayersOnLabel: 'Op het veld',
  trendsPlayersOffLabel: 'Af het veld',
  trendsPlayersPer10: 'per 10 min',
  trendsPlayersDiffLabel: 'Verschil (op − af)',
  trendsPlayersToneBetter: 'beter',
  trendsPlayersToneAround: 'rond gemiddelde',
  trendsPlayersToneWorse: 'slechter',
  trendsPlayersAll: 'Speelde alles',
  trendsPlayersAllHint: 'Geen minuten af het veld: er is geen af-waarde en geen oordeel.',
  trendsPlayersLow: 'Te weinig minuten aan één kant',
  trendsPlayersLowHint:
    'Op {on}, af {off}. Nodig: op minimaal {onMin}, af minimaal {offMin}. Geen oordeel; alleen de ruwe totalen.',
  trendsPlayersRawTotal: '{value} in {time}',
  trendsPlayersOnOffExplain:
    'Beschrijvend, geen oorzaak: het +/- per 10 min van het team met en zonder deze speler op het veld. Rond gemiddelde = verschil kleiner dan 1,0 per 10 min. Voor een oordeel moet de speler minstens de drempel uit de filterbalk op het veld hebben gestaan en minstens 10:00 af het veld (staat de drempel uit, dan geldt geen minimum).',
  trendsPlayersRowOnOff: 'Op {on} · Af {off} per 10',
  trendsPlayersRowAll: 'Speelde alles',
  trendsPlayersRowLow: 'Op/af: te weinig minuten',
  trendsPlayersRowLowOff: 'Op/af: slechts {time} af het veld, te weinig om te vergelijken',
  trendsPlayersRowLowOn: 'Op/af: slechts {time} op het veld, te weinig om te vergelijken',
  trendsPlayersAriaOnOff:
    '{naam}: op het veld {on} per 10 in {onTime}, af het veld {off} in {offTime}, verschil {diff}, {tone}',
  trendsPlayersAriaAll:
    '{naam}: op het veld {on} per 10 in {onTime}, speelde alles, geen af-waarde en geen oordeel',
  trendsPlayersAriaLow:
    '{naam}: op het veld {onTotal} in {onTime}, af het veld {offTotal} in {offTime}, te weinig minuten aan één kant, geen oordeel',

  // ---- Stints ----
  trendsPlayersStintsTitle: 'Stints',
  trendsPlayersStintsCount: 'Aantal',
  trendsPlayersStintsAvg: 'Gemiddeld',
  trendsPlayersStintsLongest: 'Langste',
  trendsPlayersStintsNone: 'Geen stints in deze selectie.',
  trendsPlayersStintsExplain:
    'Een stint is aaneengesloten tijd op het veld binnen één kwart. Een kwartgrens, een wissel, een tijdgat tussen twee segmenten of een segment met onbekende spelers (PARTIAL) beëindigt de stint. Segmenten van 0 s tellen niet mee.',
  trendsPlayersStintsUnreliable:
    'Let op: de volgorde van de segmenten is niet overal betrouwbaar (bijvoorbeeld na een correctie). Stints kunnen daardoor te kort of te lang uitvallen.',
  trendsPlayersStintsAria: '{naam}: {n} stints, gemiddeld {avg}, langste {longest}',
} as const;

export const trendsPlayersEn = {
  // ---- On/off ----
  trendsPlayersOnOffTitle: 'On and off the court',
  trendsPlayersOnLabel: 'On court',
  trendsPlayersOffLabel: 'Off court',
  trendsPlayersPer10: 'per 10 min',
  trendsPlayersDiffLabel: 'Difference (on − off)',
  trendsPlayersToneBetter: 'better',
  trendsPlayersToneAround: 'around average',
  trendsPlayersToneWorse: 'worse',
  trendsPlayersAll: 'Played all minutes',
  trendsPlayersAllHint: 'No minutes off the court: there is no off value and no judgement.',
  trendsPlayersLow: 'Too few minutes on one side',
  trendsPlayersLowHint:
    'On {on}, off {off}. Needed: on at least {onMin}, off at least {offMin}. No judgement; raw totals only.',
  trendsPlayersRawTotal: '{value} in {time}',
  trendsPlayersOnOffExplain:
    'Descriptive, not a cause: the team +/- per 10 min with and without this player on the court. Around average = difference smaller than 1.0 per 10 min. A judgement needs at least the filter-bar threshold on court and at least 10:00 off court (when the threshold is off, there is no minimum).',
  trendsPlayersRowOnOff: 'On {on} · Off {off} per 10',
  trendsPlayersRowAll: 'Played all minutes',
  trendsPlayersRowLow: 'On/off: too few minutes',
  trendsPlayersRowLowOff: 'On/off: only {time} off the floor, too little to compare',
  trendsPlayersRowLowOn: 'On/off: only {time} on the floor, too little to compare',
  trendsPlayersAriaOnOff:
    '{naam}: on court {on} per 10 in {onTime}, off court {off} in {offTime}, difference {diff}, {tone}',
  trendsPlayersAriaAll:
    '{naam}: on court {on} per 10 in {onTime}, played all minutes, no off value and no judgement',
  trendsPlayersAriaLow:
    '{naam}: on court {onTotal} in {onTime}, off court {offTotal} in {offTime}, too few minutes on one side, no judgement',

  // ---- Stints ----
  trendsPlayersStintsTitle: 'Stints',
  trendsPlayersStintsCount: 'Count',
  trendsPlayersStintsAvg: 'Average',
  trendsPlayersStintsLongest: 'Longest',
  trendsPlayersStintsNone: 'No stints in this selection.',
  trendsPlayersStintsExplain:
    'A stint is continuous time on the court within one quarter. A quarter boundary, a substitution, a time gap between two segments or a segment with unknown players (PARTIAL) ends the stint. Segments of 0 s are ignored.',
  trendsPlayersStintsUnreliable:
    'Note: the order of the segments is not reliable everywhere (for example after a correction). Stints may therefore come out too short or too long.',
  trendsPlayersStintsAria: '{naam}: {n} stints, average {avg}, longest {longest}',
} as const;

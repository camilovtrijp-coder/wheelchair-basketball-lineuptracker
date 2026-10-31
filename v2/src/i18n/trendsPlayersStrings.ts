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
    'Op {on}, af {off}. Elke kant heeft minimaal {min} nodig. Geen oordeel; alleen de ruwe totalen.',
  trendsPlayersRawTotal: '{value} in {time}',
  trendsPlayersOnOffExplain:
    'Beschrijvend, geen oorzaak: het +/- per 10 min van het team met en zonder deze speler op het veld. Rond gemiddelde = verschil kleiner dan 1.0 per 10 min. De drempel uit de filterbalk geldt voor beide kanten.',
  trendsPlayersRowOnOff: 'Op {on} · Af {off} per 10',
  trendsPlayersRowAll: 'Speelde alles',
  trendsPlayersRowLow: 'Op/af: te weinig minuten',
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
    'Een stint is aaneengesloten tijd op het veld binnen één kwart. Een kwartgrens of een wissel beëindigt de stint.',
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
    'On {on}, off {off}. Each side needs at least {min}. No judgement; raw totals only.',
  trendsPlayersRawTotal: '{value} in {time}',
  trendsPlayersOnOffExplain:
    'Descriptive, not a cause: the team +/- per 10 min with and without this player on the court. Around average = difference smaller than 1.0 per 10 min. The threshold from the filter bar applies to both sides.',
  trendsPlayersRowOnOff: 'On {on} · Off {off} per 10',
  trendsPlayersRowAll: 'Played all minutes',
  trendsPlayersRowLow: 'On/off: too few minutes',
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
    'A stint is continuous time on the court within one quarter. A quarter boundary or a substitution ends the stint.',
  trendsPlayersStintsUnreliable:
    'Note: the order of the segments is not reliable everywhere (for example after a correction). Stints may therefore come out too short or too long.',
  trendsPlayersStintsAria: '{naam}: {n} stints, average {avg}, longest {longest}',
} as const;

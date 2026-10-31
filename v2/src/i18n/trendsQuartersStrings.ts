/**
 * Vertalingen van de Trends-weergave "Kwarten" (plan docs/pr-trends-lineups-plan.md,
 * stap T5). Eigen bestand zodat parallelle stappen geen merge-conflicten geven;
 * `strings.ts` spreidt `trendsQuartersNl`/`trendsQuartersEn` in `nl` en `en`.
 * Plaatshouders ({n}, {time}, ...) worden in de UI ingevuld. Getalnotatie
 * (decimale punt) volgt `domain/stats/format.ts`.
 */

export const trendsQuartersNl = {
  trendsQuartersTitlePer10: 'Kwarten: +/- per 10 min',
  trendsQuartersTitleTotal: 'Kwarten: +/- totaal',
  trendsQuartersHint:
    'Alle lineups samen, per kwart. Het verschil met het teamgemiddelde staat er klein bij.',
  trendsQuartersTeamAvg: 'Teamgemiddelde van deze selectie: {value} per 10 min',
  trendsQuartersListLabel: 'Resultaat per kwart',
  trendsQuartersRowName: 'Kwart {n}',
  trendsQuartersNoData: 'geen data',
  trendsQuartersGames: '{n} wedstr.',
  trendsQuartersForAgainstPer10: 'Voor {pf} · Tegen {pa} per 10 min',
  trendsQuartersForAgainstTotal: 'Voor {pf} · Tegen {pa} totaal',
  trendsQuartersVsTeam: '{delta} per 10 min t.o.v. team',
  trendsQuartersAriaPer10: 'Kwart {n}, {time}, {value} per 10 minuten, {tone}',
  trendsQuartersAriaTotal: 'Kwart {n}, {time}, {value} totaal, {tone}',
  trendsQuartersAriaNoData: 'Kwart {n}, geen data',
  trendsQuartersLegend:
    '▲ positief · ● rond 0 (minder dan 0,5 per 10 min) · ▼ negatief. De toon volgt het teken van +/- per 10 min; het verschil met het team staat er klein bij. Beschrijvend: per 10 min is geen balbezitcorrectie.',
  trendsQuartersMinTitle: 'Minuten per kwart per speler',
  trendsQuartersMinHint:
    'Gemiddeld per gespeelde wedstrijd van de speler (m:ss). Donkerder = meer minuten; de tijden staan er altijd bij.',
  trendsQuartersMinRegion:
    'Tabel met gemiddelde minuten per kwart per speler, horizontaal scrollbaar',
  trendsQuartersColPlayer: 'Speler',
  trendsQuartersColShort: 'K{n}',
  trendsQuartersColFull: 'Kwart {n}',
  trendsQuartersMinNone: 'Geen speler met speeltijd in deze selectie.',
  trendsQuartersEmptyNoDataTitle: 'Nog geen kwartdata',
  trendsQuartersEmptyNoDataText:
    'Speel en rond een wedstrijd af, of kies andere wedstrijden, om hier per kwart het resultaat en de speelminuten te zien.',
} as const;

export const trendsQuartersEn = {
  trendsQuartersTitlePer10: 'Quarters: +/- per 10 min',
  trendsQuartersTitleTotal: 'Quarters: +/- total',
  trendsQuartersHint:
    'All lineups together, per quarter. The difference with the team average is shown in small text.',
  trendsQuartersTeamAvg: 'Team average of this selection: {value} per 10 min',
  trendsQuartersListLabel: 'Result per quarter',
  trendsQuartersRowName: 'Quarter {n}',
  trendsQuartersNoData: 'no data',
  trendsQuartersGames: '{n} games',
  trendsQuartersForAgainstPer10: 'For {pf} · Against {pa} per 10 min',
  trendsQuartersForAgainstTotal: 'For {pf} · Against {pa} total',
  trendsQuartersVsTeam: '{delta} per 10 min vs team',
  trendsQuartersAriaPer10: 'Quarter {n}, {time}, {value} per 10 minutes, {tone}',
  trendsQuartersAriaTotal: 'Quarter {n}, {time}, {value} total, {tone}',
  trendsQuartersAriaNoData: 'Quarter {n}, no data',
  trendsQuartersLegend:
    '▲ positive · ● around zero (less than 0.5 per 10 min) · ▼ negative. The tone follows the sign of +/- per 10 min; the difference with the team is shown in small text. Descriptive: per 10 min is not a possession adjustment.',
  trendsQuartersMinTitle: 'Minutes per quarter per player',
  trendsQuartersMinHint:
    'Average per game the player played (m:ss). Darker = more minutes; the times are always shown.',
  trendsQuartersMinRegion: 'Table of average minutes per quarter per player, scrolls horizontally',
  trendsQuartersColPlayer: 'Player',
  trendsQuartersColShort: 'Q{n}',
  trendsQuartersColFull: 'Quarter {n}',
  trendsQuartersMinNone: 'No player with playing time in this selection.',
  trendsQuartersEmptyNoDataTitle: 'No quarter data yet',
  trendsQuartersEmptyNoDataText:
    'Play and finish a game, or select other games, to see the result and playing minutes per quarter here.',
} as const;

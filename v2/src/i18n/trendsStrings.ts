/**
 * Vertalingen van de herindeelde Trends-tab (plan docs/pr-trends-lineups-plan.md,
 * stappen T2/T3). Eigen bestand zodat parallelle vervolgstappen (T4 t/m T7)
 * elk hun eigen, duidelijk afgebakende blok kunnen uitbreiden zonder de grote
 * `strings.ts` te raken. Alle sleutels beginnen met `trends`; `strings.ts`
 * spreidt `trendsNl`/`trendsEn` in respectievelijk `nl` en `en`, dus de
 * pariteitstest in `tests/unit/i18n.spec.ts` dekt dit bestand ook.
 *
 * Plaatshouders: `{n}`, `{min}`, `{time}`, enz. worden in de UI ingevuld.
 * Getalnotatie (decimale punt) volgt `domain/stats/format.ts`.
 */

export const trendsNl = {
  // ---- Schil: weergaven (tablist) en filterbalk (T3) ----
  trendsViewsLabel: 'Weergave',
  trendsViewOverview: 'Overzicht',
  trendsViewLineups: 'Lineups',
  trendsViewPlayers: 'Spelers',
  trendsViewQuarters: 'Kwarten',
  trendsFilterLabel: 'Filters',
  trendsFilterThreshold: 'Drempel',
  trendsFilterThresholdOff: 'uit',
  trendsFilterThresholdTitle:
    'Minimale speeltijd (over alle gekozen wedstrijden samen) voordat een lineup in de ranglijst staat. Tik om te wisselen: uit, 3:00, 5:00, 10:00.',
  trendsFilterLast5: 'Laatste 5',
  trendsFilterLast5Title:
    'Kies de 5 nieuwste afgeronde wedstrijden. Dit wedstrijdfilter geldt ook in Statistieken.',
  trendsFilterNoCompleted: 'Er zijn nog geen afgeronde wedstrijden.',
  trendsFilterThisGame: 'Deze wedstrijd',
  trendsFilterThisGameTitle:
    'Kies alleen de lopende wedstrijd. Dit wedstrijdfilter geldt ook in Statistieken.',
  trendsFilterThisGameDisabled: 'Er is geen lopende wedstrijd met gespeelde segmenten.',
  trendsFilterSharedNote: 'Deze wedstrijdselectie geldt ook in Statistieken.',

  // ---- Gedeeld ----
  trendsUnitPer10: 'per 10 min',
  trendsUnitTotal: 'totaal',
  trendsGamesOne: '1 wedstrijd',
  trendsGamesMany: '{n} wedstrijden',
  trendsFor: 'Voor',
  trendsAgainst: 'Tegen',

  // ---- Overzicht ----
  trendsOverviewTeamTitle: 'Team',
  trendsOverviewPlayTime: '{time} speeltijd',
  trendsOverviewPm: '+/-',
  trendsOverviewTov: 'Turnovers',
  trendsOverviewNoTime: 'Nog geen speeltijd in de gekozen wedstrijden.',

  // ---- Lineups (T2) ----
  trendsLineupMetricLabel: 'Meetwaarde',
  trendsLineupMetricPm: '+/-',
  trendsLineupMetricPfPa: 'Voor/Tegen',
  trendsLineupMetricTov: 'Turnovers',
  trendsLineupTitlePm: 'Lineups: +/- per 10 min',
  trendsLineupTitlePmTotal: 'Lineups: +/- totaal',
  trendsLineupTitlePfPa: 'Lineups: voor en tegen per 10 min',
  trendsLineupTitlePfPaTotal: 'Lineups: voor en tegen totaal',
  trendsLineupTitleTovTotal: 'Lineups: turnovers totaal',
  trendsLineupHintPm: 'Hoogste is het beste',
  trendsLineupHintPfPa: 'Voor: hoger is beter. Tegen: lager is beter.',
  trendsLineupTeamAvg: 'Teamgemiddelde {value} per 10 min',
  trendsLineupExplain:
    'Beschrijvend: wat gebeurde er met deze vijf op het veld. Minder dan 5 minuten zegt bijna niets. Per 10 min is geen balbezitcorrectie.',
  trendsLineupLegend: '▲ beter dan team · ● rond gemiddelde · ▼ slechter dan team',
  trendsLineupToneBetter: 'beter dan team',
  trendsLineupToneAround: 'rond gemiddelde',
  trendsLineupToneWorse: 'slechter dan team',
  trendsLineupListLabel: 'Lineups',
  trendsLineupVsTeam: '{delta} t.o.v. team ({team})',
  trendsLineupPer10Of: '{value} per 10 min',
  trendsLineupAriaPm: '{lineup}, {time}, {value} per 10 minuten, {tone}',
  trendsLineupAriaPfPa:
    '{lineup}, {time}, voor {pf} per 10 minuten, {pfTone}, tegen {pa} per 10 minuten, {paTone}',
  trendsLineupAriaTov: '{lineup}, {time}, {value} turnovers per 10 minuten, {tone}',
  trendsLineupLowTitle: 'Te weinig data ({n} lineups onder {min})',
  trendsLineupLowTitleOne: 'Te weinig data (1 lineup onder {min})',
  trendsLineupLowHint: 'Te weinig minuten voor een betrouwbare waarde per 10 min.',
  trendsLineupLowPm: '{value} in {time}',
  trendsLineupLowPfPa: 'Voor {pf} · Tegen {pa} in {time}',
  trendsLineupLowTov: 'Turnovers: {n} in {time}',
  trendsLineupNoThresholdWarning:
    'Zonder drempel kunnen lineups van 2 of 3 minuten bovenaan staan. Dat zegt statistisch weinig.',
  trendsLineupNoneAbove: 'Geen lineup boven de drempel van {min}.',

  // ---- Spelers (T3; T4 voegt on/off toe) ----
  trendsPlayersListLabel: 'Spelers',
  trendsPlayerRowTov: 'TO',

  // ---- Kwarten (T3 lege staat; T5 vult de weergave) ----
  trendsQuartersEmptyTitle: 'Kwarten komen eraan',
  trendsQuartersEmptyText:
    'Deze weergave toont straks per kwart het resultaat en de speelminuten. Dat wordt in een volgende stap toegevoegd.',
} as const;

export const trendsEn = {
  // ---- Shell: views (tablist) and filter bar (T3) ----
  trendsViewsLabel: 'View',
  trendsViewOverview: 'Overview',
  trendsViewLineups: 'Lineups',
  trendsViewPlayers: 'Players',
  trendsViewQuarters: 'Quarters',
  trendsFilterLabel: 'Filters',
  trendsFilterThreshold: 'Threshold',
  trendsFilterThresholdOff: 'off',
  trendsFilterThresholdTitle:
    'Minimum playing time (across all selected games combined) before a lineup is ranked. Tap to switch: off, 3:00, 5:00, 10:00.',
  trendsFilterLast5: 'Last 5',
  trendsFilterLast5Title:
    'Select the 5 most recent finished games. This game filter also applies in Statistics.',
  trendsFilterNoCompleted: 'There are no finished games yet.',
  trendsFilterThisGame: 'This game',
  trendsFilterThisGameTitle:
    'Select only the game in progress. This game filter also applies in Statistics.',
  trendsFilterThisGameDisabled: 'There is no game in progress with played segments.',
  trendsFilterSharedNote: 'This game selection also applies in Statistics.',

  // ---- Shared ----
  trendsUnitPer10: 'per 10 min',
  trendsUnitTotal: 'total',
  trendsGamesOne: '1 game',
  trendsGamesMany: '{n} games',
  trendsFor: 'For',
  trendsAgainst: 'Against',

  // ---- Overview ----
  trendsOverviewTeamTitle: 'Team',
  trendsOverviewPlayTime: '{time} playing time',
  trendsOverviewPm: '+/-',
  trendsOverviewTov: 'Turnovers',
  trendsOverviewNoTime: 'No playing time yet in the selected games.',

  // ---- Lineups (T2) ----
  trendsLineupMetricLabel: 'Metric',
  trendsLineupMetricPm: '+/-',
  trendsLineupMetricPfPa: 'For/Against',
  trendsLineupMetricTov: 'Turnovers',
  trendsLineupTitlePm: 'Lineups: +/- per 10 min',
  trendsLineupTitlePmTotal: 'Lineups: +/- total',
  trendsLineupTitlePfPa: 'Lineups: for and against per 10 min',
  trendsLineupTitlePfPaTotal: 'Lineups: for and against total',
  trendsLineupTitleTovTotal: 'Lineups: turnovers total',
  trendsLineupHintPm: 'Highest is best',
  trendsLineupHintPfPa: 'For: higher is better. Against: lower is better.',
  trendsLineupTeamAvg: 'Team average {value} per 10 min',
  trendsLineupExplain:
    'Descriptive: what happened with these five on court. Under 5 minutes tells you almost nothing. Per 10 min is not a possession adjustment.',
  trendsLineupLegend: '▲ better than team · ● around average · ▼ worse than team',
  trendsLineupToneBetter: 'better than team',
  trendsLineupToneAround: 'around average',
  trendsLineupToneWorse: 'worse than team',
  trendsLineupListLabel: 'Lineups',
  trendsLineupVsTeam: '{delta} vs team ({team})',
  trendsLineupPer10Of: '{value} per 10 min',
  trendsLineupAriaPm: '{lineup}, {time}, {value} per 10 minutes, {tone}',
  trendsLineupAriaPfPa:
    '{lineup}, {time}, for {pf} per 10 minutes, {pfTone}, against {pa} per 10 minutes, {paTone}',
  trendsLineupAriaTov: '{lineup}, {time}, {value} turnovers per 10 minutes, {tone}',
  trendsLineupLowTitle: 'Too little data ({n} lineups under {min})',
  trendsLineupLowTitleOne: 'Too little data (1 lineup under {min})',
  trendsLineupLowHint: 'Too few minutes for a reliable per-10-min value.',
  trendsLineupLowPm: '{value} in {time}',
  trendsLineupLowPfPa: 'For {pf} · Against {pa} in {time}',
  trendsLineupLowTov: 'Turnovers: {n} in {time}',
  trendsLineupNoThresholdWarning:
    'Without a threshold, lineups of 2 or 3 minutes can end up on top. That says very little statistically.',
  trendsLineupNoneAbove: 'No lineup above the {min} threshold.',

  // ---- Players (T3; T4 adds on/off) ----
  trendsPlayersListLabel: 'Players',
  trendsPlayerRowTov: 'TO',

  // ---- Quarters (T3 empty state; T5 fills the view) ----
  trendsQuartersEmptyTitle: 'Quarters are coming',
  trendsQuartersEmptyText:
    'This view will soon show the result and playing minutes per quarter. It is added in a later step.',
} as const;

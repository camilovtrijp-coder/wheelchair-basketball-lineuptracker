/**
 * Vertalingen van de inklapbare filterbalk van Trends (samenvattingsregel en
 * knop "Filters"). Eigen bestand, append-only gespreid in `strings.ts`
 * (`trendsFilterSummaryNl` / `trendsFilterSummaryEn`). Plaatshouders ({n},
 * {total}, {value}) worden in de UI ingevuld.
 */

export const trendsFilterSummaryNl = {
  trendsFilterSummaryButton: 'Filters',
  trendsFilterSummaryButtonTitle: 'Filters tonen of verbergen',
  trendsFilterSummaryPer10: 'Per 10 min',
  trendsFilterSummaryTotal: 'Totaal',
  trendsFilterSummaryGamesOf: '{n} van {total} wedstrijden',
  trendsFilterSummaryThreshold: 'Drempel {value}',
  trendsFilterSummaryFiltered: 'Gefilterd',
};

export const trendsFilterSummaryEn: typeof trendsFilterSummaryNl = {
  trendsFilterSummaryButton: 'Filters',
  trendsFilterSummaryButtonTitle: 'Show or hide filters',
  trendsFilterSummaryPer10: 'Per 10 min',
  trendsFilterSummaryTotal: 'Total',
  trendsFilterSummaryGamesOf: '{n} of {total} games',
  trendsFilterSummaryThreshold: 'Threshold {value}',
  trendsFilterSummaryFiltered: 'Filtered',
};

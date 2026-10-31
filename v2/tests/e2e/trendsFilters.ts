import type { Page } from '@playwright/test';

/**
 * De filterchips van Trends staan in een inklapbaar paneel (standaard dicht, alleen in de DOM
 * als het open is). Open het paneel via de knop "Filters" voordat een chip wordt gebruikt;
 * herhaald aanroepen is veilig.
 */
export async function openTrendsFilters(page: Page): Promise<void> {
  const toggle = page.getByTestId('trends-filters-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

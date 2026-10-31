import { fireEvent } from '@testing-library/preact';

/**
 * De filterchips van Trends staan in een inklapbaar paneel (standaard dicht) en zijn alleen in
 * de DOM als het open is. Deze hulpen openen het paneel (eenmalig) en geven dan de chip terug.
 */
interface Queries {
  getByTestId: (id: string) => HTMLElement;
  queryByTestId: (id: string) => HTMLElement | null;
}

export function openFilters(q: Queries): void {
  const toggle = q.queryByTestId('trends-filters-toggle');
  if (toggle !== null && toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
}

export function chip(q: Queries, id: string): HTMLElement {
  openFilters(q);
  return q.getByTestId(id);
}

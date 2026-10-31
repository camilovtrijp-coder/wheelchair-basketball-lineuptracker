import type { AnalysisGame } from './types';

/**
 * Schoont het GEDEELDE wedstrijdfilter (Stats + Trends) op tegen de wedstrijden
 * die er nu zijn (`AnalysisGame[]`: afgerond + lopend).
 *
 * Waarom: een afgeronde wedstrijd krijgt bij het afronden een NIEUWE id
 * (`finishGame`: `id: newId()`, `sourceGameId: game.id`), terwijl een selectie
 * die via "Deze wedstrijd" is gemaakt nog de id van de lopende wedstrijd
 * bevat. Zonder opschonen toont de app dan "0 wedstrijden" terwijl de chip
 * "Wedstrijden (1)" blijft staan. Ook een weggegooide of (cloud) verwijderde
 * wedstrijd mag de selectie niet leeg achterlaten.
 *
 * Regels:
 * - een id die in `games` voorkomt blijft staan, behalve als het de id van een
 *   LOPENDE wedstrijd is waarvan ondertussen een afgeronde wedstrijd met
 *   dezelfde `sourceGameId` bestaat (dan wordt hij vertaald);
 * - een id die niet voorkomt maar als `sourceGameId` van een afgeronde
 *   wedstrijd voorkomt, wordt vertaald naar de id van die afgeronde wedstrijd;
 * - overige (onbekende) id's vervallen;
 * - `null` ("alles") blijft `null`;
 * - bleef er van een NIET-lege selectie niets over, dan wordt het `null`
 *   ("alles", het standaardgedrag);
 * - een bewust lege selectie (de gebruiker zette alle vinkjes uit) blijft
 *   leeg: dat is een eigen keuze, geen verouderde selectie;
 * - is er niets om tegen te toetsen (`games` leeg: bijv. leesfout of nog niet
 *   geladen), dan blijft de selectie ongemoeid.
 *
 * Geeft dezelfde `Set`-instantie terug wanneer er niets verandert, zodat
 * aanroepers met een identiteitsvergelijking kunnen bepalen of er iets te
 * schrijven valt.
 */
export function sanitizeGameSelection(
  selection: Set<string> | null,
  games: readonly AnalysisGame[],
): Set<string> | null {
  if (selection === null || selection.size === 0 || games.length === 0) return selection;
  const byId = new Map(games.map((g) => [g.id, g] as const));
  const bySource = new Map<string, string>();
  for (const g of games) {
    if (!g.isCurrent && typeof g.sourceGameId === 'string' && !bySource.has(g.sourceGameId)) {
      bySource.set(g.sourceGameId, g.id);
    }
  }
  const next = new Set<string>();
  let changed = false;
  for (const id of selection) {
    const known = byId.get(id);
    const translated = bySource.get(id);
    if (known !== undefined && !(known.isCurrent && translated !== undefined)) {
      next.add(id);
      continue;
    }
    changed = true;
    if (translated !== undefined) next.add(translated);
  }
  if (!changed) return selection;
  return next.size === 0 ? null : next;
}

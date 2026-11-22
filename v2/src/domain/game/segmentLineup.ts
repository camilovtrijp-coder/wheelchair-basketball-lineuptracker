import { playerBonus, type ClassificationConfig } from './tracking';
import type { GamePlayer } from './types';

/**
 * PR 7.7a (docs/pr-7.7-plan.md §C.1): zuivere hulpfuncties om de lineup van een
 * segment van een afgeronde wedstrijd te corrigeren. Geen opslag, geen DOM.
 */

/** Aantal spelers in een lineup (v1: altijd exact 5). */
export const LINEUP_SIZE = 5;

/** Twee lineups bevatten dezelfde spelers (volgorde doet er niet toe). */
export function sameLineupSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = (l: readonly string[]) => [...l].sort();
  const sa = sorted(a);
  const sb = sorted(b);
  return sa.every((id, i) => id === sb[i]);
}

/**
 * Geldige nieuwe lineup: exact 5 unieke speler-ID's, allemaal in het
 * spelerssnapshot en alleen spelers die meededen (`participate`). Een speler
 * die al in de oorspronkelijke lineup stond blijft altijd toegestaan, zodat een
 * oudere wedstrijd een ongewijzigde speler niet blokkeert.
 */
export function isValidCorrectedLineup(
  lineup: unknown,
  players: readonly GamePlayer[],
  currentLineup: readonly string[],
): lineup is string[] {
  if (!Array.isArray(lineup) || lineup.length !== LINEUP_SIZE) return false;
  if (!lineup.every((id) => typeof id === 'string' && id !== '')) return false;
  if (new Set(lineup).size !== LINEUP_SIZE) return false;
  return lineup.every((id) => {
    if (currentLineup.includes(id)) return true;
    const p = players.find((pl) => pl.id === id);
    return p !== undefined && p.participate;
  });
}

/** Som van de klassen (v1: `sumClass`); 0 als het klassegrenssysteem uit stond. */
export function lineupClassSum(
  lineup: readonly string[],
  players: readonly GamePlayer[],
  useClassLimit: boolean,
): number {
  if (!useClassLimit) return 0;
  const total = lineup.reduce((sum, id) => {
    const p = players.find((pl) => pl.id === id);
    const v = p ? parseFloat(p.kl) : Number.NaN;
    return sum + (Number.isNaN(v) ? 0 : v);
  }, 0);
  return Math.round(total * 1000) / 1000;
}

function lineupBonus(
  lineup: readonly string[],
  players: readonly GamePlayer[],
  config: ClassificationConfig,
): number {
  if (!config.useClassLimit) return 0;
  const total = lineup.reduce(
    (sum, id) =>
      sum +
      playerBonus(
        players.find((pl) => pl.id === id),
        config,
      ),
    0,
  );
  return Math.min(config.maxBonus, total);
}

/**
 * Variant A (docs/pr-7.7-plan.md §F.2): de toegestane som van het segment
 * wordt bijgesteld met het bonusverschil tussen nieuwe en oude lineup volgens
 * de HUIDIGE instellingen. De oorspronkelijke klassegrens van de wedstrijd is
 * niet bewaard, dus `oldAllowed` blijft de basis.
 */
export function adjustedAllowed(
  oldAllowed: number,
  oldLineup: readonly string[],
  newLineup: readonly string[],
  players: readonly GamePlayer[],
  config: ClassificationConfig,
): number {
  const delta = lineupBonus(newLineup, players, config) - lineupBonus(oldLineup, players, config);
  return Math.round((oldAllowed + delta) * 1000) / 1000;
}

/** v1: een segment is "over" als de som de toegestane som overschrijdt. */
export function isOverAllowed(classSum: number, allowed: number): boolean {
  return classSum > allowed + 0.001;
}

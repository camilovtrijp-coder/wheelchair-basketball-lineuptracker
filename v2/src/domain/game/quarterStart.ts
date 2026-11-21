import type { ActiveGame } from './types';
import { isOverLimit, type ClassificationConfig } from './tracking';
import { lineupDiff } from './rotationPlan';

/**
 * Keuze van de opstelling voor het volgende kwart bij "Einde kwart" (bouwplan R3). Pure
 * weergave- en keuzehulp bovenop `closeQuarter({ nextOnCourt })`; geen opslag, geen
 * datacontractwijziging. Drie opties: zoals het veld nu staat, volgens het wisselschema
 * (alleen als er voor dat kwart een blok is) of zelf samenstellen. Een te hoge klassesom
 * waarschuwt, maar blokkeert niet.
 */
export type QuarterStartKind = 'field' | 'plan' | 'custom';

export const QUARTER_LINEUP_SIZE = 5;

export interface QuarterStartOption {
  kind: QuarterStartKind;
  /** Opstelling van deze optie (bij `custom`: de huidige selectie, mogelijk nog geen 5). */
  lineup: string[];
  /** Wie er t.o.v. de huidige vloer bijkomt/afgaat (game-player-id's). */
  ins: string[];
  outs: string[];
  /** Klassesom; `null` zolang de opstelling nog niet uit 5 spelers bestaat. */
  sum: number | null;
  allowed: number | null;
  over: boolean;
}

/** Standaardkeuze: het schema als dat er is (gedrag van vóór R3), anders het veld. */
export function defaultQuarterStartKind(planLineup: string[] | null): QuarterStartKind {
  return planLineup != null ? 'plan' : 'field';
}

/** De opties in vaste volgorde; `plan` ontbreekt zonder schema-opstelling voor dat kwart. */
export function quarterStartOptions(
  game: ActiveGame,
  classification: ClassificationConfig,
  planLineup: string[] | null,
  custom: string[],
): QuarterStartOption[] {
  function build(kind: QuarterStartKind, lineup: string[]): QuarterStartOption {
    const { ins, outs } = lineupDiff(game.onCourt, lineup);
    if (lineup.length !== QUARTER_LINEUP_SIZE) {
      return { kind, lineup, ins, outs, sum: null, allowed: null, over: false };
    }
    const limit = isOverLimit(game, lineup, classification);
    return { kind, lineup, ins, outs, sum: limit.sum, allowed: limit.allowed, over: limit.over };
  }
  const options: QuarterStartOption[] = [build('field', [...game.onCourt])];
  if (planLineup != null) options.push(build('plan', [...planLineup]));
  options.push(build('custom', [...custom]));
  return options;
}

/**
 * Wat meegaat naar `closeQuarter`: `undefined` = geen `nextOnCourt` (veld blijft), een lijst van 5 = die
 * opstelling, `null` = ongeldige keuze (zelf samenstellen zonder precies 5 spelers).
 */
export function resolveQuarterStart(
  kind: QuarterStartKind,
  planLineup: string[] | null,
  custom: string[],
): string[] | undefined | null {
  if (kind === 'field') return undefined;
  if (kind === 'plan') return planLineup != null ? [...planLineup] : undefined;
  return custom.length === QUARTER_LINEUP_SIZE ? [...custom] : null;
}

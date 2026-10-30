import { segmentTurnovers } from './tracking';
import type { Segment } from './types';

/** Totaal aantal eigen turnovers over een lijst segmenten (ontbrekend veld telt als 0). */
export function sumTurnovers(segments: readonly Pick<Segment, 'tov'>[]): number {
  return segments.reduce((total, s) => total + segmentTurnovers(s), 0);
}

/** Totale speeltijd (in seconden) over een lijst segmenten. */
export function totalSegmentSeconds(segments: readonly Pick<Segment, 'durSec'>[]): number {
  return segments.reduce((total, s) => total + s.durSec, 0);
}

/**
 * Turnovers per 10 minuten speeltijd: `turnovers / (seconden / 60) * 10`.
 * `null` bij 0 (of negatieve) speeltijd, want dan is de verhouding niet te bepalen.
 */
export function turnoversPer10(turnovers: number, seconds: number): number | null {
  if (!(seconds > 0)) return null;
  return (turnovers / (seconds / 60)) * 10;
}

/** Eén decimaal met punt (zoals `fmtPlusMinus`), of '–' als er geen waarde is. */
export function fmtTurnoversPer10(value: number | null): string {
  return value === null ? '–' : value.toFixed(1);
}

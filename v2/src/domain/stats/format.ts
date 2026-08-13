import type { LineupCombinationStats } from './types';

/**
 * PR 6.4 — pure weergavewaarden, conform docs/pr-6.4-plan.md §D.6.4a. Geen
 * bronberekeningen, alleen formattering voor de UI. Bewust locale-neutraal
 * zodat de UI zelf de juiste taal en cijferopmaak kan kiezen.
 */

/** v1: `fmt()` — seconden naar `M:SS` (of `-M:SS` bij negatief). */
export function fmtSeconds(sec: number): string {
  const neg = sec < 0;
  const abs = Math.abs(sec);
  const m = Math.floor(abs / 60);
  const s = Math.floor(abs % 60);
  return `${neg ? '-' : ''}${m}:${String(s).padStart(2, '0')}`;
}

/**
 * v1: `fmtPM()` — plus/min met één decimaal, teken expliciet. Geeft "0.0"
 * voor een exacte nul, "+0.0" zou verwarrend zijn voor een lege rij.
 */
export function fmtPlusMinus(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(1)}`;
}

/**
 * Geeft een badge-class terug voor de plus/min-badge: 'pos', 'neg' of 'neu'
 * (v1: `c.num > 0 ? "pos" : c.num < 0 ? "neg" : "neu"`). De UI bindt die
 * op een bestaande `live-pm--*`-stijlklasse (zie HistoryPanel/segment-item).
 */
export function pmClass(n: number): 'pos' | 'neg' | 'flat' {
  if (n > 0) return 'pos';
  if (n < 0) return 'neg';
  return 'flat';
}

export function totalsRow(combo: LineupCombinationStats): {
  time: string;
  pointsFor: number;
  pointsAgainst: number;
  onShown: number;
  offShown: number;
} {
  return {
    time: fmtSeconds(combo.onSec),
    pointsFor: combo.onPF,
    pointsAgainst: combo.onPA,
    onShown: combo.onPF - combo.onPA,
    offShown: combo.offPF - combo.offPA,
  };
}

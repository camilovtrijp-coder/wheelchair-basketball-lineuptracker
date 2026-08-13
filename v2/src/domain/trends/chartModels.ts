/**
 * PR 6.5 §C.3/§D 6.5a — pure lijn-/balkmodellen, los van Preact/DOM. De UI
 * rekent geen statistiek opnieuw uit; deze functies leveren kant-en-klare
 * coördinaten/percentages op basis van al berekende `TrendPoint`-waarden.
 * Spiegelt v1's `pmLineChartSvg()` en `minutesBarChartHtml()`.
 */

export interface LineChartPoint {
  x: number;
  y: number;
  value: number;
  provisional: boolean;
}

export interface LineChartModel {
  width: number;
  height: number;
  /** Y-coördinaat van de nullijn (plan §C.3: symmetrische schaal rond nul). */
  zeroY: number;
  points: LineChartPoint[];
}

/**
 * Plus/min-lijngrafiek. Symmetrische schaal rond nul met een minimumrange
 * van 1 (plan §C.3, v1: `Math.max(1, Math.max.apply(null, vals.map(Math.abs)))`).
 */
export function buildPlusMinusLineChart(
  points: readonly { value: number; provisional: boolean }[],
): LineChartModel {
  const width = 300;
  const height = 70;
  const pad = 6;
  const maxAbs = Math.max(1, ...points.map((p) => Math.abs(p.value)));
  const zeroY = height / 2;
  const scaleY = (height / 2 - pad) / maxAbs;
  const stepX = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const coords: LineChartPoint[] = points.map((p, i) => ({
    x: pad + i * stepX,
    y: zeroY - p.value * scaleY,
    value: p.value,
    provisional: p.provisional,
  }));
  return { width, height, zeroY, points: coords };
}

export interface BarChartBar {
  minutes: number;
  /** Percentage van het gedeelde maximum, met een minimum van 5% (v1-pariteit: altijd zichtbaar). */
  pct: number;
  provisional: boolean;
}

export interface BarChartModel {
  bars: BarChartBar[];
}

/**
 * Speeltijdbalken op één gedeeld maximum over alle zichtbare spelers en
 * wedstrijden (plan §C.3), zodat kaarten onderling vergelijkbaar blijven.
 */
export function buildMinutesBarChart(
  points: readonly { minutes: number; provisional: boolean }[],
  sharedMaxMinutes: number,
): BarChartModel {
  const maxMin = Math.max(1, sharedMaxMinutes);
  const bars: BarChartBar[] = points.map((p) => ({
    minutes: p.minutes,
    pct: Math.max(5, (p.minutes / maxMin) * 100),
    provisional: p.provisional,
  }));
  return { bars };
}

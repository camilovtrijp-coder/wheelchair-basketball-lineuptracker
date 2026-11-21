import { MAX_CLOCK_SECONDS } from '../../domain/game/types';

/** `m:ss` / `mm:ss` of 3-4 cijfers (`800` = 8:00) naar seconden; anders (of buiten 0..10:00) `null`. */
export function parseClockText(text: string): number | null {
  const trimmed = text.trim();
  const colon = /^(\d{1,2}):([0-5]\d)$/.exec(trimmed);
  const digits = /^(\d{1,2})([0-5]\d)$/.exec(trimmed);
  const match = colon ?? digits;
  if (match == null) return null;
  const sec = Number(match[1]) * 60 + Number(match[2]);
  return sec <= MAX_CLOCK_SECONDS ? sec : null;
}

/** Eén stap van 10 s "eerder"/"later" in de wedstrijd, in de richting van de klok. */
export function nudgeClock(
  value: number,
  clockDown: boolean,
  earlier: boolean,
  bounds: { min: number; max: number } | null,
): number {
  const sign = (earlier ? 1 : -1) * (clockDown ? 1 : -1);
  const next = value + sign * 10;
  const lo = bounds?.min ?? 0;
  const hi = bounds?.max ?? MAX_CLOCK_SECONDS;
  return Math.max(lo, Math.min(hi, next));
}

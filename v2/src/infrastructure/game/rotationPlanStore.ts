import { parseRotationPlan, type RotationPlan } from '../../domain/game/rotationPlan';

/**
 * Lokale opslag van het wisselschema (Snel-wedstrijdscherm). Bewust alleen op
 * dit apparaat, per wedstrijd-ID, onder één eigen key (nieuwe key; geen
 * bestaande key of gebruikersdata geraakt). Nooit onderdeel van `ActiveGame`,
 * het datacontract, CSV of cloudsync. Patroon van `compactAwayPreference.ts`:
 * onbeschikbare, kapotte of ongeldige storage valt stil terug op "geen schema".
 *
 * Opslagvorm: JSON-array van `{ gameId, plan }`, oudste eerst, begrensd op
 * `MAX_PLAN_ENTRIES`. Het meest recente schema van een ANDERE wedstrijd dient
 * als startpunt voor "Zelfde als vorige wedstrijd".
 */
export const ROTATION_PLAN_STORAGE_KEY = 'lineup-tracker-v2-rotation-plan';

export const MAX_PLAN_ENTRIES = 20;

interface PlanEntry {
  gameId: string;
  plan: RotationPlan;
}

export function parsePlanEntries(raw: string | null | undefined): PlanEntry[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries: PlanEntry[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const { gameId, plan } = item as { gameId?: unknown; plan?: unknown };
      if (typeof gameId !== 'string' || gameId.length === 0) continue;
      const valid = parseRotationPlan(plan);
      if (valid != null) entries.push({ gameId, plan: valid });
    }
    return entries;
  } catch {
    return [];
  }
}

function readEntries(): PlanEntry[] {
  try {
    return parsePlanEntries(window.localStorage.getItem(ROTATION_PLAN_STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Schema van deze wedstrijd; bij elk probleem `null`. */
export function readPlanForGame(gameId: string): RotationPlan | null {
  if (!gameId) return null;
  return readEntries().find((e) => e.gameId === gameId)?.plan ?? null;
}

/** Meest recente schema van een andere wedstrijd (startpunt voor een nieuwe wedstrijd); anders `null`. */
export function readPreviousPlan(currentGameId: string): RotationPlan | null {
  const others = readEntries().filter((e) => e.gameId !== currentGameId);
  return others[others.length - 1]?.plan ?? null;
}

/** Bewaart het schema van één wedstrijd (als meest recente); andere wedstrijden blijven ongemoeid. Faalt stil. */
export function storePlanForGame(gameId: string, plan: RotationPlan): void {
  if (!gameId) return;
  try {
    const others = readEntries().filter((e) => e.gameId !== gameId);
    const next = [...others, { gameId, plan }].slice(-MAX_PLAN_ENTRIES);
    window.localStorage.setItem(ROTATION_PLAN_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Onbeschikbare storage: het schema geldt dan alleen voor deze sessie.
  }
}

/** Verwijdert het schema van één wedstrijd. Faalt stil. */
export function clearPlanForGame(gameId: string): void {
  if (!gameId) return;
  try {
    const next = readEntries().filter((e) => e.gameId !== gameId);
    window.localStorage.setItem(ROTATION_PLAN_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Onbeschikbare storage: niets te wissen.
  }
}

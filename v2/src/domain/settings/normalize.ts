import { DEFAULT_SETTINGS, QUARTER_COUNT_MAX, QUARTER_COUNT_MIN, type Settings } from './types';
import { isPlainObject } from './validation';

/**
 * Combineert v1-data (zo opgeslagen in `lineup-tracker-settings`) met de huidige
 * defaults. v1-gedrag: parsed overschrijft defaults, onbekende keys blijven staan.
 *
 * v2-gedrag is bewust **conservatief** en exact gelijk aan v1:
 *  - Bij ontbrekende of niet-plain-object data → `DEFAULT_SETTINGS`.
 *  - Anders wordt de rauwe parsed-waarde teruggegeven, mét defaults voor
 *    ontbrekende bekende velden en behoud van onbekende velden.
 *
 * Er is **geen** transformatie van bestaande waarden: een v1-`quarterCount`
 * van `0` blijft `0`, een stringified getal blijft een string, etc. Dit
 * voorkomt een "stille vormwijziging" wanneer v2 opslaat wat v1 al had.
 * Validatie vanuit de UI gebeurt in `applySettingUpdate` hieronder.
 */
export function normalizeSettings(value: unknown): Settings & Record<string, unknown> {
  if (!isPlainObject(value)) {
    return { ...DEFAULT_SETTINGS };
  }

  const knownDefaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...value };

  for (const k of Object.keys(knownDefaults)) {
    if (!Object.prototype.hasOwnProperty.call(out, k)) {
      out[k] = knownDefaults[k];
    }
  }

  return out as Settings & Record<string, unknown>;
}

function clampQuarterCount(n: number): number {
  if (!Number.isFinite(n) || n < QUARTER_COUNT_MIN) return QUARTER_COUNT_MIN;
  if (n > QUARTER_COUNT_MAX) return QUARTER_COUNT_MAX;
  return Math.floor(n);
}

function safeNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function safeString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
function safeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value) ? value : fallback;
}

/**
 * Past één veld-update toe op een settings-object en retourneert een nieuw
 * object. Onbekende keys blijven behouden. UI-input wordt hier
 * gecontroleerd: typen worden afgedwongen en `quarterCount` wordt geclampd
 * naar 1..12. Dit is **alleen** van toepassing op writes via de UI —
 * bestaande v1-data in localStorage wordt via `normalizeSettings`
 * onaangetast gelaten.
 */
export function applySettingUpdate(
  current: Settings & Record<string, unknown>,
  field: keyof Settings,
  value: unknown,
): Settings & Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };

  switch (field) {
    case 'teamName':
    case 'logoUri':
    case 'periodLabel':
    case 'tag1Label':
    case 'tag2Label':
      next[field] = safeString(value, current[field] as string);
      break;
    case 'primaryColor':
    case 'accentColor':
      next[field] = safeColor(value, current[field] as string);
      break;
    case 'useClassLimit':
      next[field] = safeBoolean(value, current[field] as boolean);
      break;
    case 'quarterCount':
      next[field] = clampQuarterCount(safeNumber(value, current[field] as number));
      break;
    case 'classBaseLimit':
    case 'maxBonus':
    case 'bonusTag1Only':
    case 'bonusTag2Only':
    case 'bonusBoth':
      next[field] = safeNumber(value, current[field] as number);
      break;
  }

  return next as Settings & Record<string, unknown>;
}

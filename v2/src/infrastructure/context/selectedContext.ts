import type { KeyValueStorage } from '../../i18n/persistence';
import type { SelectedContext } from '../../domain/organizations/types';

export const SELECTED_CONTEXT_STORAGE_KEY = 'lineup-tracker-selected-context';

function isSelectedContext(value: unknown): value is SelectedContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { orgId?: unknown }).orgId === 'string' &&
    typeof (value as { teamId?: unknown }).teamId === 'string'
  );
}

/** `null` als er niets is opgeslagen, of de opgeslagen waarde niet meer geldig geparsed kan worden. */
export function readSelectedContext(storage: KeyValueStorage): SelectedContext | null {
  const raw = storage.getItem(SELECTED_CONTEXT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSelectedContext(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSelectedContext(storage: KeyValueStorage, context: SelectedContext): void {
  storage.setItem(SELECTED_CONTEXT_STORAGE_KEY, JSON.stringify(context));
}

export function clearSelectedContext(storage: KeyValueStorage): void {
  storage.removeItem(SELECTED_CONTEXT_STORAGE_KEY);
}

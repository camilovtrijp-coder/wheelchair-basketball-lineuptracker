import type { KeyValueStorage } from '../../i18n/persistence';
import type {
  PendingFinalizeEntry,
  PendingFinalizeRepository,
} from '../../application/game/PendingFinalizeRepository';

/**
 * Eigen sleutel per organisatie/team, net als `completedGamesStorageKey()`
 * (zie `LocalStorageCompletedGameRepository.ts`) — deze outbox is zelf ook
 * per team-context gescheiden.
 */
export function pendingFinalizeStorageKey(organizationId: string, teamId: string): string {
  return `lineup-tracker-v2-pending-finalize:${organizationId}:${teamId}`;
}

function isPendingFinalizeEntryShape(value: unknown): value is PendingFinalizeEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.game !== 'object' || v.game === null) return false;
  if (typeof v.completed !== 'object' || v.completed === null) return false;
  const g = v.game as Record<string, unknown>;
  const c = v.completed as Record<string, unknown>;
  return (
    typeof g.id === 'string' &&
    typeof g.organizationId === 'string' &&
    typeof g.teamId === 'string' &&
    Array.isArray(g.actions) &&
    typeof c.id === 'string' &&
    typeof c.organizationId === 'string' &&
    typeof c.teamId === 'string' &&
    typeof c.sourceGameId === 'string' &&
    c.sourceGameId === g.id
  );
}

function matchesContext(
  entry: PendingFinalizeEntry,
  organizationId: string,
  teamId: string,
): boolean {
  return entry.completed.organizationId === organizationId && entry.completed.teamId === teamId;
}

export class LocalStoragePendingFinalizeRepository implements PendingFinalizeRepository {
  private readonly key: string;

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly organizationId: string,
    private readonly teamId: string,
  ) {
    this.key = pendingFinalizeStorageKey(organizationId, teamId);
  }

  private readAll(): PendingFinalizeEntry[] {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      return [];
    }
    if (raw === null || raw === '') return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    // Een individueel corrupt/mistagged item wordt gefilterd, niet de hele
    // lijst ongeldig verklaard — zelfde afweging als `safeList()` op
    // `LocalStorageCompletedGameRepository`: dit is bovendien een puur
    // interne retry-outbox (geen door de gebruiker zichtbare historie), dus
    // een individueel corrupt item nooit-meer-retrybaar laten worden is
    // veiliger dan de hele outbox te laten falen.
    return parsed.filter(
      (item): item is PendingFinalizeEntry =>
        isPendingFinalizeEntryShape(item) && matchesContext(item, this.organizationId, this.teamId),
    );
  }

  private writeAll(entries: PendingFinalizeEntry[]): boolean {
    try {
      this.storage.setItem(this.key, JSON.stringify(entries));
      return true;
    } catch {
      return false;
    }
  }

  list(): PendingFinalizeEntry[] {
    return this.readAll();
  }

  add(entry: PendingFinalizeEntry): boolean {
    if (!matchesContext(entry, this.organizationId, this.teamId)) return false;
    const current = this.readAll();
    const withoutSame = current.filter((e) => e.completed.id !== entry.completed.id);
    return this.writeAll([...withoutSame, entry]);
  }

  remove(completedGameId: string): boolean {
    const current = this.readAll();
    return this.writeAll(current.filter((e) => e.completed.id !== completedGameId));
  }
}

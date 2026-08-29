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
/** Zie ACTIVE_GAME_STORAGE_KEY_PREFIX (LocalStorageGameRepository.ts) — zelfde reden. */
export const PENDING_FINALIZE_STORAGE_KEY_PREFIX = 'lineup-tracker-v2-pending-finalize:';

export function pendingFinalizeStorageKey(organizationId: string, teamId: string): string {
  return `${PENDING_FINALIZE_STORAGE_KEY_PREFIX}${organizationId}:${teamId}`;
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

/**
 * P1-fix, tweede ronde (externe review PR #61): deze outbox is de ENIGE
 * duurzame bron voor een openstaande afronding — een `add()`/`remove()` die
 * een mislukte/onbeschikbare read stilzwijgend als "leeg" behandelt, zou
 * bestaande entries kunnen overschrijven/wissen op basis van een foutieve
 * lege lijst (exact het patroon dat `LocalStorageCompletedGameRepository`'s
 * eigen `readAll()`/`ok`-onderscheid al oplost voor de historie, aug. 2026-
 * review). Anders dan die repository filtert deze wél nog steeds een
 * INDIVIDUEEL corrupt/mistagged item weg zonder de rest ongeldig te
 * verklaren (`ok:true` met een kortere lijst) — alleen een écht mislukte of
 * onbeschikbare read (storage-getter faalt, corrupte JSON, geen array) zet
 * `ok:false`.
 */
interface ReadAllResult {
  entries: PendingFinalizeEntry[];
  ok: boolean;
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

  private readAll(): ReadAllResult {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      return { entries: [], ok: false };
    }
    if (raw === null || raw === '') return { entries: [], ok: true };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { entries: [], ok: false };
    }
    if (!Array.isArray(parsed)) return { entries: [], ok: false };
    // Een individueel corrupt/mistagged item wordt gefilterd, niet de hele
    // lijst ongeldig verklaard — zelfde afweging als `safeList()` op
    // `LocalStorageCompletedGameRepository`: dit is bovendien een puur
    // interne retry-outbox (geen door de gebruiker zichtbare historie), dus
    // een individueel corrupt item nooit-meer-retrybaar laten worden is
    // veiliger dan de hele outbox te laten falen.
    const entries = parsed.filter(
      (item): item is PendingFinalizeEntry =>
        isPendingFinalizeEntryShape(item) && matchesContext(item, this.organizationId, this.teamId),
    );
    return { entries, ok: true };
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
    return this.readAll().entries;
  }

  add(entry: PendingFinalizeEntry): boolean {
    if (!matchesContext(entry, this.organizationId, this.teamId)) return false;
    const current = this.readAll();
    // Fail-closed (P1-fix, tweede ronde): een mislukte read mag nooit
    // vervolgens een write doen op basis van een foutief lege lijst — dat
    // zou een bestaande, nog niet gelezen entry stilzwijgend overschrijven.
    if (!current.ok) return false;
    const withoutSame = current.entries.filter((e) => e.completed.id !== entry.completed.id);
    return this.writeAll([...withoutSame, entry]);
  }

  remove(completedGameId: string): boolean {
    const current = this.readAll();
    if (!current.ok) return false;
    return this.writeAll(current.entries.filter((e) => e.completed.id !== completedGameId));
  }
}

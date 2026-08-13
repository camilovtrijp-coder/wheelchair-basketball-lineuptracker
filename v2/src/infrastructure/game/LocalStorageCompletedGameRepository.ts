import type { CompletedGame } from '../../domain/game/types';
import type { KeyValueStorage } from '../../i18n/persistence';
import type { CompletedGameRepository } from '../../application/game/CompletedGameRepository';

/**
 * Eigen sleutel per organisatie/team (i.p.v. v1's ene globale
 * `lineup-tracker-games`-array) — consistent met hoe
 * `activeGameStorageKey()` de actieve wedstrijd al per org/team scoped, zie
 * docs/pr-6.3-plan.md §E.3.
 */
export function completedGamesStorageKey(organizationId: string, teamId: string): string {
  return `lineup-tracker-v2-completed-games:${organizationId}:${teamId}`;
}

function isCompletedGameShape(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.organizationId === 'string' &&
    typeof v.teamId === 'string' &&
    typeof v.date === 'string' &&
    Array.isArray(v.players) &&
    Array.isArray(v.segments) &&
    typeof v.scoreFor === 'number' &&
    typeof v.scoreAgainst === 'number'
  );
}

function matchesContext(
  value: Record<string, unknown>,
  organizationId: string,
  teamId: string,
): boolean {
  return value.organizationId === organizationId && value.teamId === teamId;
}

export class LocalStorageCompletedGameRepository implements CompletedGameRepository {
  private readonly key: string;

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly organizationId: string,
    private readonly teamId: string,
  ) {
    this.key = completedGamesStorageKey(organizationId, teamId);
  }

  /**
   * Filtert corrupte of verkeerd-getagde items uit de lijst i.p.v. bij het
   * eerste ongeldige item de hele lijst als leeg te behandelen — een enkel
   * beschadigd item mag niet de rest van de historie onzichtbaar maken.
   */
  list(): CompletedGame[] {
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

    return parsed.filter(
      (item): item is CompletedGame =>
        isCompletedGameShape(item) && matchesContext(item, this.organizationId, this.teamId),
    );
  }

  add(game: CompletedGame): boolean {
    if (game.organizationId !== this.organizationId || game.teamId !== this.teamId) return false;
    return this.writeAll([game, ...this.list()]);
  }

  remove(id: string): boolean {
    return this.writeAll(this.list().filter((g) => g.id !== id));
  }

  private writeAll(games: CompletedGame[]): boolean {
    try {
      this.storage.setItem(this.key, JSON.stringify(games));
      return true;
    } catch {
      /* opslag kan falen (quota overschreden, uitgeschakeld); laat caller het weten */
      return false;
    }
  }
}

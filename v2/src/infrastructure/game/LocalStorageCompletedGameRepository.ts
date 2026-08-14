import type { CompletedGame } from '../../domain/game/types';
import type { KeyValueStorage } from '../../i18n/persistence';
import type {
  CompletedGameRepository,
  CompletedGamesReadResult,
  CompletedGamesReadStatus,
} from '../../application/game/CompletedGameRepository';

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
   * Onderscheidt "leeg/nog niet aangemaakt" (`ok: true`, `games: []`) van "kon
   * niet gelezen worden" (`ok: false`) — een storage-readfout, corrupte JSON of
   * een niet-array-payload is NIET hetzelfde als een lege historie. Zonder dit
   * onderscheid zou `add()`/`remove()` bij een tijdelijke leesfout alsnog een
   * volledige write doen op basis van een lege lijst, en zo de bestaande
   * historie stilzwijgend wissen (externe PR-6.3-review, aug. 2026). Een
   * individueel corrupt of verkeerd-getagd ITEM binnen een wél leesbare array
   * blijft gewoon gefilterd (niet de hele lijst ongeldig) — dat is een ander
   * risico (één beschadigd item verbergt de rest niet) dan een mislukte read.
   */
  private readAll(): {
    games: CompletedGame[];
    ok: boolean;
    missing: boolean;
    rejectedCount: number;
  } {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      return { games: [], ok: false, missing: false, rejectedCount: 0 };
    }
    if (raw === null || raw === '') return { games: [], ok: true, missing: true, rejectedCount: 0 };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { games: [], ok: false, missing: false, rejectedCount: 0 };
    }
    if (!Array.isArray(parsed)) return { games: [], ok: false, missing: false, rejectedCount: 0 };

    const games = parsed.filter(
      (item): item is CompletedGame =>
        isCompletedGameShape(item) && matchesContext(item, this.organizationId, this.teamId),
    );
    return {
      games,
      ok: true,
      missing: false,
      rejectedCount: parsed.length - games.length,
    };
  }

  list(): CompletedGame[] {
    return this.readAll().games;
  }

  /**
   * PR 6.4 §A.2: publieke versie van `readAll()` met expliciet onderscheid
   * tussen `ok`, `missing` en `error`. `missing` (lege sleutel) en `ok` met
   * een lege array worden in de UI hetzelfde behandeld; `error` triggert
   * een foutmelding i.p.v. de "geen wedstrijden"-banner. Default
   * `safeList` op de interface geeft `ok` terug voor callers die het
   * onderscheid niet nodig hebben (bestand tegen PR-6.3-scope-uitbreiding).
   */
  safeList(): CompletedGamesReadResult {
    const r = this.readAll();
    const resolved: CompletedGamesReadStatus = !r.ok
      ? 'error'
      : r.missing && r.games.length === 0
        ? 'missing'
        : 'ok';
    return { status: resolved, games: r.games };
  }

  /** Zie de interface-docstring (`application/game/CompletedGameRepository.ts`)
   * voor waarom dit een apart, strikter contract is dan `safeList()`. */
  safeListStrict(): CompletedGamesReadResult {
    const r = this.readAll();
    if (!r.ok || r.rejectedCount > 0) return { status: 'error', games: [] };
    return { status: r.missing ? 'missing' : 'ok', games: r.games };
  }

  add(game: CompletedGame): boolean {
    if (game.organizationId !== this.organizationId || game.teamId !== this.teamId) return false;
    const current = this.readAll();
    if (!current.ok) return false;
    return this.writeAll([game, ...current.games]);
  }

  remove(id: string): boolean {
    const current = this.readAll();
    if (!current.ok) return false;
    return this.writeAll(current.games.filter((g) => g.id !== id));
  }

  replaceAll(games: CompletedGame[]): boolean {
    if (
      games.some(
        (g) =>
          !matchesContext(
            g as unknown as Record<string, unknown>,
            this.organizationId,
            this.teamId,
          ),
      )
    ) {
      return false;
    }
    return this.writeAll(games);
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

import type { ActiveGame } from '../../domain/game/types';
import type { KeyValueStorage } from '../../i18n/persistence';
import type { GameRepository } from '../../application/game/GameRepository';

/**
 * Per-organisatie/team-sleutel (i.p.v. één vaste key) — zo blijft de
 * wedstrijdopzet van team A onaangeraakt wanneer de gebruiker naar team B
 * wisselt via de contextwisselaar, in plaats van te worden overschreven of
 * te verdwijnen. Vult daarmee een deel van "actieve organisatie/teamcontext
 * verplicht opslaan" in (docs/IMPLEMENTATION_PLAN.md §11, PR 6.1): elke
 * wedstrijd hoort aantoonbaar bij precies één organisatie/team. Het harde
 * UI-slot dat een wissel tijdens een lopende wedstrijd blokkeert
 * ("vergrendelen") is bewust PR 7.3-scope, samen met single-writer-sync.
 */
export function activeGameStorageKey(organizationId: string, teamId: string): string {
  return `lineup-tracker-v2-active-game:${organizationId}:${teamId}`;
}

function isActiveGame(value: unknown): value is ActiveGame {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.organizationId === 'string' &&
    typeof v.teamId === 'string' &&
    (v.phase === 'setup' || v.phase === 'tracking') &&
    Array.isArray(v.players)
  );
}

export class LocalStorageGameRepository implements GameRepository {
  private readonly key: string;

  constructor(
    private readonly storage: KeyValueStorage,
    organizationId: string,
    teamId: string,
  ) {
    this.key = activeGameStorageKey(organizationId, teamId);
  }

  read(): ActiveGame | null {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      return null;
    }

    if (raw === null || raw === '') return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    return isActiveGame(parsed) ? parsed : null;
  }

  write(game: ActiveGame): boolean {
    try {
      this.storage.setItem(this.key, JSON.stringify(game));
      return true;
    } catch {
      /* opslag kan falen (quota overschreden, uitgeschakeld); laat caller het weten */
      return false;
    }
  }
}

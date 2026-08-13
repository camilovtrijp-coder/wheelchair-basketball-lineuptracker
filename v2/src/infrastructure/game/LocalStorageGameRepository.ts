import { MAX_CLOCK_SECONDS, type ActiveGame } from '../../domain/game/types';
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

/**
 * Structurele basiscontrole: dit dekt zowel het huidige `ActiveGame`-schema
 * als het PR-6.1-schema van vóór PR 6.2 (die had geen `curQuarter`/
 * `beginSec`/`endSec`/`pendingSwapLineup`/`actions`). Nieuwere velden worden
 * pas in `normalizeActiveGame()` gecontroleerd/aangevuld, niet hier —
 * anders zou een opgeslagen PR-6.1-wedstrijd als ongeldig gelezen worden.
 */
function isActiveGameShape(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.organizationId === 'string' &&
    typeof v.teamId === 'string' &&
    (v.phase === 'setup' || v.phase === 'tracking') &&
    Array.isArray(v.players) &&
    Array.isArray(v.onCourt)
  );
}

/**
 * Migreert een opgeslagen wedstrijd naar het volledige PR-6.2-schema. Zonder
 * dit zou een wedstrijd die nog door PR 6.1 is opgeslagen (`phase` kon toen
 * al 'tracking' zijn, met alleen de plaatshouder-UI, dus zonder
 * curQuarter/beginSec/endSec/pendingSwapLineup/actions) bij de eerste
 * PR-6.2-load als ongeldig gelezen worden — `read()` zou dan `null`
 * teruggeven, en de aanroeper (App.tsx) zou stilzwijgend een verse opzet
 * aanmaken en dezelfde sleutel overschrijven: een al gestarte wedstrijd
 * kwijt zonder enige melding.
 *
 * De backfill-waarden zijn exact wat PR 6.1's `startGame()` al zette bij de
 * fase-overgang naar 'tracking' (curQuarter 1, begin/eind op het startpunt
 * van de klok, geen pending wissel, geen acties) — dit is dus lossless voor
 * elke wedstrijd die nog geen PR-6.2-actie heeft kunnen loggen, wat vóór
 * deze migratie sowieso onmogelijk was.
 */
function normalizeActiveGame(value: Record<string, unknown>): ActiveGame {
  const clockDown = value.clockDown === true;
  const begin =
    typeof value.beginSec === 'number' ? value.beginSec : clockDown ? MAX_CLOCK_SECONDS : 0;
  return {
    ...(value as unknown as ActiveGame),
    curQuarter: typeof value.curQuarter === 'number' ? value.curQuarter : 1,
    beginSec: begin,
    endSec: typeof value.endSec === 'number' ? value.endSec : begin,
    pendingSwapLineup: Array.isArray(value.pendingSwapLineup)
      ? (value.pendingSwapLineup as string[])
      : null,
    actions: Array.isArray(value.actions) ? (value.actions as ActiveGame['actions']) : [],
  };
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

    return isActiveGameShape(parsed) ? normalizeActiveGame(parsed) : null;
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

import { MAX_CLOCK_SECONDS, type ActiveGame } from '../../domain/game/types';
import { V1_ACTIVE_GAME_STORAGE_KEY, migrateV1ActiveGame } from '../../domain/game/v1Migration';
import type { KeyValueStorage } from '../../i18n/persistence';
import type { GameRepository } from '../../application/game/GameRepository';

/**
 * Markeert dat de v1-actieve-wedstrijd al eens is geadopteerd (zie
 * `LocalStorageGameRepository.tryAdoptV1Game`) — één vaste, niet per-team
 * sleutel, want v1 was single-team: zonder deze vlag zou een tweede team
 * dezelfde v1-wedstrijd ook nog eens claimen bij zijn eerste (lege) load.
 */
export const V1_GAME_MIGRATED_FLAG_KEY = 'lineup-tracker-v2-v1-game-migrated';

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
 * Controleert dat de opgeslagen wedstrijd ook daadwerkelijk bij de sleutel
 * hoort waaronder ze werd gelezen. Zonder deze check zou een payload die
 * (door een toekomstige bug, handmatige localStorage-bewerking of een
 * sleutelbotsing) onder de verkeerde organisatie/team-sleutel terecht is
 * gekomen, alsnog stilzwijgend voor dat andere team gelezen worden — de
 * per-team-sleutel (zie `activeGameStorageKey`) is dan geen betrouwbare
 * isolatiegrens meer. Een mismatch wordt hier hetzelfde behandeld als
 * ongeldige/corrupte data: `read()` geeft `null`.
 */
function matchesContext(
  value: Record<string, unknown>,
  organizationId: string,
  teamId: string,
): boolean {
  return value.organizationId === organizationId && value.teamId === teamId;
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
    private readonly organizationId: string,
    private readonly teamId: string,
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

    // Niets onder de v2-sleutel: eenmalig proberen te adopteren vanuit v1
    // (zie tryAdoptV1Game) — een corrupte/mismatchende v2-waarde hieronder
    // valt bewust NIET terug op v1, want dat zou een team dat al zijn eigen
    // (weliswaar kapotte) v2-wedstrijd had, alsnog een andere wedstrijd geven.
    if (raw === null || raw === '') return this.tryAdoptV1Game();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!isActiveGameShape(parsed) || !matchesContext(parsed, this.organizationId, this.teamId)) {
      return null;
    }

    return normalizeActiveGame(parsed);
  }

  /**
   * Adopteert een nog actieve v1-wedstrijd (zie domain/game/v1Migration.ts)
   * de eerste keer dat dit team een lege v2-opslag tegenkomt —
   * docs/IMPLEMENTATION_PLAN.md §11 (PR 6.1) eist dat de v1-sleutel tijdens
   * de compatibiliteitsperiode leesbaar blijft. `V1_GAME_MIGRATED_FLAG_KEY`
   * voorkomt dat een tweede team dezelfde v1-wedstrijd nogmaals claimt (v1
   * was single-team, dus er is maar één "eigenaar" mogelijk). De vlag wordt
   * pas gezet ná een geslaagde write, zodat een opslagfout op dit exacte
   * moment een volgende poging niet blijvend blokkeert.
   */
  private tryAdoptV1Game(): ActiveGame | null {
    let migratedFlag: string | null = null;
    try {
      migratedFlag = this.storage.getItem(V1_GAME_MIGRATED_FLAG_KEY);
    } catch {
      return null;
    }
    if (migratedFlag === 'true') return null;

    let v1Raw: string | null = null;
    try {
      v1Raw = this.storage.getItem(V1_ACTIVE_GAME_STORAGE_KEY);
    } catch {
      return null;
    }
    if (v1Raw === null || v1Raw === '') return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(v1Raw);
    } catch {
      return null;
    }

    const migrated = migrateV1ActiveGame(parsed, this.organizationId, this.teamId);
    if (migrated === null) return null;

    if (this.write(migrated)) {
      try {
        this.storage.setItem(V1_GAME_MIGRATED_FLAG_KEY, 'true');
      } catch {
        /* best effort; een volgende read() probeert het dan gewoon opnieuw */
      }
    }
    return migrated;
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

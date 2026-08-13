import { MAX_CLOCK_SECONDS, type ActiveGame } from '../../domain/game/types';
import { V1_ACTIVE_GAME_STORAGE_KEY, migrateV1ActiveGame } from '../../domain/game/v1Migration';
import type { KeyValueStorage } from '../../i18n/persistence';
import type { GameRepository } from '../../application/game/GameRepository';

/**
 * Markeert dat de v1-actieve-wedstrijd al eens (bevestigd) geadopteerd is —
 * één vaste, niet per-team sleutel, want v1 was single-team: zonder deze
 * vlag zou een tweede team dezelfde v1-wedstrijd ook nog eens kunnen claimen.
 * De waarde is diagnostische JSON (wanneer/welk team bevestigde) i.p.v. een
 * kale `'true'`, zodat een support-vraag ("waar is mijn oude wedstrijd
 * gebleven?") te herleiden is; alleen *aanwezigheid* van de sleutel bepaalt
 * of `detectV1Migration()` nog iets teruggeeft, de inhoud zelf wordt verder
 * niet gelezen.
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

    if (raw === null || raw === '') return null;

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
   * Detecteert (zonder te schrijven of te markeren) een nog niet bevestigd
   * geadopteerde v1-actieve-wedstrijd (zie domain/game/v1Migration.ts),
   * getagd met dit team als vóórgesteld doel. v1 kende geen organisatie/
   * teamcontext, dus deze code kan zelf niet bewijzen dat dít het juiste
   * team is — de aanroeper (App.tsx/V1MigrationPrompt) moet de gebruiker
   * expliciet laten bevestigen (of eerst van team laten wisselen) vóórdat
   * `confirmV1Migration()` iets vastlegt. Zonder deze stap zou willekeurig
   * welk team het eerst met een lege opslag geladen wordt de wedstrijd
   * stilzwijgend claimen (externe PR-6.1-review, aug. 2026).
   */
  detectV1Migration(): ActiveGame | null {
    let migratedFlag: string | null = null;
    try {
      migratedFlag = this.storage.getItem(V1_GAME_MIGRATED_FLAG_KEY);
    } catch {
      return null;
    }
    if (migratedFlag !== null) return null;

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

    return migrateV1ActiveGame(parsed, this.organizationId, this.teamId);
  }

  /**
   * `game` moet aantoonbaar bij DIT team horen — zonder deze check zou een
   * verouderd of verkeerd getagd voorstel (bijv. na een contextwissel tussen
   * `detectV1Migration()` en de klik op "bevestigen") alsnog onder de huidige
   * teamsleutel geschreven kunnen worden, precies de fout die deze hele
   * bevestigingsstap moet voorkomen.
   *
   * De wedstrijdwrite en de globale claimvlag zijn twee losse localStorage-
   * writes (geen transacties mogelijk) — als de tweede faalt nadat de eerste
   * al slaagde, draaien we de eerste terug i.p.v. `true` te retourneren.
   * Zonder die rollback zou dit team de wedstrijd lokaal lijken te hebben
   * terwijl de globale claim ontbreekt, waardoor `detectV1Migration()`
   * dezelfde v1-wedstrijd alsnog aan een ander team aanbiedt: twee teams die
   * beide denken de wedstrijd te bezitten. Met de rollback is een mislukte
   * bevestiging altijd volledig ongedaan gemaakt, dus veilig om (door dit of
   * een ander team) opnieuw te proberen.
   */
  confirmV1Migration(game: ActiveGame): boolean {
    if (game.organizationId !== this.organizationId || game.teamId !== this.teamId) {
      return false;
    }
    if (!this.write(game)) return false;
    try {
      this.storage.setItem(
        V1_GAME_MIGRATED_FLAG_KEY,
        JSON.stringify({
          migratedAt: new Date().toISOString(),
          organizationId: this.organizationId,
          teamId: this.teamId,
        }),
      );
    } catch {
      try {
        this.storage.removeItem(this.key);
      } catch {
        /* best effort rollback; de opslag lijkt sowieso kapot op dit punt */
      }
      return false;
    }
    return true;
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

  clear(): boolean {
    try {
      this.storage.removeItem(this.key);
      return true;
    } catch {
      return false;
    }
  }
}

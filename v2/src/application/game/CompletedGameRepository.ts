import type { CompletedGame } from '../../domain/game/types';
import type { SyncState } from '../../domain/syncState';

/**
 * PR 6.4 §A.2 / §C.1: een expliciet leesresultaat voor de
 * afgeronde-wedstrijd-historie. `[]` mag NOOIT zonder status als bewijs
 * voor "geen wedstrijden" dienen — een leesfout of een niet-beschikbare
 * storage-getter moet onderscheiden worden van een wél leesbare, lege
 * lijst. `missing` betekent "er is nog nooit opgeslagen" (lege sleutel),
 * `error` betekent "de bestaande data is mogelijk wél aanwezig maar kon
 * niet gelezen worden" (corrupte JSON, niet-array payload, een gefaalde
 * `Storage.getItem()`-call, of een onbeschikbare storage-getter). De UI
 * toont bij `error` een foutmelding en NOOIT de "geen wedstrijden"-banner.
 */
export type CompletedGamesReadStatus = 'ok' | 'missing' | 'error';

export interface CompletedGamesReadResult {
  status: CompletedGamesReadStatus;
  games: CompletedGame[];
}

export interface CompletedGameRepository {
  /** Nieuwste eerst (v1-pariteit: `games.unshift(...)`). Lege array als er nog niets is. */
  list(): CompletedGame[];
  /**
   * PR 6.4 §A.2: expliciet onderscheid tussen "leeg", "ontbrekend" en
   * "fout". Default-implementatie valt terug op `list()` met `status:
   * 'ok'` voor backward compat — adapters die het onderscheid kunnen
   * maken (zie `LocalStorageCompletedGameRepository`) overriden dit.
   */
  safeList?(): CompletedGamesReadResult;
  /**
   * Strikte variant van `safeList()`, alleen bedoeld voor back-up-export/
   * -snapshot (externe PR-6.6-review, aug. 2026). `safeList()` filtert een
   * individueel corrupt/mistagged item bewust stil weg (zie de eigen
   * docstring bij de adapter: één beschadigd item mag de rest van de
   * historie niet verbergen in de gewone Stats/Historie-UI) — maar
   * diezelfde stilte is gevaarlijk voor een back-up: een export/herstel-
   * back-up die zo'n gefilterd item gewoon weglaat, ziet er voor de
   * gebruiker uit als een volledige back-up terwijl ze onvolledig is. Een
   * import die zo'n onvolledig herstelbestand ooit terug moet zetten,
   * herstelt dan niet alles. `safeListStrict()` geeft daarom `status:
   * 'error'` zodra ook maar één item wordt afgekeurd — een corrupte/
   * mistagged historie is voor export-doeleinden nooit hetzelfde als "geen
   * historie". Default-implementatie valt terug op `safeList()`/`list()`
   * voor adapters die het onderscheid niet kunnen maken.
   */
  safeListStrict?(): CompletedGamesReadResult;
  /**
   * Voegt een net afgeronde wedstrijd vooraan toe. `false` als de opslag
   * faalde (bijv. quota overschreden) of `game` niet bij deze
   * organisatie/team hoort.
   */
  add(game: CompletedGame): boolean;
  /**
   * Verwijdert de wedstrijd met dit ID (v1: direct, geen tombstone — zie
   * docs/pr-6.3-plan.md §D). `false` als de opslag faalde; ontbreekt het ID
   * al, dan is dit een no-op die `true` teruggeeft.
   */
  remove(id: string): boolean;
  /**
   * PR 6.6 §F 6.6b: vervangt de VOLLEDIGE historie voor deze organisatie/
   * team in één keer — nodig voor het replace-per-onderdeel-importcontract
   * (plan §D/§E.2). Een herhaalde import van dezelfde back-up levert zo
   * identiek dezelfde eindtoestand op i.p.v. te stapelen (idempotent
   * zonder aparte dedupe-/provenance-sleutel nodig te hebben). `false` als
   * één van de meegegeven wedstrijden niet bij deze organisatie/team hoort,
   * of als de opslag faalde — dan blijft de bestaande historie ongewijzigd.
   */
  replaceAll(games: CompletedGame[]): boolean;
  /**
   * PR 7.2b (docs/pr-7.2-plan.md §C 7.2b): optioneel — alleen geïmplementeerd
   * door een adapter die naast deze synchrone lokale bron ook een
   * asynchrone cloudbron samenvoegt (zie
   * `infrastructure/game/CompositeCompletedGameRepository.ts`). Een
   * lokaal-only adapter (`LocalStorageCompletedGameRepository`) implementeert
   * dit bewust NIET — daar verandert de lijst nooit buiten een expliciete
   * `add()`/`remove()`/`replaceAll()`-aanroep om, dus is er niets om op te
   * abonneren.
   *
   * Roept `onNext` synchroon en direct aan met de actuele `safeList()`-
   * uitkomst, en daarna telkens wanneer de samengestelde lijst verandert:
   * een geslaagde lokale mutatie (`add`/`remove`/`replaceAll`) of een nieuwe
   * cloud-snapshot van de team-`completedGames`-query (bijv. een wedstrijd
   * die op een ander apparaat is afgerond). `cloudSync` is `null` zolang er
   * nog geen enkele cloud-snapshot is binnengekomen sinds dit abonnement
   * begon (fresh mount/contextwissel) — de UI mag dit tonen als "cloud-
   * geschiedenis wordt geladen", niet als "gesynchroniseerd" of "leeg".
   * Geeft een unsubscribe-functie terug (zelfde vorm als
   * `AsyncSettingsRepository.subscribe()`/`AsyncRosterRepository.subscribe()`).
   *
   * PR 7.2c, externe review op PR #65 (P1 — "een late client verliest zijn
   * lokale bron niet stil"): `onNext`'s derde, optionele argument draagt de
   * ID's van items die dit apparaat OP DEZE notificatie voor het eerst als
   * getombstoned leerde terwijl het zelf nog een niet-getombstoned lokale
   * kopie had — nooit gevuld op een gewone add/remove/replaceAll-notificatie
   * of een cloud-update zonder zo'n transitie. `app/App.tsx` gebruikt dit om
   * een zichtbare banner te tonen i.p.v. het item stilzwijgend te laten
   * verdwijnen.
   */
  subscribe?(
    onNext: (
      result: CompletedGamesReadResult,
      cloudSync: SyncState | null,
      removedByCloudTombstone?: readonly string[],
    ) => void,
    onError?: (error: unknown) => void,
  ): () => void;
  /**
   * PR 7.2c (docs/pr-7.2-plan.md §C 7.2c): optioneel — alleen geïmplementeerd
   * door `CompositeCompletedGameRepository`, net als `subscribe()` hierboven.
   * Verwijdert `id` via een server-side tombstone-fieldpatch in plaats van
   * `remove()`'s directe lokale verwijdering: nodig zodra een item al een
   * cloud-tegenhanger heeft (anders zou de eerstvolgende cloud-snapshot-
   * update de lokale `remove()` ongedaan maken, zie
   * `CompositeCompletedGameRepository`'s docstring). `deletedBy` is de uid
   * van de aanroeper (rules herleiden de bevoegdheid zelf opnieuw uit
   * `request.auth`, dit veld is uitsluitend audit-provenance).
   *
   * Resultaat:
   * - `'ok'`: server-bevestigd getombstoned; verdwijnt uit de zichtbare lijst.
   * - `'not-synced'`: nog geen cloud-tegenhanger (nog niet server-bevestigd
   *   afgerond) — er is niets om te patchen; de aanroeper valt terug op de
   *   bestaande "nog niet gesynchroniseerd, verwijderen geblokkeerd"-tekst.
   * - `'error'`: de patch is geprobeerd maar afgewezen/gefaald (Rules,
   *   revisiemismatch, netwerk) — de lokale kopie is ONGEMOEID gelaten.
   */
  tombstone?(id: string, deletedBy: string): Promise<'ok' | 'not-synced' | 'error'>;
}

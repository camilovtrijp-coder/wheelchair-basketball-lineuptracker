import type { CompletedGame } from '../../domain/game/types';

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
}

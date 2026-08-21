// Samengestelde afgeronde-wedstrijd-historie: lokaal ∪ cloud (PR 7.2b,
// docs/pr-7.2-plan.md §C 7.2b werk 1/3). Composeert een bestaande
// `CompletedGameRepository` (in de praktijk altijd
// `LocalStorageCompletedGameRepository`) met een `CloudCompletedGameSource`
// (`FirestoreCompletedGameRepository`) ACHTER dezelfde `CompletedGameRepository`-
// poort, zodat `StatsPanel`/`TrendsPanel`/`HistoryPanel` ongewijzigd blijven
// (ze importeren geen Firestore, zien alleen deze poort — plan §C 7.2b werk
// 3: "dezelfde samengestelde bron... zonder afwijkende berekeningen").
//
// Samenvoegcontract (werk 1): gededupliceerd op `CompletedGame.id`. Dat ID
// is zowel het lokale sleutelveld als het Firestore-documentnaam-ID voor
// `completedGames/{completedGameId}` — `GameSyncCoordinator.finalize()`
// gebruikt letterlijk `completed.id` als `completedGameId` (zie
// `application/game/GameSyncCoordinator.ts`), dus een item dat op dit
// apparaat is afgerond en al lokaal staat, komt na server-bevestiging met
// EXACT hetzelfde ID terug in de cloudquery. Bij een botsing wint de lokale
// versie (inhoudelijk toch byte-identiek, zie `projectCompletedGameForCloud
// .ts`'s docstring) — dat vermijdt onnodig heruitlijnen van React-state voor
// een item dat de gebruiker al ziet. Een cloud-only item (afgerond op een
// ANDER apparaat) wordt toegevoegd; de gecombineerde lijst wordt op `date`
// aflopend hersorteerd (nieuwste eerst, v1-pariteit) omdat lokaal-toegevoegde
// items vooraan staan (`add()` unshift't) terwijl de cloudquery al op
// `date` gesorteerd binnenkomt — zonder hersortering zou een cloud-only
// item van vóór de laatst-lokale wedstrijd toch onderaan blijven staan.
//
// PR 7.2c (docs/pr-7.2-plan.md §C 7.2c werk 1/2): een lokale `remove()`
// verwijdert nog altijd alleen de lokale kopie — als het item al
// server-bevestigd is, blijft de cloud-snapshot daardoor bestaan en
// verschijnt hij na de eerstvolgende cloud-snapshot-update gewoon weer in de
// samengevoegde lijst. `tombstone()` hieronder is daarom het ECHTE
// verwijderpad voor een server-bevestigd item: het patcht een
// `deletedAt`/`deletedBy` op de cloud-snapshot zelf (via `GameCloudGateway.
// tombstoneCompletedGame()`), niet alleen de lokale kopie. `app/App.tsx`
// kiest per geval tussen `remove()` (nog nooit geüpload, niets om te
// tombstonen) en `tombstone()` (al server-bevestigd).
//
// Resurrectie-preventie (plan §C 7.2c werk 2, acceptatie "een verwijderd
// item keert niet terug, een late client verliest zijn lokale bron niet
// stil"): `mergeGames()` filtert elk cloud-item met `deletedAt != null` altijd
// uit de zichtbare lijst — ongeacht of er nog een niet-getombstoned lokale
// kopie bestaat. Het cloud-abonnement in `subscribe()` ruimt zo'n lokale
// kopie bovendien proactief op (`local.remove()`) zodra de bijbehorende
// cloud-snapshot een tombstone draagt, zodat een later apparaat dat zelf nog
// nooit van de tombstone wist (bijv. offline tijdens het verwijderen) 'm bij
// de eerste online cloud-snapshot alsnog leert en niet blijft "resurrecten"
// bij elke volgende render. Vóór dat moment (nog offline, nog geen
// cloud-snapshot ontvangen) blijft de lokale kopie zichtbaar — dat is geen
// resurrectie, dat is een eerlijke offline-cachestand (zelfde patroon als de
// rest van PR 7.2b's offline-cache-garanties).

import type { CompletedGame } from '../../domain/game/types';
import type { SyncState } from '../../domain/syncState';
import type {
  CompletedGameRepository,
  CompletedGamesReadResult,
} from '../../application/game/CompletedGameRepository';
import type { CloudCompletedGameSource } from './FirestoreCompletedGameRepository';

type Listener = (result: CompletedGamesReadResult, cloudSync: SyncState | null) => void;
type ErrorListener = (error: unknown) => void;

/** PR 7.2c: het smalle schrijfcontract dat `tombstone()` nodig heeft — een
 * `GameCloudGateway` voldoet hier structureel aan zonder dat deze klasse de
 * volledige poort (ensureGame/uploadActions/patchSnapshot/...) hoeft te
 * kennen. */
export interface CompletedGameTombstoneWriter {
  tombstoneCompletedGame(
    organizationId: string,
    teamId: string,
    completedGameId: string,
    deletedBy: string,
    expectedRevision: number,
  ): Promise<{ ok: boolean; revision?: number; error?: unknown }>;
}

export class CompositeCompletedGameRepository implements CompletedGameRepository {
  private cloudGames: CompletedGame[] = [];
  private cloudSync: SyncState | null = null;
  private readonly listeners = new Map<Listener, ErrorListener | undefined>();
  private cloudUnsubscribe: (() => void) | null = null;

  constructor(
    private readonly local: CompletedGameRepository,
    private readonly cloud: CloudCompletedGameSource,
    private readonly cloudWriter: CompletedGameTombstoneWriter,
  ) {}

  private readLocal(): CompletedGamesReadResult {
    if (this.local.safeList) return this.local.safeList();
    return { status: 'ok', games: this.local.list() };
  }

  private mergeGames(localGames: CompletedGame[], cloudGames: CompletedGame[]): CompletedGame[] {
    // PR 7.2c: een cloud-tombstone wint altijd, ook over een niet-
    // getombstoned lokale kopie (resurrectie-preventie, zie bestandsdocstring
    // hierboven) — dus eerst de getombstoned ID's uitfilteren aan BEIDE
    // kanten, vóór de bestaande lokaal-wint-dedupe.
    const tombstonedIds = new Set(cloudGames.filter((g) => g.deletedAt != null).map((g) => g.id));
    const visibleLocal = localGames.filter((g) => !tombstonedIds.has(g.id));
    const visibleCloud = cloudGames.filter((g) => g.deletedAt == null);
    const localIds = new Set(visibleLocal.map((g) => g.id));
    const merged = [...visibleLocal, ...visibleCloud.filter((g) => !localIds.has(g.id))];
    return merged.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  list(): CompletedGame[] {
    return this.safeList().games;
  }

  safeList(): CompletedGamesReadResult {
    const localResult = this.readLocal();
    // Een lokale leesfout blijft leidend: de cloudquery bevat mogelijk niet
    // álles wat lokaal ooit is opgeslagen (bijv. offline afgeronde
    // wedstrijden die nog niet zijn geüpload), dus zomaar alleen cloudgames
    // tonen zou een onvolledige/misleidende lijst opleveren zonder dat de
    // gebruiker weet dat er lokaal iets misging. Zie ook de bestaande
    // `LocalStorageCompletedGameRepository`-docstring: `error` moet altijd
    // als foutmelding zichtbaar zijn, nooit als (deels) gevulde lijst.
    if (localResult.status === 'error') {
      return { status: 'error', games: [] };
    }
    const games = this.mergeGames(localResult.games, this.cloudGames);
    if (games.length > 0) return { status: 'ok', games };
    return { status: localResult.status, games: [] };
  }

  safeListStrict(): CompletedGamesReadResult {
    // Back-up-export blijft een zuiver lokaal contract (zie de poort-
    // docstring): een cloud-leesfout of -vertraging mag een lokale back-up
    // niet blokkeren of onvolledig maken.
    if (this.local.safeListStrict) return this.local.safeListStrict();
    return this.readLocal();
  }

  add(game: CompletedGame): boolean {
    const ok = this.local.add(game);
    if (ok) this.notify();
    return ok;
  }

  remove(id: string): boolean {
    const ok = this.local.remove(id);
    if (ok) this.notify();
    return ok;
  }

  replaceAll(games: CompletedGame[]): boolean {
    const ok = this.local.replaceAll(games);
    if (ok) this.notify();
    return ok;
  }

  /** PR 7.2b: `true` zodra dit ID ook als cloud-snapshot bekend is — gebruikt
   * door `app/App.tsx` om een lokale `remove()` te blokkeren die anders door
   * de eerstvolgende cloud-snapshot-update ongedaan gemaakt zou worden (zie
   * bestandsdocstring). */
  hasCloudCopy(id: string): boolean {
    return this.cloudGames.some((g) => g.id === id);
  }

  /**
   * PR 7.2c: tombstone-verwijderpad voor een server-bevestigd item (zie
   * bestandsdocstring). `'not-synced'` als er geen cloud-tegenhanger bekend
   * is — de aanroeper (`app/App.tsx`) valt dan terug op de bestaande
   * "nog niet gesynchroniseerd"-blokkade, precies zoals vóór PR 7.2c.
   */
  async tombstone(id: string, deletedBy: string): Promise<'ok' | 'not-synced' | 'error'> {
    const cloudEntry = this.cloudGames.find((g) => g.id === id);
    if (!cloudEntry) return 'not-synced';
    const result = await this.cloudWriter.tombstoneCompletedGame(
      cloudEntry.organizationId,
      cloudEntry.teamId,
      id,
      deletedBy,
      cloudEntry.revision,
    );
    if (!result.ok) return 'error';
    // Proactieve lokale opruiming voor snelle UI-feedback op DIT apparaat —
    // niet vereist voor correctheid (de eerstvolgende cloud-snapshot draagt
    // de tombstone toch al en `mergeGames()` filtert 'm hoe dan ook), maar
    // voorkomt dat de net-verwijderde wedstrijd nog kortstondig zichtbaar
    // blijft tot die snapshot binnenkomt.
    this.local.remove(id);
    this.notify();
    return 'ok';
  }

  subscribe(onNext: Listener, onError?: ErrorListener): () => void {
    this.listeners.set(onNext, onError);
    if (this.cloudUnsubscribe === null) {
      this.cloudUnsubscribe = this.cloud.subscribe(
        (games, sync) => {
          this.cloudGames = games;
          this.cloudSync = sync;
          // Resurrectie-preventie (zie bestandsdocstring): een net binnen-
          // gekomen cloud-tombstone ruimt een eventuele niet-getombstoned
          // lokale kopie meteen op, zodat een later apparaat dat de
          // tombstone nog niet kende 'm bij dit eerste online-moment leert
          // en 'm niet blijft terugzien uit zijn eigen lokale opslag.
          for (const game of games) {
            if (game.deletedAt != null) this.local.remove(game.id);
          }
          this.notify();
        },
        (err) => {
          for (const errorListener of this.listeners.values()) {
            if (errorListener) errorListener(err);
          }
        },
      );
    }
    onNext(this.safeList(), this.cloudSync);
    return () => {
      this.listeners.delete(onNext);
      if (this.listeners.size === 0 && this.cloudUnsubscribe) {
        this.cloudUnsubscribe();
        this.cloudUnsubscribe = null;
        this.cloudGames = [];
        this.cloudSync = null;
      }
    };
  }

  private notify(): void {
    const result = this.safeList();
    for (const onNext of this.listeners.keys()) {
      onNext(result, this.cloudSync);
    }
  }
}

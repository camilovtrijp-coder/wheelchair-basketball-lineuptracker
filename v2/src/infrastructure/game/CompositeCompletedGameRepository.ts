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
// Bewust NIET opgelost hier (7.2c-scope, zie plan §D "geen edit-API voor
// afgeronde kerninhoud"): een lokale `remove()` verwijdert alleen de lokale
// kopie. Als het item al server-bevestigd is, blijft de cloud-snapshot
// bestaan en verschijnt hij na de eerstvolgende cloud-snapshot-update
// gewoon weer in de samengevoegde lijst (firestore.rules staat vóór PR 7.2c
// geen `update`/`delete` op `completedGames` toe — er is dus letterlijk
// niets om vanaf hier te verwijderen). `app/App.tsx` blokkeert `remove()`
// daarom in cloud-modus zodra een item een cloud-tegenhanger heeft, tot
// PR 7.2c een tombstone-fieldpatch toevoegt.

import type { CompletedGame } from '../../domain/game/types';
import type { SyncState } from '../../domain/syncState';
import type {
  CompletedGameRepository,
  CompletedGamesReadResult,
} from '../../application/game/CompletedGameRepository';
import type { CloudCompletedGameSource } from './FirestoreCompletedGameRepository';

type Listener = (result: CompletedGamesReadResult, cloudSync: SyncState | null) => void;
type ErrorListener = (error: unknown) => void;

export class CompositeCompletedGameRepository implements CompletedGameRepository {
  private cloudGames: CompletedGame[] = [];
  private cloudSync: SyncState | null = null;
  private readonly listeners = new Map<Listener, ErrorListener | undefined>();
  private cloudUnsubscribe: (() => void) | null = null;

  constructor(
    private readonly local: CompletedGameRepository,
    private readonly cloud: CloudCompletedGameSource,
  ) {}

  private readLocal(): CompletedGamesReadResult {
    if (this.local.safeList) return this.local.safeList();
    return { status: 'ok', games: this.local.list() };
  }

  private mergeGames(localGames: CompletedGame[], cloudGames: CompletedGame[]): CompletedGame[] {
    const localIds = new Set(localGames.map((g) => g.id));
    const merged = [...localGames, ...cloudGames.filter((g) => !localIds.has(g.id))];
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

  subscribe(onNext: Listener, onError?: ErrorListener): () => void {
    this.listeners.set(onNext, onError);
    if (this.cloudUnsubscribe === null) {
      this.cloudUnsubscribe = this.cloud.subscribe(
        (games, sync) => {
          this.cloudGames = games;
          this.cloudSync = sync;
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

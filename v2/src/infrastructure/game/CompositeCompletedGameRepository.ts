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
//
// "Niet stil" (externe review PR #65, P1 op het letterlijke acceptatiecriterium
// "een late client verliest zijn lokale bron niet stil en de zichtbare status
// verklaart wat herstel vraagt"): het precieze moment waarop DIT apparaat de
// tombstone leert — bijv. na een reconnect terwijl het zelf nog een oudere,
// niet-getombstoned lokale kopie had — is voor de gebruiker van dit apparaat
// zelf een relevante gebeurtenis, geen achtergrondopruiming. `subscribe()`
// geeft de ID's van zo'n net-geleerde tombstone daarom door als DERDE,
// optioneel argument aan `onNext` (alleen gevuld op de transitie waarop dit
// gebeurt, nooit `undefined`→leeg op een gewone update) — `app/App.tsx` zet
// dit om in een zichtbare `HistoryPanel`-banner (`tombstoneNotice`), zodat de
// gebruiker ziet WAAROM een wedstrijd verdween i.p.v. 'm gewoon te missen.

//
// PR 7.5c (docs/pr-7.5-plan.md §D.3/§D.4): correcties van afgeronde wedstrijden.
// - Merge: bij een ID-botsing wint de HOGERE `revision` (cloud of lokaal); bij
//   gelijke revisie de lokale kopie (ongewijzigd gedrag). Een cloud-tombstone
//   wint nog altijd van alles. Zo verbergt een oudere lokale kopie nooit een
//   nieuwere cloudcorrectie van een ander apparaat.
// - Lokaal eerst: `update()` schrijft altijd eerst lokaal (werkt volledig
//   offline) en start daarna pas de cloudupload. Geen vals succes: de status
//   is `wacht-op-synchronisatie` tot de server de correctie bevestigde.
// - Hervatbaar zonder nieuwe opslag: "wat moet nog omhoog" wordt telkens
//   afgeleid uit de data zelf (`compareCorrectionLineage`: het cloudlog is een
//   voorvoegsel van het lokale log en lokaal heeft een hogere revisie). Bij
//   elke cloud-snapshot (dus ook na een herstart of reconnect) worden de
//   ontbrekende correcties een voor een geupload; de stappen worden uit het
//   log gereconstrueerd via `correctSegment()` op de cloudkopie.
// - Loopt de cloud voor, dan wordt de lokale kopie via `local.update()`
//   bijgewerkt (de 7.5a-regels beslissen; weigert die, dan blijft de lokale
//   data staan en toont de lijst de cloudversie). Zijn beide kanten uit elkaar
//   gelopen (`diverged`) of weigert de server de revisie, dan is de status
//   `conflict`: niets wordt samengevoegd of overschreven. Oplossen = de lokale
//   kopie verwijderen (`remove()`; de cloudkopie blijft) en opnieuw corrigeren.

import { correctSegment } from '../../domain/game/correction';
import {
  compareCorrectionLineage,
  pickHigherRevision,
  revisionOf,
} from '../../domain/game/correctionLineage';
import type { CompletedGame } from '../../domain/game/types';
import type { SyncState } from '../../domain/syncState';
import type {
  CompletedGameRepository,
  CompletedGamesReadResult,
  CorrectionSyncStatus,
} from '../../application/game/CompletedGameRepository';
import type {
  CompletedGameCorrectionPayload,
  CompletedGameCorrectionResult,
} from '../../application/game/GameCloudGateway';
import { projectCompletedGameCorrection } from '../../application/game/projectCompletedGameForCloud';
import type { CloudCompletedGameSource } from './FirestoreCompletedGameRepository';

type Listener = (
  result: CompletedGamesReadResult,
  cloudSync: SyncState | null,
  /** Niet-lege array van `CompletedGame.id`'s die dit apparaat op DEZE
   * cloud-snapshot voor het eerst als getombstoned leerde terwijl er nog
   * een niet-getombstoned lokale kopie bestond — `undefined` op elke andere
   * notificatie (mount, add/remove/replaceAll, een reguliere cloud-update
   * zonder zo'n transitie). Zie bestandsdocstring "Niet stil". */
  removedByCloudTombstone?: readonly string[],
) => void;
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

/** PR 7.5c: het smalle correctiecontract; een `GameCloudGateway` voldoet hier structureel aan. */
export interface CompletedGameCorrectionWriter {
  correctCompletedGame(
    organizationId: string,
    teamId: string,
    completedGameId: string,
    expectedRevision: number,
    payload: CompletedGameCorrectionPayload,
  ): Promise<CompletedGameCorrectionResult>;
}

/** Foutcodes die een nieuwe poging niet zal oplossen (Rules/auth/validatie). */
const NON_RETRYABLE_CODES = new Set([
  'permission-denied',
  'unauthenticated',
  'invalid-argument',
  'failed-precondition',
  'not-found',
]);

export class CompositeCompletedGameRepository implements CompletedGameRepository {
  private cloudGames: CompletedGame[] = [];
  private cloudSync: SyncState | null = null;
  private readonly listeners = new Map<Listener, ErrorListener | undefined>();
  private cloudUnsubscribe: (() => void) | null = null;

  constructor(
    private readonly local: CompletedGameRepository,
    private readonly cloud: CloudCompletedGameSource,
    private readonly cloudWriter: CompletedGameTombstoneWriter &
      Partial<CompletedGameCorrectionWriter>,
  ) {}

  /** PR 7.5c: gameId -> laatste uploaduitkomst, alleen relevant voor `local-ahead`-wedstrijden. */
  private readonly correctionOutcome = new Map<string, CorrectionSyncStatus>();
  /** PR 7.5c: wedstrijden met een lopende upload (voorkomt parallelle dubbele pogingen). */
  private readonly correctionUploading = new Set<string>();

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
    // PR 7.5c: bij een ID-botsing wint de HOGERE revisie (cloud of lokaal),
    // bij gelijke revisie de lokale kopie.
    const cloudById = new Map(visibleCloud.map((g) => [g.id, g]));
    const localIds = new Set(visibleLocal.map((g) => g.id));
    const merged = [
      ...visibleLocal.map((g) => {
        const cloud = cloudById.get(g.id);
        return cloud ? pickHigherRevision(g, cloud) : g;
      }),
      ...visibleCloud.filter((g) => !localIds.has(g.id)),
    ];
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

  /**
   * PR 7.5a/7.5c: slaat de correctie EERST lokaal op (offline altijd mogelijk,
   * het synchrone resultaat is dat van de lokale opslag) en start daarna, als
   * er een cloud-tegenhanger is, de hervatbare upload (zie bestandsdocstring).
   * Zonder cloud-tegenhanger blijft de status `lokaal-beschikbaar`.
   */
  update(game: CompletedGame): boolean {
    const ok = this.local.update(game);
    if (ok) {
      // Een nieuwe lokale correctie heft een eerdere `actie-nodig` op: de
      // gebruiker heeft opnieuw gehandeld. `conflict` blijft staan.
      if (this.correctionOutcome.get(game.id) === 'actie-nodig') {
        this.correctionOutcome.delete(game.id);
      }
      this.notify();
      this.processCorrectionUploads();
    }
    return ok;
  }

  correctionSyncStatus(id: string): CorrectionSyncStatus | null {
    const local = this.readLocal().games.find((g) => g.id === id);
    const cloud = this.cloudGames.find((g) => g.id === id && g.deletedAt == null);
    const corrected =
      (local?.corrections?.length ?? 0) > 0 || (cloud?.corrections?.length ?? 0) > 0;
    if (!corrected) return null;
    if (!local || !cloud) return local ? 'lokaal-beschikbaar' : 'gesynchroniseerd';
    switch (compareCorrectionLineage(local, cloud)) {
      case 'same':
      case 'cloud-ahead':
        return 'gesynchroniseerd';
      case 'diverged':
        return 'conflict';
      case 'local-ahead':
        return this.correctionOutcome.get(id) ?? 'wacht-op-synchronisatie';
    }
  }

  retryCorrectionUploads(): void {
    for (const [id, status] of [...this.correctionOutcome]) {
      if (status === 'actie-nodig') this.correctionOutcome.delete(id);
    }
    this.notify();
    this.processCorrectionUploads();
  }

  /**
   * PR 7.5c: werkt lokale kopieen bij die achterlopen op de cloud en ruimt
   * verouderde uitkomsten op. Alleen schrijfacties die de 7.5a-regels van
   * `local.update()` toestaan; een weigering laat de lokale data ongemoeid.
   */
  private reconcileCorrections(cloudGames: CompletedGame[]): void {
    const localById = new Map(this.readLocal().games.map((g) => [g.id, g]));
    for (const cloud of cloudGames) {
      if (cloud.deletedAt != null) continue;
      const local = localById.get(cloud.id);
      if (!local) continue;
      const lineage = compareCorrectionLineage(local, cloud);
      if (lineage === 'cloud-ahead') this.local.update(cloud);
      if (lineage === 'same' || lineage === 'cloud-ahead') this.correctionOutcome.delete(cloud.id);
    }
  }

  /** PR 7.5c: upload voor elke `local-ahead`-wedstrijd de eerstvolgende ontbrekende correctie. */
  private processCorrectionUploads(): void {
    const writer = this.cloudWriter.correctCompletedGame?.bind(this.cloudWriter);
    // Zonder serverbevestigde snapshot (nog niets ontvangen, of alleen cache)
    // is de cloudbasis onzeker: wachten op de volgende snapshot i.p.v. blind
    // proberen. De lokale status blijft intussen eerlijk `wacht-op-synchronisatie`.
    if (!writer || this.cloudSync === null || this.cloudSync.fromCache) return;
    for (const local of this.readLocal().games) {
      const cloud = this.cloudGames.find((g) => g.id === local.id && g.deletedAt == null);
      if (!cloud || this.correctionUploading.has(local.id)) continue;
      if (compareCorrectionLineage(local, cloud) !== 'local-ahead') continue;
      const status = this.correctionOutcome.get(local.id);
      if (status === 'conflict' || status === 'actie-nodig') continue;
      void this.uploadNextCorrection(local, cloud, writer);
    }
  }

  private async uploadNextCorrection(
    local: CompletedGame,
    cloud: CompletedGame,
    writer: CompletedGameCorrectionWriter['correctCompletedGame'],
  ): Promise<void> {
    const next = (local.corrections ?? [])[cloud.corrections?.length ?? 0];
    if (!next) return;
    // Reconstrueer de cloudstap deterministisch uit het log: dezelfde
    // `correctSegment()` op de cloudkopie met het vastgelegde tijdstip/ID.
    const replay = correctSegment(cloud, next.segmentId, next.after, next.by, {
      now: new Date(next.at),
      id: next.id,
    });
    const payload = replay.ok
      ? projectCompletedGameCorrection(replay.game, replay.correction)
      : null;
    const consistent =
      replay.ok &&
      JSON.stringify(replay.correction.before) === JSON.stringify(next.before) &&
      JSON.stringify(replay.correction.after) === JSON.stringify(next.after);
    if (!replay.ok || !consistent || payload === null) {
      // De lokale en cloudkopie sluiten niet op elkaar aan: niet gokken.
      this.setCorrectionOutcome(local.id, 'conflict');
      return;
    }
    this.correctionUploading.add(local.id);
    this.setCorrectionOutcome(local.id, 'wacht-op-synchronisatie');
    let result: CompletedGameCorrectionResult;
    try {
      result = await writer(
        cloud.organizationId,
        cloud.teamId,
        local.id,
        revisionOf(cloud),
        payload,
      );
    } catch (error) {
      result = { ok: false, error };
    } finally {
      this.correctionUploading.delete(local.id);
    }
    if (result.ok) {
      // Server-bevestigd. De volgende cloud-snapshot (die de SDK na de write
      // altijd levert) toont het nieuwe log en start zo de eventuele volgende stap.
      this.correctionOutcome.delete(local.id);
      this.notify();
      return;
    }
    const code = (result.error as { code?: unknown } | undefined)?.code;
    const outcome: CorrectionSyncStatus = result.conflict
      ? 'conflict'
      : typeof code === 'string' && NON_RETRYABLE_CODES.has(code)
        ? 'actie-nodig'
        : 'wacht-op-synchronisatie';
    this.setCorrectionOutcome(local.id, outcome);
  }

  private setCorrectionOutcome(id: string, status: CorrectionSyncStatus): void {
    if (this.correctionOutcome.get(id) === status) return;
    this.correctionOutcome.set(id, status);
    this.notify();
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
          // en 'm niet blijft terugzien uit zijn eigen lokale opslag. Vóór
          // het opruimen wordt vastgelegd WELKE ID's dit betreft ("Niet
          // stil", zie bestandsdocstring) — alleen items die dit apparaat
          // nog als lokaal-aanwezig had, niet elk getombstoned cloud-item
          // (dat kan er ook al vóór dit apparaat ooit iets wist gewoon bij
          // zitten, bijv. door een ander teamlid getombstoned zonder dat dit
          // apparaat het item ooit lokaal had).
          const localIdsBeforePurge = new Set(this.readLocal().games.map((g) => g.id));
          const newlyLearnedTombstones = games
            .filter((g) => g.deletedAt != null && localIdsBeforePurge.has(g.id))
            .map((g) => g.id);
          for (const game of games) {
            if (game.deletedAt != null) this.local.remove(game.id);
          }
          // PR 7.5c: lokale kopieen die achterlopen bijwerken en daarna
          // eventueel achterstallige correcties uploaden (hervatten).
          this.reconcileCorrections(games);
          this.notify(newlyLearnedTombstones.length > 0 ? newlyLearnedTombstones : undefined);
          this.processCorrectionUploads();
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

  private notify(removedByCloudTombstone?: readonly string[]): void {
    const result = this.safeList();
    for (const onNext of this.listeners.keys()) {
      onNext(result, this.cloudSync, removedByCloudTombstone);
    }
  }
}

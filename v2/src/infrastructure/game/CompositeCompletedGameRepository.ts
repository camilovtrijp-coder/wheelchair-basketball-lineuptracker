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
//   elke cloud-snapshot worden de ontbrekende correcties een voor een
//   geupload; de stappen worden uit het log gereconstrueerd via
//   `correctSegment()` op de cloudkopie (alleen de GEWIJZIGDE velden als patch,
//   vergeleken per veld).
// - Alleen wat op dit apparaat bewust is gemaakt gaat automatisch omhoog
//   (review PR #134). Zonder nieuwe localStorage-key is "op dit apparaat gemaakt"
//   niet bewijsbaar na een herstart; daarom houdt `update()` een in-memory set
//   van correctie-ID's bij en geldt: een correctie die NIET in die set zit
//   (app herstart, of een back-up-herstel via `replaceAll`, dat de set ook
//   wist) wordt nooit automatisch geupload en krijgt status `actie-nodig`; pas
//   `retryCorrectionUploads()` (bewuste gebruikersactie) keurt ze goed.
//   Gevolg: offline gecorrigeerd + app gesloten + later online heropend = de
//   correctie staat veilig lokaal maar wacht op die ene bevestiging. Dit is
//   bewust de veilige variant boven stil pushen van ongecontroleerde data.
// - Geen vals succes bij latency compensation: een cloudsnapshot met
//   `hasPendingWrites` (per document, anders voor de hele snapshot) bevat een
//   eigen, onbevestigde write en telt nooit als `gesynchroniseerd`; het
//   statusrecord blijft dan staan.
// - Een wedstrijd die alleen in de cloud staat (op een ander apparaat afgerond)
//   wordt bij `update()` eerst als cloudkopie lokaal opgenomen (niet bij
//   tombstone/ander org/team, geen duplicaat) en volgt dan dezelfde flow.
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
import type { CompletedGame, CorrectableSegmentFields } from '../../domain/game/types';
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

const CORRECTABLE_KEYS = ['quarter', 'beginSec', 'endSec', 'pf', 'pa', 'tov'] as const;

/** Veldgewijze vergelijking (niet afhankelijk van sleutelvolgorde zoals JSON.stringify). */
function sameFields(a: CorrectableSegmentFields, b: CorrectableSegmentFields): boolean {
  return CORRECTABLE_KEYS.every((key) => a[key] === b[key]);
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
  /** Review PR #134: ID's van documenten met een eigen, nog niet server-bevestigde write
   * (`null` = de bron gaf dit niet door; dan telt `cloudSync.hasPendingWrites`). */
  private cloudPendingIds: ReadonlySet<string> | null = null;
  /** Review PR #134: correctie-ID's die in DEZE sessie op dit apparaat via `update()` zijn
   * gemaakt (of via een bewuste `retryCorrectionUploads()` zijn goedgekeurd). Alleen
   * deze mogen automatisch omhoog; bewust alleen in het geheugen (zie bestandsdocstring). */
  private readonly approvedCorrectionIds = new Set<string>();
  /** Review PR #134: correctie-ID's die de server bevestigde; voorkomt een dubbele upload
   * zolang de cloud-snapshot nog niet bijgewerkt is en vormt de lusbeveiliging. */
  private readonly confirmedCorrectionIds = new Set<string>();

  /** `true` zolang dit cloud-document een eigen, onbevestigde write toont. */
  private isCloudPending(id: string): boolean {
    if (this.cloudPendingIds !== null) return this.cloudPendingIds.has(id);
    return this.cloudSync?.hasPendingWrites === true;
  }

  /** Alle nog te uploaden correcties van `local` (die de cloud nog niet kent) zijn goedgekeurd. */
  private isUploadApproved(local: CompletedGame, cloud: CompletedGame): boolean {
    const missing = (local.corrections ?? []).slice(cloud.corrections?.length ?? 0);
    return missing.every((c) => this.approvedCorrectionIds.has(c.id));
  }

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
    const priorLocal = this.readLocal().games.find((g) => g.id === game.id);
    let priorLog = priorLocal?.corrections ?? [];
    let ok = this.local.update(game);
    if (!ok && priorLocal === undefined) {
      // Review PR #134: een wedstrijd die alleen in de cloud staat (op een ander
      // apparaat afgerond). Neem de cloudkopie eerst lokaal op en volg dan de
      // gewone lokaal-eerst-flow. Geen duplicaat: alleen als er lokaal niets onder
      // dit ID staat; getombstoned/andere organisatie of team wordt niet opgenomen.
      const cloud = this.cloudGames.find((g) => g.id === game.id && g.deletedAt == null);
      if (
        cloud !== undefined &&
        cloud.organizationId === game.organizationId &&
        cloud.teamId === game.teamId &&
        this.local.add(cloud)
      ) {
        priorLog = cloud.corrections ?? [];
        ok = this.local.update(game);
        // Weigerde de 7.5a-validatie de correctie, dan blijft er niets achter.
        if (!ok) this.local.remove(game.id);
      }
    }
    if (ok) {
      // Alleen wat nu pas aan het log is toegevoegd, is op dit apparaat gemaakt.
      const known = new Set(priorLog.map((c) => c.id));
      for (const c of game.corrections ?? []) {
        if (!known.has(c.id)) this.approvedCorrectionIds.add(c.id);
      }
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
    // Geen vals succes (review PR #134): een cloudsnapshot met latency compensation
    // bevat je EIGEN nog niet bevestigde write. Zolang het document pending writes
    // heeft is het log wel gelijk, maar nog niet server-bevestigd.
    const pendingStatus = (): CorrectionSyncStatus =>
      this.correctionOutcome.get(id) ?? 'wacht-op-synchronisatie';
    if (!local) return cloud && this.isCloudPending(id) ? pendingStatus() : 'gesynchroniseerd';
    if (!cloud) return 'lokaal-beschikbaar';
    switch (compareCorrectionLineage(local, cloud)) {
      case 'same':
      case 'cloud-ahead':
        return this.isCloudPending(id) ? pendingStatus() : 'gesynchroniseerd';
      case 'diverged':
        return 'conflict';
      case 'local-ahead':
        // Niet op dit apparaat gemaakt (herstart/back-up-herstel): niet automatisch
        // geüpload, dus ook niet "wachtend" noemen; de gebruiker moet bewust kiezen.
        return (
          this.correctionOutcome.get(id) ??
          (this.isUploadApproved(local, cloud) ? 'wacht-op-synchronisatie' : 'actie-nodig')
        );
    }
  }

  hasConfirmedCloudCopy(id: string): boolean {
    return (
      this.cloudGames.some((g) => g.id === id && g.deletedAt == null) && !this.isCloudPending(id)
    );
  }

  retryCorrectionUploads(): void {
    // Een bewuste gebruikersactie: keur alle nu ontbrekende correcties goed.
    for (const local of this.readLocal().games) {
      const cloud = this.cloudGames.find((g) => g.id === local.id && g.deletedAt == null);
      if (!cloud || compareCorrectionLineage(local, cloud) !== 'local-ahead') continue;
      for (const c of (local.corrections ?? []).slice(cloud.corrections?.length ?? 0)) {
        this.approvedCorrectionIds.add(c.id);
      }
    }
    for (const [id, status] of [...this.correctionOutcome]) {
      if (status === 'actie-nodig') this.correctionOutcome.delete(id);
    }
    this.notify();
    this.processCorrectionUploads();
  }

  /**
   * PR 7.6b (docs/pr-7.6-plan.md §D.3): verwerpt bewust ALLEEN de lokale kopie
   * van wedstrijd `id`, bijv. na een `conflict`. Raakt de cloud nooit aan: geen
   * tombstone, geen write, geen gateway-aanroep. De cloudversie verschijnt
   * daarna via `mergeGames()` weer als cloud-only wedstrijd en kan opnieuw
   * gecorrigeerd worden. Zonder niet-getombstoned cloudkopie van dezelfde
   * organisatie/team (of bij een onbekend id, een lopende upload of een
   * opslagfout) gebeurt er niets en is het resultaat `false`: anders raakt de
   * gebruiker de enige kopie kwijt of ontstaat een halve toestand.
   */
  discardLocalCorrection(id: string): boolean {
    const localResult = this.readLocal();
    if (localResult.status === 'error') return false;
    const localGame = localResult.games.find((g) => g.id === id);
    if (!localGame) return false;
    const cloud = this.cloudGames.find((g) => g.id === id);
    if (
      !cloud ||
      cloud.deletedAt != null ||
      cloud.organizationId !== localGame.organizationId ||
      cloud.teamId !== localGame.teamId
    ) {
      return false;
    }
    // Een upload is al onderweg; het eindresultaat zou een verwijderde kopie
    // weer van een uitkomst voorzien. Eerst laten afronden.
    if (this.correctionUploading.has(id)) return false;
    // Een eigen, nog onbevestigde cloudwrite maakt de "cloudkopie" een
    // latency-gecompenseerde weergave van onze eigen wijziging: geen teamversie.
    if (this.isCloudPending(id)) return false;
    if (!this.local.remove(id)) return false;
    // Alleen na een geslaagde lokale verwijdering de afgeleide toestand wissen.
    for (const c of localGame.corrections ?? []) {
      this.approvedCorrectionIds.delete(c.id);
      this.confirmedCorrectionIds.delete(c.id);
    }
    this.correctionOutcome.delete(id);
    this.notify();
    return true;
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
      // Een document met een eigen, onbevestigde write is nog niet definitief:
      // niets overnemen en het statusrecord niet wissen (review PR #134).
      if (this.isCloudPending(cloud.id)) continue;
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
      // Alleen correcties die op dit apparaat bewust zijn gemaakt/goedgekeurd.
      if (!this.isUploadApproved(local, cloud)) continue;
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
    // Al server-bevestigd maar de cloud-snapshot loopt nog achter: wachten op die
    // snapshot i.p.v. dezelfde correctie nogmaals te sturen (ook de lusbeveiliging).
    if (!next || this.confirmedCorrectionIds.has(next.id)) return;
    // Reconstrueer de cloudstap deterministisch uit het log: dezelfde
    // `correctSegment()` op de cloudkopie met het vastgelegde tijdstip/ID.
    // Review PR #134: alleen de velden die de correctie WIJZIGDE gaan als patch mee;
    // ongewijzigde velden (bijv. een oude `beginSec`) mogen de replay niet blokkeren.
    const patch: Partial<CorrectableSegmentFields> = {};
    for (const key of CORRECTABLE_KEYS) {
      if (next.after[key] !== next.before[key]) patch[key] = next.after[key];
    }
    const replay = correctSegment(cloud, next.segmentId, patch, next.by, {
      now: new Date(next.at),
      id: next.id,
    });
    const payload = replay.ok
      ? projectCompletedGameCorrection(replay.game, replay.correction)
      : null;
    const consistent =
      replay.ok &&
      sameFields(replay.correction.before, next.before) &&
      sameFields(replay.correction.after, next.after);
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
      this.confirmedCorrectionIds.add(next.id);
      this.correctionOutcome.delete(local.id);
      this.notify();
      // Review PR #134: een tweede wachtende correctie niet laten hangen tot er
      // toevallig weer een snapshot komt. De bevestigde-ID-set is de lusbeveiliging:
      // dezelfde correctie wordt niet opnieuw verstuurd, elke ronde heeft dus een
      // nieuwe, eindige correctie nodig.
      this.processCorrectionUploads();
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
    if (ok) {
      // Review PR #134: een back-up-herstel is geen correctie op dit apparaat. Een
      // herstelde, gecorrigeerde wedstrijd die voorloopt op de cloud mag NOOIT stil
      // omhoog; alle eerdere toestemmingen vervallen.
      this.approvedCorrectionIds.clear();
      this.notify();
    }
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
        (games, sync, pendingIds) => {
          this.cloudGames = games;
          this.cloudSync = sync;
          this.cloudPendingIds = pendingIds ?? null;
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
        this.cloudPendingIds = null;
        this.confirmedCorrectionIds.clear();
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

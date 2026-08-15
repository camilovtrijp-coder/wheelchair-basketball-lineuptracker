// Orkestreert de cloud-sync van één ActiveGame (PR 7.1c, docs/pr-7.1-plan.md
// §C 7.1c). Praat uitsluitend met de application-poorten (GameCloudGateway,
// GameSyncCheckpointRepository) — geen Firebase-import hier, zodat lokale
// modus (geen coordinator geïnstantieerd, zie
// infrastructure/repositories/selectRepositories.ts) gegarandeerd nul
// Firestore/Auth-netwerkrequests veroorzaakt (docs/pr-7.1-plan.md §C 7.1c
// acceptatiecriterium 5).
//
// Eén `sync()`-aanroep doorloopt, in volgorde, precies de stappen die
// firestore.rules (PR 7.1b) vereist:
//   1. ensureGame()   — parentdocument bestaat (create-only, writerUid/
//                        deviceId nog null als dit de eerste keer is).
//   2. initiële claim — ALLEEN als het serverdocument nog geen schrijver
//                        heeft: dit apparaat claimt zichzelf via
//                        patchSnapshot() (Rules' "initiële claim"-pad, PR
//                        7.1b punt 10b). Een reeds geclaimd document door
//                        een ANDER apparaat/andere gebruiker levert hier
//                        'actie-nodig' op — een bestaande claim OVERNEMEN
//                        (i.p.v. voor het eerst claimen) is bewust PR
//                        7.3-scope (transactioneel, met epoch-increment) en
//                        heeft ook geen pad in de PR 7.1b-Rules.
//   3. uploadActions() — alleen nog onbevestigde `GameAction`'s (uit het
//                        lokale checkpoint), elk create-only en idempotent.
//   4. patchSnapshot() — de afgeleide/draaivelden-subset
//                        (`projectGameSnapshotPatch()`), nooit een volledig
//                        documentoverschrijving.
//
// Elke stap die faalt (timeout, Rules-afwijzing, netwerkfout) zet het
// checkpoint naar `'actie-nodig'` en stopt de cyclus — de lokale
// `ActiveGame.actions` blijven ongemoeid (GameRepository/gameRepo.write()
// blijft de enige bron van waarheid voor historie) en een latere `sync()`-
// aanroep (nieuwe actie, reconnect, handmatige retry) probeert gewoon
// opnieuw vanaf de eerste nog-niet-voltooide stap.
import type { ActiveGame, CompletedGame } from '../../domain/game/types';
import type { SyncStatus } from '../../domain/syncState';
import {
  createEmptyGameSyncCheckpoint,
  isActionConfirmed,
  withConfirmedActions,
  type GameSyncCheckpoint,
} from '../../domain/game/syncCheckpoint';
import type { GameCloudGateway } from './GameCloudGateway';
import type { GameSyncCheckpointRepository } from './GameSyncCheckpointRepository';
import {
  projectGameActions,
  projectGameSnapshot,
  projectGameSnapshotPatch,
  type GameCloudWriterContext,
} from './projectGameForCloud';
import { projectCompletedGameSnapshot } from './projectCompletedGameForCloud';

export interface GameSyncCoordinatorDeps {
  gateway: GameCloudGateway;
  checkpoints: GameSyncCheckpointRepository;
  /** Testbare kloktoegang; standaard `() => new Date().toISOString()`. */
  now?: () => string;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'onbekende syncfout';
}

export class GameSyncCoordinator {
  private readonly gateway: GameCloudGateway;
  private readonly checkpoints: GameSyncCheckpointRepository;
  private readonly now: () => string;

  constructor(deps: GameSyncCoordinatorDeps) {
    this.gateway = deps.gateway;
    this.checkpoints = deps.checkpoints;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /**
   * P1-fix (externe review op PR #56): `GameSyncCheckpointRepository.read()`
   * kent alleen `gameId` als sleutel (die is op zichzelf al globaal uniek,
   * zie LocalStorageGameSyncCheckpointRepository.ts), maar een backup-import
   * kan diezelfde `gameId` naar een ANDER organisatie/team retaggen
   * (`domain/backup/migrateV1.ts` `retagWithContext()` behoudt bewust
   * `ActiveGame.id`, wijzigt alleen `organizationId`/`teamId`). Zonder deze
   * check zou een checkpoint uit team A ("actie X is al bevestigd") team B's
   * upload van diezelfde lokale actie-ID stilzwijgend overslaan — team B's
   * Firestore-actielog blijft dan onvolledig terwijl de UI 'gesynchroniseerd'
   * toont. Een checkpoint dat niet bij déze organisatie/team hoort wordt
   * daarom behandeld als "nog geen checkpoint", nooit hergebruikt.
   */
  private readCheckpoint(game: ActiveGame): GameSyncCheckpoint {
    const stored = this.checkpoints.read(game.id);
    if (stored && stored.organizationId === game.organizationId && stored.teamId === game.teamId) {
      return stored;
    }
    return createEmptyGameSyncCheckpoint(game.id, game.organizationId, game.teamId, this.now());
  }

  private fail(checkpoint: GameSyncCheckpoint, error: unknown): GameSyncCheckpoint {
    const failed: GameSyncCheckpoint = {
      ...checkpoint,
      status: 'actie-nodig',
      lastError: describeError(error),
      updatedAt: this.now(),
    };
    this.checkpoints.write(failed);
    return failed;
  }

  /**
   * Synct `game` naar de cloud voor de gegeven schrijveridentiteit. Geeft
   * altijd het (bijgewerkte) lokale checkpoint terug — `status:'idle'`
   * betekent "alles wat bekend was op het moment van aanroepen is bevestigd",
   * `status:'actie-nodig'` betekent "gestopt bij de eerste mislukte stap,
   * zichtbaar via `lastError`, veilig om later opnieuw te proberen".
   */
  async sync(game: ActiveGame, writer: GameCloudWriterContext): Promise<GameSyncCheckpoint> {
    let checkpoint = this.readCheckpoint(game);

    const ensure = await this.gateway.ensureGame(
      game.organizationId,
      game.teamId,
      game.id,
      projectGameSnapshot(game),
    );
    if (!ensure.ok) return this.fail(checkpoint, ensure.error);

    let revision = ensure.revision ?? checkpoint.serverRevision;
    let writerUid = ensure.writerUid ?? null;
    let deviceId = ensure.deviceId ?? null;

    if (writerUid === null && deviceId === null) {
      const claim = await this.gateway.patchSnapshot(
        game.organizationId,
        game.teamId,
        game.id,
        { writerUid: writer.authorUid, deviceId: writer.deviceId },
        revision,
      );
      if (!claim.ok) return this.fail(checkpoint, claim.error);
      revision = claim.revision ?? revision + 1;
      writerUid = writer.authorUid;
      deviceId = writer.deviceId;
    } else if (writerUid !== writer.authorUid || deviceId !== writer.deviceId) {
      // Al geclaimd door een andere schrijver (ander apparaat en/of andere
      // gebruiker) — overname is PR 7.3-scope, hier alleen zichtbaar maken.
      return this.fail(
        checkpoint,
        `wedstrijd is al geclaimd door een andere schrijver (writerUid=${writerUid ?? 'null'})`,
      );
    }

    const allActions = projectGameActions(game, {
      authorUid: writerUid,
      deviceId,
      writerEpoch: writer.writerEpoch,
    });
    const unconfirmed = allActions.filter(
      (action) => !isActionConfirmed(checkpoint, action.actionId),
    );

    if (unconfirmed.length > 0) {
      const outcomes = await this.gateway.uploadActions(
        game.organizationId,
        game.teamId,
        game.id,
        unconfirmed,
      );
      const confirmedIds = outcomes.filter((o) => o.ok).map((o) => o.actionId);
      checkpoint = withConfirmedActions(checkpoint, confirmedIds, this.now());
      this.checkpoints.write(checkpoint);

      const failedOutcome = outcomes.find((o) => !o.ok);
      if (failedOutcome) return this.fail(checkpoint, failedOutcome.error);
    }

    const patchResult = await this.gateway.patchSnapshot(
      game.organizationId,
      game.teamId,
      game.id,
      projectGameSnapshotPatch(game),
      revision,
    );
    if (!patchResult.ok) {
      return this.fail({ ...checkpoint, serverRevision: revision }, patchResult.error);
    }
    revision = patchResult.revision ?? revision + 1;

    const settled: GameSyncCheckpoint = {
      ...checkpoint,
      serverRevision: revision,
      status: 'idle',
      lastError: undefined,
      updatedAt: this.now(),
    };
    this.checkpoints.write(settled);
    return settled;
  }

  /**
   * Rondt `game` af naar de cloud (PR 7.2a, docs/pr-7.2-plan.md §C 7.2a werk
   * 2). Aangeroepen ná `finishGame()`/`completedGameRepo.add()` (die de
   * lokale, altijd-beschikbare bron blijven — zie `app/App.tsx`
   * `handleFinishGame()`); `game` is de zojuist afgeronde `ActiveGame`
   * (nog met zijn volledige `actions`-log), `completed` de daaruit
   * afgeleide, al lokaal opgeslagen `CompletedGame`.
   *
   * Eén `finalize()`-aanroep doorloopt, in volgorde:
   *   1. Lokale kortsluiting — als dit checkpoint al `completedGameId ===
   *      completed.id` draagt, is er niets te doen (idempotent tegen een
   *      herhaalde aanroep binnen dezelfde sessie, geen netwerk nodig).
   *   2. Server-kortsluiting — `ensureGame()` (idempotent, ook een pure
   *      lezing als het document al bestaat) levert de ACTUELE
   *      `completedGameId` op. Nodig omdat de normale/finalize-patchpaden in
   *      firestore.rules (punt 10a/15) een reeds `completedGameId != null`
   *      parentdocument categorisch weigeren: zonder deze voorcontrole zou
   *      een retry na een crash — server al bevestigd, lokaal checkpoint nog
   *      niet bijgewerkt — permanent op `sync()`'s eigen patchstap
   *      vastlopen. Bij een afwijkende `completedGameId` (een andere
   *      snapshot dan verwacht) stopt dit zichtbaar; dat kan legitiem alleen
   *      als er ooit een dubbele/gecorrumpeerde lokale toestand ontstaat.
   *   3. `sync(game, writer)` — hergebruikt de volledige bestaande
   *      finalize-onafhankelijke flow (ensure/claim/upload/patch) zodat de
   *      actieset en de parentsnapshot server-bevestigd zijn vóórdat er een
   *      completed-snapshot ontstaat (docs/pr-7.2-plan.md §B: "een completed
   *      snapshot mag alleen ontstaan als de bijbehorende actionset ...
   *      serverbevestigd" is). Faalt deze stap, dan stopt `finalize()` hier
   *      met exact dat resultaat — geen van de twee stappen hieronder wordt
   *      geprobeerd.
   *   4. `ensureCompletedGame()` — create-only en idempotent (net als
   *      `uploadActions()`): een retry na crash/timeout maakt nooit een
   *      tweede snapshot, en een bestaande snapshot met een AFWIJKENDE
   *      payload faalt zichtbaar i.p.v. vals te slagen.
   *   5. `patchSnapshot({completedGameId: completed.id}, revision)` — de
   *      eenmalige finalize-patch (firestore.rules punt 15); `revision` komt
   *      vers uit stap 3's eigen resultaat, nooit een verouderde lokale
   *      waarde.
   *
   * Bekende grens (bewust, net als PR 7.1c's eigen gedocumenteerde gaten):
   * een browsercrash tussen "lokaal archiveren" (`handleFinishGame()`) en
   * een voltooide `finalize()` kan de raw `ActiveGame.actions` van DIT
   * apparaat niet meer hervatten na een paginareload — v2 kent maar één
   * actieve-wedstrijdslot, dus `gameRepo` is dan al naar een verse opzet
   * gereset. De lokale `CompletedGame` (CSV/Historie) blijft in dat geval
   * altijd beschikbaar; alleen de cloud-sync van precies dát device blijft
   * dan op `'actie-nodig'` staan totdat een gebruiker de app open heeft
   * tijdens een online moment (`app/App.tsx` bewaart een sessie-ref en
   * herprobeert op reconnect, exact zoals de bestaande tracking-sync doet).
   */
  async finalize(
    game: ActiveGame,
    completed: CompletedGame,
    writer: GameCloudWriterContext,
  ): Promise<GameSyncCheckpoint> {
    let checkpoint = this.readCheckpoint(game);

    if (checkpoint.completedGameId === completed.id) {
      return checkpoint;
    }
    if (checkpoint.completedGameId !== undefined) {
      return this.fail(
        checkpoint,
        `wedstrijd is al afgerond naar een andere cloud-snapshot (completedGameId=${checkpoint.completedGameId})`,
      );
    }

    const ensure = await this.gateway.ensureGame(
      game.organizationId,
      game.teamId,
      game.id,
      projectGameSnapshot(game),
    );
    if (!ensure.ok) return this.fail(checkpoint, ensure.error);
    if (ensure.completedGameId != null) {
      if (ensure.completedGameId !== completed.id) {
        return this.fail(
          checkpoint,
          `wedstrijd is server-side al afgerond naar een andere cloud-snapshot (completedGameId=${ensure.completedGameId})`,
        );
      }
      const alreadyDone: GameSyncCheckpoint = {
        ...checkpoint,
        completedGameId: completed.id,
        serverRevision: ensure.revision ?? checkpoint.serverRevision,
        status: 'idle',
        lastError: undefined,
        updatedAt: this.now(),
      };
      this.checkpoints.write(alreadyDone);
      return alreadyDone;
    }

    const synced = await this.sync(game, writer);
    if (synced.status !== 'idle') return synced;
    checkpoint = synced;

    const completedResult = await this.gateway.ensureCompletedGame(
      game.organizationId,
      game.teamId,
      completed.id,
      projectCompletedGameSnapshot(completed),
    );
    if (!completedResult.ok) return this.fail(checkpoint, completedResult.error);

    const patchResult = await this.gateway.patchSnapshot(
      game.organizationId,
      game.teamId,
      game.id,
      { completedGameId: completed.id },
      checkpoint.serverRevision,
    );
    if (!patchResult.ok) return this.fail(checkpoint, patchResult.error);

    const finalized: GameSyncCheckpoint = {
      ...checkpoint,
      completedGameId: completed.id,
      serverRevision: patchResult.revision ?? checkpoint.serverRevision + 1,
      status: 'idle',
      lastError: undefined,
      updatedAt: this.now(),
    };
    this.checkpoints.write(finalized);
    return finalized;
  }

  /**
   * PR 7.2a: synchrone, netwerkloze statuslezing voor de Historie-lijst (elk
   * afgerond item toont `lokaal`/`wacht op synchronisatie`/`gesynchroniseerd`/
   * `actie nodig`, docs/pr-7.2-plan.md §C 7.2a werk 4). Leest uitsluitend het
   * lokale checkpoint — geen `'wacht-op-synchronisatie'`-tussentoestand hier,
   * die zet de aanroeper zelf terwijl een `finalize()`-aanroep in-flight is
   * (zelfde patroon als `app/App.tsx`'s bestaande `gameSyncStatus` voor de
   * actieve wedstrijd).
   */
  readFinalizeStatus(
    sourceGameId: string,
    organizationId: string,
    teamId: string,
    completedGameId: string,
  ): SyncStatus {
    const checkpoint = this.checkpoints.read(sourceGameId);
    if (
      !checkpoint ||
      checkpoint.organizationId !== organizationId ||
      checkpoint.teamId !== teamId
    ) {
      return 'lokaal-beschikbaar';
    }
    if (checkpoint.completedGameId === completedGameId && checkpoint.status === 'idle') {
      return 'gesynchroniseerd';
    }
    if (checkpoint.status === 'actie-nodig') return 'actie-nodig';
    return 'lokaal-beschikbaar';
  }
}

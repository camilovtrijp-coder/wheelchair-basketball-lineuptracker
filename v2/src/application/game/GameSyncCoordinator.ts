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
//                        gateway.claimWriter() (Rules' "initiële claim"-pad,
//                        PR 7.1b punt 10b). Een reeds geclaimd document door
//                        een ANDER apparaat/andere gebruiker levert hier
//                        'actie-nodig' op — dit is bewust GEEN automatische
//                        overname: `ensureWriterClaim()` hieronder (PR 7.3a,
//                        aangeroepen door de pre-game-gate vóór tip-off) en
//                        `gateway.takeoverWriter()` (10d) zijn de enige paden
//                        die een AL geclaimd document overnemen, altijd een
//                        expliciete gebruikersactie.
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
import type { CloudClaimStatus } from '../../domain/game/writerClaim';
import type {
  GameCloudGateway,
  GameCloudSubscriptionCallbacks,
  GameCloudUnsubscribe,
} from './GameCloudGateway';
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
   * PR 7.3a (docs/pr-7.3-plan.md §B/§C 7.3a werk 3): verkrijgt/bevestigt de
   * writerclaim voor `game` VÓÓR tip-off — de pre-game-gate roept dit aan
   * zodra de roster-voorwaarden voldaan zijn (`startBlockReason(game) ===
   * null`) en wacht op `'confirmed'` vóór `startGame()` de fase naar
   * `'tracking'` mag zetten (`domain/game/writerClaim.ts`
   * `gameStartBlockReason()`). Los van `sync()`: die claimt alleen impliciet
   * tijdens een reeds lopende sync-cyclus (fase al `'tracking'`), dit is het
   * EXPLICIETE, blokkerende claimpad voor vóór de start.
   *
   * Retourneert altijd `'confirmed'` of `'blocked'` (nooit `'pending'`/
   * `'not-required'` — dat zijn UI-state, gezet door de aanroeper vóór/na
   * deze aanroep). Idempotent: een tweede aanroep terwijl dit apparaat al de
   * bevestigde writer is, levert opnieuw `'confirmed'` op zonder een nieuwe
   * serverwrite (geen onnodige revisie-increment bij bijv. een re-render/
   * remount van de pre-game-gate).
   */
  async ensureWriterClaim(
    game: ActiveGame,
    writer: GameCloudWriterContext,
  ): Promise<Extract<CloudClaimStatus, { kind: 'confirmed' | 'blocked' }>> {
    const ensure = await this.gateway.ensureGame(
      game.organizationId,
      game.teamId,
      game.id,
      projectGameSnapshot(game),
    );
    if (!ensure.ok) return { kind: 'blocked', code: 'offline' };

    const writerUid = ensure.writerUid ?? null;
    const deviceId = ensure.deviceId ?? null;

    if (writerUid === writer.authorUid && deviceId === writer.deviceId) {
      return {
        kind: 'confirmed',
        identity: { writerUid, deviceId, writerEpoch: ensure.writerEpoch ?? 0 },
      };
    }
    if (writerUid !== null || deviceId !== null) {
      return { kind: 'blocked', code: 'already-claimed' };
    }

    const claim = await this.gateway.claimWriter(
      game.organizationId,
      game.teamId,
      game.id,
      { authorUid: writer.authorUid, deviceId: writer.deviceId },
      ensure.revision ?? 0,
      this.now(),
    );
    if (!claim.ok) return { kind: 'blocked', code: claim.code };
    return { kind: 'confirmed', identity: claim.identity };
  }

  /**
   * PR 7.3a (docs/pr-7.3-plan.md §C 7.3a werk 2): neemt de writerclaim over
   * van een AL geclaimde `game` — dunne doorgeefluik naar
   * `gateway.takeoverWriter()`. Geen sterke-bevestigingsflow/UI hier (dat is
   * 7.3c-scope, docs/pr-7.3-plan.md §C 7.3c werk 1) — deze methode is de
   * geteste, aanroepbare bouwsteen die die flow straks gebruikt.
   */
  async takeoverWriter(
    game: ActiveGame,
    writer: GameCloudWriterContext,
    currentEpoch: number,
    currentRevision: number,
  ): Promise<Extract<CloudClaimStatus, { kind: 'confirmed' | 'blocked' }>> {
    const takeover = await this.gateway.takeoverWriter(
      game.organizationId,
      game.teamId,
      game.id,
      { authorUid: writer.authorUid, deviceId: writer.deviceId },
      currentEpoch,
      currentRevision,
      this.now(),
    );
    if (!takeover.ok) return { kind: 'blocked', code: takeover.code };
    return { kind: 'confirmed', identity: takeover.identity };
  }

  /**
   * PR 7.3b (docs/pr-7.3-plan.md §C 7.3b werk 2): dunne doorgeefluik naar
   * `gateway.subscribeToGame()` — de UI praat, net als bij elke andere
   * cloud-aanroep, nooit rechtstreeks met Firestore. Geen eigen state/
   * afleiding hier (die leeft in `GameCloudViewerState.ts`, puur en apart
   * testbaar) — deze coordinator blijft uitsluitend orkestratie.
   */
  subscribeGame(
    organizationId: string,
    teamId: string,
    gameId: string,
    callbacks: GameCloudSubscriptionCallbacks,
  ): GameCloudUnsubscribe {
    return this.gateway.subscribeToGame(organizationId, teamId, gameId, callbacks);
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
    // PR 7.3a: het ECHTE huidige epoch komt van de server (`ensure`/`claim`),
    // nooit de statische `writer.writerEpoch` uit `GameCloudWriterContext` —
    // die is alleen nog een fallback voor een kersvers, nog nooit geüpload
    // document (vóór de eerste `ensureGame()`-serverbevestiging hierboven).
    // Zonder dit zou een upload ná een overname altijd met een verouderd
    // epoch geprobeerd worden en permanent op de actions-createregel
    // (firestore.rules punt 11) stuklopen.
    let writerEpoch = ensure.writerEpoch ?? writer.writerEpoch;
    // P1-fix (externe review PR #66, backward-compat): het ECHTE huidige
    // `claimedAt`, altijd ongewijzigd teruggegeven aan `patchSnapshot()`
    // hieronder (zie `projectGameSnapshotPatch()`'s docstring). Een document
    // van vóór PR 7.3a mist deze sleutel server-side nog volledig — de
    // gateway/converter defaulten dat naar `null`, nooit `undefined`.
    let claimedAt = ensure.claimedAt ?? null;

    if (writerUid === null && deviceId === null) {
      const claim = await this.gateway.claimWriter(
        game.organizationId,
        game.teamId,
        game.id,
        { authorUid: writer.authorUid, deviceId: writer.deviceId },
        revision,
        this.now(),
      );
      if (!claim.ok) return this.fail(checkpoint, claim.error ?? claim.code);
      revision = claim.revision;
      writerUid = claim.identity.writerUid;
      deviceId = claim.identity.deviceId;
      writerEpoch = claim.identity.writerEpoch;
      claimedAt = claim.claimedAt;
    } else if (writerUid !== writer.authorUid || deviceId !== writer.deviceId) {
      // Al geclaimd door een andere schrijver (ander apparaat en/of andere
      // gebruiker) — een overname is een expliciete gebruikersactie
      // (`GameCloudGateway.takeoverWriter()`, PR 7.3a), nooit automatisch
      // vanuit een reguliere sync-cyclus. Hier alleen zichtbaar maken.
      return this.fail(
        checkpoint,
        `wedstrijd is al geclaimd door een andere schrijver (writerUid=${writerUid ?? 'null'})`,
      );
    }

    const allActions = projectGameActions(game, {
      authorUid: writerUid,
      deviceId,
      writerEpoch,
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
      projectGameSnapshotPatch(game, this.now(), claimedAt),
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
   *   4. `finalizeCompletedGame()` — P1-fix (externe review PR #61): schrijft
   *      de completed-snapshot ÉN patcht `completedGameId` op het
   *      parentdocument als ÉÉN atomische Firestore-`WriteBatch` (nooit twee
   *      losse writes — dat liet voorheen een dubbele-snapshot/orphan-gat
   *      open, zie `GameCloudGateway.finalizeCompletedGame()`'s docstring).
   *      `expectedRevision` komt vers uit stap 3's eigen resultaat, nooit een
   *      verouderde lokale waarde. Faalt de batch, dan is GEEN van beide
   *      writes doorgekomen — een latere `finalize()`-aanroep begint gewoon
   *      opnieuw bij stap 1/2.
   *
   * Hervatbaarheid over een paginareload heen (P1-fix, externe review PR
   * #61): `app/App.tsx` bewaart het `(ActiveGame, CompletedGame)`-paar dat
   * deze functie nodig heeft in een DUURZAME lokale outbox
   * (`PendingFinalizeRepository`, geschreven vóórdat het actieve-wedstrijdslot
   * naar een verse opzet wordt gereset) — niet alleen in een in-memory `Ref`.
   * Een crash tussen "lokaal archiveren" en een voltooide `finalize()`
   * verliest zo geen retrybron meer: bij de volgende app-load worden alle nog
   * openstaande outbox-items opnieuw aan `finalize()` aangeboden.
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

    const finalizeResult = await this.gateway.finalizeCompletedGame(
      game.organizationId,
      game.teamId,
      game.id,
      completed.id,
      projectCompletedGameSnapshot(completed),
      checkpoint.serverRevision,
    );
    if (!finalizeResult.ok) return this.fail(checkpoint, finalizeResult.error);

    const finalized: GameSyncCheckpoint = {
      ...checkpoint,
      completedGameId: completed.id,
      serverRevision: finalizeResult.revision ?? checkpoint.serverRevision + 1,
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

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
import type { ActiveGame } from '../../domain/game/types';
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
}

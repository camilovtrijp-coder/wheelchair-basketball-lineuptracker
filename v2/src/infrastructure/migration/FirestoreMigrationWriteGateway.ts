// Firestore-implementatie van MigrationWriteGateway (PR 7.4b,
// docs/pr-7.4-plan.md §C 7.4b werk 2/3). Componeert UITSLUITEND bestaande
// gateways/repositories — schrijft zelf NERGENS een rauwe setDoc()/
// updateDoc() op een nieuw pad:
// - settings/roster: `FirestoreSettingsRepository`/`FirestoreRosterRepository`
//   (5.3-contracten), wacht op hun `settled`-Promise voor een echte
//   serverbevestiging vóórdat de hash als bevestigd geldt (werk 2: "na elke
//   stap serverreadback").
// - completedGame: `GameCloudGateway.ensureGame()`/`claimWriter()`/
//   `finalizeCompletedGame()` (7.1/7.2/7.3-contracten) — zie
//   `MigrationWriteGateway.ts`'s docstring voor waarom een synthetische
//   parent nodig is.
// - compensatie: `GameCloudGateway.tombstoneCompletedGame()` (7.2c-precedent).
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { completedGameConverter } from 'firebase-base/documents';
import type {
  MigrationItemWriteResult,
  MigrationWriteGateway,
} from '../../application/migration/MigrationWriteGateway';
import type { GameCloudGateway } from '../../application/game/GameCloudGateway';
import type { Settings } from '../../domain/settings/types';
import type { Roster } from '../../domain/roster/types';
import type { CompletedGame } from '../../domain/game/types';
import {
  completedGamePayloadHash,
  rosterPayloadHash,
  settingsPayloadHash,
} from '../../domain/migration/payload';
import { projectCompletedGameSnapshot } from '../../application/game/projectCompletedGameForCloud';
import { projectMigratedGameParentSnapshot } from '../../application/migration/projectMigratedGameForCloud';
import { FirestoreSettingsRepository } from '../settings/FirestoreSettingsRepository';
import { FirestoreRosterRepository } from '../roster/FirestoreRosterRepository';

export class FirestoreMigrationWriteGateway implements MigrationWriteGateway {
  constructor(
    private readonly db: Firestore,
    private readonly gameGateway: GameCloudGateway,
  ) {}

  async writeSettings(
    organizationId: string,
    teamId: string,
    settings: Settings & Record<string, unknown>,
  ): Promise<MigrationItemWriteResult> {
    const repo = new FirestoreSettingsRepository(this.db, organizationId, teamId);
    const result = await repo.write(settings);
    const settled = await result.settled;
    if (!settled.ok) return { ok: false, error: settled.error };
    return { ok: true, confirmedHash: settingsPayloadHash(settings) };
  }

  async writeRoster(
    organizationId: string,
    teamId: string,
    roster: Roster,
  ): Promise<MigrationItemWriteResult> {
    const repo = new FirestoreRosterRepository(this.db, organizationId, teamId);
    const result = await repo.write(roster);
    const settled = await result.settled;
    if (!settled.ok) return { ok: false, error: settled.error };
    return { ok: true, confirmedHash: rosterPayloadHash(roster) };
  }

  async writeCompletedGame(
    organizationId: string,
    teamId: string,
    game: CompletedGame,
    writer: { authorUid: string; deviceId: string },
    now: string,
  ): Promise<MigrationItemWriteResult> {
    const ensure = await this.gameGateway.ensureGame(
      organizationId,
      teamId,
      game.sourceGameId,
      projectMigratedGameParentSnapshot(game),
    );
    if (!ensure.ok) return { ok: false, error: ensure.error };

    if (ensure.completedGameId != null) {
      if (ensure.completedGameId === game.id) {
        // Al server-bevestigd afgerond naar EXACT deze snapshot — idempotente
        // kortsluiting, spiegelt `GameSyncCoordinator.finalize()`'s eigen
        // server-kortsluitingscheck.
        return { ok: true, confirmedHash: completedGamePayloadHash(game) };
      }
      return {
        ok: false,
        error: `sourceGameId ${game.sourceGameId} is server-side al afgerond naar een andere snapshot (completedGameId=${ensure.completedGameId})`,
      };
    }

    let revision = ensure.revision ?? 0;
    const writerUid = ensure.writerUid ?? null;
    const deviceId = ensure.deviceId ?? null;
    if (writerUid === null && deviceId === null) {
      const claim = await this.gameGateway.claimWriter(
        organizationId,
        teamId,
        game.sourceGameId,
        writer,
        revision,
        now,
      );
      if (!claim.ok) return { ok: false, error: claim.error ?? claim.code };
      revision = claim.revision;
    } else if (writerUid !== writer.authorUid || deviceId !== writer.deviceId) {
      return {
        ok: false,
        error: `games/${game.sourceGameId} is al geclaimd door een andere schrijver (writerUid=${writerUid ?? 'null'})`,
      };
    }

    const finalizeResult = await this.gameGateway.finalizeCompletedGame(
      organizationId,
      teamId,
      game.sourceGameId,
      game.id,
      projectCompletedGameSnapshot(game),
      revision,
    );
    if (!finalizeResult.ok) return { ok: false, error: finalizeResult.error };
    return { ok: true, confirmedHash: completedGamePayloadHash(game) };
  }

  async compensateCompletedGame(
    organizationId: string,
    teamId: string,
    completedGameId: string,
    deletedBy: string,
  ): Promise<MigrationItemWriteResult> {
    const ref = doc(
      this.db,
      'organizations',
      organizationId,
      'teams',
      teamId,
      'completedGames',
      completedGameId,
    ).withConverter(completedGameConverter);
    let expectedRevision: number;
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        // Nooit zichtbaar geworden op de server (bijv. de write faalde al
        // vóór readback) — niets te compenseren, dit telt als een geslaagde,
        // no-op compensatie (§B: "nog niet zichtbare clouditems stoppen").
        return { ok: true };
      }
      expectedRevision = snap.data().revision;
    } catch (error) {
      return { ok: false, error };
    }
    const result = await this.gameGateway.tombstoneCompletedGame(
      organizationId,
      teamId,
      completedGameId,
      deletedBy,
      expectedRevision,
    );
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true };
  }
}

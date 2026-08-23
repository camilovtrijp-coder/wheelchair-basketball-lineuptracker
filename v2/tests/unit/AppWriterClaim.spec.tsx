// @vitest-environment jsdom
//
// PR 7.3a (docs/pr-7.3-plan.md §C 7.3a werk 3/4): bewijst de pre-game-gate
// end-to-end door `App` heen — in cloud-modus roept `App` `GameSyncCoordinator.
// ensureWriterClaim()` aan zodra een startbare 'setup'-wedstrijd bestaat, en
// meldt `onGameLockChange(true)` zodra de claim bevestigd is (al vóór "Start
// wedstrijd" geklikt is — een bevestigde claim IS al genoeg reden om de
// organisatie/teamcontext te vergrendelen, zie docs/pr-7.3-plan.md §C 7.3a
// werk 4). Alleen-lokale modus (`gameSync: null`) blijft zonder enige
// claimaanroep werken en vergrendelt pas bij `phase === 'tracking'`.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/preact';
import { App } from '../../src/app/App';
import type { AsyncSettingsRepository } from '../../src/application/settings/AsyncSettingsRepository';
import type { AsyncRosterRepository } from '../../src/application/roster/AsyncRosterRepository';
import type { GameCloudWriterContext } from '../../src/application/game/projectGameForCloud';
import type { GameSyncCoordinator } from '../../src/application/game/GameSyncCoordinator';
import type { SyncStatusApi } from '../../src/application/sync/useSyncStatus';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings/types';
import type { Roster } from '../../src/domain/roster/types';
import type { SyncState } from '../../src/domain/syncState';
import type { CloudClaimStatus } from '../../src/domain/game/writerClaim';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const SYNCED: SyncState = { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false };
const ORG_ID = 'org-claim-test';
const TEAM_ID = 'team-claim-test';

const FIVE_PLAYER_ROSTER: Roster = [1, 2, 3, 4, 5].map((n) => ({
  id: n,
  nr: String(n),
  naam: `Speler ${n}`,
  kl: '3.0',
  vrouw: false,
  jeugd: false,
}));

class ImmediateSettingsRepository implements AsyncSettingsRepository {
  async read(): Promise<Settings & Record<string, unknown>> {
    return { ...DEFAULT_SETTINGS, teamName: 'Team Claim' };
  }
  async write(): Promise<never> {
    throw new Error('niet gebruikt in deze test');
  }
  async reset(): Promise<never> {
    throw new Error('niet gebruikt in deze test');
  }
  subscribe(
    onNext: (settings: Settings & Record<string, unknown>, sync: SyncState) => void,
  ): () => void {
    onNext({ ...DEFAULT_SETTINGS, teamName: 'Team Claim' }, SYNCED);
    return () => undefined;
  }
}

class ImmediateRosterRepository implements AsyncRosterRepository {
  async read(): Promise<Roster> {
    return FIVE_PLAYER_ROSTER;
  }
  async write(): Promise<never> {
    throw new Error('niet gebruikt in deze test');
  }
  subscribe(onNext: (roster: Roster, sync: SyncState) => void): () => void {
    onNext(FIVE_PLAYER_ROSTER, SYNCED);
    return () => undefined;
  }
}

/** Regressiefixture (externe review op PR #66): een leeg roster levert een
 * nog-niet-startbare 'setup'-opzet op — die mag GEEN claimpoging triggeren. */
class EmptyRosterRepository implements AsyncRosterRepository {
  async read(): Promise<Roster> {
    return [];
  }
  async write(): Promise<never> {
    throw new Error('niet gebruikt in deze test');
  }
  subscribe(onNext: (roster: Roster, sync: SyncState) => void): () => void {
    onNext([], SYNCED);
    return () => undefined;
  }
}

function fakeSyncStatusApi(): SyncStatusApi {
  return {
    status: 'gesynchroniseerd',
    fromCache: false,
    pending: [],
    onSettingsSync: vi.fn(),
    onRosterSync: vi.fn(),
    saveSettings: vi.fn(async () => true),
    saveRoster: vi.fn(async () => true),
    resetSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
    retry: vi.fn(async () => undefined),
    dismiss: vi.fn(),
  };
}

const writer: GameCloudWriterContext = {
  authorUid: 'uid-alice',
  deviceId: 'device-alice',
  writerEpoch: 0,
};

describe('app/App: pre-game-gate roept ensureWriterClaim() aan en meldt de contextlock (PR 7.3a)', () => {
  it('cloud-modus: claimt automatisch zodra de wedstrijd startbaar is, en vergrendelt de context zodra bevestigd', async () => {
    let resolveClaim: ((status: CloudClaimStatus) => void) | null = null;
    const claimCalls: unknown[] = [];
    const gameSync = {
      async ensureWriterClaim(game: unknown, w: unknown) {
        claimCalls.push([game, w]);
        return new Promise<CloudClaimStatus>((resolve) => {
          resolveClaim = resolve;
        });
      },
    } as unknown as GameSyncCoordinator;

    const onGameLockChange = vi.fn();
    const repositories = {
      mode: 'cloud' as const,
      settings: new ImmediateSettingsRepository(),
      roster: new ImmediateRosterRepository(),
      gameSync,
      gameWriterContext: writer,
      completedGames: null,
      migrationInventoryGateway: null,
      migrationCoordinator: null,
    };

    const { getByTestId } = render(
      <App
        repositories={repositories}
        syncStatus={fakeSyncStatusApi()}
        canWrite={true}
        canWriteGame={true}
        organizationId={ORG_ID}
        teamId={TEAM_ID}
        organizationName="Org Claim Test"
        onGameLockChange={onGameLockChange}
      />,
    );

    getByTestId('nav-game').click();
    await waitFor(() => expect(claimCalls.length).toBe(1));

    // Nog geen bevestiging: startknop blijft geblokkeerd, context nog niet vergrendeld.
    await waitFor(() =>
      expect((getByTestId('game-start-btn') as HTMLButtonElement).disabled).toBe(true),
    );
    expect(onGameLockChange).not.toHaveBeenCalledWith(true);

    // Server bevestigt de claim.
    await act(async () => {
      resolveClaim!({
        kind: 'confirmed',
        identity: { writerUid: writer.authorUid, deviceId: writer.deviceId, writerEpoch: 0 },
      });
    });

    await waitFor(() =>
      expect((getByTestId('game-start-btn') as HTMLButtonElement).disabled).toBe(false),
    );
    // De context is NU vergrendeld — al vóórdat op "Start wedstrijd" geklikt is.
    // (`onGameLockChange` wordt vanuit een useEffect aangeroepen, dat kan een
    // paint-tick later vuren dan de render zelf — vandaar via waitFor.)
    await waitFor(() => expect(onGameLockChange).toHaveBeenCalledWith(true));
    expect(claimCalls.length).toBe(1); // geen dubbele claimpoging voor dezelfde wedstrijd
  });

  it('cloud-modus: blocked (already-claimed) laat de startknop geblokkeerd en de context ONvergrendeld', async () => {
    const gameSync = {
      async ensureWriterClaim(): Promise<CloudClaimStatus> {
        return { kind: 'blocked', code: 'already-claimed' };
      },
    } as unknown as GameSyncCoordinator;
    const onGameLockChange = vi.fn();
    const repositories = {
      mode: 'cloud' as const,
      settings: new ImmediateSettingsRepository(),
      roster: new ImmediateRosterRepository(),
      gameSync,
      gameWriterContext: writer,
      completedGames: null,
      migrationInventoryGateway: null,
      migrationCoordinator: null,
    };

    const { getByTestId } = render(
      <App
        repositories={repositories}
        syncStatus={fakeSyncStatusApi()}
        canWrite={true}
        canWriteGame={true}
        organizationId={ORG_ID}
        teamId={TEAM_ID}
        organizationName="Org Claim Test"
        onGameLockChange={onGameLockChange}
      />,
    );
    getByTestId('nav-game').click();

    await waitFor(() =>
      expect(getByTestId('game-start-btn').textContent).toBe(
        'This match is already being scored on another device.',
      ),
    );
    expect((getByTestId('game-start-btn') as HTMLButtonElement).disabled).toBe(true);
    expect(onGameLockChange).not.toHaveBeenCalledWith(true);
  });

  it('alleen-lokale modus: geen enkele claimaanroep, startknop meteen bruikbaar', async () => {
    const repositories = {
      mode: 'local' as const,
      settings: new ImmediateSettingsRepository(),
      roster: new ImmediateRosterRepository(),
      gameSync: null,
      gameWriterContext: null,
      completedGames: null,
      migrationInventoryGateway: null,
      migrationCoordinator: null,
    };
    const onGameLockChange = vi.fn();

    const { getByTestId } = render(
      <App
        repositories={repositories}
        syncStatus={fakeSyncStatusApi()}
        canWrite={true}
        canWriteGame={true}
        organizationId={ORG_ID}
        teamId={TEAM_ID}
        organizationName="Org Local Test"
        onGameLockChange={onGameLockChange}
      />,
    );
    getByTestId('nav-game').click();

    await waitFor(() =>
      expect((getByTestId('game-start-btn') as HTMLButtonElement).disabled).toBe(false),
    );
    expect(getByTestId('game-start-btn').textContent).toBe('Start match');
    expect(onGameLockChange).not.toHaveBeenCalledWith(true);

    // Start de wedstrijd lokaal: dat vergrendelt de context wél (fase 'tracking'),
    // ongeacht cloud-modus.
    await act(async () => {
      getByTestId('game-start-btn').click();
    });
    await waitFor(() => expect(onGameLockChange).toHaveBeenCalledWith(true));
  });

  it('REGRESSIE (externe review PR #66): een nog-niet-startbare wedstrijd (leeg roster) claimt NOOIT automatisch en vergrendelt de context NIET', async () => {
    const claimCalls: unknown[] = [];
    const gameSync = {
      async ensureWriterClaim(game: unknown, w: unknown) {
        claimCalls.push([game, w]);
        return {
          kind: 'confirmed' as const,
          identity: { writerUid: writer.authorUid, deviceId: writer.deviceId, writerEpoch: 0 },
        };
      },
    } as unknown as GameSyncCoordinator;
    const onGameLockChange = vi.fn();
    const repositories = {
      mode: 'cloud' as const,
      settings: new ImmediateSettingsRepository(),
      roster: new EmptyRosterRepository(),
      gameSync,
      gameWriterContext: writer,
      completedGames: null,
      migrationInventoryGateway: null,
      migrationCoordinator: null,
    };

    const { getByTestId } = render(
      <App
        repositories={repositories}
        syncStatus={fakeSyncStatusApi()}
        canWrite={true}
        canWriteGame={true}
        organizationId={ORG_ID}
        teamId={TEAM_ID}
        organizationName="Org Claim Test"
        onGameLockChange={onGameLockChange}
      />,
    );

    await act(async () => {
      getByTestId('nav-game').click();
    });
    await waitFor(() => expect(getByTestId('game-no-players')).toBeTruthy());

    // Geef eventuele (foutieve) effect-cycli de kans om te vuren.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(claimCalls.length).toBe(0);
    expect(onGameLockChange).not.toHaveBeenCalledWith(true);
  });

  it('REGRESSIE (externe review PR #66): een startbare wedstrijd claimt NOOIT automatisch zolang de gebruiker niet op het Wedstrijd-tabblad staat', async () => {
    const claimCalls: unknown[] = [];
    const gameSync = {
      async ensureWriterClaim(game: unknown, w: unknown) {
        claimCalls.push([game, w]);
        return {
          kind: 'confirmed' as const,
          identity: { writerUid: writer.authorUid, deviceId: writer.deviceId, writerEpoch: 0 },
        };
      },
    } as unknown as GameSyncCoordinator;
    const onGameLockChange = vi.fn();
    const repositories = {
      mode: 'cloud' as const,
      settings: new ImmediateSettingsRepository(),
      roster: new ImmediateRosterRepository(), // vijf spelers: meteen startbaar
      gameSync,
      gameWriterContext: writer,
      completedGames: null,
      migrationInventoryGateway: null,
      migrationCoordinator: null,
    };

    const { getByTestId } = render(
      <App
        repositories={repositories}
        syncStatus={fakeSyncStatusApi()}
        canWrite={true}
        canWriteGame={true}
        organizationId={ORG_ID}
        teamId={TEAM_ID}
        organizationName="Org Claim Test"
        onGameLockChange={onGameLockChange}
      />,
    );

    // Blijft op het standaard 'settings'-tabblad — nooit naar Wedstrijd genavigeerd.
    await waitFor(() => expect(getByTestId('settings-teamName')).toBeTruthy());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(claimCalls.length).toBe(0);
    expect(onGameLockChange).not.toHaveBeenCalledWith(true);

    // Navigeert nu WEL naar Wedstrijd — pas dan mag de claim starten.
    await act(async () => {
      getByTestId('nav-game').click();
    });
    await waitFor(() => expect(claimCalls.length).toBe(1));
    await waitFor(() => expect(onGameLockChange).toHaveBeenCalledWith(true));
  });
});

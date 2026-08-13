// @vitest-environment jsdom
//
// Externe PR-6.5-review (aug. 2026): `statsGameIds` (het gedeelde
// wedstrijdfilter tussen Stats en Trends, zie `app/App.tsx`) leefde boven
// de per-team `completedGameRepo` maar werd niet gereset bij een
// organisatie/teamwissel. `AuthGate` geeft dezelfde `App`-instance nieuwe
// `organizationId`/`teamId`-props zonder remount, dus een selectie met
// `AnalysisGame.id`'s uit team A bleef actief na het wisselen naar team B —
// omdat team B's wedstrijd-ID's daar niet in voorkomen, toonden Stats/Trends
// dan ten onrechte "0 wedstrijden" i.p.v. v1's standaardgedrag (`null` =
// alles geselecteerd). Dit bestand bewijst dat de reset werkt.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/preact';
import { App } from '../../src/app/App';
import type { AsyncSettingsRepository } from '../../src/application/settings/AsyncSettingsRepository';
import type { AsyncRosterRepository } from '../../src/application/roster/AsyncRosterRepository';
import type { SyncStatusApi } from '../../src/application/sync/useSyncStatus';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings/types';
import type { Roster } from '../../src/domain/roster/types';
import type { CompletedGame } from '../../src/domain/game/types';
import type { SyncState } from '../../src/domain/syncState';
import { completedGamesStorageKey } from '../../src/infrastructure/game/LocalStorageCompletedGameRepository';

afterEach(() => cleanup());

const SYNCED: SyncState = { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false };

class StaticSettingsRepository implements AsyncSettingsRepository {
  async read(): Promise<Settings & Record<string, unknown>> {
    return { ...DEFAULT_SETTINGS, teamName: 'Team' };
  }
  async write(): Promise<never> {
    throw new Error('niet gebruikt');
  }
  async reset(): Promise<never> {
    throw new Error('niet gebruikt');
  }
  subscribe(onNext: (s: Settings & Record<string, unknown>, sync: SyncState) => void): () => void {
    onNext({ ...DEFAULT_SETTINGS, teamName: 'Team' }, SYNCED);
    return () => undefined;
  }
}

const ROSTER: Roster = [{ id: 1, nr: '1', naam: 'Anna', kl: '3.0', vrouw: false, jeugd: false }];

class StaticRosterRepository implements AsyncRosterRepository {
  async read(): Promise<Roster> {
    return ROSTER;
  }
  async write(): Promise<never> {
    throw new Error('niet gebruikt');
  }
  subscribe(onNext: (r: Roster, sync: SyncState) => void): () => void {
    onNext(ROSTER, SYNCED);
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

function completedGame(id: string, organizationId: string, teamId: string): CompletedGame {
  return {
    id,
    organizationId,
    teamId,
    sourceGameId: `src-${id}`,
    opponent: 'Tegenstander',
    competition: '',
    date: '2026-01-01T10:00:00.000Z',
    players: [],
    segments: [],
    scoreFor: 0,
    scoreAgainst: 0,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
  };
}

const repositories = {
  mode: 'cloud' as const,
  settings: new StaticSettingsRepository(),
  roster: new StaticRosterRepository(),
};

describe('app/App — statsGameIds reset bij organisatie/teamwissel (externe PR-6.5-review)', () => {
  it('materialiseert een selectie in team A, en toont in team B weer "alles" i.p.v. een lege selectie', async () => {
    window.localStorage.setItem(
      completedGamesStorageKey('org-A', 'team-A'),
      JSON.stringify([
        completedGame('gA-1', 'org-A', 'team-A'),
        completedGame('gA-2', 'org-A', 'team-A'),
      ]),
    );
    window.localStorage.setItem(
      completedGamesStorageKey('org-B', 'team-B'),
      JSON.stringify([completedGame('gB-1', 'org-B', 'team-B')]),
    );

    const syncStatus = fakeSyncStatusApi();
    const { getByTestId, rerender } = render(
      <App
        repositories={repositories}
        syncStatus={syncStatus}
        canWrite={true}
        canWriteGame={true}
        organizationId="org-A"
        teamId="team-A"
        organizationName="Org A"
      />,
    );

    await waitFor(() => expect(getByTestId('nav-stats')).toBeTruthy());
    getByTestId('nav-stats').click();

    // Standaard: gameIds === null → toont het totale aantal (2).
    await waitFor(() => expect(getByTestId('stats-games-btn').textContent).toContain('(2)'));

    // Materialiseer een selectie: deselecteer gA-1, zodat gameIds een echte
    // Set wordt met alleen gA-2 erin.
    getByTestId('stats-games-btn').click();
    await waitFor(() => expect(getByTestId('stats-games-modal')).toBeTruthy());
    getByTestId('stats-game-check-gA-1').click();
    getByTestId('stats-games-modal-done').click();
    await waitFor(() => expect(getByTestId('stats-games-btn').textContent).toContain('(1)'));

    // Wissel context naar team B (dezelfde App-instance, nieuwe props —
    // precies wat AuthGate bij een contextwissel doet).
    rerender(
      <App
        repositories={repositories}
        syncStatus={syncStatus}
        canWrite={true}
        canWriteGame={true}
        organizationId="org-B"
        teamId="team-B"
        organizationName="Org B"
      />,
    );

    // Zonder de reset zou de stale Set (met alleen gA-2, dat niet in team B
    // voorkomt) hier "(0)" tonen. Met de fix toont team B weer "alles": (1).
    await waitFor(() => expect(getByTestId('stats-games-btn').textContent).toContain('(1)'));
    expect(getByTestId('stats-games-btn').textContent).not.toContain('(0)');
  });
});

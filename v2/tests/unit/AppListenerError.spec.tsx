// @vitest-environment jsdom
//
// PR 5.4a: bewijst de listener-fout-detectie in App. Een onSnapshot-listener die
// NA de initiële load faalt (settings of roster niet meer null) moet de
// niet-blokkerende "listener-error-indicator" tonen, en weer verdwijnen bij
// de volgende succesvolle listener-emit. Bewust als unit/integratietest met
// mock-repositories in plaats van een e2e tegen de Firestore-emulator — het
// forceren van een `onError` na de eerste emit is tegen de emulator moeilijk
// betrouwbaar te reproduseren, terwijl de state-machine hier zuiver te testen is.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/preact';
import { App } from '../../src/app/App';
import type { AsyncSettingsRepository } from '../../src/application/settings/AsyncSettingsRepository';
import type { AsyncRosterRepository } from '../../src/application/roster/AsyncRosterRepository';
import type { SyncStatusApi } from '../../src/application/sync/useSyncStatus';
import { DEFAULT_SETTINGS, type Settings } from '../../src/domain/settings/types';
import type { Roster } from '../../src/domain/roster/types';
import type { SyncState } from '../../src/domain/syncState';

// Zonder expliciete cleanup blijft de DOM van een eerdere test in dit bestand
// staan (zie ActionNeededPanel/CloudImportBanner/SyncStatusIndicator-specs
// voor hetzelfde patroon) — cruciaal hier omdat beide tests dezelfde
// data-testid (`listener-error-indicator`) gebruiken.
afterEach(() => cleanup());

const SYNCED: SyncState = { status: 'gesynchroniseerd', fromCache: false, hasPendingWrites: false };

/**
 * ControlledAsyncSettingsRepository: laat de test zelf bepalen wanneer de
 * subscribe()-listener een `onNext` of `onError` krijgt, zodat het scenario
 * "eerste emit OK, daarna fout, daarna hervat" exact reproduceerbaar is.
 */
class ControlledAsyncSettingsRepository implements AsyncSettingsRepository {
  private nextHandler: ((s: Settings & Record<string, unknown>, sync: SyncState) => void) | null =
    null;
  private errorHandler: ((e: unknown) => void) | null = null;

  async read(): Promise<Settings & Record<string, unknown>> {
    return { ...DEFAULT_SETTINGS, teamName: 'Team-Init' };
  }

  async write(): Promise<never> {
    throw new Error('niet gebruikt in deze test');
  }

  async reset(): Promise<never> {
    throw new Error('niet gebruikt in deze test');
  }

  subscribe(
    onNext: (settings: Settings & Record<string, unknown>, sync: SyncState) => void,
    onError?: (e: unknown) => void,
  ): () => void {
    this.nextHandler = onNext;
    this.errorHandler = onError ?? null;
    // Directe eerste emit, zoals een echte listener doet bij metadata-only
    // changes of bij v1→cloud-import: de UI heeft dan meteen data.
    onNext({ ...DEFAULT_SETTINGS, teamName: 'Team-Init' }, SYNCED);
    return () => {
      this.nextHandler = null;
      this.errorHandler = null;
    };
  }

  emitNext(settings: Settings & Record<string, unknown>, sync: SyncState = SYNCED): void {
    this.nextHandler?.(settings, sync);
  }

  emitError(error: unknown = new Error('listener failed')): void {
    this.errorHandler?.(error);
  }
}

class ControlledAsyncRosterRepository implements AsyncRosterRepository {
  async read(): Promise<Roster> {
    return [];
  }
  async write(): Promise<never> {
    throw new Error('niet gebruikt in deze test');
  }
  subscribe(): () => void {
    // Directe eerste emit met lege roster; App gebruikt dit nooit voor deze test.
    return () => undefined;
  }
}

/**
 * Voor het pre-load-scenario: `read()` resolvet nooit en `subscribe()` emit
 * NIETS automatisch (in tegenstelling tot ControlledAsyncSettingsRepository,
 * die bewust altijd meteen een onNext geeft). Zo kan de test een `onError`
 * afvuren terwijl `settingsLoadedRef.current` in App nog `false` is — het
 * scenario dat de "gewone" mock niet kan simuleren, omdat die de eerste emit
 * al synchroon in `subscribe()` doet, vóórdat de test iets kan aanroepen.
 */
class NeverLoadingSettingsRepository implements AsyncSettingsRepository {
  private errorHandler: ((e: unknown) => void) | null = null;

  read(): Promise<Settings & Record<string, unknown>> {
    return new Promise(() => {
      // Blijft voor altijd pending: er is voor dit scenario nooit een
      // geslaagde load geweest.
    });
  }

  async write(): Promise<never> {
    throw new Error('niet gebruikt in deze test');
  }

  async reset(): Promise<never> {
    throw new Error('niet gebruikt in deze test');
  }

  subscribe(
    _onNext: (settings: Settings & Record<string, unknown>, sync: SyncState) => void,
    onError?: (e: unknown) => void,
  ): () => void {
    this.errorHandler = onError ?? null;
    return () => {
      this.errorHandler = null;
    };
  }

  emitError(error: unknown = new Error('listener failed vóór eerste load')): void {
    this.errorHandler?.(error);
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

const repositories = {
  mode: 'cloud' as const,
  settings: new ControlledAsyncSettingsRepository(),
  roster: new ControlledAsyncRosterRepository(),
};

describe('app/App — listener-fout-detectie na initiële load (PR 5.4a)', () => {
  it('toont de indicator zodra een listener faalt ná de eerste load, en ruimt hem bij de volgende succesvolle emit', async () => {
    const syncStatus = fakeSyncStatusApi();
    const { queryByTestId } = render(
      <App
        repositories={repositories}
        syncStatus={syncStatus}
        canWrite={true}
        organizationId="org-test"
        teamId="team-test"
      />,
    );

    // Initiële load: data op scherm, geen indicator.
    await waitFor(() => expect(queryByTestId('nav-settings')).toBeTruthy());
    expect(queryByTestId('listener-error-indicator')).toBeNull();

    // Listener faalt ná de load: indicator verschijnt.
    act(() => {
      repositories.settings.emitError(new Error('cloud-verbinding weg'));
    });
    expect(queryByTestId('listener-error-indicator')).toBeTruthy();
    expect(queryByTestId('listener-error-indicator')?.textContent).toMatch(/cloud/i);

    // Listener hervat: indicator verdwijnt.
    act(() => {
      repositories.settings.emitNext({ ...DEFAULT_SETTINGS, teamName: 'Team-Hersteld' });
    });
    expect(queryByTestId('listener-error-indicator')).toBeNull();
  });

  it('toont de OfflineUncachedScreen (niet de indicator) wanneer een listener faalt vóór de eerste load (criterium 4 van #27)', async () => {
    const syncStatus = fakeSyncStatusApi();
    const settingsRepo = new NeverLoadingSettingsRepository();
    const localRepositories = {
      mode: 'cloud' as const,
      settings: settingsRepo,
      roster: new ControlledAsyncRosterRepository(),
    };
    const { queryByTestId } = render(
      <App
        repositories={localRepositories}
        syncStatus={syncStatus}
        canWrite={true}
        organizationId="org-test"
        teamId="team-test"
      />,
    );

    // Nog niets geladen: geen indicator (App toont nog niet eens de hoofd-UI).
    expect(queryByTestId('listener-error-indicator')).toBeNull();
    expect(queryByTestId('nav-settings')).toBeNull();

    // Listener faalt vóórdat er ooit een succesvolle load is geweest
    // (settingsLoadedRef.current === false in App).
    act(() => {
      settingsRepo.emitError(new Error('cloud-verbinding weg vóór load'));
    });

    // De pre-load fout wordt afgehandeld via uncachedOffline (OfflineUncachedScreen),
    // niet via de niet-blokkerende indicator. Als de niet-blokkerende indicator hier
    // wél verschijnt (of de OfflineUncachedScreen wegblijft), is de
    // pre-load/post-load-onderscheid in App kapot gegaan.
    await waitFor(() => expect(queryByTestId('uncached-offline-body')).toBeTruthy());
    expect(queryByTestId('listener-error-indicator')).toBeNull();
    expect(queryByTestId('nav-settings')).toBeNull();
  });
});

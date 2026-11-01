// @vitest-environment jsdom
// Schakelaar Klassiek/Compact (bouwplan besluit 7): foutbestendige apparaatvoorkeur
// onder een eigen key, bediening in het apparaatmenu en de schermwisselguard.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/preact';
import { SessionBar } from '../../src/ui/context/SessionBar';
import { CompactLivePanel } from '../../src/ui/game/CompactLivePanel';
import { LiveTrackingPanel } from '../../src/ui/game/LiveTrackingPanel';
import {
  GAME_SCREEN_STORAGE_KEY,
  getGameScreenLocks,
  parseGameScreen,
  readGameScreen,
  storeGameScreen,
  subscribeGameScreen,
} from '../../src/infrastructure/game/gameScreenPreference';
import { useGameScreenPreference } from '../../src/application/game/useGameScreen';
import type { ActiveGame, GamePlayer } from '../../src/domain/game/types';
import type { Lang } from '../../src/i18n/strings';

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function player(nr: number, naam: string, start: boolean): GamePlayer {
  return {
    id: `gp-${nr}`,
    rosterId: nr,
    nr: String(nr),
    naam,
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start,
  };
}

function game(overrides: Partial<ActiveGame> = {}): ActiveGame {
  return {
    id: 'game-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players: [
      player(4, 'Alex', true),
      player(7, 'Sam', true),
      player(9, 'Robin', true),
      player(11, 'Kim', true),
      player(13, 'Dani', true),
      player(12, 'Noa', false),
    ],
    opponent: 'Tegen',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: ['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13'],
    curQuarter: 1,
    beginSec: 600,
    endSec: 600,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const CLASSIFICATION = {
  useClassLimit: false,
  classBaseLimit: 14.5,
  maxBonus: 2.5,
  bonusTag1Only: 1.5,
  bonusTag2Only: 1,
  bonusBoth: 2,
};

function Panels({
  g,
  compact,
  canWrite = true,
  lang = 'nl',
}: {
  g: ActiveGame;
  compact: boolean;
  canWrite?: boolean;
  lang?: Lang;
}) {
  const Panel = compact ? CompactLivePanel : LiveTrackingPanel;
  return (
    <Panel
      lang={lang}
      game={g}
      quarterCount={4}
      periodLabel="Kwart"
      classification={CLASSIFICATION}
      teamName="Eigen"
      tag1Label=""
      tag2Label=""
      onGameChange={() => {}}
      onFinishGame={() => {}}
      canWrite={canWrite}
      saveError={false}
    />
  );
}

function Bar({ lang = 'nl' as Lang }) {
  return (
    <SessionBar
      lang={lang}
      onSignOut={() => {}}
      onSwitchContext={() => {}}
      email="coach@voorbeeld.test"
      trustedDevice={false}
      onChangeTrustedDevice={() => {}}
    />
  );
}

function openMenu() {
  fireEvent.click(screen.getByTestId('account-menu-trigger'));
}

describe('voorkeur Klassiek/Compact', () => {
  it('ontbrekend of ongeldig geeft Klassiek', () => {
    expect(readGameScreen()).toBe('classic');
    expect(parseGameScreen(undefined)).toBe('classic');
    expect(parseGameScreen('iets-anders')).toBe('classic');
    window.localStorage.setItem(GAME_SCREEN_STORAGE_KEY, '{kapot');
    expect(readGameScreen()).toBe('classic');
  });

  it('kapotte storage geeft Klassiek en laat bewaren niet crashen', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage kapot');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage kapot');
    });
    expect(readGameScreen()).toBe('classic');
    const seen: string[] = [];
    const off = subscribeGameScreen((s) => seen.push(s));
    expect(() => storeGameScreen('compact')).not.toThrow();
    off();
    expect(seen).toEqual(['compact']);
  });

  it('bewaren en herstellen onder een eigen key, zonder andere keys te raken', () => {
    window.localStorage.setItem('lineup-tracker-v2-theme', 'light');
    storeGameScreen('compact');
    expect(window.localStorage.getItem(GAME_SCREEN_STORAGE_KEY)).toBe('compact');
    expect(GAME_SCREEN_STORAGE_KEY).toBe('lineup-tracker-v2-game-screen');
    expect(readGameScreen()).toBe('compact');
    expect(window.localStorage.getItem('lineup-tracker-v2-theme')).toBe('light');
    storeGameScreen('classic');
    expect(readGameScreen()).toBe('classic');
  });

  it('de hook volgt wijzigingen', () => {
    function Probe() {
      return <span data-testid="probe">{useGameScreenPreference()}</span>;
    }
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('classic');
    storeGameScreen('compact');
    return Promise.resolve().then(() => {
      expect(screen.getByTestId('probe').textContent).toBe('compact');
    });
  });
});

describe('schakelaar in het apparaatmenu', () => {
  it('toont NL- en EN-labels en staat standaard op Klassiek', () => {
    render(<Bar />);
    openMenu();
    expect(screen.getByTestId('game-screen-setting').textContent).toContain('Wedstrijdscherm');
    expect((screen.getByTestId('game-screen-classic') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('game-screen-compact') as HTMLInputElement).checked).toBe(false);
    cleanup();
    render(<Bar lang="en" />);
    openMenu();
    expect(screen.getByTestId('game-screen-setting').textContent).toContain('Game screen');
    expect(screen.getByTestId('game-screen-compact').parentElement?.textContent).toContain(
      'Compact',
    );
    expect(screen.getByTestId('game-screen-classic').parentElement?.textContent).toContain(
      'Classic',
    );
  });

  it('kiezen bewaart de voorkeur', () => {
    render(<Bar />);
    openMenu();
    fireEvent.click(screen.getByTestId('game-screen-compact'));
    expect(readGameScreen()).toBe('compact');
    expect((screen.getByTestId('game-screen-compact') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId('game-screen-classic'));
    expect(readGameScreen()).toBe('classic');
  });
});

describe('schermwisselguard', () => {
  it('opgeslagen pendingSwapLineup (uit Klassiek) blokkeert de schakelaar en wijzigt niets', () => {
    const g = game({
      onCourt: ['gp-4', 'gp-12', 'gp-9', 'gp-11', 'gp-13'],
      pendingSwapLineup: ['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13'],
    });
    render(
      <div>
        <Bar />
        <Panels g={g} compact={false} />
      </div>,
    );
    expect(getGameScreenLocks()).toEqual({ swap: true, dialog: false });
    openMenu();
    expect((screen.getByTestId('game-screen-compact') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId('game-screen-locked').textContent).toContain('openstaande wissel');
    fireEvent.click(screen.getByTestId('game-screen-compact'));
    expect(readGameScreen()).toBe('classic');
    expect(g.pendingSwapLineup).not.toBeNull();
  });

  it('dezelfde blokkade geldt voor Compact met een opgeslagen onbevestigde wissel', () => {
    const g = game({
      onCourt: ['gp-4', 'gp-12', 'gp-9', 'gp-11', 'gp-13'],
      pendingSwapLineup: ['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13'],
    });
    render(
      <div>
        <Bar />
        <Panels g={g} compact />
      </div>,
    );
    openMenu();
    expect((screen.getByTestId('game-screen-classic') as HTMLInputElement).disabled).toBe(true);
  });

  it('open Compact-concept blokkeert de schakelaar tot het gesloten is', () => {
    render(
      <div>
        <Bar />
        <Panels g={game()} compact />
      </div>,
    );
    openMenu();
    expect((screen.getByTestId('game-screen-compact') as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('compact-swap-open'));
    expect(getGameScreenLocks().dialog).toBe(true);
    expect((screen.getByTestId('game-screen-compact') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId('game-screen-locked').textContent).toContain('open venster');
    fireEvent.click(screen.getByTestId('compact-dialog-cancel'));
    expect((screen.getByTestId('game-screen-compact') as HTMLInputElement).disabled).toBe(false);
    expect(getGameScreenLocks()).toEqual({ swap: false, dialog: false });
  });

  it('open Klassiek wisselvenster blokkeert de schakelaar', () => {
    const g = game({
      onCourt: ['gp-4', 'gp-12', 'gp-9', 'gp-11', 'gp-13'],
      pendingSwapLineup: ['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13'],
    });
    render(
      <div>
        <Bar />
        <Panels g={g} compact={false} />
      </div>,
    );
    fireEvent.click(screen.getByTestId('swap-done-btn'));
    expect(getGameScreenLocks().swap).toBe(true);
    openMenu();
    expect((screen.getByTestId('game-screen-compact') as HTMLInputElement).disabled).toBe(true);
  });

  it('wissel mag weer na verwijderen van het scherm (unmount geeft de blokkade vrij)', () => {
    const g = game({
      onCourt: ['gp-4', 'gp-12', 'gp-9', 'gp-11', 'gp-13'],
      pendingSwapLineup: ['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13'],
    });
    const view = render(<Panels g={g} compact />);
    expect(getGameScreenLocks().swap).toBe(true);
    view.unmount();
    expect(getGameScreenLocks()).toEqual({ swap: false, dialog: false });
  });

  it('alleen-lezen: de schakelaar blijft bedienbaar, het scherm blijft alleen-lezen', () => {
    const g = game({
      onCourt: ['gp-4', 'gp-12', 'gp-9', 'gp-11', 'gp-13'],
      pendingSwapLineup: ['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13'],
    });
    render(
      <div>
        <Bar />
        <Panels g={g} compact canWrite={false} />
      </div>,
    );
    openMenu();
    expect((screen.getByTestId('game-screen-classic') as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('game-screen-compact'));
    expect(readGameScreen()).toBe('compact');
    expect((screen.getByTestId('compact-swap-open') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('compact-pending-discard') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

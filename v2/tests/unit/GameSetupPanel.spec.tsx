// @vitest-environment jsdom
//
// PR 7.3a (docs/pr-7.3-plan.md §C 7.3a): bewijst de pre-game-gate in
// GameSetupPanel — de startknop blijft geblokkeerd in cloud-modus totdat
// `cloudClaim` op `'confirmed'` staat, toont per `WriterClaimErrorCode` een
// eigen NL-herstelmelding op `'blocked'`, en blijft ongewijzigd (geen
// claim-eis) in alleen-lokale modus (`'not-required'`).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { GameSetupPanel } from '../../src/ui/game/GameSetupPanel';
import type { ActiveGame, GamePlayer } from '../../src/domain/game/types';
import type { CloudClaimStatus } from '../../src/domain/game/writerClaim';
import type { PwaReadinessStatus } from '../../src/domain/pwa/pwaReadiness';

const READY: PwaReadinessStatus = { kind: 'ready' };

afterEach(() => cleanup());

function player(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    id: 'gp-1',
    rosterId: 1,
    nr: '7',
    naam: 'Jan',
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: true,
    ...overrides,
  };
}

function readyGame(overrides: Partial<ActiveGame> = {}): ActiveGame {
  return {
    id: 'game-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'setup',
    players: [1, 2, 3, 4, 5].map((n) =>
      player({ id: `gp-${n}`, rosterId: n, nr: String(n), naam: `Speler ${n}` }),
    ),
    opponent: '',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: [],
    curQuarter: 1,
    beginSec: 0,
    endSec: 0,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    ...overrides,
  };
}

function renderPanel(
  cloudClaim: CloudClaimStatus,
  onRetryClaim = vi.fn(),
  pwaReadiness: PwaReadinessStatus = READY,
) {
  return render(
    <GameSetupPanel
      lang="nl"
      game={readyGame()}
      useClassLimit={false}
      onGameChange={vi.fn()}
      onGoToRoster={vi.fn()}
      canWrite={true}
      saveError={false}
      cloudClaim={cloudClaim}
      onRetryClaim={onRetryClaim}
      pwaReadiness={pwaReadiness}
    />,
  );
}

describe('ui/game/GameSetupPanel: pre-game cloudclaim-gate (PR 7.3a)', () => {
  it('alleen-lokale modus (not-required): startknop is meteen bruikbaar, geen retry-knop', () => {
    const { getByTestId, queryByTestId } = renderPanel({ kind: 'not-required' });
    const btn = getByTestId('game-start-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Start wedstrijd');
    expect(queryByTestId('game-claim-retry')).toBeNull();
  });

  it('cloudmodus, pending: startknop blijft geblokkeerd en toont "claimen"-tekst', () => {
    const { getByTestId, queryByTestId } = renderPanel({ kind: 'pending' });
    const btn = getByTestId('game-start-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Wedstrijd claimen…');
    expect(queryByTestId('game-claim-retry')).toBeNull();
  });

  it('cloudmodus, confirmed: startknop is bruikbaar, geen retry-knop', () => {
    const { getByTestId, queryByTestId } = renderPanel({
      kind: 'confirmed',
      identity: { writerUid: 'uid-alice', deviceId: 'device-alice', writerEpoch: 0 },
    });
    const btn = getByTestId('game-start-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Start wedstrijd');
    expect(queryByTestId('game-claim-retry')).toBeNull();
  });

  it('cloudmodus, blocked (already-claimed): startknop blijft geblokkeerd, retry-knop verschijnt', () => {
    const onRetry = vi.fn();
    const { getByTestId } = renderPanel({ kind: 'blocked', code: 'already-claimed' }, onRetry);
    const btn = getByTestId('game-start-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Deze wedstrijd wordt al door een ander apparaat gescoord.');
    const retryBtn = getByTestId('game-claim-retry') as HTMLButtonElement;
    expect(retryBtn.disabled).toBe(false);
    retryBtn.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['offline', 'Geen verbinding — kan de wedstrijd niet claimen voor je begint.'],
    ['stale-revision', 'De wedstrijd is net gewijzigd. Probeer opnieuw.'],
    ['role-denied', 'Je hebt geen rechten om deze wedstrijd te claimen.'],
    ['game-completed', 'Deze wedstrijd is al afgerond.'],
    ['unknown', 'Claimen is mislukt. Probeer opnieuw.'],
  ] as const)(
    'cloudmodus, blocked (%s): toont de bijbehorende NL-herstelmelding',
    (code, label) => {
      const { getByTestId } = renderPanel({ kind: 'blocked', code });
      expect(getByTestId('game-start-btn').textContent).toBe(label);
    },
  );

  it('roster-redenen gaan altijd voor cloudclaim-redenen', () => {
    // Vier geldige spelers (< 5) i.p.v. nul — leeg roster (vp.length === 0)
    // toont een heel ander scherm ("Nog geen spelers"), geen startknop.
    const fourPlayers = readyGame().players.slice(0, 4);
    const { getByTestId, queryByTestId } = render(
      <GameSetupPanel
        lang="nl"
        game={readyGame({ players: fourPlayers })}
        useClassLimit={false}
        onGameChange={vi.fn()}
        onGoToRoster={vi.fn()}
        canWrite={true}
        saveError={false}
        cloudClaim={{ kind: 'blocked', code: 'already-claimed' }}
        onRetryClaim={vi.fn()}
        pwaReadiness={READY}
      />,
    );
    expect(getByTestId('game-start-btn').textContent).toBe('Minimaal 5 spelers met een naam nodig');
    // Geen retry-knop: dit is een roster-probleem, geen claimprobleem.
    expect(queryByTestId('game-claim-retry')).toBeNull();
  });

  it('!canWrite houdt zowel de startknop als de retry-knop uitgeschakeld', () => {
    const { getByTestId } = render(
      <GameSetupPanel
        lang="nl"
        game={readyGame()}
        useClassLimit={false}
        onGameChange={vi.fn()}
        onGoToRoster={vi.fn()}
        canWrite={false}
        saveError={false}
        cloudClaim={{ kind: 'blocked', code: 'already-claimed' }}
        onRetryClaim={vi.fn()}
        pwaReadiness={READY}
      />,
    );
    expect((getByTestId('game-start-btn') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId('game-claim-retry') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ui/game/GameSetupPanel: pre-game PWA-readinesscheck (PR 8.1b)', () => {
  it("'ready': geen meldingsregel, startknop blijft bruikbaar", () => {
    const { getByTestId, queryByTestId } = renderPanel({ kind: 'not-required' }, vi.fn(), READY);
    expect((getByTestId('game-start-btn') as HTMLButtonElement).disabled).toBe(false);
    expect(queryByTestId('game-pwa-readiness')).toBeNull();
  });

  it("'unsupported': niet-blokkerend informatief bericht, startknop blijft bruikbaar (stopregel §D)", () => {
    const { getByTestId } = renderPanel({ kind: 'not-required' }, vi.fn(), { kind: 'unsupported' });
    const btn = getByTestId('game-start-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Start wedstrijd');
    expect(getByTestId('game-pwa-readiness').textContent).toBe(
      'Geen offline-ondersteuning gedetecteerd op dit apparaat. Alleen-lokaal gebruik werkt gewoon.',
    );
  });

  it("'registering': niet-blokkerend informatief bericht, startknop blijft bruikbaar", () => {
    const { getByTestId } = renderPanel({ kind: 'not-required' }, vi.fn(), { kind: 'registering' });
    expect((getByTestId('game-start-btn') as HTMLButtonElement).disabled).toBe(false);
    expect(getByTestId('game-pwa-readiness').textContent).toBe(
      'De app wordt nog offline-klaar gemaakt. Probeer het zo opnieuw.',
    );
  });

  it("'update-pending': niet-blokkerend informatief bericht, startknop blijft bruikbaar", () => {
    const { getByTestId } = renderPanel({ kind: 'not-required' }, vi.fn(), {
      kind: 'update-pending',
    });
    expect((getByTestId('game-start-btn') as HTMLButtonElement).disabled).toBe(false);
    expect(getByTestId('game-pwa-readiness').textContent).toBe(
      'Er staat een update klaar. Overweeg die vóór de wedstrijd bij te werken.',
    );
  });

  it("'broken': BLOKKEERT de startknop met een concrete, herstelbare melding", () => {
    const { getByTestId } = renderPanel({ kind: 'not-required' }, vi.fn(), { kind: 'broken' });
    const btn = getByTestId('game-start-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe(
      'De offline-gereedheidscheck is mislukt. Probeer opnieuw voordat je start.',
    );
    expect(getByTestId('game-pwa-readiness').textContent).toBe(
      'De offline-gereedheidscheck is mislukt. Probeer opnieuw voordat je start.',
    );
  });

  it('roster-redenen gaan vóór een broken PWA-status', () => {
    const fourPlayers = readyGame().players.slice(0, 4);
    const { getByTestId } = render(
      <GameSetupPanel
        lang="nl"
        game={readyGame({ players: fourPlayers })}
        useClassLimit={false}
        onGameChange={vi.fn()}
        onGoToRoster={vi.fn()}
        canWrite={true}
        saveError={false}
        cloudClaim={{ kind: 'not-required' }}
        onRetryClaim={vi.fn()}
        pwaReadiness={{ kind: 'broken' }}
      />,
    );
    expect(getByTestId('game-start-btn').textContent).toBe('Minimaal 5 spelers met een naam nodig');
  });

  it('cloudclaim-redenen gaan vóór een broken PWA-status', () => {
    const { getByTestId } = renderPanel({ kind: 'pending' }, vi.fn(), { kind: 'broken' });
    expect(getByTestId('game-start-btn').textContent).toBe('Wedstrijd claimen…');
  });
});

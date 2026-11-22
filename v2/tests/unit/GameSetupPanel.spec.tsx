// @vitest-environment jsdom
//
// PR 7.3a (docs/pr-7.3-plan.md §C 7.3a): bewijst de pre-game-gate in
// GameSetupPanel — de startknop blijft geblokkeerd in cloud-modus totdat
// `cloudClaim` op `'confirmed'` staat, toont per `WriterClaimErrorCode` een
// eigen NL-herstelmelding op `'blocked'`, en blijft ongewijzigd (geen
// claim-eis) in alleen-lokale modus (`'not-required'`).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { GameSetupPanel } from '../../src/ui/game/GameSetupPanel';
import { CalmLivePanel } from '../../src/ui/game/CalmLivePanel';
import {
  COMPACT_AWAY_STORAGE_KEY,
  parseAwayGameIds,
  readAwayPreference,
  storeAwayPreference,
} from '../../src/infrastructure/game/compactAwayPreference';
import type { ActiveGame, GamePlayer } from '../../src/domain/game/types';
import type { CloudClaimStatus } from '../../src/domain/game/writerClaim';
import type { PwaReadinessStatus } from '../../src/domain/pwa/pwaReadiness';

const READY: PwaReadinessStatus = { kind: 'ready' };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

  it('geblokkeerde claim met diagnose: toont een dichtgeklapt blok Technische details met de ruwe fout', () => {
    const detail = 'stage: ensureGame\ncode: permission-denied\nname: FirebaseError';
    const { getByTestId } = renderPanel({ kind: 'blocked', code: 'offline', detail });
    const block = getByTestId('game-claim-details') as HTMLDetailsElement;
    expect(block.open).toBe(false);
    expect(block.querySelector('summary')?.textContent).toBe('Technische details');
    expect(getByTestId('game-claim-details-text').textContent).toBe(detail);
  });

  it('geblokkeerde claim zonder diagnose: geen details-blok', () => {
    const { queryByTestId } = renderPanel({ kind: 'blocked', code: 'offline' });
    expect(queryByTestId('game-claim-details')).toBeNull();
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
      'Offline-gebruik is op dit apparaat niet gegarandeerd. Probeer opnieuw voordat je start.',
    );
    expect(getByTestId('game-pwa-readiness').textContent).toBe(
      'Offline-gebruik is op dit apparaat niet gegarandeerd. Probeer opnieuw voordat je start.',
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

describe('ui/game/GameSetupPanel: Uitwedstrijd (R9)', () => {
  function renderAway(lang: 'nl' | 'en' = 'nl', game: ActiveGame = readyGame()) {
    return render(
      <GameSetupPanel
        lang={lang}
        game={game}
        useClassLimit={false}
        onGameChange={vi.fn()}
        onGoToRoster={vi.fn()}
        canWrite={true}
        saveError={false}
        cloudClaim={{ kind: 'not-required' }}
        onRetryClaim={vi.fn()}
        pwaReadiness={READY}
      />,
    );
  }

  beforeEach(() => window.localStorage.clear());

  it('staat standaard uit en toont de uitleg (NL en EN)', () => {
    const nl = renderAway();
    const toggle = nl.getByTestId('game-away') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    const label = toggle.closest('label');
    expect(label?.textContent).toContain('Uitwedstrijd');
    expect(label?.textContent).toContain('de tegenstander staat links');
    cleanup();
    const en = renderAway('en');
    expect(en.getByTestId('game-away').closest('label')?.textContent).toContain('Away game');
    expect(en.getByTestId('game-away').closest('label')?.textContent).toContain(
      'the opponent is on the left',
    );
  });

  it('schrijft de voorkeur per wedstrijd-ID naar de bestaande opslag en leest haar terug', () => {
    const first = renderAway();
    fireEvent.click(first.getByTestId('game-away'));
    expect(readAwayPreference('game-1')).toBe(true);
    expect(parseAwayGameIds(window.localStorage.getItem(COMPACT_AWAY_STORAGE_KEY))).toEqual([
      'game-1',
    ]);
    // Geen nieuwe key en niets op het spel zelf.
    expect(window.localStorage.length).toBe(1);
    cleanup();
    const again = renderAway();
    expect((again.getByTestId('game-away') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(again.getByTestId('game-away'));
    expect(readAwayPreference('game-1')).toBe(false);
    cleanup();
    const other = renderAway('nl', readyGame({ id: 'game-2' }));
    expect((other.getByTestId('game-away') as HTMLInputElement).checked).toBe(false);
  });

  it('is dezelfde voorkeur als in Snel en Compact (storeAwayPreference → schakelaar)', () => {
    storeAwayPreference('game-1', true);
    const u = renderAway();
    expect((u.getByTestId('game-away') as HTMLInputElement).checked).toBe(true);
  });

  it('Rustig draait de volgorde van de stand om zodra de opzetpagina Uitwedstrijd aanzet', () => {
    const setupPanel = renderAway();
    fireEvent.click(setupPanel.getByTestId('game-away'));
    cleanup();
    const live = render(
      <CalmLivePanel
        lang="nl"
        game={readyGame({ phase: 'tracking', onCourt: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5'] })}
        quarterCount={4}
        periodLabel="Kwart"
        classification={{
          useClassLimit: false,
          classBaseLimit: 15,
          maxBonus: 2.5,
          bonusTag1Only: 1.5,
          bonusTag2Only: 1,
          bonusBoth: 2,
        }}
        teamName="Eigen"
        tag1Label=""
        tag2Label=""
        onGameChange={vi.fn()}
        onFinishGame={vi.fn()}
        canWrite={true}
        saveError={false}
      />,
    );
    fireEvent.click(live.getByTestId('calm-view-game'));
    const order = Array.from(live.getByTestId('calm-score').children).map((c) =>
      c.getAttribute('data-testid'),
    );
    expect(order).toEqual(['calm-score-against', 'calm-score-for']);
  });

  it('blijft werken als localStorage lezen en schrijven weigert (foutpad)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage uit');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage vol');
    });
    const u = renderAway();
    const toggle = u.getByTestId('game-away') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(() => fireEvent.click(toggle)).not.toThrow();
    // De keuze geldt dan alleen voor deze sessie: de schakelaar volgt de tik.
    expect((u.getByTestId('game-away') as HTMLInputElement).checked).toBe(true);
    vi.restoreAllMocks();
  });

  it.each(['niet-json{', '{"game-1":true}', '[1,null,{}]'])(
    'valt bij ongeldige opslag (%s) terug op thuis',
    (raw) => {
      window.localStorage.setItem(COMPACT_AWAY_STORAGE_KEY, raw);
      const u = renderAway();
      expect((u.getByTestId('game-away') as HTMLInputElement).checked).toBe(false);
    },
  );
});

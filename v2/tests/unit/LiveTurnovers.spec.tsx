// @vitest-environment jsdom
// Turnovers op het live-scherm: rij in de scorekaart, teller per segment, +1/−1,
// klem op 0, read-only, het segment draagt `tov`, en het bewerken van `tov`.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'preact/hooks';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/preact';
import { LiveTrackingPanel } from '../../src/ui/game/LiveTrackingPanel';
import { deriveGameHistory, segmentTurnovers } from '../../src/domain/game/tracking';
import type { ActiveGame, GamePlayer } from '../../src/domain/game/types';

afterEach(() => cleanup());

function player(n: number): GamePlayer {
  return {
    id: `gp-${n}`,
    rosterId: n,
    nr: String(n),
    naam: `Speler ${n}`,
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: n <= 5,
  };
}

function trackingGame(): ActiveGame {
  return {
    id: 'game-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players: [1, 2, 3, 4, 5, 6].map(player),
    opponent: 'Tegen',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5'],
    curQuarter: 1,
    beginSec: 600,
    endSec: 300,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
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

function Harness(props: { canWrite?: boolean; onChange: (g: ActiveGame) => void }) {
  const [game, setGame] = useState<ActiveGame>(trackingGame());
  return (
    <LiveTrackingPanel
      lang="nl"
      game={game}
      quarterCount={4}
      periodLabel="Kwart"
      classification={CLASSIFICATION}
      teamName="Team"
      tag1Label=""
      tag2Label=""
      onGameChange={(next) => {
        setGame(next);
        props.onChange(next);
      }}
      onFinishGame={vi.fn()}
      canWrite={props.canWrite ?? true}
      saveError={false}
    />
  );
}

function setup(canWrite = true) {
  let latest: ActiveGame = trackingGame();
  const utils = render(
    <Harness
      canWrite={canWrite}
      onChange={(g) => {
        latest = g;
      }}
    />,
  );
  return { ...utils, game: () => latest };
}

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('ui/game/LiveTrackingPanel — turnovers', () => {
  it('+1 telt turnovers op (totaal en dit segment) en schrijft turnover-delta-acties', async () => {
    const { getByTestId, game } = setup();
    expect(text(getByTestId('turnover-count'))).toBe('0');

    fireEvent.click(getByTestId('turnover-plus'));
    fireEvent.click(getByTestId('turnover-plus'));
    fireEvent.click(getByTestId('turnover-plus'));

    await waitFor(() => expect(text(getByTestId('turnover-count'))).toBe('3'));
    expect(text(getByTestId('segment-turnovers'))).toContain('3');
    const deltas = game().actions.filter((a) => a.type === 'turnover-delta');
    expect(deltas).toHaveLength(3);
    expect(deltas.every((a) => a.type === 'turnover-delta' && a.delta === 1)).toBe(true);
  });

  it('−1 corrigeert, en is uitgeschakeld (klem) zodra het open segment 0 is', async () => {
    const { getByTestId } = setup();
    const minus = getByTestId('turnover-minus') as HTMLButtonElement;
    expect(minus.disabled).toBe(true);

    fireEvent.click(getByTestId('turnover-plus'));
    fireEvent.click(getByTestId('turnover-plus'));
    await waitFor(() => expect(text(getByTestId('turnover-count'))).toBe('2'));
    expect(minus.disabled).toBe(false);

    fireEvent.click(minus);
    await waitFor(() => expect(text(getByTestId('turnover-count'))).toBe('1'));
    fireEvent.click(minus);
    await waitFor(() => expect(text(getByTestId('turnover-count'))).toBe('0'));
    expect(minus.disabled).toBe(true);
  });

  it('segment opslaan draagt tov; de segmentteller begint opnieuw en de pil staat in de lijst', async () => {
    const { getByTestId, container, game } = setup();
    fireEvent.click(getByTestId('turnover-plus'));
    fireEvent.click(getByTestId('turnover-plus'));
    await waitFor(() => expect(text(getByTestId('turnover-count'))).toBe('2'));

    fireEvent.click(getByTestId('save-segment-btn'));

    await waitFor(() => expect(game().actions.some((a) => a.type === 'segment-saved')).toBe(true));
    const segments = deriveGameHistory(game()).segments;
    expect(segments).toHaveLength(1);
    expect(segmentTurnovers(segments[0]!)).toBe(2);

    // Totaal blijft 2, het open segment begint weer op 0.
    expect(text(getByTestId('turnover-count'))).toBe('2');
    expect(text(getByTestId('segment-turnovers'))).toContain('0');
    expect((getByTestId('turnover-minus') as HTMLButtonElement).disabled).toBe(true);
    const pill = container.querySelector('.segment-item .turnover-pill');
    expect(pill?.textContent?.replace(/\s+/g, ' ').trim()).toBe('TO 2');
  });

  it('een segment zonder turnovers toont geen pil', async () => {
    const { getByTestId, container, game } = setup();
    fireEvent.click(getByTestId('save-segment-btn'));
    await waitFor(() => expect(game().actions.some((a) => a.type === 'segment-saved')).toBe(true));
    expect(container.querySelector('.segment-item')).not.toBeNull();
    expect(container.querySelector('.segment-item .turnover-pill')).toBeNull();
  });

  it('read-only (geen schrijfrechten): beide knoppen zijn uitgeschakeld', () => {
    const { getByTestId } = setup(false);
    expect((getByTestId('turnover-plus') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId('turnover-minus') as HTMLButtonElement).disabled).toBe(true);
  });

  it('bewerken: het veld Turnovers toont de huidige waarde en een nieuwe waarde komt in het segment', async () => {
    const { getByTestId, container, game } = setup();
    fireEvent.click(getByTestId('turnover-plus'));
    fireEvent.click(getByTestId('turnover-plus'));
    await waitFor(() => expect(text(getByTestId('turnover-count'))).toBe('2'));
    fireEvent.click(getByTestId('save-segment-btn'));
    await waitFor(() => expect(container.querySelector('.segment-item')).not.toBeNull());

    fireEvent.click(container.querySelector('.segment-item') as HTMLElement);
    const input = await waitFor(() => getByTestId('edit-tov') as HTMLInputElement);
    expect(input.value).toBe('2');

    fireEvent.input(input, { target: { value: '5' } });
    fireEvent.click(getByTestId('edit-segment-save'));

    await waitFor(() => expect(game().actions.some((a) => a.type === 'segment-edited')).toBe(true));
    const history = deriveGameHistory(game());
    expect(segmentTurnovers(history.segments[0]!)).toBe(5);
    // Het totaal volgt het bewerkte segment (5 vastgelegd, 0 open).
    await waitFor(() => expect(text(getByTestId('turnover-count'))).toBe('5'));
  });
});

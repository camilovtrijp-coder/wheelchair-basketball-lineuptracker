// @vitest-environment jsdom
// Meldingen van geweigerde livecommando's (live-command-error, swap-confirm-error,
// edit-segment-error) en de 10:00-klem van TimeSelect in Klassiek.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'preact/hooks';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/preact';
import { LiveTrackingPanel, TimeSelect } from '../../src/ui/game/LiveTrackingPanel';
import { commitSegment } from '../../src/domain/game/liveCommands';
import { deriveGameHistory, scoreDeltaAction } from '../../src/domain/game/tracking';
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

const COURT = ['gp-1', 'gp-2', 'gp-3', 'gp-4', 'gp-5'];
const CLASSIFICATION = {
  useClassLimit: false,
  classBaseLimit: 14.5,
  maxBonus: 2.5,
  bonusTag1Only: 1.5,
  bonusTag2Only: 1,
  bonusBoth: 2,
};

function baseGame(overrides: Partial<ActiveGame> = {}): ActiveGame {
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
    onCourt: [...COURT],
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

/** Stand 8-6 vastgelegd tot 8:20 (begin = eind = 500). */
function afterFirstSegment(): ActiveGame {
  const r = commitSegment(baseGame(), {
    endSec: 500,
    scoreFor: 8,
    scoreAgainst: 6,
    classification: CLASSIFICATION,
  });
  if (!r.ok) throw new Error(r.error);
  return r.game;
}

function Harness({ initial, lang = 'nl' }: { initial: ActiveGame; lang?: 'nl' | 'en' }) {
  const [game, setGame] = useState<ActiveGame>(initial);
  return (
    <LiveTrackingPanel
      lang={lang}
      game={game}
      quarterCount={4}
      periodLabel="Kwart"
      classification={CLASSIFICATION}
      teamName="Team"
      tag1Label=""
      tag2Label=""
      onGameChange={setGame}
      onFinishGame={vi.fn()}
      canWrite
      saveError={false}
    />
  );
}

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

describe("LiveTrackingPanel — meldingen geweigerde commando's", () => {
  it('segment opslaan met stand onder de beginstand toont live-command-error met de beginstand (NL)', async () => {
    // Beginstand 8-6, daarna -1: 7-6 en 100 s later. Opslaan moet geweigerd worden.
    const g = afterFirstSegment();
    const initial = {
      ...g,
      endSec: 400,
      actions: [...g.actions, scoreDeltaAction('for', -1)],
    };
    const { getByTestId, queryByTestId } = render(<Harness initial={initial} />);
    expect(queryByTestId('live-command-error')).toBeNull();
    fireEvent.click(getByTestId('save-segment-btn'));
    await waitFor(() => expect(getByTestId('live-command-error')).toBeTruthy());
    expect(text(getByTestId('live-command-error'))).toBe(
      'De stand mag niet lager zijn dan de beginstand van dit segment (8-6).',
    );
    // Er is geen tweede segment bijgekomen; de melding verdwijnt zodra de tijd verandert.
    expect(getByTestId('save-segment-btn')).toBeTruthy();
    fireEvent.change(getByTestId('end-sec'), { target: { value: '30' } });
    await waitFor(() => expect(queryByTestId('live-command-error')).toBeNull());
  });

  it('dezelfde melding bestaat in het Engels', async () => {
    const g = afterFirstSegment();
    const initial = { ...g, endSec: 400, actions: [...g.actions, scoreDeltaAction('against', -1)] };
    const { getByTestId } = render(<Harness initial={initial} lang="en" />);
    fireEvent.click(getByTestId('save-segment-btn'));
    await waitFor(() => expect(getByTestId('live-command-error')).toBeTruthy());
    expect(text(getByTestId('live-command-error'))).toBe(
      'The score cannot be lower than the starting score of this segment (8-6).',
    );
  });

  it('wissel bevestigen met duur > 0 en stand onder de beginstand toont swap-confirm-error', async () => {
    const g = afterFirstSegment();
    const initial = {
      ...g,
      onCourt: ['gp-6', 'gp-2', 'gp-3', 'gp-4', 'gp-5'],
      pendingSwapLineup: COURT,
      actions: [...g.actions, scoreDeltaAction('for', -1)],
    };
    const { getByTestId } = render(<Harness initial={initial} />);
    fireEvent.click(getByTestId('swap-done-btn'));
    fireEvent.change(getByTestId('swap-confirm-min'), { target: { value: '6' } });
    fireEvent.click(getByTestId('swap-confirm-confirm'));
    await waitFor(() => expect(getByTestId('swap-confirm-error')).toBeTruthy());
    expect(text(getByTestId('swap-confirm-error'))).toContain('(8-6)');
  });

  it('wissel op 0 s met gewijzigde stand toont swap-confirm-error; heropenen wist de melding', async () => {
    const initial = baseGame({
      onCourt: ['gp-6', 'gp-2', 'gp-3', 'gp-4', 'gp-5'],
      pendingSwapLineup: COURT,
      actions: [scoreDeltaAction('for', 2)],
    });
    const { getByTestId, queryByTestId } = render(<Harness initial={initial} />);
    fireEvent.click(getByTestId('swap-done-btn'));
    fireEvent.click(getByTestId('swap-confirm-confirm'));
    await waitFor(() => expect(getByTestId('swap-confirm-error')).toBeTruthy());
    expect(text(getByTestId('swap-confirm-error'))).toContain('ná het begin van het segment');
    fireEvent.click(getByTestId('swap-confirm-back'));
    fireEvent.click(getByTestId('swap-done-btn'));
    expect(queryByTestId('swap-confirm-error')).toBeNull();
  });

  it('segment bewerken met negatieve punten toont edit-segment-error met de beginstand', async () => {
    const g = afterFirstSegment();
    const id = deriveGameHistory(g).segments[0]!.id;
    const { getByTestId, queryByTestId } = render(<Harness initial={g} />);
    fireEvent.click(getByTestId(`segment-item-${id}`));
    fireEvent.input(getByTestId('edit-pf'), { target: { value: '-1' } });
    fireEvent.click(getByTestId('edit-segment-save'));
    await waitFor(() => expect(getByTestId('edit-segment-error')).toBeTruthy());
    expect(text(getByTestId('edit-segment-error'))).toContain('(0-0)');
    // Corrigeren van de invoer laat de melding verdwijnen en opslaan lukt.
    fireEvent.input(getByTestId('edit-pf'), { target: { value: '9' } });
    expect(queryByTestId('edit-segment-error')).toBeNull();
    fireEvent.click(getByTestId('edit-segment-save'));
    await waitFor(() => expect(queryByTestId('edit-segment-modal')).toBeNull());
  });
});

describe('TimeSelect — klem op 10:00 in Klassiek', () => {
  it('bij 10 minuten is alleen seconde 00 te kiezen en kiezen van 10 min geeft 10:00', async () => {
    const { getByTestId } = render(<Harness initial={baseGame({ beginSec: 545, endSec: 545 })} />);
    fireEvent.change(getByTestId('begin-min'), { target: { value: '10' } });
    await waitFor(() => expect((getByTestId('begin-min') as HTMLSelectElement).value).toBe('10'));
    const opts = Array.from((getByTestId('begin-sec') as HTMLSelectElement).options).map(
      (o) => o.value,
    );
    expect(opts).toEqual(['0']);
    expect((getByTestId('begin-sec') as HTMLSelectElement).value).toBe('0');
  });

  it('een opgeslagen waarde boven 10:00 (659 s) toont de seconden-select niet leeg', async () => {
    const { getByTestId } = render(<Harness initial={baseGame({ beginSec: 659, endSec: 300 })} />);
    const sec = getByTestId('begin-sec') as HTMLSelectElement;
    expect(sec.value).toBe('59');
    expect(sec.selectedIndex).toBeGreaterThanOrEqual(0);
    // Herstel via dezelfde minuten-keuze: 10 min geeft weer 10:00.
    fireEvent.change(getByTestId('begin-min'), { target: { value: '10' } });
    await waitFor(() => expect((getByTestId('begin-sec') as HTMLSelectElement).value).toBe('0'));
  });

  it('TimeSelect zelf voegt een waarde buiten het bereik toe als optie', () => {
    const { container } = render(
      <TimeSelect
        value={59}
        max={0}
        pad
        testId="ts"
        disabled={false}
        ariaLabel="s"
        onChange={() => {}}
      />,
    );
    const sel = container.querySelector('select') as HTMLSelectElement;
    expect(sel.value).toBe('59');
    expect(sel.options).toHaveLength(2);
  });
});

// @vitest-environment jsdom
// R8: weergave van het lineup-overzicht in het Geschiedenis-detail (fictieve data).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { HistoryPanel } from '../../src/ui/game/HistoryPanel';
import type { ClassificationConfig } from '../../src/domain/game/tracking';
import type { CompletedGame, GamePlayer, Segment } from '../../src/domain/game/types';

afterEach(() => cleanup());

const CONFIG: ClassificationConfig = {
  useClassLimit: true,
  classBaseLimit: 14,
  maxBonus: 2.5,
  bonusTag1Only: 1.5,
  bonusTag2Only: 1.0,
  bonusBoth: 2.0,
};

const kl = ['3.0', '2.5', '3.5', '1.5', '4.0'];
const players: GamePlayer[] = kl.map((k, i) => ({
  id: `p${i + 1}`,
  rosterId: i + 1,
  nr: String(i + 1),
  naam: `Speler ${i + 1}`,
  kl: k,
  vrouw: i === 1 || i === 3,
  jeugd: i === 2 || i === 3,
  participate: true,
  start: true,
}));

const segment: Segment = {
  id: 's1',
  quarter: 1,
  beginSec: 0,
  endSec: 125,
  durSec: 125,
  lineup: players.map((p) => p.id),
  pf: 5,
  pa: 3,
  classSum: 0,
  allowed: 0,
  over: false,
  tov: 2,
};

const game = {
  id: 'g1',
  opponent: 'Tegenstander',
  competition: '',
  date: '2026-01-01T12:00:00.000Z',
  players,
  segments: [segment],
  scoreFor: 5,
  scoreAgainst: 3,
  corrections: [],
} as unknown as CompletedGame;

function renderPanel(withClassification: boolean) {
  return render(
    <HistoryPanel
      lang="nl"
      games={[game]}
      teamName="Team"
      openId="g1"
      onOpenChange={vi.fn()}
      onDeleteGame={vi.fn()}
      canWrite={false}
      saveError={false}
      classification={withClassification ? CONFIG : undefined}
      tag1Label="Female"
      tag2Label="Junior"
    />,
  );
}

describe('HistoryPanel — lineup-overzicht (R8)', () => {
  it('toont notatie, +/- en kwartentijd van de lineup', () => {
    const { getByTestId } = renderPanel(true);
    // klasse 3+2.5+3.5+1.5+4 = 14.5; bonus 1.5+1+2 = 4.5 → max 2.5
    expect(getByTestId('history-lineup-class-0').textContent).toBe('14.5 FJ +2.5');
    expect(getByTestId('history-lineup-pm-0').textContent).toBe('+2');
    expect(getByTestId('history-lineup-quarters-0').textContent).toBe('Q1 2:05');
  });

  it('toont niets zonder classificatie-instellingen', () => {
    const { queryByTestId } = renderPanel(false);
    expect(queryByTestId('history-lineup-overview')).toBeNull();
  });
});

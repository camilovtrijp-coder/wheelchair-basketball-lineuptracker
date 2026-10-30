// @vitest-environment jsdom
// Historie-detail: 'TO N'-pil per segment (alleen bij ≥ 1) en de totaalregel.
// Handmatig narekenbaar: segmenten met tov 3 en 2 over 600 + 300 s →
// totaal 5, per 10 min = 5 / 15 * 10 = 3.3 (zie ook turnoverStats).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { HistoryPanel } from '../../src/ui/game/HistoryPanel';
import {
  fmtTurnoversPer10,
  sumTurnovers,
  totalSegmentSeconds,
  turnoversPer10,
} from '../../src/domain/game/turnoverStats';
import type { CompletedGame, Segment } from '../../src/domain/game/types';

afterEach(() => cleanup());

function segment(id: string, durSec: number, tov?: number): Segment {
  return {
    id,
    quarter: 1,
    beginSec: durSec,
    endSec: 0,
    durSec,
    lineup: ['a', 'b', 'c', 'd', 'e'],
    pf: 4,
    pa: 2,
    classSum: 0,
    allowed: 0,
    over: false,
    ...(tov === undefined ? {} : { tov }),
  };
}

function game(segments: Segment[]): CompletedGame {
  return {
    id: 'g1',
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: 'active-1',
    opponent: 'Testclub',
    competition: '',
    date: '2026-01-01T12:00:00.000Z',
    players: [],
    segments,
    scoreFor: 10,
    scoreAgainst: 8,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
  };
}

function renderDetail(g: CompletedGame, lang: 'nl' | 'en' = 'nl') {
  return render(
    <HistoryPanel
      lang={lang}
      games={[g]}
      teamName="Team"
      openId={g.id}
      onOpenChange={vi.fn()}
      onDeleteGame={vi.fn()}
      canWrite={true}
      saveError={false}
    />,
  );
}

const flat = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('ui/game/HistoryPanel — turnovers', () => {
  it('toont per segment een TO-pil en een totaalregel (3 + 2 over 15 min = 5 en 3.3 per 10 min)', () => {
    const { getByTestId, queryByTestId } = renderDetail(
      game([segment('s1', 600, 3), segment('s2', 300, 2), segment('s3', 120)]),
    );
    expect(flat(getByTestId('history-segment-tov-s1'))).toBe('TO 3');
    expect(flat(getByTestId('history-segment-tov-s2'))).toBe('TO 2');
    // Een segment zonder turnovers (oude data of 0) toont geen pil.
    expect(queryByTestId('history-segment-tov-s3')).toBeNull();
    // 5 turnovers over 600 + 300 + 120 = 1020 s = 17 min → 5 / 17 * 10 = 2.9
    expect(flat(getByTestId('history-turnovers-total'))).toBe(
      'Turnovers totaal: 5 · per 10 min: 2.9',
    );
  });

  it('hand narekenbaar: 5 turnovers over precies 900 s geeft 3.3 per 10 min', () => {
    const { getByTestId } = renderDetail(game([segment('s1', 600, 3), segment('s2', 300, 2)]));
    expect(flat(getByTestId('history-turnovers-total'))).toBe(
      'Turnovers totaal: 5 · per 10 min: 3.3',
    );
  });

  it('een wedstrijd zonder registreerde turnovers (oude data) toont geen totaalregel', () => {
    const { queryByTestId } = renderDetail(game([segment('s1', 600), segment('s2', 300, 0)]));
    expect(queryByTestId('history-turnovers-total')).toBeNull();
  });

  it('Engelse teksten', () => {
    const { getByTestId } = renderDetail(
      game([segment('s1', 600, 3), segment('s2', 300, 2)]),
      'en',
    );
    expect(flat(getByTestId('history-turnovers-total'))).toBe(
      'Turnovers total: 5 · per 10 min: 3.3',
    );
  });
});

describe('domain/game/turnoverStats', () => {
  it('sumTurnovers en totalSegmentSeconds: ontbrekend veld telt als 0', () => {
    const segs = [segment('a', 600, 3), segment('b', 300), segment('c', 300, 2)];
    expect(sumTurnovers(segs)).toBe(5);
    expect(totalSegmentSeconds(segs)).toBe(1200);
  });

  it('turnoversPer10: 5 in 15 min = 3.33…; nul of negatieve speeltijd geeft null en een streepje', () => {
    expect(turnoversPer10(5, 900)).toBeCloseTo(3.3333, 4);
    expect(turnoversPer10(4, 1200)).toBeCloseTo(2, 6);
    expect(turnoversPer10(3, 0)).toBeNull();
    expect(turnoversPer10(3, -10)).toBeNull();
    expect(fmtTurnoversPer10(null)).toBe('–');
    expect(fmtTurnoversPer10(3.3333)).toBe('3.3');
    expect(fmtTurnoversPer10(2)).toBe('2.0');
  });
});

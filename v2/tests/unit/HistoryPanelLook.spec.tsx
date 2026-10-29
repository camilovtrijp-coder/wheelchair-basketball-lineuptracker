// @vitest-environment jsdom
// v1-look voor Historie: bolletje en chevron zijn puur decoratief (aria-hidden,
// de uitslag staat altijd ook als cijfers), de knoppen krijgen de v1-varianten
// zonder dat testids, uitgeschakelde staat of toegankelijke namen veranderen.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { HistoryPanel } from '../../src/ui/game/HistoryPanel';
import type { CompletedGame } from '../../src/domain/game/types';

afterEach(() => cleanup());

function completedGame(overrides: Partial<CompletedGame> = {}): CompletedGame {
  return {
    id: 'g1',
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: 'active-1',
    opponent: 'Testclub',
    competition: 'Beker',
    date: '2026-01-01T12:00:00.000Z',
    players: [],
    segments: [],
    scoreFor: 10,
    scoreAgainst: 8,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

function renderPanel(games: CompletedGame[], openId: string | null = null, canWrite = true) {
  return render(
    <HistoryPanel
      lang="nl"
      games={games}
      teamName="Team"
      openId={openId}
      onOpenChange={vi.fn()}
      onDeleteGame={vi.fn()}
      canWrite={canWrite}
      saveError={false}
    />,
  );
}

describe('ui/game/HistoryPanel v1-look', () => {
  it('lijst: winst, verlies en gelijkspel krijgen een eigen decoratief bolletje', () => {
    const { getByTestId } = renderPanel([
      completedGame({ id: 'win', scoreFor: 10, scoreAgainst: 8 }),
      completedGame({ id: 'loss', scoreFor: 5, scoreAgainst: 9 }),
      completedGame({ id: 'draw', scoreFor: 7, scoreAgainst: 7 }),
    ]);
    const dot = (id: string) =>
      getByTestId(`history-item-${id}`).querySelector('.history-item__dot');
    expect(dot('win')?.className).toContain('history-item__dot--pos');
    expect(dot('loss')?.className).toContain('history-item__dot--neg');
    expect(dot('draw')?.className).toContain('history-item__dot--flat');
    for (const id of ['win', 'loss', 'draw']) {
      expect(dot(id)?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('lijst: chevron is aria-hidden en de uitslag blijft als tekst beschikbaar', () => {
    const { getByTestId } = renderPanel([completedGame()]);
    const item = getByTestId('history-item-g1');
    const chevron = item.querySelector('svg.history-item__chevron');
    expect(chevron).not.toBeNull();
    expect(chevron?.getAttribute('aria-hidden')).toBe('true');
    expect(chevron?.getAttribute('focusable')).toBe('false');
    expect(item.querySelector('.history-item__score')?.textContent).toBe('10 - 8');
    expect(item.textContent).toContain('Testclub');
    expect(item.textContent).toContain('Beker');
  });

  it('detail: verwijderen is de rode variant, export de groene, testids en tekst ongewijzigd', () => {
    const { getByTestId } = renderPanel([completedGame()], 'g1');
    const del = getByTestId('history-delete-btn');
    const exp = getByTestId('history-export-btn');
    expect(del.className).toContain('btn-danger');
    expect(exp.className).toContain('btn-success');
    expect(exp.className).toContain('history-detail__export');
    expect(del.textContent).toBe('Verwijderen');
    expect((del as HTMLButtonElement).disabled).toBe(false);
  });

  it('detail: zonder canWrite blijft de rode verwijderknop uitgeschakeld', () => {
    const { getByTestId } = renderPanel([completedGame()], 'g1', false);
    expect((getByTestId('history-delete-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('detail: segmentregel toont Q, opstelling, tijd en +/- met teken', () => {
    const players = [
      { id: 'p1', nr: '4', naam: 'A' },
      { id: 'p2', nr: '7', naam: 'B' },
    ] as unknown as CompletedGame['players'];
    const segments = [
      { id: 's1', quarter: 1, lineup: ['p1', 'p2'], durSec: 125, pf: 6, pa: 2 },
      { id: 's2', quarter: 2, lineup: ['p1', 'p2'], durSec: 60, pf: 1, pa: 5 },
    ] as unknown as CompletedGame['segments'];
    const { getByTestId } = renderPanel([completedGame({ players, segments })], 'g1');
    const first = getByTestId('history-segment-s1');
    expect(first.textContent).toContain('Q1');
    expect(first.textContent).toContain('4-7');
    expect(first.textContent).toContain('2:05');
    expect(first.textContent).toContain('+4');
    const second = getByTestId('history-segment-s2');
    expect(second.textContent).toContain('-4');
    expect(second.querySelector('.live-pm--neg')).not.toBeNull();
  });
});

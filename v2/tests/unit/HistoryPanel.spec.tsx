// @vitest-environment jsdom
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
    competition: '',
    date: '2026-01-01T12:00:00.000Z',
    players: [],
    segments: [],
    scoreFor: 10,
    scoreAgainst: 8,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
    ...overrides,
  };
}

describe('ui/game/HistoryPanel (PR 6.3-review, aug. 2026: rolgrens + foutzichtbaarheid)', () => {
  it('verwijderknop is uitgeschakeld zonder canWrite (bijv. scorer-rol)', () => {
    const { getByTestId } = render(
      <HistoryPanel
        lang="nl"
        games={[completedGame()]}
        teamName="Team"
        openId="g1"
        onOpenChange={vi.fn()}
        onDeleteGame={vi.fn()}
        canWrite={false}
        saveError={false}
      />,
    );
    expect((getByTestId('history-delete-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('verwijderknop is bruikbaar met canWrite (coach/owner/admin)', () => {
    const { getByTestId } = render(
      <HistoryPanel
        lang="nl"
        games={[completedGame()]}
        teamName="Team"
        openId="g1"
        onOpenChange={vi.fn()}
        onDeleteGame={vi.fn()}
        canWrite={true}
        saveError={false}
      />,
    );
    expect((getByTestId('history-delete-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('toont een foutbanner op zowel de lijst- als detailweergave bij saveError', () => {
    const list = render(
      <HistoryPanel
        lang="nl"
        games={[completedGame()]}
        teamName="Team"
        openId={null}
        onOpenChange={vi.fn()}
        onDeleteGame={vi.fn()}
        canWrite={true}
        saveError={true}
      />,
    );
    expect(list.getByTestId('history-save-error')).toBeTruthy();
    list.unmount();

    const detail = render(
      <HistoryPanel
        lang="nl"
        games={[completedGame()]}
        teamName="Team"
        openId="g1"
        onOpenChange={vi.fn()}
        onDeleteGame={vi.fn()}
        canWrite={true}
        saveError={true}
      />,
    );
    expect(detail.getByTestId('history-save-error')).toBeTruthy();
  });

  it('toont geen foutbanner zonder saveError', () => {
    const { queryByTestId } = render(
      <HistoryPanel
        lang="nl"
        games={[]}
        teamName="Team"
        openId={null}
        onOpenChange={vi.fn()}
        onDeleteGame={vi.fn()}
        canWrite={true}
        saveError={false}
      />,
    );
    expect(queryByTestId('history-save-error')).toBeNull();
  });
});

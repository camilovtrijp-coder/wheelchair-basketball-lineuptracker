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
    revision: 0,
    deletedAt: null,
    deletedBy: null,
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

// PR 7.2a: per-item cloudsyncbadge, uitsluitend zichtbaar in cloud-modus.
describe('ui/game/HistoryPanel (PR 7.2a: syncStatuses-badge)', () => {
  it('toont GEEN syncbadge zonder syncStatuses (lokale modus)', () => {
    const { queryByTestId } = render(
      <HistoryPanel
        lang="nl"
        games={[completedGame()]}
        teamName="Team"
        openId={null}
        onOpenChange={vi.fn()}
        onDeleteGame={vi.fn()}
        canWrite={true}
        saveError={false}
      />,
    );
    expect(queryByTestId('history-sync-status-g1')).toBeNull();
  });

  it('toont de bekende status op de lijstweergave in cloud-modus', () => {
    const { getByTestId } = render(
      <HistoryPanel
        lang="nl"
        games={[completedGame()]}
        teamName="Team"
        openId={null}
        onOpenChange={vi.fn()}
        onDeleteGame={vi.fn()}
        canWrite={true}
        saveError={false}
        syncStatuses={{ g1: 'gesynchroniseerd' }}
      />,
    );
    expect(getByTestId('history-sync-status-g1').dataset.status).toBe('gesynchroniseerd');
  });

  it('valt terug op lokaal-beschikbaar voor een item zonder bekende status', () => {
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
        syncStatuses={{}}
      />,
    );
    expect(getByTestId('history-sync-status-g1').dataset.status).toBe('lokaal-beschikbaar');
  });
});

// Externe review op PR #64: een cloudfout mag nooit tegelijk met een
// (mogelijk verouderde) 'gesynchroniseerd'-syncbadge getoond worden — dat
// oogt tegenstrijdig ("mislukt" én "gesynchroniseerd" naast elkaar).
describe('ui/game/HistoryPanel (externe review PR #64: cloudSync vs. cloudReadError)', () => {
  const cloudSync = {
    status: 'gesynchroniseerd' as const,
    fromCache: false,
    hasPendingWrites: false,
  };

  it('toont de lijstbrede syncindicator wanneer er geen cloudfout is', () => {
    const { getByTestId } = render(
      <HistoryPanel
        lang="nl"
        games={[completedGame()]}
        teamName="Team"
        openId={null}
        onOpenChange={vi.fn()}
        onDeleteGame={vi.fn()}
        canWrite={true}
        saveError={false}
        cloudSync={cloudSync}
      />,
    );
    expect(getByTestId('history-cloud-sync-status')).toBeTruthy();
  });

  it('verbergt de syncindicator zodra cloudReadError actief is, ook als cloudSync nog een oude waarde draagt', () => {
    const { queryByTestId, getByTestId } = render(
      <HistoryPanel
        lang="nl"
        games={[completedGame()]}
        teamName="Team"
        openId={null}
        onOpenChange={vi.fn()}
        onDeleteGame={vi.fn()}
        canWrite={true}
        saveError={false}
        cloudSync={cloudSync}
        cloudReadError={true}
      />,
    );
    expect(queryByTestId('history-cloud-sync-status')).toBeNull();
    expect(getByTestId('history-cloud-read-error')).toBeTruthy();
  });
});

// PR 7.2a, P1-fix (externe review PR #61, derde ronde): een geblokkeerde
// verwijderpoging (nog niet server-bevestigd) krijgt een eigen, van
// `saveError` onderscheiden banner — zie App.handleDeleteCompletedGame().
describe('ui/game/HistoryPanel (PR 7.2a: deleteBlocked-banner, derde ronde)', () => {
  it('toont een geblokkeerd-banner op zowel de lijst- als detailweergave bij deleteBlocked', () => {
    const list = render(
      <HistoryPanel
        lang="nl"
        games={[completedGame()]}
        teamName="Team"
        openId={null}
        onOpenChange={vi.fn()}
        onDeleteGame={vi.fn()}
        canWrite={true}
        saveError={false}
        deleteBlocked={true}
      />,
    );
    expect(list.getByTestId('history-delete-blocked')).toBeTruthy();
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
        saveError={false}
        deleteBlocked={true}
      />,
    );
    expect(detail.getByTestId('history-delete-blocked')).toBeTruthy();
  });

  it('toont geen geblokkeerd-banner zonder deleteBlocked', () => {
    const { queryByTestId } = render(
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
    expect(queryByTestId('history-delete-blocked')).toBeNull();
  });
});

// PR 7.2c: een mislukte tombstone-verwijderpoging krijgt een eigen banner,
// los van `deleteBlocked` (bewust geblokkeerd) en `saveError` (mislukte
// lokale opslag) — zie App.handleDeleteCompletedGame().
describe('ui/game/HistoryPanel (PR 7.2c: deleteError-banner)', () => {
  it('toont een deleteError-banner op zowel de lijst- als detailweergave', () => {
    const list = render(
      <HistoryPanel
        lang="nl"
        games={[completedGame()]}
        teamName="Team"
        openId={null}
        onOpenChange={vi.fn()}
        onDeleteGame={vi.fn()}
        canWrite={true}
        saveError={false}
        deleteError={true}
      />,
    );
    expect(list.getByTestId('history-delete-error')).toBeTruthy();
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
        saveError={false}
        deleteError={true}
      />,
    );
    expect(detail.getByTestId('history-delete-error')).toBeTruthy();
  });

  it('toont geen deleteError-banner zonder deleteError', () => {
    const { queryByTestId } = render(
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
    expect(queryByTestId('history-delete-error')).toBeNull();
  });
});

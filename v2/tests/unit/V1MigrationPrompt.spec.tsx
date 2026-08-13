// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { V1MigrationPrompt } from '../../src/ui/game/V1MigrationPrompt';
import type { ActiveGame } from '../../src/domain/game/types';

afterEach(() => cleanup());

function candidateGame(overrides: Partial<ActiveGame> = {}): ActiveGame {
  return {
    id: 'game-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players: [],
    opponent: 'Testclub',
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
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ui/game/V1MigrationPrompt (PR 6.1-review, aug. 2026)', () => {
  it('toont organisatienaam + teamnaam samen, niet alleen de teamnaam', () => {
    const { getByTestId } = render(
      <V1MigrationPrompt
        lang="nl"
        game={candidateGame()}
        organizationName="Rotterdam Basketball"
        teamName="U23"
        canWrite={true}
        saveError={false}
        onConfirm={() => {}}
      />,
    );

    expect(getByTestId('v1-migration-target').textContent).toBe('Rotterdam Basketball / U23');
  });

  it('onderscheidt twee organisaties met gelijknamige teams — geen dubbelzinnig doel', () => {
    // De veiligheidsreden voor deze prompt is dat v1 geen context bevat en de
    // gebruiker het juiste doel moet aanwijzen. Als alleen de teamnaam werd
    // getoond, zouden "U23" bij twee verschillende organisaties niet van
    // elkaar te onderscheiden zijn.
    const { getByTestId, rerender } = render(
      <V1MigrationPrompt
        lang="nl"
        game={candidateGame({ organizationId: 'org-rotterdam', teamId: 'team-u23' })}
        organizationName="Rotterdam Basketball"
        teamName="U23"
        canWrite={true}
        saveError={false}
        onConfirm={() => {}}
      />,
    );
    const targetForRotterdam = getByTestId('v1-migration-target').textContent;

    rerender(
      <V1MigrationPrompt
        lang="nl"
        game={candidateGame({ organizationId: 'org-nbb', teamId: 'team-u23-nbb' })}
        organizationName="Nederlandse Basketball Bond"
        teamName="U23"
        canWrite={true}
        saveError={false}
        onConfirm={() => {}}
      />,
    );
    const targetForNbb = getByTestId('v1-migration-target').textContent;

    expect(targetForRotterdam).not.toBe(targetForNbb);
    expect(targetForRotterdam).toBe('Rotterdam Basketball / U23');
    expect(targetForNbb).toBe('Nederlandse Basketball Bond / U23');
  });

  it('toont geen bevestigknop zonder canWriteGame, wel de alleen-lezen-indicator', () => {
    const onConfirm = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <V1MigrationPrompt
        lang="nl"
        game={candidateGame()}
        organizationName="Rotterdam Basketball"
        teamName="U23"
        canWrite={false}
        saveError={false}
        onConfirm={onConfirm}
      />,
    );

    expect(queryByTestId('v1-migration-confirm')).toBeNull();
    expect(getByTestId('game-read-only')).toBeTruthy();
  });

  it('roept onConfirm aan bij een klik op de bevestigknop', () => {
    const onConfirm = vi.fn();
    const { getByTestId } = render(
      <V1MigrationPrompt
        lang="nl"
        game={candidateGame()}
        organizationName="Rotterdam Basketball"
        teamName="U23"
        canWrite={true}
        saveError={false}
        onConfirm={onConfirm}
      />,
    );

    getByTestId('v1-migration-confirm').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('toont de opslagfoutmelding wanneer saveError=true', () => {
    const { getByTestId } = render(
      <V1MigrationPrompt
        lang="nl"
        game={candidateGame()}
        organizationName="Rotterdam Basketball"
        teamName="U23"
        canWrite={true}
        saveError={true}
        onConfirm={() => {}}
      />,
    );

    expect(getByTestId('game-save-error')).toBeTruthy();
  });
});

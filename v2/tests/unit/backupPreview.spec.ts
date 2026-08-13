// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildImportPreview } from '../../src/domain/backup/preview';
import { DEFAULT_SETTINGS } from '../../src/domain/settings/types';
import type { ActiveGame, CompletedGame } from '../../src/domain/game/types';

const activeGame: ActiveGame = {
  id: 'g1',
  organizationId: '',
  teamId: '',
  phase: 'tracking',
  players: [],
  opponent: 'Live tegenstander',
  competition: '',
  clockDown: true,
  limitStr: '',
  onCourt: [],
  curQuarter: 1,
  beginSec: 600,
  endSec: 600,
  pendingSwapLineup: null,
  actions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  startedAt: '2026-01-01T00:00:00.000Z',
};

const completed: CompletedGame = {
  id: 'c1',
  organizationId: '',
  teamId: '',
  sourceGameId: 'src-1',
  opponent: 'A',
  competition: '',
  date: '2026-01-01T10:00:00.000Z',
  players: [],
  segments: [],
  scoreFor: 0,
  scoreAgainst: 0,
  quarterCount: 4,
  periodLabel: '',
  useClassLimit: false,
};

describe('domain/backup/preview — replace-per-onderdeel (eigenaarsbesluit §E.2, plan §C.6)', () => {
  it('een aanwezige sectie krijgt effect "replace"', () => {
    const preview = buildImportPreview(
      { settings: { ...DEFAULT_SETTINGS, teamName: 'X' }, roster: [], completedGames: [completed] },
      2,
      '2026-01-01T00:00:00.000Z',
    );
    expect(preview.settings.effect).toBe('replace');
    expect(preview.settings.teamName).toBe('X');
    expect(preview.roster.effect).toBe('replace');
    expect(preview.completedGames.effect).toBe('replace');
    expect(preview.completedGames.count).toBe(1);
  });

  it('een afwezige sectie krijgt effect "clear"', () => {
    const preview = buildImportPreview({}, 1, null);
    expect(preview.settings.effect).toBe('clear');
    expect(preview.roster.effect).toBe('clear');
    expect(preview.completedGames.effect).toBe('clear');
    expect(preview.activeGame.effect).toBe('clear');
  });

  it('activeGame: null (expliciet geen wedstrijd) krijgt ook effect "clear", maar telt als "present"', () => {
    const preview = buildImportPreview({ activeGame: null }, 2, null);
    expect(preview.activeGame.present).toBe(true);
    expect(preview.activeGame.effect).toBe('clear');
    expect(preview.activeGame.opponent).toBeNull();
  });

  it('een echt activeGame-object krijgt effect "replace" met zichtbare tegenstander', () => {
    const preview = buildImportPreview({ activeGame }, 2, null);
    expect(preview.activeGame.effect).toBe('replace');
    expect(preview.activeGame.opponent).toBe('Live tegenstander');
  });

  it('taal is "unchanged" (geen teamdata) wanneer afwezig, "replace" wanneer aanwezig', () => {
    expect(buildImportPreview({}, 1, null).lang.effect).toBe('unchanged');
    expect(buildImportPreview({ lang: 'en' }, 2, null).lang.effect).toBe('replace');
    expect(buildImportPreview({ lang: 'en' }, 2, null).lang.value).toBe('en');
  });
});

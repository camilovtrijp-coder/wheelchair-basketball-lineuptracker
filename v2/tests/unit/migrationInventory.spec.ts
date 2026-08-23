import { describe, expect, it } from 'vitest';
import {
  buildLocalMigrationInventory,
  hasCorruptSection,
} from '../../src/domain/migration/inventory';
import { DEFAULT_SETTINGS } from '../../src/domain/settings/types';
import type { ActiveGame, CompletedGame } from '../../src/domain/game/types';

const org = 'org1';
const team = 'team1';

const completed: CompletedGame = {
  id: 'c1',
  organizationId: org,
  teamId: team,
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
  revision: 0,
  deletedAt: null,
  deletedBy: null,
};

const activeGame: ActiveGame = {
  id: 'g1',
  organizationId: org,
  teamId: team,
  phase: 'setup',
  players: [
    {
      id: 'p1',
      rosterId: 1,
      nr: '4',
      naam: 'X',
      kl: '3.0',
      vrouw: false,
      jeugd: false,
      participate: true,
      start: true,
    },
  ],
  opponent: 'B',
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
  startedAt: null,
};

describe('domain/migration/inventory (docs/pr-7.4-plan.md §C 7.4a werk 1)', () => {
  it('lege bron: alle secties "empty", geen corruptie', () => {
    const inv = buildLocalMigrationInventory(org, team, {
      settings: undefined,
      roster: undefined,
      activeGame: undefined,
      completedGames: undefined,
    });
    expect(inv.settings.status).toBe('empty');
    expect(inv.roster.status).toBe('empty');
    expect(inv.activeGame.status).toBe('empty');
    expect(inv.completedGames.status).toBe('empty');
    expect(hasCorruptSection(inv)).toBe(false);
  });

  it('partiële bron: alleen roster aanwezig, rest empty', () => {
    const inv = buildLocalMigrationInventory(org, team, {
      settings: undefined,
      roster: [{ id: 1, nr: '4', naam: 'X', kl: '3.0', vrouw: false, jeugd: false }],
      activeGame: undefined,
      completedGames: undefined,
    });
    expect(inv.roster.status).toBe('ok');
    expect(inv.roster.value).toHaveLength(1);
    expect(inv.settings.status).toBe('empty');
  });

  it('corrupte settings (aanwezig, verkeerd getypeerd veld) stopt de sectie fail-closed', () => {
    const inv = buildLocalMigrationInventory(org, team, {
      settings: { ...DEFAULT_SETTINGS, quarterCount: 'vier' },
      roster: undefined,
      activeGame: undefined,
      completedGames: undefined,
    });
    expect(inv.settings.status).toBe('corrupt');
    expect(inv.settings.errors.length).toBeGreaterThan(0);
    expect(hasCorruptSection(inv)).toBe(true);
  });

  it('dubbele completedGame-ID binnen de bron is corrupt (hergebruikt backup/validate.ts)', () => {
    const inv = buildLocalMigrationInventory(org, team, {
      settings: undefined,
      roster: undefined,
      activeGame: undefined,
      completedGames: [completed, completed],
    });
    expect(inv.completedGames.status).toBe('corrupt');
  });

  it('een completedGame onder de verkeerde organisatie/team-sleutel is corrupt (contextmismatch)', () => {
    const wrongContext = { ...completed, organizationId: 'other-org' };
    const inv = buildLocalMigrationInventory(org, team, {
      settings: undefined,
      roster: undefined,
      activeGame: undefined,
      completedGames: [wrongContext],
    });
    expect(inv.completedGames.status).toBe('corrupt');
  });

  it('een geldige activeGame (setup) wordt "ok"', () => {
    const inv = buildLocalMigrationInventory(org, team, {
      settings: undefined,
      roster: undefined,
      activeGame,
      completedGames: undefined,
    });
    expect(inv.activeGame.status).toBe('ok');
    expect(inv.activeGame.value?.phase).toBe('setup');
  });

  it('activeGame: null is expliciet leeg, geen corruptie', () => {
    const inv = buildLocalMigrationInventory(org, team, {
      settings: undefined,
      roster: undefined,
      activeGame: null,
      completedGames: undefined,
    });
    expect(inv.activeGame.status).toBe('empty');
  });
});

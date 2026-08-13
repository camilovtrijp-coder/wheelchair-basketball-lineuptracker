import { describe, it, expect } from 'vitest';
import { buildAnalysisScope } from '../../src/application/stats/buildAnalysisScope';
import type { ActiveGame, CompletedGame, GamePlayer, Segment } from '../../src/domain/game/types';
import type {
  CompletedGameRepository,
  CompletedGamesReadResult,
} from '../../src/application/game/CompletedGameRepository';

function player(id: string, rosterId: number): GamePlayer {
  return {
    id,
    rosterId,
    nr: String(rosterId),
    naam: `Speler ${rosterId}`,
    kl: '1.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: true,
  };
}

function seg(id: string, lineup: string[], durSec = 60, pf = 0, pa = 0): Segment {
  return {
    id,
    quarter: 1,
    beginSec: 0,
    endSec: durSec,
    durSec,
    lineup,
    pf,
    pa,
    classSum: 0,
    allowed: 0,
    over: false,
  };
}

function completedGame(overrides: Partial<CompletedGame> = {}): CompletedGame {
  return {
    id: overrides.id ?? 'g1',
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: 'src-1',
    opponent: 'A',
    competition: '',
    date: '2026-01-01T00:00:00.000Z',
    players: [],
    segments: [],
    scoreFor: 0,
    scoreAgainst: 0,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
    ...overrides,
  };
}

function activeGame(overrides: Partial<ActiveGame> = {}): ActiveGame {
  const players = [
    player('p1', 1),
    player('p2', 2),
    player('p3', 3),
    player('p4', 4),
    player('p5', 5),
  ];
  return {
    id: 'active-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players,
    opponent: 'Live',
    competition: '',
    clockDown: true,
    limitStr: '',
    onCourt: ['p1', 'p2', 'p3', 'p4', 'p5'],
    curQuarter: 1,
    beginSec: 600,
    endSec: 540,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakeRepo(games: CompletedGame[]): CompletedGameRepository {
  return {
    list: () => games,
    safeList: () => ({ status: 'ok', games }),
    add: () => true,
    remove: () => true,
    replaceAll: () => true,
  };
}

function fakeRepoWithRead(read: CompletedGamesReadResult): CompletedGameRepository {
  return {
    list: () => read.games,
    safeList: () => read,
    add: () => true,
    remove: () => true,
    replaceAll: () => true,
  };
}

describe('application/stats/buildAnalysisScope — canonieke bron voor de analyse', () => {
  it('geeft lege games + historyRead.status="ok" als de repository leeg is en geen actieve wedstrijd', () => {
    const scope = buildAnalysisScope(fakeRepo([]), null);
    expect(scope.games).toEqual([]);
    expect(scope.historyRead).toEqual({ status: 'ok', games: [] });
  });

  it('geeft historyRead.status="missing" voor een nog-niet-aangemaakte opslag', () => {
    const scope = buildAnalysisScope(fakeRepoWithRead({ status: 'missing', games: [] }), null);
    expect(scope.historyRead.status).toBe('missing');
    expect(scope.games).toEqual([]);
  });

  it('geeft historyRead.status="error" door aan de UI bij een readfout', () => {
    const scope = buildAnalysisScope(fakeRepoWithRead({ status: 'error', games: [] }), null);
    expect(scope.historyRead.status).toBe('error');
    expect(scope.games).toEqual([]);
  });

  it('valt terug op "ok" via list() wanneer de adapter geen safeList() heeft', () => {
    const noSafeList: CompletedGameRepository = {
      list: () => [completedGame({ id: 'g1' })],
      add: () => true,
      remove: () => true,
      replaceAll: () => true,
    };
    const scope = buildAnalysisScope(noSafeList, null);
    expect(scope.historyRead).toEqual({ status: 'ok', games: [completedGame({ id: 'g1' })] });
  });

  it('voegt de afgeronde historie ongewijzigd toe aan AnalysisGame[]', () => {
    const games = [
      completedGame({ id: 'g1', players: [player('p1', 1)] }),
      completedGame({ id: 'g2', players: [player('p1', 1)] }),
    ];
    const scope = buildAnalysisScope(fakeRepo(games), null);
    expect(scope.games.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(scope.games.every((g) => g.isCurrent === false)).toBe(true);
  });

  it('voegt een actieve wedstrijd met segmenten toe als voorlopig item vooraan', () => {
    const actionSeg = seg('liveSeg', ['p1', 'p2', 'p3', 'p4', 'p5'], 120, 2, 0);
    const active = activeGame({
      actions: [
        { type: 'segment-saved', id: 'a1', segment: actionSeg, at: '2026-01-01T00:00:00.000Z' },
      ],
    });
    const completed = completedGame({
      id: 'g1',
      players: [player('p1', 1), player('p2', 2)],
    });
    const scope = buildAnalysisScope(fakeRepo([completed]), active);
    expect(scope.games.length).toBe(2);
    expect(scope.games[0]!.isCurrent).toBe(true);
    expect(scope.games[0]!.id).toBe('active-1');
    expect(scope.games[0]!.segments.length).toBe(1);
  });

  it('sluit de actieve wedstrijd uit zonder segmenten (lege historie)', () => {
    const scope = buildAnalysisScope(fakeRepo([]), activeGame());
    expect(scope.games).toEqual([]);
  });

  it('gebruikt een aparte ID-prefix wanneer de actieve wedstrijd dezelfde ID heeft als een afgeronde wedstrijd', () => {
    const actionSeg = seg('liveSeg', ['p1', 'p2', 'p3', 'p4', 'p5'], 60, 0, 0);
    const active = activeGame({
      id: 'shared-id',
      actions: [
        { type: 'segment-saved', id: 'a1', segment: actionSeg, at: '2026-01-01T00:00:00.000Z' },
      ],
    });
    const completed = completedGame({ id: 'shared-id' });
    const scope = buildAnalysisScope(fakeRepo([completed]), active);
    expect(scope.games.map((g) => g.id)).toEqual(['current:shared-id', 'shared-id']);
  });

  it('sluit de actieve wedstrijd uit wanneer zijn sourceGameId al gearchiveerd is', () => {
    // Wanneer de actieve wedstrijd al in een CompletedGame.sourceGameId zit
    // (zie App.tsx resume-guard), mag hij niet dubbel als voorlopige
    // wedstrijd meetellen — anders dubbele aggregatie.
    const actionSeg = seg('liveSeg', ['p1', 'p2', 'p3', 'p4', 'p5'], 60, 0, 0);
    const active = activeGame({
      id: 'src-archived',
      actions: [
        { type: 'segment-saved', id: 'a1', segment: actionSeg, at: '2026-01-01T00:00:00.000Z' },
      ],
    });
    const completed = completedGame({ id: 'g-archived', sourceGameId: 'src-archived' });
    const scope = buildAnalysisScope(fakeRepo([completed]), active);
    expect(scope.games.map((g) => g.id)).toEqual(['g-archived']);
  });

  it('telt alleen segmenten die uit de acties worden afgeleid (geen dummy)', () => {
    // Eén score-delta + één segment-saved-actie → 1 segment in de scope.
    const players = [
      player('p1', 1),
      player('p2', 2),
      player('p3', 3),
      player('p4', 4),
      player('p5', 5),
    ];
    const actionSeg = seg('liveSeg', ['p1', 'p2', 'p3', 'p4', 'p5'], 120, 2, 0);
    const active: ActiveGame = activeGame({
      players,
      onCourt: ['p1', 'p2', 'p3', 'p4', 'p5'],
      actions: [
        { type: 'segment-saved', id: 'a1', segment: actionSeg, at: '2026-01-01T00:00:00.000Z' },
      ],
    });
    const scope = buildAnalysisScope(fakeRepo([]), active);
    expect(scope.games.length).toBe(1);
    expect(scope.games[0]!.segments).toHaveLength(1);
    expect(scope.games[0]!.segments[0]!.id).toBe('liveSeg');
  });
});

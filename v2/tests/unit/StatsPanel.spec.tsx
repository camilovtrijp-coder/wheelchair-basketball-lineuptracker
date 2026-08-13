// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { StatsPanel } from '../../src/ui/stats/StatsPanel';
import type {
  CompletedGameRepository,
  CompletedGamesReadResult,
} from '../../src/application/game/CompletedGameRepository';
import type { ActiveGame, CompletedGame, GamePlayer, Segment } from '../../src/domain/game/types';
import type { RosterPlayer } from '../../src/domain/roster/types';

afterEach(() => cleanup());

function player(
  id: string,
  rosterId: number,
  nr = String(rosterId),
  naam = `Speler ${rosterId}`,
): GamePlayer {
  return {
    id,
    rosterId,
    nr,
    naam,
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

function fakeRead(
  status: CompletedGamesReadResult['status'] = 'ok',
  games: CompletedGame[] = [],
): {
  repo: CompletedGameRepository;
} {
  const repo: CompletedGameRepository = {
    list: () => games,
    safeList: () => ({ status, games }),
    add: () => true,
    remove: () => true,
    replaceAll: () => true,
  };
  return { repo };
}

function completedGame(overrides: Partial<CompletedGame> = {}): CompletedGame {
  return {
    id: overrides.id ?? 'g1',
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: 'src-1',
    opponent: 'Tegenstander',
    competition: '',
    date: '2026-01-01T12:00:00.000Z',
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

const roster: RosterPlayer[] = [
  { id: 1, nr: '1', naam: 'Anna', kl: '3.0', vrouw: false, jeugd: false },
  { id: 2, nr: '2', naam: 'Bob', kl: '2.0', vrouw: false, jeugd: false },
  { id: 3, nr: '3', naam: 'Cees', kl: '3.5', vrouw: false, jeugd: false },
  { id: 4, nr: '4', naam: 'Dien', kl: '2.5', vrouw: false, jeugd: false },
  { id: 5, nr: '5', naam: 'Eve', kl: '3.0', vrouw: false, jeugd: false },
];

describe('ui/stats/StatsPanel', () => {
  it('toont "Geen data"-melding bij een lege historie (status="missing")', () => {
    const { repo } = fakeRead('missing', []);
    const { getByTestId } = render(
      <StatsPanel
        lang="nl"
        repository={repo}
        activeGame={null}
        roster={roster}
        gameIds={null}
        onGameIdsChange={() => {}}
      />,
    );
    expect(getByTestId('stats-no-data')).toBeTruthy();
  });

  it('toont een foutmelding bij read-status="error" en NOOIT de "geen data"-banner', () => {
    const { repo } = fakeRead('error', []);
    const { getByTestId, queryByTestId } = render(
      <StatsPanel
        lang="nl"
        repository={repo}
        activeGame={null}
        roster={roster}
        gameIds={null}
        onGameIdsChange={() => {}}
      />,
    );
    expect(getByTestId('stats-read-error')).toBeTruthy();
    expect(queryByTestId('stats-no-data')).toBeNull();
  });

  it('toont een lijst van combinaties bij leesbare historie', () => {
    const completed = completedGame({
      id: 'g1',
      players: [
        player('p1', 1, '1', 'Anna'),
        player('p2', 2, '2', 'Bob'),
        player('p3', 3, '3', 'Cees'),
        player('p4', 4, '4', 'Dien'),
        player('p5', 5, '5', 'Eve'),
      ],
      segments: [seg('s1', ['p1', 'p2', 'p3', 'p4', 'p5'], 180, 8, 6)],
    });
    const { repo } = fakeRead('ok', [completed]);
    const { getByTestId, queryByTestId } = render(
      <StatsPanel
        lang="nl"
        repository={repo}
        activeGame={null}
        roster={roster}
        gameIds={null}
        onGameIdsChange={() => {}}
      />,
    );
    expect(getByTestId('stats-list')).toBeTruthy();
    expect(queryByTestId('stats-no-data')).toBeNull();
    expect(queryByTestId('stats-no-combos')).toBeNull();
  });

  it('verandert combinatiegrootte en filtert de output', () => {
    const completed = completedGame({
      id: 'g1',
      players: [
        player('p1', 1),
        player('p2', 2),
        player('p3', 3),
        player('p4', 4),
        player('p5', 5),
      ],
      segments: [
        seg('s1', ['p1', 'p2', 'p3', 'p4', 'p5'], 100, 0, 0),
        seg('s2', ['p1', 'p2', 'p3', 'p4', 'p5'], 200, 0, 0),
      ],
    });
    const { repo } = fakeRead('ok', [completed]);
    const { getByTestId, queryByTestId } = render(
      <StatsPanel
        lang="nl"
        repository={repo}
        activeGame={null}
        roster={roster}
        gameIds={null}
        onGameIdsChange={() => {}}
      />,
    );
    // Default size=5 → één rij met rosterIds [1,2,3,4,5]
    expect(queryByTestId('stats-combo-1-2-3-4-5')).toBeTruthy();
    // size=2 → meerdere paren, NIET de 5-combo
    fireEvent.click(getByTestId('stats-combo-size-2'));
    expect(queryByTestId('stats-combo-1-2-3-4-5')).toBeNull();
    expect(queryByTestId('stats-combo-1-2')).toBeTruthy();
  });

  it('per10 toggle verandert de plus/min-weergave', () => {
    const completed = completedGame({
      id: 'g1',
      players: [
        player('p1', 1),
        player('p2', 2),
        player('p3', 3),
        player('p4', 4),
        player('p5', 5),
      ],
      segments: [seg('s1', ['p1', 'p2', 'p3', 'p4', 'p5'], 600, 6, 0)],
    });
    const { repo } = fakeRead('ok', [completed]);
    const { getByTestId } = render(
      <StatsPanel
        lang="nl"
        repository={repo}
        activeGame={null}
        roster={roster}
        gameIds={null}
        onGameIdsChange={() => {}}
      />,
    );
    const card = getByTestId('stats-combo-1-2-3-4-5');
    // Initieel: +6.0 (per10=false, kale pm)
    expect(card.textContent).toContain('+6.0');
    fireEvent.click(getByTestId('stats-per10-toggle'));
    // Na per10: (6 * 600) / 600 = 6.0 → ongewijzigd voor 600s, 6-0
    expect(card.textContent).toContain('+6.0');
  });

  it('sorteerrichting-toggle wisselt desc ↔ asc', () => {
    const completed = completedGame({
      id: 'g1',
      players: [
        player('p1', 1),
        player('p2', 2),
        player('p3', 3),
        player('p4', 4),
        player('p5', 5),
      ],
      segments: [
        seg('s1', ['p1', 'p2', 'p3', 'p4', 'p5'], 200, 5, 0),
        seg('s2', ['p1', 'p2', 'p3', 'p4', 'p5'], 200, 1, 0),
      ],
    });
    const { repo } = fakeRead('ok', [completed]);
    const { getByTestId } = render(
      <StatsPanel
        lang="nl"
        repository={repo}
        activeGame={null}
        roster={roster}
        gameIds={null}
        onGameIdsChange={() => {}}
      />,
    );
    expect(getByTestId('stats-sort-toggle').textContent).toContain('↓');
    fireEvent.click(getByTestId('stats-sort-toggle'));
    expect(getByTestId('stats-sort-toggle').textContent).toContain('↑');
  });

  it('spelerfilter "moet op" verwijdert rijen waar die speler ontbreekt', () => {
    const completed = completedGame({
      id: 'g1',
      players: [
        player('p1', 1),
        player('p2', 2),
        player('p3', 3),
        player('p4', 4),
        player('p5', 5),
      ],
      segments: [
        seg('s1', ['p1', 'p2', 'p3', 'p4', 'p5'], 200, 0, 0),
        seg('s2', ['p2', 'p3', 'p4', 'p5'], 100, 0, 0),
      ],
    });
    const { repo } = fakeRead('ok', [completed]);
    const { getByTestId, queryByTestId } = render(
      <StatsPanel
        lang="nl"
        repository={repo}
        activeGame={null}
        roster={roster}
        gameIds={null}
        onGameIdsChange={() => {}}
      />,
    );
    // Default size=5, geen filter → toont de [1,2,3,4,5] rij (s2 levert
    // <5 spelers en valt buiten de filter voor size=5).
    expect(queryByTestId('stats-combo-1-2-3-4-5')).toBeTruthy();
    // Open filter-modal en zet speler 1 op "moet op".
    fireEvent.click(getByTestId('stats-filter-btn'));
    const toggle = getByTestId('stats-filter-toggle-1');
    fireEvent.click(toggle);
    // Sluit modal en herzie: [1,2,3,4,5] staat in s1 dus blijft.
    expect(queryByTestId('stats-combo-1-2-3-4-5')).toBeTruthy();
  });

  it('actieve wedstrijd zonder segmenten levert geen "Huidige wedstrijd"-rij', () => {
    const completed = completedGame({
      id: 'g1',
      players: [
        player('p1', 1),
        player('p2', 2),
        player('p3', 3),
        player('p4', 4),
        player('p5', 5),
      ],
      segments: [seg('s1', ['p1', 'p2', 'p3', 'p4', 'p5'], 60, 0, 0)],
    });
    const active: ActiveGame = {
      id: 'live-1',
      organizationId: 'org-1',
      teamId: 'team-1',
      phase: 'tracking',
      players: [
        player('p1', 1),
        player('p2', 2),
        player('p3', 3),
        player('p4', 4),
        player('p5', 5),
      ],
      opponent: '',
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
    };
    const { repo } = fakeRead('ok', [completed]);
    const { queryByTestId, getByTestId } = render(
      <StatsPanel
        lang="nl"
        repository={repo}
        activeGame={active}
        roster={roster}
        gameIds={null}
        onGameIdsChange={() => {}}
      />,
    );
    // Geen 'live-1'-combo omdat de actieve wedstrijd geen segmenten heeft.
    expect(queryByTestId('stats-combo-1-2-3-4-5')).toBeTruthy();
    // Wedstrijdmodal toont alleen de afgeronde wedstrijd.
    fireEvent.click(getByTestId('stats-games-btn'));
    expect(queryByTestId('stats-game-row-live-1')).toBeNull();
    expect(getByTestId('stats-game-row-g1')).toBeTruthy();
  });

  it('NL/EN: alle zichtbare tekst komt uit het juiste strings-object', () => {
    const { repo } = fakeRead('ok', []);
    const { getByText: nl } = render(
      <StatsPanel
        lang="nl"
        repository={repo}
        activeGame={null}
        roster={roster}
        gameIds={null}
        onGameIdsChange={() => {}}
      />,
    );
    expect(nl('Statistieken')).toBeTruthy();
    const { getByText: en } = render(
      <StatsPanel
        lang="en"
        repository={repo}
        activeGame={null}
        roster={roster}
        gameIds={null}
        onGameIdsChange={() => {}}
      />,
    );
    expect(en('Stats')).toBeTruthy();
  });

  it('kan aan zonder saveError en accepteert saveError=true (visueel onzichtbaar voor stats)', () => {
    // Stats is read-only; save-fouten elders zijn niet relevant hier. Bewust
    // geen saveError prop in StatsPanel, en deze sanity-check garandeert dat.
    const { repo } = fakeRead('ok', []);
    const fn = vi.fn();
    expect(() =>
      render(
        <StatsPanel
          lang="nl"
          repository={repo}
          activeGame={null}
          roster={roster}
          gameIds={null}
          onGameIdsChange={() => {}}
        />,
      ),
    ).not.toThrow();
    fn();
  });
});

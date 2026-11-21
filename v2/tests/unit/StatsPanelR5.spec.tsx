// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { StatsPanel } from '../../src/ui/stats/StatsPanel';
import type { CompletedGameRepository } from '../../src/application/game/CompletedGameRepository';
import type {
  ActiveGame,
  CompletedGame,
  GameAction,
  GamePlayer,
  Segment,
} from '../../src/domain/game/types';

// R5 — fictieve spelers; verwachte getallen met de hand uitgerekend.

afterEach(() => cleanup());

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

const players = [1, 2, 3, 4, 5, 6].map((r) => player(`p${r}`, r));

function seg(id: string, lineup: string[], durSec: number, pf: number, pa: number, tov: number) {
  const s: Segment = {
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
    tov,
  };
  return s;
}

function repoWith(games: CompletedGame[]): CompletedGameRepository {
  return {
    list: () => games,
    safeList: () => ({ status: 'ok', games }),
    add: () => true,
    remove: () => true,
    update: () => false,
    replaceAll: () => true,
  };
}

function completed(): CompletedGame {
  return {
    id: 'g1',
    organizationId: 'o',
    teamId: 't',
    sourceGameId: 'src-1',
    opponent: 'Fictief',
    competition: '',
    date: '2026-01-01T12:00:00.000Z',
    players,
    segments: [
      seg('s1', ['p1', 'p2', 'p3', 'p4', 'p5'], 540, 12, 6, 3),
      seg('s2', ['p1', 'p2', 'p3', 'p4', 'p6'], 270, 3, 6, 2),
    ],
    scoreFor: 15,
    scoreAgainst: 12,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
  };
}

function renderPanel(activeGame: ActiveGame | null, lang: 'nl' | 'en' = 'nl') {
  return render(
    <StatsPanel
      lang={lang}
      repository={repoWith([completed()])}
      activeGame={activeGame}
      roster={[]}
      gameIds={null}
      onGameIdsChange={() => {}}
    />,
  );
}

function activeGame(): ActiveGame {
  const at = '2026-01-02T10:00:00.000Z';
  const actions: GameAction[] = [
    { type: 'score-delta', id: 'a1', team: 'for', delta: 2, at },
    { type: 'score-delta', id: 'a2', team: 'for', delta: 3, at },
    { type: 'score-delta', id: 'a3', team: 'against', delta: 2, at },
    { type: 'turnover-delta', id: 'a4', delta: 1, at },
  ];
  return {
    id: 'live-1',
    organizationId: 'o',
    teamId: 't',
    phase: 'tracking',
    players,
    opponent: 'Live',
    competition: '',
    clockDown: false,
    limitStr: '',
    onCourt: ['p1', 'p2', 'p3', 'p4', 'p5'],
    curQuarter: 1,
    beginSec: 0,
    endSec: 150,
    pendingSwapLineup: null,
    actions,
    createdAt: at,
    startedAt: at,
  };
}

describe('StatsPanel R5 — beide bases naast elkaar', () => {
  it('ON: totaal +6 én per 10 min +6.7 (6 × 600 / 540)', () => {
    const q = renderPanel(null);
    expect(q.getByTestId('stats-bases-on-1-2-3-4-5').textContent).toBe(
      'Met hen: totaal +6.0 · per 10′ +6.7',
    );
  });

  it('OFF: eigen tijd 4:30 (270s), totaal −3 en per 10 min −6.7 (−3 × 600 / 270)', () => {
    const q = renderPanel(null);
    expect(q.getByTestId('stats-bases-off-1-2-3-4-5').textContent).toBe(
      'Zonder hen: speeltijd zonder hen 4:30 · totaal -3.0 · per 10′ -6.7',
    );
  });

  it('turnovers: ON 3 totaal / 3,3 per 10 (3 × 600 / 540); OFF 2 totaal / 4,4 per 10 (2 × 600 / 270)', () => {
    const q = renderPanel(null);
    expect(q.getByTestId('stats-tov-both-on-1-2-3-4-5').textContent).toBe('totaal 3 · per 10′ 3.3');
    expect(q.getByTestId('stats-tov-both-off-1-2-3-4-5').textContent).toBe(
      'totaal 2 · per 10′ 4.4',
    );
  });

  it('beide bases staan er ook als de per-10-schakelaar uit staat (standaard)', () => {
    const q = renderPanel(null);
    expect(q.getByTestId('stats-per10-toggle').getAttribute('aria-pressed')).toBe('false');
    expect(q.getByTestId('stats-bases-on-1-2-3-4-5').textContent).toContain('per 10′');
  });

  it('Engels gebruikt Engelse labels', () => {
    const q = renderPanel(null, 'en');
    expect(q.getByTestId('stats-bases-on-1-2-3-4-5').textContent).toBe(
      'With them: total +6.0 · per 10′ +6.7',
    );
  });
});

describe('StatsPanel R5 — weinig minuten (< 5:00)', () => {
  it('270s met hen → gemarkeerd; 540s met hen → niet', () => {
    const q = renderPanel(null);
    // Combinatie p1,p2,p3,p4,p6 stond alleen in s2: 270s < 300s.
    const low = q.getByTestId('stats-combo-1-2-3-4-6');
    expect(low.getAttribute('data-low-minutes')).toBe('true');
    expect(q.getByTestId('stats-low-1-2-3-4-6').textContent).toBe('weinig minuten');
    const normal = q.getByTestId('stats-combo-1-2-3-4-5');
    expect(normal.getAttribute('data-low-minutes')).toBeNull();
    expect(q.queryByTestId('stats-low-1-2-3-4-5')).toBeNull();
  });
});

describe('StatsPanel R5 — lopende lineup', () => {
  it('zonder actieve wedstrijd geen lopende lineup', () => {
    const q = renderPanel(null);
    expect(q.queryByTestId('stats-running')).toBeNull();
  });

  it('toont sinds-tijd, punten voor/tegen en +/- totaal, gemarkeerd als voorlopig', () => {
    const q = renderPanel(activeGame());
    const card = q.getByTestId('stats-running');
    expect(q.getByTestId('stats-running-badge').textContent).toBe('lopend · voorlopig');
    // Open segment begon op 0 s → "sinds 0:00"; voor 5, tegen 2 → +3 totaal.
    expect(q.getByTestId('stats-running-since').textContent).toBe('sinds 0:00');
    expect(card.textContent).toContain('+3.0');
    // Turnovers: alleen het totaal (1).
    expect(q.getByTestId('stats-running-tov').textContent).toBe('TO met hen: 1');
  });

  it('geen per-10-waarden en geen weinig-minuten-markering op de lopende kaart', () => {
    const q = renderPanel(activeGame());
    const card = q.getByTestId('stats-running');
    expect(card.textContent).not.toContain('per 10');
    expect(card.textContent).not.toContain('weinig minuten');
    expect(q.queryByTestId('stats-running-low')).toBeNull();
  });

  it('staat boven de besturing en de lijst', () => {
    const q = renderPanel(activeGame());
    const running = q.getByTestId('stats-running');
    const list = q.getByTestId('stats-list');
    expect(running.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Engelse markering', () => {
    const q = renderPanel(activeGame(), 'en');
    expect(q.getByTestId('stats-running-badge').textContent).toBe('running · provisional');
    expect(q.getByTestId('stats-running-since').textContent).toBe('since 0:00');
  });
});

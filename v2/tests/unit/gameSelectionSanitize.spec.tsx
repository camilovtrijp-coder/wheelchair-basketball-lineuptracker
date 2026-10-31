// @vitest-environment jsdom
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import type { CompletedGameRepository } from '../../src/application/game/CompletedGameRepository';
import type { CompletedGame, GamePlayer, Segment } from '../../src/domain/game/types';
import type { AnalysisGame } from '../../src/domain/stats/types';
import { sanitizeGameSelection } from '../../src/domain/stats/sanitizeGameSelection';
import { StatsPanel } from '../../src/ui/stats/StatsPanel';
import { TrendsPanel } from '../../src/ui/trends/TrendsPanel';

afterEach(() => cleanup());

// H1: het gedeelde wedstrijdfilter blijft na het afronden niet naar een
// verdwenen id wijzen. Fictieve data.

function ag(id: string, isCurrent: boolean, sourceGameId?: string): AnalysisGame {
  return {
    id,
    opponent: id,
    competition: '',
    date: '2026-09-01T10:00:00.000Z',
    players: [],
    segments: [],
    scoreFor: 0,
    scoreAgainst: 0,
    isCurrent,
    ...(sourceGameId !== undefined ? { sourceGameId } : {}),
  };
}

describe('sanitizeGameSelection', () => {
  const games = [ag('done-1', false, 'live-1'), ag('done-2', false, 'live-2'), ag('live-3', true)];

  it('laat null en een ongewijzigde selectie ongemoeid (zelfde instantie)', () => {
    expect(sanitizeGameSelection(null, games)).toBeNull();
    const sel = new Set(['done-2', 'live-3']);
    expect(sanitizeGameSelection(sel, games)).toBe(sel);
  });

  it('vertaalt de id van een lopende wedstrijd naar de afgeronde via sourceGameId', () => {
    const out = sanitizeGameSelection(new Set(['live-1']), games);
    expect([...out!]).toEqual(['done-1']);
  });

  it('vertaalt binnen een selectie met meerdere en laat bestaande id staan', () => {
    const out = sanitizeGameSelection(new Set(['live-1', 'done-2', 'live-3']), games);
    expect([...out!].sort()).toEqual(['done-1', 'done-2', 'live-3']);
  });

  it('laat onbekende id’s vervallen en behoudt de rest', () => {
    const out = sanitizeGameSelection(new Set(['weg', 'done-2']), games);
    expect([...out!]).toEqual(['done-2']);
  });

  it('zet een lege uitkomst van een niet-lege selectie om naar null (= alles)', () => {
    expect(sanitizeGameSelection(new Set(['weg', 'ook-weg']), games)).toBeNull();
  });

  it('laat een bewust lege selectie (alle vinkjes uit) leeg', () => {
    const empty = new Set<string>();
    expect(sanitizeGameSelection(empty, games)).toBe(empty);
  });

  it('doet niets zonder wedstrijden om tegen te toetsen (leesfout of nog niet geladen)', () => {
    const sel = new Set(['live-1']);
    expect(sanitizeGameSelection(sel, [])).toBe(sel);
  });

  it('vertaalt ook een id dat nog als lopende wedstrijd bestaat maar al is afgerond', () => {
    const both = [ag('done-1', false, 'live-1'), ag('live-1', true)];
    const out = sanitizeGameSelection(new Set(['live-1']), both);
    expect([...out!]).toEqual(['done-1']);
  });
});

function gp(n: number): GamePlayer {
  return {
    id: `p${n}`,
    rosterId: n,
    nr: String(n),
    naam: `Speler ${n}`,
    kl: '1.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: true,
  };
}

function completed(id: string, sourceGameId: string): CompletedGame {
  const segment: Segment = {
    id: `${id}-s1`,
    quarter: 1,
    beginSec: 600,
    endSec: 0,
    durSec: 600,
    lineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
    pf: 10,
    pa: 6,
    classSum: 14,
    allowed: 14,
    over: false,
    tov: 1,
  };
  return {
    id,
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId,
    opponent: `Tegenstander ${id}`,
    competition: '',
    date: '2026-09-05T10:00:00.000Z',
    players: [1, 2, 3, 4, 5].map(gp),
    segments: [segment],
    scoreFor: 10,
    scoreAgainst: 6,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
  };
}

function repoOf(games: CompletedGame[]): CompletedGameRepository {
  return {
    list: () => games,
    safeList: () => ({ status: 'ok', games }),
    add: () => true,
    remove: () => true,
    update: () => false,
    replaceAll: () => true,
  };
}

const roster = [1, 2, 3, 4, 5].map((n) => ({
  id: n,
  nr: String(n),
  naam: `Speler ${n}`,
  kl: '1.0',
  vrouw: false,
  jeugd: false,
}));

// Gedraagt zich als `App`: bezit de gedeelde `Set`-state.
function Host({
  initial,
  games,
  kind,
  seen,
}: {
  initial: Set<string> | null;
  games: CompletedGame[];
  kind: 'trends' | 'stats';
  seen: Array<Set<string> | null>;
}) {
  const [ids, setIds] = useState<Set<string> | null>(initial);
  seen.push(ids);
  const common = {
    lang: 'nl' as const,
    repository: repoOf(games),
    activeGame: null,
    roster,
    gameIds: ids,
    onGameIdsChange: setIds,
  };
  return kind === 'trends' ? <TrendsPanel {...common} /> : <StatsPanel {...common} />;
}

describe('panelen schonen een verouderde selectie op (na afronden)', () => {
  const games = [completed('done-1', 'live-1'), completed('done-2', 'live-2')];

  it('Trends: "Wedstrijden (1)" blijft 1 en de afgeronde wedstrijd telt mee', () => {
    const seen: Array<Set<string> | null> = [];
    const q = render(
      <Host initial={new Set(['live-1'])} games={games} kind="trends" seen={seen} />,
    );
    expect(q.getByTestId('trends-games-btn').textContent).toContain('(1)');
    expect(q.getByTestId('trends-team-meta').textContent).toContain('1 wedstrijd');
    expect(q.queryByTestId('trends-no-data')).toBeNull();
    expect([...seen[seen.length - 1]!]).toEqual(['done-1']);
  });

  it('Trends: een selectie met alleen onbekende id’s valt terug op alles (2 wedstrijden)', () => {
    const seen: Array<Set<string> | null> = [];
    const q = render(<Host initial={new Set(['weg'])} games={games} kind="trends" seen={seen} />);
    expect(q.getByTestId('trends-games-btn').textContent).toContain('(2)');
    expect(seen[seen.length - 1]).toBeNull();
  });

  it('Statistieken: dezelfde opschoning (gedeeld filter)', () => {
    const seen: Array<Set<string> | null> = [];
    const q = render(<Host initial={new Set(['live-2'])} games={games} kind="stats" seen={seen} />);
    expect(q.getByTestId('stats-games-btn').textContent).toContain('(1)');
    expect([...seen[seen.length - 1]!]).toEqual(['done-2']);
    expect(q.queryByTestId('stats-no-combos')).toBeNull();
  });
});

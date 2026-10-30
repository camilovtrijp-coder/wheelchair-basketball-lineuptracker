// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { StatsPanel } from '../../src/ui/stats/StatsPanel';
import { TrendsPanel } from '../../src/ui/trends/TrendsPanel';
import type { CompletedGameRepository } from '../../src/application/game/CompletedGameRepository';
import type { CompletedGame, GamePlayer, Segment } from '../../src/domain/game/types';
import type { RosterPlayer } from '../../src/domain/roster/types';
import type { Lang } from '../../src/i18n/strings';

afterEach(() => cleanup());

function player(n: number): GamePlayer {
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

function seg(
  id: string,
  lineup: string[],
  durSec: number,
  pf: number,
  pa: number,
  tov?: number,
): Segment {
  return {
    id,
    quarter: 1,
    beginSec: durSec,
    endSec: 0,
    durSec,
    lineup,
    pf,
    pa,
    classSum: 0,
    allowed: 0,
    over: false,
    ...(tov === undefined ? {} : { tov }),
  };
}

function completed(id: string, date: string, segments: Segment[]): CompletedGame {
  return {
    id,
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: `src-${id}`,
    opponent: 'Tegenstander',
    competition: '',
    date,
    players: [1, 2, 3, 4, 5, 6].map(player),
    segments,
    scoreFor: 0,
    scoreAgainst: 0,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
  };
}

/** A: 1-2-3-4-5, 600 s, +4/-2, 3 tov; B: 1-2-3-4-6, 300 s, +2/-3, 2 tov. */
function oneGame(withTov = true): CompletedGame[] {
  const t = (n: number) => (withTov ? n : undefined);
  return [
    completed('g1', '2026-01-01T12:00:00.000Z', [
      seg('A', ['p1', 'p2', 'p3', 'p4', 'p5'], 600, 4, 2, t(3)),
      seg('B', ['p1', 'p2', 'p3', 'p4', 'p6'], 300, 2, 3, t(2)),
    ]),
  ];
}

function repoOf(games: CompletedGame[]): CompletedGameRepository {
  return {
    list: () => games,
    safeList: () => ({ status: 'ok', games }),
    add: () => true,
    remove: () => true,
    replaceAll: () => true,
  };
}

const roster: RosterPlayer[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: n,
  nr: String(n),
  naam: `Speler ${n}`,
  kl: '1.0',
  vrouw: false,
  jeugd: false,
}));

function renderStats(games: CompletedGame[], lang: Lang = 'nl') {
  return render(
    <StatsPanel
      lang={lang}
      repository={repoOf(games)}
      activeGame={null}
      roster={roster}
      gameIds={null}
      onGameIdsChange={() => {}}
    />,
  );
}

function renderTrends(games: CompletedGame[], lang: Lang = 'nl') {
  return render(
    <TrendsPanel
      lang={lang}
      repository={repoOf(games)}
      activeGame={null}
      roster={roster}
      gameIds={null}
      onGameIdsChange={() => {}}
    />,
  );
}

describe('Statistieken: TO met/zonder hen', () => {
  it('NL: toont de twee pillen met totalen en de kleur "minder is beter"', () => {
    const { getByTestId, getAllByText } = renderStats(oneGame());
    // 1-2-3-4-5: ON 600 s / 3 tov = 3,0 per 10; OFF 300 s / 2 tov = 4,0 per 10 -> met hen beter
    expect(getAllByText('TO met hen').length).toBe(2);
    expect(getAllByText('TO zonder hen').length).toBe(2);
    const on = getByTestId('stats-tov-on-1-2-3-4-5');
    const off = getByTestId('stats-tov-off-1-2-3-4-5');
    expect(on.textContent).toBe('3');
    expect(off.textContent).toBe('2');
    expect(on.getAttribute('data-tone')).toBe('good');
    expect(off.getAttribute('data-tone')).toBe('bad');
    // de andere opstelling is precies omgekeerd
    expect(getByTestId('stats-tov-on-1-2-3-4-6').getAttribute('data-tone')).toBe('bad');
    expect(getByTestId('stats-tov-off-1-2-3-4-6').getAttribute('data-tone')).toBe('good');
  });

  it('"Per 10 min" aan: genormaliseerde waarden (3*600/600 = 3,0 en 2*600/300 = 4,0)', () => {
    const { getByTestId } = renderStats(oneGame());
    fireEvent.click(getByTestId('stats-per10-toggle'));
    expect(getByTestId('stats-tov-on-1-2-3-4-5').textContent).toBe('3.0/10′');
    expect(getByTestId('stats-tov-off-1-2-3-4-5').textContent).toBe('4.0/10′');
  });

  it('geen speeltijd zonder de combinatie: een streepje en een neutrale kleur', () => {
    const { getByTestId } = renderStats(oneGame());
    fireEvent.click(getByTestId('stats-combo-size-1'));
    const off = getByTestId('stats-tov-off-1'); // speler 1 speelde altijd
    expect(off.textContent).toBe('–');
    expect(off.getAttribute('data-tone')).toBe('flat');
    expect(getByTestId('stats-tov-on-1').getAttribute('data-tone')).toBe('flat');
    expect(getByTestId('stats-tov-on-1').textContent).toBe('5');
  });

  it('EN: Engelse labels', () => {
    const { getAllByText } = renderStats(oneGame(), 'en');
    expect(getAllByText('TO with them').length).toBe(2);
    expect(getAllByText('TO without them').length).toBe(2);
  });

  it('oude wedstrijden zonder turnover-gegevens tonen geen pillen', () => {
    const { queryByTestId, getByTestId } = renderStats(oneGame(false));
    expect(getByTestId('stats-combo-1-2-3-4-5')).toBeTruthy();
    expect(queryByTestId('stats-tov-1-2-3-4-5')).toBeNull();
  });
});

describe('Trends: tegels, totaalregel en lineup-kaart', () => {
  it('NL: totaalregel (5 turnovers in 1 wedstrijd, 3,3 per 10 min)', () => {
    const { getByTestId } = renderTrends(oneGame());
    expect(getByTestId('trends-tov-total').textContent).toBe('5');
    expect(getByTestId('trends-tov-summary').textContent).toContain('Totaal turnovers');
    expect(getByTestId('trends-tov-summary').textContent).toContain('in 1 wedstrijd');
    // 5 * 600 / 900 = 3,33...
    expect(getByTestId('trends-tov-per10').textContent).toBe('3.3');
  });

  it('meervoud: in 2 wedstrijden', () => {
    const games = [
      ...oneGame(),
      completed('g2', '2026-01-02T12:00:00.000Z', [
        seg('C', ['p1', 'p2', 'p3', 'p4', 'p5'], 300, 1, 1, 1),
      ]),
    ];
    const { getByTestId } = renderTrends(games);
    expect(getByTestId('trends-tov-summary').textContent).toContain('in 2 wedstrijden');
    expect(getByTestId('trends-tov-total').textContent).toBe('6');
  });

  it('lineup-kaart: laagste eerst, waarde per 10 min, uitleg en kleurtoon', () => {
    const { getByTestId } = renderTrends(oneGame());
    const card = getByTestId('trends-tov-lineups');
    expect(card.textContent).toContain('Lineups: turnovers per 10 min');
    expect(card.textContent).toContain('Laagste is het beste');
    const rows = Array.from(card.querySelectorAll('[data-testid^="trends-tov-lineup-1-"]'));
    // 1-2-3-4-5: 3 * 600 / 600 = 3,0 (good, gemiddelde = 5 * 600 / 900 = 3,33); 1-2-3-4-6: 2 * 600 / 300 = 4,0 (bad)
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'trends-tov-lineup-1-2-3-4-5',
      'trends-tov-lineup-1-2-3-4-6',
    ]);
    expect(getByTestId('trends-tov-lineup-value-1-2-3-4-5').textContent).toBe('3.0');
    expect(getByTestId('trends-tov-lineup-value-1-2-3-4-6').textContent).toBe('4.0');
    expect(getByTestId('trends-tov-lineup-1-2-3-4-5').getAttribute('data-tone')).toBe('good');
    expect(getByTestId('trends-tov-lineup-1-2-3-4-6').getAttribute('data-tone')).toBe('bad');
    expect(getByTestId('trends-tov-lineup-1-2-3-4-5').textContent).toContain('1-2-3-4-5');
    expect(getByTestId('trends-tov-lineup-1-2-3-4-5').textContent).toContain('10:00');
  });

  it('tegels per speler: +/- totaal met gemiddelde, turnovers, minuten; bestaande testids blijven', () => {
    const { getByTestId } = renderTrends(oneGame());
    // speler 1: A (+2) en B (-1) in dezelfde wedstrijd -> +1; turnovers 3 + 2 = 5; 900 s = 15,0 min
    expect(getByTestId('trends-totalpm-1').textContent).toBe('+1');
    expect(getByTestId('trends-avgpm-1').textContent).toBe('+1.0');
    expect(getByTestId('trends-tov-1').textContent).toBe('5');
    expect(getByTestId('trends-avgtov-1').textContent).toBe('5.0');
    expect(getByTestId('trends-avgmin-1').textContent).toBe('15.0');
    // speler 6 speelde alleen B: 300 s, -1, 2 turnovers
    expect(getByTestId('trends-totalpm-6').textContent).toBe('-1');
    expect(getByTestId('trends-tov-6').textContent).toBe('2');
    expect(getByTestId('trends-avgmin-6').textContent).toBe('5.0');
    expect(getByTestId('trends-card-1').textContent).toContain('TURNOVERS');
  });

  it('EN: Engelse teksten', () => {
    const { getByTestId } = renderTrends(oneGame(), 'en');
    expect(getByTestId('trends-tov-summary').textContent).toContain('Total turnovers');
    expect(getByTestId('trends-tov-summary').textContent).toContain('in 1 game');
    expect(getByTestId('trends-tov-lineups').textContent).toContain('Lowest is best');
    expect(getByTestId('trends-card-1').textContent).toContain('TURNOVERS');
  });

  it('oude wedstrijden zonder turnover-gegevens: geen totaalregel, kaart of turnover-tegel, wel de bestaande waarden', () => {
    const { queryByTestId, getByTestId } = renderTrends(oneGame(false));
    expect(queryByTestId('trends-tov-summary')).toBeNull();
    expect(queryByTestId('trends-tov-lineups')).toBeNull();
    expect(queryByTestId('trends-tov-1')).toBeNull();
    expect(getByTestId('trends-avgmin-1').textContent).toBe('15.0');
    expect(getByTestId('trends-avgpm-1').textContent).toBe('+1.0');
  });
});

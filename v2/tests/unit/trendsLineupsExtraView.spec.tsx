// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/preact';
import { TrendsPanel } from '../../src/ui/trends/TrendsPanel';
import type { CompletedGameRepository } from '../../src/application/game/CompletedGameRepository';
import type { CompletedGame, Segment } from '../../src/domain/game/types';
import type { RosterPlayer } from '../../src/domain/roster/types';
import { computeComboExtremes } from '../../src/domain/trends/lineupExtras';
import type { Lang } from '../../src/i18n/strings';
import { fixtureGames, gp, seg, segmentsA, segmentsB } from './support/trendsT6T7Fixture';

afterEach(() => cleanup());

/*
 * Vaste fictieve fixture uit docs/pr-trends-lineups-plan.md §F.2 (A en B), via
 * tests/unit/support/trendsT6T7Fixture.ts (inclusief klokrichting). Handberekening:
 *   L1 = 1-2-3-4-5: 1500 s, +2 (A1 +4, A4 -4, B1 +2); gedempt 1200/2100 = 0,571
 *   L2 = 1-2-3-4-6: 1200 s, +1 (A2 -2, B2 0, B3 +3);   gedempt  600/1800 = 0,333
 *   L3 = 1-2-3-6-7:  180 s, +4;  L4 = 1-2-3-5-7: 120 s, +2   (onder de drempel van 5:00)
 *   Team: 3000 s, +9 -> +1,8 per 10.
 */

const roster: RosterPlayer[] = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
  id: n,
  nr: String(n),
  naam: `Speler ${n}`,
  kl: '1.0',
  vrouw: false,
  jeugd: false,
}));

function completed(id: string, date: string, segments: Segment[]): CompletedGame {
  return {
    id,
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: `src-${id}`,
    opponent: `Tegenstander ${id}`,
    competition: '',
    date,
    players: [1, 2, 3, 4, 5, 6, 7].map(gp),
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

function fixtureCompleted(): CompletedGame[] {
  return [
    completed('B', '2026-09-12T10:00:00.000Z', segmentsB()),
    completed('A', '2026-09-05T10:00:00.000Z', segmentsA()),
  ];
}

function renderLineups(games: CompletedGame[] = fixtureCompleted(), lang: Lang = 'nl') {
  const q = render(
    <TrendsPanel
      lang={lang}
      repository={repoOf(games)}
      activeGame={null}
      roster={roster}
      gameIds={null}
      onGameIdsChange={() => {}}
      initialView="lineups"
    />,
  );
  return q;
}
type Q = ReturnType<typeof renderLineups>;

/** Volgorde van de lineupkeys in een lijst (uit de testids `<prefix><key>`). */
function orderOf(q: Q, listTestId: string, prefix: string): string[] {
  const list = q.getByTestId(listTestId);
  return within(list)
    .getAllByRole('listitem')
    .map((li) => (li.getAttribute('data-testid') ?? '').slice(prefix.length));
}

const L1 = ['p1', 'p2', 'p3', 'p4', 'p5'];
const L2 = ['p1', 'p2', 'p3', 'p4', 'p6'];

/**
 * Extra scenario waarin de volgorde wisselt (Y = 1-2-3-4-5, X = 1-2-3-4-6).
 * Y: Q1 600 (12-10, +2), Q2 600 (10-9, +1), Q3 600 (8-8, 0) in wedstrijd G1;
 *    Q1 600 (11-10, +1), Q2 600 (9-8, +1) in wedstrijd G2 -> 3000 s, +5.
 * X: Q4 300 (5-4, +1) in G1 -> 300 s, +1.
 * Wedstrijdtotalen Y: G1 +3, G2 +2 -> beide positief.
 *   per 10:  Y = 5*600/3000 = 1,0       X = 1*600/300 = 2,0       -> waarde: X, Y
 *   gedempt: Y = 3000/(3000+600) = 0,833 X = 600/(300+600) = 0,667 -> voorzichtig: Y, X
 * Drempel 5:00 (X op precies 300 s telt mee).
 */
function switchScenario(): CompletedGame[] {
  return [
    completed('G1', '2026-09-05T10:00:00.000Z', [
      seg('G1a', 1, 600, 0, L1, 12, 10, 0, 14),
      seg('G1b', 2, 600, 0, L1, 10, 9, 0, 14),
      seg('G1c', 3, 600, 0, L1, 8, 8, 0, 14),
      seg('G1d', 4, 300, 0, L2, 5, 4, 0, 14),
    ]),
    completed('G2', '2026-09-12T10:00:00.000Z', [
      seg('G2a', 1, 600, 0, L1, 11, 10, 0, 14),
      seg('G2b', 2, 600, 0, L1, 9, 8, 0, 14),
    ]),
  ];
}

describe('Lineups T7: sorteeroptie "voorzichtig"', () => {
  it('standaard de gewone volgorde; voorzichtig houdt L1, L2 aan (0,571 > 0,333) en toont de vaste uitleg', () => {
    const q = renderLineups();
    expect(orderOf(q, 'trends-lineup-list', 'trends-lineup-')).toEqual(['1-2-3-4-5', '1-2-3-4-6']);
    expect(q.getByTestId('trends-lineup-sort-value').getAttribute('aria-pressed')).toBe('true');
    expect(q.queryByTestId('trends-lineup-sort-badge')).toBeNull();
    expect(q.queryByTestId('trends-lineup-sort-explain')).toBeNull();

    fireEvent.click(q.getByTestId('trends-lineup-sort-careful'));
    expect(q.getByTestId('trends-lineup-sort-careful').getAttribute('aria-pressed')).toBe('true');
    expect(orderOf(q, 'trends-lineup-list', 'trends-lineup-')).toEqual(['1-2-3-4-5', '1-2-3-4-6']);
    expect(q.getByTestId('trends-lineup-sort-badge').textContent).toBe('volgorde: voorzichtig');
    expect(q.getByTestId('trends-lineup-sort-explain').textContent).toContain(
      'Voorzichtig = alsof de lineup nog 10 minuten gelijk speelde; korte lineups tellen daardoor minder zwaar.',
    );
    // De getoonde waarde blijft de gewone (per 10): L1 +0,8 en L2 +0,5, niet de gedempte waarde.
    fireEvent.click(q.getByTestId('trends-per10-toggle'));
    expect(q.getByTestId('trends-lineup-value-1-2-3-4-5').textContent).toBe('+0.8');
    expect(q.getByTestId('trends-lineup-value-1-2-3-4-6').textContent).toBe('+0.5');
  });

  it('wisselt de volgorde wanneer een korte lineup een hoge ruwe waarde heeft (zie de herleiding in het scenario)', () => {
    const q = renderLineups(switchScenario());
    fireEvent.click(q.getByTestId('trends-per10-toggle'));
    // Waarde: X (+2,0) vóór Y (+1,0).
    expect(orderOf(q, 'trends-lineup-list', 'trends-lineup-')).toEqual(['1-2-3-4-6', '1-2-3-4-5']);
    expect(q.getByTestId('trends-lineup-value-1-2-3-4-6').textContent).toBe('+2.0');
    expect(q.getByTestId('trends-lineup-value-1-2-3-4-5').textContent).toBe('+1.0');

    fireEvent.click(q.getByTestId('trends-lineup-sort-careful'));
    // Voorzichtig: Y (0,833) vóór X (0,667); de getoonde waarden blijven +1,0 en +2,0.
    expect(orderOf(q, 'trends-lineup-list', 'trends-lineup-')).toEqual(['1-2-3-4-5', '1-2-3-4-6']);
    expect(q.getByTestId('trends-lineup-value-1-2-3-4-6').textContent).toBe('+2.0');
    expect(q.getByTestId('trends-lineup-value-1-2-3-4-5').textContent).toBe('+1.0');

    fireEvent.click(q.getByTestId('trends-lineup-sort-value'));
    expect(orderOf(q, 'trends-lineup-list', 'trends-lineup-')).toEqual(['1-2-3-4-6', '1-2-3-4-5']);
  });

  it('is alleen er voor de metriek +/- en wordt niet opgeslagen', () => {
    const before = Object.keys(window.localStorage).length;
    const q = renderLineups(switchScenario());
    fireEvent.click(q.getByTestId('trends-lineup-sort-careful'));
    fireEvent.click(q.getByTestId('trends-metric-pfpa'));
    expect(q.queryByTestId('trends-lineup-sort')).toBeNull();
    fireEvent.click(q.getByTestId('trends-metric-pm'));
    expect(q.getByTestId('trends-lineup-sort')).toBeTruthy(); // sessiestate blijft in de weergave
    expect(Object.keys(window.localStorage).length).toBe(before);
  });
});

describe('Lineups T7: consistentie "x van n wedstrijden positief"', () => {
  it('fixture: L1 en L2 zijn elk in 1 van 2 wedstrijden positief', () => {
    // L1: A = +4 - 4 = 0 (niet positief), B = +2 -> 1 van 2.
    // L2: A = -2, B = 0 + 3 = +3 -> 1 van 2.
    const q = renderLineups();
    expect(q.getByTestId('trends-lineup-consistency-1-2-3-4-5').textContent).toBe(
      '1 van 2 wedstrijden positief (n klein)',
    );
    expect(q.getByTestId('trends-lineup-consistency-1-2-3-4-6').textContent).toBe(
      '1 van 2 wedstrijden positief (n klein)',
    );
    expect(q.getByTestId('trends-lineup-consistency-note').textContent).toContain('klein');
    // Geen SD en geen percentage.
    expect(q.getByTestId('trends-lineup-card').textContent).not.toMatch(/%|SD/);
  });

  it('scenario: Y 2 van 2, X 1 van 1 (enkelvoud) en niet voor lineups onder de drempel', () => {
    const q = renderLineups(switchScenario());
    expect(q.getByTestId('trends-lineup-consistency-1-2-3-4-5').textContent).toBe(
      '2 van 2 wedstrijden positief (n klein)',
    );
    expect(q.getByTestId('trends-lineup-consistency-1-2-3-4-6').textContent).toBe(
      '1 van 1 wedstrijd positief (n klein)',
    );
    // Fixture: L3 (3:00) en L4 (2:00) staan onder de drempel en krijgen geen regel.
    cleanup();
    const q2 = renderLineups();
    expect(q2.queryByTestId('trends-lineup-consistency-1-2-3-6-7')).toBeNull();
    expect(q2.queryByTestId('trends-lineup-consistency-1-2-3-5-7')).toBeNull();
  });

  it('staat niet bij de metrieken Voor/Tegen', () => {
    const q = renderLineups();
    fireEvent.click(q.getByTestId('trends-metric-pfpa'));
    expect(q.queryByTestId('trends-lineup-consistency-1-2-3-4-5')).toBeNull();
  });
});

describe("Lineups T7: beste en slechtste duo's/trio's", () => {
  /*
   * Handberekening fixture (drempel 600 s, team 3000 s): paren 1-2, 1-3, 2-3 spelen
   * altijd samen (3000 s) en worden weggelaten (3). Boven de drempel blijven 11 paren:
   *   x-6 (x in 1,2,3): 1380 s, +5 -> 2,17    x-5: 1620 s, +4 -> 1,48
   *   4-5: 1500 s, +2 -> 0,80    x-4: 2700 s, +3 -> 0,67    4-6: 1200 s, +1 -> 0,50
   * Best 3: 1-6, 2-6, 3-6 (gelijk: sleutel). Worst 3: 4-6 (0,50), 1-4, 2-4 (0,67; 2700 s, sleutel).
   * Trio's: 1-2-3 (3000 s) wordt weggelaten (1); best 1-2-6, 1-3-6, 2-3-6 (2,17).
   */
  it("duo's: top en bottom 3 zoals de domeinfunctie en de handberekening, met weggelaten aantal", () => {
    const q = renderLineups();
    const expected = computeComboExtremes(fixtureGames(), null, 2, 600, 3);
    expect(expected.qualified).toBe(11);
    expect(expected.excludedAlwaysTogether).toBe(3);
    const keys = (rows: { rosterIds: number[] }[]) => rows.map((r) => r.rosterIds.join('-'));
    expect(keys(expected.best)).toEqual(['1-6', '2-6', '3-6']);
    expect(keys(expected.worst)).toEqual(['4-6', '1-4', '2-4']);

    expect(orderOf(q, 'trends-combo-best', 'trends-combo-best-')).toEqual(keys(expected.best));
    expect(orderOf(q, 'trends-combo-worst', 'trends-combo-worst-')).toEqual(keys(expected.worst));
    // Minuten, +/- per 10 en toon (1-6: +2,2 -> +0,4 t.o.v. team +1,8 = rond gemiddelde; 4-6: -1,3 = slechter).
    const best = q.getByTestId('trends-combo-best-1-6');
    expect(best.textContent).toContain('23:00');
    expect(best.textContent).toContain('+2.2');
    expect(best.textContent).toContain('●');
    expect(best.textContent).toContain('rond gemiddelde');
    expect(best.getAttribute('aria-label')).toBe(
      'Duo 1-6: 23:00, +2.2 per 10 minuten, rond gemiddelde',
    );
    const worst = q.getByTestId('trends-combo-worst-4-6');
    expect(worst.textContent).toContain('20:00');
    expect(worst.textContent).toContain('+0.5');
    expect(worst.textContent).toContain('▼');
    expect(worst.textContent).toContain('slechter');
    expect(worst.getAttribute('aria-label')).toBe(
      'Duo 4-6: 20:00, +0.5 per 10 minuten, slechter dan team',
    );
    expect(q.getByTestId('trends-combo-excluded').textContent).toContain('altijd samen speelden');
    expect(q.getByTestId('trends-combo-excluded').textContent).toContain('Weggelaten: 3.');
    // worst herhaalt best nooit.
    const bestKeys = new Set(keys(expected.best));
    expect(keys(expected.worst).some((k) => bestKeys.has(k))).toBe(false);
  });

  it("trio's: wisselen met de keuze Duo's | Trio's", () => {
    const q = renderLineups();
    expect(q.getByTestId('trends-combo-size-2').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(q.getByTestId('trends-combo-size-3'));
    expect(q.getByTestId('trends-combo-size-3').getAttribute('aria-pressed')).toBe('true');
    const expected = computeComboExtremes(fixtureGames(), null, 3, 600, 3);
    expect(expected.excludedAlwaysTogether).toBe(1);
    const keys = (rows: { rosterIds: number[] }[]) => rows.map((r) => r.rosterIds.join('-'));
    expect(keys(expected.best)).toEqual(['1-2-6', '1-3-6', '2-3-6']);
    expect(orderOf(q, 'trends-combo-best', 'trends-combo-best-')).toEqual(keys(expected.best));
    if (expected.worst.length > 0) {
      expect(orderOf(q, 'trends-combo-worst', 'trends-combo-worst-')).toEqual(keys(expected.worst));
    }
    expect(q.getByTestId('trends-combo-best-1-2-6').getAttribute('aria-label')).toBe(
      'Trio 1-2-6: 23:00, +2.2 per 10 minuten, rond gemiddelde',
    );
    expect(q.getByTestId('trends-combo-excluded').textContent).toContain('Weggelaten: 1.');
  });

  it('lege staat als er niets boven 10:00 is (alles altijd samen), met het weggelaten aantal', () => {
    // Eén lineup van 11:40: alle 10 paren spelen altijd samen -> allemaal weggelaten.
    const q = renderLineups([
      completed('S', '2026-09-05T10:00:00.000Z', [seg('S1', 1, 700, 0, L1, 10, 8, 0, 14)]),
    ]);
    expect(q.getByTestId('trends-combo-empty').textContent).toBe(
      "Te weinig data voor duo's boven 10:00",
    );
    expect(q.queryByTestId('trends-combo-best')).toBeNull();
    expect(q.getByTestId('trends-combo-excluded').textContent).toContain('Weggelaten: 10.');
    fireEvent.click(q.getByTestId('trends-combo-size-3'));
    expect(q.getByTestId('trends-combo-empty').textContent).toBe(
      "Te weinig data voor trio's boven 10:00",
    );
  });

  it('lege staat bij te weinig speeltijd (korter dan 10:00)', () => {
    const q = renderLineups([
      completed('S', '2026-09-05T10:00:00.000Z', [
        seg('S1', 1, 300, 0, L1, 4, 2, 0, 14),
        seg('S2', 1, 200, 0, L2, 2, 2, 0, 14),
      ]),
    ]);
    expect(q.getByTestId('trends-combo-empty').textContent).toContain('boven 10:00');
  });
});

describe('Lineups T7: start- en sluitlineup', () => {
  /*
   * Fixture (aflopende klok): start = eerste segment van Q1 per wedstrijd:
   *   A1 (L1, 600 s, +4) en B1 (L1, 600->300 = 300 s, +2) -> L1: 900 s, +6, 2 wedstrijden.
   * Sluit = laatste segment van Q4: A4 (L1, 600 s, 8-12 = -4) en B4 (L4, 120 s, +2):
   *   L1: 600 s, -4, 1 wedstrijd; L4: 120 s, +2, 1 wedstrijd.
   */
  it('toont per lineup minuten, totaal +/- en wedstrijden, zonder oordeel', () => {
    const q = renderLineups();
    const start = q.getByTestId('trends-startclose-start-1-2-3-4-5');
    expect(start.textContent).toContain('1-2-3-4-5');
    expect(start.textContent).toContain('15:00');
    expect(start.textContent).toContain('+6');
    expect(start.textContent).toContain('2 wedstrijden');
    expect(start.getAttribute('aria-label')).toBe('1-2-3-4-5: 15:00, totaal +6, 2 wedstrijden');
    const close1 = q.getByTestId('trends-startclose-close-1-2-3-4-5');
    expect(close1.textContent).toContain('10:00');
    expect(close1.textContent).toContain('-4');
    expect(close1.textContent).toContain('1 wedstrijd');
    const close4 = q.getByTestId('trends-startclose-close-1-2-3-5-7');
    expect(close4.textContent).toContain('2:00');
    expect(close4.textContent).toContain('+2');
    // Geen toon of oordeel in de kaart.
    const card = q.getByTestId('trends-startclose-card');
    expect(card.textContent).not.toMatch(/[▲▼●]/);
    expect(card.textContent).not.toContain('beter');
    expect(card.textContent).not.toContain('slechter');
    // Betrouwbare volgorde: geen waarschuwing; vaste uitleg wel.
    expect(q.queryByTestId('trends-startclose-unreliable')).toBeNull();
    expect(q.getByTestId('trends-startclose-explain').textContent).toContain('één segment');
  });

  it('waarschuwt met het aantal wedstrijden wanneer de volgorde onbetrouwbaar is', () => {
    // Overlappende segmenten in Q1 (verstreken 0-300 en 100-600): volgorde niet eenduidig.
    const q = renderLineups([
      completed('X', '2026-09-05T10:00:00.000Z', [
        seg('X1', 1, 600, 300, L1, 4, 2, 0, 14),
        seg('X2', 1, 500, 0, L2, 2, 2, 0, 14),
      ]),
      completed('Y', '2026-09-12T10:00:00.000Z', [
        seg('Y1', 1, 600, 300, L1, 4, 2, 0, 14),
        seg('Y2', 1, 300, 0, L2, 2, 2, 0, 14),
      ]),
    ]);
    const warn = q.getByTestId('trends-startclose-unreliable');
    expect(warn.textContent).toContain('Volgorde onzeker in 1 wedstrijd');
    expect(warn.getAttribute('role')).toBe('note');
    expect(warn.querySelector('[aria-hidden="true"]')?.textContent).toContain('⚠');
  });

  it('lege staat zonder segmenten in kwart 1 en het laatste kwart', () => {
    const q = renderLineups([
      completed('Z', '2026-09-05T10:00:00.000Z', [seg('Z1', 2, 600, 0, L1, 4, 2, 0, 14)]),
    ]);
    expect(q.getByTestId('trends-startclose-empty').textContent).toContain('Nog geen start');
  });
});

describe('Lineups T7: toegankelijkheid en taal', () => {
  it('kleur is nooit de enige aanwijzing: symbool (aria-hidden) en tekst bij elke combinatierij', () => {
    const q = renderLineups();
    const rows = [
      ...within(q.getByTestId('trends-combo-best')).getAllByRole('listitem'),
      ...within(q.getByTestId('trends-combo-worst')).getAllByRole('listitem'),
    ];
    expect(rows.length).toBe(6);
    for (const row of rows) {
      const tone = row.getAttribute('data-tone');
      expect(['good', 'flat', 'bad']).toContain(tone);
      const symbol = tone === 'good' ? '▲' : tone === 'bad' ? '▼' : '●';
      expect(row.textContent).toContain(symbol);
      expect(row.textContent).toMatch(/beter dan team|rond gemiddelde|slechter dan team/);
      expect(row.getAttribute('aria-label')).toMatch(
        /beter dan team|rond gemiddelde|slechter dan team/,
      );
      const symbolEl = [...row.querySelectorAll('[aria-hidden="true"]')].find((e) =>
        (e.textContent ?? '').includes(symbol),
      );
      expect(symbolEl).toBeTruthy();
    }
  });

  it('knoppengroepen hebben een toegankelijke naam en aria-pressed', () => {
    const q = renderLineups();
    expect(q.getByRole('group', { name: 'Sorteer' })).toBeTruthy();
    expect(q.getByRole('group', { name: 'Combinatiegrootte' })).toBeTruthy();
    expect(q.getByTestId('trends-combo-size-2').textContent).toBe("Duo's");
    expect(q.getByTestId('trends-combo-size-3').textContent).toBe("Trio's");
  });

  it('Engels: titels, uitleg, consistentie en lege staat', () => {
    const q = renderLineups(fixtureCompleted(), 'en');
    expect(q.getByTestId('trends-combo-card').textContent).toContain('Best and worst pairs/trios');
    expect(q.getByTestId('trends-startclose-card').textContent).toContain(
      'Starting and closing lineup',
    );
    expect(q.getByTestId('trends-lineup-consistency-1-2-3-4-5').textContent).toBe(
      '1 of 2 games positive (small n)',
    );
    fireEvent.click(q.getByTestId('trends-lineup-sort-careful'));
    expect(q.getByTestId('trends-lineup-sort-badge').textContent).toBe('order: careful');
    expect(q.getByTestId('trends-lineup-sort-explain').textContent).toContain(
      'Careful = as if the lineup had played another 10 minutes at an even score',
    );
    expect(q.getByTestId('trends-startclose-explain').textContent).toContain('one segment');
    expect(q.getByTestId('trends-combo-best-1-6').getAttribute('aria-label')).toBe(
      'Pair 1-6: 23:00, +2.2 per 10 minutes, around average',
    );
  });

  it('Engels: lege staat voor paren', () => {
    const q = renderLineups(
      [completed('S', '2026-09-05T10:00:00.000Z', [seg('S1', 1, 700, 0, L1, 10, 8, 0, 14)])],
      'en',
    );
    expect(q.getByTestId('trends-combo-empty').textContent).toBe(
      'Too little data for pairs above 10:00',
    );
  });
});

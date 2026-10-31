// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { TrendsPanel } from '../../src/ui/trends/TrendsPanel';
import type { CompletedGameRepository } from '../../src/application/game/CompletedGameRepository';
import type { CompletedGame, GamePlayer, Segment } from '../../src/domain/game/types';
import type { RosterPlayer } from '../../src/domain/roster/types';
import type { Lang } from '../../src/i18n/strings';
import { chip } from './trendsFilterHelpers';

afterEach(() => cleanup());

// ---- Vaste fixture: docs/pr-trends-lineups-plan.md §F.2 (fictief, narekenbaar) ----
//  Q1: 1200 s, +6 => +3.0/10 (2 wd)   Q2: 600 s, +2 => +2.0/10 (1 wd)
//  Q3: geen segmenten (0 wd)          Q4: 1200 s, +1 => +0.5/10 (2 wd)
//  Team 3000 s, +9 => +1.8/10. Toon op het TEKEN (besluit 2026-10-31): Q1 +3.0 = positief, Q2 +2.0 = positief, Q4 +0.5 = rond 0
//  (grens telt als grijs); het verschil met het team (+1.2 / +0.2 / -1.3) is alleen kleine tekst.
//  Speler 4: Q1 600 s, Q2 210 s, Q3 0 s, Q4 540 s (gemiddeld per gespeelde wedstrijd).

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

const L1 = [1, 2, 3, 4, 5];
const L2 = [1, 2, 3, 4, 6];
const L3 = [1, 2, 3, 6, 7];
const L4 = [1, 2, 3, 5, 7];
const ids = (l: number[]) => l.map((n) => `p${n}`);

function seg(
  id: string,
  quarter: number,
  lineup: number[],
  durSec: number,
  pf: number,
  pa: number,
): Segment {
  return {
    id,
    quarter,
    beginSec: durSec,
    endSec: 0,
    durSec,
    lineup: ids(lineup),
    pf,
    pa,
    classSum: 14,
    allowed: 14,
    over: false,
  };
}

function completed(id: string, date: string, segments: Segment[], quarterCount = 4): CompletedGame {
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
    quarterCount,
    periodLabel: '',
    useClassLimit: false,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
  };
}

function fixture(): CompletedGame[] {
  return [
    completed('B', '2026-09-12T10:00:00.000Z', [
      seg('B1', 1, L1, 300, 6, 4),
      seg('B2', 1, L2, 300, 4, 4),
      seg('B3', 4, L2, 480, 10, 7),
      seg('B4', 4, L4, 120, 2, 0),
    ]),
    completed('A', '2026-09-05T10:00:00.000Z', [
      seg('A1', 1, L1, 600, 10, 6),
      seg('A2', 2, L2, 420, 6, 8),
      seg('A3', 2, L3, 180, 4, 0),
      seg('A4', 4, L1, 600, 8, 12),
    ]),
  ];
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

const roster: RosterPlayer[] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
  id: n,
  nr: String(n),
  naam: `Speler ${n}`,
  kl: '1.0',
  vrouw: false,
  jeugd: false,
}));

function renderQuarters(games: CompletedGame[] = fixture(), lang: Lang = 'nl') {
  return render(
    <TrendsPanel
      lang={lang}
      repository={repoOf(games)}
      activeGame={null}
      roster={roster}
      gameIds={null}
      onGameIdsChange={() => {}}
      initialView="quarters"
    />,
  );
}

type Q = ReturnType<typeof renderQuarters>;
const text = (q: Q, id: string) => q.getByTestId(id).textContent;
const aria = (q: Q, id: string) => q.getByTestId(id).getAttribute('aria-label');
const togglePer10 = (q: Q) => fireEvent.click(chip(q, 'trends-per10-toggle'));

describe('Kwarten: resultaat per kwart (fixture F.2)', () => {
  it('toont totalen (standaard) met minuten, wedstrijden en Voor/Tegen', () => {
    const q = renderQuarters();
    expect(text(q, 'trends-quarters-title')).toBe('Kwarten: +/- totaal');
    expect(text(q, 'trends-quarter-value-1')).toBe('+6');
    expect(text(q, 'trends-quarter-value-2')).toBe('+2');
    expect(text(q, 'trends-quarter-value-4')).toBe('+1');
    expect(text(q, 'trends-quarter-1')).toContain('Kwart 1');
    expect(text(q, 'trends-quarter-1')).toContain('20:00');
    expect(text(q, 'trends-quarter-1')).toContain('2 wedstr.');
    expect(text(q, 'trends-quarter-2')).toContain('10:00');
    expect(text(q, 'trends-quarter-2')).toContain('1 wedstr.');
    expect(text(q, 'trends-quarter-4')).toContain('2 wedstr.');
    expect(text(q, 'trends-quarter-detail-1')).toBe('Voor 20 · Tegen 14 totaal');
    expect(text(q, 'trends-quarter-detail-4')).toBe('Voor 20 · Tegen 19 totaal');
  });

  it('toont per 10 min na de chip, met Voor/Tegen per 10 en teamgemiddelde', () => {
    const q = renderQuarters();
    togglePer10(q);
    expect(text(q, 'trends-quarters-title')).toBe('Kwarten: +/- per 10 min');
    expect(text(q, 'trends-quarter-value-1')).toBe('+3.0');
    expect(text(q, 'trends-quarter-value-2')).toBe('+2.0');
    expect(text(q, 'trends-quarter-value-4')).toBe('+0.5');
    expect(text(q, 'trends-quarter-detail-1')).toBe('Voor 10.0 · Tegen 7.0 per 10 min');
    expect(text(q, 'trends-quarter-detail-2')).toBe('Voor 10.0 · Tegen 8.0 per 10 min');
    expect(text(q, 'trends-quarter-detail-4')).toBe('Voor 10.0 · Tegen 9.5 per 10 min');
    expect(text(q, 'trends-quarters-teamavg')).toContain('+1.8');
  });

  it('toont voor kwart 3 "geen data": geen waarde, geen toon, geen balk', () => {
    const q = renderQuarters();
    const item = q.getByTestId('trends-quarter-3');
    expect(text(q, 'trends-quarter-value-3')).toBe('geen data');
    expect(item.getAttribute('aria-label')).toBe('Kwart 3, geen data');
    expect(item.getAttribute('data-tone')).toBeNull();
    expect(item.textContent).toContain('0:00');
    expect(item.textContent).not.toMatch(/[▲●▼]/);
    expect(item.querySelector('.trends-meter')).toBeNull();
    expect(q.queryByTestId('trends-quarter-tone-3')).toBeNull();
  });

  it('geeft toon met symbool + tekst op het teken van +/- per 10 (|waarde| <= 0.5 = rond 0)', () => {
    const q = renderQuarters();
    expect(q.getByTestId('trends-quarter-1').getAttribute('data-tone')).toBe('good');
    // Oud (relatief aan het team): Q2 was "rond gemiddelde" en Q4 "slechter dan team".
    expect(q.getByTestId('trends-quarter-2').getAttribute('data-tone')).toBe('good');
    expect(q.getByTestId('trends-quarter-4').getAttribute('data-tone')).toBe('flat');
    expect(text(q, 'trends-quarter-tone-1')).toBe('▲ positief · +1.2 per 10 min t.o.v. team');
    expect(text(q, 'trends-quarter-tone-2')).toBe('▲ positief · +0.2 per 10 min t.o.v. team');
    expect(text(q, 'trends-quarter-tone-4')).toBe('● rond 0 · -1.3 per 10 min t.o.v. team');
    // Symbool bij de waarde zelf.
    expect(text(q, 'trends-quarter-1')).toContain('▲');
    expect(text(q, 'trends-quarter-2')).toContain('▲');
    expect(text(q, 'trends-quarter-4')).toContain('●');
  });

  it('heeft per rij een toegankelijke naam (totaal en per 10) en verbergt de balk', () => {
    const q = renderQuarters();
    expect(aria(q, 'trends-quarter-4')).toBe('Kwart 4, 20:00, +1 totaal, rond 0');
    expect(aria(q, 'trends-quarter-1')).toBe('Kwart 1, 20:00, +6 totaal, positief');
    togglePer10(q);
    expect(aria(q, 'trends-quarter-4')).toBe('Kwart 4, 20:00, +0.5 per 10 minuten, rond 0');
    expect(aria(q, 'trends-quarter-2')).toBe('Kwart 2, 10:00, +2.0 per 10 minuten, positief');
    for (const m of q.getByTestId('trends-quarters-list').querySelectorAll('.trends-meter')) {
      expect(m.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('kleur is nooit de enige aanwijzing: elke gewaardeerde rij heeft symbool en toontekst', () => {
    const q = renderQuarters();
    for (const n of [1, 2, 4]) {
      const row = q.getByTestId(`trends-quarter-${n}`);
      expect(row.textContent).toMatch(/[▲●▼]/);
      expect(row.textContent).toMatch(/positief|rond 0|negatief/);
    }
    expect(text(q, 'trends-quarters-legend')).toContain('▲ positief');
  });
});

describe('Kwarten: minuten per kwart per speler', () => {
  it('toont speler 4 als 10:00 / 3:30 / 0:00 / 9:00 (gemiddeld per gespeelde wedstrijd)', () => {
    const q = renderQuarters();
    expect(text(q, 'trends-qmin-4-1')).toBe('10:00');
    expect(text(q, 'trends-qmin-4-2')).toBe('3:30');
    expect(text(q, 'trends-qmin-4-3')).toBe('0:00');
    expect(text(q, 'trends-qmin-4-4')).toBe('9:00');
    expect(text(q, 'trends-qmin-hint')).toContain('per gespeelde wedstrijd');
  });

  it('geeft een speler zonder speeltijd geen rij en zet de cijfers altijd in de cel', () => {
    const q = renderQuarters();
    expect(q.getByTestId('trends-qmin-row-7')).toBeTruthy();
    expect(q.queryByTestId('trends-qmin-row-8')).toBeNull(); // in roster, speelde nooit
    const table = q.getByTestId('trends-qmin-table');
    expect(table.querySelectorAll('tbody tr').length).toBe(7);
    for (const td of table.querySelectorAll('td')) {
      expect(td.textContent).toMatch(/^\d+:\d{2}$/);
    }
  });

  it('heeft een scrollbare, focusbare tabelcontainer met kolomkoppen per kwart', () => {
    const q = renderQuarters();
    const region = q.getByTestId('trends-qmin-scroll');
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.getAttribute('aria-label')).toContain('horizontaal scrollbaar');
    const heads = [...q.getByTestId('trends-qmin-table').querySelectorAll('thead th')].map(
      (th) => th.textContent,
    );
    expect(heads).toEqual(['Speler', 'K1', 'K2', 'K3', 'K4']);
    expect(q.getByTestId('trends-qmin-table').querySelector('abbr')?.getAttribute('title')).toBe(
      'Kwart 1',
    );
  });
});

describe('Kwarten: lege staat en aantal kwarten', () => {
  it('toont een nette lege staat zonder segmenten', () => {
    const q = renderQuarters([completed('E', '2026-09-01T10:00:00.000Z', [])]);
    expect(q.getByTestId('trends-quarters-empty').textContent).toContain('Nog geen kwartdata');
    expect(q.queryByTestId('trends-quarters-list')).toBeNull();
    expect(q.queryByTestId('trends-qmin-table')).toBeNull();
  });

  it('volgt quarterCount = 2: twee rijen en twee kolommen', () => {
    const q = renderQuarters([
      completed(
        'H',
        '2026-09-01T10:00:00.000Z',
        [seg('H1', 1, L1, 900, 12, 8), seg('H2', 2, L1, 900, 6, 10)],
        2,
      ),
    ]);
    expect(q.getByTestId('trends-quarters-list').querySelectorAll('li').length).toBe(2);
    expect(text(q, 'trends-quarter-value-1')).toBe('+4');
    expect(text(q, 'trends-quarter-value-2')).toBe('-4');
    expect(text(q, 'trends-qmin-1-1')).toBe('15:00');
    expect(q.getByTestId('trends-qmin-table').querySelectorAll('thead th').length).toBe(3);
  });

  it('volgt quarterCount = 6: zes rijen, kwarten zonder data tonen "geen data"', () => {
    const q = renderQuarters([
      completed(
        'S',
        '2026-09-01T10:00:00.000Z',
        [seg('S1', 1, L1, 300, 4, 2), seg('S6', 6, L1, 300, 2, 2)],
        6,
      ),
    ]);
    expect(q.getByTestId('trends-quarters-list').querySelectorAll('li').length).toBe(6);
    for (const n of [2, 3, 4, 5]) expect(text(q, `trends-quarter-value-${n}`)).toBe('geen data');
    expect(aria(q, 'trends-quarter-6')).toContain('Kwart 6, 5:00');
    expect(q.getByTestId('trends-qmin-table').querySelectorAll('thead th').length).toBe(7);
  });
});

describe('Kwarten: Engels en tokens', () => {
  it('toont alle nieuwe tekst in het Engels', () => {
    const q = renderQuarters(fixture(), 'en');
    togglePer10(q);
    expect(text(q, 'trends-quarters-title')).toBe('Quarters: +/- per 10 min');
    expect(text(q, 'trends-quarter-1')).toContain('Quarter 1');
    expect(text(q, 'trends-quarter-1')).toContain('2 games');
    expect(text(q, 'trends-quarter-value-3')).toBe('no data');
    expect(aria(q, 'trends-quarter-4')).toBe('Quarter 4, 20:00, +0.5 per 10 minutes, around zero');
    expect(aria(q, 'trends-quarter-3')).toBe('Quarter 3, no data');
    expect(text(q, 'trends-quarter-detail-1')).toBe('For 10.0 · Against 7.0 per 10 min');
    expect(text(q, 'trends-quarter-tone-2')).toBe('▲ positive · +0.2 per 10 min vs team');
    expect(text(q, 'trends-qmin-hint')).toContain('Darker = more minutes');
    expect(
      [...q.getByTestId('trends-qmin-table').querySelectorAll('thead th')].map(
        (x) => x.textContent,
      ),
    ).toEqual(['Player', 'Q1', 'Q2', 'Q3', 'Q4']);
  });

  it('lege staat in het Engels', () => {
    const q = renderQuarters([completed('E', '2026-09-01T10:00:00.000Z', [])], 'en');
    expect(q.getByTestId('trends-quarters-empty').textContent).toContain('No quarter data yet');
  });

  it('gebruikt alleen bestaande tokens en geen losse hex-kleuren in trends-quarters.css', () => {
    const css = readFileSync(resolve(__dirname, '../../src/styles/trends-quarters.css'), 'utf8');
    const tokens = readFileSync(resolve(__dirname, '../../src/styles/tokens.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    for (const m of css.matchAll(/var\((--lt-[a-z0-9-]+)\)/g)) {
      expect(tokens).toContain(`${m[1]}:`);
    }
  });
});

describe('Kwarten: te weinig speeltijd per kwart (§E.6, review-fix M4)', () => {
  // "Deze wedstrijd": Q1 slechts 60 s (+3 => ruw +30,0 per 10), Q2 1200 s (+2).
  const shortFixture = () => [
    completed('Z', '2026-09-20T10:00:00.000Z', [
      seg('z1', 1, L1, 60, 3, 0),
      seg('z2', 2, L2, 1200, 10, 8),
    ]),
  ];

  it('onder de drempel alleen het ruwe totaal: geen per-10-waarde, balk of toon', () => {
    const q = renderQuarters(shortFixture());
    const item = q.getByTestId('trends-quarter-1');
    expect(item.getAttribute('data-tone')).toBeNull();
    expect(item.getAttribute('data-low')).toBe('true');
    expect(text(q, 'trends-quarter-value-1')).toBe('+3 in 1:00');
    expect(text(q, 'trends-quarter-low-1')).toBe('te weinig data');
    expect(item.textContent).not.toMatch(/[▲●▼]/);
    expect(item.textContent).not.toContain('30.0');
    expect(item.querySelector('.trends-meter')).toBeNull();
    expect(q.queryByTestId('trends-quarter-tone-1')).toBeNull();
    expect(q.queryByTestId('trends-quarter-detail-1')).toBeNull();
    expect(item.getAttribute('aria-label')).toBe(
      'Kwart 1, +3 in 1:00, te weinig data, geen oordeel',
    );
    // Ook in de modus per 10 min geen per-10-waarde.
    togglePer10(q);
    expect(text(q, 'trends-quarter-value-1')).toBe('+3 in 1:00');
    expect(item.textContent).not.toContain('30.0');
  });

  it('boven de drempel blijft alles zoals voorheen (Q2: 20:00, waarde, toon)', () => {
    const q = renderQuarters(shortFixture());
    const item = q.getByTestId('trends-quarter-2');
    expect(item.getAttribute('data-tone')).not.toBeNull();
    expect(item.textContent).toMatch(/[▲●▼]/);
    expect(text(q, 'trends-quarter-value-2')).toBe('+2');
  });

  it('met drempel uit (0) krijgt een kort kwart wel een waarde en toon; de grens zelf telt mee', () => {
    const q = renderQuarters(shortFixture());
    const btn = chip(q, 'trends-threshold-btn');
    fireEvent.click(btn); // 5:00 -> 10:00
    fireEvent.click(btn); // -> uit
    expect(q.getByTestId('trends-quarter-1').getAttribute('data-low')).toBeNull();
    expect(q.getByTestId('trends-quarter-1').textContent).toMatch(/[▲●▼]/);
    fireEvent.click(btn); // -> 3:00
    fireEvent.click(btn); // -> 5:00
    const exact = renderQuarters([
      completed('E', '2026-09-21T10:00:00.000Z', [seg('e1', 1, L1, 300, 3, 0)]),
    ]);
    expect(exact.getAllByTestId('trends-quarter-1').pop()!.getAttribute('data-low')).toBeNull();
  });
});

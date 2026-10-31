// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, type RenderResult } from '@testing-library/preact';
import { TrendsPanel } from '../../src/ui/trends/TrendsPanel';
import type { CompletedGameRepository } from '../../src/application/game/CompletedGameRepository';
import type { CompletedGame, GamePlayer, Segment } from '../../src/domain/game/types';
import type { RosterPlayer } from '../../src/domain/roster/types';
import { STRINGS, type Lang } from '../../src/i18n/strings';
import { trendsPlayersEn, trendsPlayersNl } from '../../src/i18n/trendsPlayersStrings';
import { ON_OFF_FLAT_EPS_PER10 } from '../../src/ui/trends/PlayersOnOff';

afterEach(() => cleanup());

// ---- Vaste fixture: docs/pr-trends-lineups-plan.md §F.2 (fictief, narekenbaar) ----

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
  begin = durSec,
  end = 0,
): Segment {
  return {
    id,
    quarter,
    beginSec: begin,
    endSec: end,
    durSec,
    lineup: ids(lineup),
    pf,
    pa,
    classSum: 14,
    allowed: 14,
    over: false,
    tov: 0,
  };
}

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

/** §F.2: segmenten A1..A4 en B1..B4 (let op: B1 en B2 liggen allebei in Q1 met overlappende tijd). */
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

/**
 * Eigen stint-fixture met betrouwbare volgorde (verstreken tijd loopt aan):
 * Q1: 0-180 L1, 180-300 L2 (6 komt voor 5); Q2: 0-120 L1.
 * Speler 1: stints 300 (Q1) en 120 (Q2) -> 2 stints, gem. 210 (3:30), langste 300 (5:00).
 * Speler 5: 180 (Q1) en 120 (Q2) -> 2 stints, gem. 150 (2:30), langste 180 (3:00).
 * Speler 6: 1 stint van 120 (2:00). Speler 7: nooit op het veld.
 */
function stintFixture(): CompletedGame[] {
  return [
    completed('S', '2026-09-20T10:00:00.000Z', [
      seg('S1', 1, L1, 180, 4, 2, 600, 420),
      seg('S2', 1, L2, 120, 2, 2, 420, 300),
      seg('S3', 2, L1, 120, 2, 0, 600, 480),
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

const roster: RosterPlayer[] = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
  id: n,
  nr: String(n),
  naam: `Speler ${n}`,
  kl: '1.0',
  vrouw: false,
  jeugd: false,
}));

function renderPlayers(games: CompletedGame[] = fixture(), lang: Lang = 'nl'): RenderResult {
  return render(
    <TrendsPanel
      lang={lang}
      repository={repoOf(games)}
      activeGame={null}
      roster={roster}
      gameIds={null}
      onGameIdsChange={() => {}}
      initialView="players"
    />,
  );
}

const tid = (q: RenderResult, id: string) => q.getByTestId(id);
const text = (q: RenderResult, id: string) =>
  (q.getByTestId(id).textContent ?? '').replace(/\s+/g, ' ');
const expand = (q: RenderResult, n: number) =>
  fireEvent.click(q.getByTestId(`trends-row-toggle-${n}`));
/** Drempelchip: 5:00 -> 10:00 (cyclus uit, 3:00, 5:00, 10:00). */
const toTenMinutes = (q: RenderResult) => fireEvent.click(q.getByTestId('trends-threshold-btn'));

describe('Spelers: on/off in de compacte rij (drempel 5:00)', () => {
  it('toont per speler een samenvatting met symbool en tekst', () => {
    const q = renderPlayers();
    // Speler 4: af het veld slechts 5:00; de af-kant vraagt minstens 10:00 (besluit I.3), dus
    // "te weinig minuten" zonder toon en zonder per-10-waarde (eerder: judged, ▼ slechter).
    const r4 = tid(q, 'trends-players-row-onoff-4');
    expect(r4.getAttribute('data-kind')).toBe('low');
    expect(r4.getAttribute('data-tone')).toBeNull();
    expect(text(q, 'trends-players-row-onoff-4')).toBe('Op/af: te weinig minuten');
    // Speler 5: op +1.5, af +2.2, verschil -0.7 -> |0.7| < 1.0 -> rond gemiddelde (●)
    expect(text(q, 'trends-players-row-onoff-5')).toContain('Op +1.5 · Af +2.2 per 10');
    expect(tid(q, 'trends-players-row-onoff-5').getAttribute('data-tone')).toBe('flat');
    expect(text(q, 'trends-players-row-onoff-5')).toContain('●');
    expect(text(q, 'trends-players-row-onoff-5')).toContain('rond gemiddelde');
    // Speler 6: op +2.2, af +1.5, verschil +0.7 -> rond gemiddelde
    expect(text(q, 'trends-players-row-onoff-6')).toContain('Op +2.2 · Af +1.5 per 10');
    // Spelers 1-3 speelden alles
    for (const n of [1, 2, 3]) {
      expect(tid(q, `trends-players-row-onoff-${n}`).getAttribute('data-kind')).toBe('all');
      expect(text(q, `trends-players-row-onoff-${n}`)).toBe('Speelde alles');
    }
    // Speler 7: op slechts 5:00 (op de drempel) -> gekwalificeerd, verschil +11.3 -> beter (▲)
    expect(text(q, 'trends-players-row-onoff-7')).toContain('▲');
    expect(tid(q, 'trends-players-row-onoff-7').getAttribute('data-tone')).toBe('good');
  });

  it('gebruikt de epsilon 1.0 per 10 min voor "rond gemiddelde"', () => {
    expect(ON_OFF_FLAT_EPS_PER10).toBe(1.0);
  });
});

describe('Spelers: blok "Op en af het veld"', () => {
  it('toont voor speler 4 bij 5:00 alleen ruwe totalen (af-kant 5:00 < 10:00), geen oordeel', () => {
    const q = renderPlayers();
    expand(q, 4);
    expect(tid(q, 'trends-players-onoff-4').getAttribute('data-kind')).toBe('low');
    expect(text(q, 'trends-players-on-4')).toBe('+3 in 45:00');
    expect(text(q, 'trends-players-off-4')).toBe('+6 in 5:00');
    expect(q.queryByTestId('trends-players-diff-4')).toBeNull();
    expect(tid(q, 'trends-players-onoff-4').textContent).toContain('af minimaal 10:00');
    expect(tid(q, 'trends-players-onoff-4').textContent).toContain('op minimaal 5:00');
  });

  it('toont minuten per kant, waarden per 10 en het verschil (speler 5: beide kanten ver boven de drempel)', () => {
    const q = renderPlayers();
    expand(q, 7);
    // Speler 7: op 5:00 (= on-drempel), af 45:00: gekwalificeerd, verschil +11,3, beter.
    expect(text(q, 'trends-players-on-7')).toBe('+12.0');
    expect(text(q, 'trends-players-off-7')).toBe('+0.7');
    expect(text(q, 'trends-players-off-min-7')).toBe('per 10 min · 45:00');
    expect(text(q, 'trends-players-diff-value-7')).toBe('+11.3');
    const diff = tid(q, 'trends-players-diff-7');
    expect(diff.getAttribute('data-tone')).toBe('good');
    // Symbool + tekst naast de kleur.
    expect(diff.textContent).toContain('▲');
    expect(diff.textContent).toContain('beter');
  });

  it('toont speler 5 als rond gemiddelde met alle waarden', () => {
    const q = renderPlayers();
    expand(q, 5);
    expect(text(q, 'trends-players-on-5')).toBe('+1.5');
    expect(text(q, 'trends-players-on-min-5')).toBe('per 10 min · 27:00');
    expect(text(q, 'trends-players-off-5')).toBe('+2.2');
    expect(text(q, 'trends-players-off-min-5')).toBe('per 10 min · 23:00');
    expect(text(q, 'trends-players-diff-value-5')).toBe('-0.7');
    expect(tid(q, 'trends-players-diff-5').textContent).toContain('●');
    expect(tid(q, 'trends-players-diff-5').textContent).toContain('rond gemiddelde');
  });

  it('toont speler 6 (+0,7) als rond gemiddelde en speler 7 als beter', () => {
    const q = renderPlayers();
    expand(q, 6);
    expect(text(q, 'trends-players-diff-value-6')).toBe('+0.7');
    expand(q, 7);
    expect(text(q, 'trends-players-on-min-7')).toBe('per 10 min · 5:00');
    expect(text(q, 'trends-players-diff-value-7')).toBe('+11.3');
    expect(tid(q, 'trends-players-diff-7').textContent).toContain('▲');
    expect(tid(q, 'trends-players-diff-7').textContent).toContain('beter');
  });

  it('toont "speelde alles" zonder af-waarde voor spelers 1-3', () => {
    const q = renderPlayers();
    for (const n of [1, 2, 3]) {
      expand(q, n);
      expect(tid(q, `trends-players-onoff-${n}`).getAttribute('data-kind')).toBe('all');
      expect(text(q, `trends-players-off-${n}`)).toBe('Speelde alles');
      expect(q.queryByTestId(`trends-players-diff-${n}`)).toBeNull();
      expect(q.queryByTestId(`trends-players-off-min-${n}`)).toBeNull();
      expect(text(q, `trends-players-on-${n}`)).toBe('+1.8');
      expect(text(q, `trends-players-on-min-${n}`)).toBe('per 10 min · 50:00');
    }
  });

  it('is niet gekwalificeerd bij drempel 10:00: speler 4 (af) en 7 (op), geen oordeel en geen per-10-waarde', () => {
    const q = renderPlayers();
    toTenMinutes(q); // 5:00 -> 10:00
    expect(q.getByTestId('trends-threshold-btn').textContent).toContain('10:00');
    for (const n of [4, 7]) {
      expect(tid(q, `trends-players-row-onoff-${n}`).getAttribute('data-kind')).toBe('low');
      expect(text(q, `trends-players-row-onoff-${n}`)).toBe('Op/af: te weinig minuten');
      expect(tid(q, `trends-players-row-onoff-${n}`).getAttribute('data-tone')).toBeNull();
    }
    expand(q, 4);
    const block4 = tid(q, 'trends-players-onoff-4');
    expect(block4.getAttribute('data-kind')).toBe('low');
    expect(block4.textContent).toContain('Te weinig minuten aan één kant');
    expect(block4.textContent).toContain('Op 45:00, af 5:00');
    expect(block4.textContent).toContain('minimaal 10:00');
    // Ruwe totalen, geen waarde per 10 en geen verschil.
    expect(text(q, 'trends-players-on-4')).toBe('+3 in 45:00');
    expect(text(q, 'trends-players-off-4')).toBe('+6 in 5:00');
    expect(q.queryByTestId('trends-players-diff-4')).toBeNull();
    expect(block4.textContent).not.toContain('+12.0');
    expand(q, 7);
    expect(tid(q, 'trends-players-onoff-7').getAttribute('data-kind')).toBe('low');
    expect(text(q, 'trends-players-on-7')).toBe('+6 in 5:00');
    // Spelers met beide kanten >= 10:00 blijven beoordeeld.
    expect(tid(q, 'trends-players-row-onoff-5').getAttribute('data-kind')).toBe('judged');
  });

  it('gebruikt kleur nooit als enige aanwijzing: elke beoordeelde toon heeft symbool en tekst', () => {
    const q = renderPlayers();
    for (const n of [5, 6, 7]) {
      const row = tid(q, `trends-players-row-onoff-${n}`);
      const tone = row.getAttribute('data-tone');
      const symbol = tone === 'good' ? '▲' : tone === 'bad' ? '▼' : '●';
      const word = tone === 'good' ? 'beter' : tone === 'bad' ? 'slechter' : 'rond gemiddelde';
      expect(row.textContent).toContain(symbol);
      expect(row.textContent).toContain(word);
    }
  });

  it('geeft het blok een toegankelijke naam met waarde, minuten en beoordeling', () => {
    const q = renderPlayers();
    expand(q, 7);
    expect(tid(q, 'trends-players-onoff-group-7').getAttribute('aria-label')).toBe(
      'Speler 7: op het veld +12.0 per 10 in 5:00, af het veld +0.7 in 45:00, verschil +11.3, beter',
    );
    expand(q, 4);
    expect(tid(q, 'trends-players-onoff-group-4').getAttribute('aria-label')).toBe(
      'Speler 4: op het veld +3 in 45:00, af het veld +6 in 5:00, te weinig minuten aan één kant, geen oordeel',
    );
    expand(q, 1);
    expect(tid(q, 'trends-players-onoff-group-1').getAttribute('aria-label')).toBe(
      'Speler 1: op het veld +1.8 per 10 in 50:00, speelde alles, geen af-waarde en geen oordeel',
    );
    toTenMinutes(q);
    expect(tid(q, 'trends-players-onoff-group-4').getAttribute('aria-label')).toBe(
      'Speler 4: op het veld +3 in 45:00, af het veld +6 in 5:00, te weinig minuten aan één kant, geen oordeel',
    );
  });

  it('laat de bestaande spelertrendgetallen ongewijzigd', () => {
    const q = renderPlayers();
    expand(q, 4);
    // Speler 4: 2700 s = 45 min over 2 wedstrijden = 22.5 gem.; totaal +/- = +3.
    expect(text(q, 'trends-row-pm-4')).toBe('+3');
    expect(text(q, 'trends-totalpm-4')).toBe('+3');
    expect(text(q, 'trends-avgmin-4')).toBe('22.5');
  });
});

describe('Spelers: blok "Stints"', () => {
  it('toont aantal, gemiddelde en langste stint binnen een kwart', () => {
    const q = renderPlayers(stintFixture());
    expand(q, 1);
    expect(text(q, 'trends-players-stints-count-1')).toBe('2');
    expect(text(q, 'trends-players-stints-avg-1')).toBe('3:30');
    expect(text(q, 'trends-players-stints-longest-1')).toBe('5:00');
    expand(q, 5);
    expect(text(q, 'trends-players-stints-count-5')).toBe('2');
    expect(text(q, 'trends-players-stints-avg-5')).toBe('2:30');
    expect(text(q, 'trends-players-stints-longest-5')).toBe('3:00');
    expand(q, 6);
    expect(text(q, 'trends-players-stints-count-6')).toBe('1');
    expect(text(q, 'trends-players-stints-avg-6')).toBe('2:00');
    expect(text(q, 'trends-players-stints-longest-6')).toBe('2:00');
    expect(tid(q, 'trends-players-stints-1').textContent).toContain(
      'aaneengesloten tijd op het veld binnen één kwart',
    );
    expect(tid(q, 'trends-players-stints-group-1')?.getAttribute('aria-label')).toBe(
      'Speler 1: 2 stints, gemiddeld 3:30, langste 5:00',
    );
  });

  it('toont geen waarschuwing als de volgorde betrouwbaar is', () => {
    const q = renderPlayers(stintFixture());
    expand(q, 1);
    expect(q.queryByTestId('trends-players-stints-warn-1')).toBeNull();
  });

  it('waarschuwt als de volgorde van segmenten onbetrouwbaar is (§F.2: B1 en B2 overlappen)', () => {
    const q = renderPlayers();
    expand(q, 1);
    const warn = tid(q, 'trends-players-stints-warn-1');
    expect(warn.textContent).toContain('volgorde van de segmenten is niet overal betrouwbaar');
  });

  it('toont "geen stints" voor een speler die niet speelde (niet in de selectie)', () => {
    // Speler 7 staat in de snapshot maar speelt niet in de stintfixture: geen on/off-rij en geen kaart.
    const q = renderPlayers(stintFixture());
    expect(q.queryByTestId('trends-card-7')).toBeNull();
  });
});

describe('Spelers: NL en EN', () => {
  it('toont Engelse teksten in de rij, het blok en de aria-label', () => {
    const q = renderPlayers(fixture(), 'en');
    expect(text(q, 'trends-players-row-onoff-7')).toContain('On +12.0 · Off +0.7 per 10');
    expect(text(q, 'trends-players-row-onoff-7')).toContain('better');
    expect(text(q, 'trends-players-row-onoff-4')).toBe('On/off: too few minutes');
    expect(text(q, 'trends-players-row-onoff-1')).toBe('Played all minutes');
    expand(q, 4);
    expect(tid(q, 'trends-players-onoff-4').textContent).toContain('On and off the court');
    expect(tid(q, 'trends-players-onoff-group-4').getAttribute('aria-label')).toBe(
      'Speler 4: on court +3 in 45:00, off court +6 in 5:00, too few minutes on one side, no judgement',
    );
    expect(tid(q, 'trends-players-stints-4').textContent).toContain('Stints');
    expect(tid(q, 'trends-players-stints-warn-4').textContent).toContain('not reliable');
  });

  it('heeft voor elke sleutel een NL- en EN-tekst met dezelfde plaatshouders', () => {
    const nlKeys = Object.keys(trendsPlayersNl).sort();
    expect(Object.keys(trendsPlayersEn).sort()).toEqual(nlKeys);
    const holders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of nlKeys as (keyof typeof trendsPlayersNl)[]) {
      expect(holders(trendsPlayersEn[k])).toEqual(holders(trendsPlayersNl[k]));
      expect(STRINGS.nl[k]).toBe(trendsPlayersNl[k]);
      expect(STRINGS.en[k]).toBe(trendsPlayersEn[k]);
      expect(k.startsWith('trendsPlayers')).toBe(true);
    }
  });
});

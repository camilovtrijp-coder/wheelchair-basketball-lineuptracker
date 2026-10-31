// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { OverviewView } from '../../src/ui/trends/OverviewView';
import { formatDate, type TrendsViewProps } from '../../src/ui/trends/trendsShared';
import { computeLineupInsights } from '../../src/domain/trends/lineupInsights';
import type { AnalysisGame } from '../../src/domain/stats/types';
import type { Lang } from '../../src/i18n/strings';
import { L1, fixtureGames, fixtureRoster, game, seg } from './support/trendsT6T7Fixture';

afterEach(() => cleanup());

// Fixture: docs/pr-trends-lineups-plan.md §F.2 (fictief, narekenbaar).
// Groepen (minSec 300): op de grens A1,A2,A4,B1,B2,B3 = 2700 s, +3, +0,667 per 10 (afgerond +0.7);
// ruimte over: A3 = 180 s, +4 (onder de drempel); over de grens: B4 = 120 s, +2 (onder de drempel).
// Team: +1,8 per 10, dus de groep op de grens (+0,7) is 1,1 slechter dan het team.

function renderOverview(
  opts: {
    games?: AnalysisGame[];
    lang?: Lang;
    gameIds?: Set<string> | null;
    per10?: boolean;
    minSec?: number;
    useClassLimit?: boolean;
  } = {},
) {
  const games = opts.games ?? fixtureGames();
  const gameIds = opts.gameIds ?? null;
  const minSec = opts.minSec ?? 300;
  const props: TrendsViewProps = {
    lang: opts.lang ?? 'nl',
    scope: { games, historyRead: { status: 'ok' } } as unknown as TrendsViewProps['scope'],
    games,
    gameIds,
    per10: opts.per10 ?? true,
    minSec,
    roster: fixtureRoster,
    useClassLimit: opts.useClassLimit ?? true,
    lineups: computeLineupInsights(games, gameIds, { size: 5, minSec, metric: 'pm' }),
  };
  return render(<OverviewView {...props} />);
}

type Q = ReturnType<typeof renderOverview>;
const text = (q: Q, id: string) => q.getByTestId(id).textContent ?? '';
const dateB = formatDate('2026-09-12', 'nl');
const dateA = formatDate('2026-09-05', 'nl');

describe('OverviewView T6 — classificatieprofiel', () => {
  it('toont de drie groepen met de handmatig nagerekende waarden', () => {
    const q = renderOverview();
    expect(q.getByTestId('trends-class-card')).toBeTruthy();

    // op de grens: 45:00, +3 in 2700 s = +0,667 per 10 -> +0.7
    expect(text(q, 'trends-class-time-vol')).toBe('45:00');
    expect(text(q, 'trends-class-value-vol')).toBe('+0.7');
    // team +1,8 per 10: verschil -1,1, dus slechter dan het team (symbool + tekst)
    expect(text(q, 'trends-class-tone-vol')).toBe('▼ slechter dan team');

    // ruimte over: A3, 3:00 onder de drempel van 5:00: geen waarde, geen toon, ruw totaal
    expect(text(q, 'trends-class-time-ruimte')).toBe('3:00');
    expect(text(q, 'trends-class-low-ruimte')).toContain('Te weinig data');
    expect(text(q, 'trends-class-low-ruimte')).toContain('+4 in 3:00, onder de drempel van 5:00');
    expect(q.queryByTestId('trends-class-value-ruimte')).toBeNull();
    expect(q.queryByTestId('trends-class-tone-ruimte')).toBeNull();

    // over de grens: B4, 2:00 onder de drempel
    expect(text(q, 'trends-class-time-over')).toBe('2:00');
    expect(text(q, 'trends-class-low-over')).toContain('+2 in 2:00, onder de drempel van 5:00');
    expect(q.queryByTestId('trends-class-value-over')).toBeNull();
  });

  it('toont de rijen in de volgorde op de grens, ruimte over, over de grens', () => {
    const q = renderOverview();
    const rows = [...q.getByTestId('trends-class-card').querySelectorAll('li')].map((li) =>
      li.getAttribute('data-testid'),
    );
    expect(rows).toEqual([
      'trends-class-row-vol',
      'trends-class-row-ruimte',
      'trends-class-row-over',
    ]);
    expect(q.getByText('Op de grens')).toBeTruthy();
    expect(q.getByText('Ruimte over')).toBeTruthy();
    expect(q.getByText('Over de grens')).toBeTruthy();
  });

  it('toont totalen in plaats van per 10 als "Per 10 min" uit staat', () => {
    const q = renderOverview({ per10: false });
    expect(text(q, 'trends-class-value-vol')).toBe('+3');
  });

  it('laat bij drempel 0 alle groepen een waarde tonen', () => {
    const q = renderOverview({ minSec: 0 });
    expect(q.queryByTestId('trends-class-low-ruimte')).toBeNull();
    expect(q.queryByTestId('trends-class-low-over')).toBeNull();
    // ruimte: +4 in 180 s = 13,33 per 10; over: +2 in 120 s = 10,0 per 10
    expect(text(q, 'trends-class-value-ruimte')).toBe('+13.3');
    expect(text(q, 'trends-class-value-over')).toBe('+10.0');
    // team +1,8: beide ruim beter dan het team
    expect(text(q, 'trends-class-tone-ruimte')).toBe('▲ beter dan team');
    expect(text(q, 'trends-class-tone-over')).toBe('▲ beter dan team');
  });

  it('legt de groepen uit en benoemt dat het beschrijvend is', () => {
    const q = renderOverview();
    expect(text(q, 'trends-class-card')).toContain('0 tot en met 0,5 punt ruimte');
    expect(text(q, 'trends-class-note')).toContain('Beschrijvend, geen oorzaak');
  });

  it('ontbreekt zonder klassegrens (geen lege kaart), ook de tijd over de limiet', () => {
    const q = renderOverview({ useClassLimit: false });
    expect(q.queryByTestId('trends-class-card')).toBeNull();
    expect(q.queryByTestId('trends-overlimit-card')).toBeNull();
    // de bestaande teamkaart blijft staan
    expect(q.getByTestId('trends-team-card')).toBeTruthy();
  });

  it('ontbreekt als geen gekozen wedstrijd de klassegrens gebruikt', () => {
    const noLimit = fixtureGames().map((g) => ({ ...g, useClassLimit: false }));
    const q = renderOverview({ games: noLimit });
    expect(q.queryByTestId('trends-class-card')).toBeNull();
    expect(q.queryByTestId('trends-overlimit-card')).toBeNull();
  });

  it('meldt segmenten met ongeldige klassegegevens zichtbaar', () => {
    const bad = game('X', '2026-09-19', [
      seg('X1', 1, 600, 0, L1, 5, 5, 1, 14),
      seg('X2', 2, 600, 0, L1, 5, 5, 1, Number.NaN),
    ]);
    const q = renderOverview({ games: [bad] });
    expect(text(q, 'trends-class-skipped')).toContain(
      '1 segment met ongeldige of ontbrekende klassegegevens is overgeslagen.',
    );
    const q2 = renderOverview({
      games: [
        game('Y', '2026-09-19', [
          seg('Y1', 1, 600, 0, L1, 5, 5, 1, Number.NaN),
          seg('Y2', 2, 600, 0, L1, 5, 5, 1, Number.NaN),
        ]),
      ],
    });
    expect(q2.getAllByTestId('trends-class-skipped').pop()!.textContent).toContain(
      '2 segmenten met ongeldige of ontbrekende klassegegevens zijn overgeslagen.',
    );
  });

  it('meldt niets over overgeslagen segmenten als alles geldig is', () => {
    expect(renderOverview().queryByTestId('trends-class-skipped')).toBeNull();
  });

  it('laat kleur nooit de enige aanwijzing zijn: symbool en tekst staan in de markup', () => {
    const q = renderOverview({ minSec: 0 });
    for (const bucket of ['vol', 'ruimte', 'over']) {
      const tone = q.getByTestId(`trends-class-tone-${bucket}`);
      expect(tone.textContent).toMatch(/^[▲●▼] (beter|slechter) dan team$|^● rond gemiddelde$/);
      expect(tone.querySelector('[aria-hidden="true"]')?.textContent).toMatch(/^[▲●▼]$/);
    }
    // de tekst zelf draagt de toon ook zonder symbool
    expect(text(q, 'trends-class-tone-vol')).toContain('slechter dan team');
  });
});

describe('OverviewView T6 — tijd over de limiet', () => {
  it('toont minuten en segmenten per wedstrijd en "geen" zonder over-tijd', () => {
    const q = renderOverview();
    expect(text(q, 'trends-overlimit-B')).toContain(dateB);
    expect(text(q, 'trends-overlimit-B')).toContain('2:00 in 1 van 4 segmenten');
    // het waarschuwingssymbool staat naast de tekst (geen kleur als enige aanwijzing)
    expect(text(q, 'trends-overlimit-B')).toContain('⚠');
    expect(text(q, 'trends-overlimit-A')).toContain(dateA);
    expect(text(q, 'trends-overlimit-A')).toContain('geen');
    expect(text(q, 'trends-overlimit-A')).not.toContain('segmenten');
    expect(text(q, 'trends-overlimit-card')).toContain('invoerfout');
    expect(text(q, 'trends-overlimit-card')).toContain('mag regeltechnisch niet');
  });

  it('respecteert het wedstrijdfilter', () => {
    const q = renderOverview({ gameIds: new Set(['A']) });
    expect(q.queryByTestId('trends-overlimit-B')).toBeNull();
    expect(text(q, 'trends-overlimit-A')).toContain('geen');
  });
});

describe('OverviewView T6 — datakwaliteit', () => {
  it('vertaalt de waarschuwingen van de fixture (let op: ook kwart 2 van wedstrijd B)', () => {
    const q = renderOverview();
    const items = q.getAllByTestId('trends-quality-item').map((li) => li.textContent ?? '');
    expect(items).toHaveLength(4);
    expect(items[0]).toContain(`Kwart 2 heeft geen segment in ${dateB}`);
    expect(items[1]).toContain('Kwart 3 heeft in geen enkele wedstrijd een segment.');
    expect(items[2]).toContain(`${dateA} (Tegenstander A): speeltijd 30:00 (minder dan 40:00).`);
    expect(items[3]).toContain(`${dateB} (Tegenstander B): speeltijd 20:00 (minder dan 40:00).`);
    // informatief met pictogram + tekst, onder een kop
    expect(items.every((s) => s.startsWith('ⓘ'))).toBe(true);
    expect(q.getByRole('heading', { name: 'Datakwaliteit' })).toBeTruthy();
    expect(text(q, 'trends-quality')).toContain('Informatief, er wordt niets geblokkeerd');
  });

  it('klapt bij meer dan 3 waarschuwingen in en toont er niet in bij 3 of minder', () => {
    const many = renderOverview();
    const details = many.getByTestId('trends-quality-details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('Toon 4 waarschuwingen');

    cleanup();
    const few = renderOverview({ gameIds: new Set(['A']) });
    expect(few.queryByTestId('trends-quality-details')).toBeNull();
    expect(few.getAllByTestId('trends-quality-item')).toHaveLength(2);
  });

  it('staat er ook zonder klassegrens', () => {
    const q = renderOverview({ useClassLimit: false });
    expect(q.queryByTestId('trends-class-card')).toBeNull();
    expect(q.getByTestId('trends-quality')).toBeTruthy();
    expect(q.getAllByTestId('trends-quality-item')).toHaveLength(4);
  });

  it('vertaalt segmenten van 0 s, ontbrekende turnovers en uitgesloten PARTIAL-segmenten', () => {
    const full = [1, 2, 3, 4].map((n) => seg(`N${n}`, n, 600, 0, L1, 1, 0, undefined, 14));
    const zero = seg('Z1', 1, 300, 300, L1, 0, 0, undefined, 14);
    const partial = seg('P1', 1, 600, 540, ['p1', 'p2', 'p3', 'p4', 'p99'], 0, 0, undefined, 14);
    const q = renderOverview({ games: [game('N', '2026-09-26', [...full, zero, partial])] });
    const items = q.getAllByTestId('trends-quality-item').map((li) => li.textContent ?? '');
    const label = `${formatDate('2026-09-26', 'nl')} (Tegenstander N)`;
    expect(items).toHaveLength(3);
    expect(items[0]).toContain(`1 segment van 0 seconden in ${label}.`);
    expect(items[1]).toContain(`Geen turnovers vastgelegd in ${label}`);
    expect(items[2]).toContain(`1 segment met onbekende spelers is uitgesloten`);
  });

  it('toont geen blok bij een volledige wedstrijd zonder problemen', () => {
    const full = [1, 2, 3, 4].map((n) => seg(`F${n}`, n, 600, 0, L1, 1, 0, 0, 14));
    const q = renderOverview({ games: [game('F', '2026-09-19', full)] });
    expect(q.queryByTestId('trends-quality')).toBeNull();
  });
});

describe('OverviewView T6 — Engels', () => {
  it('vertaalt kaart, over-de-limiet en waarschuwingen', () => {
    const q = renderOverview({ lang: 'en' });
    expect(q.getByRole('heading', { name: 'Classification and result' })).toBeTruthy();
    expect(q.getByText('At the limit')).toBeTruthy();
    expect(q.getByText('Room to spare')).toBeTruthy();
    expect(q.getByText('Over the limit')).toBeTruthy();
    expect(text(q, 'trends-class-tone-vol')).toBe('▼ worse than team');
    expect(text(q, 'trends-class-low-ruimte')).toContain('Too little data');
    expect(text(q, 'trends-class-low-ruimte')).toContain('+4 in 3:00, below the threshold of 5:00');
    expect(text(q, 'trends-class-note')).toContain('Descriptive, not a cause');
    expect(text(q, 'trends-overlimit-B')).toContain('2:00 in 1 of 4 segments');
    expect(text(q, 'trends-overlimit-A')).toContain('none');
    expect(q.getByRole('heading', { name: 'Time over the limit' })).toBeTruthy();
    expect(q.getByRole('heading', { name: 'Data quality' })).toBeTruthy();
    const items = q.getAllByTestId('trends-quality-item').map((li) => li.textContent ?? '');
    expect(items[1]).toContain('Quarter 3 has no segment in any game.');
    expect(items[2]).toContain('playing time 30:00 (less than 40:00).');
    expect(q.getByTestId('trends-quality-details').querySelector('summary')!.textContent).toBe(
      'Show 4 warnings',
    );
  });
});

// @vitest-environment jsdom
// PR 7.7b: lineup van een segment corrigeren in Historie (lokaal, UI).
// Fictieve data, handmatig nagerekend:
// spelers (kl): p1 1.0, p2 2.0, p3 3.0, p4 4.0, p5 4.5, p6 1.5 (reserve), p7 2.5 (reserve),
// p8 doet niet mee. S1 lineup p1-p5 = 14.5, allowed 14.5. Vervang p5 door p6: som 11.0;
// vervang p1 door p7: som 16.0 > 14.5 (te hoog, geen blokkade). Geen bonusspelers.
import { useState } from 'preact/hooks';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { HistoryPanel } from '../../src/ui/game/HistoryPanel';
import { LocalStorageCompletedGameRepository } from '../../src/infrastructure/game/LocalStorageCompletedGameRepository';
import { translate, type Lang } from '../../src/i18n/strings';
import type { ClassificationConfig } from '../../src/domain/game/tracking';
import type { KeyValueStorage } from '../../src/i18n/persistence';
import type { CompletedGame, GamePlayer, Segment } from '../../src/domain/game/types';

afterEach(() => cleanup());

class MemoryStorage implements KeyValueStorage {
  public readonly store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

function player(id: string, nr: string, naam: string, kl: string, participate = true): GamePlayer {
  return {
    id,
    rosterId: Number(nr),
    nr,
    naam,
    kl,
    vrouw: false,
    jeugd: false,
    participate,
    start: false,
  };
}

const CLASSIFICATION: ClassificationConfig = {
  useClassLimit: true,
  classBaseLimit: 14.5,
  maxBonus: 1.5,
  bonusTag1Only: 1,
  bonusTag2Only: 1,
  bonusBoth: 1.5,
};

function fixture(): CompletedGame {
  const seg = (o: Partial<Segment>): Segment => ({
    id: 's1',
    quarter: 1,
    beginSec: 600,
    endSec: 420,
    durSec: 180,
    lineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
    pf: 6,
    pa: 4,
    classSum: 14.5,
    allowed: 14.5,
    over: false,
    tov: 2,
    ...o,
  });
  return {
    id: 'cg-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: 'src-1',
    opponent: 'Fictief Team',
    competition: '',
    date: '2026-01-01T10:00:00.000Z',
    players: [
      player('p1', '4', 'Anna', '1.0'),
      player('p2', '5', 'Bram', '2.0'),
      player('p3', '6', 'Chris', '3.0'),
      player('p4', '7', 'Daan', '4.0'),
      player('p5', '8', 'Eva', '4.5'),
      player('p6', '9', 'Fien', '1.5'),
      player('p7', '10', 'Gijs', '2.5'),
      player('p8', '11', 'Hans', '3.5', false),
    ],
    segments: [
      seg({}),
      seg({
        id: 's2',
        beginSec: 420,
        endSec: 180,
        durSec: 240,
        pf: 8,
        pa: 6,
        tov: 1,
        lineup: ['p1', 'p2', 'p3', 'p4', 'p6'],
        classSum: 11.5,
      }),
    ],
    scoreFor: 14,
    scoreAgainst: 10,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: true,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
  };
}

const flat = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function setup(opts: { lang?: Lang; classification?: ClassificationConfig | null } = {}) {
  const repo = new LocalStorageCompletedGameRepository(new MemoryStorage(), 'org-1', 'team-1');
  repo.add(fixture());
  const saved = vi.fn();
  function Harness() {
    const [games, setGames] = useState<CompletedGame[]>(repo.list());
    return (
      <HistoryPanel
        lang={opts.lang ?? 'nl'}
        games={games}
        teamName="Team"
        openId="cg-1"
        onOpenChange={vi.fn()}
        onDeleteGame={vi.fn()}
        canWrite
        saveError={false}
        onCorrectGame={(corrected) => {
          const ok = repo.update(corrected);
          saved(ok);
          if (ok) setGames(repo.list());
          return ok;
        }}
        correctedBy="uid-1"
        classification={
          opts.classification === null ? undefined : (opts.classification ?? CLASSIFICATION)
        }
      />
    );
  }
  return { ...render(<Harness />), repo, saved };
}

type Q = ReturnType<typeof setup>;

function swap(q: Q, slot: number, toId: string) {
  fireEvent.click(q.getByTestId(`correct-lineup-slot-${slot}`));
  fireEvent.click(q.getByTestId(`correct-lineup-option-${toId}`));
}

describe.each(['nl', 'en'] as const)('HistoryPanel — lineup corrigeren (%s)', (lang) => {
  it('toont de 5 spelers als tegels en alleen overige deelnemers als keuze', () => {
    const q = setup({ lang });
    fireEvent.click(q.getByTestId('history-segment-s1'));
    for (let i = 0; i < 5; i += 1) {
      expect(q.getByTestId(`correct-lineup-slot-${i}`)).toBeTruthy();
    }
    expect(flat(q.getByTestId('correct-lineup-slot-0'))).toBe('4Anna');
    expect(flat(q.getByTestId('correct-lineup-class'))).toContain('14.5 / 14.5');

    fireEvent.click(q.getByTestId('correct-lineup-slot-4'));
    expect(q.getByTestId('correct-lineup-picker')).toBeTruthy();
    expect(q.getByTestId('correct-lineup-option-p6')).toBeTruthy();
    expect(q.getByTestId('correct-lineup-option-p7')).toBeTruthy();
    // Niet-deelnemer en spelers die al in de lineup staan zijn niet kiesbaar.
    expect(q.queryByTestId('correct-lineup-option-p8')).toBeNull();
    expect(q.queryByTestId('correct-lineup-option-p1')).toBeNull();
    expect(q.queryByTestId('correct-lineup-option-p5')).toBeNull();
  });

  it('na het kiezen gaat de focus terug naar de vervangen tegel (keuzelijst heeft een label)', () => {
    const q = setup({ lang });
    fireEvent.click(q.getByTestId('history-segment-s1'));
    fireEvent.click(q.getByTestId('correct-lineup-slot-4'));
    const group = q.getByRole('group');
    expect(group.getAttribute('aria-label')).toContain('#8 Eva');
    q.getByTestId('correct-lineup-option-p6').focus();
    fireEvent.click(q.getByTestId('correct-lineup-option-p6'));
    expect(q.queryByTestId('correct-lineup-picker')).toBeNull();
    expect(document.activeElement).toBe(q.getByTestId('correct-lineup-slot-4'));
  });

  it('speler vervangen: live klassesom, bevestiging vóór/ná, opslaan en logitem', () => {
    const q = setup({ lang });
    fireEvent.click(q.getByTestId('history-segment-s1'));
    swap(q, 4, 'p6');
    expect(flat(q.getByTestId('correct-lineup-slot-4'))).toBe('9Fien');
    // 1.0 + 2.0 + 3.0 + 4.0 + 1.5 = 11.5 (limiet 14.5, geen bonus).
    expect(flat(q.getByTestId('correct-lineup-class'))).toContain('11.5 / 14.5');
    expect(q.queryByRole('alert')).toBeNull();

    fireEvent.click(q.getByTestId('correct-segment-review'));
    expect(flat(q.getByTestId('correct-summary-lineup'))).toContain('#8 Eva');
    expect(flat(q.getByTestId('correct-summary-lineup'))).toContain('#9 Fien');
    expect(flat(q.getByTestId('correct-summary-lineup-note'))).toContain('#9 Fien');
    expect(flat(q.getByTestId('correct-summary-lineup-note'))).toContain('#8 Eva');
    expect(flat(q.getByTestId('correct-summary-class'))).toContain('14.5 / 14.5');
    expect(flat(q.getByTestId('correct-summary-class'))).toContain('11.5 / 14.5');
    // Nog niets opgeslagen.
    expect(q.saved).not.toHaveBeenCalled();

    fireEvent.click(q.getByTestId('correct-segment-confirm'));
    expect(q.queryByTestId('correct-segment-modal')).toBeNull();
    const stored = q.repo.list()[0] as CompletedGame;
    const s1 = stored.segments[0] as Segment;
    expect(s1.lineup).toEqual(['p1', 'p2', 'p3', 'p4', 'p6']);
    expect(s1.classSum).toBe(11.5);
    expect(s1.allowed).toBe(14.5);
    expect(s1.over).toBe(false);
    expect(stored.segments[1]?.lineup).toEqual(['p1', 'p2', 'p3', 'p4', 'p6']);
    expect(stored.revision).toBe(1);
    const entry = stored.corrections?.[0];
    expect(entry?.before.lineup).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(entry?.before.allowed).toBe(14.5);
    expect(entry?.after.lineup).toEqual(['p1', 'p2', 'p3', 'p4', 'p6']);
    expect(entry?.after.allowed).toBe(14.5);
    // Namen komen nooit in het log terecht.
    expect(JSON.stringify(entry)).not.toMatch(/Anna|Eva|Fien/);
    // Logregel in Historie toont rugnummers (UI) voor vóór en ná.
    const log = q.getByTestId('history-corrections');
    expect(flat(log)).toContain(`${translate(lang, 'correctRowLineup')} 4-5-6-7-8`);
    expect(flat(log)).toContain(`${translate(lang, 'correctRowLineup')} 4-5-6-7-9`);
  });

  it('te hoge klassesom waarschuwt maar blokkeert niet', () => {
    const q = setup({ lang });
    fireEvent.click(q.getByTestId('history-segment-s1'));
    swap(q, 0, 'p7');
    // 2.5 + 2.0 + 3.0 + 4.0 + 4.5 = 16.0 > 14.5.
    const cls = q.getByTestId('correct-lineup-class');
    expect(flat(cls)).toContain('16.0 / 14.5');
    expect(flat(cls)).toContain(translate(lang, 'quarterStartOver'));
    expect(cls.getAttribute('role')).toBe('alert');

    fireEvent.click(q.getByTestId('correct-segment-review'));
    expect(q.getByTestId('correct-segment-summary')).toBeTruthy();
    fireEvent.click(q.getByTestId('correct-segment-confirm'));
    const s1 = (q.repo.list()[0] as CompletedGame).segments[0] as Segment;
    expect(s1.classSum).toBe(16);
    expect(s1.over).toBe(true);
  });
});

describe('HistoryPanel — lineup corrigeren: randgevallen', () => {
  it('terugzetten naar de oorspronkelijke spelers telt als geen wijziging', () => {
    const q = setup();
    fireEvent.click(q.getByTestId('history-segment-s1'));
    swap(q, 4, 'p6');
    swap(q, 4, 'p5');
    fireEvent.click(q.getByTestId('correct-segment-review'));
    expect(q.getByTestId('correct-segment-error').textContent).toBe(
      translate('nl', 'correctErrorNoChange'),
    );
    expect(q.saved).not.toHaveBeenCalled();
  });

  it('annuleren na een wissel laat de opslag ongemoeid', () => {
    const q = setup();
    fireEvent.click(q.getByTestId('history-segment-s1'));
    swap(q, 4, 'p6');
    fireEvent.click(q.getByTestId('correct-segment-cancel'));
    expect(q.saved).not.toHaveBeenCalled();
    expect((q.repo.list()[0] as CompletedGame).corrections).toBeUndefined();
  });

  it('zonder klasse-instellingen: foutmelding classification-unavailable bij klassegrens', () => {
    const q = setup({ classification: null });
    fireEvent.click(q.getByTestId('history-segment-s1'));
    swap(q, 4, 'p6');
    fireEvent.click(q.getByTestId('correct-segment-review'));
    expect(q.getByTestId('correct-segment-error').textContent).toBe(
      translate('nl', 'correctErrorClassificationUnavailable'),
    );
    expect(q.saved).not.toHaveBeenCalled();
  });

  it("foutmelding bij 'invalid-lineup' (beschadigd segment met dubbele speler)", () => {
    // Een oud/beschadigd segment met een dubbele speler: na een wissel blijven
    // er maar 4 unieke spelers over, dus het domein weigert met invalid-lineup.
    const repo = new LocalStorageCompletedGameRepository(new MemoryStorage(), 'org-1', 'team-1');
    const game = fixture();
    game.segments[0] = { ...(game.segments[0] as Segment), lineup: ['p1', 'p1', 'p3', 'p4', 'p5'] };
    repo.add(game);
    const saved = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <HistoryPanel
        lang="nl"
        games={repo.list()}
        teamName="Team"
        openId="cg-1"
        onOpenChange={vi.fn()}
        onDeleteGame={vi.fn()}
        canWrite
        saveError={false}
        onCorrectGame={(c) => {
          saved(c);
          return true;
        }}
        classification={CLASSIFICATION}
      />,
    );
    fireEvent.click(getByTestId('history-segment-s1'));
    swap({ getByTestId } as unknown as Q, 4, 'p6');
    fireEvent.click(getByTestId('correct-segment-review'));
    expect(getByTestId('correct-segment-error').textContent).toBe(
      translate('nl', 'correctErrorInvalidLineup'),
    );
    expect(queryByTestId('correct-segment-summary')).toBeNull();
    expect(saved).not.toHaveBeenCalled();
  });

  it('segment met een onbekende speler-id toont een vraagteken en blijft bruikbaar', () => {
    const repo = new LocalStorageCompletedGameRepository(new MemoryStorage(), 'org-1', 'team-1');
    const game = fixture();
    game.players = game.players.filter((p) => p.id !== 'p5');
    repo.add(game);
    const { getByTestId } = render(
      <HistoryPanel
        lang="nl"
        games={repo.list()}
        teamName="Team"
        openId="cg-1"
        onOpenChange={vi.fn()}
        onDeleteGame={vi.fn()}
        canWrite
        saveError={false}
        onCorrectGame={() => true}
        classification={CLASSIFICATION}
      />,
    );
    fireEvent.click(getByTestId('history-segment-s1'));
    expect(flat(getByTestId('correct-lineup-slot-4'))).toBe('?');
  });

  it('wedstrijd zonder klassegrens: geen klasseregel en geen classification nodig', () => {
    const repo = new LocalStorageCompletedGameRepository(new MemoryStorage(), 'org-1', 'team-1');
    const game = fixture();
    game.useClassLimit = false;
    repo.add(game);
    let savedGame: CompletedGame | null = null;
    const { getByTestId, queryByTestId } = render(
      <HistoryPanel
        lang="nl"
        games={repo.list()}
        teamName="Team"
        openId="cg-1"
        onOpenChange={vi.fn()}
        onDeleteGame={vi.fn()}
        canWrite
        saveError={false}
        onCorrectGame={(c) => {
          savedGame = c;
          return true;
        }}
      />,
    );
    fireEvent.click(getByTestId('history-segment-s1'));
    expect(queryByTestId('correct-lineup-class')).toBeNull();
    swap({ getByTestId } as unknown as Q, 4, 'p6');
    fireEvent.click(getByTestId('correct-segment-review'));
    expect(queryByTestId('correct-summary-class')).toBeNull();
    fireEvent.click(getByTestId('correct-segment-confirm'));
    expect((savedGame as CompletedGame | null)?.segments[0]?.lineup).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
      'p6',
    ]);
  });
});

describe('LocalStorageCompletedGameRepository — lineup alleen via het gelogde herspelen', () => {
  it('weigert een ongelogde lineupwijziging, ook met een geldig logitem voor iets anders', () => {
    const repo = new LocalStorageCompletedGameRepository(new MemoryStorage(), 'org-1', 'team-1');
    repo.add(fixture());
    const q = setup();
    fireEvent.click(q.getByTestId('history-segment-s1'));
    swap(q, 4, 'p6');
    fireEvent.click(q.getByTestId('correct-segment-review'));
    fireEvent.click(q.getByTestId('correct-segment-confirm'));
    const corrected = q.repo.list()[0] as CompletedGame;
    // Zelfde correctie, maar met een verzwegen extra wijziging in segment 2.
    const tampered: CompletedGame = {
      ...corrected,
      segments: corrected.segments.map((s) =>
        s.id === 's2' ? { ...s, lineup: ['p1', 'p2', 'p3', 'p4', 'p7'] } : s,
      ),
    };
    expect(repo.update(tampered)).toBe(false);
    expect(repo.update(corrected)).toBe(true);
  });
});

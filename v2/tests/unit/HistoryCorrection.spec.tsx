// @vitest-environment jsdom
// PR 7.5b: correctie van één segment van een afgeronde wedstrijd in Historie
// (lokaal). Fixture = docs/pr-7.5-plan.md §G (fictieve data, handmatig nagerekend):
// S1 10:00 → 7:00 (180 s) pf 6 pa 4 tov 2; S2 7:00 → 3:00 (240 s) pf 8 pa 6 tov 1;
// totaal 14 - 10, 3 TO, 420 s. Correctie S1: eind 5:00 (300 s), pf 9, tov 3 →
// eindscore 17 - 10, 4 TO, 540 s.
import { useState } from 'preact/hooks';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/preact';
import { HistoryPanel } from '../../src/ui/game/HistoryPanel';
import { LocalStorageCompletedGameRepository } from '../../src/infrastructure/game/LocalStorageCompletedGameRepository';
import { CORRECT_ERROR_KEYS } from '../../src/ui/game/CorrectSegmentDialog';
import { STRINGS, translate, type Lang } from '../../src/i18n/strings';
import type { CorrectSegmentError } from '../../src/domain/game/correction';
import type { KeyValueStorage } from '../../src/i18n/persistence';
import type { CompletedGame, Segment } from '../../src/domain/game/types';

afterEach(() => cleanup());

class MemoryStorage implements KeyValueStorage {
  public readonly store = new Map<string, string>();
  public failNextWrite = false;
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('quota exceeded');
    }
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

function seg(o: Partial<Segment>): Segment {
  return {
    id: 's1',
    quarter: 1,
    beginSec: 600,
    endSec: 420,
    durSec: 180,
    lineup: ['p1', 'p2', 'p3', 'p4', 'p5'],
    pf: 6,
    pa: 4,
    classSum: 15,
    allowed: 14.5,
    over: false,
    tov: 2,
    ...o,
  };
}

function fixture(): CompletedGame {
  return {
    id: 'cg-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    sourceGameId: 'src-1',
    opponent: 'Fictief Team',
    competition: '',
    date: '2026-01-01T10:00:00.000Z',
    players: [],
    segments: [
      seg({}),
      seg({ id: 's2', beginSec: 420, endSec: 180, durSec: 240, pf: 8, pa: 6, tov: 1 }),
    ],
    scoreFor: 14,
    scoreAgainst: 10,
    quarterCount: 4,
    periodLabel: '',
    useClassLimit: false,
    revision: 0,
    deletedAt: null,
    deletedBy: null,
  };
}

const flat = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function setup(opts: { lang?: Lang; canWrite?: boolean; withHandler?: boolean } = {}) {
  const storage = new MemoryStorage();
  const repo = new LocalStorageCompletedGameRepository(storage, 'org-1', 'team-1');
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
        canWrite={opts.canWrite ?? true}
        saveError={false}
        onCorrectGame={
          opts.withHandler === false
            ? undefined
            : (corrected) => {
                const ok = repo.update(corrected);
                saved(ok);
                if (ok) setGames(repo.list());
                return ok;
              }
        }
        correctedBy={null}
      />
    );
  }
  return { ...render(<Harness />), repo, storage, saved };
}

type Q = ReturnType<typeof setup>;

function applyFixtureCorrection(q: Q) {
  fireEvent.click(q.getByTestId('history-segment-s1'));
  fireEvent.change(q.getByTestId('correct-end-min'), { target: { value: '5' } });
  fireEvent.change(q.getByTestId('correct-end-sec'), { target: { value: '0' } });
  fireEvent.input(q.getByTestId('correct-pf'), { target: { value: '9' } });
  fireEvent.input(q.getByTestId('correct-tov'), { target: { value: '3' } });
  fireEvent.click(q.getByTestId('correct-segment-review'));
}

describe('HistoryPanel — correctie: bevoegdheid', () => {
  it('canWrite + handler: segmentrijen zijn echte knoppen met label', () => {
    const { getByTestId } = setup();
    const row = getByTestId('history-segment-s1');
    expect(row.tagName).toBe('BUTTON');
    expect(row.getAttribute('type')).toBe('button');
    expect(row.getAttribute('aria-label')).toContain('Segment corrigeren');
    expect(row.getAttribute('aria-label')).toContain('Q1');
    expect(getByTestId('history-correct-hint')).toBeTruthy();
  });

  it('viewer/scorer (canWrite=false): niets aanklikbaar, ook geen dialoog', () => {
    const { getByTestId, queryByTestId, container } = setup({ canWrite: false });
    const row = getByTestId('history-segment-s1');
    expect(row.tagName).toBe('DIV');
    expect(container.querySelectorAll('.history-panel .segment-item button').length).toBe(0);
    fireEvent.click(row);
    expect(queryByTestId('correct-segment-modal')).toBeNull();
    expect(queryByTestId('history-correct-hint')).toBeNull();
  });

  it('zonder handler (cloudmodus tot 7.5c): niets aanklikbaar', () => {
    const { getByTestId } = setup({ withHandler: false });
    expect(getByTestId('history-segment-s1').tagName).toBe('DIV');
  });
});

describe.each([
  ['nl', 'Gecorrigeerd', 'Correcties'],
  ['en', 'Corrected', 'Corrections'],
] as const)('HistoryPanel — correctieflow (%s)', (lang, badge, logTitle) => {
  it('fixture §G: bevestiging toont vóór/ná, opslaan werkt lijst, badge en log bij', () => {
    const q = setup({ lang });
    applyFixtureCorrection(q);

    expect(flat(q.getByTestId('correct-summary-time'))).toContain('10:00 → 7:00 (3:00)');
    expect(flat(q.getByTestId('correct-summary-time'))).toContain('10:00 → 5:00 (5:00)');
    expect(flat(q.getByTestId('correct-summary-score'))).toContain('6 - 4');
    expect(flat(q.getByTestId('correct-summary-score'))).toContain('9 - 4');
    expect(flat(q.getByTestId('correct-summary-final'))).toContain('14 - 10');
    expect(flat(q.getByTestId('correct-summary-final'))).toContain('17 - 10');
    expect(flat(q.getByTestId('correct-summary-total-tov'))).toContain('3');
    expect(flat(q.getByTestId('correct-summary-total-tov'))).toContain('4');
    expect(q.getByTestId('correct-segment-confirm-text').textContent).toBe(
      translate(lang, 'confirmCorrectSegment'),
    );
    // Nog niets opgeslagen vóór bevestiging.
    expect(q.repo.list()[0]?.revision).toBe(0);
    expect(q.queryByTestId('history-corrected-badge')).toBeNull();

    fireEvent.click(q.getByTestId('correct-segment-confirm'));

    expect(q.queryByTestId('correct-segment-modal')).toBeNull();
    expect(flat(q.getByTestId('history-correction-saved'))).toBe(
      translate(lang, 'correctionSaved'),
    );
    const stored = q.repo.list()[0] as CompletedGame;
    expect(stored.scoreFor).toBe(17);
    expect(stored.scoreAgainst).toBe(10);
    expect(stored.revision).toBe(1);
    expect(stored.segments[0]?.durSec).toBe(300);
    expect(stored.corrections?.length).toBe(1);
    // Lijst ververst: score, totaal TO (4), speeltijd 540 s.
    expect(q.container.textContent).toContain('17 - 10');
    expect(flat(q.getByTestId('history-turnovers-total'))).toContain('4');
    expect(flat(q.getByTestId('history-corrected-badge'))).toBe(badge);
    const log = q.getByTestId('history-corrections');
    expect(flat(log.querySelector('summary'))).toBe(`${logTitle} (1)`);
    const entry = within(log).getByTestId(`history-correction-${stored.corrections?.[0]?.id}`);
    expect(flat(entry)).toContain('Q1 · 10:00 → 7:00 · 6-4 · TO 2');
    expect(flat(entry)).toContain('Q1 · 10:00 → 5:00 · 9-4 · TO 3');
  });

  it('annuleren (sluiten, annuleren en terug) laat de opslag ongemoeid', () => {
    const q = setup({ lang });
    const before = JSON.stringify([...q.storage.store]);
    fireEvent.click(q.getByTestId('history-segment-s1'));
    fireEvent.input(q.getByTestId('correct-pf'), { target: { value: '12' } });
    fireEvent.click(q.getByTestId('correct-segment-cancel'));
    expect(q.queryByTestId('correct-segment-modal')).toBeNull();

    applyFixtureCorrection(q);
    fireEvent.click(q.getByTestId('correct-segment-back'));
    fireEvent.click(q.getByTestId('correct-segment-close'));
    expect(q.queryByTestId('correct-segment-modal')).toBeNull();

    expect(JSON.stringify([...q.storage.store])).toBe(before);
    expect(q.saved).not.toHaveBeenCalled();
    expect(q.queryByTestId('history-corrected-badge')).toBeNull();
    expect(q.queryByTestId('history-corrections')).toBeNull();
  });

  it('foutpad: duur 0 toont de eigen foutmelding en slaat niets op', () => {
    const q = setup({ lang });
    fireEvent.click(q.getByTestId('history-segment-s1'));
    fireEvent.change(q.getByTestId('correct-end-min'), { target: { value: '10' } });
    fireEvent.change(q.getByTestId('correct-end-sec'), { target: { value: '0' } });
    fireEvent.click(q.getByTestId('correct-segment-review'));
    expect(q.getByTestId('correct-segment-error').textContent).toBe(
      translate(lang, 'correctErrorInvalidDuration'),
    );
    expect(q.queryByTestId('correct-segment-summary')).toBeNull();
    expect(q.saved).not.toHaveBeenCalled();
  });

  it('foutpad: geen wijziging, negatieve turnovers en lege score worden geweigerd', () => {
    const q = setup({ lang });
    fireEvent.click(q.getByTestId('history-segment-s1'));
    fireEvent.click(q.getByTestId('correct-segment-review'));
    expect(q.getByTestId('correct-segment-error').textContent).toBe(
      translate(lang, 'correctErrorNoChange'),
    );
    fireEvent.input(q.getByTestId('correct-tov'), { target: { value: '-1' } });
    fireEvent.click(q.getByTestId('correct-segment-review'));
    expect(q.getByTestId('correct-segment-error').textContent).toBe(
      translate(lang, 'correctErrorInvalidTurnovers'),
    );
    fireEvent.input(q.getByTestId('correct-tov'), { target: { value: '2' } });
    fireEvent.input(q.getByTestId('correct-pf'), { target: { value: '' } });
    fireEvent.click(q.getByTestId('correct-segment-review'));
    expect(q.getByTestId('correct-segment-error').textContent).toBe(
      translate(lang, 'correctErrorInvalidScore'),
    );
  });

  it('opslaan mislukt (repository.update = false): foutmelding, dialoog en data blijven', () => {
    const q = setup({ lang });
    applyFixtureCorrection(q);
    q.storage.failNextWrite = true;
    fireEvent.click(q.getByTestId('correct-segment-confirm'));
    expect(q.saved).toHaveBeenCalledWith(false);
    expect(q.getByTestId('correct-segment-save-error').textContent).toBe(
      translate(lang, 'gameSaveError'),
    );
    expect(q.getByTestId('correct-segment-modal')).toBeTruthy();
    expect(q.queryByTestId('history-correction-saved')).toBeNull();
    const stored = q.repo.list()[0] as CompletedGame;
    expect(stored.scoreFor).toBe(14);
    expect(stored.corrections).toBeUndefined();
  });
});

describe('HistoryPanel — correctie: toegankelijkheid en teksten', () => {
  it('dialoog: role=dialog met naam, gelabelde velden, focus binnen de dialoog', () => {
    const q = setup();
    fireEvent.click(q.getByTestId('history-segment-s1'));
    const dialog = q.getByRole('dialog', { name: 'Segment corrigeren' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(within(dialog).getByLabelText('Punten voor')).toBeTruthy();
    expect(within(dialog).getByLabelText('Punten tegen')).toBeTruthy();
    expect(within(dialog).getByLabelText('Turnovers')).toBeTruthy();
    expect(within(dialog).getByLabelText('Begin minuten')).toBeTruthy();
    expect(within(dialog).getByLabelText('Eind seconden')).toBeTruthy();
    // Geen lineup-selectie.
    expect(dialog.querySelector('[data-testid^="edit-lineup-"]')).toBeNull();
  });

  it('elke CorrectSegmentError heeft een eigen NL- en EN-sleutel', () => {
    const errors: CorrectSegmentError[] = [
      'game-deleted',
      'unknown-segment',
      'no-change',
      'log-full',
      'invalid-quarter',
      'invalid-time',
      'invalid-duration',
      'invalid-score',
      'invalid-turnovers',
    ];
    const keys = errors.map((e) => CORRECT_ERROR_KEYS[e]);
    expect(new Set(keys).size).toBe(errors.length);
    for (const k of keys) {
      expect(STRINGS.nl[k]).toBeTruthy();
      expect(STRINGS.en[k]).toBeTruthy();
      expect(STRINGS.nl[k]).not.toBe(STRINGS.en[k]);
    }
  });

  it('wedstrijd zonder correcties toont geen badge en geen Correcties-lijst', () => {
    const q = setup();
    expect(q.queryByTestId('history-corrected-badge')).toBeNull();
    expect(q.queryByTestId('history-corrections')).toBeNull();
  });
});

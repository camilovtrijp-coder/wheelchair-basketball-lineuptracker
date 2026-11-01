// @vitest-environment jsdom
// Compact wedstrijdscherm C3: segmentoverzicht, segmenteditor (bewerken/verwijderen op
// segment-ID), afrondkeuze bij open punten/turnovers (Compact en Klassiek) en afronden met
// het laatste segment. Rekenvoorbeelden A-F en H uit docs/wedstrijdscherm-compact-bouwplan.md
// (fictieve spelers; alles handmatig na te rekenen).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { useState } from 'preact/hooks';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { CompactLivePanel } from '../../src/ui/game/CompactLivePanel';
import { CompactSegmentEditor } from '../../src/ui/game/CompactSegmentEditor';
import { LiveTrackingPanel } from '../../src/ui/game/LiveTrackingPanel';
import {
  closeQuarter,
  confirmSwap,
  commitSegment,
  editSegment,
  openSegmentSummary,
  segmentScoreBounds,
} from '../../src/domain/game/liveCommands';
import { finishGame } from '../../src/domain/game/finish';
import {
  deriveGameHistory,
  scoreDeltaAction,
  segmentDeletedAction,
  segmentTurnovers,
  swapOnCourt,
  turnoverDeltaAction,
  type ClassificationConfig,
} from '../../src/domain/game/tracking';
import type { ActiveGame, GamePlayer } from '../../src/domain/game/types';
import type { Lang } from '../../src/i18n/strings';

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ROSTER: Array<[number, string]> = [
  [4, 'Alex'],
  [7, 'Sam'],
  [9, 'Robin'],
  [11, 'Kim'],
  [13, 'Dani'],
  [6, 'Bo'],
  [12, 'Noa'],
  [15, 'Jules'],
];

function player([nr, naam]: [number, string]): GamePlayer {
  return {
    id: `gp-${nr}`,
    rosterId: nr,
    nr: String(nr),
    naam,
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: [4, 7, 9, 11, 13].includes(nr),
  };
}

const CLASSIFICATION: ClassificationConfig = {
  useClassLimit: false,
  classBaseLimit: 14.5,
  maxBonus: 2.5,
  bonusTag1Only: 1.5,
  bonusTag2Only: 1,
  bonusBoth: 2,
};

function q1Game(): ActiveGame {
  return {
    id: 'game-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players: ROSTER.map(player),
    opponent: 'Tegen',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: ['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13'],
    curQuarter: 1,
    beginSec: 600,
    endSec: 600,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
  };
}

function must(result: { ok: true; game: ActiveGame } | { ok: false; error: string }): ActiveGame {
  if (!result.ok) throw new Error(result.error);
  return result.game;
}

const withActions = (g: ActiveGame, ...a: ActiveGame['actions']): ActiveGame => ({
  ...g,
  actions: [...g.actions, ...a],
});

/**
 * Stappen A-D (bouwplan): Q1 aftellend 10:00; 2 TO, 6:30 stand 8-6, wissel 7->12;
 * 1 TO, 3:00 stand 12-10, wissel 4->6 en 11->15 samen; kwart sluiten op 0:00 stand 16-12.
 * Segmenten 210/210/180 s, totaal +4, TO 3; Q2 klaar op 10:00.
 */
function afterAtoD(): ActiveGame {
  let g = q1Game();
  g = withActions(g, turnoverDeltaAction(1), turnoverDeltaAction(1));
  const start = g.onCourt;
  g = must(
    confirmSwap(
      { ...g, onCourt: swapOnCourt(start, 'gp-7', 'gp-12'), pendingSwapLineup: start },
      { endSec: 390, scoreFor: 8, scoreAgainst: 6, classification: CLASSIFICATION },
    ),
  );
  g = withActions(g, turnoverDeltaAction(1));
  const second = g.onCourt;
  const third = swapOnCourt(swapOnCourt(second, 'gp-4', 'gp-6'), 'gp-11', 'gp-15');
  g = must(
    confirmSwap(
      { ...g, onCourt: third, pendingSwapLineup: second },
      { endSec: 180, scoreFor: 12, scoreAgainst: 10, classification: CLASSIFICATION },
    ),
  );
  return must(
    closeQuarter(g, {
      endSec: 0,
      scoreFor: 16,
      scoreAgainst: 12,
      nextQuarter: 2,
      quarterCount: 4,
      classification: CLASSIFICATION,
    }),
  );
}

/** Stap E-uitgangspunt: Q2 open met 2 eigen punten en 1 TO. */
function withOpenQ2(): ActiveGame {
  return withActions(afterAtoD(), scoreDeltaAction('for', 2), turnoverDeltaAction(1));
}

interface SetupOptions {
  game?: ActiveGame;
  lang?: Lang;
  canWrite?: boolean;
  panel?: 'compact' | 'classic';
  classification?: ClassificationConfig;
}

function setup(opts: SetupOptions = {}) {
  const initial = opts.game ?? afterAtoD();
  let latest: ActiveGame = initial;
  const onChange = vi.fn((g: ActiveGame) => {
    latest = g;
  });
  const onFinishGame = vi.fn();
  const Panel = opts.panel === 'classic' ? LiveTrackingPanel : CompactLivePanel;
  function Harness() {
    const [game, setGame] = useState<ActiveGame>(initial);
    return (
      <Panel
        lang={opts.lang ?? 'nl'}
        game={game}
        quarterCount={4}
        periodLabel="Kwart"
        classification={opts.classification ?? CLASSIFICATION}
        teamName="Eigen"
        tag1Label=""
        tag2Label=""
        onGameChange={(next) => {
          setGame(next);
          onChange(next);
        }}
        onFinishGame={onFinishGame}
        canWrite={opts.canWrite ?? true}
        saveError={false}
      />
    );
  }
  const utils = render(<Harness />);
  const $ = (id: string) => utils.getByTestId(id);
  const q = (id: string) => utils.queryByTestId(id);
  const click = (id: string) => fireEvent.click($(id));
  const type = (id: string, value: string) => fireEvent.input($(id), { target: { value } });
  return { ...utils, $, q, click, type, onChange, onFinishGame, latest: () => latest, initial };
}

type H = ReturnType<typeof setup>;
const text = (el: Element) => el.textContent ?? '';
const nrs = (g: ActiveGame, ids: string[]) =>
  ids.map((id) => g.players.find((p) => p.id === id)?.nr);

function openEditor(h: H, index: number) {
  if (!h.q('compact-segments-body')) h.click('compact-segments-toggle');
  const id = deriveGameHistory(h.latest()).segments[index]!.id;
  h.click(`compact-segment-edit-${id}`);
  return id;
}

describe('Compact segmentoverzicht', () => {
  it('is standaard ingeklapt, klapt open en toont per segment kwart, tijden, duur, lineup, stand, punten, plus/min en TO', () => {
    const h = setup();
    const toggle = h.$('compact-segments-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(text(toggle)).toContain('Segmenten (3)');
    expect(h.q('compact-segments-body')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    const segs = deriveGameHistory(h.latest()).segments;
    const [s1, s2, s3] = segs as [(typeof segs)[0], (typeof segs)[0], (typeof segs)[0]];
    expect(text(h.$(`compact-segment-when-${s1.id}`))).toBe('Kwart 1 · 10:00 → 6:30');
    expect(text(h.$(`compact-segment-dur-${s1.id}`))).toBe('3:30');
    expect(text(h.$(`compact-segment-lineup-${s1.id}`))).toBe(
      '#4 Alex · #7 Sam · #9 Robin · #11 Kim · #13 Dani',
    );
    expect(text(h.$(`compact-segment-stats-${s1.id}`))).toBe(
      'Stand 0–0 → 8–6Punten 8–6Plus/min +2TO 2',
    );
    // Begin- en eindstand zijn de cumulatieve som in arrayvolgorde.
    expect(text(h.$(`compact-segment-stats-${s2.id}`))).toBe(
      'Stand 8–6 → 12–10Punten 4–4Plus/min 0TO 1',
    );
    expect(text(h.$(`compact-segment-when-${s2.id}`))).toBe('Kwart 1 · 6:30 → 3:00');
    expect(text(h.$(`compact-segment-lineup-${s2.id}`))).toContain('#12 Noa');
    expect(text(h.$(`compact-segment-stats-${s3.id}`))).toBe(
      'Stand 12–10 → 16–12Punten 4–2Plus/min +2TO 0',
    );
    expect(text(h.$(`compact-segment-dur-${s3.id}`))).toBe('3:00');
    expect(
      segmentScoreBounds(segs).map((b) => [b.beginFor, b.beginAgainst, b.endFor, b.endAgainst]),
    ).toEqual([
      [0, 0, 8, 6],
      [8, 6, 12, 10],
      [12, 10, 16, 12],
    ]);
  });

  it('zet de knop Bewerken op de kopregel direct naast kwart en tijden, met bruikbaar label', () => {
    const h = setup();
    h.click('compact-segments-toggle');
    const s1 = deriveGameHistory(h.latest()).segments[0]!;
    const edit = h.$(`compact-segment-edit-${s1.id}`);
    const when = h.$(`compact-segment-when-${s1.id}`);
    expect(edit.parentElement).toBe(when.parentElement);
    expect(edit.parentElement?.className).toContain('compact-seg__head');
    expect(when.nextElementSibling).toBe(edit);
    expect(text(edit)).toBe('Bewerken');
    expect(edit.getAttribute('aria-label')).toBe('Bewerken: segment 1, Kwart 1, 10:00 – 6:30');
  });

  it('toont een lege toestand zonder segmenten', () => {
    const h = setup({ game: q1Game() });
    h.click('compact-segments-toggle');
    expect(text(h.$('compact-segments-empty'))).toBe('Nog geen segmenten vastgelegd.');
  });
});

describe('Compact segmenteditor: stap E (bewerken)', () => {
  it('E: open Q2 +2 punten en 1 TO; eerste segment naar 9-6 met TO 3 geeft totaal 19-12, TO 5; open delta en TO blijven', () => {
    const before = withOpenQ2();
    const bh = deriveGameHistory(before);
    expect([bh.scoreFor, bh.scoreAgainst, bh.turnovers]).toEqual([18, 12, 4]);
    const h = setup({ game: before });
    const id = openEditor(h, 0);
    expect(text(h.$('compact-edit-start'))).toBe('Beginstand van dit segment: 0–0');
    expect((h.$('compact-edit-pf') as HTMLInputElement).value).toBe('8');
    expect((h.$('compact-edit-tov') as HTMLInputElement).value).toBe('2');
    h.type('compact-edit-pf', '9');
    h.type('compact-edit-tov', '3');
    h.click('compact-edit-save');

    const g = h.latest();
    const hist = deriveGameHistory(g);
    expect([hist.scoreFor, hist.scoreAgainst, hist.turnovers]).toEqual([19, 12, 5]);
    // Open delta (+2 eigen punten) en open turnover (1) blijven behouden.
    expect([hist.scoreFor - hist.segStartFor, hist.scoreAgainst - hist.segStartAgainst]).toEqual([
      2, 0,
    ]);
    expect(hist.turnovers - hist.segStartTurnovers).toBe(1);
    expect(openSegmentSummary(g)).toMatchObject({ pointsFor: 2, pointsAgainst: 0, turnovers: 1 });
    const edited = hist.segments[0]!;
    expect(edited.id).toBe(id);
    expect([edited.pf, edited.pa, segmentTurnovers(edited)]).toEqual([9, 6, 3]);
    // Tijdgrenzen van andere segmenten, actuele lineup en klok ongewijzigd.
    const old = deriveGameHistory(before).segments;
    expect(hist.segments.slice(1)).toEqual(old.slice(1));
    expect([edited.beginSec, edited.endSec, edited.lineup]).toEqual([
      old[0]!.beginSec,
      old[0]!.endSec,
      old[0]!.lineup,
    ]);
    expect(g.onCourt).toEqual(before.onCourt);
    expect([g.beginSec, g.endSec, g.curQuarter]).toEqual([600, 600, 2]);
    // Eén nieuwe segment-edited-actie; editor gesloten.
    expect(h.onChange).toHaveBeenCalledTimes(1);
    expect(g.actions.length).toBe(before.actions.length + 1);
    expect(g.actions.at(-1)?.type).toBe('segment-edited');
    expect(h.q('compact-edit-dialog')).toBeNull();
  });

  it('bewerkt kwart, tijden en lineup op segment-ID, ook als er daarna een ander segment bij komt', () => {
    const h = setup();
    const id = openEditor(h, 1);
    fireEvent.change(h.$('compact-edit-quarter'), { target: { value: '2' } });
    h.type('compact-edit-begin-min', '6');
    h.type('compact-edit-begin-sec', '30');
    h.type('compact-edit-end-min', '3');
    h.type('compact-edit-end-sec', '10');
    h.click('compact-edit-player-gp-12'); // Noa eruit
    expect(text(h.$('compact-edit-lineup-count'))).toContain('4/5');
    h.click('compact-edit-player-gp-7'); // Sam erin
    h.click('compact-edit-save');
    const seg = deriveGameHistory(h.latest()).segments.find((s) => s.id === id)!;
    expect([seg.quarter, seg.beginSec, seg.endSec, seg.durSec]).toEqual([2, 390, 190, 200]);
    expect(nrs(h.latest(), seg.lineup).sort()).toEqual(['11', '13', '4', '7', '9'].sort());
    expect(deriveGameHistory(h.latest()).segments).toHaveLength(3);
  });
});

describe('Compact segmenteditor: stap F (verwijderen)', () => {
  it('F: eerste segment verwijderen na bevestiging geeft totaal 8-6, +2, TO 1; resterende tijden en lineups ongewijzigd', () => {
    const before = afterAtoD();
    const old = deriveGameHistory(before).segments;
    const h = setup({ game: before });
    const id = openEditor(h, 0);
    h.click('compact-edit-delete');
    // Bevestiging vraagt eerst; er is nog niets gewijzigd.
    expect(h.q('compact-edit-delete-confirm')).not.toBeNull();
    expect(text(h.$('compact-edit-delete-confirm'))).toContain('Dit segment verwijderen?');
    expect(h.onChange).not.toHaveBeenCalled();
    h.click('compact-edit-delete-confirm-btn');

    const g = h.latest();
    const hist = deriveGameHistory(g);
    expect(hist.segments.map((s) => s.id)).not.toContain(id);
    expect(hist.segments).toEqual(old.slice(1));
    expect([hist.scoreFor, hist.scoreAgainst]).toEqual([8, 6]);
    expect(hist.scoreFor - hist.scoreAgainst).toBe(2);
    expect(hist.turnovers).toBe(1);
    expect(hist.segments.map((s) => s.durSec)).toEqual([210, 180]);
    expect(g.onCourt).toEqual(before.onCourt);
    expect(g.actions.at(-1)?.type).toBe('segment-deleted');
    expect(h.onChange).toHaveBeenCalledTimes(1);
    expect(h.q('compact-edit-dialog')).toBeNull();
  });

  it('annuleren van de verwijderbevestiging laat alles ongewijzigd', () => {
    const h = setup();
    openEditor(h, 0);
    h.click('compact-edit-delete');
    h.click('compact-edit-delete-cancel');
    expect(h.q('compact-edit-delete-confirm')).toBeNull();
    expect(h.q('compact-edit-dialog')).not.toBeNull();
    expect(h.onChange).not.toHaveBeenCalled();
  });
});

describe('Compact segmenteditor: weigeringen en classificatie', () => {
  function expectRefusal(h: H, message: string) {
    const alert = h.$('compact-edit-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(text(alert)).toContain(message);
    expect(h.onChange).not.toHaveBeenCalled();
    expect(h.q('compact-edit-dialog')).not.toBeNull();
  }

  it('weigert punten boven 150, ongeldige tijd, minder dan vijf spelers en eind niet na begin', () => {
    const h = setup();
    openEditor(h, 0);
    h.type('compact-edit-pf', '151');
    h.click('compact-edit-save');
    expectRefusal(h, 'De score is ongeldig');
    h.type('compact-edit-pf', '8');

    h.type('compact-edit-end-min', '10');
    h.type('compact-edit-end-sec', '30');
    h.click('compact-edit-save');
    expectRefusal(h, 'Begin- of eindtijd is ongeldig');
    h.type('compact-edit-end-min', '6');
    h.type('compact-edit-end-sec', '30');

    h.click('compact-edit-player-gp-4');
    h.click('compact-edit-save');
    expectRefusal(h, 'precies 5 spelers');
    h.click('compact-edit-player-gp-4');

    h.type('compact-edit-end-min', '10');
    h.type('compact-edit-end-sec', '00');
    h.click('compact-edit-save');
    expectRefusal(h, 'Eind moet ná begin liggen');
  });

  it('weigert een bewerking die de totale stand boven 150 brengt, en negatieve punten op domeinniveau', () => {
    const g = afterAtoD();
    const id = deriveGameHistory(g).segments[0]!.id;
    const draft = (pf: number) => ({
      quarter: 1,
      beginSec: 600,
      endSec: 390,
      lineup: g.onCourt,
      pf,
      pa: 6,
      tov: 2,
    });
    expect(editSegment(g, id, draft(-1), CLASSIFICATION)).toEqual({
      ok: false,
      error: 'invalid-score',
    });
    expect(editSegment(g, id, draft(151), CLASSIFICATION)).toEqual({
      ok: false,
      error: 'invalid-score',
    });
    // 16 totaal + (150 - 8) = 158 > 150
    expect(editSegment(g, id, draft(150), CLASSIFICATION)).toEqual({
      ok: false,
      error: 'invalid-score',
    });
  });

  it('toont de Engelse weigermelding', () => {
    const h = setup({ lang: 'en' });
    openEditor(h, 0);
    h.type('compact-edit-pf', '151');
    h.click('compact-edit-save');
    expectRefusal(h, 'The score is invalid');
    expect(text(h.$('compact-edit-dialog'))).toContain('Edit segment');
    expect(text(h.$('compact-edit-start'))).toBe('Starting score of this segment: 0–0');
  });

  it('toont een classificatiewaarschuwing in de editor en markeert het opgeslagen segment', () => {
    const limited = { ...CLASSIFICATION, useClassLimit: true };
    // 5 x 3.0 = 15.0 > 14.5
    const h = setup({ classification: limited });
    openEditor(h, 0);
    const warning = h.$('compact-edit-class-warning');
    expect(warning.getAttribute('role')).toBe('alert');
    expect(text(warning)).toContain('overschrijdt de classificatiegrens');
    h.click('compact-edit-save');
    const seg = deriveGameHistory(h.latest()).segments[0]!;
    expect(seg.over).toBe(true);
    expect(h.q('compact-edit-dialog')).toBeNull();
    expect(text(h.$(`compact-segment-lineup-${seg.id}`))).toContain('⚠');
  });

  it('meldt een segment dat intussen verdwenen is en wijzigt dan niets', () => {
    const g = afterAtoD();
    const id = deriveGameHistory(g).segments[0]!.id;
    const onCommit = vi.fn();
    const props = {
      lang: 'nl' as Lang,
      segmentId: id,
      quarterCount: 4,
      periodLabel: 'Kwart',
      classification: CLASSIFICATION,
      teamName: 'Eigen',
      tag1Label: '',
      tag2Label: '',
      canWrite: true,
      onCommit,
      onClose: vi.fn(),
    };
    const view = render(<CompactSegmentEditor {...props} game={g} />);
    expect(view.queryByTestId('compact-edit-save')).not.toBeNull();
    view.rerender(
      <CompactSegmentEditor
        {...props}
        game={{ ...g, actions: [...g.actions, segmentDeletedAction(id)] }}
      />,
    );
    expect(text(view.getByTestId('compact-edit-error'))).toBe(
      'Dit segment bestaat niet meer in deze wedstrijd.',
    );
    expect(view.queryByTestId('compact-edit-save')).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('Compact afronden: waarschuwing en keuzes', () => {
  it('is bereikbaar terwijl het overzicht is ingeklapt', () => {
    const h = setup({ game: withOpenQ2() });
    expect(h.q('compact-segments-body')).toBeNull();
    h.click('compact-finish-game');
    expect(h.q('finish-dialog')).not.toBeNull();
  });

  it('waarschuwt met open punten en open turnovers en laat annuleren zonder iets te wijzigen', () => {
    const h = setup({ game: withOpenQ2() });
    h.click('compact-finish-game');
    const warning = h.$('finish-open-warning');
    expect(warning.getAttribute('role')).toBe('alert');
    expect(text(h.$('finish-open-points'))).toBe('Punten buiten een segment: 2–0');
    expect(text(h.$('finish-open-turnovers'))).toBe('Turnovers buiten een segment: 1');
    h.click('finish-cancel');
    expect(h.q('finish-dialog')).toBeNull();
    expect(h.onChange).not.toHaveBeenCalled();
    expect(h.onFinishGame).not.toHaveBeenCalled();
  });

  it('toont alleen de open turnovers als er geen open punten zijn, en alleen punten als er geen turnovers zijn', () => {
    const onlyTo = setup({ game: withActions(afterAtoD(), turnoverDeltaAction(1)) });
    onlyTo.click('compact-finish-game');
    expect(onlyTo.q('finish-open-points')).toBeNull();
    expect(text(onlyTo.$('finish-open-turnovers'))).toBe('Turnovers buiten een segment: 1');
    onlyTo.unmount();
    const onlyPts = setup({ game: withActions(afterAtoD(), scoreDeltaAction('against', 3)) });
    onlyPts.click('compact-finish-game');
    expect(text(onlyPts.$('finish-open-points'))).toBe('Punten buiten een segment: 0–3');
    expect(onlyPts.q('finish-open-turnovers')).toBeNull();
  });

  it('bewust afronden zonder: één keer afronden met de huidige stand, niets vastgelegd, nooit dubbel', () => {
    const h = setup({ game: withOpenQ2() });
    h.click('compact-finish-game');
    const btn = h.$('finish-choose-without');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(h.onFinishGame).toHaveBeenCalledTimes(1);
    expect(h.onFinishGame).toHaveBeenCalledWith();
    expect(h.onChange).not.toHaveBeenCalled();
    expect(h.q('finish-dialog')).toBeNull();
  });

  it('laatste segment vastleggen en afronden: onGameChange(next) eerst, dan onFinishGame(next) met dezelfde stand, één keer', () => {
    const before = withOpenQ2();
    const h = setup({ game: before });
    h.click('compact-finish-game');
    h.click('finish-choose-last');
    expect(text(h.$('finish-last-lineup'))).toContain('#6 Bo');
    h.type('finish-clock-min', '8');
    h.type('finish-clock-sec', '00');
    expect(text(h.$('finish-since'))).toContain('2:00');
    const confirm = h.$('finish-last-confirm');
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(h.onChange).toHaveBeenCalledTimes(1);
    expect(h.onFinishGame).toHaveBeenCalledTimes(1);
    const next = h.onChange.mock.calls[0]![0];
    expect(h.onFinishGame.mock.calls[0]![0]).toBe(next);
    expect(h.onChange.mock.invocationCallOrder[0]!).toBeLessThan(
      h.onFinishGame.mock.invocationCallOrder[0]!,
    );
    const hist = deriveGameHistory(next);
    expect(hist.segments).toHaveLength(4);
    const last = hist.segments[3]!;
    expect([last.quarter, last.beginSec, last.endSec, last.durSec]).toEqual([2, 600, 480, 120]);
    expect([last.pf, last.pa, segmentTurnovers(last)]).toEqual([2, 0, 1]);
    expect(nrs(next, last.lineup)).toEqual(['6', '12', '9', '15', '13']);
    expect(openSegmentSummary(next).hasOpen).toBe(false);
    expect(h.q('finish-dialog')).toBeNull();
  });

  it('weigert een laatste segment zonder speeltijd of met ongeldige tijd (zichtbaar), zonder af te ronden', () => {
    const h = setup({ game: withOpenQ2() });
    h.click('compact-finish-game');
    h.click('finish-choose-last');
    // Eindtijd = begintijd (10:00): duur 0.
    h.click('finish-last-confirm');
    expect(text(h.$('finish-error'))).toContain('Eind moet ná begin liggen');
    expect(h.$('finish-error').getAttribute('role')).toBe('alert');
    h.type('finish-clock-min', '10');
    h.type('finish-clock-sec', '30');
    h.click('finish-last-confirm');
    expect(text(h.$('finish-error'))).toContain('Begin- of eindtijd is ongeldig');
    expect(h.onChange).not.toHaveBeenCalled();
    expect(h.onFinishGame).not.toHaveBeenCalled();
    h.click('finish-last-back');
    expect(h.$('finish-dialog').getAttribute('data-step')).toBe('choose');
  });

  it('zonder open punten of turnovers vraagt toch om bevestiging dat alle gespeelde tijd al vastligt (gelijke stand is geen bewijs)', () => {
    // Gelijke stand en niets open: toch geen aanname dat alle speeltijd vastligt.
    let g = q1Game();
    g = must(
      commitSegment(g, {
        endSec: 300,
        scoreFor: 10,
        scoreAgainst: 10,
        classification: CLASSIFICATION,
      }),
    );
    const h = setup({ game: g });
    h.click('compact-finish-game');
    expect(h.q('finish-open-warning')).toBeNull();
    expect(text(h.$('finish-nothing-open'))).toContain('gelijke stand zegt niets');
    expect(text(h.$('finish-choose-without'))).toBe('Alle gespeelde tijd ligt al vast, afronden');
    h.click('finish-choose-without');
    expect(h.onFinishGame).toHaveBeenCalledTimes(1);
    expect(h.onChange).not.toHaveBeenCalled();
  });

  it('toont de afrondkeuze in het Engels', () => {
    const h = setup({ game: withOpenQ2(), lang: 'en' });
    h.click('compact-finish-game');
    expect(text(h.$('compact-finish-game'))).toBe('Finish game');
    expect(text(h.$('finish-open-warning'))).toContain(
      'Some game information is still outside a segment.',
    );
    expect(text(h.$('finish-open-points'))).toBe('Points outside a segment: 2–0');
    expect(text(h.$('finish-choose-last'))).toBe('Record final segment and finish');
    expect(text(h.$('finish-choose-without'))).toBe('Finish anyway without');
  });

  it('blokkeert alles in alleen-lezen: afronden, Bewerken en de afrondkeuze zijn uit; het overzicht blijft leesbaar', () => {
    const h = setup({ game: withOpenQ2(), canWrite: false });
    expect((h.$('compact-finish-game') as HTMLButtonElement).disabled).toBe(true);
    h.click('compact-finish-game');
    expect(h.q('finish-dialog')).toBeNull();
    h.click('compact-segments-toggle');
    const buttons = Array.from(
      h.$('compact-segments-body').querySelectorAll<HTMLButtonElement>('button'),
    );
    expect(buttons).toHaveLength(3);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    fireEvent.click(buttons[0]!);
    expect(h.q('compact-edit-dialog')).toBeNull();
    expect(h.onChange).not.toHaveBeenCalled();
    expect(h.onFinishGame).not.toHaveBeenCalled();
  });

  it('is uitgeschakeld zolang er nog geen segment is (zoals Klassiek)', () => {
    const h = setup({ game: q1Game() });
    expect((h.$('compact-finish-game') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Klassiek: dezelfde afrondwaarschuwing', () => {
  it('toont bij open punten/turnovers de afrondkeuze (geen window.confirm) en rondt bewust zonder af', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const h = setup({ game: withOpenQ2(), panel: 'classic' });
    h.click('finish-game-btn');
    expect(confirm).not.toHaveBeenCalled();
    expect(text(h.$('finish-open-points'))).toBe('Punten buiten een segment: 2–0');
    expect(text(h.$('finish-open-turnovers'))).toBe('Turnovers buiten een segment: 1');
    h.click('finish-choose-without');
    expect(h.onFinishGame).toHaveBeenCalledTimes(1);
    expect(h.onChange).not.toHaveBeenCalled();
  });

  it('annuleren rondt niet af; laatste segment vastleggen geeft onGameChange(next) en onFinishGame(next)', () => {
    const h = setup({ game: withOpenQ2(), panel: 'classic' });
    h.click('finish-game-btn');
    h.click('finish-cancel');
    expect(h.onFinishGame).not.toHaveBeenCalled();
    h.click('finish-game-btn');
    h.click('finish-choose-last');
    h.type('finish-clock-min', '9');
    h.type('finish-clock-sec', '00');
    h.click('finish-last-confirm');
    expect(h.onChange).toHaveBeenCalledTimes(1);
    expect(h.onFinishGame).toHaveBeenCalledTimes(1);
    expect(h.onFinishGame.mock.calls[0]![0]).toBe(h.onChange.mock.calls[0]![0]);
    expect(deriveGameHistory(h.latest()).segments).toHaveLength(4);
  });

  it('zonder open punten of turnovers blijft de bestaande bevestiging (window.confirm) gelden', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const h = setup({ game: afterAtoD(), panel: 'classic' });
    h.click('finish-game-btn');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(h.q('finish-dialog')).toBeNull();
    expect(h.onFinishGame).toHaveBeenCalledTimes(1);
    expect(h.onFinishGame).toHaveBeenCalledWith();
    confirm.mockReturnValue(false);
    h.click('finish-game-btn');
    expect(h.onFinishGame).toHaveBeenCalledTimes(1);
  });

  it('alleen-lezen: afronden blijft uitgeschakeld', () => {
    const h = setup({ game: withOpenQ2(), panel: 'classic', canWrite: false });
    expect((h.$('finish-game-btn') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Stap H: afronden met het laatste segment', () => {
  it('geeft een CompletedGame zonder ontbrekend of dubbel segment en identieke score, tijden en TO', () => {
    const before = withOpenQ2(); // totaal 18-12, TO 4 (3 vastgelegd + 1 open)
    const h = setup({ game: before });
    h.click('compact-finish-game');
    h.click('finish-choose-last');
    h.type('finish-clock-min', '0');
    h.type('finish-clock-sec', '00');
    h.click('finish-last-confirm');
    const finalGame = h.onFinishGame.mock.calls[0]![0] as ActiveGame;

    const completed = finishGame(finalGame, {
      quarterCount: 4,
      periodLabel: 'Kwart',
      useClassLimit: false,
    });
    expect(completed).not.toBeNull();
    const c = completed!;
    expect(c.segments).toHaveLength(4);
    expect(new Set(c.segments.map((s) => s.id)).size).toBe(4);
    // Score en TO identiek aan de stand van vlak voor afronden (open punten zitten nu in het laatste segment).
    const pre = deriveGameHistory(before);
    expect([c.scoreFor, c.scoreAgainst]).toEqual([pre.scoreFor, pre.scoreAgainst]);
    expect([c.scoreFor, c.scoreAgainst]).toEqual([18, 12]);
    expect(c.segments.reduce((n, s) => n + segmentTurnovers(s), 0)).toBe(pre.turnovers);
    expect(c.segments.reduce((n, s) => n + s.pf, 0)).toBe(c.scoreFor);
    expect(c.segments.reduce((n, s) => n + s.pa, 0)).toBe(c.scoreAgainst);
    // Tijden: eerdere segmenten onveranderd; laatste segment Q2 10:00 -> 0:00 = 600 s.
    expect(c.segments.slice(0, 3)).toEqual(deriveGameHistory(before).segments);
    expect(c.segments.map((s) => s.durSec)).toEqual([210, 210, 180, 600]);
    expect(c.segments.reduce((n, s) => n + s.durSec, 0)).toBe(1200);
    expect(c.sourceGameId).toBe(before.id);
  });
});

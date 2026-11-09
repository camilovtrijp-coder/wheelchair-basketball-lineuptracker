// Wisselschema (Snel-scherm): pure planlogica en lokale opslag. Alleen fictieve spelers.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  addBlock,
  adoptActualLineup,
  blockStartSec,
  blockTimeBounds,
  currentBlockIndex,
  deviationPairs,
  emptyPlan,
  lineupDiff,
  lockedBlockCount,
  moveBlockTime,
  nextPlannedLineup,
  parseRotationPlan,
  plannedEndSec,
  propagateDeviation,
  quarterStartLineup,
  removeBlock,
  resolveLineup,
  setBlockLineup,
  withQuarterCount,
  type RotationPlan,
} from '../../src/domain/game/rotationPlan';
import { commitSegment } from '../../src/domain/game/liveCommands';
import type { ActiveGame, GamePlayer } from '../../src/domain/game/types';
import {
  parsePlanEntries,
  readPlanForGame,
  readPreviousPlan,
  storePlanForGame,
  ROTATION_PLAN_STORAGE_KEY,
  MAX_PLAN_ENTRIES,
} from '../../src/infrastructure/game/rotationPlanStore';

const NRS = [4, 5, 6, 8, 9, 11, 13, 14, 15, 20];

function player(nr: number, participate = true): GamePlayer {
  return {
    id: `gp-${nr}`,
    rosterId: nr,
    nr: String(nr),
    naam: `Speler ${nr}`,
    kl: '3.0',
    vrouw: false,
    jeugd: false,
    participate,
    start: false,
  };
}

function game(overrides: Partial<ActiveGame> = {}): ActiveGame {
  return {
    id: 'game-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    phase: 'tracking',
    players: NRS.map((n) => player(n)),
    opponent: 'Tegen',
    competition: '',
    clockDown: true,
    limitStr: '14.5',
    onCourt: ['gp-9', 'gp-6', 'gp-8', 'gp-13', 'gp-11'],
    curQuarter: 1,
    beginSec: 600,
    endSec: 600,
    pendingSwapLineup: null,
    actions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const CLASSIFICATION = {
  useClassLimit: false,
  classBaseLimit: 14.5,
  maxBonus: 2.5,
  bonusTag1Only: 1.5,
  bonusTag2Only: 1,
  bonusBoth: 2,
};

const START = [9, 6, 8, 13, 11];
const SECOND = [15, 8, 13, 4, 14];
const THIRD = [15, 6, 11, 20, 14];

function samplePlan(): RotationPlan {
  return {
    quarters: {
      '1': [
        { toSec: 180, lineup: [...START] },
        { toSec: 0, lineup: [...SECOND] },
      ],
      '2': [
        { toSec: 300, lineup: [...THIRD] },
        { toSec: 0, lineup: [...START] },
      ],
    },
  };
}

function withSegment(g: ActiveGame, endSec: number): ActiveGame {
  const result = commitSegment(g, { endSec, classification: CLASSIFICATION });
  if (!result.ok) throw new Error(`segment mislukt: ${result.error}`);
  return result.game;
}

describe('parseRotationPlan', () => {
  it('accepteert een geldig schema en kopieert het', () => {
    const parsed = parseRotationPlan(samplePlan());
    expect(parsed).toEqual(samplePlan());
  });

  it.each([
    ['null', null],
    ['geen quarters', {}],
    ['quarters is een array', { quarters: [] }],
    ['leeg', { quarters: {} }],
    ['kwart 0', { quarters: { '0': [{ toSec: 0, lineup: START }] } }],
    ['geen blokken', { quarters: { '1': [] } }],
    ['4 spelers', { quarters: { '1': [{ toSec: 0, lineup: [1, 2, 3, 4] }] } }],
    ['dubbele speler', { quarters: { '1': [{ toSec: 0, lineup: [1, 1, 2, 3, 4] }] } }],
    ['tijd boven 10:00', { quarters: { '1': [{ toSec: 601, lineup: START }] } }],
    ['tijd geen geheel getal', { quarters: { '1': [{ toSec: 1.5, lineup: START }] } }],
    ['speler geen getal', { quarters: { '1': [{ toSec: 0, lineup: ['a', 2, 3, 4, 5] }] } }],
  ])('weigert ongeldige invoer: %s', (_label, raw) => {
    expect(parseRotationPlan(raw)).toBeNull();
  });
});

describe('opstellingen vertalen', () => {
  it('rosterIds worden game-player-id’s en andersom', () => {
    expect(resolveLineup(game(), START)).toEqual(['gp-9', 'gp-6', 'gp-8', 'gp-13', 'gp-11']);
  });

  it('weigert een opstelling met een speler die niet meedoet of ontbreekt', () => {
    const g = game({ players: NRS.map((n) => player(n, n !== 13)) });
    expect(resolveLineup(g, START)).toBeNull();
    expect(resolveLineup(game(), [9, 6, 8, 13, 99])).toBeNull();
  });

  it('emptyPlan: één blok per kwart met de huidige opstelling', () => {
    const plan = emptyPlan(game(), 4);
    expect(Object.keys(plan?.quarters ?? {})).toEqual(['1', '2', '3', '4']);
    expect(plan?.quarters['3']).toEqual([{ toSec: 0, lineup: START }]);
  });

  it('withQuarterCount vult ontbrekende kwarten aan en laat bestaande staan', () => {
    const plan = withQuarterCount(samplePlan(), game(), 4);
    expect(Object.keys(plan.quarters)).toEqual(['1', '2', '3', '4']);
    expect(plan.quarters['1']).toEqual(samplePlan().quarters['1']);
    expect(plan.quarters['4']).toEqual([{ toSec: 0, lineup: START }]);
  });
});

describe('positie in de wedstrijd (aflopende klok)', () => {
  it('het lopende blok volgt het aantal vastgelegde segmenten in dit kwart', () => {
    expect(currentBlockIndex(game(), 2)).toBe(0);
    const after = withSegment(game(), 180);
    expect(currentBlockIndex(after, 2)).toBe(1);
    // Begrensd op het laatste blok.
    expect(currentBlockIndex(withSegment(after, 0), 2)).toBe(1);
  });

  it('plannedEndSec: geplande tijd van het lopende blok, niet voor het laatste blok', () => {
    const plan = samplePlan();
    expect(plannedEndSec(game(), plan)).toBe(180);
    const second = withSegment(game(), 180);
    expect(plannedEndSec(second, plan)).toBeNull();
  });

  it('plannedEndSec: niets als de geplande tijd al voorbij is', () => {
    expect(plannedEndSec(game({ beginSec: 120 }), samplePlan())).toBeNull();
  });

  it('plannedEndSec bij een oplopende klok', () => {
    const plan: RotationPlan = {
      quarters: {
        '1': [
          { toSec: 420, lineup: START },
          { toSec: 600, lineup: SECOND },
        ],
      },
    };
    const g = game({ clockDown: false, beginSec: 0, endSec: 0 });
    expect(plannedEndSec(g, plan)).toBe(420);
    expect(plannedEndSec(game({ clockDown: false, beginSec: 500 }), plan)).toBeNull();
  });

  it('volgende en beginopstelling van een kwart', () => {
    const plan = samplePlan();
    expect(nextPlannedLineup(game(), plan)).toEqual(resolveLineup(game(), SECOND));
    expect(nextPlannedLineup(withSegment(game(), 180), plan)).toBeNull();
    expect(quarterStartLineup(game(), plan, 2)).toEqual(resolveLineup(game(), THIRD));
    expect(quarterStartLineup(game(), plan, 3)).toBeNull();
  });

  it('lockedBlockCount: vorige kwarten dicht, huidig kwart tot en met het lopende blok', () => {
    const g = game({ curQuarter: 2 });
    expect(lockedBlockCount(g, 1, 2)).toBe(2);
    expect(lockedBlockCount(g, 2, 2)).toBe(1);
    expect(lockedBlockCount(g, 3, 2)).toBe(0);
  });

  it('lineupDiff geeft wie erin en eruit gaat', () => {
    expect(lineupDiff(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual({ ins: ['d'], outs: ['a'] });
  });
});

describe('afwijking van het schema', () => {
  it('deviationPairs: koppelt de echte speler aan de geplande speler', () => {
    // Gepland: 15, 8, 13, 4, 14. Echt op de vloer: 5 i.p.v. 4.
    const g = game({ onCourt: ['gp-15', 'gp-8', 'gp-13', 'gp-5', 'gp-14'] });
    expect(deviationPairs(g, samplePlan())).toEqual([{ actualId: 'gp-5', plannedId: 'gp-4' }]);
    const exact = game({ onCourt: resolveLineup(game(), SECOND) ?? [] });
    expect(deviationPairs(exact, samplePlan())).toEqual([]);
  });

  it('propagateDeviation ruilt in alle latere blokken, niet in het volgende of eerdere', () => {
    const plan: RotationPlan = {
      quarters: {
        '1': [
          { toSec: 180, lineup: [...START] },
          { toSec: 90, lineup: [...SECOND] },
          { toSec: 0, lineup: [15, 8, 13, 4, 14] },
        ],
        '2': [{ toSec: 0, lineup: [4, 5, 6, 8, 9] }],
      },
    };
    const g = game({ onCourt: ['gp-15', 'gp-8', 'gp-13', 'gp-5', 'gp-14'] });
    const next = propagateDeviation(g, plan);
    // Volgend blok (index 1) blijft: dat wordt bij het vastleggen overgenomen.
    expect(next.quarters['1']?.[1]?.lineup).toEqual(SECOND);
    expect(next.quarters['1']?.[0]?.lineup).toEqual(START);
    // Latere blokken: 4 wordt 5.
    expect(next.quarters['1']?.[2]?.lineup).toEqual([15, 8, 13, 5, 14]);
    // Latere kwarten: 4 wordt 5, en 5 (als die er al in stond) wordt 4 → hier stond 5 én 4.
    expect(new Set(next.quarters['2']?.[0]?.lineup).size).toBe(5);
    expect(next.quarters['2']?.[0]?.lineup).toEqual([4, 5, 6, 8, 9]);
  });

  it('propagateDeviation zonder afwijking geeft hetzelfde schema terug', () => {
    const plan = samplePlan();
    const g = game({ onCourt: resolveLineup(game(), SECOND) ?? [] });
    expect(propagateDeviation(g, plan)).toBe(plan);
  });

  it('adoptActualLineup: het volgende blok wordt wat echt op de vloer staat', () => {
    const plan = samplePlan();
    const g = game({ onCourt: ['gp-15', 'gp-8', 'gp-13', 'gp-5', 'gp-14'] });
    const next = adoptActualLineup(g, plan);
    expect(next.quarters['1']?.[1]?.lineup).toEqual([15, 8, 13, 5, 14]);
    expect(next.quarters['1']?.[0]?.lineup).toEqual(START);
    expect(plan.quarters['1']?.[1]?.lineup).toEqual(SECOND);
  });
});

describe('schema bewerken', () => {
  it('setBlockLineup vervangt alleen dat blok en weigert een ongeldige opstelling', () => {
    const plan = samplePlan();
    const edited = setBlockLineup(plan, 1, 0, [4, 5, 6, 8, 9]);
    expect(edited.quarters['1']?.[0]?.lineup).toEqual([4, 5, 6, 8, 9]);
    expect(edited.quarters['1']?.[1]).toEqual(plan.quarters['1']?.[1]);
    expect(setBlockLineup(plan, 1, 0, [4, 4, 6, 8, 9])).toBe(plan);
  });

  it('moveBlockTime schuift in stappen en houdt 30 s marge tot de buren', () => {
    const plan = samplePlan();
    expect(blockTimeBounds(plan, 1, 0, true)).toEqual({ min: 30, max: 570 });
    expect(moveBlockTime(plan, 1, 0, 30, true).quarters['1']?.[0]?.toSec).toBe(210);
    expect(moveBlockTime(plan, 1, 0, -150, true).quarters['1']?.[0]?.toSec).toBe(30);
    expect(moveBlockTime(plan, 1, 0, -180, true)).toBe(plan);
    expect(moveBlockTime(plan, 1, 0, 400, true)).toBe(plan);
    // Het laatste blok heeft geen eigen wisselmoment.
    expect(blockTimeBounds(plan, 1, 1, true)).toBeNull();
  });

  it('blockStartSec: begin van het kwart of einde van het vorige blok', () => {
    const plan = samplePlan();
    expect(blockStartSec(plan, 1, 0, true)).toBe(600);
    expect(blockStartSec(plan, 1, 1, true)).toBe(180);
    expect(blockStartSec(plan, 1, 0, false)).toBe(0);
  });

  it('addBlock splitst het laatste blok in het midden; removeBlock voegt terug samen', () => {
    const plan = samplePlan();
    const added = addBlock(plan, 1, true);
    expect(added?.quarters['1']).toEqual([
      { toSec: 180, lineup: START },
      { toSec: 90, lineup: SECOND },
      { toSec: 0, lineup: SECOND },
    ]);
    // Het middelste blok verwijderen: het vorige blok loopt door tot het einde van het verwijderde blok.
    expect(removeBlock(added ?? plan, 1, 1).quarters['1']).toEqual([
      { toSec: 90, lineup: START },
      { toSec: 0, lineup: SECOND },
    ]);
    // Het laatste (afgesplitste) blok verwijderen geeft het oorspronkelijke schema terug, met doorlopend blok.
    expect(removeBlock(added ?? plan, 1, 2).quarters['1']).toEqual([
      { toSec: 180, lineup: START },
      { toSec: 0, lineup: SECOND },
    ]);
  });

  it('addBlock weigert bij te weinig tijd of te veel blokken', () => {
    const tiny: RotationPlan = {
      quarters: {
        '1': [
          { toSec: 40, lineup: START },
          { toSec: 0, lineup: SECOND },
        ],
      },
    };
    expect(addBlock(tiny, 1, true)).toBeNull();
    let plan: RotationPlan | null = samplePlan();
    for (let i = 0; i < 12 && plan != null; i++) plan = addBlock(plan, 2, true) ?? null;
    expect(plan).toBeNull();
  });

  it('removeBlock: eerste blok verdwijnt, laatste blok laat het vorige doorlopen, nooit het enige blok', () => {
    const plan = samplePlan();
    expect(removeBlock(plan, 1, 0).quarters['1']).toEqual([{ toSec: 0, lineup: SECOND }]);
    expect(removeBlock(plan, 1, 1).quarters['1']).toEqual([{ toSec: 0, lineup: START }]);
    const single = removeBlock(removeBlock(plan, 1, 1), 1, 0);
    expect(single.quarters['1']).toHaveLength(1);
  });
});

describe('lokale opslag van het schema', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    };
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage: storage },
      configurable: true,
    });
  });

  it('bewaart per wedstrijd en leest het meest recente schema van een andere wedstrijd', () => {
    expect(readPlanForGame('g1')).toBeNull();
    expect(readPreviousPlan('g2')).toBeNull();
    storePlanForGame('g1', samplePlan());
    const other = setBlockLineup(samplePlan(), 1, 0, [4, 5, 6, 8, 9]);
    storePlanForGame('g2', other);
    expect(readPlanForGame('g1')).toEqual(samplePlan());
    expect(readPlanForGame('g2')).toEqual(other);
    expect(readPreviousPlan('g2')).toEqual(samplePlan());
    expect(readPreviousPlan('g3')).toEqual(other);
  });

  it('begrenst het aantal bewaarde schema’s en bewaart onder één eigen key', () => {
    for (let i = 0; i < MAX_PLAN_ENTRIES + 5; i++) storePlanForGame(`g${i}`, samplePlan());
    const raw = (
      globalThis as unknown as { window: { localStorage: Storage } }
    ).window.localStorage.getItem(ROTATION_PLAN_STORAGE_KEY);
    expect(parsePlanEntries(raw)).toHaveLength(MAX_PLAN_ENTRIES);
    expect(readPlanForGame('g0')).toBeNull();
    expect(readPlanForGame(`g${MAX_PLAN_ENTRIES + 4}`)).not.toBeNull();
  });

  it('kapotte opslag leest als geen schema', () => {
    expect(parsePlanEntries('{kapot')).toEqual([]);
    expect(parsePlanEntries('{"a":1}')).toEqual([]);
    expect(parsePlanEntries(JSON.stringify([{ gameId: 'g', plan: { quarters: {} } }]))).toEqual([]);
    expect(parsePlanEntries(null)).toEqual([]);
  });

  it('onbeschikbare opslag faalt stil', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: () => {
            throw new Error('geblokkeerd');
          },
          setItem: () => {
            throw new Error('geblokkeerd');
          },
        },
      },
      configurable: true,
    });
    expect(readPlanForGame('g1')).toBeNull();
    expect(() => storePlanForGame('g1', samplePlan())).not.toThrow();
  });
});

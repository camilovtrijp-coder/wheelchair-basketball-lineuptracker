// Kwartstart-keuze (bouwplan R3): pure opties en klassesom. Fictieve spelers, handmatig narekenbaar.
import { describe, it, expect } from 'vitest';
import {
  defaultQuarterStartKind,
  quarterStartOptions,
  resolveQuarterStart,
} from '../../src/domain/game/quarterStart';
import type { ActiveGame, GamePlayer } from '../../src/domain/game/types';

const KL: Record<number, string> = {
  4: '3.0',
  7: '3.0',
  9: '3.0',
  11: '3.0',
  13: '3.0',
  6: '2.0',
  12: '4.5',
};

function player(nr: number): GamePlayer {
  return {
    id: `gp-${nr}`,
    rosterId: nr,
    nr: String(nr),
    naam: `Speler ${nr}`,
    kl: KL[nr] ?? '3.0',
    vrouw: false,
    jeugd: false,
    participate: true,
    start: false,
  };
}

const game: ActiveGame = {
  id: 'g',
  organizationId: 'o',
  teamId: 't',
  phase: 'tracking',
  players: [4, 7, 9, 11, 13, 6, 12].map(player),
  opponent: 'Tegen',
  competition: '',
  clockDown: true,
  limitStr: '15.0',
  onCourt: ['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-13'],
  curQuarter: 1,
  beginSec: 600,
  endSec: 600,
  pendingSwapLineup: null,
  actions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  startedAt: '2026-01-01T00:00:00.000Z',
};

const CONFIG = {
  useClassLimit: true,
  classBaseLimit: 15,
  maxBonus: 2.5,
  bonusTag1Only: 1.5,
  bonusTag2Only: 1,
  bonusBoth: 2,
};

describe('quarterStartOptions', () => {
  it('rekent de klassesom per optie na: 5 x 3.0 = 15.0 past, met Noa (4.5) 16.5 is te hoog', () => {
    const [field, plan, custom] = quarterStartOptions(
      game,
      CONFIG,
      ['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-12'],
      ['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-6'],
    );
    expect([field?.kind, plan?.kind, custom?.kind]).toEqual(['field', 'plan', 'custom']);
    expect([field?.sum, field?.allowed, field?.over]).toEqual([15, 15, false]);
    expect([plan?.sum, plan?.over]).toEqual([16.5, true]);
    // Bo (2.0) voor Dani: 14.0.
    expect([custom?.sum, custom?.over]).toEqual([14, false]);
  });

  it('markeert wie er t.o.v. de huidige vloer in en uit gaat', () => {
    const options = quarterStartOptions(
      game,
      CONFIG,
      ['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-6'],
      [],
    );
    expect(options[0]).toMatchObject({ ins: [], outs: [] });
    expect(options[1]).toMatchObject({ ins: ['gp-6'], outs: ['gp-13'] });
  });

  it('laat de optie plan weg zonder schema-opstelling en rekent een onvolledige selectie niet door', () => {
    const options = quarterStartOptions(game, CONFIG, null, ['gp-4', 'gp-7']);
    expect(options.map((o) => o.kind)).toEqual(['field', 'custom']);
    expect(options[1]).toMatchObject({ sum: null, allowed: null, over: false });
  });
});

describe('keuze naar closeQuarter', () => {
  const plan = ['gp-4', 'gp-7', 'gp-9', 'gp-11', 'gp-6'];
  it('standaard: schema als dat er is, anders het veld', () => {
    expect(defaultQuarterStartKind(plan)).toBe('plan');
    expect(defaultQuarterStartKind(null)).toBe('field');
  });
  it('veld = geen nextOnCourt, plan = het schema, custom = precies 5 anders ongeldig', () => {
    expect(resolveQuarterStart('field', plan, [])).toBeUndefined();
    expect(resolveQuarterStart('plan', plan, [])).toEqual(plan);
    expect(resolveQuarterStart('plan', null, [])).toBeUndefined();
    expect(resolveQuarterStart('custom', plan, ['gp-4'])).toBeNull();
    expect(resolveQuarterStart('custom', plan, game.onCourt)).toEqual(game.onCourt);
  });
});

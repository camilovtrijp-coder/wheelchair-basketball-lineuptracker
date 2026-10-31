import { describe, expect, it } from 'vitest';
import { lineupNames } from '../../src/ui/trends/trendsShared';
import type { AnalysisGame, RosterPlayer } from '../../src/domain/trends/types';

const roster = [
  { id: 1, nr: '14', naam: 'Henk' },
  { id: 2, nr: '9', naam: 'Frank' },
  { id: 3, nr: '11', naam: ' ' },
] as unknown as RosterPlayer[];

describe('lineupNames', () => {
  it('sorteert op rugnummer en zet namen achter elkaar', () => {
    expect(lineupNames([1, 2], [], roster)).toBe('Frank · Henk');
  });
  it('laat lege of onbekende namen weg', () => {
    expect(lineupNames([3, 1, 99], [], roster)).toBe('Henk');
  });
  it('valt terug op de spelerssnapshot van een wedstrijd', () => {
    const games = [
      { players: [{ rosterId: 99, nr: '4', naam: 'Anouk' }] },
    ] as unknown as AnalysisGame[];
    expect(lineupNames([1, 99], games, roster)).toBe('Anouk · Henk');
  });
});

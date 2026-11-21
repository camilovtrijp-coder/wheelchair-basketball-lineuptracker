import { describe, expect, it } from 'vitest';
import { playTimeByPlayer } from '../../src/domain/game/playTime';
import {
  PLAY_TIME_STORAGE_KEY,
  parsePlayTimePreference,
  readPlayTimePreference,
  storePlayTimePreference,
} from '../../src/infrastructure/game/playTimePreference';
import type { Segment } from '../../src/domain/game/types';

function seg(id: string, lineup: string[], beginSec: number, endSec: number): Segment {
  return {
    id,
    quarter: 1,
    beginSec,
    endSec,
    durSec: Math.abs(beginSec - endSec),
    lineup,
    pf: 0,
    pa: 0,
    classSum: 0,
    allowed: 0,
    over: false,
  };
}

describe('playTimeByPlayer', () => {
  it('telt de duur van elk segment mee voor iedereen in de lineup (handmatig narekenbaar)', () => {
    // A: 600→540 = 60 s met a,b,c,d,e. B: 540→400 = 140 s met a,b,c,d,f. C (kwart 2): 600→450 = 150 s met a,b,g,h,i.
    const totals = playTimeByPlayer([
      seg('A', ['a', 'b', 'c', 'd', 'e'], 600, 540),
      seg('B', ['a', 'b', 'c', 'd', 'f'], 540, 400),
      { ...seg('C', ['a', 'b', 'g', 'h', 'i'], 600, 450), quarter: 2 },
    ]);
    expect(totals).toEqual({
      a: 350,
      b: 350,
      c: 200,
      d: 200,
      e: 60,
      f: 140,
      g: 150,
      h: 150,
      i: 150,
    });
  });

  it('geeft niets voor spelers zonder segment en niets bij geen segmenten', () => {
    expect(playTimeByPlayer([])).toEqual({});
    expect(playTimeByPlayer([seg('A', ['a', 'b', 'c', 'd', 'e'], 0, 30)]).z).toBeUndefined();
  });

  it('een dubbele speler in één lineup telt eenmaal', () => {
    expect(playTimeByPlayer([seg('A', ['a', 'a', 'b', 'c', 'd'], 600, 540)]).a).toBe(60);
  });
});

describe('voorkeur speeltijd', () => {
  it('standaard uit; alleen "on" geldt als aan', () => {
    expect(parsePlayTimePreference(null)).toBe(false);
    expect(parsePlayTimePreference('x')).toBe(false);
    expect(parsePlayTimePreference('off')).toBe(false);
    expect(parsePlayTimePreference('on')).toBe(true);
  });

  it('bewaart onder een eigen nieuwe key en faalt stil zonder storage', () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => void store.set(k, v),
        },
      },
      configurable: true,
    });
    expect(PLAY_TIME_STORAGE_KEY).toBe('lineup-tracker-v2-play-time');
    expect(readPlayTimePreference()).toBe(false);
    storePlayTimePreference(true);
    expect(store.get(PLAY_TIME_STORAGE_KEY)).toBe('on');
    expect(readPlayTimePreference()).toBe(true);
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
    expect(readPlayTimePreference()).toBe(false);
    expect(() => storePlayTimePreference(true)).not.toThrow();
  });
});

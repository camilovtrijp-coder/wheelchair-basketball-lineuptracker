import { describe, expect, it } from 'vitest';
import { nudgeClock, parseClockText } from '../../src/ui/game/calmClock';
import { currentClockSec } from '../../src/domain/game/swapFlow';
import type { ActiveGame } from '../../src/domain/game/types';

describe('parseClockText', () => {
  it('leest m:ss, mm:ss en 3-4 cijfers', () => {
    expect(parseClockText('8:05')).toBe(485);
    expect(parseClockText(' 10:00 ')).toBe(600);
    expect(parseClockText('0:30')).toBe(30);
    expect(parseClockText('805')).toBe(485);
    expect(parseClockText('1000')).toBe(600);
  });

  it('weigert ongeldige tekst, seconden boven 59 en tijden boven 10:00', () => {
    for (const bad of ['', 'abc', '8:60', '10:01', '11:00', '8:5', '8.05', '-1:00']) {
      expect(parseClockText(bad)).toBeNull();
    }
  });
});

describe('nudgeClock', () => {
  it('eerder = hogere kloktijd bij een aflopende klok, lager bij een oplopende', () => {
    expect(nudgeClock(480, true, true, null)).toBe(490);
    expect(nudgeClock(480, true, false, null)).toBe(470);
    expect(nudgeClock(480, false, true, null)).toBe(470);
    expect(nudgeClock(480, false, false, null)).toBe(490);
  });

  it('blijft binnen de grenzen en binnen 0..10:00', () => {
    expect(nudgeClock(595, true, true, null)).toBe(600);
    expect(nudgeClock(5, true, false, null)).toBe(0);
    expect(nudgeClock(485, true, true, { min: 481, max: 489 })).toBe(489);
    expect(nudgeClock(485, true, false, { min: 481, max: 489 })).toBe(481);
  });
});

describe('currentClockSec', () => {
  const game = (over: Partial<ActiveGame>): ActiveGame =>
    ({ clockDown: true, beginSec: 540, endSec: 540, ...over }) as ActiveGame;

  it('zonder ingestelde eindtijd geldt het einde van het kwart', () => {
    expect(currentClockSec(game({}))).toBe(0);
    expect(currentClockSec(game({ clockDown: false, beginSec: 60, endSec: 60 }))).toBe(600);
  });

  it('een ingestelde eindtijd na het begin geldt als huidige kloktijd', () => {
    expect(currentClockSec(game({ endSec: 500 }))).toBe(500);
    expect(currentClockSec(game({ clockDown: false, beginSec: 60, endSec: 120 }))).toBe(120);
  });

  it('een eindtijd vóór het begin wordt genegeerd', () => {
    expect(currentClockSec(game({ endSec: 560 }))).toBe(0);
  });
});

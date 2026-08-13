// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildMinutesBarChart, buildPlusMinusLineChart } from '../../src/domain/trends/chartModels';

describe('domain/trends/chartModels — buildPlusMinusLineChart (plan §C.3/§E.7)', () => {
  it('gebruikt een minimumrange van 1 rond nul, ook met alle nullen', () => {
    const model = buildPlusMinusLineChart([
      { value: 0, provisional: false },
      { value: 0, provisional: false },
    ]);
    expect(model.zeroY).toBe(model.height / 2);
    expect(model.points.every((p) => p.y === model.zeroY)).toBe(true);
  });

  it('symmetrische schaal rond nul voor één punt', () => {
    const model = buildPlusMinusLineChart([{ value: 4, provisional: true }]);
    expect(model.points).toHaveLength(1);
    expect(model.points[0]!.y).toBeLessThan(model.zeroY);
    expect(model.points[0]!.provisional).toBe(true);
  });

  it('schaalt naar het grootste absolute punt bij alleen negatieve waarden', () => {
    const model = buildPlusMinusLineChart([
      { value: -2, provisional: false },
      { value: -8, provisional: false },
    ]);
    // beide y-waarden liggen boven de nullijn (negatief = omhoog in v1-conventie: y = zeroY - value*scale)
    expect(model.points[0]!.y).toBeGreaterThan(model.zeroY);
    expect(model.points[1]!.y).toBeGreaterThan(model.points[0]!.y);
  });
});

describe('domain/trends/chartModels — buildMinutesBarChart (plan §C.3)', () => {
  it('gebruikt één gedeeld maximum voor alle balken en garandeert een minimum van 5%', () => {
    const model = buildMinutesBarChart(
      [
        { minutes: 0, provisional: false },
        { minutes: 10, provisional: false },
      ],
      10,
    );
    expect(model.bars[0]!.pct).toBe(5);
    expect(model.bars[1]!.pct).toBe(100);
  });

  it('valt terug op minimum 1 als gedeeld maximum bij toeval 0 is', () => {
    const model = buildMinutesBarChart([{ minutes: 0, provisional: false }], 0);
    expect(model.bars[0]!.pct).toBe(5);
  });
});

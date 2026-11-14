import { describe, expect, it } from 'vitest';
import { maxZGap, zEdgeBarPercent } from '../tradeVersusMath';

describe('Z edge bar', () => {
  it('scales every row to the largest gap shown, which fills one half', () => {
    const scale = maxZGap([[0.51, -0.66], [0.2, 1.56], [null, 1]]);
    expect(scale).toBeCloseTo(1.36);
    expect(zEdgeBarPercent(0.2, 1.56, scale)).toBe(50);
    expect(zEdgeBarPercent(0.51, -0.66, scale)).toBeCloseTo(43, 0);
  });

  it('keeps a small gap visible and draws nothing without both Zs', () => {
    expect(zEdgeBarPercent(0.22, 0.35, 2)).toBe(4);
    expect(zEdgeBarPercent(null, 0.35, 2)).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { getHeatmapColor, getTextColor } from '../colorUtils';

describe('getHeatmapColor', () => {
  it('maps extremes toward red and green in light mode', () => {
    const low = getHeatmapColor(0, false);
    const high = getHeatmapColor(1, false);
    expect(low).toMatch(/^rgb\(/);
    expect(high).toMatch(/^rgb\(/);
    expect(low).not.toBe(high);
  });

  it('returns distinct rgb for midpoint', () => {
    const mid = getHeatmapColor(0.5, false);
    expect(mid).toMatch(/^rgb\(/);
  });

  it('dark mode returns rgb string', () => {
    expect(getHeatmapColor(0, true)).toMatch(/^rgb\(/);
    expect(getHeatmapColor(1, true)).toMatch(/^rgb\(/);
  });
});

describe('getTextColor', () => {
  it('light mode boundaries', () => {
    expect(getTextColor(0.2, false)).toBe('white');
    expect(getTextColor(0.3, false)).toBe('black');
    expect(getTextColor(0.74, false)).toBe('black');
    expect(getTextColor(0.8, false)).toBe('white');
  });

  it('dark mode boundaries', () => {
    expect(getTextColor(0.25, true)).toBe('white');
    expect(getTextColor(0.5, true)).toBe('#cbd5e1');
    expect(getTextColor(0.71, true)).toBe('white');
  });
});

import { describe, expect, it } from 'vitest';
import type { DepthChartPosition } from '../../types/api';
import { applyDepthChartFilters } from '../depthChartFilters';

function pos(
  abbreviation: string,
  players: DepthChartPosition['players'],
): DepthChartPosition {
  return { abbreviation, display_name: abbreviation, players };
}

describe('applyDepthChartFilters', () => {
  const base: DepthChartPosition[] = [
    pos('PG', [
      { id: '1', display_name: 'A', short_name: 'A', injury: { status: 'Out' } },
      { id: '2', display_name: 'B', short_name: 'B', injury: null },
      { id: '3', display_name: 'C', short_name: 'C' },
      { id: '4', display_name: 'D', short_name: 'D' },
      { id: '5', display_name: 'E', short_name: 'E' },
      { id: '6', display_name: 'F', short_name: 'F' },
    ]),
    pos('SG', [{ id: '7', display_name: 'G', short_name: 'G' }]),
  ];

  it('caps at five players per position with no filters', () => {
    const r = applyDepthChartFilters(base, new Set(), false);
    expect(r[0].players).toHaveLength(5);
    expect(r[0].players.map((p) => p.display_name)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('excludedStatuses removes players with matching status', () => {
    const r = applyDepthChartFilters(base, new Set(['Out']), false);
    expect(r[0].players.some((p) => p.display_name === 'A')).toBe(false);
    expect(r[0].players[0].display_name).toBe('B');
  });

  it('excludedStatuses can exclude multiple statuses', () => {
    const withStatuses: DepthChartPosition[] = [
      pos('PG', [
        { id: '1', display_name: 'OutPlayer', short_name: 'O', injury: { status: 'Out' } },
        { id: '2', display_name: 'DoubtfulPlayer', short_name: 'D', injury: { status: 'Doubtful' } },
        { id: '3', display_name: 'QuestionablePlayer', short_name: 'Q', injury: { status: 'Questionable' } },
        { id: '4', display_name: 'Healthy', short_name: 'H' },
      ]),
    ];
    const r = applyDepthChartFilters(withStatuses, new Set(['Out', 'Doubtful']), false);
    expect(r[0].players.map((p) => p.id)).toEqual(['3', '4']);
  });

  it('removeDuplicates keeps player only in best slot', () => {
    const dup: DepthChartPosition[] = [
      pos('PG', [
        { id: 'x', display_name: 'Dup', short_name: 'D' },
        { id: '2', display_name: 'Other', short_name: 'O' },
      ]),
      pos('SG', [
        { id: 'x', display_name: 'Dup', short_name: 'D' },
        { id: '3', display_name: 'Y', short_name: 'Y' },
      ]),
    ];
    const r = applyDepthChartFilters(dup, new Set(), true);
    const pg = r.find((p) => p.abbreviation === 'PG')!;
    const sg = r.find((p) => p.abbreviation === 'SG')!;
    expect(pg.players.some((p) => p.id === 'x')).toBe(true);
    expect(sg.players.some((p) => p.id === 'x')).toBe(false);
  });

  it('applies both filters', () => {
    const mixed: DepthChartPosition[] = [
      pos('PG', [
        { id: '1', display_name: 'OutDup', short_name: 'O', injury: { status: 'Out' } },
        { id: 'x', display_name: 'Dup', short_name: 'D' },
      ]),
      pos('SG', [
        { id: 'x', display_name: 'Dup', short_name: 'D' },
        { id: '4', display_name: 'Two', short_name: 'T' },
      ]),
    ];
    const r = applyDepthChartFilters(mixed, new Set(['Out']), true);
    const pg = r.find((p) => p.abbreviation === 'PG')!;
    const sg = r.find((p) => p.abbreviation === 'SG')!;
    expect(pg.players.map((p) => p.id)).toEqual(['x']);
    expect(sg.players.map((p) => p.id)).toEqual(['4']);
  });

  it('handles empty positions', () => {
    expect(applyDepthChartFilters([], new Set(), false)).toEqual([]);
  });

  it('does not filter player without injury when statuses are excluded', () => {
    const onlyOk: DepthChartPosition[] = [
      pos('C', [{ id: '1', display_name: 'Z', short_name: 'Z' }]),
    ];
    const r = applyDepthChartFilters(onlyOk, new Set(['Out']), false);
    expect(r[0].players).toHaveLength(1);
  });
});

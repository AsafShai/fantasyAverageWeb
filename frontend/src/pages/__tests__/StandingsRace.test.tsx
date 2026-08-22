import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeamTimeSeriesPoint } from '../../types/api';
import { renderWithProviders } from '../../test/helpers';
import StandingsRace from '../StandingsRace';
import { rankValue } from '../standingsRaceMetrics';

function point(overrides: Partial<TeamTimeSeriesPoint> = {}): TeamTimeSeriesPoint {
  return {
    date: '2026-01-31',
    team_id: 1,
    team_name: 'Alpha Squad',
    rk_fg_pct: 2,
    rk_ft_pct: 2,
    rk_three_pm: 2,
    rk_reb: 2,
    rk_ast: 2,
    rk_stl: 2,
    rk_blk: 2,
    rk_pts: 2,
    rk_total: 16,
    gp: 40,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

function stubApi(points: TeamTimeSeriesPoint[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('over-time') || url.includes('rankings')) {
        return jsonResponse({ data: points });
      }
      return new Response('not found', { status: 404 });
    }),
  );
}

const metricNames = () =>
  Array.from(screen.getByRole('combobox').querySelectorAll('option')).map(o => o.textContent);

describe('StandingsRace metric options', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers the fixed categories when the league scores nothing extra', async () => {
    stubApi([
      point(),
      point({ team_id: 2, team_name: 'Beta Ballers', rk_total: 12 }),
    ]);
    renderWithProviders(<StandingsRace />);

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    const names = metricNames();
    expect(names).toContain('PTS');
    expect(names).toContain('FG%');
    expect(names).not.toContain('TO');
  });

  it('offers a category that only exists in the ranks payload', async () => {
    stubApi([
      point({ ranks: { 'FG%': 2, 'FT%': 2, '3PM': 2, REB: 2, AST: 2, STL: 2, BLK: 2, PTS: 2, TO: 1 } }),
      point({
        team_id: 2,
        team_name: 'Beta Ballers',
        rk_total: 12,
        ranks: { 'FG%': 1, 'FT%': 1, '3PM': 1, REB: 1, AST: 1, STL: 1, BLK: 1, PTS: 1, TO: 2 },
      }),
    ]);
    renderWithProviders(<StandingsRace />);

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    await waitFor(() => expect(metricNames()).toContain('TO'));
    // the familiar categories keep their order, the extra one is appended
    expect(metricNames()).toEqual(['Total', 'PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%', 'TO']);
  });
});

describe('rankValue', () => {
  it('reads a category from ranks when it has no rk_* field', () => {
    expect(rankValue(point({ ranks: { TO: 3 } }), 'TO')).toBe(3);
  });

  it('prefers ranks over the rk_* field for a category that has both', () => {
    expect(rankValue(point({ rk_pts: 2, ranks: { PTS: 7 } }), 'PTS')).toBe(7);
  });

  it('falls back to the rk_* field when the payload carries no ranks', () => {
    expect(rankValue(point({ rk_pts: 2 }), 'PTS')).toBe(2);
  });

  it('takes the total from rk_total, which the backend already overrode', () => {
    expect(rankValue(point({ rk_total: 16, ranks: { TOTAL: 99 } }), 'rk_total')).toBe(16);
  });

  it('is NaN for a category the point does not carry', () => {
    expect(rankValue(point({ rk_pts: undefined }), 'PTS')).toBeNaN();
  });
});

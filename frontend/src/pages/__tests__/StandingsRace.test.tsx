import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeamTimeSeriesPoint } from '../../types/api';
import { renderWithProviders } from '../../test/helpers';
import StandingsRace from '../StandingsRace';
import { formatStatValue, rankValue, statMetricOptionsFor, statValue } from '../standingsRaceMetrics';

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
    expect(metricNames()).toEqual(['Total', 'FG%', 'FT%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PTS']);
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

function stubSources(bySource: Record<string, unknown>) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('over-time')) {
        const source = new URL(url, 'http://x').searchParams.get('source') ?? '';
        calls.push(source);
        return jsonResponse(bySource[source] ?? { data: [] });
      }
      return new Response('not found', { status: 404 });
    }),
  );
  return calls;
}

describe('StandingsRace Stat Value view', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const averages = {
    data: [
      point({ values: { PTS: 12.4, REB: 5.1, 'FG%': 0.471, FGM: 4.2 } }),
      point({ team_id: 2, team_name: 'Beta Ballers', values: { PTS: 13.1, REB: 4.8, 'FG%': 0.465, FGM: 4.6 } }),
    ],
    categories: ['FG%', 'REB', 'PTS'],
    reverse_categories: [],
  };

  it('reads per-game averages and season totals, and offers no Total', async () => {
    const calls = stubSources({ rankings_totals: { data: [point()] }, averages, snapshot: averages });
    renderWithProviders(<StandingsRace />);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Per Game' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stat Value' }));
    await waitFor(() => expect(calls).toContain('averages'));
    await waitFor(() => expect(metricNames()).toEqual(['FG%', 'REB', 'PTS']));
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('PTS');
    expect(screen.getByText(/PTS per game/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Season Totals' }));
    await waitFor(() => expect(calls).toContain('snapshot'));
  });

  it('opens on per-game roto points and keeps reading the rankings there', async () => {
    const calls = stubSources({ rankings_totals: { data: [point()] }, rankings_avg: { data: [point()] } });
    renderWithProviders(<StandingsRace />);
    await waitFor(() => expect(calls).toEqual(['rankings_avg']));
    expect(screen.getByRole('button', { name: 'Per Game' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Season Totals' }));
    await waitFor(() => expect(calls).toContain('rankings_totals'));
  });
});

describe('stat value helpers', () => {
  it('reads a category from values', () => {
    expect(statValue(point({ values: { PTS: 13 } }), 'PTS')).toBe(13);
    expect(statValue(point(), 'PTS')).toBeNaN();
  });

  it('lists the league categories it has values for, in order', () => {
    const pts = [point({ values: { PTS: 1, TO: 2, FGM: 3 } })];
    expect(statMetricOptionsFor(pts, ['TO', 'PTS', 'AST']).map(o => o.value)).toEqual(['TO', 'PTS']);
  });

  it('falls back to carried categories, minus percentage inputs', () => {
    const pts = [point({ values: { PTS: 1, 'FG%': 0.4, FGM: 3, FGA: 7 } })];
    expect(statMetricOptionsFor(pts, []).map(o => o.value)).toEqual(['FG%', 'PTS']);
  });

  it('formats each kind of value', () => {
    expect(formatStatValue(0.4719, 'FG%', 'avg')).toBe('.472');
    expect(formatStatValue(14.23, 'PTS', 'avg')).toBe('14.2');
    expect(formatStatValue(0.954, 'STL', 'avg')).toBe('0.95');
    expect(formatStatValue(2840, 'PTS', 'totals')).toBe('2,840');
    expect(formatStatValue(1.857, 'A/TO', 'totals')).toBe('1.86');
  });
});

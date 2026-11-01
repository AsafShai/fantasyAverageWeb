import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankingStats } from '../../types/api';
import { renderWithProviders } from '../../test/helpers';
import Rankings from '../Rankings';

const ALL_CATEGORIES = ['FG%', 'FT%', '3PM', 'AST', 'REB', 'STL', 'BLK', 'PTS'];

function team(overrides: Partial<RankingStats> = {}): RankingStats {
  const base = {
    team: { team_id: 1, team_name: 'Alpha Squad' },
    fg_percentage: 0.467,
    ft_percentage: 0.8,
    three_pm: 100,
    ast: 200,
    reb: 300,
    stl: 40,
    blk: 20,
    pts: 1000,
    gp: 50,
    total_points: 8,
    rank: 1,
    category_ranks: { 'FG%': 2, 'FT%': 2, '3PM': 2, AST: 2, REB: 2, STL: 2, BLK: 2, PTS: 2 },
    ...overrides,
  };
  // `stats` mirrors the fixed fields above by default (as the real API does),
  // unless the caller supplies its own `stats` override.
  const stats = overrides.stats ?? {
    'FG%': base.fg_percentage,
    'FT%': base.ft_percentage,
    '3PM': base.three_pm,
    AST: base.ast,
    REB: base.reb,
    STL: base.stl,
    BLK: base.blk,
    PTS: base.pts,
  };
  return { ...base, stats };
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

describe('Rankings page', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.includes('/rankings')) {
          return jsonResponse({
            averages_rankings: [
              team({
                team: { team_id: 1, team_name: 'Alpha Squad' },
                rank: 1,
                total_points: 8,
                pts: 115.3,
                fg_percentage: 0.467,
                category_ranks: { 'FG%': 3, 'FT%': 1, '3PM': 2, AST: 2, REB: 2, STL: 2, BLK: 2, PTS: 2 },
              }),
              team({
                team: { team_id: 2, team_name: 'Beta Ballers' },
                rank: 2,
                total_points: 4,
                pts: 121.0,
                fg_percentage: 0.444,
                category_ranks: { 'FG%': 1, 'FT%': 3, '3PM': 3, AST: 1, REB: 1, STL: 1, BLK: 3, PTS: 3 },
              }),
            ],
            totals_rankings: [
              team({
                team: { team_id: 1, team_name: 'Alpha Squad' },
                rank: 2,
                total_points: 4,
                pts: 4000,
                category_ranks: { 'FG%': 2, 'FT%': 2, '3PM': 2, AST: 2, REB: 2, STL: 2, BLK: 2, PTS: 1 },
              }),
              team({
                team: { team_id: 2, team_name: 'Beta Ballers' },
                rank: 1,
                total_points: 8,
                pts: 9000,
                category_ranks: { 'FG%': 1, 'FT%': 1, '3PM': 1, AST: 1, REB: 1, STL: 1, BLK: 1, PTS: 2 },
              }),
            ],
            categories: [...ALL_CATEGORIES, 'TOTAL_POINTS'],
            last_updated: '2026-08-19',
          });
        }
        if (url.includes('/league/rank-changes')) {
          return jsonResponse({
            previous_period: 11,
            latest_period: 12,
            teams: [
              { team_id: 1, team_name: 'Alpha Squad', rank_delta: 1, total_delta: 2, gp_delta: 3, categories: { 'FG%': 2, PTS: 0 } },
              { team_id: 2, team_name: 'Beta Ballers', rank_delta: -1, total_delta: -2, gp_delta: 4, categories: { AST: -1 } },
            ],
          });
        }
        if (url.includes('/league/summary')) {
          return jsonResponse({ nba_avg_pace: 100, nba_game_days_left: 30, season_start: '2025-10-01' });
        }
        return new Response('not found', { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to Rankings (Averages) with category-rank cells, Rank and Total always visible', async () => {
    renderWithProviders(<Rankings />);
    await waitFor(() => expect(screen.getByText('Alpha Squad')).toBeInTheDocument());
    expect(screen.getByText('Team Rankings (Averages)')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /rank/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /^total/i })).toBeInTheDocument();

    const table = screen.getByRole('table');
    const alphaRow = within(table).getByText('Alpha Squad').closest('tr')!;
    // Category rank (3), not the actual pts/fg% value, in the default Rankings view
    expect(within(alphaRow).queryByText('115.3000')).not.toBeInTheDocument();
  });

  it('the "View Mode" group offers Standings/Rankings and "Values" offers Averages/Totals', async () => {
    renderWithProviders(<Rankings />);
    await waitFor(() => expect(screen.getByText('Alpha Squad')).toBeInTheDocument());
    expect(screen.getByText('View Mode')).toBeInTheDocument();
    expect(screen.getByText('Values')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^standings$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^rankings$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^averages$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^totals$/i })).toBeInTheDocument();
  });

  it('switching to Standings x Averages shows actual values rounded to 4 decimals, like the heatmap', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Rankings />);
    await waitFor(() => expect(screen.getByText('Alpha Squad')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^standings$/i }));

    expect(screen.getByText('Team Standings (Averages)')).toBeInTheDocument();
    const table = screen.getByRole('table');
    const alphaRow = within(table).getByText('Alpha Squad').closest('tr')!;
    expect(within(alphaRow).getByText('115.3000')).toBeInTheDocument();
    expect(within(alphaRow).getByText('46.7000%')).toBeInTheDocument();
  });

  it('Standings x Totals shows raw totals values without the 4-decimal average formatting', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Rankings />);
    await waitFor(() => expect(screen.getByText('Alpha Squad')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^standings$/i }));
    await user.click(screen.getByRole('button', { name: /^totals$/i }));

    expect(screen.getByText('Team Standings (Totals)')).toBeInTheDocument();
    const table = screen.getByRole('table');
    const alphaRow = within(table).getByText('Alpha Squad').closest('tr')!;
    expect(within(alphaRow).getByText('4000')).toBeInTheDocument();
  });

  it('switching back to Rankings restores category-rank cells', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Rankings />);
    await waitFor(() => expect(screen.getByText('Alpha Squad')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^standings$/i }));
    await user.click(screen.getByRole('button', { name: /^rankings$/i }));

    expect(screen.getByText('Team Rankings (Averages)')).toBeInTheDocument();
    const table = screen.getByRole('table');
    const alphaRow = within(table).getByText('Alpha Squad').closest('tr')!;
    expect(within(alphaRow).queryByText('115.3000')).not.toBeInTheDocument();
  });

  it("shows last night's moves next to rank, category points, total and games on the default view", async () => {
    renderWithProviders(<Rankings />);
    const table = await screen.findByRole('table');
    await waitFor(() => expect(within(table).getByText('Alpha Squad').closest('tr')!.textContent).toContain('▲'));
    const alpha = within(table).getByText('Alpha Squad').closest('tr')!;
    const cells = within(alpha).getAllByRole('cell');
    expect(cells[0].textContent).toBe('#1▲1');
    expect(cells[2].textContent).toBe('3▲2'); // FG% points, up 2
    expect(cells.at(-2)!.textContent).toBe('8▲2'); // total
    expect(cells.at(-1)!.textContent).toBe('50+3'); // games last night
    const beta = within(table).getByText('Beta Ballers').closest('tr')!;
    expect(within(beta).getAllByRole('cell')[0].textContent).toBe('#2▼1');
  });

  it('"Hide movers" hides the moves and the button then reads "Show movers"', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Rankings />);
    await user.click(await screen.findByRole('button', { name: 'Hide movers' }));
    const table = screen.getByRole('table');
    expect(within(table).queryByText(/▲|▼/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show movers' }));
    expect(within(within(table).getByText('Alpha Squad').closest('tr')!).getAllByRole('cell')[0].textContent).toBe('#1▲1');
  });

  it('a date range shows no moves and no movers button', async () => {
    renderWithProviders(<Rankings />, { route: '/?from=2025-10-05&to=2025-10-20' });
    await waitFor(() => expect(screen.getByText('Alpha Squad')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /movers/i })).not.toBeInTheDocument();
    expect(within(screen.getByRole('table')).queryByText(/▲|▼/)).not.toBeInTheDocument();
  });
});

describe('Rankings page — dynamic categories', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.includes('/rankings')) {
          return jsonResponse({
            averages_rankings: [
              team({
                team: { team_id: 1, team_name: 'Turnover Titans' },
                rank: 1,
                total_points: 9,
                category_ranks: { ...team().category_ranks, TO: 1 },
                stats: { ...team().stats, TO: 12.5 },
              }),
            ],
            totals_rankings: [],
            categories: [...ALL_CATEGORIES, 'TO', 'TOTAL_POINTS'],
            last_updated: '2026-08-19',
          });
        }
        if (url.includes('/league/summary')) {
          return jsonResponse({ nba_avg_pace: 100, nba_game_days_left: 30, season_start: '2025-10-01' });
        }
        return new Response('not found', { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders an extra league category (TO) as its own column, driven by the API categories list', async () => {
    renderWithProviders(<Rankings />);
    await waitFor(() => expect(screen.getByText('Turnover Titans')).toBeInTheDocument());

    expect(screen.getByRole('columnheader', { name: 'TO' })).toBeInTheDocument();

    const table = screen.getByRole('table');
    const row = within(table).getByText('Turnover Titans').closest('tr')!;
    // Rankings view shows the category *rank* (1), not the raw stat value
    const toIndex = within(table).getAllByRole('columnheader').findIndex(h => h.textContent?.includes('TO'));
    const cells = within(row).getAllByRole('cell');
    expect(cells[toIndex].textContent).toBe('1');
  });
});

describe('Rankings page team names', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lets team names wrap within a narrow column on phones', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.includes('/rankings')) {
          const rows = [
            team({ team: { team_id: 1, team_name: 'Alpha Squad' }, rank: 1 }),
            team({ team: { team_id: 2, team_name: 'Shai-Gilgeous Alexander Fans' }, rank: 2 }),
          ];
          return jsonResponse({
            averages_rankings: rows,
            totals_rankings: rows,
            categories: [...ALL_CATEGORIES, 'TOTAL_POINTS'],
            last_updated: '2026-08-19',
          });
        }
        if (url.includes('/league/summary')) {
          return jsonResponse({ nba_avg_pace: 100, nba_game_days_left: 30, season_start: '2025-10-01' });
        }
        return new Response('not found', { status: 404 });
      }),
    );
    renderWithProviders(<Rankings />);
    const longName = await screen.findByText('Shai‑Gilgeous Alexander Fans');
    const longCell = longName.closest('td')!;
    expect(longCell.className).toContain('whitespace-normal');
    expect(longCell.className).toContain('sm:whitespace-nowrap');
    expect(longName.closest('div')!.className).toContain('w-[34vw]');
    expect(longName.closest('div')!.className).toContain('line-clamp-2');
    expect(longName.closest('a')).toHaveAttribute('href', '/team/2');

    const shortCell = screen.getByText('Alpha Squad').closest('td')!;
    expect(shortCell.className).toContain('sm:whitespace-nowrap');
    expect(screen.getByText('Alpha Squad').closest('div')!.className).toContain('w-[34vw]');
  });
});

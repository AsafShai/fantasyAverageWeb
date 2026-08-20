import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankingStats } from '../../types/api';
import { renderWithProviders } from '../../test/helpers';
import Rankings from '../Rankings';

function team(overrides: Partial<RankingStats> = {}): RankingStats {
  return {
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
            categories: ['pts', 'reb', 'ast'],
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
});

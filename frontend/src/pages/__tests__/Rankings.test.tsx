import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankingStats } from '../../types/api';
import { renderWithProviders } from '../../test/helpers';
import Rankings from '../Rankings';

function team(overrides: Partial<RankingStats> = {}): RankingStats {
  return {
    team: { team_id: 1, team_name: 'Alpha Squad' },
    fg_percentage: 0.5,
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
              team({ team: { team_id: 1, team_name: 'Alpha Squad' }, rank: 1, total_points: 8 }),
              team({ team: { team_id: 2, team_name: 'Beta Ballers' }, rank: 2, total_points: 4, pts: 500 }),
            ],
            totals_rankings: [
              team({ team: { team_id: 1, team_name: 'Alpha Squad' }, rank: 2, total_points: 4, pts: 4000 }),
              team({ team: { team_id: 2, team_name: 'Beta Ballers' }, rank: 1, total_points: 8, pts: 9000 }),
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

  it('defaults to Rankings (Averages) with rank and total columns', async () => {
    renderWithProviders(<Rankings />);
    await waitFor(() => expect(screen.getByText('Alpha Squad')).toBeInTheDocument());
    expect(screen.getByText('Team Rankings (Averages)')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /rank/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /^total/i })).toBeInTheDocument();
  });

  it('switching Display to Raw drops rank/total columns and retitles to Standings', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Rankings />);
    await waitFor(() => expect(screen.getByText('Alpha Squad')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^raw$/i }));

    expect(screen.getByText('Team Standings (Averages)')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /rank/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /^total$/i })).not.toBeInTheDocument();
    const table = screen.getByRole('table');
    const dataRows = within(table).getAllByRole('row').slice(1);
    expect(dataRows[0]).toHaveTextContent('Alpha Squad');
    expect(within(dataRows[0]).queryByText(/^#/)).not.toBeInTheDocument();
  });

  it('Totals x Raw shows Team Standings (Totals) using raw totals values', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Rankings />);
    await waitFor(() => expect(screen.getByText('Alpha Squad')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^totals$/i }));
    await user.click(screen.getByRole('button', { name: /^raw$/i }));

    expect(screen.getByText('Team Standings (Totals)')).toBeInTheDocument();
    const table = screen.getByRole('table');
    const alphaRow = within(table).getByText('Alpha Squad').closest('tr')!;
    expect(within(alphaRow).getByText('4000')).toBeInTheDocument();
  });

  it('Ranked x Totals shows Team Rankings (Totals)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Rankings />);
    await waitFor(() => expect(screen.getByText('Alpha Squad')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^totals$/i }));

    expect(screen.getByText('Team Rankings (Totals)')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /rank/i })).toBeInTheDocument();
  });

  it('switching back to Ranked restores rank and total columns', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Rankings />);
    await waitFor(() => expect(screen.getByText('Alpha Squad')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^raw$/i }));
    await user.click(screen.getByRole('button', { name: /^ranked$/i }));

    expect(screen.getByText('Team Rankings (Averages)')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /rank/i })).toBeInTheDocument();
  });
});

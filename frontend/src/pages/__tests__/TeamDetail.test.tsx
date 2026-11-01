import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player, TeamDetail as TeamDetailData } from '../../types/api';
import { renderWithProviders } from '../../test/helpers';
import TeamDetail from '../TeamDetail';

function player(name: string, id: number, teamId: number): Player {
  return {
    player_name: name,
    player_id: id,
    pro_team: 'LAL',
    positions: ['PG'],
    team_id: teamId,
    status: 'ONTEAM',
    stats: {
      pts: 200, reb: 50, ast: 40, stl: 10, blk: 5, fgm: 80, fga: 160, ftm: 30, fta: 40,
      fg_percentage: 0.5, ft_percentage: 0.75, three_pm: 10, minutes: 300, gp: 10,
    },
  };
}

function detail(teamId: number, teamName: string, names: string[]): TeamDetailData {
  const team = { team_id: teamId, team_name: teamName };
  const fixed = { fg_percentage: 0.5, ft_percentage: 0.75, three_pm: 1, ast: 1, reb: 1, stl: 1, blk: 1, pts: 1, gp: 10 };
  return {
    team,
    espn_url: 'https://espn.example',
    players: names.map((name, i) => player(name, teamId * 100 + i, teamId)),
    shot_chart: { team, fgm: 1, fga: 2, fg_percentage: 0.5, ftm: 1, fta: 2, ft_percentage: 0.5, gp: 10 },
    raw_averages: { team, ...fixed, stats: {} },
    ranking_stats: { team, ...fixed, total_points: 8, rank: 1, category_ranks: {}, stats: {} },
    category_ranks: { PTS: 1 },
    slot_usage: {},
  } as unknown as TeamDetailData;
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

describe('TeamDetail', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (/\/teams\/1\b/.test(url)) return jsonResponse(detail(1, 'Alpha Squad', ['Alpha One', 'Alpha Two']));
      if (/\/teams\/2\b/.test(url)) return jsonResponse(detail(2, 'Beta Ballers', ['Beta One', 'Beta Two']));
      if (url.includes('/matchups/today')) return jsonResponse([]);
      if (url.includes('/nba/schedule')) return jsonResponse({ teams: [], calendar_days: [] });
      return jsonResponse({});
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts every player included again after moving to another team', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <Link to="/team/2">to team 2</Link>
        <Routes>
          <Route path="/team/:teamId" element={<TeamDetail />} />
        </Routes>
      </>,
      { route: '/team/1' },
    );

    const alphaRow = (await screen.findByText('Alpha One')).closest('tr')!;
    await user.click(within(alphaRow).getByRole('checkbox'));
    expect(within(alphaRow).getByRole('checkbox')).not.toBeChecked();

    await user.click(screen.getByText('to team 2'));
    const betaRow = (await screen.findByText('Beta One')).closest('tr')!;
    await waitFor(() => expect(within(betaRow).getByRole('checkbox')).toBeChecked());
    const betaTwoRow = screen.getByText('Beta Two').closest('tr')!;
    expect(within(betaTwoRow).getByRole('checkbox')).toBeChecked();
    expect(screen.getByText('2 players')).toBeInTheDocument();
  });
});

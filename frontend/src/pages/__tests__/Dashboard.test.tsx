import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TodayHub } from '../../types/api';
import { renderWithProviders } from '../../test/helpers';
import Dashboard from '../Dashboard';

const summary = {
  total_teams: 12,
  total_games_played: 400,
  nba_avg_pace: 99.4,
  nba_game_days_left: 120,
  category_leaders: {},
  league_averages: {
    gp: 3.5,
    fg_percentage: 0.471,
    ft_percentage: 0.782,
    three_pm: 12.3,
    ast: 24.1,
    reb: 43.2,
    stl: 7.4,
    blk: 4.6,
    pts: 112.7,
  },
  last_updated: '2026-09-18T09:41:00Z',
};

const rankings = {
  averages_rankings: [
    { team: { team_id: 1, team_name: '50 Shades of Shai' }, total_points: 80.5 },
    { team: { team_id: 2, team_name: "Khachapuri's Team" }, total_points: 74 },
  ],
  totals_rankings: [],
  categories: [],
  last_updated: '2026-09-18T09:41:00Z',
};

const fullHub: TodayHub = {
  slate_date: '2026-09-18',
  games_count: 8,
  movers: [
    { team_id: 1, team_name: "Khachapuri's Team", category: 'AST', delta: 2 },
    { team_id: 2, team_name: 'DORTAHTIT', category: 'TOTAL', delta: -1.5 },
  ],
  roster_health: [
    {
      team_id: 3, team_name: "Amihai's Awesome", out: 3, questionable: 0,
      playing_tonight: 4, out_tonight: 2, roster_size: 13,
    },
    {
      team_id: 1, team_name: '50 Shades of Shai', out: 0, questionable: 1,
      playing_tonight: 6, out_tonight: 0, roster_size: 12,
    },
  ],
  last_nightly: { game_date: '2026-09-17', rows: 240 },
};

const emptyHub: TodayHub = {
  slate_date: null,
  games_count: 0,
  movers: [],
  roster_health: [],
  last_nightly: null,
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

function stubApi(hub: TodayHub) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/league/today')) return jsonResponse(hub);
      if (url.includes('/league/summary')) return jsonResponse(summary);
      if (url.includes('/rankings')) return jsonResponse(rankings);
      return new Response('not found', { status: 404 });
    }),
  );
}

describe('Dashboard today hub', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the three panels from the hub payload', async () => {
    stubApi(fullHub);
    renderWithProviders(<Dashboard />);

    await waitFor(() => expect(screen.getByText('Rank movers')).toBeInTheDocument());
    expect(screen.getByText('Roster health')).toBeInTheDocument();
    expect(screen.getByText('Tonight')).toBeInTheDocument();

    expect(screen.getByText('TOTAL')).toBeInTheDocument();
    expect(screen.getByText('▲ 2')).toBeInTheDocument();
    expect(screen.getByText('▼ 1.5')).toBeInTheDocument();
    expect(screen.getAllByText("Amihai's Awesome").length).toBe(2);
    expect(screen.getByText('4/6')).toBeInTheDocument();
  });

  it('shows the tonight tiles derived from the slate and rosters', async () => {
    stubApi(fullHub);
    renderWithProviders(<Dashboard />);

    await waitFor(() => expect(screen.getByText('NBA games')).toBeInTheDocument());
    expect(screen.getByText('teams playing')).toBeInTheDocument();
    expect(screen.getByText('rostered')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('keeps the league-average tiles on the dashboard', async () => {
    stubApi(fullHub);
    renderWithProviders(<Dashboard />);

    await waitFor(() => expect(screen.getByText('League averages')).toBeInTheDocument());
    expect(screen.getByText('112.70')).toBeInTheDocument();
    expect(screen.getByText('0.471')).toBeInTheDocument();
    expect(screen.getByText('99.4')).toBeInTheDocument();
  });

  it('shows empty states when the hub has nothing to report', async () => {
    stubApi(emptyHub);
    renderWithProviders(<Dashboard />);

    await waitFor(() =>
      expect(screen.getByText('Movers appear after the second scoring period.')).toBeInTheDocument(),
    );
    expect(screen.getByText('No NBA games scheduled.')).toBeInTheDocument();
    expect(screen.getByText(/Injury report unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/No games scheduled/)).toBeInTheDocument();
  });

  it('still renders the top 5 teams', async () => {
    stubApi(fullHub);
    renderWithProviders(<Dashboard />);

    await waitFor(() => expect(screen.getByText('Top 5 Teams (average)')).toBeInTheDocument());
    expect(screen.getAllByText('50 Shades of Shai').length).toBeGreaterThan(0);
  });
});

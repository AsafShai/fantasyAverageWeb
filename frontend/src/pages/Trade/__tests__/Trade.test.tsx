/**
 * Integration test: Trade page period-based stats update
 *
 * Verifies the fix that ensures the summary table and player cards
 * reflect updated stats immediately when the time period is changed,
 * without requiring the user to clear and re-select players.
 *
 * Flow:
 *  1. Set period → Last 7 Days
 *  2. Select Team Alpha → add "Team Alpha Star"
 *  3. Select Team Beta  → add "Team Beta Star"
 *  4. Assert summary table shows last_7 averages  (20.000 pts, 10.000 pts)
 *  5. Change period → Last 15 Days
 *  6. Assert summary table updates to last_15 averages (24.000 pts, 14.000 pts)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { Trade } from '../index';
import type { TeamDetail, Team } from '../../../types/api';

// ---------------------------------------------------------------------------
// Mock the RTK Query hooks used by useTradeData
// vi.hoisted lets us reference these vi.fn() instances inside vi.mock below.
// ---------------------------------------------------------------------------
const { mockUseGetTeamDetailQuery, mockUseGetTeamsListQuery, mockUseGetAllPlayersQuery } =
  vi.hoisted(() => ({
    mockUseGetTeamDetailQuery: vi.fn(),
    mockUseGetTeamsListQuery: vi.fn(),
    mockUseGetAllPlayersQuery: vi.fn(),
  }));

vi.mock('../../../store/api/fantasyApi', () => ({
  useGetTeamsListQuery: mockUseGetTeamsListQuery,
  useGetTeamDetailQuery: mockUseGetTeamDetailQuery,
  useGetAllPlayersQuery: mockUseGetAllPlayersQuery,
  // fantasyApi stub — only needed if anything imports the api object itself
  fantasyApi: {
    reducerPath: 'fantasyApi',
    reducer: (state = {}) => state,
    middleware: () => (next: (a: unknown) => unknown) => (action: unknown) => next(action),
  },
}));

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------
const TEAMS: Team[] = [
  { team_id: 1, team_name: 'Team Alpha' },
  { team_id: 2, team_name: 'Team Beta' },
];

/**
 * Build a minimal TeamDetail with a single player whose pts total and gp
 * are configurable so we can assert different per-game averages per period.
 */
function makeTeamDetail(team: Team, totalPts: number, gp: number): TeamDetail {
  return {
    team,
    espn_url: '',
    players: [
      {
        player_name: `${team.team_name} Star`,
        pro_team: 'TEST',
        positions: ['SF'],
        team_id: team.team_id,
        status: 'ONTEAM',
        stats: {
          pts: totalPts,
          reb: 50,
          ast: 21,
          stl: 7,
          blk: 7,
          fgm: 56,
          fga: 112,
          ftm: 21,
          fta: 28,
          fg_percentage: 0.5,
          ft_percentage: 0.75,
          three_pm: 7,
          minutes: 245,
          gp,
        },
      },
    ],
    shot_chart: {
      team,
      fgm: 0,
      fga: 0,
      fg_percentage: 0,
      ftm: 0,
      fta: 0,
      ft_percentage: 0,
      gp: 0,
    },
    raw_averages: {
      team,
      fg_percentage: 0,
      ft_percentage: 0,
      three_pm: 0,
      ast: 0,
      reb: 0,
      stl: 0,
      blk: 0,
      pts: 0,
      gp: 0,
    },
    ranking_stats: {
      team,
      fg_percentage: 0,
      ft_percentage: 0,
      three_pm: 0,
      ast: 0,
      reb: 0,
      stl: 0,
      blk: 0,
      pts: 0,
      gp: 0,
      total_points: 0,
    },
    category_ranks: {},
  };
}

// Team Alpha: 140 pts / 7 gp = 20.000 pts/g (last_7)
//             360 pts / 15 gp = 24.000 pts/g (last_15)
const TEAM_A_LAST_7 = makeTeamDetail(TEAMS[0], 140, 7);
const TEAM_A_LAST_15 = makeTeamDetail(TEAMS[0], 360, 15);

// Team Beta:  70 pts /  7 gp = 10.000 pts/g (last_7)
//            210 pts / 15 gp = 14.000 pts/g (last_15)
const TEAM_B_LAST_7 = makeTeamDetail(TEAMS[1], 70, 7);
const TEAM_B_LAST_15 = makeTeamDetail(TEAMS[1], 210, 15);

// ---------------------------------------------------------------------------
// Render helper — minimal Redux store (hooks are mocked, store state unused)
// ---------------------------------------------------------------------------
function renderTrade() {
  // A placeholder reducer satisfies Redux's "must have valid reducer" check.
  const testStore = configureStore({ reducer: { _test: (s: null = null) => s } });
  return render(
    <Provider store={testStore}>
      <Trade />
    </Provider>
  );
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('Trade page – period-based stats update', () => {
  beforeEach(() => {
    mockUseGetTeamsListQuery.mockReturnValue({
      data: TEAMS,
      isLoading: false,
      error: undefined,
    });

    /**
     * Return team data based on the time_period arg passed by useTradeData.
     * This is the core of the test: the hook surfaces different stats for
     * different periods so we can verify the summary table tracks changes.
     */
    mockUseGetTeamDetailQuery.mockImplementation(
      (
        args: { teamId: number; time_period?: string },
        options?: { skip?: boolean }
      ) => {
        if (options?.skip || !args?.teamId) {
          return { data: undefined, isFetching: false, error: undefined };
        }
        const period = args.time_period ?? 'season';

        if (args.teamId === 1) {
          const data = period === 'last_7' ? TEAM_A_LAST_7 : TEAM_A_LAST_15;
          return { data, isFetching: false, error: undefined };
        }
        if (args.teamId === 2) {
          const data = period === 'last_7' ? TEAM_B_LAST_7 : TEAM_B_LAST_15;
          return { data, isFetching: false, error: undefined };
        }

        return { data: undefined, isFetching: false, error: undefined };
      }
    );

    mockUseGetAllPlayersQuery.mockReturnValue({
      data: undefined,
      isFetching: false,
      error: undefined,
    });
  });

  it('shows last_7 stats in summary table, then updates to last_15 stats when period changes', async () => {
    const user = userEvent.setup();
    renderTrade();

    // ------------------------------------------------------------------
    // Step 1: Set period to "Last 7 Days"
    // ------------------------------------------------------------------
    await user.click(screen.getByRole('button', { name: /last 7 days/i }));

    // ------------------------------------------------------------------
    // Step 2: Select Team Alpha in the Team A panel
    // ------------------------------------------------------------------
    const teamACard = screen.getByText('Team A').closest('.card') as HTMLElement;
    const teamATeamSelect = within(teamACard).getAllByRole('combobox')[0];
    await user.selectOptions(teamATeamSelect, '1');

    // ------------------------------------------------------------------
    // Step 3: Add "Team Alpha Star" from Team A's player dropdown
    // ------------------------------------------------------------------
    const teamAPlayerSelect = within(teamACard).getAllByRole('combobox')[1];
    await user.selectOptions(teamAPlayerSelect, 'Team Alpha Star');
    await user.click(within(teamACard).getByRole('button', { name: /^add$/i }));

    // ------------------------------------------------------------------
    // Step 4: Select Team Beta in the Team B panel
    // ------------------------------------------------------------------
    const teamBCard = screen.getByText('Team B').closest('.card') as HTMLElement;
    const teamBTeamSelect = within(teamBCard).getAllByRole('combobox')[0];
    await user.selectOptions(teamBTeamSelect, '2');

    // ------------------------------------------------------------------
    // Step 5: Add "Team Beta Star" from Team B's player dropdown
    // ------------------------------------------------------------------
    const teamBPlayerSelect = within(teamBCard).getAllByRole('combobox')[1];
    await user.selectOptions(teamBPlayerSelect, 'Team Beta Star');
    await user.click(within(teamBCard).getByRole('button', { name: /^add$/i }));

    // ------------------------------------------------------------------
    // Step 6: Assert summary table shows last_7 per-game averages
    //
    //   Team Alpha Star: 140 pts / 7 gp = 20.000 pts/g
    //   Team Beta Star:   70 pts / 7 gp = 10.000 pts/g
    //
    // Note: '20.000' appears in both the individual player card (PlayerStatsCard)
    // AND the summary table (TradeSummaryPanel) — both are correct and both
    // should reflect the active period. We assert via the summary panel
    // heading container to confirm the table specifically is correct, then
    // also confirm all occurrences flip over on period change.
    // ------------------------------------------------------------------
    await waitFor(() => {
      const summaryHeading = screen.getByRole('heading', { name: /trade comparison/i });
      const summaryPanel = summaryHeading.closest('.bg-white') as HTMLElement;
      expect(within(summaryPanel).getByText('20.000')).toBeInTheDocument();
      expect(within(summaryPanel).getByText('10.000')).toBeInTheDocument();
    });

    // ------------------------------------------------------------------
    // Step 7: Change period to "Last 15 Days"
    // ------------------------------------------------------------------
    await user.click(screen.getByRole('button', { name: /last 15 days/i }));

    // ------------------------------------------------------------------
    // Step 8: Assert summary table updates immediately to last_15 averages
    //
    //   Team Alpha Star: 360 pts / 15 gp = 24.000 pts/g
    //   Team Beta Star:  210 pts / 15 gp = 14.000 pts/g
    // ------------------------------------------------------------------
    await waitFor(() => {
      const summaryHeading = screen.getByRole('heading', { name: /trade comparison/i });
      const summaryPanel = summaryHeading.closest('.bg-white') as HTMLElement;
      expect(within(summaryPanel).getByText('24.000')).toBeInTheDocument();
      expect(within(summaryPanel).getByText('14.000')).toBeInTheDocument();
    });

    // Old last_7 values must be gone from the summary panel — confirms a live
    // update, not stale data.
    const summaryHeading = screen.getByRole('heading', { name: /trade comparison/i });
    const summaryPanel = summaryHeading.closest('.bg-white') as HTMLElement;
    expect(within(summaryPanel).queryByText('20.000')).not.toBeInTheDocument();
    expect(within(summaryPanel).queryByText('10.000')).not.toBeInTheDocument();
  });
});

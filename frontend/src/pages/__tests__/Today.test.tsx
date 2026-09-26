import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TodayHub } from '../../types/api';
import { createTestStore, renderWithProviders } from '../../test/helpers';
import Today from '../Today';

const flagState = vi.hoisted(() => ({ FF_TODAY_HUB: true }));
vi.mock('../../config/featureFlags', async importOriginal => {
  const actual = await importOriginal<typeof import('../../config/featureFlags')>();
  return {
    ...actual,
    get FF_TODAY_HUB() {
      return flagState.FF_TODAY_HUB;
    },
  };
});

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
  movers: Array.from({ length: 8 }, (_, i) => ({
    team_id: i + 1,
    team_name: `Mover Team ${i + 1}`,
    category: i === 0 ? 'TOTAL' : 'AST',
    delta: i === 0 ? -1.5 : 8 - i,
  })),
  roster_health: [
    {
      team_id: 3, team_name: "Amihai's Awesome", games_tonight: 11, available_tonight: 4,
      probable: 1, questionable: 2, doubtful: 1, out: 3,
    },
    {
      team_id: 1, team_name: '50 Shades of Shai', games_tonight: 7, available_tonight: 6,
      probable: 0, questionable: 1, doubtful: 0, out: 0,
    },
    {
      team_id: 4, team_name: 'Nobody Playing Tonight', games_tonight: 0, available_tonight: 0,
      probable: 0, questionable: 0, doubtful: 0, out: 0,
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

describe('Today page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    flagState.FF_TODAY_HUB = true;
  });

  it('renders all five sections: deadline, heading, panels, averages, top 5', async () => {
    stubApi(fullHub);
    renderWithProviders(<Today />);

    await waitFor(() => expect(screen.getByText('Rank movers')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByText('Roster health today')).toBeInTheDocument();
    expect(screen.getByText('League averages')).toBeInTheDocument();
    expect(screen.getByText('Top 5 Teams (average)')).toBeInTheDocument();

    expect(screen.getByText('TOTAL')).toBeInTheDocument();
    expect(screen.getByText('▲ 7')).toBeInTheDocument();
    expect(screen.getByText('▼ 1.5')).toBeInTheDocument();
    expect(screen.getByText('112.70')).toBeInTheDocument();
    expect(screen.getAllByText('50 Shades of Shai').length).toBeGreaterThan(0);
  });

  it('renders every mover row at any width, with no show-all button', async () => {
    stubApi(fullHub);
    renderWithProviders(<Today />);

    await waitFor(() => expect(screen.getByText('Mover Team 1')).toBeInTheDocument());
    for (let i = 1; i <= 8; i += 1) {
      expect(screen.getByText(`Mover Team ${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /show all/i })).not.toBeInTheDocument();
  });

  it('shows the games-tonight and five injury counts, including a team with nobody playing', async () => {
    stubApi(fullHub);
    renderWithProviders(<Today />);

    await waitFor(() => expect(screen.getByText('Roster health today')).toBeInTheDocument());
    const headers = screen.getAllByRole('columnheader').map(h => h.textContent);
    expect(headers).toEqual(
      expect.arrayContaining([
        'Team',
        'GAMES',
        'AvailableAVAILABLEAvailable',
        'ProbablePProbable',
        'QuestionableQQuestionable',
        'DoubtfulDDoubtful',
        'OutOUTOut',
      ]),
    );

    const row = screen.getByText("Amihai's Awesome").closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('11')).toBeInTheDocument();

    const zeroRow = screen.getByText('Nobody Playing Tonight').closest('tr');
    expect(zeroRow).not.toBeNull();
    const zeroCells = within(zeroRow as HTMLElement).getAllByRole('cell');
    expect(zeroCells.slice(1).every(cell => cell.textContent === '0')).toBe(true);
  });

  it('shows the roster-health summary tiles derived from the slate and rosters', async () => {
    stubApi(fullHub);
    renderWithProviders(<Today />);

    await waitFor(() => expect(screen.getByText('NBA games')).toBeInTheDocument());
    expect(screen.getByText('teams playing')).toBeInTheDocument();
    expect(screen.getByText('available')).toBeInTheDocument();
    expect(screen.getByText('Out tonight')).toBeInTheDocument();
  });

  it('shows empty states when the hub has nothing to report', async () => {
    stubApi(emptyHub);
    renderWithProviders(<Today />);

    await waitFor(() =>
      expect(screen.getByText('Movers appear after the second scoring period.')).toBeInTheDocument(),
    );
    expect(screen.getByText('No NBA games scheduled.')).toBeInTheDocument();
    expect(screen.getByText(/Injury report unavailable/)).toBeInTheDocument();
  });

  it('sorts rank movers by category and toggles direction on a second click', async () => {
    stubApi(fullHub);
    renderWithProviders(<Today />);

    await waitFor(() => expect(screen.getByText('Rank movers')).toBeInTheDocument());
    const catHeader = screen.getByRole('button', { name: /^cat$/i });

    const firstRowTeamCell = () => screen.getAllByRole('row')[1].querySelectorAll('td')[0];

    expect(firstRowTeamCell().textContent).toBe('Mover Team 1');

    await userEvent.click(catHeader);
    await waitFor(() => expect(firstRowTeamCell().textContent).toBe('Mover Team 2'));

    await userEvent.click(catHeader);
    await waitFor(() => expect(firstRowTeamCell().textContent).toBe('Mover Team 1'));
  });

  it('filters rank movers by team', async () => {
    stubApi(fullHub);
    renderWithProviders(<Today />);

    await waitFor(() => expect(screen.getByText('Mover Team 1')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /all teams/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /mover team 1/i }));

    const table = screen.getAllByRole('table')[0];
    expect(within(table).queryByText('Mover Team 2')).not.toBeInTheDocument();
    expect(within(table).getByText('Mover Team 1')).toBeInTheDocument();
  });

  it('filters rank movers by category', async () => {
    stubApi(fullHub);
    renderWithProviders(<Today />);

    await waitFor(() => expect(screen.getByText('Mover Team 1')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /all categories/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /^total$/i }));

    const table = screen.getAllByRole('table')[0];
    expect(within(table).getByText('Mover Team 1')).toBeInTheDocument();
    expect(within(table).queryByText('Mover Team 2')).not.toBeInTheDocument();
  });

  it('combines the team and category filters with AND', async () => {
    stubApi(fullHub);
    renderWithProviders(<Today />);

    await waitFor(() => expect(screen.getByText('Mover Team 1')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /all teams/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /mover team 1/i }));

    await userEvent.click(screen.getByRole('button', { name: /all categories/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /^ast$/i }));

    expect(screen.getByText('No movers match the selected filters.')).toBeInTheDocument();
  });

  it('closes the team filter dropdown on Escape', async () => {
    stubApi(fullHub);
    renderWithProviders(<Today />);

    await waitFor(() => expect(screen.getByText('Mover Team 1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /all teams/i }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('gives rank movers a scrollable region with a sticky header, and no vertical scroll on roster health', async () => {
    stubApi(fullHub);
    renderWithProviders(<Today />);

    await waitFor(() => expect(screen.getByText('Rank movers')).toBeInTheDocument());

    const moversHeading = screen.getByText('Rank movers');
    const moversCard = moversHeading.closest('div.rounded-lg') as HTMLElement;
    const moversScroller = moversCard.querySelector('.overflow-y-auto');
    expect(moversScroller).not.toBeNull();
    expect(moversScroller?.querySelector('th.sticky, [class*="sticky"]')).not.toBeNull();

    const rosterHeading = screen.getByText('Roster health today');
    const rosterCard = rosterHeading.closest('div.rounded-lg') as HTMLElement;
    expect(rosterCard.querySelector('.overflow-y-auto')).toBeNull();
  });
});

describe('index route gating', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    flagState.FF_TODAY_HUB = true;
  });

  it('renders Today at "/" when the flag is on', async () => {
    flagState.FF_TODAY_HUB = true;
    stubApi(fullHub);

    const { default: App } = await import('../../App');
    const store = createTestStore();
    render(
      <MemoryRouter initialEntries={['/']}>
        <Provider store={store}>
          <App />
        </Provider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument());
    expect(screen.getByText('Rank movers')).toBeInTheDocument();
  });

  it('renders the old Dashboard at "/" when the flag is off, and never calls getTodayHub', async () => {
    flagState.FF_TODAY_HUB = false;
    stubApi(fullHub);

    const { default: App } = await import('../../App');
    const store = createTestStore();
    render(
      <MemoryRouter initialEntries={['/']}>
        <Provider store={store}>
          <App />
        </Provider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('League Overview')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Today' })).not.toBeInTheDocument();
    expect(screen.queryByText('Rank movers')).not.toBeInTheDocument();

    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const calledUrls = calls.map(([input]) => requestUrl(input as RequestInfo | URL));
    expect(calledUrls.some(url => url.includes('/league/today'))).toBe(false);
  });
});

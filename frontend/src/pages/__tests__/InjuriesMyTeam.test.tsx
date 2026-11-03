import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InjuryRecord } from '../../types/injury';
import { renderWithProviders } from '../../test/helpers';
import Injuries from '../Injuries';

// With My Team set, the injury report still opens on every team. The
// scope control narrows it only when a narrower choice is selected.

const { mockUseInjuryData } = vi.hoisted(() => ({ mockUseInjuryData: vi.fn() }));

vi.mock('../../hooks/useInjuryData', () => ({
  useInjuryData: () => mockUseInjuryData(),
}));

vi.mock('../../context/MyTeamContext', () => {
  const myTeam = { team_id: 1, team_name: 'Fantasy One' };
  return {
    useMyTeam: () => ({
      teams: [myTeam],
      myTeam,
      myTeamId: 1,
      isMyTeam: (id: number | null | undefined) => id === 1,
      setMyTeamId: () => {},
    }),
  };
});

const rec = (player: string, team: string): InjuryRecord => ({
  game: 'A@B', team, player, status: 'Out', injury: '', last_update: '2025-01-01T00:00:00Z',
});

const requestUrl = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

describe('Injuries page with My Team set', () => {
  let rosterRequests = 0;

  beforeEach(() => {
    rosterRequests = 0;
    mockUseInjuryData.mockReturnValue({
      records: [rec('Mine Guy', 'DAL'), rec('Other Guy', 'BOS'), rec('Third Guy', 'LAL')],
      loading: false,
      error: null,
      notifications: [],
      lastReportTime: null,
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (requestUrl(input).includes('/teams/1')) {
        rosterRequests++;
        return new Response(JSON.stringify({
          team: { team_id: 1, team_name: 'Fantasy One' },
          players: [{ player_name: 'Mine Guy', pro_team: 'DAL', positions: ['PG'], team_id: 1, status: 'ONTEAM', stats: {} }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows every team by default, with All selected', () => {
    renderWithProviders(<Injuries />);
    expect(screen.getByRole('radio', { name: 'All' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'My players' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: "My players' teams" })).not.toBeChecked();
    expect(screen.getByText(/showing 3 of 3 player/i)).toBeInTheDocument();
    expect(screen.getAllByText('Other Guy').length).toBeGreaterThan(0);
    // The roster isn't fetched until it's needed.
    expect(rosterRequests).toBe(0);
  });

  it('narrows to my players when that choice is selected, and back from All', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Injuries />);
    await user.click(screen.getByRole('radio', { name: 'My players' }));
    await waitFor(() => expect(screen.getByText(/showing 1 of 3 player/i)).toBeInTheDocument());
    expect(screen.getByText('Only players on your roster.')).toBeInTheDocument();
    expect(screen.queryByText('Other Guy')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'All' }));
    expect(screen.getByText(/showing 3 of 3 player/i)).toBeInTheDocument();
  });

  it('keeps every injury on an NBA team one of my players plays for', async () => {
    const user = userEvent.setup();
    mockUseInjuryData.mockReturnValue({
      records: [
        rec('Mine Guy', 'Dallas Mavericks'),
        rec('Teammate', 'Dallas Mavericks'),
        rec('Other Guy', 'Boston Celtics'),
      ],
      loading: false,
      error: null,
      notifications: [],
      lastReportTime: null,
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/nba-teams/')) {
        return new Response(JSON.stringify([
          { team_id: '6', abbreviation: 'DAL', team_name: 'Dallas Mavericks' },
          { team_id: '2', abbreviation: 'BOS', team_name: 'Boston Celtics' },
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/teams/1')) {
        return new Response(JSON.stringify({
          team: { team_id: 1, team_name: 'Fantasy One' },
          players: [{ player_name: 'Mine Guy', pro_team: 'DAL', positions: ['PG'], team_id: 1, status: 'ONTEAM', stats: {} }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    }));
    renderWithProviders(<Injuries />);
    await user.click(screen.getByRole('radio', { name: "My players' teams" }));
    await waitFor(() => expect(screen.getByText(/showing 2 of 3 player/i)).toBeInTheDocument());
    expect(screen.getByText(/every injury on an nba team/i)).toBeInTheDocument();
    expect(screen.getAllByText('Mine Guy').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Teammate').length).toBeGreaterThan(0);
    expect(screen.queryByText('Other Guy')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'My players' }));
    await waitFor(() => expect(screen.getByText(/showing 1 of 3 player/i)).toBeInTheDocument());
    expect(screen.queryByText('Teammate')).not.toBeInTheDocument();
  });

  it('limits the team dropdown to scoped teams and drops out-of-scope picks', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/nba-teams/')) {
        return new Response(JSON.stringify([
          { team_id: '6', abbreviation: 'DAL', team_name: 'Dallas Mavericks' },
          { team_id: '2', abbreviation: 'BOS', team_name: 'Boston Celtics' },
          { team_id: '13', abbreviation: 'LAL', team_name: 'Los Angeles Lakers' },
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/teams/1')) {
        return new Response(JSON.stringify({
          team: { team_id: 1, team_name: 'Fantasy One' },
          players: [{ player_name: 'Mine Guy', pro_team: 'DAL', positions: ['PG'], team_id: 1, status: 'ONTEAM', stats: {} }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    }));
    renderWithProviders(<Injuries />);
    await user.click(screen.getAllByRole('button', { name: /all teams/i })[0]!);
    await user.click(screen.getByRole('checkbox', { name: 'LAL' }));
    expect(screen.getByText(/showing 1 of 3 player/i)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: "My players' teams" }));
    await waitFor(() => expect(screen.queryByText(/loading your roster/i)).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: /all teams in view/i })).toBeInTheDocument());
    expect(screen.getByText(/showing 1 of 3 player/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /all teams in view/i }));
    expect(screen.queryByRole('checkbox', { name: 'LAL' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'DAL' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'BOS' })).not.toBeInTheDocument();
  });
});

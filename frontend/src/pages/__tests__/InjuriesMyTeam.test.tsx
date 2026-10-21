import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InjuryRecord } from '../../types/injury';
import { renderWithProviders } from '../../test/helpers';
import Injuries from '../Injuries';

// With My Team set, the injury report still opens on every team; the
// "My roster" box narrows it only when ticked.

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

  it('shows every team by default, with "My roster" unticked', () => {
    renderWithProviders(<Injuries />);
    expect(screen.getByRole('checkbox', { name: 'My roster' })).not.toBeChecked();
    expect(screen.getByText(/showing 3 of 3 player/i)).toBeInTheDocument();
    expect(screen.getAllByText('Other Guy').length).toBeGreaterThan(0);
    // The roster isn't fetched until it's needed.
    expect(rosterRequests).toBe(0);
  });

  it('narrows to my roster when "My roster" is ticked, and back when unticked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Injuries />);
    await user.click(screen.getByRole('checkbox', { name: 'My roster' }));
    await waitFor(() => expect(screen.getByText(/showing 1 of 3 player/i)).toBeInTheDocument());
    expect(screen.queryByText('Other Guy')).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'My roster' }));
    expect(screen.getByText(/showing 3 of 3 player/i)).toBeInTheDocument();
  });
});

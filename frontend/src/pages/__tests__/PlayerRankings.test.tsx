import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '../../types/api';
import { renderWithProviders } from '../../test/helpers';
import PlayerRankings from '../PlayerRankings';

function player(name: string, minutes: number, gp: number, pts: number): Player {
  return {
    player_name: name,
    pro_team: 'LAL',
    positions: ['PG'],
    stats: {
      pts, reb: 5 * gp, ast: 5 * gp, stl: gp, blk: gp, three_pm: 2 * gp,
      fg_percentage: 0.47, ft_percentage: 0.85,
      fgm: 8 * gp, fga: 17 * gp, ftm: 4 * gp, fta: 5 * gp,
      minutes, gp,
    },
    team_id: 0,
    status: 'FREEAGENT',
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

describe('PlayerRankings page', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.includes('/players/')) {
          return jsonResponse({
            players: [player('Alpha Guard', 700, 20, 600), player('Beta Wing', 300, 10, 150)],
            total_count: 2, page: 1, limit: 1200, has_more: false,
          });
        }
        if (url.includes('/teams/')) return jsonResponse([]);
        if (url.includes('/league/activity/latest')) return jsonResponse({ teams: [], moves: [] });
        return new Response('not found', { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows minutes per game, or total minutes, following the display mode', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PlayerRankings />);
    await waitFor(() => expect(screen.getByText('Alpha Guard')).toBeInTheDocument());

    expect(screen.getByRole('columnheader', { name: 'MPG' })).toBeInTheDocument();
    expect(within(screen.getByText('Alpha Guard').closest('tr')!).getByText('35.0')).toBeInTheDocument();

    const displayGroup = screen.getByText('Display mode').parentElement!;
    await user.click(within(displayGroup).getByRole('button', { name: 'Totals' }));

    expect(screen.getByRole('columnheader', { name: 'MIN' })).toBeInTheDocument();
    expect(within(screen.getByText('Alpha Guard').closest('tr')!).getByText('700')).toBeInTheDocument();
  });

  it('has no minutes z-score column, so minutes are not part of the ranking', async () => {
    renderWithProviders(<PlayerRankings />);
    await waitFor(() => expect(screen.getByText('Alpha Guard')).toBeInTheDocument());
    const headers = screen.getAllByRole('columnheader').map(h => h.textContent ?? '');
    expect(headers.some(h => /^(MIN|MPG)_z/.test(h))).toBe(false);
  });

  it('sorts by the minutes column', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PlayerRankings />);
    await waitFor(() => expect(screen.getByText('Alpha Guard')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'MPG' }));
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Alpha Guard');
    await user.click(screen.getByRole('button', { name: /MPG/ }));
    const ascRows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(ascRows[0]).toHaveTextContent('Beta Wing');
  });
});

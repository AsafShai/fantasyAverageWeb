import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player, Team } from '../../types/api';
import { renderWithProviders } from '../../test/helpers';
import Players from '../Players';

const teams: Team[] = [{ team_id: 1, team_name: 'Fantasy One' }];

function basePlayer(overrides: Partial<Player> = {}): Player {
  return {
    player_name: 'Alpha Star',
    pro_team: 'LAL',
    positions: ['PG', 'SG'],
    team_id: 1,
    status: 'ONTEAM',
    stats: {
      pts: 250,
      reb: 80,
      ast: 40,
      stl: 10,
      blk: 5,
      fgm: 100,
      fga: 200,
      ftm: 40,
      fta: 50,
      fg_percentage: 0.5,
      ft_percentage: 0.8,
      three_pm: 30,
      minutes: 800,
      gp: 10,
    },
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

describe('Players page', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.includes('/players')) {
          return jsonResponse({
            players: [
              basePlayer(),
              basePlayer({
                player_name: 'Bench Guy',
                positions: ['C'],
                stats: { ...basePlayer().stats, pts: 50 },
              }),
            ],
            total_count: 2,
            page: 1,
            limit: 500,
            has_more: false,
          });
        }
        if (url.includes('/teams/') && !url.toLowerCase().includes('nba')) {
          return jsonResponse(teams);
        }
        return new Response('not found', { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders table and showing count', async () => {
    renderWithProviders(<Players />);
    await waitFor(() => expect(screen.queryByText(/loading players/i)).not.toBeInTheDocument());
    expect(screen.getAllByText(/showing 2 players/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Alpha Star')).toBeInTheDocument();
  });

  it('search filters rows', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Players />);
    await waitFor(() => expect(screen.getByText('Bench Guy')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText(/search players/i), 'Alpha');
    expect(screen.getAllByText(/showing 1 players/i).length).toBeGreaterThan(0);
    expect(screen.queryByText('Bench Guy')).not.toBeInTheDocument();
  });

  it('position filter PG', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Players />);
    await waitFor(() => expect(screen.getByText('Bench Guy')).toBeInTheDocument());
    await user.click(screen.getByRole('checkbox', { name: /^PG$/ }));
    expect(screen.getAllByText(/showing 1 players/i).length).toBeGreaterThan(0);
    expect(screen.queryByText('Bench Guy')).not.toBeInTheDocument();
  });

  it('stat filter PTS > 20 per game', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Players />);
    await waitFor(() => expect(screen.getByText('Bench Guy')).toBeInTheDocument());
    const combos = screen.getAllByRole('combobox');
    await user.selectOptions(combos[1], 'pts');
    await user.selectOptions(combos[2], 'gt');
    await user.clear(screen.getByPlaceholderText('Value'));
    await user.type(screen.getByPlaceholderText('Value'), '20');
    await user.click(screen.getByRole('button', { name: /^add filter$/i }));
    expect(screen.getAllByText(/showing 1 players/i).length).toBeGreaterThan(0);
  });

  it('sort PTS toggle asc and desc', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Players />);
    await waitFor(() => expect(screen.getByText('Bench Guy')).toBeInTheDocument());
    const ppg = screen.getByRole('columnheader', { name: /PPG/i });
    await user.click(ppg);
    const table = screen.getByRole('table');
    let dataRows = within(table).getAllByRole('row').slice(1);
    expect(within(dataRows[0]).getByText('Alpha Star')).toBeInTheDocument();
    await user.click(ppg);
    dataRows = within(table).getAllByRole('row').slice(1);
    expect(within(dataRows[0]).getByText('Bench Guy')).toBeInTheDocument();
  });

  it('Per Game vs Totals toggles header label', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Players />);
    await waitFor(() => expect(screen.getByText('Alpha Star')).toBeInTheDocument());
    expect(screen.getByRole('columnheader', { name: /PPG/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^totals$/i }));
    expect(screen.getByRole('columnheader', { name: /^PTS/i })).toBeInTheDocument();
  });

  it('loading state', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    renderWithProviders(<Players />);
    expect(screen.getByText(/loading players/i)).toBeInTheDocument();
  });

  it('error state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.includes('/players')) return jsonResponse({ detail: 'err' }, 500);
        if (url.includes('/teams/') && !url.toLowerCase().includes('nba')) return jsonResponse(teams);
        return new Response('not found', { status: 404 });
      }),
    );
    renderWithProviders(<Players />);
    await waitFor(() => expect(screen.getByText(/error loading players/i)).toBeInTheDocument());
  });
});

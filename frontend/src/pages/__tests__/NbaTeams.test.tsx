import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamDepthChart } from '../../types/api';
import { renderWithProviders } from '../../test/helpers';
import NbaTeams from '../NbaTeams';

const nbaTeams = [{ team_id: '13', abbreviation: 'LAL', team_name: 'Lakers' }];

const depthChart: TeamDepthChart = {
  team_id: '13',
  team_name: 'Lakers',
  team_abbreviation: 'LAL',
  team_logo: '',
  record: '10-5',
  positions: [
    {
      abbreviation: 'PG',
      display_name: 'Point Guard',
      players: [
        { id: '1', display_name: 'Healthy', short_name: 'H' },
        {
          id: '2',
          display_name: 'Hurt',
          short_name: 'Hu',
          injury: { status: 'Out' },
        },
        { id: '3', display_name: 'Dup', short_name: 'D' },
      ],
    },
    {
      abbreviation: 'SG',
      display_name: 'Shooting Guard',
      players: [
        { id: '3', display_name: 'Dup', short_name: 'D' },
        { id: '4', display_name: 'Two', short_name: 'T' },
      ],
    },
  ],
};

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

describe('NbaTeams page', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.includes('/nba-teams/') && url.includes('depthchart')) {
          return jsonResponse(depthChart);
        }
        if (url.includes('/nba-teams/')) {
          return jsonResponse(nbaTeams);
        }
        return new Response('not found', { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows team dropdown and select prompt until team chosen', async () => {
    renderWithProviders(<NbaTeams />);
    await waitFor(() => expect(screen.queryByText(/loading\.\.\./i)).not.toBeInTheDocument());
    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('selecting team renders depth chart and player names', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NbaTeams />);
    await waitFor(() => expect(screen.getByRole('option', { name: /lakers/i })).toBeInTheDocument());
    await user.selectOptions(screen.getByRole('combobox'), '13');
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('Point Guard')).toBeInTheDocument();
  });

  it('excluding Out status removes Out players', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NbaTeams />);
    await waitFor(() => expect(screen.getByRole('option', { name: /lakers/i })).toBeInTheDocument());
    await user.selectOptions(screen.getByRole('combobox'), '13');
    await waitFor(() => expect(screen.getByText('Hurt')).toBeInTheDocument());
    await user.click(screen.getByRole('checkbox', { name: /^out$/i }));
    expect(screen.queryByText('Hurt')).not.toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('remove duplicates keeps dup only in higher priority position', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NbaTeams />);
    await waitFor(() => expect(screen.getByRole('option', { name: /lakers/i })).toBeInTheDocument());
    await user.selectOptions(screen.getByRole('combobox'), '13');
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    await user.click(screen.getByRole('checkbox', { name: /remove duplicates/i }));
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    const pgRow = rows.find((r) => within(r).queryByText('Point Guard'));
    const sgRow = rows.find((r) => within(r).queryByText('Shooting Guard'));
    expect(pgRow && within(pgRow).queryByText('Dup')).toBeFalsy();
    expect(sgRow && within(sgRow).getByText('Dup')).toBeTruthy();
  });

  it('switching team resets filters via remount', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.includes('depthchart')) {
          const id = url.match(/nba-teams\/(\d+)/)?.[1];
          return jsonResponse({ ...depthChart, team_id: id ?? '13', team_name: id === '14' ? 'Celtics' : 'Lakers' });
        }
        if (url.includes('/nba-teams/')) {
          return jsonResponse([
            ...nbaTeams,
            { team_id: '14', abbreviation: 'BOS', team_name: 'Celtics' },
          ]);
        }
        return new Response('not found', { status: 404 });
      }),
    );
    renderWithProviders(<NbaTeams />);
    await waitFor(() => expect(screen.getByRole('option', { name: /lakers/i })).toBeInTheDocument());
    await user.selectOptions(screen.getByRole('combobox'), '13');
    await waitFor(() => expect(screen.getByText('Hurt')).toBeInTheDocument());
    await user.click(screen.getByRole('checkbox', { name: /^out$/i }));
    expect(screen.queryByText('Hurt')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox'), '14');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: /celtics/i })).toBeInTheDocument(),
    );
    const inj = screen.queryByRole('checkbox', { name: /^out$/i });
    expect(inj).not.toBeChecked();
  });

  it('loading teams shows spinner', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    renderWithProviders(<NbaTeams />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('teams error shows message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ detail: 'x' }, 500)),
    );
    renderWithProviders(<NbaTeams />);
    await waitFor(() => expect(screen.getByText(/failed to load teams/i)).toBeInTheDocument());
  });
});

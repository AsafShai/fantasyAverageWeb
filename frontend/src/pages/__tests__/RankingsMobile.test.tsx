import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankingStats } from '../../types/api';
import { renderWithProviders } from '../../test/helpers';
import Rankings from '../Rankings';

// Phone + redesign flag on: the page renders RankingsMobile.
vi.mock('../../mobile/flag', () => ({ useMobileRedesign: () => true }));

const ALL_CATEGORIES = ['FG%', 'FT%', '3PM', 'AST', 'REB', 'STL', 'BLK', 'PTS'];

describe('Rankings page — phone redesign', () => {
function team(overrides: Partial<RankingStats> = {}): RankingStats {
  const base = {
    team: { team_id: 1, team_name: 'Alpha Squad' },
    fg_percentage: 0.467,
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
    category_ranks: { 'FG%': 2, 'FT%': 2, '3PM': 2, AST: 2, REB: 2, STL: 2, BLK: 2, PTS: 2 },
    ...overrides,
  };
  // `stats` mirrors the fixed fields above by default (as the real API does),
  // unless the caller supplies its own `stats` override.
  const stats = overrides.stats ?? {
    'FG%': base.fg_percentage,
    'FT%': base.ft_percentage,
    '3PM': base.three_pm,
    AST: base.ast,
    REB: base.reb,
    STL: base.stl,
    BLK: base.blk,
    PTS: base.pts,
  };
  return { ...base, stats };
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

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.includes('/rankings')) {
          return jsonResponse({
            averages_rankings: [
              team({
                team: { team_id: 1, team_name: 'Alpha Squad' },
                rank: 1,
                total_points: 8,
                pts: 115.3,
                fg_percentage: 0.467,
                category_ranks: { 'FG%': 3, 'FT%': 1, '3PM': 2, AST: 2, REB: 2, STL: 2, BLK: 2, PTS: 2 },
              }),
              team({
                team: { team_id: 2, team_name: 'Beta Ballers' },
                rank: 2,
                total_points: 4,
                pts: 121.0,
                fg_percentage: 0.444,
                category_ranks: { 'FG%': 1, 'FT%': 3, '3PM': 3, AST: 1, REB: 1, STL: 1, BLK: 3, PTS: 3 },
              }),
            ],
            totals_rankings: [
              team({
                team: { team_id: 1, team_name: 'Alpha Squad' },
                rank: 2,
                total_points: 4,
                pts: 4000,
                category_ranks: { 'FG%': 2, 'FT%': 2, '3PM': 2, AST: 2, REB: 2, STL: 2, BLK: 2, PTS: 1 },
              }),
              team({
                team: { team_id: 2, team_name: 'Beta Ballers' },
                rank: 1,
                total_points: 8,
                pts: 9000,
                category_ranks: { 'FG%': 1, 'FT%': 1, '3PM': 1, AST: 1, REB: 1, STL: 1, BLK: 1, PTS: 2 },
              }),
            ],
            categories: [...ALL_CATEGORIES, 'TOTAL_POINTS'],
            last_updated: '2026-08-19',
          });
        }
        if (url.includes('/league/rank-changes?mode=totals')) {
          return jsonResponse({
            previous_period: 11,
            latest_period: 12,
            teams: [
              { team_id: 1, team_name: 'Alpha Squad', rank_delta: -1, total_delta: -4, gp_delta: 3, categories: { PTS: -1 } },
              { team_id: 2, team_name: 'Beta Ballers', rank_delta: 1, total_delta: 4, gp_delta: 4, categories: {} },
            ],
          });
        }
        if (url.includes('/league/rank-changes?mode=averages')) {
          return jsonResponse({
            previous_period: 11,
            latest_period: 12,
            teams: [
              { team_id: 1, team_name: 'Alpha Squad', rank_delta: 1, total_delta: 2, gp_delta: 3, categories: { 'FG%': 2, PTS: 0 } },
              { team_id: 2, team_name: 'Beta Ballers', rank_delta: -1, total_delta: -2, gp_delta: 4, categories: { AST: -1 } },
            ],
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
    localStorage.clear();
  });

  const bodyText = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map(r => r.textContent).join(' ');
  const rowOf = (name: string) => within(screen.getByRole('table')).getByText(name).closest('tr')!;

  it('keeps the title, explainer, Layout / Show / Values toggles and both summary tiles', async () => {
    renderWithProviders(<Rankings />);
    expect(await screen.findByRole('heading', { name: 'Team Rankings (Averages)' })).toBeInTheDocument();
    for (const g of ['Layout', 'Show', 'Values']) expect(screen.getByRole('radiogroup', { name: g })).toBeInTheDocument();
    expect(screen.getByText('⚡ NBA Avg Pace')).toBeInTheDocument();
    expect(screen.getByText('100.0')).toBeInTheDocument();
    expect(screen.getByText('📅 Days Remaining')).toBeInTheDocument();
    expect(screen.getByText(/▲\/▼ = change since last night/)).toBeInTheDocument();
  });

  it('pins "#rank team" with the rank move and shows colored deltas in Rankings view', async () => {
    renderWithProviders(<Rankings />);
    await screen.findByRole('table');
    await waitFor(() => expect(rowOf('Alpha Squad').textContent).toContain('▲'));
    const alpha = rowOf('Alpha Squad');
    expect(within(alpha).getByRole('rowheader').textContent).toBe('#1 Alpha Squad▲1');
    const cells = within(alpha).getAllByRole('cell');
    expect(cells[0].textContent).toBe('3▲2'); // FG% points, up 2
    expect(cells.at(-2)!.textContent).toBe('8▲2'); // total
    expect(cells.at(-1)!.textContent).toBe('50+3'); // games last night
  });

  it('Standings view shows values with no deltas and no movers toggle', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Rankings />);
    await screen.findByRole('table');
    await waitFor(() => expect(rowOf('Alpha Squad').textContent).toContain('▲'));
    await user.click(screen.getByRole('radio', { name: 'Standings' }));
    expect(screen.getByRole('heading', { name: 'Team Standings (Averages)' })).toBeInTheDocument();
    expect(bodyText()).not.toMatch(/▲|▼|–|\+3/);
    expect(within(rowOf('Alpha Squad')).getByText('115.3000')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /movers/i })).not.toBeInTheDocument();
  });

  it('Hide movers removes the deltas; Show movers brings them back', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Rankings />);
    await user.click(await screen.findByRole('button', { name: /Hide movers/ }));
    expect(bodyText()).not.toMatch(/▲|▼/);
    await user.click(screen.getByRole('button', { name: /Show movers/ }));
    await waitFor(() => expect(rowOf('Alpha Squad').textContent).toContain('▲'));
  });

  it('sorts from the column headers and keeps rank and team sorts on the pinned column', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Rankings />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'PTS' }));
    let names = within(screen.getByRole('table')).getAllByRole('rowheader').map(r => r.textContent);
    expect(names[0]).toContain('Beta Ballers'); // PTS points 3 > 2, desc
    await user.click(screen.getByRole('button', { name: 'Sort by team name' }));
    await user.click(screen.getByRole('button', { name: 'Sort by team name' }));
    names = within(screen.getByRole('table')).getAllByRole('rowheader').map(r => r.textContent);
    expect(names[0]).toContain('Alpha Squad'); // A→Z
  });

  it('date range is collapsed behind a button and keeps From/To, Apply, Clear and Quick range', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Rankings />);
    const toggle = await screen.findByRole('button', { name: /Date range: Season/ });
    expect(screen.queryByText('Quick range')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set date range to last 7 days through today' }));
    expect((screen.getByLabelText('To') as HTMLInputElement).value).not.toBe('');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  it('an applied range shows in the range button and hides the movers', async () => {
    renderWithProviders(<Rankings />, { route: '/?from=2025-10-05&to=2025-10-20' });
    expect(await screen.findByRole('button', { name: /Date range: Oct 5 – Oct 20/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /movers/i })).not.toBeInTheDocument();
  });

  it('Cards layout shows one card per team with Total, GP, categories and a Sort by control', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Rankings />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('radio', { name: 'Cards' }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const cards = within(screen.getByRole('list', { name: 'Team Rankings (Averages)' })).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('Total')).toBeInTheDocument();
    expect(within(cards[0]).getByText('GP')).toBeInTheDocument();
    for (const k of ALL_CATEGORIES) expect(within(cards[0]).getByText(k)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sort by: Total/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sort descending' })).toBeInTheDocument();
  });

  it('team names link to the team page', async () => {
    renderWithProviders(<Rankings />);
    await screen.findByRole('table');
    expect(within(rowOf('Alpha Squad')).getByRole('link', { name: 'Alpha Squad' })).toHaveAttribute('href', '/team/1');
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Player } from '../../../../types/api';
import { TradeSummaryPanel } from '../TradeSummaryPanel';

const EIGHT_CATS = { PTS: 0, REB: 0, AST: 0, STL: 0, BLK: 0, '3PM': 0, 'FG%': 0, 'FT%': 0 };

const player = (name: string, extra: Record<string, number>, gp = 2): Player => ({
  player_name: name,
  pro_team: 'X',
  positions: ['PG'],
  team_id: 1,
  status: 'ONTEAM',
  stats: {
    pts: 20, reb: 10, ast: 5, stl: 1, blk: 1, fgm: 8, fga: 16, ftm: 4, fta: 5,
    fg_percentage: 0.5, ft_percentage: 0.8, three_pm: 2, minutes: 60, gp,
    stats: { ...EIGHT_CATS, ...extra },
  },
});

const detailGrid = () => document.querySelector('.tc-detail-grid');
const detailHeaders = () => {
  const grid = detailGrid()?.querySelector('.tc-detail-grid__grid');
  if (!grid) return [];
  return [...grid.querySelectorAll('.tc-detail-grid__head:not(.tc-detail-grid__head--left)')].map(h =>
    h.querySelector('div')?.textContent?.trim() ?? h.textContent?.trim() ?? '',
  );
};
const catPills = () => [...document.querySelectorAll('.tc-cat-pill')].map(el => el.textContent);

const renderPanel = (a: Player[], b: Player[]) =>
  render(
    <TradeSummaryPanel
      teamA={{ team_id: 1, team_name: 'A' }}
      teamB={{ team_id: 2, team_name: 'B' }}
      playersA={a}
      playersB={b}
      viewMode="totals"
      tradeMode="team"
    />,
  );

describe('TradeSummaryPanel categories', () => {
  it('opens on the 8 scoring categories, with minutes and games one tap away', async () => {
    const user = userEvent.setup();
    renderPanel([player('a', {})], [player('b', {})]);
    expect(catPills()).toEqual(['FG%', 'FT%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'PTS']);
    expect(screen.getByRole('button', { name: /cats only/ })).toHaveAttribute('aria-pressed', 'true');
    expect(detailGrid()).toBeNull();
    expect(document.querySelector('.tc-z-slider')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Show minutes and games' }));
    expect(detailHeaders()).toEqual(['MIN', 'GP']);
    // The scoring rows stay as they were.
    expect(catPills()).toContain('FG%');
    await user.click(screen.getByRole('button', { name: 'Hide minutes and games' }));
    expect(detailGrid()).toBeNull();
  });

  it('labels the columns over the category rows', () => {
    renderPanel([player('a', {})], [player('b', {})]);
    const head = document.querySelector('.tc-stat-row__bar--head');
    expect(head?.textContent).toContain('Total');
    expect(head?.textContent).toContain('Z edge');
  });

  it('opens the players in a category when that stat is clicked', async () => {
    const user = userEvent.setup();
    renderPanel([player('a', {})], [player('b', {})]);
    // FT% starts open: the row that most needs explaining.
    expect(document.querySelectorAll('.tc-cat-break')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /^FT%/ }));
    expect(document.querySelector('.tc-cat-break')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^FG%/ }));
    expect(document.querySelector('.tc-cat-break')).not.toBeNull();
    expect(screen.getAllByText(/Z in this cat/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('a').length).toBeGreaterThan(0);
    expect(screen.getAllByText('b').length).toBeGreaterThan(0);
  });

  it('adds a counting category the league scores in versus rows', () => {
    renderPanel([player('a', { TO: 3 }), player('a2', { TO: 4 })], [player('b', { TO: 9, 'A/TO': 2 })]);
    expect(catPills()).toContain('TO');
    expect(catPills().some(l => l?.includes('A/TO'))).toBe(false);
  });
});

describe('TradeSummaryPanel categories-only shortcut', () => {
  const EIGHT = ['FG%', 'FT%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'PTS'];

  it('toggles between every column and just the 8 scoring categories', async () => {
    const user = userEvent.setup();
    renderPanel([player('a', {})], [player('b', {})]);
    const toggle = screen.getByRole('button', { name: /cats only/ });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(detailHeaders()).toEqual(['MIN', 'FGM', 'FGA', 'FTM', 'FTA', 'GP']);
    await user.click(toggle);
    expect(catPills()).toEqual(EIGHT);
    expect(detailGrid()).toBeNull();
  });
});

describe('TradeSummaryPanel average z-score', () => {
  const Z: Record<string, number> = { a1: 1, a2: -0.5, b: 0.4 };
  const playerValue = (p: Player) => (p.player_name in Z ? { rank: 1, of: 3, z: Z[p.player_name] } : undefined);

  it('shows average Z in the versus header when player values are available', () => {
    render(
      <TradeSummaryPanel
        teamA={{ team_id: 1, team_name: 'A' }}
        teamB={{ team_id: 2, team_name: 'B' }}
        playersA={[player('a1', {}), player('a2', {}), player('unknown', {})]}
        playersB={[player('b', {})]}
        viewMode="totals"
        tradeMode="team"
        playerValue={playerValue}
      />,
    );
    expect(screen.getByText(/Avg Z \+0\.40/)).toBeInTheDocument();
    expect(screen.getByText(/Avg Z \+0\.25/)).toBeInTheDocument();
  });
});
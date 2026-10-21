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

const headers = () =>
  screen.getByText('Team').parentElement!.querySelectorAll(':scope > div.font-semibold');

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
  it('shows only the fixed columns for a league on the standard 8 categories', () => {
    renderPanel([player('a', {})], [player('b', {})]);
    const labels = [...headers()].map(h => h.textContent).slice(1);
    expect(labels).toEqual([
      '⏰MIN', '🎯FGM', '🏹FGA', '📈FG%', '🆓FTM', '🎯FTA', '📊FT%',
      '🎯3PM', '🏀REB', '🤝AST', '🥷STL', '🛡️BLK', '🏀PTS', '📅GP',
    ]);
  });

  it('adds a counting category the league scores, before GP, with fewer TO as better', () => {
    renderPanel([player('a', { TO: 3 }), player('a2', { TO: 4 })], [player('b', { TO: 9, 'A/TO': 2 })]);
    const labels = [...headers()].map(h => h.textContent);
    expect(labels.slice(-2)).toEqual(['➕TO', '📅GP']);
    expect(labels.some(l => l?.includes('A/TO'))).toBe(false);

    const sevenCell = screen.getByText('7').parentElement!;
    const nineCell = screen.getByText('9').parentElement!;
    expect(sevenCell.className).toContain('bg-green-100');
    expect(nineCell.className).toContain('bg-red-100');
  });
});

describe('TradeSummaryPanel categories-only shortcut', () => {
  const labels = () => [...headers()].map(h => h.textContent).slice(1);
  const EIGHT = ['📈FG%', '📊FT%', '🎯3PM', '🏀REB', '🤝AST', '🥷STL', '🛡️BLK', '🏀PTS'];

  it('shows just the 8 scoring categories, then brings the columns back', async () => {
    const user = userEvent.setup();
    renderPanel([player('a', {})], [player('b', {})]);
    const toggle = screen.getByRole('button', { name: '8 cats only' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(labels()).toEqual(EIGHT);

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(labels()).toHaveLength(14);
  });

  it('restores a custom column choice and leaves the manual checkboxes working', async () => {
    const user = userEvent.setup();
    renderPanel([player('a', {})], [player('b', {})]);
    await user.click(screen.getByRole('button', { name: /Show\/Hide Columns/ }));
    await user.click(screen.getByRole('checkbox', { name: /MIN/ }));
    await user.click(screen.getByRole('checkbox', { name: /GP/ }));
    const custom = labels();
    expect(custom).not.toContain('⏰MIN');

    const toggle = screen.getByRole('button', { name: '8 cats only' });
    await user.click(toggle);
    expect(labels()).toEqual(EIGHT);
    expect(screen.getByRole('checkbox', { name: /FGM/ })).not.toBeChecked();

    // A manual tweak while on just turns the shortcut off.
    await user.click(screen.getByRole('checkbox', { name: /FGM/ }));
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(labels()).toEqual(['🎯FGM', ...EIGHT].sort((a, b) => custom.indexOf(a) - custom.indexOf(b)));

    await user.click(toggle);
    await user.click(toggle);
    expect(labels()).toEqual(['🎯FGM', ...EIGHT].sort((a, b) => custom.indexOf(a) - custom.indexOf(b)));
  });

  it('counts an extra league category such as TO', async () => {
    const user = userEvent.setup();
    renderPanel([player('a', { TO: 3 })], [player('b', { TO: 2 })]);
    await user.click(screen.getByRole('button', { name: '9 cats only' }));
    expect(labels()).toEqual([...EIGHT, '➕TO']);
  });
});

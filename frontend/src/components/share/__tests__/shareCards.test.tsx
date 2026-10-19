import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RankingStats } from '../../../types/api';
import { RankingsShareCard } from '../RankingsShareCard';
import { TradeShareCard } from '../TradeShareCard';
import { formatAsOf, formatCardValue, rotoPlace, rotoTone, rowWinner } from '../shareCardFormat';

const row = (id: number, name: string, rank: number, ranks: Record<string, number>, stats: Record<string, number>): RankingStats => ({
  team: { team_id: id, team_name: name },
  fg_percentage: 0, ft_percentage: 0, three_pm: 0, ast: 0, reb: 0, stl: 0, blk: 0, pts: 0,
  gp: 100, total_points: 20 - rank, rank, category_ranks: ranks, stats,
});

const rows = [
  row(1, 'Wemby Szn', 1, { 'FG%': 1, PTS: 4 }, { 'FG%': 0.4912, PTS: 118.34 }),
  row(2, 'Brick City', 2, { 'FG%': 4, PTS: 1 }, { 'FG%': 0.4655, PTS: 121.7 }),
  row(3, 'Dunk Tank', 3, { 'FG%': 2, PTS: 3 }, { 'FG%': 0.48, PTS: 119 }),
  row(4, 'Mo Bamba Mix', 4, { 'FG%': 3, PTS: 2 }, { 'FG%': 0.47, PTS: 120 }),
];

describe('shareCardFormat', () => {
  it('shortens values to fit a phone-width card', () => {
    expect(formatCardValue('FG%', 0.47912, 'averages')).toBe('47.9');
    expect(formatCardValue('FG%', 47.912, 'totals')).toBe('47.9');
    expect(formatCardValue('PTS', 118.345, 'averages')).toBe('118.3');
    expect(formatCardValue('PTS', 9876.4, 'totals')).toBe('9876');
    expect(formatCardValue('PTS', 12345, 'totals')).toBe('12.3k');
  });

  it('tints the top and bottom three by roto points (12 = first of 12)', () => {
    expect([12, 10, 9, 4, 3, 1].map(p => rotoTone(p, 12))).toEqual(['good', 'good', null, null, 'bad', 'bad']);
    expect(rotoTone(undefined, 12)).toBeNull();
  });

  it('turns roto points into a league place', () => {
    expect(rotoPlace(12, 12)).toBe(1);
    expect(rotoPlace(1, 12)).toBe(12);
    expect(rotoPlace(8.5, 12)).toBe(5);
  });

  it('formats ISO dates and passes other labels through', () => {
    expect(formatAsOf('2026-10-19')).toBe('Oct 19, 2026');
    expect(formatAsOf('Oct 19 9:00 ET')).toBe('Oct 19 9:00 ET');
    expect(formatAsOf(undefined, new Date(2026, 0, 2))).toBe('Jan 2, 2026');
  });

  it('picks the better side, honoring reverse categories', () => {
    expect(rowWinner({ category: 'PTS', values: [10, 8] })).toBe(0);
    expect(rowWinner({ category: 'TO', values: [10, 8], lowerIsBetter: true })).toBe(1);
    expect(rowWinner({ category: 'PTS', values: [5, 5] })).toBeNull();
  });
});

describe('RankingsShareCard', () => {
  const renderCard = (view: 'standings' | 'rankings', highlightTeamId: number | null = null) =>
    render(
      <RankingsShareCard
        dark={false}
        rows={rows}
        categories={['FG%', 'PTS']}
        view={view}
        mode="averages"
        asOf="Oct 19, 2026"
        highlightTeamId={highlightTeamId}
      />,
    );

  it('shows category roto points in the Rankings view, in the page order', () => {
    renderCard('rankings');
    expect(screen.getByText('Roto Rankings')).toBeInTheDocument();
    expect(screen.getByText('Season averages · as of Oct 19, 2026')).toBeInTheDocument();
    const bodyRows = screen.getAllByRole('row').slice(1);
    expect(bodyRows.map(r => within(r).getAllByRole('cell')[1].textContent)).toEqual(['Wemby Szn', 'Brick City', 'Dunk Tank', 'Mo Bamba Mix']);
    expect(within(bodyRows[1]).getAllByRole('cell').map(c => c.textContent)).toEqual(['2', 'Brick City', '4', '1', '18']);
  });

  it('shows compact values in the Standings view', () => {
    renderCard('standings');
    expect(screen.getByText('Roto Standings')).toBeInTheDocument();
    expect(screen.getByText('49.1')).toBeInTheDocument();
    expect(screen.getByText('118.3')).toBeInTheDocument();
  });

  it('highlights my team only when asked', () => {
    const { unmount } = renderCard('rankings');
    expect(document.querySelector('tr.sc-me')).toBeNull();
    unmount();
    renderCard('rankings', 2);
    expect(document.querySelector('tr.sc-me')).toHaveTextContent('Brick City');
  });
});

describe('TradeShareCard', () => {
  it('names the side that wins more categories', () => {
    render(
      <TradeShareCard
        dark
        title="Brick City ⇄ Dunk Tank"
        subtitle="Season · averages"
        sides={[
          { heading: 'Brick City gets', players: ['Tyrese Haliburton'], verdict: 'Brick City gets the better side' },
          { heading: 'Dunk Tank gets', players: ['Jalen Brunson'], verdict: 'Dunk Tank gets the better side' },
        ]}
        rows={[
          { category: 'AST', values: [11.6, 7.9] },
          { category: 'PTS', values: [34.8, 40.2] },
          { category: 'TO', values: [2.1, 3.4], lowerIsBetter: true },
        ]}
        mode="averages"
        highlightSide={null}
      />,
    );
    expect(screen.getByText('Brick City gets the better side · 2 of 3 categories')).toBeInTheDocument();
    expect(screen.getByText('2.1 ▲')).toHaveClass('sc-win');
  });
});

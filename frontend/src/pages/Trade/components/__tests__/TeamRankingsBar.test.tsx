import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TeamRankingsBar } from '../TeamRankingsBar';

describe('TeamRankingsBar', () => {
  it('renders exactly the categories present in categoryRanks, in order', () => {
    render(<TeamRankingsBar categoryRanks={{ 'FG%': 2, PTS: 1, TO: 3 }} />);

    const headers = screen.getAllByRole('columnheader').map(h => h.textContent);
    expect(headers).toEqual(['FG%', 'PTS', 'TO']);
  });

  it('renders each category rank value as a cell', () => {
    render(<TeamRankingsBar categoryRanks={{ PTS: 2, TO: 1 }} />);

    const cells = screen.getAllByRole('cell').map(c => c.textContent);
    expect(cells).toEqual(['2', '1']);
  });

  it('handles an empty categoryRanks without crashing', () => {
    render(<TeamRankingsBar categoryRanks={{}} />);
    expect(screen.queryAllByRole('columnheader')).toHaveLength(0);
  });
});

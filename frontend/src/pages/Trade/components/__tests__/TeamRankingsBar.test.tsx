import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TeamRankingsBar } from '../TeamRankingsBar';

describe('TeamRankingsBar', () => {
  it('renders exactly the categories present in categoryRanks, in the standings order', () => {
    render(<TeamRankingsBar categoryRanks={{ PTS: 1, TO: 3, REB: 4, 'FG%': 2 }} />);

    const headers = screen.getAllByRole('columnheader').map(h => h.textContent);
    expect(headers).toEqual(['FG%', 'REB', 'TO', 'PTS']);
  });

  it('renders each category rank value as a cell', () => {
    render(<TeamRankingsBar categoryRanks={{ PTS: 2, TO: 1 }} />);

    const cells = screen.getAllByRole('cell').map(c => c.textContent);
    expect(cells).toEqual(['1', '2']);
  });

  it('handles an empty categoryRanks without crashing', () => {
    render(<TeamRankingsBar categoryRanks={{}} />);
    expect(screen.queryAllByRole('columnheader')).toHaveLength(0);
  });
});

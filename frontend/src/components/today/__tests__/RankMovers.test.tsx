import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import RankMovers from '../RankMovers';
import type { RankMover } from '../../../types/api';

function movers(): RankMover[] {
  return [
    { team_id: 1, team_name: 'Alpha', category: 'AST', delta: 3 },
    { team_id: 2, team_name: 'Beta', category: 'REB', delta: -2 },
  ];
}

describe('RankMovers team filter', () => {
  it('shows a dedicated message when the selected team no longer has any movers', async () => {
    const { rerender } = render(
      <MemoryRouter>
        <RankMovers movers={movers()} />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: /all teams/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /alpha/i }));

    const table = screen.getByRole('table');
    expect(within(table).getByText('Alpha')).toBeInTheDocument();
    expect(within(table).queryByText('Beta')).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <RankMovers movers={[{ team_id: 2, team_name: 'Beta', category: 'REB', delta: -2 }]} />
      </MemoryRouter>,
    );

    expect(screen.getByText('No movers match the selected filters.')).toBeInTheDocument();
  });
});

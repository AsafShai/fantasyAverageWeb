import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { InjuryRecord } from '../../types/injury';
import InjuryTable from '../injuries/InjuryTable';

function rec(partial: Partial<InjuryRecord> = {}): InjuryRecord {
  return {
    game: 'DAL@BOS',
    team: 'DAL',
    player: 'Star Player',
    status: 'Out',
    injury: 'ankle',
    last_update: '2025-01-15T10:00:00Z',
    game_time_utc: '2025-01-16T01:00:00Z',
    ...partial,
  };
}

describe('InjuryTable', () => {
  it('renders rows with player and team', () => {
    render(<InjuryTable records={[rec({ player: 'Kyrie' })]} totalCount={1} />);
    expect(screen.getAllByText('Kyrie').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DAL').length).toBeGreaterThan(0);
  });

  it('sorts by team when header clicked and toggles direction', async () => {
    const user = userEvent.setup();
    const rows = [
      rec({ team: 'ZZZ', player: 'Zed', last_update: '2025-01-10T10:00:00Z' }),
      rec({ team: 'AAA', player: 'Abe', last_update: '2025-01-11T10:00:00Z' }),
    ];
    render(<InjuryTable records={rows} totalCount={2} />);
    const table = screen.getAllByRole('table')[0]!;
    const teamHeader = within(table).getByRole('columnheader', { name: /team/i });
    await user.click(teamHeader);
    const bodyRows = within(table).getAllByRole('row').slice(1);
    expect(within(bodyRows[0]).getByText('AAA')).toBeInTheDocument();
    await user.click(teamHeader);
    const bodyRows2 = within(screen.getAllByRole('table')[0]!).getAllByRole('row').slice(1);
    expect(within(bodyRows2[0]).getByText('ZZZ')).toBeInTheDocument();
  });

  it('filters empty records with totalCount > 0 shows filter message', () => {
    render(<InjuryTable records={[]} totalCount={3} />);
    expect(screen.getByText(/no results match your filters/i)).toBeInTheDocument();
  });

  it('totalCount 0 shows no data message', () => {
    render(<InjuryTable records={[]} totalCount={0} />);
    expect(screen.getByText(/no injury data available/i)).toBeInTheDocument();
  });

  it('Out status uses red badge classes', () => {
    const { container } = render(<InjuryTable records={[rec({ status: 'Out' })]} totalCount={1} />);
    const badge = container.querySelector('.bg-red-100');
    expect(badge).toBeTruthy();
    expect(badge).toHaveTextContent('Out');
  });
});

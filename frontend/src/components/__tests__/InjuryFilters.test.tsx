import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import InjuryFilters from '../injuries/InjuryFilters';

describe('InjuryFilters', () => {
  it('search input calls onChange with updated search', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <InjuryFilters
        filters={{ search: '', teams: [], statuses: [] }}
        onChange={onChange}
        teams={['DAL', 'BOS']}
      />,
    );
    await user.type(screen.getByPlaceholderText(/search player/i), 'abc');
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.search).toContain('c');
  });

  it('status multi-select toggles statuses', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <InjuryFilters
        filters={{ search: '', teams: [], statuses: [] }}
        onChange={onChange}
        teams={['DAL']}
      />,
    );
    const statusBtn = screen.getAllByRole('button', { name: /all statuses/i })[0]!;
    await user.click(statusBtn);
    const outBox = screen.getByRole('checkbox', { name: /^out$/i });
    await user.click(outBox);
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.some((c) => (c[0] as { statuses: string[] }).statuses.includes('Out'))).toBe(
      true,
    );
  });

  it('team dropdown clear resets teams', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <InjuryFilters
        filters={{ search: '', teams: ['DAL'], statuses: [] }}
        onChange={onChange}
        teams={['DAL', 'BOS']}
      />,
    );
    const teamBtn = screen.getByRole('button', { name: /DAL/ });
    await user.click(within(teamBtn).getByText('✕'));
    expect(onChange).toHaveBeenCalledWith({ search: '', teams: [], statuses: [] });
  });
});

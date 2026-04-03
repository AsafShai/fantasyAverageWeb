import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { InjuryRecord } from '../../types/injury';
import Injuries from '../Injuries';

const { mockUseInjuryData } = vi.hoisted(() => ({
  mockUseInjuryData: vi.fn(),
}));

vi.mock('../../hooks/useInjuryData', () => ({
  useInjuryData: () => mockUseInjuryData(),
}));

function rec(p: Partial<InjuryRecord>): InjuryRecord {
  return {
    game: 'A@B',
    team: p.team ?? 'DAL',
    player: p.player ?? 'P',
    status: p.status ?? 'Out',
    injury: p.injury ?? '',
    last_update: p.last_update ?? '2025-01-01T00:00:00Z',
    ...p,
  };
}

describe('Injuries page', () => {
  it('shows table and count', () => {
    mockUseInjuryData.mockReturnValue({
      records: [rec({ player: 'Jay', team: 'DAL' }), rec({ player: 'Kay', team: 'BOS' })],
      loading: false,
      error: null,
      notifications: [],
      lastReportTime: null,
    });
    render(<Injuries />);
    expect(screen.getAllByText('Jay').length).toBeGreaterThan(0);
    expect(screen.getByText(/showing 2 of 2 player/i)).toBeInTheDocument();
  });

  it('debounced search filters', async () => {
    const user = userEvent.setup();
    mockUseInjuryData.mockReturnValue({
      records: [rec({ player: 'Unique', team: 'DAL' }), rec({ player: 'Other', team: 'DAL' })],
      loading: false,
      error: null,
      notifications: [],
      lastReportTime: null,
    });
    render(<Injuries />);
    await user.type(screen.getByPlaceholderText(/search player/i), 'Unique');
    await waitFor(() => expect(screen.getByText(/showing 1 of 2 player/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('team filter', async () => {
    const user = userEvent.setup();
    mockUseInjuryData.mockReturnValue({
      records: [rec({ player: 'A', team: 'DAL' }), rec({ player: 'B', team: 'BOS' })],
      loading: false,
      error: null,
      notifications: [],
      lastReportTime: null,
    });
    render(<Injuries />);
    await user.click(screen.getAllByRole('button', { name: /all teams/i })[0]!);
    const dalBox = screen.getByRole('checkbox', { name: /^DAL$/ });
    await user.click(dalBox);
    expect(screen.getByText(/showing 1 of 2 player/i)).toBeInTheDocument();
    expect(screen.getAllByText('A').length).toBeGreaterThan(0);
    expect(screen.queryByText('B')).not.toBeInTheDocument();
  });

  it('status filter Out', async () => {
    const user = userEvent.setup();
    mockUseInjuryData.mockReturnValue({
      records: [
        rec({ player: 'OutPlayer', status: 'Out' }),
        rec({ player: 'QuestionablePlayer', status: 'Questionable' }),
      ],
      loading: false,
      error: null,
      notifications: [],
      lastReportTime: null,
    });
    render(<Injuries />);
    await user.click(screen.getAllByRole('button', { name: /all statuses/i })[0]!);
    await user.click(screen.getByRole('checkbox', { name: /^out$/i }));
    expect(screen.getByText(/showing 1 of 2 player/i)).toBeInTheDocument();
    expect(screen.getAllByText('OutPlayer').length).toBeGreaterThan(0);
    expect(screen.queryByText('QuestionablePlayer')).not.toBeInTheDocument();
  });

  it('loading shows spinner text', () => {
    mockUseInjuryData.mockReturnValue({
      records: [],
      loading: true,
      error: null,
      notifications: [],
      lastReportTime: null,
    });
    render(<Injuries />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('error shows message', () => {
    mockUseInjuryData.mockReturnValue({
      records: [],
      loading: false,
      error: 'boom',
      notifications: [],
      lastReportTime: null,
    });
    render(<Injuries />);
    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});

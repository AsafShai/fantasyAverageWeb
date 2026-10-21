import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Player } from '../../../../types/api';
import { PlayerStatsCard } from '../PlayerStatsCard';

const player: Player = {
  player_name: 'Tyrese Haliburton',
  pro_team: 'IND',
  positions: ['PG'],
  team_id: 1,
  status: 'ONTEAM',
  stats: {
    pts: 200, reb: 40, ast: 100, stl: 15, blk: 7, fgm: 70, fga: 150, ftm: 30, fta: 35,
    fg_percentage: 0.467, ft_percentage: 0.857, three_pm: 30, minutes: 340, gp: 10,
  },
};

const renderCard = (value?: { rank: number; of: number; z: number }) =>
  render(<PlayerStatsCard player={player} isSelected onSelect={() => {}} onRemove={() => {}} showStats value={value} />);

describe('PlayerStatsCard rank and z-score', () => {
  it('shows the rank and signed z-score next to games played', () => {
    renderCard({ rank: 12, of: 412, z: 1.234 });
    expect(screen.getByText('#12')).toHaveClass('bg-emerald-100');
    expect(screen.getByText('Z +1.23')).toBeInTheDocument();
    expect(screen.getByTitle(/Rank 12 of 412 players over these dates, Z-score \+1\.23/)).toBeInTheDocument();
  });

  it('tones a low rank red and shows a negative z-score', () => {
    renderCard({ rank: 230, of: 412, z: -0.456 });
    expect(screen.getByText('#230')).toHaveClass('bg-red-100');
    expect(screen.getByText('Z -0.46')).toBeInTheDocument();
  });

  it('shows nothing extra while the values are unknown', () => {
    renderCard();
    expect(screen.queryByText(/^#\d+$/)).toBeNull();
    expect(screen.queryByText(/^Z /)).toBeNull();
  });
});

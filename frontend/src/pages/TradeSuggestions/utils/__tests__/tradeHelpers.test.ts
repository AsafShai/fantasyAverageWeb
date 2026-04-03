import { describe, expect, it } from 'vitest';
import {
  formatStatValue,
  getComparisonColor,
  getComparisonIcon,
  groupPlayersByTeam,
} from '../tradeHelpers';
import type { Player, Team } from '../../../../types/api';

const userTeam: Team = { team_id: 1, team_name: 'Mine' };
const oppTeam: Team = { team_id: 2, team_name: 'Other' };
const p: Player = {
  player_name: 'P',
  pro_team: 'LAL',
  positions: ['PG'],
  team_id: 1,
  status: 'ONTEAM',
  stats: {
    pts: 10,
    reb: 5,
    ast: 2,
    stl: 1,
    blk: 0,
    fgm: 4,
    fga: 8,
    ftm: 2,
    fta: 2,
    fg_percentage: 0.5,
    ft_percentage: 0.9,
    three_pm: 1,
    minutes: 20,
    gp: 5,
  },
};

describe('groupPlayersByTeam', () => {
  it('groups into giving and receiving', () => {
    const g = groupPlayersByTeam([p], [], userTeam, oppTeam);
    expect(g.givingGroup.team).toEqual(userTeam);
    expect(g.givingGroup.players).toEqual([p]);
    expect(g.receivingGroup.players).toEqual([]);
  });
});

describe('formatStatValue (tradeHelpers)', () => {
  it('games played mode', () => {
    expect(formatStatValue(5.7, 10, 'averages', false, true)).toBe('6');
  });

  it('percentage', () => {
    expect(formatStatValue(45.12345, 0, 'totals', true)).toBe('45.1234%');
  });

  it('averages divides by gp', () => {
    expect(formatStatValue(20, 4, 'averages', false)).toBe('5.0000');
  });
});

describe('getComparisonColor / getComparisonIcon', () => {
  it('near zero is neutral', () => {
    expect(getComparisonColor(0.2)).toContain('gray');
    expect(getComparisonIcon(0.2)).toBe('→');
  });

  it('positive vs negative', () => {
    expect(getComparisonColor(2)).toContain('green');
    expect(getComparisonColor(-2)).toContain('red');
    expect(getComparisonIcon(2)).toBe('↗️');
    expect(getComparisonIcon(-2)).toBe('↘️');
  });
});

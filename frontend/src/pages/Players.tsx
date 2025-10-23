import { useState, useMemo } from 'react';
import { useGetAllPlayersQuery, useGetTeamsListQuery } from '../store/api/fantasyApi';
import type { PlayerFilters, Player, StatFilter } from '../types/api';
import './Players.css';

const Players = () => {
  const [filters, setFilters] = useState<PlayerFilters>({});
  const [showAverages, setShowAverages] = useState(true);

  const { data, isLoading, error } = useGetAllPlayersQuery({ page: 1, limit: 500 });
  const { data: teams } = useGetTeamsListQuery();

  const teamMap = useMemo(() => {
    if (!teams) return new Map();
    return new Map(teams.map(team => [team.team_id, team.team_name]));
  }, [teams]);

  const filteredPlayers = useMemo(() => {
    if (!data?.players) return [];

    return data.players.filter(player => {
      if (filters.search) {
        const search = filters.search.toLowerCase();
        const matchesName = player.player_name.toLowerCase().includes(search);
        const matchesTeam = player.pro_team.toLowerCase().includes(search);
        const matchesPosition = player.positions.some(p =>
          p.toLowerCase().includes(search)
        );
        if (!matchesName && !matchesTeam && !matchesPosition) return false;
      }

      if (filters.positions?.length) {
        if (!filters.positions.some(p => player.positions.includes(p))) {
          return false;
        }
      }

      if (filters.status?.length) {
        if (!filters.status.includes(player.status)) return false;
      }

      if (filters.team_id !== undefined && filters.team_id !== null) {
        if (player.team_id !== filters.team_id) return false;
      }

      if (filters.stat_filters?.length) {
        for (const filter of filters.stat_filters) {
          const statValue = player.stats[filter.stat];
          const perGame = player.stats.gp > 0 ? statValue / player.stats.gp : 0;

          let passes = false;
          switch (filter.operator) {
            case "eq": passes = perGame === filter.value; break;
            case "gt": passes = perGame > filter.value; break;
            case "lt": passes = perGame < filter.value; break;
            case "gte": passes = perGame >= filter.value; break;
            case "lte": passes = perGame <= filter.value; break;
          }

          if (!passes) return false;
        }
      }

      return true;
    });
  }, [data, filters]);

  if (isLoading) return <div className="loading">Loading players...</div>;
  if (error) return <div className="error">Error loading players</div>;

  return (
    <div className="players-page">
      <h1>Players</h1>

      <FilterPanel filters={filters} onChange={setFilters} teams={teams} />

      <div className="results-header">
        <div className="results-count">
          Showing {filteredPlayers.length} players
        </div>
        <div className="stats-toggle">
          <button
            className={showAverages ? 'active' : ''}
            onClick={() => setShowAverages(true)}
          >
            Per Game
          </button>
          <button
            className={!showAverages ? 'active' : ''}
            onClick={() => setShowAverages(false)}
          >
            Totals
          </button>
        </div>
      </div>

      <div className="table-container">
        <PlayerTable players={filteredPlayers} teamMap={teamMap} showAverages={showAverages} />
      </div>
    </div>
  );
};

const FilterPanel = ({ filters, onChange, teams }: { filters: PlayerFilters; onChange: (filters: PlayerFilters) => void; teams?: Array<{ team_id: number; team_name: string }> }) => {
  const [statFilter, setStatFilter] = useState<Partial<StatFilter>>({});

  const addStatFilter = () => {
    if (statFilter.stat && statFilter.operator && statFilter.value !== undefined) {
      onChange({
        ...filters,
        stat_filters: [...(filters.stat_filters || []), statFilter as StatFilter]
      });
      setStatFilter({});
    }
  };

  const removeStatFilter = (index: number) => {
    const newFilters = filters.stat_filters?.filter((_, i) => i !== index);
    onChange({ ...filters, stat_filters: newFilters });
  };

  return (
    <div className="filter-panel">
      <input
        type="text"
        placeholder="Search players..."
        value={filters.search || ''}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
        className="search-input"
      />

      <div className="filter-group">
        <label>Position:</label>
        <div className="checkbox-group">
          {['PG', 'SG', 'SF', 'PF', 'C'].map(pos => (
            <label key={pos}>
              <input
                type="checkbox"
                checked={filters.positions?.includes(pos) || false}
                onChange={(e) => {
                  const positions = e.target.checked
                    ? [...(filters.positions || []), pos]
                    : (filters.positions || []).filter(p => p !== pos);
                  onChange({ ...filters, positions });
                }}
              />
              {pos}
            </label>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <label>Status:</label>
        <div className="checkbox-group">
          {[
            { value: 'ONTEAM', label: 'On Team' },
            { value: 'FREEAGENT', label: 'Free Agent' },
            { value: 'WAIVERS', label: 'Waivers' }
          ].map(status => (
            <label key={status.value}>
              <input
                type="checkbox"
                checked={filters.status?.includes(status.value) || false}
                onChange={(e) => {
                  const statuses = e.target.checked
                    ? [...(filters.status || []), status.value]
                    : (filters.status || []).filter(s => s !== status.value);
                  onChange({ ...filters, status: statuses });
                }}
              />
              {status.label}
            </label>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <label>Fantasy Team:</label>
        <select
          value={filters.team_id === null || filters.team_id === undefined ? '' : filters.team_id}
          onChange={(e) => {
            const value = e.target.value;
            onChange({
              ...filters,
              team_id: value === '' ? null : (value === '0' ? 0 : parseInt(value))
            });
          }}
          className="team-select"
        >
          <option value="">All Teams</option>
          <option value="0">Free Agents / Waivers</option>
          {teams?.map(team => (
            <option key={team.team_id} value={team.team_id}>
              {team.team_name}
            </option>
          ))}
        </select>
      </div>

      <div className="stat-filter-builder">
        <select
          value={statFilter.stat || ''}
          onChange={(e) => setStatFilter({ ...statFilter, stat: e.target.value as any })}
        >
          <option value="">Select stat...</option>
          <option value="pts">PTS</option>
          <option value="reb">REB</option>
          <option value="ast">AST</option>
          <option value="stl">STL</option>
          <option value="blk">BLK</option>
          <option value="fg_percentage">FG%</option>
          <option value="ft_percentage">FT%</option>
          <option value="three_pm">3PM</option>
        </select>

        <select
          value={statFilter.operator || ''}
          onChange={(e) => setStatFilter({ ...statFilter, operator: e.target.value as any })}
        >
          <option value="">Operator...</option>
          <option value="eq">=</option>
          <option value="gt">&gt;</option>
          <option value="gte">&gt;=</option>
          <option value="lt">&lt;</option>
          <option value="lte">&lt;=</option>
        </select>

        <input
          type="number"
          step="0.1"
          placeholder="Value"
          value={statFilter.value || ''}
          onChange={(e) => setStatFilter({ ...statFilter, value: parseFloat(e.target.value) })}
        />

        <button onClick={addStatFilter}>Add Filter</button>
      </div>

      {filters.stat_filters && filters.stat_filters.length > 0 && (
        <div className="active-filters">
          {filters.stat_filters.map((filter, idx) => (
            <div key={idx} className="filter-chip">
              {filter.stat.toUpperCase()} {filter.operator} {filter.value}
              <button onClick={() => removeStatFilter(idx)}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const PlayerTable = ({ players, teamMap, showAverages }: { players: Player[]; teamMap: Map<number, string>; showAverages: boolean }) => {
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const getTeamDisplay = (player: Player) => {
    if (player.status === 'ONTEAM' && player.team_id !== 0) {
      return teamMap.get(player.team_id) || 'Unknown Team';
    } else if (player.status === 'FREEAGENT') {
      return 'Free Agent';
    } else if (player.status === 'WAIVERS') {
      return 'Waivers';
    }
    return 'Unknown';
  };

  const formatStat = (value: number, gp: number, isPercentage: boolean = false) => {
    if (isPercentage) {
      return value.toFixed(3);
    }
    if (showAverages) {
      return gp > 0 ? (value / gp).toFixed(1) : '0.0';
    }
    return value.toFixed(1);
  };

  const sortedPlayers = useMemo(() => {
    if (!sortBy) {
      return players;
    }

    const sortColumn = sortBy;

    return [...players].sort((a, b) => {
      let aVal: any, bVal: any;

      if (sortColumn === 'player_name') {
        aVal = a.player_name;
        bVal = b.player_name;
      } else if (sortColumn in a.stats) {
        aVal = a.stats[sortColumn as keyof typeof a.stats];
        bVal = b.stats[sortColumn as keyof typeof b.stats];
      } else {
        aVal = (a as any)[sortColumn];
        bVal = (b as any)[sortColumn];
      }

      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });
  }, [players, sortBy, sortOrder]);

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  return (
    <table className="player-table">
      <thead>
        <tr>
          <th onClick={() => handleSort('player_name')}>Name {sortBy === 'player_name' && (sortOrder === 'asc' ? '↑' : '↓')}</th>
          <th onClick={() => handleSort('pro_team')}>NBA Team {sortBy === 'pro_team' && (sortOrder === 'asc' ? '↑' : '↓')}</th>
          <th>Pos</th>
          <th onClick={() => handleSort('team_id')}>Team {sortBy === 'team_id' && (sortOrder === 'asc' ? '↑' : '↓')}</th>
          <th onClick={() => handleSort('minutes')}>{showAverages ? 'MPG' : 'MIN'} {sortBy === 'minutes' && (sortOrder === 'asc' ? '↑' : '↓')}</th>
          <th onClick={() => handleSort('fg_percentage')}>FG% {sortBy === 'fg_percentage' && (sortOrder === 'asc' ? '↑' : '↓')}</th>
          <th onClick={() => handleSort('ft_percentage')}>FT% {sortBy === 'ft_percentage' && (sortOrder === 'asc' ? '↑' : '↓')}</th>
          <th onClick={() => handleSort('three_pm')}>{showAverages ? '3PG' : '3PM'} {sortBy === 'three_pm' && (sortOrder === 'asc' ? '↑' : '↓')}</th>
          <th onClick={() => handleSort('reb')}>{showAverages ? 'RPG' : 'REB'} {sortBy === 'reb' && (sortOrder === 'asc' ? '↑' : '↓')}</th>
          <th onClick={() => handleSort('ast')}>{showAverages ? 'APG' : 'AST'} {sortBy === 'ast' && (sortOrder === 'asc' ? '↑' : '↓')}</th>
          <th onClick={() => handleSort('stl')}>{showAverages ? 'SPG' : 'STL'} {sortBy === 'stl' && (sortOrder === 'asc' ? '↑' : '↓')}</th>
          <th onClick={() => handleSort('blk')}>{showAverages ? 'BPG' : 'BLK'} {sortBy === 'blk' && (sortOrder === 'asc' ? '↑' : '↓')}</th>
          <th onClick={() => handleSort('pts')}>{showAverages ? 'PPG' : 'PTS'} {sortBy === 'pts' && (sortOrder === 'asc' ? '↑' : '↓')}</th>
          <th onClick={() => handleSort('gp')}>GP {sortBy === 'gp' && (sortOrder === 'asc' ? '↑' : '↓')}</th>
        </tr>
      </thead>
      <tbody>
        {sortedPlayers.map((player, idx) => (
          <tr key={`${player.player_name}-${idx}`}>
            <td>{player.player_name}</td>
            <td>{player.pro_team}</td>
            <td>{player.positions.join(', ')}</td>
            <td>{getTeamDisplay(player)}</td>
            <td>{formatStat(player.stats.minutes, player.stats.gp)}</td>
            <td>{formatStat(player.stats.fg_percentage, player.stats.gp, true)}</td>
            <td>{formatStat(player.stats.ft_percentage, player.stats.gp, true)}</td>
            <td>{formatStat(player.stats.three_pm, player.stats.gp)}</td>
            <td>{formatStat(player.stats.reb, player.stats.gp)}</td>
            <td>{formatStat(player.stats.ast, player.stats.gp)}</td>
            <td>{formatStat(player.stats.stl, player.stats.gp)}</td>
            <td>{formatStat(player.stats.blk, player.stats.gp)}</td>
            <td>{formatStat(player.stats.pts, player.stats.gp)}</td>
            <td>{player.stats.gp}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default Players;

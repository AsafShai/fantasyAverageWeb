import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useGetAllPlayersQuery, useGetTeamsListQuery } from '../store/api/fantasyApi';
import { useGetMatchupsTodayQuery, useGetMatchupDatesQuery, useGetUpcomingDatesQuery, useGetCurrentSlateDateQuery } from '../store/api/fantasyApi';
import type { PlayerFilters, Player, StatFilter, TimePeriod, ComparisonOperator, PlayerStats, CustomDateRange } from '../types/api';
import type { PlayerMatchup } from '../types/api';
import TimePeriodSelector from '../components/TimePeriodSelector';
import { CoverageNotice } from '../components/DateRangePicker';
import { MatchupCell, MatchupExpandRow } from '../components/MatchupDisplay';
import InjuryBadge from '../components/InjuryBadge';
import { FF_MATCHUP_QUALITY, FF_PROJECTIONS, FF_PAST_SLATES } from '../config/featureFlags';
import './Players.css';

const Players = () => {
  const [filters, setFilters] = useState<PlayerFilters>({});
  const [showAverages, setShowAverages] = useState(true);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('season');
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);
  const [integerMode, setIntegerMode] = useState(true);

  const { data, isLoading, error } = useGetAllPlayersQuery({
    page: 1,
    limit: 1200,
    time_period: timePeriod,
    ...(timePeriod === 'custom' && customRange ? { start: customRange.start, end: customRange.end } : {}),
  });
  const { data: teams } = useGetTeamsListQuery();

  useEffect(() => {
    if (timePeriod !== 'custom' || !customRange || !data?.players) return
    const excluded = data.players.filter(p => p.has_data === false)
    if (excluded.length > 0) {
      console.warn(
        `${excluded.length} players excluded (no data for ${customRange.start}–${customRange.end}):`,
        excluded.map(p => p.player_name)
      )
    }
  }, [timePeriod, customRange, data]);

  // Slate picker: next game days for everyone; past dates (what-if/debug view
  // — that day's games with current player state) are flag-gated.
  const [slateDate, setSlateDate] = useState('');
  const { data: upcomingDates = [] } = useGetUpcomingDatesQuery(undefined, { skip: !FF_MATCHUP_QUALITY });
  const { data: pastDates = [] } = useGetMatchupDatesQuery(undefined, { skip: !FF_MATCHUP_QUALITY || !FF_PAST_SLATES });
  const { data: currentSlateDate } = useGetCurrentSlateDateQuery(undefined, { skip: !FF_MATCHUP_QUALITY });
  const { data: matchups = [] } = useGetMatchupsTodayQuery(
    slateDate ? slateDate.replaceAll('-', '') : undefined,
    { skip: !FF_MATCHUP_QUALITY }
  );
  const matchupMap = useMemo(
    () => new Map(matchups.map((m: PlayerMatchup) => [m.player_name, m])),
    [matchups]
  );

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
          const isPercentage = filter.stat === 'fg_percentage' || filter.stat === 'ft_percentage';
          const compareValue = (showAverages && !isPercentage)
            ? (player.stats.gp > 0 ? statValue / player.stats.gp : 0)
            : statValue;

          const filterValue = isPercentage ? filter.value / 100 : filter.value;

          let passes = false;
          switch (filter.operator) {
            case "eq": passes = compareValue === filterValue; break;
            case "gt": passes = compareValue > filterValue; break;
            case "lt": passes = compareValue < filterValue; break;
            case "gte": passes = compareValue >= filterValue; break;
            case "lte": passes = compareValue <= filterValue; break;
          }

          if (!passes) return false;
        }
      }

      return true;
    });
  }, [data, filters, showAverages]);

  if (isLoading) return <div className="loading">Loading players...</div>;
  if (error) return <div className="error">Error loading players</div>;

  return (
    <div className="players-page">
      <h1>Players</h1>

      <FilterPanel filters={filters} onChange={setFilters} teams={teams} />

      <div className="flex flex-wrap justify-between items-center sm:items-stretch gap-2 mt-4 mb-4">
        <div className="flex items-center gap-2">
          <div className="sm:hidden">
            <TimePeriodSelector value={timePeriod} onChange={setTimePeriod} customRange={customRange} onCustomRangeChange={setCustomRange} />
          </div>
          <div className="results-count hidden sm:flex sm:items-center">
            Showing {filteredPlayers.length} players
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {FF_MATCHUP_QUALITY && (
            <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none" title="Pick a game day. Past dates (debug) show that slate with current player state.">
              <span>Slate</span>
              <select
                value={slateDate}
                onChange={(e) => setSlateDate(e.target.value)}
                className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 max-w-[50vw] sm:max-w-none"
              >
                <option value="">
                  {slateDate === '' && currentSlateDate
                    ? `Upcoming (live) — ${currentSlateDate}`
                    : slateDate === '' && currentSlateDate === null
                      ? 'Upcoming (live) — no games scheduled'
                      : 'Upcoming (live)'}
                </option>
                {upcomingDates.map((d) => <option key={d} value={d}>{d}</option>)}
                {FF_PAST_SLATES && pastDates.length > 0 && (
                  <optgroup label="Past (debug)">
                    {pastDates.map((d) => <option key={d} value={d}>{d}</option>)}
                  </optgroup>
                )}
              </select>
            </label>
          )}
          {FF_PROJECTIONS && (
            <label className="hidden sm:flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
              <input type="checkbox" checked={integerMode} onChange={(e) => setIntegerMode(e.target.checked)} />
              Integer projections
            </label>
          )}
          <div className="hidden sm:block">
            <TimePeriodSelector value={timePeriod} onChange={setTimePeriod} customRange={customRange} onCustomRangeChange={setCustomRange} />
          </div>
<div className="flex self-start border border-gray-300 dark:border-gray-600 rounded overflow-hidden">
            <button
              className={`px-3 py-1.5 text-sm whitespace-nowrap transition-all duration-200 border-r border-gray-300 dark:border-gray-600 ${showAverages ? 'bg-blue-600 text-white font-medium' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
              onClick={() => setShowAverages(true)}
            >
              Per Game
            </button>
            <button
              className={`px-3 py-1.5 text-sm whitespace-nowrap transition-all duration-200 ${!showAverages ? 'bg-blue-600 text-white font-medium' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
              onClick={() => setShowAverages(false)}
            >
              Totals
            </button>
          </div>
        </div>
      </div>
      <div className="results-count sm:hidden mb-2">
        Showing {filteredPlayers.length} players
      </div>

      {timePeriod === 'custom' && customRange && (
        <CoverageNotice
          requestedStart={customRange.start}
          requestedEnd={customRange.end}
          actualStart={data?.actual_start}
          actualEnd={data?.actual_end}
        />
      )}

      <div className="table-container">
        <PlayerTable
          players={filteredPlayers}
          teamMap={teamMap}
          showAverages={showAverages}
          matchupMap={matchupMap}
          integerMode={integerMode}
        />
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
          onChange={(e) => {
            const v = e.target.value
            setStatFilter({
              ...statFilter,
              stat: v === '' ? undefined : (v as keyof PlayerStats),
            })
          }}
        >
          <option value="">Filter by stat</option>
          <option value="minutes">Minutes</option>
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
          onChange={(e) => {
            const v = e.target.value
            setStatFilter({
              ...statFilter,
              operator: v === '' ? undefined : (v as ComparisonOperator),
            })
          }}
        >
          <option value="">Select operator</option>
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

const PlayerTable = ({
  players,
  teamMap,
  showAverages,
  matchupMap,
  integerMode,
}: {
  players: Player[];
  teamMap: Map<number, string>;
  showAverages: boolean;
  matchupMap: Map<string, PlayerMatchup>;
  integerMode: boolean;
}) => {
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleExpand = (name: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const getTeamDisplay = useCallback((player: Player) => {
    if (player.status === 'ONTEAM' && player.team_id !== 0) {
      return teamMap.get(player.team_id) || 'Unknown Team';
    } else if (player.status === 'FREEAGENT') {
      return 'Free Agent';
    } else if (player.status === 'WAIVERS') {
      return 'Waivers';
    }
    return 'Unknown';
  }, [teamMap]);

  const formatStat = (value: number, gp: number, isPercentage: boolean = false) => {
    if (isPercentage) {
      return (value * 100).toFixed(4) + '%';
    }
    if (showAverages) {
      return gp > 0 ? (value / gp).toFixed(2) : '0.00';
    }
    return value.toFixed(0);
  };

  const sortedPlayers = useMemo(() => {
    const base = players;

    if (!sortBy) return base;

    const sortColumn = sortBy;

    return [...base].sort((a, b) => {
      let aVal: string | number
      let bVal: string | number

      if (sortColumn === 'player_name') {
        aVal = a.player_name
        bVal = b.player_name
      } else if (sortColumn === 'pro_team') {
        aVal = a.pro_team
        bVal = b.pro_team
      } else if (sortColumn === 'team_id') {
        aVal = getTeamDisplay(a)
        bVal = getTeamDisplay(b)
      } else if (sortColumn in a.stats) {
        const aStat = a.stats[sortColumn as keyof typeof a.stats]
        const bStat = b.stats[sortColumn as keyof typeof b.stats]
        const isPercentage = sortColumn === 'fg_percentage' || sortColumn === 'ft_percentage'

        aVal = (showAverages && sortColumn !== 'gp' && !isPercentage)
          ? (a.stats.gp > 0 ? aStat / a.stats.gp : 0)
          : aStat
        bVal = (showAverages && sortColumn !== 'gp' && !isPercentage)
          ? (b.stats.gp > 0 ? bStat / b.stats.gp : 0)
          : bStat
      } else {
        aVal = 0
        bVal = 0
      }

      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });
  }, [players, sortBy, sortOrder, showAverages, getTeamDisplay]);

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
          {FF_MATCHUP_QUALITY && <th>Matchup</th>}
        </tr>
      </thead>
      <tbody>
        {sortedPlayers.map((player, idx) => {
          const matchup = matchupMap.get(player.player_name);
          const isExpanded = expandedRows.has(player.player_name);
          const noData = player.has_data === false;
          return (
            <React.Fragment key={`${player.player_name}-${idx}`}>
              <tr>
                <td>{player.player_name} <InjuryBadge status={matchup?.injury_status} /></td>
                <td>{player.pro_team}</td>
                <td>{player.positions.join(', ')}</td>
                <td>{getTeamDisplay(player)}</td>
                {noData ? (
                  <td
                    colSpan={10}
                    className="text-center italic text-gray-400"
                    title="Not available for a custom range — try Last 7/15/30/Season"
                  >
                    No data for this range
                  </td>
                ) : (
                  <>
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
                  </>
                )}
                {FF_MATCHUP_QUALITY && (
                  <td>
                    <MatchupCell
                      matchup={matchup}
                      isExpanded={isExpanded}
                      onToggle={() => toggleExpand(player.player_name)}
                      playerStats={player.stats}
                    />
                  </td>
                )}
              </tr>
              {FF_MATCHUP_QUALITY && isExpanded && matchup && (
                <MatchupExpandRow matchup={matchup} colSpan={15} integerMode={integerMode} showProjection={FF_PROJECTIONS} onCollapse={() => toggleExpand(player.player_name)} />
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
};

export default Players;

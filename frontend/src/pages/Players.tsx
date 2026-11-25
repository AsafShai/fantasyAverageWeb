import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { usePersistedState } from '../hooks/usePersistedState';
import { useDebounce } from '../hooks/useDebounce';
import {
  useUrlState,
  boolParam,
  csvParam,
  enumParam,
  isoDateParam,
  stringParam,
  type UrlParam,
} from '../hooks/useUrlState';
import { useGetAllPlayersQuery, useGetScheduleQuery, useGetTeamsListQuery } from '../store/api/fantasyApi';
import { useGetMatchupsTodayQuery, useGetMatchupDatesQuery, useGetUpcomingDatesQuery, useGetCurrentSlateDateQuery } from '../store/api/fantasyApi';
import type { PlayerFilters, Player, StatFilter, TimePeriod, ComparisonOperator, PlayerStatKey, CustomDateRange, ScheduleResponse } from '../types/api';
import type { PlayerMatchup } from '../types/api';
import TimePeriodSelector from '../components/TimePeriodSelector';
import { CoverageNotice } from '../components/DateRangePicker';
import { MatchupCell, MatchupExpandRow } from '../components/MatchupDisplay';
import { WeekDayHeading, WeekOpponent, SCHEDULE_HORIZONS, type PlayerTableMode, type ScheduleHorizon } from '../components/PlayerWeekColumns';
import { FantasyTeamSelect } from '../components/players/FantasyTeamSelect';
import { useMyTeam } from '../context/MyTeamContext';
import { formatShort } from '../utils/dateRange';
import { easternToday, opponentsByTeamDate, weekGameCount, weekOpponent, weekScheduleDays } from '../utils/slateWindow';
import InjuryBadge from '../components/InjuryBadge';
import WaiverClearTag from '../components/WaiverClearTag';
import PlayerNameLink from '../components/PlayerNameLink';
import { parseStatFilterValue, passesStatFilter } from '../utils/statFilter';
import { FF_PAST_SLATES } from '../config/featureFlags';
import './Players.css';
import { useMobileRedesign } from '../mobile/flag';
import { Chip, PositionFilter } from '../mobile/ui';
import MobilePlayers from '../mobile/pages/players/MobilePlayers';
import '../mobile/pages/playerRankings/playerRankings.css';

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;

const STATUS_OPTIONS = [
  { value: 'ONTEAM', label: 'On Team' },
  { value: 'FREEAGENT', label: 'Free Agent' },
  { value: 'WAIVERS', label: 'Waivers' },
] as const;

const TIME_PERIODS: readonly TimePeriod[] = ['season', 'last_7', 'last_15', 'last_30', 'custom'];

const STAT_KEYS: readonly PlayerStatKey[] = [
  'minutes', 'pts', 'reb', 'ast', 'stl', 'blk', 'fg_percentage', 'ft_percentage', 'three_pm',
];

const OPERATORS: readonly ComparisonOperator[] = ['eq', 'gt', 'gte', 'lt', 'lte'];

const OPERATOR_LABELS: Record<ComparisonOperator, string> = { eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' };

const teamParam: UrlParam<string> = {
  parse: (raw) => (/^\d+$/.test(raw) ? raw : undefined),
  serialize: (value) => value,
  default: '',
};

const statFiltersParam: UrlParam<StatFilter[]> = {
  parse: (raw) => {
    const parsed: StatFilter[] = [];
    for (const part of raw.split(',')) {
      const [stat, operator, value] = part.split(':');
      const numeric = Number(value);
      if (
        !STAT_KEYS.includes(stat as PlayerStatKey) ||
        !OPERATORS.includes(operator as ComparisonOperator) ||
        value === undefined ||
        value.trim() === '' ||
        !Number.isFinite(numeric)
      ) continue;
      parsed.push({ stat: stat as PlayerStatKey, operator: operator as ComparisonOperator, value: numeric });
    }
    return parsed.length > 0 ? parsed : undefined;
  },
  serialize: (value) => value.map(f => `${f.stat}:${f.operator}:${f.value}`).join(','),
  default: [],
};

const PLAYERS_URL_SCHEMA = {
  q: stringParam(),
  pos: csvParam<string>(POSITIONS),
  status: csvParam<string>(STATUS_OPTIONS.map(s => s.value)),
  team: teamParam,
  period: enumParam<TimePeriod>(TIME_PERIODS, 'season'),
  from: isoDateParam(),
  to: isoDateParam(),
  slate: isoDateParam(),
  onslate: boolParam(false),
  avg: boolParam(true),
  sf: statFiltersParam,
};

const Players = () => {
  const mobile = useMobileRedesign();
  // Re-applied after every navigation: closing the phone Filters sheet steps
  // back over its history entry, which still has the pre-filter query.
  const { key: locationKey } = useLocation();
  const [urlState, setUrlState, urlKeys] = useUrlState(PLAYERS_URL_SCHEMA);
  const [filters, setFilters] = useState<PlayerFilters>(() => ({
    search: urlState.q,
    positions: urlState.pos,
    status: urlState.status,
    team_id: urlState.team === '' ? null : Number(urlState.team),
    stat_filters: urlState.sf,
  }));
  const [showAverages, setShowAverages] = usePersistedState(
    'players.showAverages',
    true,
    urlKeys.has('avg') ? urlState.avg : undefined,
  );
  const [timePeriod, setTimePeriod] = useState<TimePeriod>(urlState.period);
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(() =>
    urlState.from && urlState.to ? { start: urlState.from, end: urlState.to } : null
  );
  const [integerMode, setIntegerMode] = usePersistedState('players.integerMode', true);
  const [tableMode, setTableMode] = useState<PlayerTableMode>('stats');
  const [scheduleHorizon, setScheduleHorizon] = useState<ScheduleHorizon>(7);

  const { data, isLoading, error } = useGetAllPlayersQuery({
    page: 1,
    limit: 1200,
    time_period: timePeriod,
    ...(timePeriod === 'custom' && customRange ? { start: customRange.start, end: customRange.end } : {}),
  });
  const { data: teams } = useGetTeamsListQuery();
  const { data: schedule } = useGetScheduleQuery();

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
  const [slateDate, setSlateDate] = useState(urlState.slate);
  const { data: upcomingDates = [] } = useGetUpcomingDatesQuery();
  const { data: pastDates = [] } = useGetMatchupDatesQuery(undefined, { skip: !FF_PAST_SLATES });
  const { data: currentSlateDate } = useGetCurrentSlateDateQuery();
  const selectedSlateDate = slateDate || currentSlateDate || '';
  const playingTeamsOnSlate = useMemo(() => {
    if (!selectedSlateDate || !schedule) return null;
    return new Set(
      schedule.teams
        .filter(team => team.games.some(game => game.date === selectedSlateDate))
        .map(team => team.abbreviation)
    );
  }, [schedule, selectedSlateDate]);
  const [playingOnSlateOnly, setPlayingOnSlateOnly] = useState(urlState.onslate);
  const { data: matchups = [] } = useGetMatchupsTodayQuery(
    slateDate ? slateDate.replaceAll('-', '') : undefined,
  );
  const matchupMap = useMemo(
    () => new Map(matchups.map((m: PlayerMatchup) => [m.player_name, m])),
    [matchups]
  );

  const teamMap = useMemo(() => {
    if (!teams) return new Map();
    return new Map(teams.map(team => [team.team_id, team.team_name]));
  }, [teams]);

  const debouncedSearch = useDebounce(filters.search, 250);

  const isCustom = timePeriod === 'custom' && customRange !== null;
  useEffect(() => {
    setUrlState({
      q: debouncedSearch ?? '',
      pos: filters.positions ?? [],
      status: filters.status ?? [],
      team: filters.team_id === null || filters.team_id === undefined ? '' : String(filters.team_id),
      sf: filters.stat_filters ?? [],
      period: timePeriod,
      from: isCustom ? customRange.start : '',
      to: isCustom ? customRange.end : '',
      slate: slateDate,
      onslate: playingOnSlateOnly,
      avg: showAverages,
    });
  }, [
    setUrlState,
    debouncedSearch,
    filters.positions,
    filters.status,
    filters.team_id,
    filters.stat_filters,
    timePeriod,
    isCustom,
    customRange,
    slateDate,
    playingOnSlateOnly,
    showAverages,
    locationKey,
  ]);

  const filteredPlayers = useMemo(() => {
    if (!data?.players) return [];

    return data.players.filter(player => {
      if (debouncedSearch) {
        const search = debouncedSearch.toLowerCase();
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

      if (playingOnSlateOnly && (!playingTeamsOnSlate || !playingTeamsOnSlate.has(player.pro_team))) {
        return false;
      }

      if (filters.stat_filters?.length) {
        for (const filter of filters.stat_filters) {
          if (!passesStatFilter(player, filter, showAverages)) return false;
        }
      }

      return true;
    });
  }, [data, filters, showAverages, debouncedSearch, playingOnSlateOnly, playingTeamsOnSlate]);

  if (mobile) {
    return (
      <MobilePlayers
        isLoading={isLoading}
        error={error}
        players={filteredPlayers}
        actualStart={data?.actual_start}
        actualEnd={data?.actual_end}
        filters={filters}
        setFilters={setFilters}
        teams={teams}
        teamMap={teamMap}
        showAverages={showAverages}
        setShowAverages={setShowAverages}
        timePeriod={timePeriod}
        setTimePeriod={setTimePeriod}
        customRange={customRange}
        setCustomRange={setCustomRange}
        integerMode={integerMode}
        setIntegerMode={setIntegerMode}
        tableMode={tableMode}
        setTableMode={setTableMode}
        scheduleHorizon={scheduleHorizon}
        setScheduleHorizon={setScheduleHorizon}
        slateDate={slateDate}
        setSlateDate={setSlateDate}
        upcomingDates={upcomingDates}
        pastDates={pastDates}
        currentSlateDate={currentSlateDate}
        selectedSlateDate={selectedSlateDate}
        slateUsable={!!selectedSlateDate && !!playingTeamsOnSlate}
        playingOnSlateOnly={playingOnSlateOnly}
        setPlayingOnSlateOnly={setPlayingOnSlateOnly}
        matchupMap={matchupMap}
        schedule={schedule}
      />
    );
  }
  if (isLoading) return <div className="loading">Loading players...</div>;
  if (error) return <div className="error">Error loading players</div>;

  const slateUsable = !!selectedSlateDate && !!playingTeamsOnSlate;

  return (
    <div className="players-page">
      <h1>Players</h1>

      <PlayersFilterCard
        filters={filters}
        onChange={setFilters}
        teams={teams}
        tableMode={tableMode}
        setTableMode={setTableMode}
        showAverages={showAverages}
        setShowAverages={setShowAverages}
        timePeriod={timePeriod}
        setTimePeriod={setTimePeriod}
        customRange={customRange}
        setCustomRange={setCustomRange}
        scheduleHorizon={scheduleHorizon}
        setScheduleHorizon={setScheduleHorizon}
        slateDate={slateDate}
        setSlateDate={setSlateDate}
        upcomingDates={upcomingDates}
        pastDates={pastDates}
        currentSlateDate={currentSlateDate}
        slateUsable={slateUsable}
        playingOnSlateOnly={playingOnSlateOnly}
        setPlayingOnSlateOnly={setPlayingOnSlateOnly}
        integerMode={integerMode}
        setIntegerMode={setIntegerMode}
        actualStart={data?.actual_start}
        actualEnd={data?.actual_end}
        resultCount={filteredPlayers.length}
      />

      {tableMode !== 'schedule' && timePeriod === 'custom' && customRange && (
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
          tableMode={tableMode}
          scheduleHorizon={scheduleHorizon}
          highlightDate={selectedSlateDate}
          schedule={schedule}
        />
      </div>
    </div>
  );
};

interface PlayersFilterCardProps {
  filters: PlayerFilters
  onChange: (filters: PlayerFilters) => void
  teams?: Array<{ team_id: number; team_name: string }>
  tableMode: PlayerTableMode
  setTableMode: (mode: PlayerTableMode) => void
  showAverages: boolean
  setShowAverages: (value: boolean) => void
  timePeriod: TimePeriod
  setTimePeriod: (period: TimePeriod) => void
  customRange: CustomDateRange | null
  setCustomRange: (range: CustomDateRange | null) => void
  scheduleHorizon: ScheduleHorizon
  setScheduleHorizon: (horizon: ScheduleHorizon) => void
  slateDate: string
  setSlateDate: (date: string) => void
  upcomingDates: string[]
  pastDates: string[]
  currentSlateDate: string | null | undefined
  slateUsable: boolean
  playingOnSlateOnly: boolean
  setPlayingOnSlateOnly: (value: boolean) => void
  integerMode: boolean
  setIntegerMode: (value: boolean) => void
  actualStart?: string
  actualEnd?: string
  resultCount: number
}

const PlayersFilterCard = ({
  filters,
  onChange,
  teams,
  tableMode,
  setTableMode,
  showAverages,
  setShowAverages,
  timePeriod,
  setTimePeriod,
  customRange,
  setCustomRange,
  scheduleHorizon,
  setScheduleHorizon,
  slateDate,
  setSlateDate,
  upcomingDates,
  pastDates,
  currentSlateDate,
  slateUsable,
  playingOnSlateOnly,
  setPlayingOnSlateOnly,
  integerMode,
  setIntegerMode,
  actualStart,
  actualEnd,
  resultCount,
}: PlayersFilterCardProps) => {
  const { myTeamId, isMyTeam } = useMyTeam()
  const [statFilter, setStatFilter] = useState<Partial<Omit<StatFilter, 'value'>>>({});
  // Kept as typed, so a 0 shows and an emptied box is not NaN.
  const [valueText, setValueText] = useState('');

  const filterValue = parseStatFilterValue(valueText);
  const canAddFilter = !!statFilter.stat && !!statFilter.operator && filterValue !== null;

  const addStatFilter = () => {
    if (!statFilter.stat || !statFilter.operator || filterValue === null) return;
    onChange({
      ...filters,
      stat_filters: [...(filters.stat_filters || []), { stat: statFilter.stat, operator: statFilter.operator, value: filterValue }]
    });
    setStatFilter({});
    setValueText('');
  };

  const removeStatFilter = (index: number) => {
    const newFilters = filters.stat_filters?.filter((_, i) => i !== index);
    onChange({ ...filters, stat_filters: newFilters });
  };

  const toggleStatus = (status: string) => {
    const current = filters.status ?? [];
    const next = current.includes(status) ? current.filter((item) => item !== status) : [...current, status];
    onChange({ ...filters, status: next });
  };

  const resetFilters = () => {
    onChange({ search: '', positions: [], status: [], team_id: null, stat_filters: [] });
    setStatFilter({});
    setValueText('');
  };

  const teamId = filters.team_id === undefined ? null : filters.team_id;

  return (
    <section className="pr-filters mr-root" aria-label="Player filters">
      <div className="pr-rank">
        <div className="pr-mode">
          <span className="pr-label">View</span>
          <div className="mr-seg mr-sm mr-fit mr-pr-calc" role="group" aria-label="View">
            <button type="button" className="mr-seg-btn" aria-pressed={tableMode === 'stats'} onClick={() => setTableMode('stats')}>Stats</button>
            <button type="button" className="mr-seg-btn" aria-pressed={tableMode === 'schedule'} onClick={() => setTableMode('schedule')}>Schedule</button>
          </div>
        </div>
        {tableMode !== 'schedule' && (
          <div className="pr-mode">
            <span className="pr-label">Display</span>
            <div className="mr-seg mr-sm mr-fit mr-pr-disp" role="group" aria-label="Display">
              <button type="button" className="mr-seg-btn" aria-pressed={showAverages} onClick={() => setShowAverages(true)}>Per Game</button>
              <button type="button" className="mr-seg-btn" aria-pressed={!showAverages} onClick={() => setShowAverages(false)}>Totals</button>
            </div>
          </div>
        )}
        <button type="button" className="pr-reset" onClick={resetFilters}>Reset</button>
      </div>

      <div className="pr-block">
        <span className="pr-label">{tableMode === 'schedule' ? 'Horizon' : 'Period'}</span>
        <div className="pr-period-line">
          {tableMode === 'schedule' ? (
            <div className="pr-period" role="group" aria-label="Schedule horizon">
              {SCHEDULE_HORIZONS.map((days) => (
                <button
                  key={days}
                  type="button"
                  aria-pressed={scheduleHorizon === days}
                  className={`pr-period-btn${scheduleHorizon === days ? ' pr-period-on' : ''}`}
                  onClick={() => setScheduleHorizon(days)}
                >
                  {days} days
                </button>
              ))}
            </div>
          ) : (
            <TimePeriodSelector appearance="plain" value={timePeriod} onChange={setTimePeriod} customRange={customRange} onCustomRangeChange={setCustomRange} />
          )}
          {tableMode !== 'schedule' && actualStart && actualEnd && (
            <p className="pr-range">
              Showing {actualStart === actualEnd ? formatShort(actualStart) : `${formatShort(actualStart)} – ${formatShort(actualEnd)}`}
            </p>
          )}
        </div>
      </div>

      <div className="pr-players">
        <PositionFilter
          options={POSITIONS}
          selected={filters.positions ?? []}
          onChange={(positions) => onChange({ ...filters, positions })}
        />
        <div className="pr-field">
          <span className="pr-label">Status</span>
          <div className="mr-chips mr-wrap" role="group" aria-label="Status">
            {STATUS_OPTIONS.map((status) => (
              <Chip
                key={status.value}
                selected={filters.status?.includes(status.value) || false}
                onClick={() => toggleStatus(status.value)}
              >
                {status.label}
              </Chip>
            ))}
          </div>
        </div>
        <div className="pr-fantasy-menu">
          <span className="pr-label">Fantasy team</span>
          <FantasyTeamSelect
            value={teamId}
            onChange={(next) => onChange({ ...filters, team_id: next })}
            teams={teams ?? []}
            myTeamId={myTeamId}
            isMyTeam={isMyTeam}
          />
        </div>
        <label className="pr-field" title="Pick a game day. Past dates (debug) show that slate with current player state.">
          <span className="pr-label">Slate</span>
          <select
            aria-label="Slate"
            value={slateDate}
            onChange={(e) => setSlateDate(e.target.value)}
            className="pl-select"
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
        <div className="pr-field">
          <span className="pr-label">Playing</span>
          <button
            type="button"
            className="mr-chip"
            aria-pressed={playingOnSlateOnly}
            disabled={!slateUsable}
            title="Keep only players whose NBA team plays on the selected slate."
            onClick={() => setPlayingOnSlateOnly(!playingOnSlateOnly)}
          >
            Only playing on slate
          </button>
        </div>
        <div className="pr-field">
          <span className="pr-label">Projections</span>
          <button
            type="button"
            className="mr-chip"
            aria-pressed={integerMode}
            onClick={() => setIntegerMode(!integerMode)}
          >
            Integer projections
          </button>
        </div>
      </div>

      <div className="pr-stat">
        <label className="pr-field">
          <span className="pr-label">Stat</span>
          <select
            aria-label="Filter by stat"
            className="pl-select"
            value={statFilter.stat || ''}
            onChange={(e) => {
              const v = e.target.value
              setStatFilter({ ...statFilter, stat: v === '' ? undefined : (v as PlayerStatKey) })
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
        </label>
        <label className="pr-field">
          <span className="pr-label">Operator</span>
          <select
            aria-label="Operator"
            className="pl-select"
            value={statFilter.operator || ''}
            onChange={(e) => {
              const v = e.target.value
              setStatFilter({ ...statFilter, operator: v === '' ? undefined : (v as ComparisonOperator) })
            }}
          >
            <option value="">Select operator</option>
            <option value="eq">=</option>
            <option value="gt">&gt;</option>
            <option value="gte">&gt;=</option>
            <option value="lt">&lt;</option>
            <option value="lte">&lt;=</option>
          </select>
        </label>
        <label className="pr-field">
          <span className="pr-label">Value</span>
          <input
            type="number"
            step="0.1"
            placeholder="Value"
            aria-label="Value"
            value={valueText}
            onChange={(e) => setValueText(e.target.value)}
            className="pr-num pl-value"
          />
        </label>
        <button type="button" className="pl-add" onClick={addStatFilter} disabled={!canAddFilter}>Add Filter</button>
      </div>

      {filters.stat_filters && filters.stat_filters.length > 0 && (
        <div className="pl-chips">
          {filters.stat_filters.map((filter, idx) => (
            <Chip key={`${filter.stat}-${filter.operator}-${filter.value}-${idx}`} removable onClick={() => removeStatFilter(idx)}>
              {filter.stat.toUpperCase()} {OPERATOR_LABELS[filter.operator]} {filter.value}
            </Chip>
          ))}
        </div>
      )}

      <PlayerSearchBox
        value={filters.search || ''}
        onChange={(search) => onChange({ ...filters, search })}
        note={`Showing ${resultCount} players`}
      />
    </section>
  );
};

function PlayerSearchBox({ value, onChange, note }: { value: string; onChange: (value: string) => void; note: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="pr-top-search">
      <div className="pr-search relative w-full">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
        >
          <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.4 9.83l3.64 3.63a.75.75 0 1 0 1.06-1.06l-3.63-3.64A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clipRule="evenodd" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search players"
          placeholder="Search players..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onChange('') }}
          className="w-full pl-9 pr-9 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => { onChange(''); inputRef.current?.focus() }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        )}
      </div>
      <p className="pr-search-note">{note}</p>
    </div>
  )
}

const PlayerTable = ({
  players,
  teamMap,
  showAverages,
  matchupMap,
  integerMode,
  tableMode,
  scheduleHorizon,
  highlightDate,
  schedule,
}: {
  players: Player[];
  teamMap: Map<number, string>;
  showAverages: boolean;
  matchupMap: Map<string, PlayerMatchup>;
  integerMode: boolean;
  tableMode: PlayerTableMode;
  scheduleHorizon: ScheduleHorizon;
  highlightDate: string;
  schedule: ScheduleResponse | undefined;
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

  const showSchedule = tableMode === 'schedule';
  const weekDays = useMemo(() => weekScheduleDays(easternToday(), scheduleHorizon), [scheduleHorizon]);
  const opponents = useMemo(
    () => (schedule ? opponentsByTeamDate(schedule) : new Map<string, string>()),
    [schedule],
  );
  const statColumnCount = showSchedule ? weekDays.length + 1 : 10;
  const showMatchup = !showSchedule;
  const matchupColumnCount = showMatchup ? 1 : 0;

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
      } else if (sortColumn === 'week_games') {
        aVal = weekGameCount(opponents, a.pro_team, weekDays)
        bVal = weekGameCount(opponents, b.pro_team, weekDays)
      } else if (sortColumn in a.stats) {
        const aStat = a.stats[sortColumn as PlayerStatKey]
        const bStat = b.stats[sortColumn as PlayerStatKey]
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
  }, [players, sortBy, sortOrder, showAverages, getTeamDisplay, opponents, weekDays]);

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
          {showSchedule ? (
            <>
              {weekDays.map(day => (
                <th key={day.date} className={`week-day${day.date === highlightDate ? ' week-day-selected' : ''}`}>
                  <WeekDayHeading day={day} />
                </th>
              ))}
              <th className="week-day week-games" onClick={() => handleSort('week_games')}>
                Games {sortBy === 'week_games' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
            </>
          ) : (
            <>
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
            </>
          )}
          {showMatchup && <th>Matchup</th>}
        </tr>
      </thead>
      <tbody>
        {sortedPlayers.map((player) => {
          const matchup = matchupMap.get(player.player_name);
          const isExpanded = expandedRows.has(player.player_name);
          const noData = player.has_data === false;
          return (
            <React.Fragment key={player.player_id ?? player.player_name}>
              <tr>
                <td><PlayerNameLink name={player.player_name} playerId={player.player_id} /> <InjuryBadge status={matchup?.injury_status} /></td>
                <td>{player.pro_team}</td>
                <td>{player.positions.join(', ')}</td>
                <td>
                  {getTeamDisplay(player)}
                  {player.status === 'WAIVERS' && <> <WaiverClearTag clearsAt={player.waiver_clears_at} /></>}
                </td>
                {showSchedule ? (
                  <>
                    {weekDays.map(day => (
                      <td key={day.date} className={`text-center${day.date === highlightDate ? ' week-day-selected' : ''}`}>
                        <WeekOpponent opponent={weekOpponent(opponents, player.pro_team, day.date)} />
                      </td>
                    ))}
                    <td className="text-center font-semibold">{weekGameCount(opponents, player.pro_team, weekDays)}</td>
                  </>
                ) : noData ? (
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
                {showMatchup && (
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
              {showMatchup && isExpanded && matchup && (
                <MatchupExpandRow matchup={matchup} colSpan={4 + statColumnCount + matchupColumnCount} integerMode={integerMode} />
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
};

export default Players;

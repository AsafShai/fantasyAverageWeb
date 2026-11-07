import { useEffect, useMemo, useState } from 'react';
import { useInjuryData } from '../hooks/useInjuryData';
import { useDebounce } from '../hooks/useDebounce';
import InjuryFilters from '../components/injuries/InjuryFilters';
import InjuryTable from '../components/injuries/InjuryTable';
import NotificationsPanel from '../components/injuries/NotificationsPanel';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { useMyTeam } from '../context/MyTeamContext';
import { useGetNbaTeamsListQuery, useGetTeamDetailQuery } from '../store/api/fantasyApi';
import { normalizePlayerName } from '../utils/playerName';
import { useMobileRedesign } from '../mobile/flag';
import MobileInjuries from '../mobile/nba/MobileInjuries';

interface Filters {
  search: string;
  teams: string[];
  statuses: string[];
}

/** Letters and digits only, so "Philadelphia 76ers" and "Philadelphia76ers" match. */
function teamKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Widest first. The two narrower choices nest, so only one can be on. */
type InjuryScope = 'all' | 'teams' | 'players'

const INJURY_SCOPES: { id: InjuryScope; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: '' },
  { id: 'teams', label: "My players' teams", hint: 'Every injury on an NBA team where one of your players plays.' },
  { id: 'players', label: 'My players', hint: 'Only players on your roster.' },
]

function InjuryScopeControl({
  scope,
  onChange,
  rosterError,
  teamsError,
}: {
  scope: InjuryScope
  onChange: (scope: InjuryScope) => void
  rosterError: boolean
  teamsError: boolean
}) {
  const hint = INJURY_SCOPES.find(option => option.id === scope)?.hint
  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Whose injuries to show"
        className="flex w-full max-w-full flex-col overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600 lg:inline-flex lg:w-auto lg:flex-row"
      >
        {INJURY_SCOPES.map(option => {
          const selected = scope === option.id
          return (
            <label
              key={option.id}
              className={`flex min-h-[2.75rem] cursor-pointer items-center justify-center border-b border-gray-200 px-4 py-2.5 text-center text-sm font-medium leading-snug last:border-b-0 has-[:focus-visible]:relative has-[:focus-visible]:z-10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset dark:border-gray-600 lg:min-h-0 lg:min-w-0 lg:whitespace-nowrap lg:border-b-0 lg:border-r lg:px-4 lg:py-2 lg:last:border-r-0 ${
                option.id === 'teams' ? 'lg:flex-[1.35]' : 'lg:shrink-0'
              } ${
                selected
                  ? 'bg-blue-600 text-white has-[:focus-visible]:ring-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50 has-[:focus-visible]:ring-blue-400 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              <input
                type="radio"
                name="injury-scope"
                value={option.id}
                checked={selected}
                onChange={() => onChange(option.id)}
                className="sr-only"
              />
              {option.label}
            </label>
          )
        })}
      </div>
      {hint && <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
      {rosterError && <p className="mt-1.5 text-xs text-gray-500">Could not load your roster, showing every injury.</p>}
      {teamsError && <p className="mt-1.5 text-xs text-gray-500">Could not load NBA teams, showing every injury.</p>}
    </div>
  )
}

export default function Injuries() {
  const { records, loading, error, notifications, lastReportTime } = useInjuryData();
  const [filters, setFilters] = useState<Filters>({ search: '', teams: [], statuses: [] });
  const [notifOpen, setNotifOpen] = useState(false);
  const { myTeam, myTeamId } = useMyTeam();
  // One choice: everyone, the NBA teams your players are on, or only your players.
  const [scope, setScope] = useState<InjuryScope>('all');
  const rosterNeeded = scope !== 'all';
  const rosterQuery = useGetTeamDetailQuery(
    { teamId: myTeamId ?? 0 },
    { skip: myTeamId == null || !rosterNeeded },
  );
  const nbaTeamsQuery = useGetNbaTeamsListQuery(undefined, { skip: myTeamId == null || scope !== 'teams' });
  const debouncedSearch = useDebounce(filters.search, 300);
  const mobileRedesign = useMobileRedesign();

  const rosterNames = useMemo(() => {
    const names = new Set<string>();
    for (const player of rosterQuery.data?.players ?? []) {
      names.add(normalizePlayerName(player.player_name));
    }
    return names;
  }, [rosterQuery.data]);

  const rosterFilterOn = myTeamId != null && scope === 'players' && rosterQuery.isSuccess;
  const myNbaTeamKeys = useMemo(() => {
    const keys = new Set<string>();
    const nameByAbbr = new Map((nbaTeamsQuery.data ?? []).map(team => [team.abbreviation, team.team_name]));
    for (const player of rosterQuery.data?.players ?? []) {
      const abbr = player.pro_team?.trim();
      if (!abbr || abbr === 'FA') continue;
      keys.add(teamKey(abbr));
      const name = nameByAbbr.get(abbr);
      if (name) keys.add(teamKey(name));
    }
    return keys;
  }, [rosterQuery.data, nbaTeamsQuery.data]);
  const nbaTeamsFilterOn = myTeamId != null && scope === 'teams' && rosterQuery.isSuccess && nbaTeamsQuery.isSuccess;

  const scopeDataLoading =
    myTeamId != null &&
    scope !== 'all' &&
    (rosterQuery.isLoading || (scope === 'teams' && nbaTeamsQuery.isLoading));

  /** Rows visible for the current scope, before search / team / status filters. */
  const recordsInScope = useMemo(() => {
    if (scope === 'all' || myTeamId == null) return records;
    if (scope === 'players') {
      if (!rosterFilterOn) return records;
      return records.filter(r => rosterNames.has(normalizePlayerName(r.player)));
    }
    if (scope === 'teams') {
      if (!nbaTeamsFilterOn) return records;
      return records.filter(r => myNbaTeamKeys.has(teamKey(r.team)));
    }
    return records;
  }, [records, scope, myTeamId, rosterFilterOn, rosterNames, nbaTeamsFilterOn, myNbaTeamKeys]);

  const teamOptions = useMemo(
    () => Array.from(new Set(recordsInScope.map(r => r.team))).sort(),
    [recordsInScope],
  );

  useEffect(() => {
    const allowed = new Set(teamOptions);
    setFilters(prev => {
      const teams = prev.teams.filter(t => allowed.has(t));
      if (teams.length === prev.teams.length) return prev;
      return { ...prev, teams };
    });
  }, [teamOptions]);

  const filteredRecords = useMemo(() => {
    return records
      .filter(r => {
        const matchesSearch =
          !debouncedSearch ||
          r.player.toLowerCase().includes(debouncedSearch.toLowerCase());
        const matchesTeam = filters.teams.length === 0 || filters.teams.includes(r.team);
        const matchesStatus = filters.statuses.length === 0 || filters.statuses.includes(r.status);
        const matchesRoster = !rosterFilterOn || rosterNames.has(normalizePlayerName(r.player));
        const matchesNbaTeam = !nbaTeamsFilterOn || myNbaTeamKeys.has(teamKey(r.team));
        return matchesSearch && matchesTeam && matchesStatus && matchesRoster && matchesNbaTeam;
      })
  }, [records, debouncedSearch, filters.teams, filters.statuses, rosterFilterOn, rosterNames, nbaTeamsFilterOn, myNbaTeamKeys]);

  if (mobileRedesign) {
    return (
      <MobileInjuries
        loading={loading}
        error={error}
        records={records}
        filteredRecords={filteredRecords}
        notifications={notifications}
        lastReportTime={lastReportTime}
        filters={filters}
        onFilters={setFilters}
        teamOptions={teamOptions}
        teamsDisabled={scopeDataLoading}
        teamsPlaceholder={myTeam && scope !== 'all' ? 'All teams in view' : 'All Teams'}
        scopes={myTeam ? INJURY_SCOPES : null}
        scope={scope}
        onScope={setScope}
        rosterError={rosterNeeded && rosterQuery.isError}
        teamsError={scope === 'teams' && nbaTeamsQuery.isError}
        rosterLoading={Boolean(myTeam && rosterNeeded && (rosterQuery.isLoading || (scope === 'teams' && nbaTeamsQuery.isLoading)))}
      />
    );
  }

  return (
    <>
      {/* Scoped styles for responsive height constraints */}
      <style>{`
        .injury-table-scroll { overflow-y: auto; }
        .injury-sidebar { min-height: 12rem; }
        @media (min-width: 1024px) {
          .injury-table-scroll { max-height: calc(100vh - 22rem); }
          .injury-sidebar { height: calc(100vh - 16rem); }
        }
      `}</style>

      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 overflow-x-hidden lg:overflow-x-visible">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-800">Injury Report</h1>
          <p className="text-sm text-gray-500 mt-1">
            Live NBA injury statuses - updates streamed in real-time. Times shown in your local timezone.
          </p>
        </div>

        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <ErrorMessage message={error} />
        ) : (
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Mobile-only collapsible notifications strip */}
            <div className="lg:hidden">
              <button
                type="button"
                onClick={() => setNotifOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200"
              >
                <span className="flex items-center gap-2">
                  <span>Notifications</span>
                  {notifications.length > 0 && (
                    <span className="bg-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                      {notifications.length}
                    </span>
                  )}
                </span>
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${notifOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {notifOpen && (
                <div className="mt-1 border border-gray-200 rounded-lg overflow-y-auto" style={{ maxHeight: '16rem' }}>
                  <NotificationsPanel notifications={notifications} />
                </div>
              )}
            </div>

            {/* Left panel — filters + table */}
            <div className="flex-1 min-w-0">
              <div className="mb-4 space-y-3">
                {myTeam && (
                  <InjuryScopeControl
                    scope={scope}
                    onChange={setScope}
                    rosterError={rosterNeeded && rosterQuery.isError}
                    teamsError={scope === 'teams' && nbaTeamsQuery.isError}
                  />
                )}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    {myTeam && scope !== 'all' && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Search and filters below apply within your selection above.
                      </p>
                    )}
                    <InjuryFilters
                      filters={filters}
                      onChange={setFilters}
                      teams={teamOptions}
                      teamsDisabled={scopeDataLoading}
                      teamsPlaceholder={myTeam && scope !== 'all' ? 'All teams in view' : 'All Teams'}
                    />
                  </div>
                  {lastReportTime && (
                    <span className="text-xs text-gray-400 shrink-0 pt-2">
                      Last report: {new Date(lastReportTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              </div>
              <div className="injury-table-scroll">
                {myTeam && rosterNeeded && (rosterQuery.isLoading || (scope === 'teams' && nbaTeamsQuery.isLoading)) ? (
                  <p className="py-6 text-sm text-gray-500">Loading your roster…</p>
                ) : (
                  <InjuryTable records={filteredRecords} totalCount={records.length} />
                )}
              </div>
              {records.length > 0 && (
                <p className="text-xs text-gray-400 mt-2">
                  Showing {filteredRecords.length} of {records.length} player(s)
                </p>
              )}
            </div>

            {/* Desktop sidebar — notifications */}
            <div className="injury-sidebar hidden lg:block lg:w-72 lg:shrink-0">
              <NotificationsPanel notifications={notifications} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

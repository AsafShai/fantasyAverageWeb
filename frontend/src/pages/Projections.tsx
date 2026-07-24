import { useEffect, useMemo, useRef, useState } from 'react';
import { useGetMatchupsTodayQuery, useGetMatchupDatesQuery, useGetUpcomingDatesQuery, useGetCurrentSlateDateQuery, usePredictProjectionMutation, useGetAllPlayersQuery, useGetTeamsListQuery } from '../store/api/fantasyApi';
import { FF_PAST_SLATES } from '../config/featureFlags';
import type { PlayerMatchup, ProjectionStats } from '../types/api';
import { coherentInts } from '../utils/coherentRound';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import InjuryBadge from '../components/InjuryBadge';

const STAT_COLS: [keyof ProjectionStats, string][] = [
  ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['three_pm', '3PM'], ['stl', 'STL'], ['blk', 'BLK'],
];

function fmtStat(n: number, integer: boolean): string {
  return integer ? String(Math.round(n)) : n.toFixed(1);
}

function pctParts(pctVal: number, made: number, att: number, integer: boolean) {
  if (!(att > 0)) return { pct: '—', m: '', a: '', ok: false };
  if (integer) {
    const m = Math.round(made), a = Math.round(att);
    return { pct: a > 0 ? `${Math.round((m / a) * 100)}%` : '—', m: String(m), a: String(a), ok: a > 0 };
  }
  return { pct: `${(pctVal * 100).toFixed(1)}%`, m: made.toFixed(1), a: att.toFixed(1), ok: true };
}

function VFrac({ m, a }: { m: string; a: string }) {
  return (
    <span className="inline-flex flex-col items-center leading-[0.9] text-xs align-middle ml-1 text-gray-500 dark:text-gray-400">
      <span className="border-b border-current px-0.5">{m}</span>
      <span>{a}</span>
    </span>
  );
}

function StatusDot({ status, reason }: { status: 'green' | 'amber' | 'red'; reason?: string }) {
  const color = status === 'green' ? 'bg-green-500' : status === 'amber' ? 'bg-amber-500' : 'bg-red-500';
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} title={reason || undefined} />;
}

function ProjectionRow({ matchup, integerMode }: { matchup: PlayerMatchup; integerMode: boolean }) {
  const proj = matchup.projection!;
  const [predict] = usePredictProjectionMutation();
  const [minutes, setMinutes] = useState(proj.default_minutes);
  const [stats, setStats] = useState<ProjectionStats | null>(proj.stats);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Re-sync when the underlying slate changes (opponent switches) or the
  // store recomputes a new default (nightly fold-in) — React reuses row
  // components by key, so stale local minutes/stats would otherwise survive
  // and show the previous slate's numbers. Keyed on stable primitives, not
  // the `proj` object identity, so a same-slate refetch (e.g. RTK Query
  // background revalidation) can't silently wipe an adjusted slider.
  useEffect(() => {
    clearTimeout(timer.current);
    setMinutes(proj.default_minutes);
    setStats(proj.stats);
  }, [matchup.opponent, proj.default_minutes]);

  const onSlider = (v: number) => {
    setMinutes(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await predict({
          player_name: matchup.player_name, opponent: matchup.opponent,
          is_home: matchup.is_home, minutes: v,
        }).unwrap();
        setStats(res.stats);
      } catch { /* ignore transient predict errors */ }
    }, 350);
  };

  // Restore default minutes + the original default-t stats (no network round
  // trip; also cancels any pending re-predict so it can't overwrite them).
  const resetToDefault = () => {
    clearTimeout(timer.current);
    setMinutes(proj.default_minutes);
    setStats(proj.stats);
  };
  const isAdjusted = Math.round(minutes) !== Math.round(proj.default_minutes);

  if (proj.status === 'red' || !stats) {
    return (
      <tr className="border-t border-gray-100 dark:border-gray-800">
        <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900 dark:text-gray-100 sticky left-0 z-10 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700">
          <StatusDot status="red" reason={proj.reason} /> <span className="ml-1">{matchup.player_name}</span> <InjuryBadge status={matchup.injury_status} />
        </td>
        <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-gray-400">
          {matchup.pro_team} {matchup.is_home ? 'vs' : '@'} {matchup.opponent}
        </td>
        <td colSpan={9} className="px-3 py-2 italic text-gray-400 text-sm" title={proj.reason}>not enough data</td>
      </tr>
    );
  }

  // Coherent integer rounding: PTS reads like a plain round while the
  // displayed identity PTS = 2·FGM + 3PM + FTM stays exact.
  const coherent = integerMode ? coherentInts(stats) : null;
  const fg = pctParts(stats.fg_pct, coherent ? coherent.fgm : stats.fgm, coherent ? coherent.fga : stats.fga, integerMode);
  const ft = pctParts(stats.ft_pct, coherent ? coherent.ftm : stats.ftm, coherent ? coherent.fta : stats.fta, integerMode);

  return (
    <tr className="border-t border-gray-100 dark:border-gray-800 hover:bg-blue-50/40 dark:hover:bg-gray-800/40">
      <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900 dark:text-gray-100 sticky left-0 z-10 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700">
        <StatusDot status={proj.status} reason={proj.reason} /> <span className="ml-1">{matchup.player_name}</span> <InjuryBadge status={matchup.injury_status} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-gray-400">
        {matchup.pro_team} {matchup.is_home ? 'vs' : '@'} {matchup.opponent}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2 min-w-[120px]">
          <input
            type="range" min={0} max={48} step={1} value={Math.round(minutes)}
            onChange={(e) => onSlider(Number(e.target.value))}
            className="w-24 accent-blue-600"
          />
          <span className="tabular-nums w-6 text-right text-sm">{Math.round(minutes)}</span>
          <button
            onClick={resetToDefault}
            aria-label="Reset to default minutes"
            title={`Reset to default (${Math.round(proj.default_minutes)} min)`}
            className={`text-xs leading-none px-1 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 ${isAdjusted ? '' : 'invisible'}`}
          >
            ↺
          </button>
        </div>
      </td>
      {STAT_COLS.map(([key]) => (
        <td key={key} className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
          {coherent && (key === 'pts' || key === 'three_pm')
            ? coherent[key]
            : fmtStat(stats[key] as number, integerMode)}
        </td>
      ))}
      <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{fg.pct}{fg.ok && <VFrac m={fg.m} a={fg.a} />}</td>
      <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{ft.pct}{ft.ok && <VFrac m={ft.m} a={ft.a} />}</td>
    </tr>
  );
}

export default function Projections() {
  // Slate picker: everyone sees the next game days; past dates (what-if/debug
  // view — that day's games with CURRENT player state) are flag-gated.
  const [slateDate, setSlateDate] = useState('');
  const { data: upcomingDates = [] } = useGetUpcomingDatesQuery();
  const { data: pastDates = [] } = useGetMatchupDatesQuery(undefined, { skip: !FF_PAST_SLATES });
  const { data: currentSlateDate } = useGetCurrentSlateDateQuery();
  const { data: matchups = [], isLoading, error } = useGetMatchupsTodayQuery(
    slateDate ? slateDate.replaceAll('-', '') : undefined
  );
  const [integerMode, setIntegerMode] = useState(true);
  const [search, setSearch] = useState('');
  const [nbaTeam, setNbaTeam] = useState('');
  const [fantasyTeamId, setFantasyTeamId] = useState('');

  const { data: allPlayers } = useGetAllPlayersQuery({ page: 1, limit: 1200 });
  const { data: fantasyTeams } = useGetTeamsListQuery();

  const playerTeamMap = useMemo(() => {
    const m = new Map<string, number>();
    allPlayers?.players.forEach((p) => m.set(p.player_name, p.status === 'ONTEAM' ? p.team_id : 0));
    return m;
  }, [allPlayers]);

  // Live slate = the "Upcoming (live)" view resolving to today's real slate date.
  // Only there do we hide Out players outright; an explicit picked date is a
  // what-if/debug view where Out is tag-only (InjuryBadge), never filtered.
  const isLiveSlate = slateDate === '' && !!currentSlateDate;

  const withGames = useMemo(() => matchups.filter((m) => {
    if (m.projection == null) return false;
    if (!m.on_depth_chart) return false;
    if (isLiveSlate && m.injury_status === 'Out') return false;
    return true;
  }), [matchups, isLiveSlate]);

  const nbaTeamOptions = useMemo(
    () => Array.from(new Set(withGames.map((m) => m.pro_team))).sort(),
    [withGames]
  );

  const filtered = useMemo(() => {
    return withGames.filter((m) => {
      if (search && !m.player_name.toLowerCase().includes(search.toLowerCase())) return false;
      if (nbaTeam && m.pro_team !== nbaTeam) return false;
      if (fantasyTeamId !== '') {
        const teamId = playerTeamMap.get(m.player_name);
        if (String(teamId ?? '') !== fantasyTeamId) return false;
      }
      return true;
    });
  }, [withGames, search, nbaTeam, fantasyTeamId, playerTeamMap]);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="Failed to load projections." />;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Projections</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {slateDate
              ? `Slate of ${slateDate} — predictions use current player state (what-if view).`
              : "Live model projections for tonight's games."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer select-none" title="Pick a game day. Past dates (debug) show that slate with current player state.">
            <span>Slate</span>
            <select
              value={slateDate}
              onChange={(e) => setSlateDate(e.target.value)}
              className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
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
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer select-none">
            <input type="checkbox" checked={integerMode} onChange={(e) => setIntegerMode(e.target.checked)} className="accent-blue-600" />
            Integer projections
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search player..."
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded w-48 bg-white dark:bg-gray-800"
        />
        <select
          value={nbaTeam}
          onChange={(e) => setNbaTeam(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
        >
          <option value="">All NBA Teams</option>
          {nbaTeamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={fantasyTeamId}
          onChange={(e) => setFantasyTeamId(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
        >
          <option value="">All Fantasy Teams</option>
          <option value="0">Free Agents / Waivers</option>
          {fantasyTeams?.map((t) => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}
        </select>
        <span className="text-sm text-gray-500 dark:text-gray-400">{filtered.length} players</span>
      </div>

      <div className="bg-white dark:bg-gray-900 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
            <tr>
              <th className="text-left px-3 py-2 sticky left-0 z-10 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700">Player</th>
              <th className="text-left px-3 py-2">Matchup</th>
              <th className="px-3 py-2 w-40">Minutes</th>
              {STAT_COLS.map(([, label]) => <th key={label} className="px-2 py-2 text-right">{label}</th>)}
              <th className="px-2 py-2 text-right">FG%</th>
              <th className="px-2 py-2 text-right">FT%</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((matchup) => (
              <ProjectionRow key={matchup.player_name} matchup={matchup} integerMode={integerMode} />
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">
                {withGames.length === 0
                  ? (slateDate ? `No games on ${slateDate}.` : 'No games today.')
                  : 'No players match the filters.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

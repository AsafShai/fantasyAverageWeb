import { Fragment, useEffect, useRef, useState } from 'react';
import type { DefRanks, DefValues, PlayerMatchup, PlayerStats, ProjectionStats } from '../types/api';
import { usePredictProjectionMutation } from '../store/api/fantasyApi';
import { usePersistedState } from '../hooks/usePersistedState';
import { coherentInts } from '../utils/coherentRound';
import './MatchupDisplay.css';

const RANK_LABELS: Record<keyof DefRanks, string> = {
  fg_pct: 'FG%',
  three_pm: '3PM',
  reb: 'REB',
  ast: 'AST',
  stl: 'STL',
  blk: 'BLK',
  pts: 'PTS',
};

// Per-game benchmarks for weighting best-cat by player strength
const LEAGUE_BENCHMARKS: Record<keyof DefRanks, number> = {
  pts: 20.0,
  reb: 8.0,
  ast: 6.0,
  stl: 1.5,
  blk: 1.0,
  three_pm: 2.5,
  fg_pct: 0.46,
};

// Opponent-rank keys in the app-wide stat order (RANK_LABELS' order), limited
// to the ones this matchup carries.
function rankKeys(ranks: DefRanks): (keyof DefRanks)[] {
  return (Object.keys(RANK_LABELS) as (keyof DefRanks)[]).filter(k => ranks[k] !== undefined);
}

function playerPg(stat: keyof DefRanks, s: PlayerStats): number {
  const gp = s.gp || 1;
  switch (stat) {
    case 'pts': return s.pts / gp;
    case 'reb': return s.reb / gp;
    case 'ast': return s.ast / gp;
    case 'stl': return s.stl / gp;
    case 'blk': return s.blk / gp;
    case 'three_pm': return s.three_pm / gp;
    case 'fg_pct': return s.fg_percentage;
  }
}

function rankColor(rank: number): 'green' | 'yellow' | 'red' {
  if (rank >= 21) return 'green';
  if (rank <= 10) return 'red';
  return 'yellow';
}

function paceBadge(pace: number, leagueAvg: number): 'fast' | 'average' | 'slow' {
  const diff = pace - leagueAvg;
  if (diff > 2.0) return 'fast';
  if (diff < -2.0) return 'slow';
  return 'average';
}

function formatDefVal(stat: keyof DefValues, value: number): string {
  if (stat === 'fg_pct') return `${(value * 100).toFixed(1)}%`;
  return value.toFixed(1);
}

const RANK_TEXT_COLOR: Record<'green' | 'yellow' | 'red', string> = {
  green: 'text-green-600 dark:text-green-400',
  yellow: 'text-amber-600 dark:text-amber-400',
  red: 'text-red-600 dark:text-red-400',
};

function BestCatBadge({ ranks, playerStats }: { ranks: DefRanks; playerStats?: PlayerStats }) {
  const entries = Object.entries(ranks) as [keyof DefRanks, number][];
  let bestKey: keyof DefRanks;
  let bestRank: number;

  if (playerStats && playerStats.gp > 0) {
    const scored = entries.map(([key, rank]) => {
      const pg = playerPg(key, playerStats);
      const score = (pg / LEAGUE_BENCHMARKS[key]) * (rank / 30);
      return { key, rank, score };
    });
    const best = scored.sort((a, b) => b.score - a.score)[0];
    bestKey = best.key;
    bestRank = best.rank;
  } else {
    const best = entries.sort(([, a], [, b]) => b - a)[0];
    bestKey = best[0];
    bestRank = best[1];
  }

  const color = rankColor(bestRank);
  return (
    <span className={`mq-cat mq-cat-${color}`}>
      {RANK_LABELS[bestKey]} #{bestRank}
    </span>
  );
}

function ConfidenceDot({ status, reason }: { status: 'green' | 'amber' | 'red'; reason: string }) {
  return <span className={`mq-conf-dot mq-conf-dot-${status}`} title={reason || undefined} />;
}

export function MatchupCell({
  matchup,
  isExpanded,
  onToggle,
  playerStats,
}: {
  matchup: PlayerMatchup | undefined;
  isExpanded: boolean;
  onToggle: () => void;
  playerStats?: PlayerStats;
}) {
  if (!matchup) return <span className="mq-no-game">—</span>;

  return (
    <button className="mq-cell" onClick={onToggle}>
      <span className="mq-opp">vs {matchup.opponent}</span>
      <BestCatBadge ranks={matchup.def_ranks} playerStats={playerStats} />
      <span className="mq-chevron">{isExpanded ? '▲' : '▼'}</span>
    </button>
  );
}

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
    <span className="mq-vfrac">
      <span>{m}</span>
      <span>{a}</span>
    </span>
  );
}

/** Matchup detail + projection (reused by table expand row and mobile roster cards). */
export function MatchupExpandPanel({
  matchup,
  integerMode: integerModeProp = true,
  integerProjectionToggle = false,
  layout = 'table',
}: {
  matchup: PlayerMatchup;
  /** When `integerProjectionToggle` is false, controls projection rounding from the parent (e.g. Players page). */
  integerMode?: boolean;
  /** Daily roster: show a segmented control inside the panel; uses persisted `matchupPanel.integerProjections`. */
  integerProjectionToggle?: boolean;
  /** `table`: wide sticky bar under roster grids. `card`: inside mobile roster cards (rounded, no sticky). */
  layout?: 'table' | 'card';
}) {
  const [persistedIntegerProjections, setPersistedIntegerProjections] = usePersistedState(
    'matchupPanel.integerProjections',
    true,
  )
  const integerMode = integerProjectionToggle ? persistedIntegerProjections : integerModeProp

  const paceLabel = paceBadge(matchup.pace, matchup.league_avg_pace);
  const paceColor = paceLabel === 'fast' ? 'green' : paceLabel === 'slow' ? 'red' : 'yellow';

  const proj = matchup.projection;
  const [predict] = usePredictProjectionMutation();
  const [minutes, setMinutes] = useState(proj?.default_minutes ?? 0);
  const [stats, setStats] = useState<ProjectionStats | null>(proj?.stats ?? null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const slateKey = `${matchup.opponent}|${proj?.default_minutes}`;
  const [syncedSlateKey, setSyncedSlateKey] = useState(slateKey);
  if (slateKey !== syncedSlateKey) {
    setSyncedSlateKey(slateKey);
    setMinutes(proj?.default_minutes ?? 0);
    setStats(proj?.stats ?? null);
  }
  useEffect(() => () => clearTimeout(timer.current), [slateKey]);
  const projActive = !!proj && proj.status !== 'red' && !!stats;

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

  const resetToDefault = () => {
    if (!proj) return;
    clearTimeout(timer.current);
    setMinutes(proj.default_minutes);
    setStats(proj.stats);
  };
  const isAdjusted = !!proj && Math.round(minutes) !== Math.round(proj.default_minutes);

  const coherent = integerMode && stats ? coherentInts(stats) : null;
  const fg = stats ? pctParts(stats.fg_pct, coherent ? coherent.fgm : stats.fgm, coherent ? coherent.fga : stats.fga, integerMode) : null;
  const ft = stats ? pctParts(stats.ft_pct, coherent ? coherent.ftm : stats.ftm, coherent ? coherent.fta : stats.fta, integerMode) : null;

  const rootClass =
    layout === 'card'
      ? 'mq-expand-content mq-expand-content--card'
      : 'mq-expand-content'

  return (
    <div className={rootClass}>
      <p className={layout === 'card' ? 'mq-expand-label mq-expand-label--card' : 'mq-expand-label'}>
        <span className="block font-medium text-gray-700 dark:text-gray-200">
          vs {matchup.opponent}
        </span>
        <span className="mt-1 block text-[0.7rem] leading-snug text-gray-500 dark:text-gray-400">
          Defense ranks (30 teams){projActive ? ' · projection for tonight' : ''}.{' '}
          <span className="text-green-600 dark:text-green-400">Green ≥ 21</span> weaker defense;{' '}
          <span className="text-red-600 dark:text-red-400">Red ≤ 10</span> stronger.
        </span>
      </p>

      <div className="mq-strip-label">Opponent defense</div>
      <div className={layout === 'card' ? 'mq-strip mq-strip--card' : 'mq-strip'}>
        {rankKeys(matchup.def_ranks).map(key => {
          const rank = matchup.def_ranks[key];
          return (
            <span key={key} className="mq-strip-item">
              <b className={RANK_TEXT_COLOR[rankColor(rank)]}>{RANK_LABELS[key]} #{rank}</b>{' '}
              <span className="text-gray-500 dark:text-gray-400">{formatDefVal(key, matchup.def_values[key])}</span>
            </span>
          );
        })}
        <span className="mq-strip-item">
          <b className={RANK_TEXT_COLOR[paceColor]}>{paceLabel.charAt(0).toUpperCase() + paceLabel.slice(1)}</b>{' '}
          <span className="text-gray-500 dark:text-gray-400">{matchup.pace} vs {matchup.league_avg_pace} avg</span>
        </span>
      </div>

      {projActive && (
        <>
          {integerProjectionToggle && (
            <div
              className="mb-3 flex flex-wrap items-center justify-center gap-2 sm:gap-3"
              data-testid="matchup-proj-display-toggle"
            >
              <span className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                Projection numbers
              </span>
              <div
                className="inline-flex rounded-full border border-gray-200 bg-gray-100/90 p-0.5 shadow-sm dark:border-gray-600 dark:bg-gray-800/90"
                role="group"
                aria-label="Projection number format"
              >
                <button
                  type="button"
                  className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                    integerMode
                      ? 'bg-blue-600 text-white shadow-sm dark:bg-blue-500'
                      : 'text-gray-600 hover:bg-white/80 dark:text-gray-400 dark:hover:bg-gray-700/80'
                  }`}
                  onClick={() => setPersistedIntegerProjections(true)}
                >
                  Whole
                </button>
                <button
                  type="button"
                  className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                    !integerMode
                      ? 'bg-blue-600 text-white shadow-sm dark:bg-blue-500'
                      : 'text-gray-600 hover:bg-white/80 dark:text-gray-400 dark:hover:bg-gray-700/80'
                  }`}
                  onClick={() => setPersistedIntegerProjections(false)}
                >
                  Decimal
                </button>
              </div>
            </div>
          )}
          <div className="mq-strip-label mq-strip-label-row">
            <ConfidenceDot status={proj!.status} reason={proj!.reason} />
            <span>TONIGHT&apos;S PROJECTION</span>
          </div>
          <div className={layout === 'card' ? 'mq-strip mq-strip--card' : 'mq-strip'}>
            {rankKeys(matchup.def_ranks).map(key => (
              <Fragment key={key}>
                <span className="mq-strip-item">
                  <span className="text-gray-500 dark:text-gray-400">{RANK_LABELS[key]}</span>{' '}
                  <b>
                    {key === 'fg_pct' && fg
                      ? <>{fg.pct}{fg.ok && <VFrac m={fg.m} a={fg.a} />}</>
                      : coherent && (key === 'pts' || key === 'three_pm')
                        ? coherent[key]
                        : fmtStat(stats![key], integerMode)}
                  </b>
                </span>
                {key === 'fg_pct' && ft && (
                  <span className="mq-strip-item">
                    <span className="text-gray-500 dark:text-gray-400">FT%</span>{' '}
                    <b>{ft.pct}{ft.ok && <VFrac m={ft.m} a={ft.a} />}</b>
                  </span>
                )}
              </Fragment>
            ))}
          </div>
        </>
      )}

      <div className="mq-proj-footer">
        {!projActive && (
          <span className="mq-proj-insufficient">{proj ? `no projection — ${proj.reason || 'insufficient data'}` : 'no projection available'}</span>
        )}
        {projActive && (
          <div className="mq-proj-slider-row">
            <span className="mq-proj-slider-label">Minutes</span>
            <input
              type="range" min={0} max={48} step={1} value={Math.round(minutes)}
              onChange={(e) => onSlider(Number(e.target.value))}
            />
            <span className="mq-proj-slider-value">{Math.round(minutes)}</span>
            <button
              type="button"
              onClick={resetToDefault}
              aria-label="Reset to default minutes"
              title={`Reset to default (${Math.round(proj!.default_minutes)} min)`}
              className={`mq-proj-slider-reset ${isAdjusted ? '' : 'mq-invisible'}`}
            >
              ↺
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function MatchupExpandRow({
  matchup,
  colSpan,
  integerMode = true,
  integerProjectionToggle = false,
}: {
  matchup: PlayerMatchup;
  colSpan: number;
  integerMode?: boolean;
  integerProjectionToggle?: boolean;
}) {
  return (
    <tr className="mq-expand-row">
      <td colSpan={colSpan} className="mq-expand-td">
        <MatchupExpandPanel
          matchup={matchup}
          integerMode={integerMode}
          integerProjectionToggle={integerProjectionToggle}
          layout="table"
        />
      </td>
    </tr>
  );
}

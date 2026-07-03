import { useRef, useState, type ReactNode } from 'react';
import type { DefRanks, DefValues, PlayerMatchup, PlayerStats, ProjectionStats } from '../types/api';
import { usePredictProjectionMutation } from '../store/api/fantasyApi';
import './MatchupDisplay.css';

const RANK_LABELS: Record<keyof DefRanks, string> = {
  pts: 'PTS',
  reb: 'REB',
  ast: 'AST',
  stl: 'STL',
  blk: 'BLK',
  three_pm: '3PM',
  fg_pct: 'FG%',
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
  showProjection = false,
}: {
  matchup: PlayerMatchup | undefined;
  isExpanded: boolean;
  onToggle: () => void;
  playerStats?: PlayerStats;
  showProjection?: boolean;
}) {
  if (!matchup) return <span className="mq-no-game">—</span>;

  return (
    <button className="mq-cell" onClick={onToggle}>
      <span className="mq-opp">vs {matchup.opponent}</span>
      <BestCatBadge ranks={matchup.def_ranks} playerStats={playerStats} />
      {showProjection && matchup.projection && (
        <ConfidenceDot status={matchup.projection.status} reason={matchup.projection.reason} />
      )}
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

// One cell in the unified matchup grid: rank badge (opponent defense) stacked
// with the player's projected value for that same category — so "how good is
// this matchup" and "what do we expect tonight" read as a single fact per stat,
// not two separate grids the eye has to cross-reference.
function StatCell({
  label, rank, rankSub, projected, colorKey,
}: {
  label: string;
  rank?: number;
  rankSub?: string;
  projected?: ReactNode;
  colorKey: 'green' | 'yellow' | 'red';
}) {
  return (
    <div className={`mq-cell-box mq-cell-${colorKey}`}>
      <span className="mq-cell-label">{label}</span>
      {rank !== undefined && (
        <span className="mq-cell-rank" title={rankSub}>#{rank}</span>
      )}
      {projected !== undefined && <span className="mq-cell-proj">{projected}</span>}
    </div>
  );
}

export function MatchupExpandRow({
  matchup,
  colSpan,
  integerMode = true,
  showProjection = false,
}: {
  matchup: PlayerMatchup;
  colSpan: number;
  integerMode?: boolean;
  showProjection?: boolean;
}) {
  const paceLabel = paceBadge(matchup.pace, matchup.league_avg_pace);
  const paceColor = paceLabel === 'fast' ? 'green' : paceLabel === 'slow' ? 'red' : 'yellow';

  const proj = matchup.projection;
  const [predict] = usePredictProjectionMutation();
  const [minutes, setMinutes] = useState(proj?.default_minutes ?? 0);
  const [stats, setStats] = useState<ProjectionStats | null>(proj?.stats ?? null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const projActive = showProjection && !!proj && proj.status !== 'red' && !!stats;

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

  const fg = stats ? pctParts(stats.fg_pct, stats.fgm, stats.fga, integerMode) : null;
  const ft = stats ? pctParts(stats.ft_pct, stats.ftm, stats.fta, integerMode) : null;

  return (
    <tr className="mq-expand-row">
      <td colSpan={colSpan} className="mq-expand-td">
        <div className="mq-expand-content">
          <span className="mq-expand-label">
            vs {matchup.opponent} — opponent defense rank (out of 30){projActive ? ' + tonight\'s projection' : ''}.{' '}
            <span style={{ color: '#4ade80' }}>Green ≥ 21</span> = weak defense.{' '}
            <span style={{ color: '#f87171' }}>Red ≤ 10</span> = strong defense.
          </span>
          <div className="mq-ranks-grid">
            {(Object.entries(matchup.def_ranks) as [keyof DefRanks, number][]).map(([key, rank]) => {
              const projected = !projActive ? formatDefVal(key, matchup.def_values[key])
                : key === 'fg_pct' && fg
                  ? <>{fg.pct}{fg.ok && <VFrac m={fg.m} a={fg.a} />}</>
                  : fmtStat(stats![key], integerMode);
              return (
                <StatCell
                  key={key} label={RANK_LABELS[key]} rank={rank}
                  rankSub={`${matchup.opponent} allows ${formatDefVal(key, matchup.def_values[key])}/game`}
                  colorKey={rankColor(rank)} projected={projected}
                />
              );
            })}
            {projActive && ft && (
              <StatCell
                label="FT%" colorKey="yellow"
                projected={<>{ft.pct}{ft.ok && <VFrac m={ft.m} a={ft.a} />}</>}
              />
            )}
            <StatCell
              label="PACE" colorKey={paceColor}
              rankSub={`${matchup.pace} poss/48min vs league avg ${matchup.league_avg_pace}`}
              projected={paceLabel.charAt(0).toUpperCase() + paceLabel.slice(1)}
            />
          </div>
          {showProjection && (
            <div className="mq-proj-footer">
              {!projActive && (
                <span className="mq-proj-insufficient">{proj ? `no projection — ${proj.reason || 'insufficient data'}` : 'no projection available'}</span>
              )}
              {projActive && (
                <div className="mq-proj-slider-row">
                  <span className="mq-proj-slider-label">Minutes</span>
                  <input
                    type="range" min={0} max={44} step={1} value={Math.round(minutes)}
                    onChange={(e) => onSlider(Number(e.target.value))}
                  />
                  <span className="mq-proj-slider-value">{Math.round(minutes)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

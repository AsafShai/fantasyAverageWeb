import type { DefRanks, DefValues, PlayerMatchup, PlayerStats } from '../types/api';
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

export function MatchupExpandRow({
  matchup,
  colSpan,
}: {
  matchup: PlayerMatchup;
  colSpan: number;
}) {
  const badge = paceBadge(matchup.pace, matchup.league_avg_pace);
  const paceColor = badge === 'fast' ? 'green' : badge === 'slow' ? 'red' : 'yellow';

  return (
    <tr className="mq-expand-row">
      <td colSpan={colSpan} className="mq-expand-td">
        <div className="mq-expand-content">
          <span className="mq-expand-label">
            vs {matchup.opponent} — stats {matchup.opponent} allows per game (rank out of 30 teams).{' '}
            <span style={{ color: '#4ade80' }}>Green ≥ 21</span> = weak defense.{' '}
            <span style={{ color: '#f87171' }}>Red ≤ 10</span> = strong defense.
          </span>
          <div className="mq-ranks-grid">
            {(Object.entries(matchup.def_ranks) as [keyof DefRanks, number][]).map(([key, rank]) => (
              <div key={key} className={`mq-rank-cell mq-rank-${rankColor(rank)}`}>
                <span className="mq-rank-label">{RANK_LABELS[key]}</span>
                <span className="mq-rank-value">#{rank}</span>
                <span className="mq-rank-sub">{formatDefVal(key, matchup.def_values[key])}</span>
              </div>
            ))}
            <div
              className={`mq-rank-cell mq-rank-${paceColor}`}
              title={`${matchup.pace} poss/48min vs league avg ${matchup.league_avg_pace}`}
            >
              <span className="mq-rank-label">PACE</span>
              <span className="mq-rank-value">{badge.charAt(0).toUpperCase() + badge.slice(1)}</span>
              <span className="mq-rank-sub">{matchup.pace}</span>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

import type { DefRanks, PlayerMatchup } from '../types/api';
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

function rankColor(rank: number): 'green' | 'yellow' | 'red' {
  if (rank >= 21) return 'green';
  if (rank <= 10) return 'red';
  return 'yellow';
}

function BestCatBadge({ ranks }: { ranks: DefRanks }) {
  const best = (Object.entries(ranks) as [keyof DefRanks, number][])
    .sort(([, a], [, b]) => b - a)[0];
  if (!best) return null;
  const [key, rank] = best;
  const color = rankColor(rank);
  return (
    <span className={`mq-cat mq-cat-${color}`}>
      {RANK_LABELS[key]} #{rank}
    </span>
  );
}

export function MatchupCell({
  matchup,
  isExpanded,
  onToggle,
}: {
  matchup: PlayerMatchup | undefined;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  if (!matchup) return <span className="mq-no-game">—</span>;

  return (
    <button className="mq-cell" onClick={onToggle}>
      <span className="mq-opp">vs {matchup.opponent}</span>
      <BestCatBadge ranks={matchup.def_ranks} />
      <span className={`mq-pace mq-pace-${matchup.pace_badge.toLowerCase()}`}>
        {matchup.pace_badge}
      </span>
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
  return (
    <tr className="mq-expand-row">
      <td colSpan={colSpan} className="mq-expand-td">
        <div className="mq-expand-content">
          <span className="mq-expand-label">
            vs {matchup.opponent} — defensive ranks (1 = best defense, 30 = worst)
          </span>
          <div className="mq-ranks-grid">
            {(Object.entries(matchup.def_ranks) as [keyof DefRanks, number][]).map(([key, rank]) => (
              <div key={key} className={`mq-rank-cell mq-rank-${rankColor(rank)}`}>
                <span className="mq-rank-label">{RANK_LABELS[key]}</span>
                <span className="mq-rank-value">#{rank}</span>
              </div>
            ))}
          </div>
        </div>
      </td>
    </tr>
  );
}

import type { SurpriseRow } from '../../types/api';
import PlayerNameLink from '../PlayerNameLink';
import { toListHeadshotUrl } from '../../utils/adp';
import { driverColumns } from '../share/boomOrBustMessage';
import { markClass } from './marks';

function fmtScore(score: number): string {
  const s = Math.abs(score).toFixed(1);
  return score < 0 ? `−${s}` : `+${s}`;
}

/** "57%" with the makes over attempts beneath it, as the Projections table shows shooting. */
function ShootingCell({ made, att, mark }: { made: number; att: number; mark?: string }) {
  if (!(att > 0)) return <span className="text-gray-400">—</span>;
  return (
    <span className={`tabular-nums${mark ? ` ${mark}` : ''}`}>
      {Math.round((made / att) * 100)}%
      <span className={`inline-flex flex-col items-center leading-[0.9] text-xs align-middle ml-1 ${mark?.includes('text-white') ? 'text-white/85' : 'text-gray-500 dark:text-gray-400'}`}>
        <span className="border-b border-current px-0.5">{made}</span>
        <span>{att}</span>
      </span>
    </span>
  );
}

const STAT_COLS: [keyof SurpriseRow, string][] = [
  ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['fg3m', '3PM'], ['stl', 'STL'], ['blk', 'BLK'],
];

/** Headshot + name link + team abbr, without the position pills PlayerIdentityCell always renders. */
function PlayerCell({ row }: { row: SurpriseRow }) {
  const src = toListHeadshotUrl(`https://a.espncdn.com/i/headshots/nba/players/full/${row.player_id}.png`);
  return (
    <div className="flex items-center gap-2 min-w-0 w-full">
      <div className="shrink-0 w-8 h-8 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
        {src ? (
          <>
            <img
              src={src}
              alt=""
              width={32}
              height={32}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover object-top"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                const fallback = e.currentTarget.nextElementSibling;
                if (fallback instanceof HTMLElement) fallback.hidden = false;
              }}
            />
            <div hidden className="w-full h-full flex items-center justify-center text-sm">🏀</div>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm">🏀</div>
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate">
          <PlayerNameLink name={row.player_name} playerId={row.player_id} />
        </div>
        <div className="mt-0.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400">{row.team_abbr}</div>
      </div>
    </div>
  );
}

export function SurpriseTable({ rows, kind }: { rows: SurpriseRow[]; kind: 'good' | 'bad' }) {
  if (rows.length === 0) {
    return <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">Nobody crossed the bar tonight.</p>;
  }
  const barColor = kind === 'good' ? 'bg-blue-500' : 'bg-red-500';
  // The stats that made the night, marked in the row in their own colour:
  // green above the player's norm, red below, whichever table this is, and
  // deeper the further the stat sits from his norm (see markClass).
  const th = 'px-2 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap';
  const td = 'px-2 py-2 whitespace-nowrap text-gray-700 dark:text-gray-300 text-center';
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th className={`${th} text-right`}>#</th>
            <th className={`${th} text-left`}>Player</th>
            <th className={`${th} text-left`}>Matchup</th>
            <th className={th}>MIN</th>
            {STAT_COLS.map(([, label]) => <th key={label} className={th}>{label}</th>)}
            <th className={th}>FG%</th>
            <th className={th}>FT%</th>
            <th className={`${th} text-left`}>Score</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {rows.map((row, i) => {
            const drivers = driverColumns(row);
            const markOf = (col: string) => {
              const d = drivers.get(col);
              return d ? markClass(d.sign, d.z) : undefined;
            };
            return (
            <tr key={row.player_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/60">
              <td className={`${td} text-right text-gray-400 dark:text-gray-500`}>{i + 1}</td>
              <td className="px-2 py-2 min-w-[12rem]">
                <PlayerCell row={row} />
              </td>
              <td className={`${td} text-left`}>{row.is_home ? `vs ${row.opponent_abbr}` : `@ ${row.opponent_abbr}`}</td>
              <td className={td}>{Math.round(row.minutes)}</td>
              {STAT_COLS.map(([key, label]) => (
                <td key={label} className={td}>
                  {markOf(key) ? <span className={markOf(key)}>{row[key] as number}</span> : (row[key] as number)}
                </td>
              ))}
              <td className={td}><ShootingCell made={row.fgm} att={row.fga} mark={markOf('fg')} /></td>
              <td className={td}><ShootingCell made={row.ftm} att={row.fta} mark={markOf('ft')} /></td>
              <td className="px-2 py-2 whitespace-nowrap">
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100 w-10">{fmtScore(row.score)}</span>
                  <div className="w-16 h-1.5 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                    <div className={`h-full ${barColor}`} style={{ width: `${Math.min(Math.abs(row.score) / 4, 1) * 100}%` }} />
                  </div>
                  {!row.has_estimate && (
                    <span
                      className="text-[10px] uppercase tracking-wide text-gray-400"
                      title="No model estimate yet (fewer than 10 games this season) — scored on his own history only"
                    >
                      history only
                    </span>
                  )}
                </div>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

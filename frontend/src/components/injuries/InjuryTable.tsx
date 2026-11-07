import { useState } from 'react';
import { Link } from 'react-router';
import type { InjuryRecord } from '../../types/injury';
import { fmtTimestamp, parseGameParts, sortInjuries, useDepthChartTeamId, type InjurySortDir, type InjurySortKey } from './injuryFormat';

const STATUS_STYLES: Record<string, string> = {
  'Out': 'bg-red-100 text-red-800',
  'Questionable': 'bg-yellow-100 text-yellow-800',
  'Doubtful': 'bg-orange-100 text-orange-800',
  'Probable': 'bg-blue-100 text-blue-800',
  'Available': 'bg-green-100 text-green-800',
};

function statusStyle(status: string): string {
  return STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700';
}

type SortKey = InjurySortKey;
type SortDir = InjurySortDir;

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== col) return <span className="ml-1 text-gray-300">↕</span>;
  return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
}

function RosterLink({ team, teamId }: { team: string; teamId: string }) {
  return (
    <Link
      to={`/nba-teams?team=${encodeURIComponent(teamId)}`}
      aria-label={`${team} roster`}
      title={`${team} roster`}
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-md border border-blue-200 bg-white px-2 py-1 text-xs font-semibold text-blue-700 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50 active:translate-y-px active:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-blue-700 dark:bg-gray-900 dark:text-blue-200 dark:hover:border-blue-500 dark:hover:bg-blue-950 dark:active:bg-blue-900"
    >
      Roster
    </Link>
  );
}

interface Props {
  records: InjuryRecord[];
  totalCount: number;
}

export default function InjuryTable({ records, totalCount }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('last_update');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const depthChartTeamId = useDepthChartTeamId();

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sorted = sortInjuries(records, sortKey, sortDir);

  if (totalCount === 0) {
    return <div className="text-center py-16 text-gray-400 dark:text-gray-500 text-sm">No injury data available</div>;
  }
  if (records.length === 0) {
    return <div className="text-center py-16 text-gray-400 dark:text-gray-500 text-sm">No results match your filters</div>;
  }

  const thClass = "px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap";
  const thSortClass = `${thClass} cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 select-none`;

  return (
    <>
      {/* Desktop table */}
      <div className="hidden sm:block overflow-auto max-h-[70vh] rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">
            <tr>
              <th className={thSortClass} onClick={() => handleSort('team')}>Team<SortIcon col="team" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className={thSortClass} onClick={() => handleSort('gameTime')}>Game Time<SortIcon col="gameTime" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className={thClass}>Matchup</th>
              <th className={thClass}>Player</th>
              <th className={thSortClass} onClick={() => handleSort('status')}>Status<SortIcon col="status" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className={thClass}>Injury</th>
              <th className={thSortClass} onClick={() => handleSort('last_update')}>Last Update<SortIcon col="last_update" sortKey={sortKey} sortDir={sortDir} /></th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
            {sorted.map((r, i) => {
              const { gameTime, matchup } = parseGameParts(r);
              const teamId = depthChartTeamId(r.team);
              return (
                <tr key={`${r.team}|${r.player}|${i}`} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-medium text-gray-800 dark:text-gray-100">{r.team}</span>
                      {teamId && <RosterLink team={r.team} teamId={teamId} />}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">{gameTime || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">{matchup || '—'}</td>
                  <td className="px-4 py-3 text-gray-800 dark:text-gray-100 whitespace-nowrap">{r.player}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${statusStyle(r.status)}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{r.injury || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">{fmtTimestamp(r.last_update)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile sort controls */}
      <div className="sm:hidden flex items-center gap-2 mb-2">
        <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Sort by:</span>
        <select
          value={sortKey}
          onChange={e => {
            const key = e.target.value as SortKey;
            setSortKey(key);
            setSortDir(key === 'last_update' ? 'desc' : 'asc');
          }}
          className="border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-400 flex-1"
        >
          <option value="last_update">Last Update</option>
          <option value="gameTime">Game Time</option>
        </select>
        <button
          type="button"
          onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          className="border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 shrink-0"
          aria-label="Toggle sort direction"
        >
          {sortDir === 'asc' ? '↑' : '↓'}
        </button>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden flex flex-col gap-2 w-full">
        {sorted.map((r, i) => {
          const { gameTime, matchup } = parseGameParts(r);
          const gameDisplay = [gameTime, matchup].filter(Boolean).join(' ');
          const teamId = depthChartTeamId(r.team);
          return (
            <div key={`${r.team}|${r.player}|${i}`} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2.5 shadow-sm w-full min-w-0">
              <div className="flex items-start justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm truncate">{r.player}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 min-w-0 text-xs text-gray-500 dark:text-gray-400">
                    <span className="truncate">{r.team}</span>
                    {teamId && <RosterLink team={r.team} teamId={teamId} />}
                  </p>
                  {gameDisplay && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{gameDisplay}</p>
                  )}
                </div>
                <span className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${statusStyle(r.status)}`}>
                  {r.status}
                </span>
              </div>
              <div className="flex items-end justify-between mt-1 gap-2">
                {r.injury
                  ? <p className="text-xs text-gray-600 dark:text-gray-300 break-words">{r.injury}</p>
                  : <span />
                }
                {r.last_update && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 shrink-0 text-right">{fmtTimestamp(r.last_update)}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

import { useState } from 'react';
import type { InjuryRecord } from '../../types/injury';

function fmtTimestamp(ts: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toLocaleString();
}

const STATUS_STYLES: Record<string, string> = {
  'Out': 'bg-red-100 text-red-800',
  'Questionable': 'bg-yellow-100 text-yellow-800',
  'Doubtful': 'bg-orange-100 text-orange-800',
  'Probable': 'bg-blue-100 text-blue-800',
  'Available': 'bg-green-100 text-green-800',
};

const STATUS_ORDER: Record<string, number> = {
  'Out': 0, 'Doubtful': 1, 'Questionable': 2, 'Probable': 3, 'Available': 4,
};

function statusStyle(status: string): string {
  return STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700';
}

function parseGameParts(r: InjuryRecord): { gameTime: string; matchup: string; gameTimeMs: number } {
  const matchup = r.game.match(/\S+@\S+/)?.[0] ?? '';
  if (r.game_time_utc) {
    const d = new Date(r.game_time_utc);
    const datePart = d.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
    const timePart = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return { gameTime: `${datePart} ${timePart}`, matchup, gameTimeMs: d.getTime() };
  }
  return { gameTime: '', matchup: r.game || '—', gameTimeMs: 0 };
}

type SortKey = 'team' | 'gameTime' | 'status' | 'last_update';
type SortDir = 'asc' | 'desc';

interface Props {
  records: InjuryRecord[];
  totalCount: number;
}

export default function InjuryTable({ records, totalCount }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('gameTime');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="ml-1 text-gray-300">↕</span>;
    return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  const sorted = [...records].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortKey) {
      case 'team': return dir * a.team.localeCompare(b.team);
      case 'gameTime': {
        const aMs = a.game_time_utc ? new Date(a.game_time_utc).getTime() : 0;
        const bMs = b.game_time_utc ? new Date(b.game_time_utc).getTime() : 0;
        return dir * (aMs - bMs);
      }
      case 'status': return dir * ((STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99));
      case 'last_update': return dir * a.last_update.localeCompare(b.last_update);
      default: return 0;
    }
  });

  if (totalCount === 0) {
    return <div className="text-center py-16 text-gray-400 text-sm">No injury data available</div>;
  }
  if (records.length === 0) {
    return <div className="text-center py-16 text-gray-400 text-sm">No results match your filters</div>;
  }

  const thClass = "px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap";
  const thSortClass = `${thClass} cursor-pointer hover:text-gray-700 select-none`;

  return (
    <>
      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              <th className={thSortClass} onClick={() => handleSort('team')}>Team<SortIcon col="team" /></th>
              <th className={thSortClass} onClick={() => handleSort('gameTime')}>Game Time<SortIcon col="gameTime" /></th>
              <th className={thClass}>Matchup</th>
              <th className={thClass}>Player</th>
              <th className={thSortClass} onClick={() => handleSort('status')}>Status<SortIcon col="status" /></th>
              <th className={thClass}>Injury</th>
              <th className={thSortClass} onClick={() => handleSort('last_update')}>Last Update<SortIcon col="last_update" /></th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {sorted.map((r, i) => {
              const { gameTime, matchup } = parseGameParts(r);
              return (
                <tr key={`${r.team}|${r.player}|${i}`} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{r.team}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{gameTime || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{matchup || '—'}</td>
                  <td className="px-4 py-3 text-gray-800 whitespace-nowrap">{r.player}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${statusStyle(r.status)}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.injury || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{fmtTimestamp(r.last_update)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden flex flex-col gap-2 w-full">
        {sorted.map((r, i) => {
          const { gameTime, matchup } = parseGameParts(r);
          const gameDisplay = [gameTime, matchup].filter(Boolean).join(' ');
          return (
            <div key={`${r.team}|${r.player}|${i}`} className="bg-white rounded-lg border border-gray-200 px-3 py-2.5 shadow-sm w-full min-w-0">
              <div className="flex items-start justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-800 text-sm truncate">{r.player}</p>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{r.team}{gameDisplay ? ` · ${gameDisplay}` : ''}</p>
                </div>
                <span className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${statusStyle(r.status)}`}>
                  {r.status}
                </span>
              </div>
              {r.injury && (
                <p className="text-xs text-gray-600 mt-2 break-words">{r.injury}</p>
              )}
              {r.last_update && (
                <p className="text-xs text-gray-400 mt-1">{fmtTimestamp(r.last_update)}</p>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

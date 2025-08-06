import React from 'react';
import type { Player } from '../../../types/api';
import { CollapsibleTable } from '../../../components/CollapsibleTable';
import { formatStatValue } from '../utils/tradeHelpers';
import type { PlayerGroup } from '../utils/tradeHelpers';

interface StatColumn {
  key: string;
  label: string;
  mobile: boolean;
  isPercentage?: boolean;
  isGamesPlayed?: boolean;
}

interface PlayerStatsTableProps {
  playerGroups: PlayerGroup[];
  viewMode: 'totals' | 'averages';
}

export const PlayerStatsTable: React.FC<PlayerStatsTableProps> = ({
  playerGroups,
  viewMode,
}) => {
  const statColumns: StatColumn[] = [
    { key: 'gp', label: 'GP', mobile: false, isGamesPlayed: true },
    { key: 'pts', label: 'PTS', mobile: true },
    { key: 'reb', label: 'REB', mobile: true },
    { key: 'ast', label: 'AST', mobile: true },
    { key: 'stl', label: 'STL', mobile: false },
    { key: 'blk', label: 'BLK', mobile: false },
    { key: 'three_pm', label: '3PM', mobile: false },
    { key: 'fg_percentage', label: 'FG%', mobile: false, isPercentage: true },
    { key: 'ft_percentage', label: 'FT%', mobile: false, isPercentage: true },
  ];

  const formatPlayerStat = (player: Player, statKey: string, isPercentage: boolean = false, isGamesPlayed: boolean = false) => {
    const value = player.stats?.[statKey as keyof typeof player.stats] || 0;
    const gamesPlayed = player.stats?.gp || 1;
    return formatStatValue(value, gamesPlayed, viewMode, isPercentage, isGamesPlayed);
  };

  const getPlayerCount = () => {
    return playerGroups.reduce((total, group) => total + group.players.length, 0);
  };

  return (
    <CollapsibleTable
      title="Player Statistics"
      collapsedLabel={`View detailed stats for ${getPlayerCount()} players`}
      defaultExpanded={false}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-900 border-b">Team</th>
              <th className="px-3 py-2 text-left font-medium text-gray-900 border-b">Player</th>
              <th className="px-3 py-2 text-left font-medium text-gray-900 border-b">Pos</th>
              <th className="px-3 py-2 text-left font-medium text-gray-900 border-b">NBA</th>
              {statColumns.map((col) => (
                <th
                  key={col.key}
                  className={`px-3 py-2 text-center font-medium text-gray-900 border-b ${
                    !col.mobile ? 'hidden sm:table-cell' : ''
                  }`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {playerGroups.map((group, groupIndex) => (
              <React.Fragment key={`group-${groupIndex}`}>
                {group.players.map((player, playerIndex) => (
                  <tr
                    key={`${groupIndex}-${playerIndex}`}
                    className={`
                      ${groupIndex % 2 === 0 ? 'bg-slate-50' : 'bg-amber-50'}
                      hover:bg-opacity-75 transition-colors
                    `}
                  >
                    <td className="px-3 py-2 font-medium text-gray-900 border-b border-gray-200">
                      {playerIndex === 0 && (
                        <span className={`text-sm ${groupIndex % 2 === 0 ? 'text-slate-700' : 'text-amber-700'}`}>
                          {group.team.team_name}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-900 border-b border-gray-200">
                      {player.player_name}
                    </td>
                    <td className="px-3 py-2 text-gray-600 border-b border-gray-200">
                      {player.positions?.join(', ') || 'N/A'}
                    </td>
                    <td className="px-3 py-2 text-gray-600 border-b border-gray-200">
                      {player.pro_team}
                    </td>
                    {statColumns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-3 py-2 text-center text-gray-700 border-b border-gray-200 ${
                          !col.mobile ? 'hidden sm:table-cell' : ''
                        }`}
                      >
                        {formatPlayerStat(player, col.key, col.isPercentage || false, col.isGamesPlayed || false)}
                      </td>
                    ))}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleTable>
  );
};
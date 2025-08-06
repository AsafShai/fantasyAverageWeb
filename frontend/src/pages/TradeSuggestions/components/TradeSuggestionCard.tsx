import React, { useMemo } from 'react';
import type { Team, TradeSuggestion } from '../../../types/api';
import { PlayerStatsTable } from './PlayerStatsTable';
import { TeamComparisonTable } from './TeamComparisonTable';
import { groupPlayersByTeam } from '../utils/tradeHelpers';

interface TradeSuggestionCardProps {
  suggestion: TradeSuggestion;
  userTeam: Team;
  index: number;
  viewMode: 'totals' | 'averages';
}

export const TradeSuggestionCard: React.FC<TradeSuggestionCardProps> = ({
  suggestion,
  userTeam,
  index,
  viewMode,
}) => {

  const { opponent_team, players_to_give, players_to_receive, reasoning } = suggestion;

  const playerGroups = useMemo(() => {
    const { givingGroup, receivingGroup } = groupPlayersByTeam(
      players_to_give, 
      players_to_receive, 
      userTeam, 
      opponent_team
    );
    return [givingGroup, receivingGroup];
  }, [players_to_give, players_to_receive, userTeam, opponent_team]);

  return (
    <div className="card p-6 hover:shadow-lg transition-shadow">
      <div className="flex items-center mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white font-bold">
            {index}
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">
              Trade with {opponent_team.team_name}
            </h3>
            <p className="text-sm text-gray-600">
              {players_to_give?.length || 0} for {players_to_receive?.length || 0} player trade
            </p>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
          <div className="flex items-center mb-3">
            <span className="text-slate-600 mr-2">📤</span>
            <h4 className="font-semibold text-slate-900">
              You Give ({userTeam.team_name})
            </h4>
          </div>
          <div className="space-y-2">
            {players_to_give && players_to_give.length > 0 ? (
              players_to_give.map((player, idx) => (
                <div key={idx} className="bg-white rounded-md p-3 border border-slate-100 text-center">
                  <div className="font-medium text-gray-900">{player.player_name || 'Unknown Player'}</div>
                  <div className="text-sm text-gray-600">
                    {player.positions?.join(', ') || 'N/A'} • {player.pro_team || 'N/A'}
                  </div>
                </div>
              ))
            ) : (
              <div className="bg-white rounded-md p-3 border border-slate-100 text-center">
                <div className="text-amber-600 font-medium mb-1">⚠️ Missing Player Data</div>
                <div className="text-sm text-gray-500">
                  Players to give could not be loaded. This might be due to a data sync issue.
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center mb-3">
            <span className="text-amber-600 mr-2">📥</span>
            <h4 className="font-semibold text-amber-900">
              You Receive ({opponent_team.team_name})
            </h4>
          </div>
          <div className="space-y-2">
            {players_to_receive && players_to_receive.length > 0 ? (
              players_to_receive.map((player, idx) => (
                <div key={idx} className="bg-white rounded-md p-3 border border-amber-100 text-center">
                  <div className="font-medium text-gray-900">{player.player_name || 'Unknown Player'}</div>
                  <div className="text-sm text-gray-600">
                    {player.positions?.join(', ') || 'N/A'} • {player.pro_team || 'N/A'}
                  </div>
                </div>
              ))
            ) : (
              <div className="bg-white rounded-md p-3 border border-amber-100 text-center">
                <div className="text-amber-600 font-medium mb-1">⚠️ Missing Player Data</div>
                <div className="text-sm text-gray-500">
                  Players to receive could not be loaded. This might be due to a data sync issue.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
        <div className="flex items-start space-x-2">
          <span className="text-blue-600 text-lg">💡</span>
          <div>
            <h5 className="font-medium text-blue-700 mb-1">AI Trade Analysis</h5>
            <p className="text-sm text-blue-800 leading-relaxed">
              {reasoning}
            </p>
          </div>
        </div>
      </div>

      <div className="border-t pt-6 space-y-6">
        <PlayerStatsTable
          playerGroups={playerGroups}
          viewMode={viewMode}
        />
        <TeamComparisonTable
          playerGroups={playerGroups}
          viewMode={viewMode}
        />
        
      </div>
    </div>
  );
};
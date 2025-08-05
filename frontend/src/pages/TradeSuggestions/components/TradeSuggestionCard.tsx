import React, { useState, useCallback } from 'react';
import type { Team, TradeSuggestion } from '../../../types/api';
import { TradeImpactStats } from './TradeImpactStats';

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
  const [showDetails, setShowDetails] = useState(false);

  const { opponent_team, players_to_give, players_to_receive, reasoning } = suggestion;

  const getStatValue = useCallback((value: number, gamesPlayed: number) => {
    if (viewMode === 'averages' && gamesPlayed > 0) {
      return (value / gamesPlayed).toFixed(4);
    }
    return Math.round(value).toString();
  }, [viewMode]);

  return (
    <div className="card p-6 hover:shadow-lg transition-shadow">
      <div className="flex items-center justify-between mb-6">
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
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-blue-600 hover:text-blue-700 font-medium text-sm flex items-center space-x-1"
        >
          <span>{showDetails ? 'Hide Details' : 'View Details'}</span>
          <span className={`transform transition-transform ${showDetails ? 'rotate-180' : ''}`}>
            ▼
          </span>
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center mb-3">
            <span className="text-red-600 mr-2">📤</span>
            <h4 className="font-semibold text-red-900">
              You Give ({userTeam.team_name})
            </h4>
          </div>
          <div className="space-y-2">
            {players_to_give && players_to_give.length > 0 ? (
              players_to_give.map((player, idx) => (
                <div key={idx} className="bg-white rounded-md p-3 border border-red-100">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium text-gray-900">{player.player_name || 'Unknown Player'}</div>
                      <div className="text-sm text-gray-600">
                        {player.positions?.join(', ') || 'N/A'} • {player.pro_team || 'N/A'}
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <div className="text-gray-600">
                        {getStatValue(player.stats?.pts || 0, player.stats?.gp || 1)} PTS
                      </div>
                      <div className="text-gray-500">
                        {getStatValue(player.stats?.reb || 0, player.stats?.gp || 1)} REB
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="bg-white rounded-md p-3 border border-red-100 text-center">
                <div className="text-amber-600 font-medium mb-1">⚠️ Missing Player Data</div>
                <div className="text-sm text-gray-500">
                  Players to give could not be loaded. This might be due to a data sync issue.
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center mb-3">
            <span className="text-green-600 mr-2">📥</span>
            <h4 className="font-semibold text-green-900">
              You Receive ({opponent_team.team_name})
            </h4>
          </div>
          <div className="space-y-2">
            {players_to_receive && players_to_receive.length > 0 ? (
              players_to_receive.map((player, idx) => (
                <div key={idx} className="bg-white rounded-md p-3 border border-green-100">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium text-gray-900">{player.player_name || 'Unknown Player'}</div>
                      <div className="text-sm text-gray-600">
                        {player.positions?.join(', ') || 'N/A'} • {player.pro_team || 'N/A'}
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <div className="text-gray-600">
                        {getStatValue(player.stats?.pts || 0, player.stats?.gp || 1)} PTS
                      </div>
                      <div className="text-gray-500">
                        {getStatValue(player.stats?.reb || 0, player.stats?.gp || 1)} REB
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="bg-white rounded-md p-3 border border-green-100 text-center">
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
            <h5 className="font-medium text-blue-900 mb-1">AI Trade Analysis</h5>
            <p className="text-sm text-blue-800 leading-relaxed">
              {reasoning}
            </p>
          </div>
        </div>
      </div>

      {showDetails && (
        <div className="border-t pt-6 space-y-6">
          <TradeImpactStats
            playersToGive={players_to_give}
            playersToReceive={players_to_receive}
            viewMode={viewMode}
          />
        </div>
      )}
    </div>
  );
};
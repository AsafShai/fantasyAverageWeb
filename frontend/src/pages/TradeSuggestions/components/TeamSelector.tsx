import React from 'react';
import { useGetTeamsListQuery } from '../../../store/api/fantasyApi';
import type { Team } from '../../../types/api';
import LoadingSpinner from '../../../components/LoadingSpinner';
import ErrorMessage from '../../../components/ErrorMessage';

interface TeamSelectorProps {
  selectedTeam: Team | null;
  onTeamSelect: (team: Team | null) => void;
  disabled?: boolean;
}

export const TeamSelector: React.FC<TeamSelectorProps> = ({
  selectedTeam,
  onTeamSelect,
  disabled = false,
}) => {
  const { data: teams, isLoading, error } = useGetTeamsListQuery();

  const handleTeamChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const teamId = parseInt(e.target.value);
    const team = teams?.find(t => t.team_id === teamId) || null;
    onTeamSelect(team);
  };

  if (isLoading) {
    return (
      <div className="card p-6">
        <div className="text-center">
          <LoadingSpinner />
          <p className="text-gray-600 mt-2">Loading teams...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6">
        <ErrorMessage message="Failed to load teams. Please try again." />
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="text-center mb-4">
        <h2 className="text-lg font-semibold text-gray-800 mb-2">
          Select Your Team
        </h2>
        <p className="text-sm text-gray-600">
          Choose the team you want to find trade suggestions for
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Your Team
          </label>
          <select
            value={selectedTeam?.team_id ?? ''}
            onChange={handleTeamChange}
            disabled={disabled}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-base disabled:bg-gray-100 disabled:cursor-not-allowed"
          >
            <option value="">Choose your team...</option>
            {teams?.map((team) => (
              <option key={team.team_id} value={team.team_id}>
                {team.team_name}
              </option>
            ))}
          </select>
        </div>

        {selectedTeam && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center">
              <div className="text-blue-600 mr-2">✓</div>
              <div>
                <div className="font-medium text-blue-900">
                  {selectedTeam.team_name} Selected
                </div>
                <div className="text-sm text-blue-700">
                  Ready to analyze trade opportunities
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};